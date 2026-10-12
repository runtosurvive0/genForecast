"""HP-specific updater. Run as puyo; never includes or prints API credentials.

Payload contains source files, a built public index, and their before/after hashes.
Existing databases and environment files are never replaced by the payload.
"""
import argparse
from datetime import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

ROOT = Path('/home/puyo/genforecast-hp-20261012')
WEB = Path('/home/puyo/genforecast-public-20261012/index.html')
PYTHON = '/home/puyo/miniforge3/envs/genforecast/bin/python'
DOMAIN = 'zgx-6660.tailec6d33.ts.net'
UNIT = Path('/etc/systemd/system/genforecast-frontend.service')
BACKUPS = Path('/home/puyo/.config/genforecast/backups')
UNIT_TEXT = '''[Unit]
Description=GenForecast compressed public frontend
After=network.target

[Service]
Type=simple
User=puyo
WorkingDirectory=/home/puyo/genforecast-hp-20261012/backend
Environment=PYTHONPATH=/home/puyo/genforecast-hp-20261012/backend/src
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=GENFORECAST_FRONTEND_FILE=/home/puyo/genforecast-public-20261012/index.html
ExecStart=/home/puyo/miniforge3/envs/genforecast/bin/python -m uvicorn midterm.web.frontend:app --host 127.0.0.1 --port 8094 --no-access-log
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
'''


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def target(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT.resolve()) or path.is_relative_to(ROOT / 'backend/data'):
        raise RuntimeError('Invalid source destination')
    return path


def request(base, path, expected=200, headers=None, data=None):
    req = urllib.request.Request(base + path, headers=headers or {}, data=data)
    try:
        result = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        result = error
    with result:
        body = result.read()
        if result.status != expected:
            raise RuntimeError(f'HTTP check failed: {path} ({result.status})')
        return result.headers, body


def ready():
    for _ in range(30):
        try:
            _, body = request('http://127.0.0.1:8093', '/api/auth/bootstrap-status')
            if json.loads(body).get('setupRequired') is not False:
                raise RuntimeError('Existing administrator not recognized')
            request('http://127.0.0.1:8094', '/')
            return
        except (OSError, urllib.error.URLError):
            time.sleep(1)
    raise RuntimeError('Services did not become ready')


def verify():
    base = 'https://' + DOMAIN
    headers, packed = request(base, '/', headers={'Accept-Encoding': 'gzip'})
    if headers.get('Content-Encoding') != 'gzip' or gzip.decompress(packed) != WEB.read_bytes():
        raise RuntimeError('Compressed frontend verification failed')
    print(f'Frontend gzip: {len(packed):,} bytes (original {WEB.stat().st_size:,}).')
    _, body = request(base, '/api/auth/bootstrap-status')
    assert json.loads(body).get('setupRequired') is False
    request(base, '/api/vessels/catalog', 401)
    request(base, '/api/admin/users', 401)
    request(base, '/api/auth/logout', 403, headers={'Origin': base}, data=b'{}')
    request(base, '/api/auth/session', 403, headers={'Origin': 'https://untrusted.example'})
    headers, _ = request(base, '/api/auth/csrf', headers={'Origin': base})
    assert any(all(v in c.lower() for v in ('secure', 'httponly', 'samesite=lax'))
               for c in headers.get_all('Set-Cookie', []))
    for path in ('/.env', '/backend/data/access.sqlite3', '/backend/data/vessel-discovery.sqlite3'):
        request(base, path, 404)
    print('HTTPS authentication, CSRF, cookies and private paths: PASS.')


def collection_status():
    path = ROOT / 'backend/data/vessel-discovery.sqlite3'
    def read():
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            count = db.execute('SELECT count(*) FROM discovery WHERE general_order IS NOT NULL').fetchone()[0]
            stamp = db.execute("SELECT value FROM discovery_meta WHERE key='last_received_at'").fetchone()
            return count, stamp[0] if stamp else None
    first = read()
    time.sleep(12)
    second = read()
    print(f'Saved general ships: {first[0]} -> {second[0]}. Last receive: {second[1] or "none yet"}.')
    print('Background ingestion: PASS (no catalog HTTP requests).' if first[1] != second[1]
          else 'No new committed AIS message during this check; check provider/key status before assuming live reception.')


def config():
    value = json.loads(run('tailscale', 'serve', 'status', '--json', capture_output=True, text=True).stdout)
    host = DOMAIN + ':443'
    expected_api = {'Proxy': 'http://127.0.0.1:8093/api'}
    handlers = value.get('Web', {}).get(host, {}).get('Handlers', {})
    if value.get('Foreground') or value.get('Services') or set(value.get('Web', {})) != {host}:
        raise RuntimeError('Unrecognized Tailscale services; preserve configuration for review')
    if value.get('TCP') != {'443': {'HTTPS': True}}:
        raise RuntimeError('Unrecognized Tailscale TCP settings')
    if handlers.get('/') != {'Path': str(WEB)} or len(handlers) != 2 or not any(
            handlers.get(p) == expected_api for p in ('/api', '/api/')):
        raise RuntimeError('Expected original file and API routes; update not applied')
    if not value.get('AllowFunnel', {}).get(host):
        raise RuntimeError('Expected already-published Funnel; updater does not publish a private server')
    return value


