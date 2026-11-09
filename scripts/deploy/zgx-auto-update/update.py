#!/usr/bin/env python3
"""ZGX 자동 갱신기: GitHub main의 최신 커밋을 시험한 뒤에만 공용 서버에 반영한다.

명령
  deploy [--no-switch] [--retry]  새 커밋을 받아 GitHub 검사 확인·시험·빌드 후 전환한다(기본 명령).
                                   --no-switch: 시험·빌드까지만 하고 전환하지 않는다.
                                   --retry: 실패로 기록된 같은 커밋도 다시 시도한다.
  status                          현재·이전 릴리스, 실패 기록, 마지막 실행 결과를 보여 준다.
  rollback                        이전 릴리스로 되돌리고, 되돌린 커밋을 실패로 기록한다.
  check                           바꾸지 않고 다음 동작만 출력한다.
  seed-shared OLD_BACKEND          옛 설치의 runs/·inputs/를 공유 폴더로 최초 1회 복사한다(덮어쓰지 않음).

종료 코드: 0 정상(바꿀 것 없음 포함), 1 실패, 75 다른 갱신이 진행 중, 76 GitHub 검사 대기.

표준 라이브러리만 사용한다. 환경 변수 값과 키 파일 내용은 출력하지 않는다.
DB는 연결(심볼릭 링크)과 백업만 하고 내용을 바꾸지 않는다.
의존성은 릴리스마다 만드는 venv(--system-site-packages)에 설치한다. 공용 Python 환경은 바꾸지 않는다.
backend/runs, backend/inputs는 릴리스 사이에 보존되는 BASE/shared 아래 폴더로 연결한다.
"""
import argparse
import contextlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def _path(name, default):
    value = os.environ.get(f'GENFORECAST_UPDATE_{name}')
    return Path(value) if value else Path(default)


BASE = _path('BASE', '/home/puyo/genforecast')
REPO = _path('REPO', BASE / 'repo')
RELEASES = _path('RELEASES', BASE / 'releases')
CURRENT = _path('CURRENT', BASE / 'current')
STATE = _path('STATE', BASE / 'state')
BIN = _path('BIN', BASE / 'bin')
SHARED_STATE = _path('SHARED_STATE', BASE / 'shared')
SHARED_DATA = _path('SHARED_DATA', '/home/puyo/genforecast-hp-20261012/backend/data')
BACKUPS = _path('BACKUPS', '/home/puyo/.config/genforecast/backups')
PY = _path('PY', '/home/puyo/miniforge3/envs/genforecast/bin/python')
NODE_BIN = _path('NODE_BIN', '/home/puyo/miniforge3/envs/genforecast-node/bin')
CI_URL = os.environ.get('GENFORECAST_UPDATE_CI_URL') or \
    'https://api.github.com/repos/runtosurvive0/genForecast/commits/{sha}/check-runs?per_page=100'

BRANCH = 'main'
KEEP_RELEASES = 3
KEEP_BACKUPS = 3
EXIT_LOCKED = 75
EXIT_WAITING = 76
RETRY_LIMIT = 3
SERVICES = ('genforecast-backend.service', 'genforecast-frontend.service', 'genforecast-demo.service')
# sudoers-genforecast 규칙과 글자 그대로 같아야 한다(시험으로 확인).
RESTART_COMMAND = ['sudo', '-n', '/usr/bin/systemctl', 'restart', *SERVICES]
HEALTH_CHECKS = (
    ('백엔드', 'http://127.0.0.1:8093/api/meta', 'lt500'),
    ('화면', 'http://127.0.0.1:8094/', 200),
    ('데모', 'http://127.0.0.1:61578/health', 200),
)
OPTIONAL_HEALTH = frozenset({'데모'})  # 실패해도 경고만 하고 되돌리지 않는다.
HEALTH_WAIT = 60
HEALTH_CONFIRM_GAP = 10  # 두 번 연속 통과해야 정상으로 본다.
HTTP_TIMEOUT = 5
CI_TIMEOUT = 10
REQUIRED_CHECKS = ('verify', 'backend')
CI_FAIL_CONCLUSIONS = frozenset({'failure', 'cancelled', 'timed_out', 'startup_failure'})
UPDATER_IN_REPO = 'scripts/deploy/zgx-auto-update/update.py'
# 서버가 실행 중에 만드는 상태가 들어 있어 릴리스 사이에 보존하는 backend 하위 폴더.
SHARED_DIRS = ('runs', 'inputs')
SEED_MARKER = '.seeded'
# 이 단계의 실패만 커밋 탓으로 보고 기록한다. 그 밖(받기·설치·연결 등)은 다음 주기에 다시 시도한다.
RECORDED_STEPS = frozenset({'백엔드 시험', 'npm test', 'npm run build', 'pyproject'})
# 시험용 환경에 남길 변수(그 밖의 키·DB 경로·서비스 설정은 모두 버린다).
ENV_ALLOW = ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE',
             'TZ', 'TMPDIR', 'TERM', 'SYSTEMROOT', 'TEMP', 'TMP',
             'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy')
SECRET_HINTS = ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'DSN', 'CREDENTIAL')

