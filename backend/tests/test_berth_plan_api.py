"""접안 추천 API 시험. 입력은 고정 BerthInputs로 바꾸고 저장 함수는 호출되지 않아야 한다."""
import pytest

from midterm import stock_baseline, voyage_registry
from midterm.berth_plan.inputs import build_inputs, load_berths
from midterm.supply import timestamp
from midterm.web import berth_plan_api
from midterm.web.app import app
from test_supply_api import client  # noqa: F401  (인증된 서버 픽스처 재사용)

AS_OF = timestamp('2026-11-10T09:30:00+09:00')
REGISTRY = {
    'ships': [{'ship_code': 'S1', 'name': '가나다호'}],
    'voyages': [{'voyage_no': 'V-1', 'voyage_number': '26-1-001', 'ship_code': 'S1', 'status': 'planned',
                 'classification': 'actual', 'yard': '2', 'planned_arrival': '2026-11-12T08:00:00+09:00',
                 'laytime_hours': 72, 'demurrage_usd_per_day': 20000, 'berth_id': None}],
    'cargo': [{'cargo_no': 'C-1', 'voyage_no': 'V-1', 'destination_plant_id': 'dangjin', 'bl_t': 40000.,
               'planned_t': 39000.}],
}


def fixed_inputs(horizon_days=14):
    berths, outages = load_berths()
    return build_inputs(REGISTRY, berths, outages, None, AS_OF, horizon_days)


@pytest.fixture
def api(client, tmp_path, monkeypatch):  # noqa: F811
    app.dependency_overrides[berth_plan_api.get_berth_plan_path] = lambda: tmp_path / 'registry.sqlite3'
    monkeypatch.setattr(berth_plan_api, 'load_inputs', lambda path, as_of, horizon: fixed_inputs(horizon))
    yield client
    app.dependency_overrides.clear()


@pytest.fixture
def gated(tmp_path):
    """실제 인증 경계(install_access)만 붙인 격리 앱."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from midterm.auth.store import AccessStore
    from midterm.web.auth_api import install_access
    store = AccessStore(tmp_path / 'access.sqlite3')
    store.init_admin('admin', 'Admin', 'test password phrase 123')
    isolated = FastAPI()
    install_access(isolated, store=store, origins={'http://testserver'}, secure=False)
    isolated.include_router(berth_plan_api.router)
    with TestClient(isolated, headers={'Origin': 'http://testserver'}) as c:
        yield c


def test_requires_login(gated):
    assert gated.post('/api/berth-plan/recommend', json={}).status_code == 401


def test_default_body(api):
    r = api.post('/api/berth-plan/recommend', json={})
    assert r.status_code == 200
    body = r.json()
    assert body['horizon_days'] == 14 and body['options']


def test_valid_lock_is_accepted(api):
    lock = {'voyage_no': 'V-1', 'berth_id': 'BD-1', 'berth_at': '2026-11-13T08:00:00+09:00'}
    r = api.post('/api/berth-plan/recommend', json={'locks': [lock], 'horizon_days': 7, 'penalty_usd': 0})
    assert r.status_code == 200 and r.json()['horizon_days'] == 7


GOOD = {'voyage_no': 'V-1', 'berth_id': 'BD-1', 'berth_at': '2026-11-13T08:00:00+09:00'}


@pytest.mark.parametrize('body', [
    {'horizon_days': 0}, {'horizon_days': 31}, {'horizon_days': 'x'}, {'horizon_days': True},
    {'penalty_usd': -1}, {'penalty_usd': True}, {'unknown': 1}, [1],
    {'locks': 'x'},
    {'locks': [{**GOOD, 'voyage_no': 'NOPE'}]},
    {'locks': [{**GOOD, 'berth_id': 'BD-9'}]},
    {'locks': [{**GOOD, 'berth_id': 'BD-3'}]},  # 항차 저탄장 2는 BD-3에 맞지 않음
    {'locks': [{**GOOD, 'berth_at': '2026-11-11T08:00:00+09:00'}]},
    {'locks': [{**GOOD, 'berth_at': '어제'}]},
    {'locks': [{'voyage_no': 'V-1'}]},
])
def test_invalid_inputs_422(api, body):
    r = api.post('/api/berth-plan/recommend', json=body)
    assert r.status_code == 422, r.text


def test_does_not_write(api, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError('write attempted')
    monkeypatch.setattr(voyage_registry, 'commit', boom)
    monkeypatch.setattr(voyage_registry, 'purge', boom)
    monkeypatch.setattr(stock_baseline, 'save_baseline', boom)
    assert api.post('/api/berth-plan/recommend', json={}).status_code == 200


def test_registry_error_is_reported(api, monkeypatch):
    def fail(path, as_of, horizon):
        raise voyage_registry.RegistryError('원장 읽기 실패', 503)
    monkeypatch.setattr(berth_plan_api, 'load_inputs', fail)
    r = api.post('/api/berth-plan/recommend', json={})
    assert r.status_code == 503 and r.json()['detail'] == '원장 읽기 실패'
    assert 'options' not in r.json()


def test_unexpected_error_is_500_generic(api, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError('secret detail')
    monkeypatch.setattr(berth_plan_api, 'recommend_berth_plan', boom)
    r = api.post('/api/berth-plan/recommend', json={})
    assert r.status_code == 500 and r.json()['detail'] == '내부 오류(서버 로그 확인)'
