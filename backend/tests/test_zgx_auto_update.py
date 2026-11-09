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
    assert 'TimeoutStartSec=120min' in settings
    assert '/home/puyo/genforecast/bin/update.py deploy' in update_unit


class Steps:
    """deploy()가 부르는 부작용 단계를 기록하는 가짜."""

    def __init__(self, upd, monkeypatch, *, current=OLD, ready=None, prepare_error=None,
                 health=(True,), previous_target='/base/releases/old', ci='pass'):
        self.calls = []
        self.health = list(health)
        self.current_rev = current
        self.target_path = Path(previous_target) if previous_target else None
        self.ci = ci
        self.upd = upd
        self.marker_seen = []
        upd.STATE.mkdir(parents=True, exist_ok=True)

        def prepare(sha):
            self.calls.append(('prepare', sha))
            if prepare_error:
                raise upd.StepError(prepare_error[0], step=prepare_error[1])
            return upd.RELEASES / 'new'

        def point(path):
            self.calls.append(('point', Path(path)))
            self.marker_seen.append((upd.STATE / 'activating').is_file())
            self.target_path = Path(path)

        def remove_current():
            self.calls.append(('remove_current',))
            self.target_path = None

        def healthy():
            self.calls.append(('health',))
            return self.health.pop(0) if self.health else True

        def backup():
            self.calls.append(('backup',))
            return Path('/backups/auto-20261109T000000Z')

        replacements = {
            'update_lock': lambda: contextlib.nullcontext(True),
            'fetch_target': lambda: NEW,
            'ci_status': lambda sha: self.ci,
            'current_revision': lambda: self.current_rev,
            'current_target': lambda: self.target_path,
            'find_ready_release': lambda sha: Path(ready) if ready else None,
            'prepare_release': prepare,
            'backup_data': backup,
            'link_shared_dirs': lambda release, sha: self.calls.append(('link_dirs',)),
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


SWITCH = ['backup', 'link_dirs', 'point', 'restart', 'health']


def test_deploy_test_failure_never_switches_and_records_failure(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, prepare_error=('종료 코드 1', '백엔드 시험'))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'prune']
    assert upd.read_state('failed') == NEW
    result = upd.read_result()
    assert (result['commit'], result['result'], result['step']) == (NEW, 'test_failed', '백엔드 시험')


@pytest.mark.parametrize('step', ['git archive', 'venv 생성', 'pip install', 'npm ci', '공유 데이터 연결'])
def test_transient_prepare_failure_is_retried_next_cycle(upd, monkeypatch, step):
    steps = Steps(upd, monkeypatch, prepare_error=('네트워크 오류', step))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'prune']
    assert upd.read_state('failed') is None
    assert upd.read_result()['result'] == 'retry_later'


def test_transient_failures_are_capped_at_three_retries_per_commit(upd, monkeypatch):
    Steps(upd, monkeypatch, prepare_error=('ETIMEDOUT', 'npm ci'))
    for _ in range(3):
        assert upd.deploy() == 1
        assert upd.read_state('failed') is None
    assert upd.deploy() == 1
    assert upd.read_state('failed') == NEW
    assert upd.read_result()['result'] == 'retry_exhausted'


@pytest.mark.parametrize('state, sha, expected', [
    ({}, NEW, ({'commit': NEW, 'count': 1}, False)),
    ({'commit': NEW, 'count': 3}, NEW, ({'commit': NEW, 'count': 4}, True)),
    ({'commit': NEW, 'count': 2}, NEW, ({'commit': NEW, 'count': 3}, False)),
    ({'commit': OLD, 'count': 9}, NEW, ({'commit': NEW, 'count': 1}, False)),
])
def test_bump_retry(upd, state, sha, expected):
    assert upd.bump_retry(state, sha) == expected


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
    ('백엔드 시험', True), ('npm test', True), ('npm run build', True), ('pyproject', True),
    ('git fetch', False), ('git archive', False), ('pip install', False), ('npm ci', False),
    ('venv 생성', False), ('공유 데이터 연결', False), ('', False),
])
def test_should_record_failure(upd, step, recorded):
    assert upd.should_record_failure(step) is recorded


def test_broken_pyproject_is_a_recorded_failure(upd):
    with pytest.raises(upd.StepError) as caught:
        upd.read_dependencies('[project\nname = ')
    assert caught.value.step == 'pyproject' and upd.should_record_failure(caught.value.step)
    with pytest.raises(upd.StepError):
        upd.read_dependencies('[tool.x]\na = 1\n')


