"""Apply only catalog compression to the existing ZGX backend; no DB/key changes."""
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from datetime import datetime

ROOT = Path('/home/puyo/genforecast-hp-20261012/backend')
APP = ROOT / 'src/midterm/web/app.py'
MODULE = APP.with_name('catalog_transport.py')
BUNDLE = Path(__file__).resolve().parent
BACKUPS = Path.home() / '.config/genforecast/backups'
ANCHOR = 'from midterm.web.auth_api import install_access'
INSERT = 'from midterm.web.catalog_transport import CatalogCompressionMiddleware\napp.add_middleware(CatalogCompressionMiddleware)\n'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_atomic(path, data, mode=0o644):
    fd, temporary = tempfile.mkstemp(prefix='.catalog-update-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart():
    subprocess.run(['sudo', 'systemctl', 'restart', 'genforecast-backend'], check=True)


def health():
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8093/api/auth/bootstrap-status', timeout=2) as result:
                if result.status != 200:
                    raise RuntimeError('Bootstrap unavailable')
            try:
                urllib.request.urlopen('http://127.0.0.1:8093/api/vessels/catalog', timeout=2)
                raise RuntimeError('Catalog unexpectedly accessible without login')
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise
            return
        except (OSError, RuntimeError):
            time.sleep(1)
    raise RuntimeError('Backend health/authentication check failed')


def check():
    manifest = json.loads((BUNDLE / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        if Path(name).name != name or digest((BUNDLE / name).read_bytes()) != expected:
            raise RuntimeError('Bundle hash mismatch: ' + name)
    original = APP.read_bytes()
    if digest(original) != manifest['appSha256'] or MODULE.exists():
        raise RuntimeError('Server changed since preparation; refusing to overwrite')
    text = original.decode('utf-8')
    if text.count(ANCHOR) != 1 or APP.stat().st_uid != os.getuid():
        raise RuntimeError('Unexpected source anchor or owner')
    patched = text.replace(ANCHOR, INSERT + ANCHOR).encode('utf-8')
    ast.parse(patched)
    with tempfile.TemporaryDirectory(prefix='genforecast-compression-check-') as temporary:
        root = Path(temporary)
        web = root / 'midterm/web'
        web.mkdir(parents=True)
        (web.parent / '__init__.py').touch()
        (web / '__init__.py').touch()
        shutil.copyfile(BUNDLE / 'catalog_transport.py', web / 'catalog_transport.py')
        shutil.copyfile(BUNDLE / 'test_catalog_transport.py', root / 'test_catalog_transport.py')
        env = dict(os.environ, PYTHONPATH=str(root), AISSTREAM_API_KEY='', GFW_API_TOKEN='')
        subprocess.run([sys.executable, '-m', 'pytest', str(root / 'test_catalog_transport.py'),
                        '-q', '-p', 'no:cacheprovider'], cwd=root, env=env, check=True)
    print('Isolated compression checks passed; production unchanged.', flush=True)
    return original, patched, (BUNDLE / 'catalog_transport.py').read_bytes()


def rollback(folder):
    folder = Path(folder).resolve()
    if folder.parent != BACKUPS.resolve():
        raise RuntimeError('Invalid backup location')
    meta = json.loads((folder / 'state.json').read_text())
    if digest(APP.read_bytes()) != meta['patched'] or digest(MODULE.read_bytes()) != meta['module']:
        raise RuntimeError('Server changed after deployment; refusing rollback overwrite')
    subprocess.run(['sudo', '-v'], check=True)
    write_atomic(APP, (folder / 'app.py').read_bytes(), meta['mode'])
    MODULE.unlink()
    restart()
    health()
    print('Catalog compression rolled back.')


def apply():
    original, patched, module = check()
    subprocess.run(['sudo', '-v'], check=True)
    # Recheck after the password prompt to avoid overwriting intervening changes.
    if APP.read_bytes() != original or MODULE.exists():
        raise RuntimeError('Server changed during preparation')
    backup = BACKUPS / ('catalog-compression-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, mode=0o700)
    mode = APP.stat().st_mode & 0o777
    write_atomic(backup / 'app.py', original, 0o600)
    write_atomic(backup / 'state.json', json.dumps({'patched': digest(patched), 'module': digest(module), 'mode': mode}).encode(), 0o600)
    try:
        write_atomic(MODULE, module)
        write_atomic(APP, patched, mode)
        restart()
        health()
    except Exception:
        write_atomic(APP, original, mode)
        MODULE.unlink(missing_ok=True)
        restart()
        raise
    print('ZGX catalog compression installed. Database, credentials and frontend preserved.')
    print('Retry the vessel list on the other PC; no frontend update is required for compression.')
    print('Backup:', backup)
    print('Rollback:', sys.executable, Path(__file__).resolve(), 'rollback', backup)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    if mode == 'check':
        check()
    elif mode == 'apply':
        apply()
    elif mode == 'rollback' and len(sys.argv) == 3:
        rollback(sys.argv[2])
    else:
        raise SystemExit('Usage: update.py check|apply|rollback BACKUP')