# 단계별 시간 제한(초)과 한 번의 deploy에서 최악의 호출 횟수. 합이 100분 이하여야 한다
# (genforecast-update.service TimeoutStartSec=120min 안에서 되돌리기까지 끝내기 위해).
TIMEOUT = {'git': 120, 'venv': 180, 'pip': 1200, 'npm_ci': 900, 'pytest': 1200, 'npm_test': 600,
           'npm_build': 600, 'restart': 120, 'self_check': 60}
STEP_CALLS = {'git': 6, 'venv': 1, 'pip': 1, 'npm_ci': 1, 'pytest': 1, 'npm_test': 1,
              'npm_build': 1, 'restart': 2, 'self_check': 1}


class StepError(RuntimeError):
    """한 단계가 실패했다. 메시지는 한국어 한 줄, step은 실패 분류에 쓰는 단계 이름."""

    def __init__(self, message, step=''):
        super().__init__(message)
        self.step = step


def log(message):
    for line in str(message).splitlines() or ['']:
        print(f'[genforecast-update] {line}', flush=True)


def utc_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------- 순수 로직

def decide_action(target, current, failed, ready, *, no_switch=False, retry=False):
    """다음 동작: up_to_date / skip_failed / already_prepared / switch_ready / prepare."""
    if target == current:
        return 'up_to_date'
    if target == failed and not retry:
        return 'skip_failed'
    if ready:
        return 'already_prepared' if no_switch else 'switch_ready'
    return 'prepare'


def shared_links(names, tracked):
    """공유 데이터 폴더의 파일 중 그 커밋에 추적되지 않은 것만 연결 대상으로 고른다."""
    return sorted(name for name in set(names) if not name.startswith('.') and name not in tracked)


def release_name(sha, when):
    return f"{when.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}-{sha[:10]}"


def select_prune(names, current, previous, keep=KEEP_RELEASES):
    """지울 릴리스: 현재·이전과 최신 것을 합쳐 keep개만 남긴다. 시험용 임시 폴더는 모두 지운다."""
    hidden = sorted(name for name in names if name.startswith(('.pytest-', '.extract-')))
    releases = sorted((name for name in names if not name.startswith('.')), reverse=True)
    kept = [name for name in (current, previous) if name in releases]
    for name in releases:
        if len(kept) >= keep:
            break
        if name not in kept:
            kept.append(name)
    return hidden + sorted(name for name in releases if name not in kept)


def select_backup_prune(names, keep=KEEP_BACKUPS):
    """자동 백업(auto-*)만 대상으로 오래된 것을 고른다. 수동 백업은 건드리지 않는다."""
    auto = sorted((name for name in names if name.startswith('auto-')), reverse=True)
    return sorted(auto[keep:])


def select_node_modules_prune(names, current, previous):
    """node_modules를 지울 릴리스: 현재·직전(되돌리기 대상)과 아직 전환 전인 더 새 릴리스는 남긴다."""
    if not current:
        return []
    return sorted(name for name in names
                  if not name.startswith('.') and name not in (current, previous) and name < current)


def health_ok(expect, status):
    if status is None:
        return False
    if expect == 'lt500':
        return status < 500
    return status == expect


def judge_health(statuses):
    """(정상 여부, 경고 목록). 백엔드·화면만 판정하고, 데모 실패는 경고로만 남긴다."""
    ok = all(health_ok(expect, statuses.get(label))
             for label, _url, expect in HEALTH_CHECKS if label not in OPTIONAL_HEALTH)
    warnings = [label for label, _url, expect in HEALTH_CHECKS
                if label in OPTIONAL_HEALTH and not health_ok(expect, statuses.get(label))]
    return ok, warnings


def ci_verdict(payload):
    """GitHub check-runs 응답 → pass / pending / fail. 필수 검사마다 가장 최근(id 최대) 실행을 본다."""
    if not isinstance(payload, dict) or not isinstance(payload.get('check_runs'), list):
        return 'pending'
    latest = {}
    for run in payload['check_runs']:
        if not isinstance(run, dict) or run.get('name') not in REQUIRED_CHECKS:
            continue
        name = run['name']
        if name not in latest or (run.get('id') or 0) > (latest[name].get('id') or 0):
            latest[name] = run
    verdicts = []
    for name in REQUIRED_CHECKS:
        run = latest.get(name)
        if run is None or run.get('status') != 'completed':
            verdicts.append('pending')
        elif run.get('conclusion') == 'success':
            verdicts.append('pass')
        elif run.get('conclusion') in CI_FAIL_CONCLUSIONS:
            verdicts.append('fail')
        else:
            verdicts.append('pending')
    if 'fail' in verdicts:
        return 'fail'
    return 'pass' if all(v == 'pass' for v in verdicts) else 'pending'


def bump_retry(state, sha, limit=RETRY_LIMIT):
    """같은 커밋의 일시적 실패 횟수를 센다. (새 상태, 상한 초과 여부)."""
    count = state.get('count', 0) + 1 if state.get('commit') == sha else 1
    return {'commit': sha, 'count': count}, count > limit