def test_ci_pending_waits_without_blaming_commit(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, ci='pending')
    assert upd.deploy() == upd.EXIT_WAITING
    assert steps.calls == [] and upd.read_state('failed') is None
    assert upd.read_result()['result'] == 'waiting_ci'


def test_ci_failure_records_commit_without_building(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, ci='fail')
    assert upd.deploy() == 1
    assert steps.calls == [] and upd.read_state('failed') == NEW
    assert upd.read_result()['result'] == 'ci_failed'


def run(name, status='completed', conclusion='success', id=1, app='github-actions'):
    return {'name': name, 'status': status, 'conclusion': conclusion, 'id': id, 'app': {'slug': app}}


@pytest.mark.parametrize('runs, expected', [
    ([run('verify'), run('backend')], 'pass'),
    ([run('verify'), run('backend'), run('lint', conclusion='failure')], 'pass'),
    ([run('verify')], 'pending'),
    ([], 'pending'),
    ([run('verify'), run('backend', status='in_progress', conclusion=None)], 'pending'),
    ([run('verify'), run('backend', conclusion='failure')], 'fail'),
    ([run('verify', conclusion='cancelled'), run('backend', status='queued', conclusion=None)], 'fail'),
    ([run('verify'), run('backend', conclusion='failure', id=1), run('backend', id=2)], 'pass'),
    ([run('verify'), run('backend', id=3, conclusion='timed_out'), run('backend', id=2)], 'fail'),
    ([run('verify'), run('backend', conclusion='skipped')], 'pending'),
    # GitHub Actions가 만든 검사만 센다. 다른 앱이 같은 이름으로 올린 결과는 무시한다.
    ([run('verify', app='someone-else'), run('backend')], 'pending'),
    ([run('verify', conclusion='failure'), run('verify', app='someone-else', id=9), run('backend')], 'fail'),
    ([run('verify'), run('backend'), run('backend', conclusion='failure', id=5, app='other-app')], 'pass'),
    ([{'name': 'verify', 'status': 'completed', 'conclusion': 'success', 'id': 1}, run('backend')], 'pending'),
])
def test_ci_verdict(upd, runs, expected):
    assert upd.ci_verdict({'total_count': len(runs), 'check_runs': runs}) == expected


def test_ci_verdict_tolerates_garbage(upd):
    assert upd.ci_verdict(None) == 'pending'
    assert upd.ci_verdict({'check_runs': 'x'}) == 'pending'


