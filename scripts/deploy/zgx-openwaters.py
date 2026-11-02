"""Allowlisted ZGX supplemental AIS update. Run verify, apply, or rollback PATH.

Bundle layout: this script as update.py, manifest.json, backend/src + tests,
backend/pyproject.toml, and index.html. Never copies or replaces databases/keys.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import urlopen

BUNDLE = Path(__file__).resolve().parent
APP = Path('/home/puyo/genforecast-hp-20261012')
WEB = Path('/home/puyo/genforecast-public-20261012/index.html')
BACKUPS = Path('/home/puyo/.config/genforecast/backups')
DROPIN = Path('/etc/systemd/system/genforecast-backend.service.d/openwaters.conf')
SETTING = '[Service]\nEnvironment=OPENWATERS_ENABLED=1\n'
FILES = ('backend/src/midterm/vessels/ais.py', 'backend/src/midterm/vessels/openwaters.py',
         'backend/src/midterm/auth/workspace.py', 'index.html')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def target(name):
    if name not in FILES:
        raise ValueError('File outside deployment allowlist')
    return WEB if name == 'index.html' else APP / name


def run(*args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def verify():
    manifest = json.loads((BUNDLE / 'manifest.json').read_text())
    if set(manifest) != set(FILES):
        raise ValueError('Unexpected deployment manifest')
    if DROPIN.exists():
        raise ValueError('Open Waters drop-in already exists; inspect before another deployment')
    for name in FILES:
        spec = manifest[name]
        if digest(BUNDLE / name) != spec['new']:
            raise ValueError(f'Bundle checksum mismatch: {name}')
        if digest(target(name)) != spec['old']:
            raise ValueError(f'Production changed since preparation: {name}')
        if name.endswith('.py'):
            compile((BUNDLE / name).read_bytes(), name, 'exec')
    env = {**os.environ, 'PYTHONPATH': str(BUNDLE / 'backend/src'),
           'OPENWATERS_ENABLED': '0', 'AISSTREAM_API_KEY': '', 'GFW_API_TOKEN': ''}
    run(sys.executable, '-m', 'pytest', 'tests/test_openwaters.py', 'tests/test_vessel_ais.py',
        'tests/test_discovery_persistence.py', 'tests/test_vessel_class_b.py', '-q',
        cwd=BUNDLE / 'backend', env=env)
    print('ZGX isolated Open Waters checks passed; production unchanged.', flush=True)
    return manifest


def replace_file(source, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix=dest.name + '.openwaters-', dir=dest.parent)
    os.close(fd)
    temporary = Path(path)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o644 if dest == WEB else 0o600)
        os.replace(temporary, dest)
    finally:
        temporary.unlink(missing_ok=True)


def healthy():
    for _ in range(30):
        try:
            with urlopen('http://127.0.0.1:8093/api/auth/bootstrap-status', timeout=2) as response:
                if json.load(response).get('setupRequired') is False:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Backend health check failed')


def restore(backup, check=True):
    backup = backup.resolve()
    if backup.parent != BACKUPS.resolve() or not backup.name.startswith('openwaters-'):
        raise ValueError('Unexpected backup directory')
    record = json.loads((backup / 'record.json').read_text())
    if set(record) != set(FILES):
        raise ValueError('Unexpected backup manifest')
    for name, info in record.items():
        if info['old'] is not None and digest(backup / name) != info['old']:
            raise ValueError('Backup checksum mismatch')
        if check and digest(target(name)) not in (info['old'], info['new']):
            raise ValueError('A later deployment exists; automatic rollback refused')
    if DROPIN.exists() and DROPIN.read_text() != SETTING:
        raise ValueError('Open Waters configuration changed; automatic rollback refused')
    run('sudo', 'systemctl', 'stop', 'genforecast-backend')
    try:
        for name, info in record.items():
            dest = target(name)
            if info['old'] is None:
                if dest.exists():
                    dest.unlink()  # One allowlisted new module only.
            else:
                replace_file(backup / name, dest)
        if DROPIN.exists():
            run('sudo', 'rm', '--', str(DROPIN))
        run('sudo', 'systemctl', 'daemon-reload')
    finally:
        run('sudo', 'systemctl', 'start', 'genforecast-backend')
    healthy()
    print('Previous code/configuration restored. Collected data retained.')


def apply():
    manifest = verify()
    run('sudo', '-v')
    # Recheck after the password prompt before taking ownership of the update.
    if DROPIN.exists() or any(digest(target(n)) != manifest[n]['old'] for n in FILES):
        raise ValueError('Production changed during verification')
    backup = BACKUPS / ('openwaters-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, mode=0o700)
    for name in FILES:
        if target(name).exists():
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target(name), saved)
    (backup / 'record.json').write_text(json.dumps(manifest), encoding='utf-8')
    (BUNDLE / 'openwaters.conf').write_text(SETTING, encoding='utf-8')
    print(f'Backup: {backup}', flush=True)
    run('sudo', 'systemctl', 'stop', 'genforecast-backend')
    try:
        for name in FILES:
            replace_file(BUNDLE / name, target(name))
        staged_dropin = DROPIN.with_name(backup.name + '.tmp')
        try:
            run('sudo', 'install', '-D', '-m', '644', str(BUNDLE / 'openwaters.conf'), str(staged_dropin))
            if DROPIN.exists():
                raise ValueError('Open Waters configuration appeared during deployment')
            run('sudo', 'mv', '-T', '--', str(staged_dropin), str(DROPIN))
        finally:
            run('sudo', 'rm', '-f', '--', str(staged_dropin))
        run('sudo', 'systemctl', 'daemon-reload')
        run('sudo', 'systemctl', 'start', 'genforecast-backend')
        healthy()
    except BaseException:
        restore(backup, check=False)
        raise
    print('Open Waters enabled for Dangjin/Pyeongtaek. Existing AISstream, DBs, keys and gzip preserved.')
    print('Refresh browsers; both feeds now share the server catalog.')
    print(f'Rollback: {sys.executable} {BUNDLE / "update.py"} rollback {backup}')


if __name__ == '__main__':
    os.umask(0o077)
    if sys.argv[1:] == ['verify']:
        verify()
    elif sys.argv[1:] == ['apply']:
        apply()
    elif len(sys.argv) == 3 and sys.argv[1] == 'rollback':
        run('sudo', '-v')
        restore(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: update.py verify | apply | rollback BACKUP')
