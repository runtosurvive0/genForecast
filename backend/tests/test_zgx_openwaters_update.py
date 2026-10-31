import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[2] / 'scripts/deploy/zgx-openwaters.py'
    spec = importlib.util.spec_from_file_location('ow_deployment', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name, value in {'BUNDLE': tmp_path / 'bundle', 'APP': tmp_path / 'app',
                        'WEB': tmp_path / 'public/index.html', 'BACKUPS': tmp_path / 'backups',
                        'DROPIN': tmp_path / 'system/openwaters.conf'}.items():
        monkeypatch.setattr(module, name, value)
    manifest = {}
    for name in module.FILES:
        source, target = module.BUNDLE / name, module.target(name)
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text('# new\n')
        if not name.endswith('/openwaters.py'):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('# old\n')
        manifest[name] = {'new': module.digest(source), 'old': module.digest(target)}
    (module.BUNDLE / 'manifest.json').write_text(json.dumps(manifest))
    commands = []
    def run(*args, **kwargs):
        commands.append(args)
        if args[:2] == ('sudo', 'install'):
            dest = Path(args[-1])
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(module.SETTING)
        if args[:2] == ('sudo', 'mv'):
            Path(args[-2]).replace(Path(args[-1]))
        if args[:2] == ('sudo', 'rm'):
            Path(args[-1]).unlink(missing_ok=True)
    monkeypatch.setattr(module, 'run', run)
    monkeypatch.setattr(module, 'healthy', lambda: None)
    return module, manifest, commands


def test_update_and_rollback_preserve_unrelated_files_and_databases(deployment):
    m, manifest, commands = deployment
    db = m.APP / 'backend/data/access.sqlite3'
    db.parent.mkdir(parents=True)
    db.write_bytes(b'do-not-touch')
    m.apply()
    assert all(m.digest(m.target(n)) == manifest[n]['new'] for n in m.FILES)
    backup = next(m.BACKUPS.iterdir())
    m.restore(backup)
    assert all(m.digest(m.target(n)) == manifest[n]['old'] for n in m.FILES)
    assert not m.DROPIN.exists()
    assert db.read_bytes() == b'do-not-touch'


def test_failed_health_automatically_restores_previous_code(deployment, monkeypatch):
    m, manifest, _ = deployment
    calls = []
    def healthy():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError('test unhealthy')
    monkeypatch.setattr(m, 'healthy', healthy)
    with pytest.raises(RuntimeError, match='test unhealthy'):
        m.apply()
    assert len(calls) == 2
    assert all(m.digest(m.target(n)) == manifest[n]['old'] for n in m.FILES)
    assert not m.DROPIN.exists()


def test_verify_refuses_changed_production_before_mutation(deployment):
    m, _, commands = deployment
    m.WEB.write_text('newer deployment')
    with pytest.raises(ValueError, match='Production changed'):
        m.verify()
    assert not commands


def test_interrupted_copy_cleans_own_temp_and_rollback_can_retry(deployment, monkeypatch):
    m, _, _ = deployment
    original = m.shutil.copyfile
    def partial(src, dest):
        Path(dest).write_text('partial')
        raise OSError('interrupted copy')
    monkeypatch.setattr(m.shutil, 'copyfile', partial)
    with pytest.raises(OSError):
        m.replace_file(m.BUNDLE / 'index.html', m.WEB)
    assert m.WEB.read_text() == '# old\n'
    assert not list(m.WEB.parent.glob('*.openwaters-*'))
    monkeypatch.setattr(m.shutil, 'copyfile', original)
    m.replace_file(m.BUNDLE / 'index.html', m.WEB)
    assert m.WEB.read_text() == '# new\n'
