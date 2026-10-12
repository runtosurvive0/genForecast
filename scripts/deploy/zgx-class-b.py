"""Deploy only the AIS Class B receiver to the existing ZGX backend."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path('/home/puyo/genforecast-hp-20261012')  # Existing installation path.
TARGET = ROOT / 'backend/src/midterm/vessels/ais.py'
BACKUPS = Path('/home/puyo/.config/genforecast/backups')
BUNDLE = Path(__file__).resolve().parent
SERVICE = 'genforecast-backend'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def replace(source):
    temporary = TARGET.with_name('ais.py.class-b-update')
    shutil.copy2(source, temporary)
    temporary.replace(TARGET)


def ready():
    for _ in range(25):
        try:
            run('systemctl', 'is-active', '--quiet', SERVICE)
            with urllib.request.urlopen('http://127.0.0.1:8093/api/auth/bootstrap-status', timeout=2) as response:
                if json.load(response).get('setupRequired') is False:
                    return
        except (OSError, subprocess.CalledProcessError):
            pass
        time.sleep(1)
    raise RuntimeError('ZGX backend health check failed')


def snapshot():
    path = ROOT / 'backend/data/vessel-discovery.sqlite3'
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5) as db:
        total = db.execute('SELECT COUNT(*) FROM discovery').fetchone()[0]
        stamp = db.execute("SELECT value FROM discovery_meta WHERE key='last_received_at'").fetchone()
        return {'savedShips': total, 'lastReceivedAt': stamp[0] if stamp else None}


def check(manifest):
    if digest(TARGET) != manifest['before'] or digest(BUNDLE / 'ais.py') != manifest['after']:
        raise RuntimeError('AIS source differs from the reviewed version; nothing changed')
    if digest(BUNDLE / 'test_vessel_class_b.py') != manifest['test']:
        raise RuntimeError('Test checksum mismatch; nothing changed')
    with tempfile.TemporaryDirectory(prefix='genforecast-class-b-check-') as tmp:
        stage = Path(tmp)
        shutil.copytree(ROOT / 'backend/src', stage / 'src', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copy2(BUNDLE / 'ais.py', stage / 'src/midterm/vessels/ais.py')
        shutil.copy2(BUNDLE / 'test_vessel_class_b.py', stage / 'test_vessel_class_b.py')
        env = {**os.environ, 'PYTHONPATH': str(stage / 'src'), 'AISSTREAM_API_KEY': '', 'GFW_API_TOKEN': '',
               'GENFORECAST_ACCESS_DB': str(stage / 'access.sqlite3'),
               'AIS_TRACK_DB': str(stage / 'tracks.sqlite3'), 'AIS_DISCOVERY_DB': str(stage / 'discovery.sqlite3')}
        run(sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
            str(stage / 'test_vessel_class_b.py'), cwd=stage, env=env)
    print('ZGX isolated Class B checks passed; production files unchanged.', flush=True)


def verify(manifest):
    if digest(TARGET) != manifest['after']:
        raise RuntimeError('Class B receiver is not installed')
    ready()
    before = snapshot()
    for _ in range(10):
        time.sleep(2)
        after = snapshot()
        if after['lastReceivedAt'] != before['lastReceivedAt']:
            print('Background AIS ingestion: PASS; ' + json.dumps(after), flush=True)
            return
    print('Backend healthy; no new AIS batch observed in 20 seconds. ' + json.dumps(before), flush=True)


def restore(backup, manifest):
    if digest(backup / 'ais.py') != manifest['before']:
        raise RuntimeError('Backup checksum mismatch')
    run('sudo', 'systemctl', 'stop', SERVICE)
    try:
        replace(backup / 'ais.py')
    finally:
        run('sudo', 'systemctl', 'start', SERVICE)
    ready()
    print('Previous receiver restored. Databases and credentials preserved.', flush=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('check', 'apply', 'verify', 'rollback'))
    parser.add_argument('backup', nargs='?')
    args = parser.parse_args()
    if Path.home() != Path('/home/puyo') or os.geteuid() == 0:
        raise RuntimeError('Run as puyo, without sudo on the Python command')
    manifest = json.loads((BUNDLE / 'manifest.json').read_text())
    if args.action == 'check':
        check(manifest)
    elif args.action == 'verify':
        verify(manifest)
    elif args.action == 'rollback':
        backup = Path(args.backup or '').resolve()
        if not backup.is_relative_to(BACKUPS.resolve()) or json.loads((backup / 'manifest.json').read_text()) != manifest:
            raise RuntimeError('Invalid backup')
        if digest(TARGET) not in (manifest['before'], manifest['after']):
            raise RuntimeError('Later source changes found; rollback stopped')
        run('sudo', '-v')
        restore(backup, manifest)
    else:
        check(manifest)
        run('sudo', '-v')  # Password, if required, is entered only in the ZGX terminal.
        if digest(TARGET) != manifest['before']:
            raise RuntimeError('Source changed during checks; update stopped')
        backup = BACKUPS / ('class-b-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True, mode=0o700)
        shutil.copy2(TARGET, backup / 'ais.py')
        shutil.copy2(BUNDLE / 'manifest.json', backup / 'manifest.json')
        print('Backup: ' + str(backup), flush=True)
        try:
            run('sudo', 'systemctl', 'stop', SERVICE)
            replace(BUNDLE / 'ais.py')
            run('sudo', 'systemctl', 'start', SERVICE)
            ready()
        except BaseException:
            restore(backup, manifest)
            raise
        print('ZGX Class B update installed. No frontend, database or credential replacement.', flush=True)
        print(f'Rollback: {sys.executable} {BUNDLE / "update.py"} rollback {backup}', flush=True)
        verify(manifest)


if __name__ == '__main__':
    main()