def read_dependencies(pyproject_text):
    try:
        project = tomllib.loads(pyproject_text)['project']
        deps = list(project.get('dependencies', [])) + list(project.get('optional-dependencies', {}).get('dev', []))
    except (tomllib.TOMLDecodeError, KeyError, TypeError, AttributeError) as error:
        raise StepError(f'backend/pyproject.toml을 읽지 못했습니다({type(error).__name__}).', step='pyproject') from None
    if not all(isinstance(dep, str) for dep in deps):
        raise StepError('backend/pyproject.toml 의존성 형식이 올바르지 않습니다.', step='pyproject')
    return deps


def should_record_failure(step):
    """시험·빌드·pyproject 실패만 커밋 실패로 기록한다. 네트워크·설치·파일 문제는 재시도 대상."""
    return step in RECORDED_STEPS


def _safe_relative(path):
    parts = Path(path).parts
    return bool(parts) and not Path(path).is_absolute() and '..' not in parts


def shared_dir_sync_plan(tracked_paths):
    """그 커밋에 추적된 backend/runs·backend/inputs 파일(backend/ 기준 상대 경로)."""
    plan = set()
    for path in tracked_paths:
        if not path.startswith('backend/') or path.endswith('/'):
            continue
        relative = path[len('backend/'):]
        if relative.split('/', 1)[0] in SHARED_DIRS and '/' in relative and _safe_relative(relative):
            plan.add(relative)
    return sorted(plan)


def seed_plan(old_files, shared_files):
    """옛 설치에서 공유 폴더로 복사할 파일: runs/·inputs/ 아래이면서 공유 폴더에 아직 없는 것."""
    return sorted(path for path in set(old_files)
                  if path.split('/', 1)[0] in SHARED_DIRS and '/' in path
                  and _safe_relative(path) and path not in shared_files)


def venv_python(release):
    return Path(release) / '.venv/bin/python'


def clean_env(environ, node_bin=NODE_BIN):
    """키·DB 경로·서비스 설정을 뺀 시험용 환경."""
    env = {name: environ[name] for name in ENV_ALLOW
           if name in environ and not any(hint in name.upper() for hint in SECRET_HINTS)}
    path = env.get('PATH') or os.defpath
    env['PATH'] = f'{node_bin}{os.pathsep}{path}' if node_bin else path
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    return env


def rollback_plan(previous):
    return 'restore' if previous else 'remove'


def health_budget_seconds():
    return HEALTH_WAIT + HEALTH_CONFIRM_GAP + 3 + 2 * len(HEALTH_CHECKS) * HTTP_TIMEOUT


def worst_case_seconds():
    """한 번의 deploy가 걸릴 수 있는 최악의 시간(데이터 백업 제외)."""
    return (sum(TIMEOUT[name] * count for name, count in STEP_CALLS.items())
            + 2 * health_budget_seconds() + CI_TIMEOUT)


# ---------------------------------------------------------------- 상태 파일

def read_state(name):
    path = STATE / name
    try:
        value = path.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        return None
    return value or None


def write_state(name, value):
    STATE.mkdir(parents=True, exist_ok=True)
    path = STATE / name
    if value is None:
        path.unlink(missing_ok=True)
        return
    tmp = path.with_name(f'.{name}.tmp')
    tmp.write_text(f'{value}\n', encoding='utf-8')
    os.replace(tmp, path)