def restore(backup):
    state = json.loads((backup / 'state.json').read_text())
    # Refuse to overwrite edits made after this update.
    for name, hashes in state['files'].items():
        if digest(target(name)) not in (hashes['before'], hashes['after']):
            raise RuntimeError('Source changed since update: ' + name)
    if digest(WEB) not in (state['web_before'], state['web_after']):
        raise RuntimeError('Frontend changed since update')
    run('sudo', 'systemctl', 'stop', 'genforecast-backend')
    for name, hashes in state['files'].items():
        path = target(name)
        if hashes['before'] is None:
            path.unlink(missing_ok=True)
        else:
            shutil.copy2(backup / 'source' / name, path)
    shutil.copy2(backup / 'index.html', WEB)
    run('sudo', 'systemctl', 'start', 'genforecast-backend')
    run('sudo', 'tailscale', 'funnel', '--bg', '--https=443', str(WEB))
    subprocess.run(['sudo', 'systemctl', 'disable', '--now', 'genforecast-frontend'], check=False)
    print('Previous source and file route restored. Databases preserved (including new discovery DB).')


def apply(bundle):
    manifest = json.loads((bundle / 'manifest.json').read_text())
    config()
    if UNIT.exists():
        raise RuntimeError('Frontend service already exists; use verify or review before applying again')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 8094))  # Refuse to replace an unrelated listener.
    for name, hashes in manifest['files'].items():
        if digest(target(name)) != hashes['before'] or digest(bundle / 'source' / name) != hashes['after']:
            raise RuntimeError('Source checksum mismatch: ' + name)
    if digest(WEB) != manifest['web_before'] or digest(bundle / 'index.html') != manifest['web_after']:
        raise RuntimeError('Frontend checksum mismatch')
    # Test a source overlay without editing the running application or opening real DBs.
    with tempfile.TemporaryDirectory(prefix='genforecast-check-') as tmp:
        stage = Path(tmp)
        shutil.copytree(ROOT / 'backend/src', stage / 'src', ignore=shutil.ignore_patterns('__pycache__'))
        for name in manifest['files']:
            if name.startswith('backend/src/'):
                output = stage / name.removeprefix('backend/')
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bundle / 'source' / name, output)
        env = {**os.environ, 'PYTHONPATH': str(stage / 'src'), 'AISSTREAM_API_KEY': '', 'GFW_API_TOKEN': ''}
        run(PYTHON, '-m', 'pytest', '-o', 'pythonpath=', '-q',
            *[str(bundle / 'source/backend/tests' / name) for name in
              ('test_auth.py', 'test_discovery_persistence.py', 'test_frontend.py', 'test_vessel_ais.py')],
            cwd=stage, env=env)
    run('sudo', '-v')
    backup = BACKUPS / ('persistent-ais-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, mode=0o700)
    for name in manifest['files']:
        path = target(name)
        if path.exists():
            saved = backup / 'source' / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    shutil.copy2(WEB, backup / 'index.html')
    (backup / 'state.json').write_text(json.dumps(manifest))
    for name in ('access.sqlite3', 'vessel-tracks.sqlite3', 'planning.sqlite3', 'vessel-discovery.sqlite3'):
        path = ROOT / 'backend/data' / name
        if path.exists():
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(backup / name) as dest:
                source.backup(dest)
                assert dest.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    print('Backup: ' + str(backup), flush=True)
    try:
        run('sudo', 'systemctl', 'stop', 'genforecast-backend')
        for name in manifest['files']:
            path = target(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(bundle / 'source' / name, path)
        shutil.copyfile(bundle / 'index.html', WEB)
        unit = backup / 'genforecast-frontend.service'
        unit.write_text(UNIT_TEXT)
        run('sudo', 'install', '-m', '644', str(unit), str(UNIT))
        run('sudo', 'systemctl', 'daemon-reload')
        run('sudo', 'systemctl', 'start', 'genforecast-backend')
        run('sudo', 'systemctl', 'enable', '--now', 'genforecast-frontend')
        ready()
        run('sudo', 'tailscale', 'funnel', '--bg', '--https=443', 'http://127.0.0.1:8094')
        verify()
    except BaseException:
        print('Update failed; restoring previous code and root file route.', flush=True)
        restore(backup)
        raise
    collection_status()
    print('Update installed. Keep using https://' + DOMAIN)
    print('Do not run the old HTTPS prepare/publish script: it would restore the uncompressed file route.')
    print('Rollback command: ' + PYTHON + ' ' + str(Path(__file__).resolve()) + ' rollback ' + str(backup))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['apply', 'verify', 'rollback'])
    parser.add_argument('path', nargs='?')
    args = parser.parse_args()
    if Path.home() != Path('/home/puyo') or os.geteuid() == 0:
        sys.exit('Run as puyo, without sudo.')
    if args.mode == 'apply':
        apply(Path(args.path or Path(__file__).parent).resolve())
    elif args.mode == 'verify':
        verify()
        collection_status()
    elif args.path:
        backup = Path(args.path).resolve()
        if not backup.is_relative_to(BACKUPS.resolve()):
            sys.exit('Backup must be inside the GenForecast backup folder.')
        restore(backup)
    else:
        parser.error('rollback requires the printed backup path')
