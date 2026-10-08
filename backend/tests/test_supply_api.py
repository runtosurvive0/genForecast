from datetime import timedelta
import json as jsonlib
import socket
import threading
import time
import urllib.request
import urllib.error
from urllib.parse import urlencode
from types import SimpleNamespace

import pytest
import numpy as np
import uvicorn

from midterm.database import connect, load_settings
from midterm.supply import read_supply, timestamp, now
from midterm.supply_plans import latest_forecast
from midterm.web import supply_api
from midterm.web.app import app
from midterm.web import planning_api


@pytest.fixture
def saved_snapshot_run(tmp_path, monkeypatch):
    from midterm import supply_plans
    from midterm.supply import UNITS
    root = tmp_path / 'backend'
    folder = root / 'runs' / 'snapshot-test'
    folder.mkdir(parents=True)
    days = 97
    summary = {'scenario': {'name': '합성 API 검증', 'start': '2027-01-01', 'end': '2027-04-07'},
        'warnings': [], 'model_info': {'source': 'synthetic test'},
        'classification': 'functional_demo', 'classification_note': '합성 검증 자료',
        'outages': {'coal': [{'unit':'당진1', 'start':'2027-01-01', 'end':'2027-01-02', 'note':'검증 정비'}]},
        'unit_capacity_mw': {u: 500 if int(u.removeprefix('당진')) < 9 else 1000 for u in UNITS},
        'daily': [{'date': (timestamp('2027-01-01') + timedelta(days=i)).date().isoformat(),
                   'coal_solved_avg_mw': 1000, 'starts': 0, 'units_online_avg': 10} for i in range(days)]}
    (folder / 'summary.json').write_text(jsonlib.dumps(summary), encoding='utf-8')
    out = np.full((days * 24, 10), 100., dtype=np.float32)
    out[:48, 0] = 0
    np.savez_compressed(folder / 'hourly.npz', names=np.array(list(UNITS)), output=out, online=out > 0,
        demand=np.full(days*24, 80000.), solar=np.full(days*24, 10000.),
        coal_model=np.full(days*24, 20000.), coal_target=np.full(days*24, 19000.),
        coal_available=np.full(days*24, 50000.))
    monkeypatch.setattr(supply_plans, 'ROOT', root)
    monkeypatch.setattr(supply_api, 'ROOT', root)
    return folder


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / 'planning.sqlite3'
    monkeypatch.setattr(supply_api, 'connect', lambda: connect(path))
    monkeypatch.setattr(supply_api, 'read_supply', lambda: read_supply(path))
    monkeypatch.setattr(supply_api, 'load_settings', lambda: load_settings(path))
    monkeypatch.setattr(supply_api, 'latest_forecast', lambda: latest_forecast(path))
    from midterm.supply_plans import db_plan
    monkeypatch.setattr(supply_api, 'db_plan', lambda batch: db_plan(batch, path))
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level='error'))
    thread = threading.Thread(target=server.run, kwargs={'sockets':[sock]}, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(.02)
    assert server.started

    class Client:
        def request(self, method, path, json=None, params=None):
            url = f'http://127.0.0.1:{port}' + path + ('?' + urlencode(params) if params else '')
            body = jsonlib.dumps(json).encode() if json is not None else None
            req = urllib.request.Request(url, body, headers={'Content-Type':'application/json'}, method=method)
            try:
                response = urllib.request.urlopen(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                payload = jsonlib.loads(response.read())
                return SimpleNamespace(status_code=response.code, json=lambda:payload)

        def get(self, path, params=None):
            return self.request('GET', path, params=params)

        def post(self, path, json):
            return self.request('POST', path, json=json)

        def put(self, path, json):
            return self.request('PUT', path, json=json)

    yield Client()
    server.should_exit = True
    thread.join(timeout=5)
    sock.close()


def test_browser_query_accepts_integer_horizon_and_uses_unknown_without_inputs(client):
    result = client.get('/api/supply/dashboard?horizon=30&at=2026-10-08T01:00')
    assert result.status_code == 200
    assert result.json()['kpis']['risk'] == 'unknown'
    assert client.get('/api/supply/dashboard?horizon=10').status_code == 400


def test_snapshot_serves_ten_units_and_full_months_without_inventing_inventory(client, saved_snapshot_run):
    result = client.get('/api/planning/runs/snapshot-test/snapshot?start=2027-01-01&horizon=90')
    assert result.status_code == 200
    body = result.json()
    assert body['plant_id'] == 'dangjin' and body['horizon_days'] == 90
    assert len(body['units']) == 10 and len(body['daily']) == 90
    assert body['daily'][0]['date'] == '2027-01-01' and body['daily'][-1]['date'] == '2027-03-31'
    unit = body['units'][0]
    assert unit['generation_mwh'] == 88 * 24 * 100
    assert unit['capacity_factor_pct'] == pytest.approx(88 * 100 / (90 * 500) * 100)
    assert body['inventory']['kpis']['stock'] is None
    assert body['inventory']['kpis']['risk'] == 'unknown'
    assert body['inventory']['thresholds'] == {'danger_days': 7.0, 'normal_days': 15.0}
    assert body['models'][0]['coal_available_mw'] == 50000
    assert body['models'][0]['coal_target_mw'] == 19000
    assert body['outages'][0]['end_at'] == '2027-01-03T00:00:00+09:00'
    assert body['monthly'][0]['complete_days'] == 31
    assert body['monthly'][-1]['fuel_tonnes'] is None
    assert body['monthly'][-1]['complete_days'] == 7
    assert sum(u['fuel_tonnes'] for u in body['units']) == pytest.approx(sum(d['fuel_tonnes'] for d in body['daily']))


def test_snapshot_rejects_out_of_period_and_keeps_missing_hours_unknown(client, saved_snapshot_run):
    assert client.get('/api/planning/runs/missing/snapshot').status_code == 404
    assert client.get('/api/planning/runs/snapshot-test/snapshot?horizon=10').status_code == 400
    assert client.get('/api/planning/runs/snapshot-test/snapshot?start=2027-04-01&horizon=30').status_code == 400
    assert client.get('/api/planning/runs/snapshot-test/snapshot?start=2026-12-31&horizon=7').status_code == 400
    path = saved_snapshot_run / 'hourly.npz'
    with np.load(path) as stored:
        fields = {k: stored[k] for k in stored.files}
    del fields['coal_available']
    # Missing last day invalidates that day, its unit aggregate and its full month.
    fields['output'] = fields['output'][:-1]
    fields['online'] = fields['online'][:-1]
    np.savez_compressed(path, **fields)
    body = client.get('/api/planning/runs/snapshot-test/snapshot?start=2027-04-01&horizon=7').json()
    assert body['daily'][-1]['generation_mwh'] is None
    assert body['daily'][-1]['fuel_tonnes'] is None
    assert body['units'][0]['capacity_factor_pct'] is None
    assert body['models'][0]['coal_available_mw'] is None
    assert any('가용용량' in issue for issue in body['issues'])


def test_vessel_correction_persists_version_and_rejects_backward_time(client):
    start = now() - timedelta(hours=5)
    vessel = client.post('/api/supply/vessels', json={
        'name': '테스트 선박', 'cargo': 1000, 'incoming_cv': 6000,
        'arrival_at': start.isoformat(), 'start_at': start.isoformat(), 'rate': 100,
        'allocations': {'g14':100, 'g58':0, 'g910':0}})
    assert vessel.status_code == 200
    vid = vessel.json()['id']
    point = {'at': (start + timedelta(hours=2)).isoformat(), 'rate':100,
             'allocations': {'g14':0, 'g58':100, 'g910':0}}
    corrected = client.post(f'/api/supply/vessels/{vid}/unloading', json=point)
    assert corrected.status_code == 200
    assert corrected.json()['cumulative'] == pytest.approx(200)
    assert client.post(f'/api/supply/vessels/{vid}/unloading', json=point).status_code == 400
    v = client.get('/api/supply/records').json()['vessels'][0]
    assert len(v['points']) == 2
    assert v['points'][0]['allocations']['g14'] == 1
    assert v['points'][1]['allocations']['g58'] == 1


def test_invalid_allocation_does_not_insert_half_vessel(client):
    at = now().isoformat()
    result = client.post('/api/supply/vessels', json={'name':'bad','cargo':1000,'incoming_cv':5500,
        'arrival_at':at, 'start_at':at, 'rate':100, 'allocations':{'g14':0,'g58':0,'g910':0}})
    assert result.status_code == 400
    assert not client.get('/api/supply/records').json()['vessels']


def test_future_vessel_delay_is_audited_and_moves_receipts(client):
    at = now() + timedelta(days=1)
    body = {'name':'지연 테스트','cargo':1000,'incoming_cv':6000,'arrival_at':at.isoformat(),
            'start_at':at.isoformat(),'rate':100,'allocations':{'g14':100,'g58':0,'g910':0}}
    vid = client.post('/api/supply/vessels',json=body).json()['id']
    change = {'arrival_at':(at+timedelta(days=2)).isoformat(), 'start_at':(at+timedelta(days=2,hours=1)).isoformat()}
    assert client.put(f'/api/supply/vessels/{vid}/schedule',json=change).status_code == 200
    r = client.get('/api/supply/records').json()
    assert len(r['schedule_changes']) == 1
    assert r['vessels'][0]['points'][0]['at'] == change['start_at']
    assert jsonlib.loads(r['schedule_changes'][0]['old_schedule'])['start_at'] == at.isoformat()


def test_plan_import_rejects_duplicate_or_invalid_output_without_partial_write(client):
    at = '2026-10-08T00:00:00+09:00'
    row = {'at':at,'unit':'당진1','mw':100,'online':True}
    body = {'source':'API','source_name':'테스트 원천','as_of':at,'rows':[row,row]}
    assert client.post('/api/supply/plans',json=body).status_code == 400
    body['rows'] = [{**row,'mw':600}]
    assert client.post('/api/supply/plans',json=body).status_code == 400
    assert not client.get('/api/supply/records').json()['plan_batches']


def test_normalized_api_plan_runs_through_same_inventory_path(client):
    at = now().replace(minute=0,second=0,microsecond=0)
    for g in ('g14','g58','g910'):
        result = client.post('/api/supply/baselines',json={'group_id':g,'at':at.isoformat(),
            'tonnes':100000,'cv':5500,'moisture':10,'ash':10,'sulfur':.5})
        assert result.status_code == 200
    start = at.replace(hour=0)
    rows = [{'at':(start+timedelta(hours=h)).isoformat(),'unit':f'당진{i}','mw':300 if i<9 else 600,'online':True}
            for h in range(15*24) for i in range(1,11)]
    batch = client.post('/api/supply/plans',json={'source':'API','source_name':'테스트 계획',
                       'as_of':at.isoformat(),'rows':rows})
    assert batch.status_code == 200
    result = client.get('/api/supply/dashboard',params={'horizon':7,'at':at.isoformat(),'plan_key':f'db:{batch.json()["id"]}'}).json()
    assert result['kpis']['stock'] == 300000
    assert result['kpis']['today_burn'] > 0
    assert all(u['cf_pct'] is not None for u in result['units'])
    assert result['plan_source']['source'] == 'API'
    calendar = result['fuel_calendar']
    assert calendar['year'] == at.year
    assert next(d for d in calendar['daily'] if d['day'] == start.date().isoformat())['unit_tonnes']['당진1'] > 0
    assert any(m['unit_tonnes']['당진1'] is None for m in calendar['monthly'])


def test_local_mip_adapter_preserves_source_period_and_national_curve():
    from midterm.supply_plans import run_plan
    from midterm.scenario import ROOT
    run_id = '20261004-111057-2027기본'
    if not (ROOT / 'runs' / run_id / 'hourly.npz').exists():
        pytest.skip('보존된 로컬 실행 파일 없음')
    plan, forecast, source = run_plan(run_id)
    assert len(plan) == 365*24
    assert len(forecast) == 365
    assert source['start'] == '2027-01-01'
    assert set(next(iter(plan.values()))) == {f'당진{i}' for i in range(1,11)}
    assert forecast[0]['coal_ml_mw'] is not None
    assert forecast[0]['coal_mip_mw'] is not None