def test_ci_status_network_error_is_pending(upd, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError('network down')
    monkeypatch.setattr(upd, 'urlopen', boom)
    assert upd.ci_status(NEW) == 'pending'


def test_deploy_health_failure_rolls_back_to_previous(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, health=(False, True))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', *SWITCH, 'point', 'restart', 'health', 'prune']
    assert steps.calls[3][1] == upd.RELEASES / 'new'
    assert steps.calls[6][1] == Path('/base/releases/old')
    assert upd.read_state('failed') == NEW
    assert not (upd.STATE / 'activating').exists()
    assert upd.read_result()['result'] == 'rolled_back'


def test_activating_marker_exists_while_switching(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    assert upd.deploy() == 0
    assert steps.marker_seen == [True]
    assert not (upd.STATE / 'activating').exists()


def test_rollback_health_failure_points_to_backup(upd, monkeypatch, capsys):
    Steps(upd, monkeypatch, health=(False, False))
    assert upd.deploy() == 1
    result = upd.read_result()
    assert result['result'] == 'rollback_unhealthy'
    assert result['backup'] == str(Path('/backups/auto-20261109T000000Z'))
    assert str(Path('/backups/auto-20261109T000000Z')) in capsys.readouterr().out


def test_deploy_restart_error_also_rolls_back(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_restart():
        steps.calls.append(('restart',))
        if len([c for c in steps.calls if c[0] == 'restart']) == 1:
            raise upd.StepError('재시작 실패')
    monkeypatch.setattr(upd, 'restart_services', broken_restart)
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'link_dirs', 'point', 'restart',
                             'point', 'restart', 'health', 'prune']
    assert upd.read_state('failed') == NEW


def test_first_deploy_failure_without_previous_removes_current(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=None, previous_target=None, health=(False,))
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', *SWITCH, 'remove_current', 'prune']
    assert upd.read_state('failed') == NEW


def test_deploy_success_clears_failure_prunes_and_updates_itself(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    upd.write_state('failed', OLD)
    upd.write_json('retries.json', {'commit': NEW, 'count': 2})
    assert upd.deploy() == 0
    assert steps.names() == ['prepare', *SWITCH, 'self_update', 'prune']
    assert upd.read_state('failed') is None
    assert upd.read_json('retries.json') is None
    assert upd.read_state('previous') == str(Path('/base/releases/old'))
    assert upd.read_result()['result'] == 'deployed'


def test_backup_failure_aborts_before_switch_without_blaming_commit(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_backup():
        steps.calls.append(('backup',))
        raise upd.StepError('백업 실패', step='백업')
    monkeypatch.setattr(upd, 'backup_data', broken_backup)
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'prune']
    assert upd.read_state('failed') is None


def test_shared_dir_link_failure_aborts_before_switch(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)

    def broken_link(release, sha):
        steps.calls.append(('link_dirs',))
        raise upd.StepError('폴더 충돌', step='공유 데이터 연결')
    monkeypatch.setattr(upd, 'link_shared_dirs', broken_link)
    assert upd.deploy() == 1
    assert steps.names() == ['prepare', 'backup', 'link_dirs', 'prune']
    assert upd.read_state('failed') is None


def test_deploy_skips_same_and_failed_commits(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW)
    assert upd.deploy() == 0 and steps.calls == []
    steps = Steps(upd, monkeypatch, current=OLD)
    upd.write_state('failed', NEW)
    assert upd.deploy() == 0 and steps.calls == []
    assert upd.deploy(retry=True) == 0 and steps.names()[0] == 'prepare'


def test_no_switch_prepares_only_without_touching_shared_dirs(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    assert upd.deploy(no_switch=True) == 0
    assert steps.names() == ['prepare', 'prune']
    assert upd.read_result()['result'] == 'prepared'
    steps = Steps(upd, monkeypatch, ready='/base/releases/ready')
    assert upd.deploy() == 0
    assert steps.names() == [*SWITCH, 'self_update', 'prune']
    assert steps.calls[2][1] == Path('/base/releases/ready')


def test_busy_lock_exits_with_75(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    monkeypatch.setattr(upd, 'update_lock', lambda: contextlib.nullcontext(False))
    assert upd.deploy() == 75 and steps.calls == []
    assert upd.EXIT_LOCKED == 75


def test_interrupted_switch_unhealthy_is_rolled_back_first(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW, previous_target='/base/releases/new', health=(False, True))
    upd.write_json('activating', {'previous': '/base/releases/old', 'target': '/base/releases/new',
                                  'commit': NEW, 'at': '2026-11-09T00:00:00Z'})
    assert upd.deploy() == 1
    assert steps.names() == ['restart', 'health', 'point', 'restart', 'health', 'prune']
    assert steps.calls[2][1] == Path('/base/releases/old')
    assert upd.read_state('failed') == NEW
    assert not (upd.STATE / 'activating').exists()
    assert upd.read_result()['result'] == 'recovered_interrupted'


def test_interrupted_switch_without_previous_removes_current(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW, health=(False,))
    upd.write_json('activating', {'previous': None, 'target': '/base/releases/new', 'commit': NEW, 'at': 'x'})
    assert upd.deploy() == 1
    assert steps.names() == ['restart', 'health', 'remove_current', 'prune']
    assert upd.read_state('failed') == NEW


def test_interrupted_switch_healthy_is_accepted_and_run_continues(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW)
    upd.write_json('activating', {'previous': '/base/releases/old', 'target': '/base/releases/new',
                                  'commit': NEW, 'at': 'x'})
    assert upd.deploy() == 0
    assert steps.names() == ['restart', 'health']
    assert not (upd.STATE / 'activating').exists()
    assert upd.read_state('failed') is None


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
    assert upd.read_result()['result'] == 'manual_rollback'


def test_manual_rollback_without_previous_fails_safely(upd, monkeypatch):
    steps = Steps(upd, monkeypatch)
    assert upd.rollback() == 1
    assert steps.calls == []


@pytest.mark.parametrize('statuses, ok, warnings', [
    ({'백엔드': 401, '화면': 200, '데모': 200}, True, []),
    ({'백엔드': 401, '화면': 200, '데모': None}, True, ['데모']),
    ({'백엔드': 502, '화면': 200, '데모': 200}, False, []),
    ({'백엔드': 401, '화면': 503, '데모': None}, False, ['데모']),
])
def test_judge_health_only_backend_and_frontend_decide(upd, statuses, ok, warnings):
    assert upd.judge_health(statuses) == (ok, warnings)


def test_wait_healthy_needs_two_consecutive_passes(upd, monkeypatch):
    answers = iter([True, False, True, True])
    sleeps = []
    monkeypatch.setattr(upd, 'check_health_once', lambda: next(answers))
    monkeypatch.setattr(upd.time, 'sleep', lambda s: sleeps.append(s))
    assert upd.wait_healthy(wait=600) is True
    assert sleeps.count(upd.HEALTH_CONFIRM_GAP) == 2


def test_wait_healthy_gives_up_after_deadline(upd, monkeypatch):
    clock = iter(range(0, 10000, 5))
    monkeypatch.setattr(upd.time, 'monotonic', lambda: next(clock))
    monkeypatch.setattr(upd.time, 'sleep', lambda s: None)
    monkeypatch.setattr(upd, 'check_health_once', lambda: False)
    assert upd.wait_healthy(wait=60) is False


def test_step_timeouts_fit_inside_service_timeout(upd):
    unit = (DEPLOY_DIR / 'systemd/genforecast-update.service').read_text(encoding='utf-8')
    assert 'TimeoutStartSec=120min' in unit.splitlines()
    # 데이터 백업과, 중단 복구(재시작·상태 확인) 뒤 이어지는 전환까지 넣은 최악의 합계.
    assert upd.TIMEOUT['backup'] == 600 and upd.STEP_CALLS['backup'] == 1
    assert upd.STEP_CALLS['restart'] >= 3
    assert upd.worst_case_seconds() + 5 * 60 <= 120 * 60


def test_update_unit_hides_key_files_and_accepts_wait_codes():
    lines = (DEPLOY_DIR / 'systemd/genforecast-update.service').read_text(encoding='utf-8').splitlines()
    assert 'InaccessiblePaths=-/home/puyo/.config/genforecast/backend.env' in lines
    assert 'InaccessiblePaths=-/home/puyo/.config/genforecast/demo.env' in lines
    assert 'SuccessExitStatus=75 76' in lines
    timer = (DEPLOY_DIR / 'systemd/genforecast-update.timer').read_text(encoding='utf-8')
    assert 'Persistent' not in timer
    demo = (DEPLOY_DIR / 'systemd/genforecast-demo.service').read_text(encoding='utf-8').splitlines()
    assert 'EnvironmentFile=-/home/puyo/.config/genforecast/demo.env' in demo


def test_prepare_installs_all_dependencies_before_tests(upd, monkeypatch):
    order = []
    monkeypatch.setattr(upd, 'extract', lambda sha, dest: (order.append('extract'), dest.mkdir(parents=True)))
    monkeypatch.setattr(upd, 'ensure_python_deps', lambda release: order.append('python_deps'))
    monkeypatch.setattr(upd, 'install_frontend', lambda dest: order.append('npm_ci'))
    monkeypatch.setattr(upd, 'run_backend_tests', lambda sha, name, python: order.append('pytest'))
    monkeypatch.setattr(upd, 'build_frontend', lambda dest: order.append('frontend'))
    monkeypatch.setattr(upd, 'link_shared_data', lambda dest, sha: order.append('link_data'))
    release = upd.prepare_release(NEW)
    assert order == ['extract', 'python_deps', 'npm_ci', 'pytest', 'frontend', 'link_data']
    assert (release / '.ready').is_file()


def test_status_prints_last_result(upd, monkeypatch, capsys):
    monkeypatch.setattr(upd, 'git', lambda *a, **k: NEW + '\n')
    upd.write_result(NEW, 'deployed', step='', message='반영 완료')
    assert upd.status() == 0
    out = capsys.readouterr().out
    assert 'deployed' in out and NEW[:10] in out


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
    assert sorted(p.name for p in newest.iterdir()) == [upd.BACKUP_DONE, 'access.sqlite3']
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


def test_seed_shared_runs_only_once(upd, tmp_path):
    old = tmp_path / 'old/backend'
    (old / 'runs/a').mkdir(parents=True)
    (old / 'runs/a/summary.json').write_text('a')
    assert upd.seed_shared(old) == 0
    (old / 'runs/b').mkdir()
    (old / 'runs/b/summary.json').write_text('b')
    assert upd.seed_shared(old) == 0
    assert (upd.SHARED_STATE / 'runs/a/summary.json').is_file()
    assert not (upd.SHARED_STATE / 'runs/b').exists()
    assert (upd.SHARED_STATE / '.seeded').is_file()


def test_self_update_reverts_when_new_updater_cannot_run_status(upd, tmp_path):
    release = tmp_path / 'rel'
    source = release / upd.UPDATER_IN_REPO
    source.parent.mkdir(parents=True)
    upd.BIN.mkdir(parents=True)
    (upd.BIN / 'update.py').write_text('print("v1")\n')
    source.write_text('import sys\nsys.exit(3)\n')
    upd.self_update(release)
    assert (upd.BIN / 'update.py').read_text() == 'print("v1")\n'
    source.write_text('print("v2")\n')
    upd.self_update(release)
    assert (upd.BIN / 'update.py').read_text() == 'print("v2")\n'
    assert (upd.BIN / 'update.py.prev').read_text() == 'print("v1")\n'


def test_node_modules_of_not_yet_activated_releases_are_kept(upd):
    names = ['20261101T000000Z-1', '20261102T000000Z-2', '20261103T000000Z-3']
    assert upd.select_node_modules_prune(names, current='20261102T000000Z-2', previous=None) == ['20261101T000000Z-1']
    assert upd.select_node_modules_prune(names, current=None, previous=None) == []


def test_successful_retry_clears_failure_record(upd, monkeypatch):
    Steps(upd, monkeypatch)
    upd.write_state('failed', NEW)
    upd.write_json('retries.json', {'commit': NEW, 'count': 4})
    assert upd.deploy(no_switch=True, retry=True) == 0
    assert upd.read_state('failed') is None
    assert upd.read_json('retries.json') is None
    assert upd.deploy() == 0  # 실패 기록이 없으니 준비된 릴리스로 진행한다(가짜 단계에서는 다시 prepare)


def test_switch_step_transient_failures_are_capped_too(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, ready='/base/releases/ready')

    def broken_backup():
        steps.calls.append(('backup',))
        raise upd.StepError('데이터 백업 실패(OperationalError)', step='백업')
    monkeypatch.setattr(upd, 'backup_data', broken_backup)
    for count in (1, 2, 3):
        assert upd.deploy() == 1
        assert upd.read_state('failed') is None
        assert upd.read_json('retries.json') == {'commit': NEW, 'count': count}
    assert upd.deploy() == 1
    assert upd.read_state('failed') == NEW
    assert upd.read_result()['result'] == 'retry_exhausted'


def test_retry_flag_resets_retry_count_of_that_commit(upd, monkeypatch):
    Steps(upd, monkeypatch, prepare_error=('ETIMEDOUT', 'npm ci'))
    upd.write_state('failed', NEW)
    upd.write_json('retries.json', {'commit': NEW, 'count': 4})
    assert upd.deploy(retry=True) == 1
    assert upd.read_json('retries.json') == {'commit': NEW, 'count': 1}
    assert upd.read_result()['result'] == 'retry_later'


def test_interrupted_switch_restart_error_counts_as_unhealthy(upd, monkeypatch):
    steps = Steps(upd, monkeypatch, current=NEW, previous_target='/base/releases/new', health=(True,))

    def restart():
        steps.calls.append(('restart',))
        if steps.names().count('restart') == 1:
            raise upd.StepError('재시작 실패')
    monkeypatch.setattr(upd, 'restart_services', restart)
    upd.write_json('activating', {'previous': '/base/releases/old', 'target': '/base/releases/new',
                                  'commit': NEW, 'at': 'x'})
    assert upd.deploy() == 1
    assert steps.names() == ['restart', 'point', 'restart', 'health', 'prune']
    assert upd.read_state('failed') == NEW


def _make_db(path, value=1):
    import sqlite3
    db = sqlite3.connect(path)
    db.execute('create table t(x)')
    db.execute('insert into t values (?)', (value,))
    db.commit()
    db.close()


def test_backup_timeout_is_a_step_error_and_leaves_no_partial_backup(upd, monkeypatch):
    upd.SHARED_DATA.mkdir(parents=True)
    _make_db(upd.SHARED_DATA / 'access.sqlite3')
    clock = iter([0] + [10_000] * 50)
    monkeypatch.setattr(upd.time, 'monotonic', lambda: next(clock))
    with pytest.raises(upd.StepError) as error:
        upd.backup_data()
    assert error.value.step == '백업'
    assert not upd.should_record_failure(error.value.step)
    assert not upd.BACKUPS.exists() or not any(upd.BACKUPS.iterdir())


def test_backup_failure_removes_partial_folder_and_latest_needs_completion_mark(upd):
    upd.SHARED_DATA.mkdir(parents=True)
    _make_db(upd.SHARED_DATA / 'access.sqlite3')
    (upd.SHARED_DATA / 'zz-broken.sqlite3').write_bytes(b'not a database at all' * 100)
    done = upd.BACKUPS / 'auto-20261102T000000Z'
    done.mkdir(parents=True)
    (done / upd.BACKUP_DONE).write_text('ok')
    (upd.BACKUPS / 'auto-20261103T000000Z').mkdir()  # 완료 표시가 없는 옛 백업
    with pytest.raises(upd.StepError):
        upd.backup_data()
    assert sorted(p.name for p in upd.BACKUPS.iterdir()) == ['auto-20261102T000000Z', 'auto-20261103T000000Z']
    assert upd.latest_backup() == done
    (upd.SHARED_DATA / 'zz-broken.sqlite3').unlink()
    made = upd.backup_data()
    assert (made / upd.BACKUP_DONE).is_file()
    assert upd.latest_backup() == made


def test_self_check_runs_deploy_argument_path_without_side_effects(tmp_path):
    import os
    import subprocess
    import sys
    env = {k: v for k, v in os.environ.items() if not k.startswith('GENFORECAST_UPDATE_')}
    env.update({'GENFORECAST_UPDATE_BASE': str(tmp_path / 'base'),
                'GENFORECAST_UPDATE_SHARED_DATA': str(tmp_path / 'data'),
                'GENFORECAST_UPDATE_BACKUPS': str(tmp_path / 'backups')})
    done = subprocess.run([sys.executable, str(DEPLOY_DIR / 'update.py'), 'deploy', '--self-check'],
                          env=env, capture_output=True, timeout=60, check=False)
    assert done.returncode == 0, done.stdout + done.stderr
    assert list(tmp_path.iterdir()) == []
    bad = subprocess.run([sys.executable, str(DEPLOY_DIR / 'update.py'), 'deploy', '--no-such-flag'],
                         env=env, capture_output=True, timeout=60, check=False)
    assert bad.returncode != 0


def test_self_update_checks_new_updater_through_deploy_path_not_status(upd, tmp_path):
    release = tmp_path / 'rel'
    source = release / upd.UPDATER_IN_REPO
    source.parent.mkdir(parents=True)
    upd.BIN.mkdir(parents=True)
    (upd.BIN / 'update.py').write_text('print("v1")\n')
    # status는 통과하지만 deploy 경로는 깨진 갱신기
    source.write_text('import sys\nsys.exit(0 if sys.argv[1:] == ["status"] else 3)\n')
    upd.self_update(release)
    assert (upd.BIN / 'update.py').read_text() == 'print("v1")\n'
    source.write_text('import sys\nsys.exit(0 if sys.argv[1:] == ["deploy", "--self-check"] else 3)\n')
    upd.self_update(release)
    assert 'self-check' in (upd.BIN / 'update.py').read_text()


def test_self_update_os_error_is_a_warning_and_deploy_is_recorded(upd, monkeypatch, capsys):
    real_self_update = upd.self_update
    Steps(upd, monkeypatch)
    monkeypatch.setattr(upd, 'self_update', real_self_update)
    source = upd.RELEASES / 'new' / upd.UPDATER_IN_REPO
    source.parent.mkdir(parents=True)
    source.write_text('print("v2")\n')
    upd.BIN.mkdir(parents=True)
    (upd.BIN / 'update.py').write_text('print("v1")\n')

    def full_disk(*args, **kwargs):
        raise OSError(28, 'No space left on device')
    monkeypatch.setattr(upd.shutil, 'copy2', full_disk)
    assert upd.deploy() == 0
    assert upd.read_result()['result'] == 'deployed'
    assert (upd.BIN / 'update.py').read_text() == 'print("v1")\n'
    assert '경고' in capsys.readouterr().out


def test_install_waits_for_activating_update_service():
    text = (DEPLOY_DIR / 'install.sh').read_text(encoding='utf-8')
    assert 'systemctl show -p ActiveState --value genforecast-update.service' in text
    assert 'activating' in text
