"""ZGX 자동 갱신기(scripts/deploy/zgx-auto-update/update.py)의 순수 로직과 전환·되돌리기 결정.

실제 git·sudo·systemctl·네트워크는 호출하지 않는다. 단계 함수는 가짜로 바꿔 끼운다.
"""
import contextlib
import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DEPLOY_DIR = ROOT / 'scripts/deploy/zgx-auto-update'
NEW = 'b' * 40
OLD = 'a' * 40


def load(monkeypatch, base):
    monkeypatch.setenv('GENFORECAST_UPDATE_BASE', str(base))
    monkeypatch.setenv('GENFORECAST_UPDATE_SHARED_DATA', str(base / 'old-data'))
    monkeypatch.setenv('GENFORECAST_UPDATE_BACKUPS', str(base / 'backups'))
    spec = importlib.util.spec_from_file_location('zgx_auto_update', DEPLOY_DIR / 'update.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def upd(tmp_path, monkeypatch):
    return load(monkeypatch, tmp_path)


def test_paths_default_to_zgx_layout_and_follow_overrides(tmp_path, monkeypatch):
    for name in ('BASE', 'SHARED_DATA', 'BACKUPS', 'REPO'):
        monkeypatch.delenv(f'GENFORECAST_UPDATE_{name}', raising=False)
    spec = importlib.util.spec_from_file_location('zgx_defaults', DEPLOY_DIR / 'update.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.BASE == Path('/home/puyo/genforecast')
    assert module.REPO == Path('/home/puyo/genforecast/repo')
    assert module.CURRENT == Path('/home/puyo/genforecast/current')
    assert module.SHARED_STATE == Path('/home/puyo/genforecast/shared')
    assert module.SHARED_DATA == Path('/home/puyo/genforecast-hp-20261012/backend/data')
    assert module.PY == Path('/home/puyo/miniforge3/envs/genforecast/bin/python')
    assert module.NODE_BIN == Path('/home/puyo/miniforge3/envs/genforecast-node/bin')
    moved = load(monkeypatch, tmp_path)
    assert moved.RELEASES == tmp_path / 'releases'
    assert moved.STATE == tmp_path / 'state'


@pytest.mark.parametrize('current, failed, ready, no_switch, retry, expected', [
    (NEW, None, None, False, False, 'up_to_date'),
    (NEW, NEW, None, False, True, 'up_to_date'),
    (OLD, NEW, None, False, False, 'skip_failed'),
    (OLD, NEW, None, False, True, 'prepare'),
    (OLD, OLD, None, False, False, 'prepare'),
    (None, None, None, False, False, 'prepare'),
    (OLD, None, 'rel', False, False, 'switch_ready'),
    (OLD, None, 'rel', True, False, 'already_prepared'),
    (OLD, None, None, True, False, 'prepare'),
])
def test_decide_action(upd, current, failed, ready, no_switch, retry, expected):
    assert upd.decide_action(NEW, current, failed, ready, no_switch=no_switch, retry=retry) == expected


def test_shared_links_only_untracked_files_and_keeps_wal_pairs(upd):
    names = ['planning.sqlite3', 'coal_units.csv.json', 'access.sqlite3', 'coal_units.csv',
             'vessel-discovery.sqlite3', 'vessel-discovery.sqlite3-wal', 'vessel-discovery.sqlite3-shm',
             '.DS_Store', 'planning-local.sqlite3']
    tracked = {'planning.sqlite3', 'coal_units.csv.json', 'nuclear_units.csv.json'}
    assert upd.shared_links(names, tracked) == [
        'access.sqlite3', 'coal_units.csv', 'planning-local.sqlite3', 'vessel-discovery.sqlite3',
        'vessel-discovery.sqlite3-shm', 'vessel-discovery.sqlite3-wal']


def test_release_name_is_sortable_utc_with_short_commit(upd):
    when = datetime(2026, 11, 9, 3, 4, 5, tzinfo=timezone.utc)
    assert upd.release_name(NEW, when) == '20261109T030405Z-bbbbbbbbbb'


def test_select_prune_keeps_current_previous_and_newest(upd):
    names = ['20261101T000000Z-1', '20261102T000000Z-2', '20261103T000000Z-3',
             '20261104T000000Z-4', '20261105T000000Z-5', '.pytest-20261105T000000Z-5', '.current.tmp']
    # 현재 + 이전 + 최신 1개 = 3개
    assert upd.select_prune(names, current='20261104T000000Z-4', previous='20261101T000000Z-1') == [
        '.pytest-20261105T000000Z-5', '20261102T000000Z-2', '20261103T000000Z-3']
    assert upd.select_prune(names, current='20261105T000000Z-5', previous=None) == [
        '.pytest-20261105T000000Z-5', '20261101T000000Z-1', '20261102T000000Z-2']
    assert upd.select_prune(['20261101T000000Z-1'], current='20261101T000000Z-1', previous=None) == []


def test_select_backup_prune_touches_only_auto_backups(upd):
    names = ['auto-20261101T000000Z', 'manual-before-openwaters', 'auto-20261103T000000Z',
             'auto-20261102T000000Z', 'auto-20261104T000000Z', '20261010-hp']
    assert upd.select_backup_prune(names) == ['auto-20261101T000000Z']


@pytest.mark.parametrize('expect, status, ok', [
    ('lt500', 401, True), ('lt500', 200, True), ('lt500', 404, True), ('lt500', 502, False),
    ('lt500', None, False), (200, 200, True), (200, 503, False), (200, None, False), (200, 401, False),
])
def test_health_ok(upd, expect, status, ok):
    assert upd.health_ok(expect, status) is ok


def test_health_targets_cover_three_services(upd):
    ports = sorted(url.split(':')[2].split('/')[0] for _, url, _ in upd.HEALTH_CHECKS)
    assert ports == ['61578', '8093', '8094']


def test_read_dependencies_includes_dev(upd):
    text = '''
[project]
name = "x"
dependencies = ["numpy>=2.0", "highspy==1.12.0"]
[project.optional-dependencies]
dev = ["pytest>=8.3", "httpx2==2.13.1"]
docs = ["sphinx"]
'''
    deps = upd.read_dependencies(text)
    assert deps == ['numpy>=2.0', 'highspy==1.12.0', 'pytest>=8.3', 'httpx2==2.13.1']


def test_read_dependencies_from_repository_pyproject(upd):
    deps = upd.read_dependencies((ROOT / 'backend/pyproject.toml').read_text(encoding='utf-8'))
    assert 'highspy==1.12.0' in deps and any(d.startswith('pytest') for d in deps)


def test_clean_env_drops_keys_and_db_paths_but_keeps_basics(upd):
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/home/puyo', 'LANG': 'C.UTF-8', 'TZ': 'Asia/Seoul',
           'AISSTREAM_API_KEY': 'secret', 'GFW_API_TOKEN': 'secret', 'OPENWATERS_API_TOKEN': 'secret',
           'OPENAI_API_KEY': 'secret', 'MIDTERM_SOURCE_DSN': 'postgres://u:p@h/db',
           'GENFORECAST_ACCESS_DB': '/live/access.sqlite3', 'AIS_TRACK_DB': '/live/tracks.sqlite3',
           'AIS_DISCOVERY_DB': '/live/d.sqlite3', 'MIDTERM_PLANNING_DB': '/live/p.sqlite3',
           'OPENWATERS_ENABLED': '1', 'GENFORECAST_ORIGINS': 'https://zgx', 'PYTHONPATH': '/live/src',
           'SOME_PASSWORD': 'x', 'https_proxy': 'http://proxy:3128'}
    clean = upd.clean_env(env, node_bin=Path('/opt/node/bin'))
    assert clean['PATH'] == f"{Path('/opt/node/bin')}{upd.os.pathsep}/usr/bin:/bin"
    assert clean['HOME'] == '/home/puyo' and clean['LANG'] == 'C.UTF-8' and clean['TZ'] == 'Asia/Seoul'
    assert clean['https_proxy'] == 'http://proxy:3128'
    for name in ('AISSTREAM_API_KEY', 'GFW_API_TOKEN', 'OPENWATERS_API_TOKEN', 'OPENAI_API_KEY',
                 'MIDTERM_SOURCE_DSN', 'GENFORECAST_ACCESS_DB', 'AIS_TRACK_DB', 'AIS_DISCOVERY_DB',
                 'MIDTERM_PLANNING_DB', 'OPENWATERS_ENABLED', 'GENFORECAST_ORIGINS', 'PYTHONPATH',
                 'SOME_PASSWORD'):
        assert name not in clean
    assert 'secret' not in repr(clean)
    assert upd.clean_env({}, node_bin=None)['PATH']


def test_rollback_plan(upd):
    assert upd.rollback_plan(Path('/r/old')) == 'restore'
    assert upd.rollback_plan(None) == 'remove'


def test_restart_command_matches_sudoers_rule_exactly(upd):
    rule = (DEPLOY_DIR / 'systemd/sudoers-genforecast').read_text(encoding='utf-8')
    lines = [line.strip() for line in rule.splitlines() if line.strip() and not line.startswith('#')]
    assert lines == ['puyo ALL=(root) NOPASSWD: ' + ' '.join(upd.RESTART_COMMAND[2:])]
    assert upd.RESTART_COMMAND[:2] == ['sudo', '-n']


def test_demo_unit_allows_zgx_origin_and_keeps_privileges_dropped():
    unit = (DEPLOY_DIR / 'systemd/genforecast-demo.service').read_text(encoding='utf-8')
    assert 'DEMO_ALLOWED_ORIGINS=https://zgx-6660.tailec6d33.ts.net' in unit
    assert 'NoNewPrivileges=true' in unit and 'User=puyo' in unit
    update_unit = (DEPLOY_DIR / 'systemd/genforecast-update.service').read_text(encoding='utf-8')
    settings = [line for line in update_unit.splitlines() if not line.startswith('#')]
    assert not any(line.startswith('NoNewPrivileges') for line in settings)
    assert 'TimeoutStartSec=40min' in settings
    assert '/home/puyo/genforecast/bin/update.py deploy' in update_unit


class Steps:
    """deploy()가 부르는 부작용 단계를 기록하는 가짜."""

    def __init__(self, upd, monkeypatch, *, current=OLD, ready=None, prepare_error=None,
                 health=(True,), previous_target='/base/releases/old'):
        self.calls = []
        self.health = list(health)
        self.current_rev = current
        self.target_path = Path(previous_target) if previous_target else None
        self.upd = upd
        upd.STATE.mkdir(parents=True, exist_ok=True)

        def prepare(sha):
            self.calls.append(('prepare', sha))
            if prepare_error:
                raise upd.StepError(prepare_error[0], step=prepare_error[1])
            return upd.RELEASES / 'new'

        def point(path):
            self.calls.append(('point', Path(path)))
            self.target_path = Path(path)

        def remove_current():
            self.calls.append(('remove_current',))
            self.target_path = None

        def healthy():
            self.calls.append(('health',))
            return self.health.pop(0) if self.health else True

        replacements = {
            'update_lock': lambda: contextlib.nullcontext(True),
            'fetch_target': lambda: NEW,
            'current_revision': lambda: self.current_rev,
            'current_target': lambda: self.target_path,
            'find_ready_release': lambda sha: Path(ready) if ready else None,
            'prepare_release': prepare,
            'backup_data': lambda: self.calls.append(('backup',)),
            'point_current': point,
            'remove_current': remove_current,
            'restart_services': lambda: self.calls.append(('restart',)),
            'wait_healthy': healthy,
            'prune_releases': lambda: self.calls.append(('prune',)),
            'self_update': lambda release: self.calls.append(('self_update', release)),
            'revision_of': lambda path: OLD,
        }
        for name, value in replacements.items():
            monkeypatch.setattr(upd, name, value)

    def names(self):
        return [call[0] for call in self.calls]


def test_deploy_test_failure_never_switches_and_records_failure(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, prepare_error=('종료 코드 1', '백엔드 시험'))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare']
    assert upd.read_state('failed') == NEW


@pytest.mark.parametrize('step', ['git fetch', 'git archive', 'venv 생성', 'pip install', 'npm ci', '공유 데이터 연결'])
def test_transient_prepare_failure_is_retried_next_cycle(upd, monkeypatch, step):
    steps = Steps(upd, monkeypatch, prepare_error=('네트워크 오류', step))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare']
    assert upd.read_state('failed') is None


def test_unexpected_os_error_in_prepare_is_retried(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken(sha):
        steps.calls.append(('prepare', sha))
        raise OSError(28, 'No space left on device')
    monkeypatch.setattr(upd, 'prepare_release', broken)
    assert upd.deploy() == 1
    assert upd.read_state('failed') is None


def test_fetch_failure_is_not_recorded(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_fetch():
        raise upd.StepError('연결 실패', step='git fetch')
    monkeypatch.setattr(upd, 'fetch_target', broken_fetch)
    assert upd.deploy() == 1 and steps.calls == []
    assert upd.read_state('failed') is None


@pytest.mark.parametrize('step, recorded', [
    ('백엔드 시험', True), ('npm test', True), ('npm run build', True),
    ('git fetch', False), ('git archive', False), ('pip install', False), ('npm ci', False),
    ('venv 생성', False), ('공유 데이터 연결', False), ('', False),
])
def test_should_record_failure(upd, step, recorded):
    assert upd.should_record_failure(step) is recorded


def test_deploy_health_failure_rolls_back_to_previous(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, health=(False, True))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'point', 'restart', 'health',
                             'point', 'restart', 'health']
    assert steps.calls[2][1] == upd.RELEASES / 'new'
    assert steps.calls[5][1] == Path('/base/releases/old')
    assert upd.read_state('failed') == NEW


def test_deploy_restart_error_also_rolls_back(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_restart():
        steps.calls.append(('restart',))
        if len([c for c in steps.calls if c[0] == 'restart']) == 1:
            raise upd.StepError('재시작 실패')
    monkeypatch.setattr(upd, 'restart_services', broken_restart)
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'point', 'restart', 'point', 'restart', 'health']
    assert upd.read_state('failed') == NEW


def test_first_deploy_failure_without_previous_removes_current(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=None, previous_target=None, health=(False,))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'point', 'restart', 'health', 'remove_current']
    assert upd.read_state('failed') == NEW


def test_deploy_success_clears_failure_prunes_and_updates_itself(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    upd.write_state('failed', OLD)
    assert upd.deploy() == 0
    assert steps.names() == ['prepare', 'backup', 'point', 'restart', 'health', 'prune', 'self_update']
    assert upd.read_state('failed') is None
    assert upd.read_state('previous') == str(Path('/base/releases/old'))


def test_backup_failure_aborts_before_switch_without_blaming_commit(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_backup():
        steps.calls.append(('backup',))
        raise upd.StepError('백업 실패')
    monkeypatch.setattr(upd, 'backup_data', broken_backup)
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup']
    assert upd.read_state('failed') is None


def test_deploy_skips_same_and_failed_commits(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW)
    assert upd.deploy() == 0 and steps.calls == []
    steps = Steps(upd, monkeypatch, current=OLD)
    upd.write_state('failed', NEW)
    assert upd.deploy() == 0 and steps.calls == []
    assert upd.deploy(retry=True) == 0 and steps.names()[0] == 'prepare'


def test_no_switch_prepares_only_and_prepared_release_is_reused(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    assert upd.deploy(no_switch=True) == 0
    assert steps.names() == ['prepare']
    steps = Steps(upd, monkeypatch, ready='/base/releases/ready')
    assert upd.deploy() == 0
    assert steps.names() == ['backup', 'point', 'restart', 'health', 'prune', 'self_update']
    assert steps.calls[1][1] == Path('/base/releases/ready')


def test_busy_lock_exits_quietly(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    monkeypatch.setattr(upd, 'update_lock', lambda: contextlib.nullcontext(False))
    assert upd.deploy() == 0 and steps.calls == []


def test_manual_rollback_restores_previous_and_blocks_redeploy(upd, monkeypatch, tmp_path):
    old = tmp_path / 'releases/old'
    old.mkdir(parents=True)
    steps = Steps(upd, monkeypatch, current=NEW, previous_target=str(tmp_path / 'releases/new'))
    upd.write_state('previous', str(old))
    assert upd.rollback() == 0
    assert steps.names() == ['point', 'restart', 'health']
    assert steps.calls[0][1] == old
    assert upd.read_state('failed') == NEW
    assert upd.read_state('previous') == str(tmp_path / 'releases/new')


def test_manual_rollback_without_previous_fails_safely(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    assert upd.rollback() == 1
    assert steps.calls == []


def symlinks_supported(tmp_path):
    probe = tmp_path / 'probe-link'
    try:
        probe.symlink_to(tmp_path)
    except (OSError, NotImplementedError):
        return False
    probe.unlink()
    return True


def test_point_current_and_shared_links_on_real_files(upd, monkeypatch, tmp_path):
    if not symlinks_supported(tmp_path):
        pytest.skip('이 OS 계정은 심볼릭 링크를 만들 수 없다(ZGX에서는 실행된다).')
    shared = upd.SHARED_DATA
    shared.mkdir(parents=True)
    for name in ('planning.sqlite3', 'planning-local.sqlite3', 'coal_units.csv'):
        (shared / name).write_text(name)
    (shared / 'subdir').mkdir()
    releases = []
    for index, sha in enumerate((OLD, NEW)):
        release = upd.RELEASES / f'2026110{index}T000000Z-{sha[:10]}'
        (release / 'backend/data').mkdir(parents=True)
        (release / 'REVISION').write_text(sha + '\n')
        (release / 'backend/data/planning.sqlite3').write_text('seed')
        releases.append(release)
    (releases[1] / 'backend/data/planning-local.sqlite3').write_text('test by-product')
    monkeypatch.setattr(upd, 'git', lambda *args, **kw: 'backend/data/planning.sqlite3\0')
    upd.link_shared_data(releases[1], NEW)
    data = releases[1] / 'backend/data'
    assert not (data / 'planning.sqlite3').is_symlink()
    assert (data / 'planning-local.sqlite3').read_text() == 'planning-local.sqlite3'
    assert (data / 'coal_units.csv').is_symlink() and not (data / 'subdir').exists()
    upd.point_current(releases[0])
    upd.point_current(releases[1])
    assert upd.current_target() == releases[1] and upd.current_revision() == NEW
    assert upd.find_ready_release(NEW) is None
    (releases[1] / '.ready').write_text(NEW)
    assert upd.find_ready_release(NEW) == releases[1]


def test_backup_copies_sqlite_and_keeps_three_auto_backups(upd, monkeypatch):
    import sqlite3
    upd.SHARED_DATA.mkdir(parents=True)
    db = sqlite3.connect(upd.SHARED_DATA / 'access.sqlite3')
    db.execute('pragma journal_mode=wal')
    db.execute('create table t(x)')
    db.execute('insert into t values (42)')
    db.commit()
    (upd.SHARED_DATA / 'coal_units.csv').write_text('not a db')
    for stamp in ('20261101T000000Z', '20261102T000000Z', '20261103T000000Z'):
        (upd.BACKUPS / f'auto-{stamp}').mkdir(parents=True)
    (upd.BACKUPS / 'manual-keep').mkdir()
    upd.backup_data()
    db.close()
    names = sorted(p.name for p in upd.BACKUPS.iterdir())
    assert 'manual-keep' in names and 'auto-20261101T000000Z' not in names
    newest = upd.BACKUPS / sorted(n for n in names if n.startswith('auto-'))[-1]
    assert sorted(p.name for p in newest.iterdir()) == ['access.sqlite3']
    copy = sqlite3.connect(newest / 'access.sqlite3')
    assert copy.execute('select x from t').fetchall() == [(42,)]
    copy.close()


def test_self_update_replaces_installed_updater_only_when_changed(upd, tmp_path):
    release = tmp_path / 'rel'
    source = release / upd.UPDATER_IN_REPO
    source.parent.mkdir(parents=True)
    source.write_text('print("v2")\n')
    upd.BIN.mkdir(parents=True)
    (upd.BIN / 'update.py').write_text('print("v1")\n')
    upd.self_update(release)
    assert (upd.BIN / 'update.py').read_text() == 'print("v2")\n'
    source.write_text('def broken(:\n')
    upd.self_update(release)
    assert (upd.BIN / 'update.py').read_text() == 'print("v2")\n'


def test_shared_dir_sync_plan_keeps_only_tracked_runs_and_inputs(upd):
    tracked = ['backend/runs/20261004-111057-2027기본/summary.json',
               'backend/runs/20261004-111057-2027기본/hourly.npz',
               'backend/inputs/coal_oh_2027.csv.json', 'backend/inputs/ranking_oh.json',
               'backend/data/planning.sqlite3', 'backend/src/midterm/x.py',
               'backend/runs/../data/evil', 'backend/inputs/', '']
    assert upd.shared_dir_sync_plan(tracked) == [
        'inputs/coal_oh_2027.csv.json', 'inputs/ranking_oh.json',
        'runs/20261004-111057-2027기본/hourly.npz', 'runs/20261004-111057-2027기본/summary.json']


def test_seed_plan_never_overwrites_shared_files(upd):
    old = ['runs/20261108-062643-011503-2027가상입력/summary.json', 'inputs/last_scenario.json',
           'inputs/coal_oh_2027.csv', 'inputs/ranking_oh.json', 'models/x.txt', 'runs/../x']
    shared = {'inputs/ranking_oh.json'}
    assert upd.seed_plan(old, shared) == [
        'inputs/coal_oh_2027.csv', 'inputs/last_scenario.json',
        'runs/20261108-062643-011503-2027가상입력/summary.json']


def test_seed_shared_copies_old_runtime_state_without_overwriting(upd, tmp_path):
    old = tmp_path / 'old/backend'
    (old / 'runs/20261108-zgx').mkdir(parents=True)
    (old / 'runs/20261108-zgx/summary.json').write_text('zgx run')
    (old / 'inputs').mkdir()
    (old / 'inputs/last_scenario.json').write_text('old scenario')
    (old / 'inputs/ranking_oh.json').write_text('old ranking')
    (upd.SHARED_STATE / 'inputs').mkdir(parents=True)
    (upd.SHARED_STATE / 'inputs/ranking_oh.json').write_text('repo ranking')
    assert upd.seed_shared(old) == 0
    assert (upd.SHARED_STATE / 'runs/20261108-zgx/summary.json').read_text() == 'zgx run'
    assert (upd.SHARED_STATE / 'inputs/last_scenario.json').read_text() == 'old scenario'
    assert (upd.SHARED_STATE / 'inputs/ranking_oh.json').read_text() == 'repo ranking'
    assert (old / 'inputs/ranking_oh.json').read_text() == 'old ranking'
    assert upd.seed_shared(old) == 0  # 다시 실행해도 안전
    assert upd.seed_shared(tmp_path / 'missing') == 1


def test_shared_runs_inputs_are_synced_and_linked(upd, monkeypatch, tmp_path):
    if not symlinks_supported(tmp_path):
        pytest.skip('이 OS 계정은 심볼릭 링크를 만들 수 없다(ZGX에서는 실행된다).')
    shared = upd.SHARED_STATE
    (shared / 'runs/20261108-zgx').mkdir(parents=True)
    (shared / 'runs/20261108-zgx/summary.json').write_text('zgx run')
    (shared / 'inputs').mkdir()
    (shared / 'inputs/ranking_oh.json').write_text('stale')
    (shared / 'inputs/last_scenario.json').write_text('runtime')
    release = upd.RELEASES / 'rel'
    (release / 'backend/runs/20261004-base').mkdir(parents=True)
    (release / 'backend/runs/20261004-base/summary.json').write_text('repo run')
    (release / 'backend/inputs').mkdir()
    (release / 'backend/inputs/ranking_oh.json').write_text('repo ranking')
    listed = '\0'.join(['backend/runs/20261004-base/summary.json', 'backend/inputs/ranking_oh.json']) + '\0'
    monkeypatch.setattr(upd, 'git', lambda *args, **kw: listed)
    upd.link_shared_dirs(release, NEW)
    assert (shared / 'runs/20261004-base/summary.json').read_text() == 'repo run'
    assert (shared / 'runs/20261108-zgx/summary.json').read_text() == 'zgx run'
    assert (shared / 'inputs/ranking_oh.json').read_text() == 'repo ranking'
    assert (shared / 'inputs/last_scenario.json').read_text() == 'runtime'
    for name in ('runs', 'inputs'):
        link = release / 'backend' / name
        assert link.is_symlink() and link.resolve() == (shared / name).resolve()
    assert (release / 'backend/runs/20261108-zgx/summary.json').read_text() == 'zgx run'
    upd.link_shared_dirs(release, NEW)  # 다시 실행해도 안전
    assert (release / 'backend/runs').is_symlink()


def test_select_node_modules_prune_spares_current_and_previous(upd):
    names = ['20261101T000000Z-1', '20261102T000000Z-2', '20261103T000000Z-3', '.pytest-x']
    assert upd.select_node_modules_prune(names, current='20261103T000000Z-3',
                                         previous='20261102T000000Z-2') == ['20261101T000000Z-1']
    assert upd.select_node_modules_prune(names, current='20261103T000000Z-3', previous=None) == [
        '20261101T000000Z-1', '20261102T000000Z-2']


def test_release_python_is_per_release_venv(upd):
    assert upd.venv_python(Path('/r/rel')) == Path('/r/rel/.venv/bin/python')


def test_dropins_run_services_from_current_release_venv():
    py = '/home/puyo/genforecast/current/.venv/bin/python'
    for name, command in (
            ('backend-current.conf', f'{py} -m midterm serve --host 127.0.0.1 --port 8093'),
            ('frontend-current.conf',
             f'{py} -m uvicorn midterm.web.frontend:app --host 127.0.0.1 --port 8094 --no-access-log')):
        lines = [line for line in (DEPLOY_DIR / 'systemd' / name).read_text(encoding='utf-8').splitlines()
                 if line.startswith('ExecStart')]
        assert lines == ['ExecStart=', f'ExecStart={command}'], name
