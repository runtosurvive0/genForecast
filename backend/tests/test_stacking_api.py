"""적치 추천 API 시험. 격리된 임시 경로만 쓰고 저장 함수는 호출되지 않아야 한다."""
import pytest

from midterm import stock_baseline, voyage_registry
from midterm.web import stacking_api
from midterm.web.app import app
from test_supply_api import client  # noqa: F401  (인증된 서버 픽스처 재사용)

AS_OF = '2026-11-08'
LOT = {'location': 'A1', 'coal_name': '탄', 'tonnes': 1000, 'voyage_number': 'V0', 'grade': '저열량',
       'age_days': 5, 'temperature_c': 20, 'start_m': None, 'end_m': None}
REGISTER = {
    'ships': [{'ship_code': 'S1', 'name': '한빛호'}],
    'voyages': [
        {'voyage_no': 'V1', 'ship_code': 'S1', 'voyage_number': '26-2-001', 'status': 'arrived', 'berth_id': 'BD-1',
         'yard': '1', 'planned_arrival': '2026-11-12T09:00', 'actual_unload_end': None},
        {'voyage_no': 'V2', 'ship_code': 'S1', 'voyage_number': '26-2-002', 'status': 'arrived', 'berth_id': None,
         'yard': '1', 'planned_arrival': '2026-11-13T09:00', 'actual_unload_end': None},
    ],
    'cargo': [{'cargo_no': 'C1', 'voyage_no': v, 'destination_plant_id': 'dangjin', 'coal_name': 'Glencore',
               'planned_t': 5000, 'bl_t': None, 'cv': 5500} for v in ('V1', 'V2')],
}
SCENARIO = {'source': 'scenario', 'ref': 'S1', 'vessel_name': '선박', 'voyage_number': 'V9', 'coal_name': '탄',
            'grade': '저', 'cv': 4800, 'tonnes': 6000, 'berth': 1, 'destination_yard': None}


@pytest.fixture
def api(client, tmp_path, monkeypatch):  # noqa: F811
    app.dependency_overrides[stacking_api.get_stacking_paths] = lambda: tmp_path / 'stacking.sqlite3'
    monkeypatch.setattr(stacking_api, 'snapshot', lambda path: REGISTER)
    monkeypatch.setattr(stacking_api, 'read_baseline',
                        lambda path: {'revision': 1, 'as_of': AS_OF, 'lots': [LOT], 'total_t': 1000})
    yield client
    app.dependency_overrides.clear()


def test_recommend_scenario_cargo(api):
    r = api.post('/api/stacking/recommend', json=SCENARIO)
    assert r.status_code == 200
    body = r.json()
    assert body['as_of'] == AS_OF and len(body['options']) >= 1


def test_recommend_by_voyage_no(api):
    r = api.post('/api/stacking/recommend', json={'voyage_no': 'V1'})
    assert r.status_code == 200 and r.json()['cargo']['ref'] == 'V1'


def test_recommend_by_voyage_no_blocked_reason(api):
    r = api.post('/api/stacking/recommend', json={'voyage_no': 'V2'})
    assert r.status_code == 200
    assert r.json() == {'as_of': AS_OF, 'cargo': None, 'options': [], 'no_fit': None, 'gaps': [],
                        'blocked': '부두 미배정'}
    assert api.post('/api/stacking/recommend', json={'voyage_no': 'NOPE'}).json()['blocked'] == '항차 없음'


def test_candidates(api):
    r = api.get('/api/stacking/candidates')
    assert r.status_code == 200
    body = r.json()
    assert body['as_of'] == AS_OF
    assert [i['voyage_no'] for i in body['items']] == ['V1']  # V2는 부두 미배정이라 대기 후보 아님


def test_missing_baseline_is_blocked_not_error(api, monkeypatch):
    monkeypatch.setattr(stacking_api, 'read_baseline',
                        lambda path: {'revision': 0, 'as_of': None, 'lots': [], 'total_t': None})
    r = api.post('/api/stacking/recommend', json=SCENARIO)
    assert r.status_code == 200 and r.json()['blocked'] == '기준재고 없음'


def test_invalid_body_422(api):
    assert api.post('/api/stacking/recommend', json={**SCENARIO, 'tonnes': 0}).status_code == 422
    assert api.post('/api/stacking/recommend', json={**SCENARIO, 'voyage_no': 'V1'}).status_code == 422
    assert api.post('/api/stacking/recommend', json=[1]).status_code == 422
    assert api.post('/api/stacking/recommend', json={'voyage_no': 5}).status_code == 422


def test_unexpected_error_is_500_generic(api, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError('secret detail')
    monkeypatch.setattr(stacking_api, 'recommend', boom)
    r = api.post('/api/stacking/recommend', json=SCENARIO)
    assert r.status_code == 500 and r.json()['detail'] == '내부 오류(서버 로그 확인)'


def test_rate_limited_after_60(api):
    codes = [api.get('/api/stacking/candidates').status_code for _ in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429


def test_does_not_write(api, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError('write attempted')
    monkeypatch.setattr(stock_baseline, 'save_baseline', boom)
    monkeypatch.setattr(voyage_registry, 'commit', boom)
    assert api.post('/api/stacking/recommend', json=SCENARIO).status_code == 200
    assert api.post('/api/stacking/recommend', json={'voyage_no': 'V1'}).status_code == 200
    assert api.get('/api/stacking/candidates').status_code == 200


@pytest.fixture
def gated(tmp_path, monkeypatch):
    """실제 인증 경계(install_access)만 붙인 격리 앱."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from midterm.auth.store import AccessStore
    from midterm.web.auth_api import install_access
    store = AccessStore(tmp_path / 'access.sqlite3')
    store.init_admin('admin', 'Admin', 'test password phrase 123')
    isolated = FastAPI()
    install_access(isolated, store=store, origins={'http://testserver'}, secure=False)
    isolated.include_router(stacking_api.router)
    isolated.dependency_overrides[stacking_api.get_stacking_paths] = lambda: tmp_path / 'stacking.sqlite3'
    monkeypatch.setattr(stacking_api, 'snapshot', lambda path: REGISTER)
    monkeypatch.setattr(stacking_api, 'read_baseline',
                        lambda path: {'revision': 1, 'as_of': AS_OF, 'lots': [LOT], 'total_t': 1000})
    with TestClient(isolated, headers={'Origin': 'http://testserver'}) as c:
        yield c


def _login(c):
    c.headers['X-CSRF-Token'] = c.get('/api/auth/csrf').json()['token']
    r = c.post('/api/auth/login', json={'username': 'admin', 'password': 'test password phrase 123'})
    assert r.status_code == 200, r.text
    c.headers['X-Account-ID'] = r.json()['user']['id']
    c.headers['X-CSRF-Token'] = c.get('/api/auth/csrf').json()['token']


def test_requires_login(gated):
    assert gated.get('/api/stacking/candidates').status_code == 401
    assert gated.post('/api/stacking/recommend', json=SCENARIO).status_code == 401


def test_csrf_required_for_post(gated):
    _login(gated)
    assert gated.post('/api/stacking/recommend', json=SCENARIO).status_code == 200
    assert gated.get('/api/stacking/candidates').status_code == 200
    gated.headers.pop('X-CSRF-Token')
    assert gated.post('/api/stacking/recommend', json=SCENARIO).status_code == 403