def read_json(name):
    try:
        return json.loads((STATE / name).read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        return None


def write_json(name, value):
    write_state(name, None if value is None else json.dumps(value, ensure_ascii=False))


def write_result(commit, result, step='', message='', **extra):
    write_json('last-result.json', {'commit': commit, 'at': utc_now(), 'result': result,
                                    'step': step, 'message': message, **extra})


def read_result():
    return read_json('last-result.json')


@contextlib.contextmanager
def update_lock():
    import fcntl  # Linux 전용; 시험(Windows)에서는 이 함수를 가짜로 바꾼다.
    STATE.mkdir(parents=True, exist_ok=True)
    with open(STATE / 'update.lock', 'w') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True


# ---------------------------------------------------------------- 외부 명령

def run(args, *, step, timeout, cwd=None, env=None):
    """명령을 실행한다. 실패·시간 초과 시 마지막 출력만 남기고 StepError."""
    try:
        done = subprocess.run([str(a) for a in args], cwd=cwd, env=env, capture_output=True,
                              text=True, errors='replace', timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise StepError(f'{step}: {timeout}초 안에 끝나지 않아 중단했습니다.', step=step) from None
    except OSError as error:
        raise StepError(f'{step}: 실행하지 못했습니다({error.strerror}).', step=step) from None
    if done.returncode != 0:
        tail = (done.stdout + done.stderr).strip().splitlines()[-25:]
        for line in tail:
            log(f'  | {line}')
        raise StepError(f'{step}: 종료 코드 {done.returncode}', step=step)
    return done.stdout


def git(*args, timeout=TIMEOUT['git']):
    return run(['git', '-C', REPO, '-c', 'core.quotePath=false', *args], step=f'git {args[0]}',
               timeout=timeout, env=clean_env(os.environ, node_bin=None))


def tracked_files(sha, *paths):
    listed = git('ls-tree', '-r', '-z', '--name-only', sha, *paths)
    return [name for name in listed.split('\0') if name]


def fetch_target():
    git('fetch', '--prune', 'origin', f'+refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}')
    return git('rev-parse', '--verify', f'origin/{BRANCH}^{{commit}}').strip()


def ci_status(sha):
    """GitHub 검사(verify, backend) 결과. 네트워크 오류·응답 이상은 대기(pending)로 본다."""
    request = Request(CI_URL.format(sha=sha), headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'genforecast-zgx-updater'})
    try:
        with urlopen(request, timeout=CI_TIMEOUT) as response:
            payload = json.load(response)
    except HTTPError as error:
        log(f'GitHub 검사 조회 실패(HTTP {error.code}). 다음 주기에 다시 봅니다.')
        return 'pending'
    except (OSError, ValueError) as error:
        log(f'GitHub 검사 조회 실패({type(error).__name__}). 다음 주기에 다시 봅니다.')
        return 'pending'
    return ci_verdict(payload)


def revision_of(path):
    try:
        return (Path(path) / 'REVISION').read_text(encoding='utf-8').strip() or None
    except (FileNotFoundError, NotADirectoryError):
        return None


def current_target():
    if not CURRENT.is_symlink():
        return None
    return Path(os.readlink(CURRENT))


def current_revision():
    target = current_target()
    return revision_of(target) if target else None


def find_ready_release(sha):
    if not RELEASES.is_dir():
        return None
    for path in sorted(RELEASES.iterdir(), reverse=True):
        if not path.name.startswith('.') and (path / '.ready').is_file() and revision_of(path) == sha:
            return path
    return None


def extract(sha, dest):
    dest.mkdir(parents=True)
    with tempfile.TemporaryDirectory(dir=RELEASES, prefix='.extract-') as tmp:
        archive = Path(tmp) / 'src.tar'
        git('archive', '--format=tar', '-o', str(archive), sha)
        with tarfile.open(archive) as tar:
            tar.extractall(dest, filter='data')
    (dest / 'REVISION').write_text(f'{sha}\n', encoding='utf-8')


def ensure_python_deps(release):
    """릴리스 전용 venv를 만들고 의존성을 설치한다. 공용 환경에 이미 맞는 패키지는 그대로 재사용된다."""
    try:
        text = (release / 'backend/pyproject.toml').read_text(encoding='utf-8')
    except OSError:
        raise StepError('backend/pyproject.toml이 없습니다.', step='pyproject') from None
    deps = read_dependencies(text)
    env = clean_env(os.environ)
    log('릴리스 전용 Python 환경(.venv, 공용 패키지 공유)을 만듭니다.')
    run([PY, '-m', 'venv', '--system-site-packages', release / '.venv'], step='venv 생성',
        timeout=TIMEOUT['venv'], env=env)
    log(f'Python 의존성 {len(deps)}개를 릴리스 환경에 설치·확인합니다.')
    run([venv_python(release), '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', *deps],
        step='pip install', timeout=TIMEOUT['pip'], env=env)


def install_frontend(dest):
    log('화면: npm ci')
    run([NODE_BIN / 'npm', 'ci', '--no-audit', '--no-fund'], step='npm ci', timeout=TIMEOUT['npm_ci'],
        cwd=dest, env=clean_env(os.environ))


def run_backend_tests(sha, name, python):
    """백엔드 시험은 공유 데이터가 연결되지 않은 별도 사본에서 돌린다(실DB 보호)."""
    scratch = RELEASES / f'.pytest-{name}'
    shutil.rmtree(scratch, ignore_errors=True)
    try:
        extract(sha, scratch)
        log('백엔드 시험(pytest)을 키 없이 격리 환경에서 실행합니다.')
        run([python, '-m', 'pytest', '-q', '-p', 'no:cacheprovider'], step='백엔드 시험',
            timeout=TIMEOUT['pytest'], cwd=scratch / 'backend', env=clean_env(os.environ))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def build_frontend(dest):
    env = clean_env(os.environ)
    npm = NODE_BIN / 'npm'
    log('화면: npm test')
    run([npm, 'test'], step='npm test', timeout=TIMEOUT['npm_test'], cwd=dest, env=env)
    log('화면: npm run build')
    run([npm, 'run', 'build'], step='npm run build', timeout=TIMEOUT['npm_build'], cwd=dest, env=env)
    if not (dest / 'dist/index.html').is_file():
        raise StepError('npm run build: dist/index.html이 만들어지지 않았습니다.', step='npm run build')


def link_shared_data(dest, sha):
    if not SHARED_DATA.is_dir():
        raise StepError(f'공유 데이터 폴더가 없습니다: {SHARED_DATA}', step='공유 데이터 연결')
    tracked = {Path(name).name for name in tracked_files(sha, 'backend/data/')}
    names = [p.name for p in SHARED_DATA.iterdir() if p.is_file()]
    data_dir = dest / 'backend/data'
    data_dir.mkdir(parents=True, exist_ok=True)
    links = shared_links(names, tracked)
    for name in links:
        link = data_dir / name
        if link.is_symlink() or link.is_file():
            link.unlink()  # 새 릴리스 안에서 시험·빌드가 만든 부산물. 공유 원본을 쓴다.
        os.symlink(SHARED_DATA / name, link)
    log(f'공유 데이터 {len(links)}개를 연결했습니다(추적 파일 {len(tracked)}개는 저장소 사본 사용).')


def _copy_atomic(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f'.{target.name}.tmp')
    shutil.copy2(source, tmp)
    os.replace(tmp, target)


def link_shared_dirs(dest, sha):
    """추적된 runs/·inputs/ 파일을 공유 폴더에 동기화하고(추적 안 된 파일은 보존), 릴리스 폴더를 공유 폴더 링크로 바꾼다.

    공유 폴더를 바꾸므로 전환 단계(백업 뒤)에서만 부른다. --no-switch에서는 부르지 않는다.
    """
    plan = shared_dir_sync_plan(tracked_files(sha, *(f'backend/{name}/' for name in SHARED_DIRS)))
    backend = dest / 'backend'
    changed = 0
    for relative in plan:
        source, target = backend / relative, SHARED_STATE / relative
        if source.is_symlink() or not source.is_file():
            continue  # 이미 공유 폴더로 연결된 릴리스(다시 실행한 경우)
        if target.is_file() and target.read_bytes() == source.read_bytes():
            continue
        if target.exists() and not target.is_file():
            raise StepError(f'공유 폴더에 파일 대신 폴더가 있습니다: {target}', step='공유 데이터 연결')
        _copy_atomic(source, target)
        changed += 1
    for name in SHARED_DIRS:
        shared, local = SHARED_STATE / name, backend / name
        shared.mkdir(parents=True, exist_ok=True)
        if local.is_symlink():
            local.unlink()
        elif local.is_dir():
            shutil.rmtree(local)
        elif local.exists():
            local.unlink()
        os.symlink(shared, local)
    log(f'runs/·inputs/: 추적 파일 {len(plan)}개 중 {changed}개 갱신, 공유 폴더로 연결했습니다.')


def seed_shared(old_backend):
    """옛 설치의 runs/·inputs/를 공유 폴더에 최초 1회 복사한다. 이미 있는 파일은 덮어쓰지 않는다."""
    old_backend = Path(old_backend)
    if not old_backend.is_dir():
        log(f'옛 설치 폴더가 없습니다: {old_backend}')
        return 1
    marker = SHARED_STATE / SEED_MARKER
    if marker.is_file():
        log('옛 설치의 runs/·inputs/는 이미 복사했습니다(건너뜀).')
        return 0

    def files_under(root):
        found = []
        for name in SHARED_DIRS:
            base = root / name
            if base.is_dir():
                found += [p.relative_to(root).as_posix() for p in base.rglob('*') if p.is_file()]
        return found

    plan = seed_plan(files_under(old_backend), set(files_under(SHARED_STATE)) if SHARED_STATE.is_dir() else set())
    for relative in plan:
        _copy_atomic(old_backend / relative, SHARED_STATE / relative)
    for name in SHARED_DIRS:
        (SHARED_STATE / name).mkdir(parents=True, exist_ok=True)
    marker.write_text(f'{utc_now()} {old_backend}\n', encoding='utf-8')
    log(f'옛 설치의 runs/·inputs/에서 {len(plan)}개를 공유 폴더({SHARED_STATE})로 복사했습니다.')
    return 0


def prepare_release(sha):
    """의존성 설치(venv·pip·npm ci)를 모두 끝낸 뒤 시험·빌드한다."""
    RELEASES.mkdir(parents=True, exist_ok=True)
    name = release_name(sha, datetime.now(timezone.utc))
    dest = RELEASES / name
    log(f'새 릴리스 준비: {name}')
    try:
        extract(sha, dest)
        ensure_python_deps(dest)
        install_frontend(dest)
        run_backend_tests(sha, name, venv_python(dest))
        build_frontend(dest)
        link_shared_data(dest, sha)
        (dest / '.ready').write_text(f'{sha}\n', encoding='utf-8')
    except BaseException:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    log(f'시험·빌드 통과: {name}')
    return dest


def backup_data():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = BACKUPS / f'auto-{stamp}'
    try:
        target.mkdir(parents=True, mode=0o700)
        count = 0
        for db in sorted(SHARED_DATA.glob('*.sqlite3')):
            if not db.is_file():
                continue
            src = sqlite3.connect(db, timeout=30)  # 읽기만 한다(backup API).
            dst = sqlite3.connect(target / db.name)
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()
            count += 1
    except (OSError, sqlite3.Error) as error:
        raise StepError(f'데이터 백업 실패({type(error).__name__}). 전환하지 않습니다.', step='백업') from None
    log(f'데이터 백업 {count}개: {target}')
    for name in select_backup_prune([p.name for p in BACKUPS.iterdir() if p.is_dir()]):
        shutil.rmtree(BACKUPS / name, ignore_errors=True)
    return target


def latest_backup():
    if not BACKUPS.is_dir():
        return None
    autos = sorted(p for p in BACKUPS.iterdir() if p.is_dir() and p.name.startswith('auto-'))
    return autos[-1] if autos else None


def point_current(release):
    if CURRENT.exists() and not CURRENT.is_symlink():
        raise StepError(f'{CURRENT}가 심볼릭 링크가 아니라 전환하지 않습니다.', step='전환')
    tmp = CURRENT.with_name('.current.tmp')
    tmp.unlink(missing_ok=True)
    os.symlink(release, tmp)
    os.replace(tmp, CURRENT)
    log(f'current → {Path(release).name}')


def remove_current():
    if CURRENT.is_symlink():
        CURRENT.unlink()
    log('이전 릴리스가 없어 current 링크를 지웠습니다. 기존 설치 복구는 install.sh가 담당합니다.')


def restart_services():
    log('서비스를 재시작합니다: ' + ', '.join(SERVICES))
    run(RESTART_COMMAND, step='서비스 재시작', timeout=TIMEOUT['restart'])


def http_status(url):
    try:
        with urlopen(url, timeout=HTTP_TIMEOUT) as response:
            return response.status
    except HTTPError as error:
        return error.code
    except (OSError, ValueError):
        return None


def check_health_once():
    statuses = {label: http_status(url) for label, url, _expect in HEALTH_CHECKS}
    ok, warnings = judge_health(statuses)
    for label in warnings:
        log(f'경고: {label} 상태 확인 실패(되돌리기 사유는 아님).')
    if not ok:
        failing = [label for label, _url, expect in HEALTH_CHECKS
                   if label not in OPTIONAL_HEALTH and not health_ok(expect, statuses[label])]
        log('상태 확인 실패: ' + ', '.join(failing))
    return ok


def wait_healthy(wait=HEALTH_WAIT):
    """백엔드·화면이 HEALTH_CONFIRM_GAP초 간격으로 두 번 연속 정상이면 True."""
    deadline = time.monotonic() + wait
    passes = 0
    while True:
        if check_health_once():
            passes += 1
            if passes >= 2:
                log('상태 확인 통과(두 번 연속).')
                return True
            time.sleep(HEALTH_CONFIRM_GAP)
            continue
        passes = 0
        if time.monotonic() >= deadline:
            return False
        time.sleep(3)


def prune_releases():
    if not RELEASES.is_dir():
        return
    current = current_target()
    previous = read_state('previous')
    names = [p.name for p in RELEASES.iterdir() if p.is_dir() and not p.is_symlink()]
    current_name = current.name if current else None
    previous_name = Path(previous).name if previous else None
    for name in select_prune(names, current_name, previous_name):
        shutil.rmtree(RELEASES / name, ignore_errors=True)
        log(f'오래된 릴리스 정리: {name}')
    remaining = [p.name for p in RELEASES.iterdir() if p.is_dir() and not p.is_symlink()]
    for name in select_node_modules_prune(remaining, current_name, previous_name):
        modules = RELEASES / name / 'node_modules'
        if modules.is_dir() and not modules.is_symlink():
            shutil.rmtree(modules, ignore_errors=True)
            log(f'node_modules 정리: {name}')


def self_update(release):
    """전환에 성공한 커밋의 update.py가 설치본과 다르면 BASE/bin에 반영한다(다음 실행부터 적용).

    이전 파일은 update.py.prev로 남기고, 새 파일로 `status`를 실행해 보아 실패하면 되돌린다.
    """
    source = Path(release) / UPDATER_IN_REPO
    installed = BIN / 'update.py'
    previous = BIN / 'update.py.prev'
    if not source.is_file():
        return
    new = source.read_bytes()
    if installed.is_file() and installed.read_bytes() == new:
        return
    try:
        compile(new, str(source), 'exec')
    except SyntaxError:
        log('새 update.py 문법 오류: 갱신기 자체 교체를 건너뜁니다.')
        return
    BIN.mkdir(parents=True, exist_ok=True)
    if installed.is_file():
        shutil.copy2(installed, previous)
    tmp = BIN / '.update.py.tmp'
    tmp.write_bytes(new)
    tmp.chmod(0o755)
    os.replace(tmp, installed)
    env = clean_env(os.environ, node_bin=None)
    env.update({k: v for k, v in os.environ.items() if k.startswith('GENFORECAST_UPDATE_')})
    try:
        ok = subprocess.run([sys.executable, str(installed), 'status'], env=env, capture_output=True,
                            timeout=TIMEOUT['self_check'], check=False).returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        ok = False
    if not ok and previous.is_file():
        shutil.copy2(previous, tmp)
        os.replace(tmp, installed)
        log('새 update.py로 status 실행이 실패해 이전 갱신기로 되돌렸습니다.')
        return
    log('갱신기(update.py)를 새 버전으로 교체했습니다(이전 파일: update.py.prev). 다음 실행부터 적용됩니다.')


# ---------------------------------------------------------------- 명령

def transient_failure(target, step, message):
    """재시도 대상 실패. 같은 커밋에서 RETRY_LIMIT번을 넘으면 실패 커밋으로 기록한다."""
    state, exhausted = bump_retry(read_json('retries.json') or {}, target)
    write_json('retries.json', state)
    if exhausted:
        write_state('failed', target)
        log(f'일시적 실패가 {RETRY_LIMIT}번을 넘어 {target[:10]}을(를) 실패로 기록합니다: {message}')
        write_result(target, 'retry_exhausted', step, message, retries=state['count'])
    else:
        log(f'일시적인 문제로 보고 다음 주기에 다시 시도합니다({state["count"]}/{RETRY_LIMIT}): {message}')
        write_result(target, 'retry_later', step, message, retries=state['count'])
    return 1


def recorded_failure(target, result, step, message):
    write_state('failed', target)
    write_json('retries.json', None)
    log(f'{target[:10]} 실패 기록({result}): {message}')
    write_result(target, result, step, message)
    return 1


def restore_previous(previous, backup):
    """이전 릴리스로 되돌린다. 결과: rolled_back / rollback_unhealthy / removed."""
    if rollback_plan(previous) == 'remove':
        remove_current()
        return 'removed'
    point_current(previous)
    write_state('previous', None)
    try:
        restart_services()
        ok = wait_healthy()
    except StepError as error:
        log(str(error))
        ok = False
    if ok:
        log('이전 버전으로 복구했습니다.')
        return 'rolled_back'
    log('이전 버전 복구 후에도 상태 확인 실패. 직접 확인이 필요합니다.')
    log(f'복구에 쓸 데이터 백업: {backup or "(없음)"}')
    return 'rollback_unhealthy'


def activate(release, target):
    try:
        backup = backup_data()
    except StepError as error:
        return transient_failure(target, error.step, str(error))
    try:
        link_shared_dirs(release, target)
    except (StepError, OSError) as error:
        return transient_failure(target, '공유 데이터 연결', str(error))
    previous = current_target()
    write_json('activating', {'previous': str(previous) if previous else None, 'target': str(release),
                              'commit': target, 'at': utc_now()})
    point_current(release)
    write_state('previous', str(previous) if previous else None)
    try:
        restart_services()
        healthy = wait_healthy()
    except StepError as error:
        log(str(error))
        healthy = False
    if healthy:
        write_json('activating', None)
        write_state('failed', None)
        write_json('retries.json', None)
        self_update(release)
        log(f'반영 완료: {target[:10]} ({Path(release).name})')
        write_result(target, 'deployed', '', f'{Path(release).name} 반영')
        return 0
    log(f'새 버전 {target[:10]}이(가) 정상 동작하지 않아 되돌립니다.')
    write_state('failed', target)
    write_json('retries.json', None)
    outcome = restore_previous(previous, backup)
    write_json('activating', None)
    extra = {'backup': str(backup)} if outcome == 'rollback_unhealthy' else {}
    write_result(target, outcome, '상태 확인', '반영 후 상태 확인 실패', **extra)
    return 1


def recover_interrupted(marker):
    """이전 실행이 전환 도중 멈췄다. 정상이면 받아들이고 None, 아니면 이전 대상으로 되돌리고 1."""
    log('이전 실행이 전환 도중 멈춘 흔적이 있습니다. 상태를 먼저 확인합니다.')
    if wait_healthy():
        write_json('activating', None)
        log('현재 상태가 정상이라 그대로 둡니다.')
        return None
    commit = marker.get('commit') if isinstance(marker, dict) else None
    previous = marker.get('previous') if isinstance(marker, dict) else None
    if commit:
        write_state('failed', commit)
    backup = latest_backup()
    outcome = restore_previous(Path(previous) if previous else None, backup)
    write_json('activating', None)
    write_result(commit, 'recovered_interrupted', '전환 중단 복구', outcome,
                 **({'backup': str(backup)} if outcome == 'rollback_unhealthy' and backup else {}))
    return 1


def deploy(no_switch=False, retry=False):
    with update_lock() as acquired:
        if not acquired:
            log('다른 갱신이 진행 중이라 종료합니다.')
            return EXIT_LOCKED
        marker = read_json('activating')
        if marker is not None:
            code = recover_interrupted(marker)
            if code is not None:
                prune_releases()
                return code
        try:
            target = fetch_target()
        except StepError as error:
            log(f'GitHub 확인 실패(다음 주기에 다시 시도): {error}')
            write_result(None, 'retry_later', 'git fetch', str(error))
            return 1
        current = current_revision()
        ready = find_ready_release(target)
        action = decide_action(target, current, read_state('failed'), ready, no_switch=no_switch, retry=retry)
        if action == 'up_to_date':
            log(f'최신 상태입니다: {target[:10]}')
            write_result(target, 'up_to_date')
            return 0
        if action == 'skip_failed':
            log(f'{target[:10]}은(는) 이전에 실패한 커밋이라 다음 커밋을 기다립니다(--retry로 재시도).')
            write_result(target, 'skip_failed')
            return 0
        if action == 'already_prepared':
            log(f'이미 준비된 릴리스가 있습니다: {ready.name}')
            write_result(target, 'prepared', '', ready.name)
            return 0
        verdict = ci_status(target)
        if verdict == 'pending':
            log(f'{target[:10]}의 GitHub 검사(verify, backend)가 아직 끝나지 않았습니다. 다음 주기에 다시 봅니다.')
            write_result(target, 'waiting_ci')
            return EXIT_WAITING
        if verdict == 'fail':
            return recorded_failure(target, 'ci_failed', 'GitHub 검사', 'verify 또는 backend 검사 실패')
        try:
            if action == 'prepare':
                try:
                    release = prepare_release(target)
                except StepError as error:
                    if should_record_failure(error.step):
                        return recorded_failure(target, 'test_failed', error.step, str(error))
                    return transient_failure(target, error.step, str(error))
                except OSError as error:
                    return transient_failure(target, '파일 작업', f'{type(error).__name__} {error.strerror or ""}')
            else:
                release = ready
            if read_state('failed') == target:  # --retry로 다시 시도해 통과했다
                write_state('failed', None)
            write_json('retries.json', None)
            if no_switch:
                log(f'준비만 완료했습니다(--no-switch): {release.name}')
                write_result(target, 'prepared', '', release.name)
                return 0
            return activate(release, target)
        finally:
            prune_releases()


def rollback():
    with update_lock() as acquired:
        if not acquired:
            log('다른 갱신이 진행 중입니다. 잠시 뒤 다시 실행하세요.')
            return EXIT_LOCKED
        previous = read_state('previous')
        if not previous or not Path(previous).is_dir():
            log('되돌릴 이전 릴리스가 없습니다.')
            return 1
        abandoned = current_target()
        abandoned_rev = current_revision()
        point_current(Path(previous))
        write_state('previous', str(abandoned) if abandoned else None)
        if abandoned_rev:
            write_state('failed', abandoned_rev)  # 타이머가 같은 커밋을 곧바로 다시 올리지 않게 한다.
        try:
            restart_services()
            ok = wait_healthy()
        except StepError as error:
            log(str(error))
            ok = False
        log('되돌리기 완료.' if ok else '되돌린 뒤 상태 확인 실패. 직접 확인이 필요합니다.')
        write_result(abandoned_rev, 'manual_rollback' if ok else 'manual_rollback_unhealthy', '수동 되돌리기',
                     f'{Path(previous).name}로 되돌림')
        return 0 if ok else 1


def status():
    target = current_target()
    log(f'현재 릴리스: {target.name if target else "없음"} / 커밋 {current_revision() or "-"}')
    log(f'이전 릴리스: {read_state("previous") or "없음"}')
    log(f'실패 기록 커밋: {read_state("failed") or "없음"}')
    retries = read_json('retries.json')
    if retries:
        log(f'일시적 실패 횟수: {str(retries.get("commit"))[:10]} {retries.get("count")}/{RETRY_LIMIT}')
    if read_json('activating') is not None:
        log('주의: 전환 중단 흔적(state/activating)이 있습니다. 다음 실행이 먼저 복구합니다.')
    result = read_result()
    if result:
        log(f'마지막 실행: {result.get("at")} {result.get("result")} 커밋 {str(result.get("commit") or "-")[:10]}'
            f' {result.get("step") or ""} {result.get("message") or ""}'.rstrip())
        if result.get('backup'):
            log(f'  복구에 쓸 데이터 백업: {result["backup"]}')
    try:
        log(f'origin/{BRANCH}(마지막으로 받은 값): '
            + git('rev-parse', '--verify', f'origin/{BRANCH}^{{commit}}').strip())
    except StepError:
        log(f'origin/{BRANCH}: 확인 불가')
    if RELEASES.is_dir():
        names = sorted(p.name for p in RELEASES.iterdir() if p.is_dir() and not p.name.startswith('.'))
        log('보관 중인 릴리스: ' + (', '.join(names) or '없음'))
    return 0


def check():
    try:
        target = fetch_target()
    except StepError as error:
        log(f'GitHub 확인 실패: {error}')
        return 1
    current = current_revision()
    failed = read_state('failed')
    action = decide_action(target, current, failed, find_ready_release(target))
    messages = {
        'up_to_date': '바꿀 것이 없습니다.',
        'skip_failed': '실패 기록이 있는 커밋이라 건너뜁니다.',
        'switch_ready': '준비된 릴리스로 전환합니다.',
        'prepare': '새 릴리스를 시험·빌드한 뒤 전환합니다.',
    }
    log(f'main {target[:10]} / 현재 {(current or "-")[:10]} → {messages.get(action, action)}')
    if action in ('switch_ready', 'prepare'):
        log(f'GitHub 검사(verify, backend): {ci_status(target)}')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='GenForecast ZGX 자동 갱신기')
    sub = parser.add_subparsers(dest='command')
    deploy_parser = sub.add_parser('deploy', help='시험 통과 시 새 버전으로 전환')
    deploy_parser.add_argument('--no-switch', action='store_true', help='시험·빌드까지만')
    deploy_parser.add_argument('--retry', action='store_true', help='실패 기록 커밋도 재시도')
    sub.add_parser('status')
    sub.add_parser('rollback')
    sub.add_parser('check')
    seed_parser = sub.add_parser('seed-shared', help='옛 설치의 runs/·inputs/를 공유 폴더로 복사')
    seed_parser.add_argument('old_backend')
    args = parser.parse_args(argv)
    command = args.command or 'deploy'
    if command == 'seed-shared':
        return seed_shared(args.old_backend)
    if command == 'deploy':
        return deploy(no_switch=getattr(args, 'no_switch', False), retry=getattr(args, 'retry', False))
    return {'status': status, 'rollback': rollback, 'check': check}[command]()


if __name__ == '__main__':
    sys.exit(main())
