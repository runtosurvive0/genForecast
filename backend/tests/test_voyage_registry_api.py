import io
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from midterm.auth.store import AccessStore
from midterm.web.auth_api import install_access
from midterm.web.voyage_registry_api import router
from test_auth import login, PASSWORD
from test_voyage_registry import records


def test_receipt_plans_are_shared_revision_checked_and_do_not_change_inventory(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry/receipt-plans'
    plan = {'name':'11월 도착 검토', 'runId':'run-1', 'forecastStart':'2027-01-01', 'forecastHorizon':'30', 'groupId':'g14', 'arrival':'2027-01-02', 'quantity':'1000',
            'capacity':'', 'leadDays':'30', 'storageDays':'20', 'berth':'2', 'endpoint':'pile-7',
            'pileCapacity':'5000', 'projectedStock':'4000', 'useStart':'2027-01-03', 'dailyUse':'100'}
    with TestClient(app, headers={'Origin':'http://testserver'}) as client:
        assert client.get(base).status_code == 401
        login(client, 'member')
        assert client.get(base).json() == {'plans': []}
        response = client.post(base, json={'id':None, 'revision':0, 'plan':plan})
        assert response.status_code == 200
        saved = response.json()
        assert saved['revision'] == 1 and saved['plan'] == plan
        assert client.get(base).json()['plans'][0]['id'] == saved['id']
        update = client.post(base, json={'id':saved['id'], 'revision':1, 'plan':{**plan, 'dailyUse':'200'}})
        assert update.status_code == 200 and update.json()['revision'] == 2
        assert client.post(base, json={'id':saved['id'], 'revision':1, 'plan':plan}).status_code == 409
        assert client.post(base, json={'id':None, 'revision':0, 'plan':{**plan, 'quantity':'-5'}}).status_code == 422
        assert client.get('/api/voyage-registry/inventory').json()['lots'] == []


def test_voyage_receipt_assay_blend_and_rebased_supply_share_one_database(tmp_path):
    from datetime import timedelta
    from midterm.supply import read_supply, simulate, timestamp, UNITS
    store = AccessStore(tmp_path / 'auth.sqlite3')
    store.init_admin('admin', 'Admin', PASSWORD)
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        login(client)
        changes = {
            'voyages': [
                {'voyage_no':'V0','voyage_number':'26-1-001','berth_id':'BD-1','status':'completed'},
                {'voyage_no':'V1','voyage_number':'26-1-002','berth_id':'BD-1','status':'completed','actual_unload_end':'2026-11-04 12:00'}],
            'cargo': [
                {'cargo_no':'C0','voyage_no':'V0','destination_plant_id':'dangjin','coal_name':'BASE','planned_t':1000},
                {'cargo_no':'C1','voyage_no':'V1','destination_plant_id':'dangjin','coal_name':'NEW','planned_t':100,'received_t':100,'receipt_end_date':'2026-11-04'}],
            'assays': [
                {'assay_id':'A0','cargo_no':'C0','stage':'loading','result_status':'confirmed','analysis_date':'2026-11-01','gcv_arb':5500},
                {'assay_id':'A1','cargo_no':'C1','stage':'loading','result_status':'confirmed','analysis_date':'2026-11-02','gcv_arb':5000},
                {'assay_id':'A2','cargo_no':'C1','stage':'unloading','result_status':'confirmed','analysis_date':'2026-11-04','gcv_arb':5800,'tm_ar':10,'sulfur_ar':0.3},
                {'assay_id':'A3','cargo_no':'C1','stage':'buyer','result_status':'confirmed','analysis_date':'2026-11-05','gcv_arb':7000}]}
        assert client.post(base+'/commit',json={'changes':changes,'revision':0}).status_code == 200
        baseline={'as_of':'2026-11-03','lots':[{'location':'P1','coal_name':'BASE','voyage_number':'26-1-001','tonnes':1000}]}
        assert client.post(base+'/inventory/baseline',json={'baseline':baseline,'revision':0}).status_code == 200
        received=client.post(base+'/inventory/receipts',json={'cargo_no':'C1','allocations':[{'location':'P1','tonnes':100}],'revision':0})
        assert received.status_code == 200
        lot=received.json()['lots'][0]
        assert lot['assay']['stage']=='unloading' and lot['assay']['gcv_arb']==5800
        blend=client.post(base+'/blend/recommend',json={'lot_ids':[lot['id']],'criteria':{'tonnes':50,'target_gcv_arb':5800,'max_tm_ar':12,'max_sulfur_ar':0.5}})
        assert blend.status_code == 200 and blend.json()['status']=='ok'
        start=timestamp('2026-11-04T00:00:00+09:00')
        zero_plan={(start+timedelta(hours=i)).isoformat():{unit:{'mw':0,'online':False} for unit in UNITS} for i in range(96)}
        before=simulate(read_supply(app.state.voyage_registry_path),zero_plan,timestamp('2026-11-05T00:00:00+09:00'),1)
        assert before['groups'][0]['stock']==pytest.approx(1100)
        assert before['groups'][0]['received']==pytest.approx(100)
        rebased={'as_of':'2026-11-05','lots':[{'location':'P1','coal_name':'BASE','voyage_number':'26-1-001','tonnes':1000},
                                                {'location':'P1','coal_name':'NEW','voyage_number':'26-1-002','tonnes':100}]}
        assert client.post(base+'/inventory/baseline',json={'baseline':rebased,'revision':1}).status_code==200
        after=simulate(read_supply(app.state.voyage_registry_path),zero_plan,timestamp('2026-11-06T00:00:00+09:00'),1)
        assert after['groups'][0]['stock']==pytest.approx(1100)
        assert after['groups'][0]['received']==pytest.approx(0)


def test_approved_member_can_record_yard_baseline_without_cargo(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry/inventory/baseline'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        assert client.get(base).status_code == 401
        login(client, 'member')
        payload = {'revision': 0, 'baseline': {'as_of': '2026-11-04', 'lots': [
            {'location': 'P1', 'coal_name': 'COAL A', 'tonnes': 100}]}}
        assert client.post(base, json=payload).status_code == 200
        assert client.get(base).json()['total_t'] == 100
        assert client.post(base, json=payload).status_code == 422


def test_baseline_blend_never_invents_missing_quality(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    store.init_admin('admin', 'Admin', PASSWORD)
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        login(client)
        baseline = {'as_of':'2026-11-04','lots':[{'source_id':'A','location':'P1','coal_name':'TEST','tonnes':100}]}
        assert client.post(base + '/inventory/baseline',json={'revision':0,'baseline':baseline}).status_code == 200
        result = client.post(base + '/blend/baseline-recommend',json={'lot_ids':['A'],'revision':1,
            'criteria':{'tonnes':10,'target_gcv_arb':5500}})
        assert result.status_code == 200
        assert result.json()['status'] == 'infeasible'
        assert result.json()['excluded'][0]['missing'] == ['gcv_arb']
        assert result.json()['as_of'] == '2026-11-04'


def test_excel_api_imports_unnumbered_grouped_cargo_and_analysis(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    store.init_admin('admin', 'Admin', PASSWORD)
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        login(client)
        book = load_workbook(io.BytesIO(client.get(base + '/template').content))
        sheet = book['배선등록']
        headers = {cell.value: cell.column for cell in sheet[1]}
        for row, coal in [(2, 'COAL A'), (3, 'COAL B')]:
            for label, value in {'배선 묶음': 'A', '화물순번': row - 1, '탄종': coal,
                                 '목적발전소코드': '당진', '예정물량(t)': 100}.items():
                sheet.cell(row, headers[label], value)
        sheet = book['성상분석']
        headers = {cell.value: cell.column for cell in sheet[1]}
        for label, value in {'배선 묶음': 'A', '화물순번': 2, '분석구분': '하역'}.items():
            sheet.cell(2, headers[label], value)
        stream = io.BytesIO()
        book.save(stream)
        raw = stream.getvalue()
        response = client.post(base + '/excel/preview', content=raw)
        assert response.status_code == 200
        result = response.json()
        assert not result['errors']
        assert not client.get(base + '/records').json()['voyages']
        response = client.post(base + '/excel/commit', content=raw,
                               params={'revision': result['revision'], 'file_digest': result['file_digest']})
        assert response.status_code == 200
        saved = client.get(base + '/records').json()
        assert len(saved['voyages']) == 1 and saved['voyages'][0]['voyage_number'] is None
        assert len(saved['cargo']) == 2
        assert saved['assays'][0]['cargo_no'] == next(c['cargo_no'] for c in saved['cargo'] if c['coal_name'] == 'COAL B')


def test_registry_api_access_excel_conflict_and_persistence(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        assert client.get(base + '/records').status_code == 401
        login(client, 'member')
        assert client.get(base + '/template').status_code == 200
        assert client.post(base + '/commit', json={'changes': {}, 'revision': 0}).status_code == 200
        login(client)
        missing = client.headers.pop('X-Account-ID')
        assert client.post(base + '/preview', json={'changes': records()}).status_code == 403
        client.headers['X-Account-ID'] = missing
        token = client.headers.pop('X-CSRF-Token')
        assert client.post(base + '/preview', json={'changes': records()}).status_code == 403
        client.headers['X-CSRF-Token'] = token
        result = client.post(base + '/preview', json={'changes': records()})
        assert result.status_code == 200 and result.json()['counts']['create'] == 3
        assert client.get(base + '/records').json()['revision'] == 0
        assert client.post(base + '/commit', json={'changes': records(), 'revision': 0}).json()['revision'] == 1
        book = client.get(base + '/export').content
        changes = records(); changes['ships'][0]['name'] = 'Updated ship'
        assert client.post(base + '/commit', json={'changes': changes, 'revision': 1}).status_code == 200
        preview = client.post(base + '/excel/preview', content=book).json()
        assert preview['stale_workbook'] and preview['counts']['update'] == 1
        query = {'revision': preview['revision'], 'file_digest': preview['file_digest']}
        assert client.post(base + '/excel/commit', params=query, content=book).status_code == 409
        assert client.post(base + '/excel/commit', params={**query, 'acknowledge_stale': True}, content=book + b'changed').status_code == 409
        assert client.post(base + '/excel/commit', params={**query, 'acknowledge_stale': True}, content=book).json()['revision'] == 3
        assert client.post(base + '/commit', json={'changes': records(), 'revision': 1}).status_code == 409
        assert client.post(base + '/excel/preview', content=b'not xlsx').status_code == 422
        assert client.get(base + '/records').json()['ships'][0]['name'] == 'TEST BULK'
        login(client, 'member')
        changed = records(); changed['ships'][0]['notes'] = 'Approved team member edit'
        saved = client.post(base + '/commit', json={'changes': changed, 'revision': 3})
        assert saved.status_code == 200 and saved.json()['revision'] == 4
        assert saved.json()['audit'][0]['actor'] == member['id']
        assert saved.json()['ships'][0]['notes'] == 'Approved team member edit'
        # Wider operational writes retain their existing admin-only policy.
        assert client.put('/api/settings', json={}).status_code == 403


def test_pile_receipt_and_blend_api_use_shared_inventory_and_confirmed_assay(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    admin = store.init_admin('admin', 'Admin', PASSWORD)
    member = store.register('member', 'Member', PASSWORD)
    store.change_user(admin['id'], member['id'], 'approve', member['version'])
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    base = '/api/voyage-registry'
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        assert client.get(base + '/inventory').status_code == 401
        login(client, 'member')
        changes = {'voyages': [{'voyage_no': 'V1', 'status': 'completed', 'actual_unload_end': '2026-11-04 12:00'}],
                   'cargo': [{'cargo_no': 'C1', 'voyage_no': 'V1', 'destination_plant_id': 'dangjin',
                              'coal_name': 'TEST', 'planned_t': 100, 'received_t': 100, 'receipt_end_date': '2026-11-04'}],
                   'assays': [{'assay_id': 'A1', 'cargo_no': 'C1', 'stage': 'unloading',
                               'result_status': 'confirmed', 'gcv_arb': 5500, 'tm_ar': 10, 'sulfur_ar': .3}]}
        assert client.post(base + '/commit', json={'changes': changes, 'revision': 0}).status_code == 200
        response = client.post(base + '/inventory/receipts', json={'cargo_no': 'C1', 'allocations': [{'location': 'P1', 'tonnes': 100}], 'revision': 0})
        assert response.status_code == 200
        lot = response.json()['lots'][0]
        result = client.post(base + '/blend/recommend', json={'lot_ids': [lot['id']], 'criteria': {'tonnes': 50, 'target_gcv_arb': 5500, 'max_sulfur_ar': .5}})
        assert result.status_code == 200 and result.json()['status'] == 'ok'
        assert result.json()['lots'][0]['tonnes'] == 50
        assert client.post(base + '/blend/recommend', json={'lot_ids': [999], 'criteria': {'tonnes': 50, 'target_gcv_arb': 5500}}).status_code == 422
        assert client.get(base + '/inventory').json()['lots'][0]['remaining_t'] == 100
        correction = {'cargo_no':'C1','allocations':[{'location':'P5','tonnes':100,'remaining_t':90}],
                      'reason':'위치 정정','revision':1,'registry_revision':1}
        result = client.post(base + '/inventory/reconcile', json=correction)
        assert result.status_code == 200
        assert result.json()['lots'][0]['location'] == 'P5'
        assert result.json()['reconciliations'][0]['actor'] == member['id']
        assert result.json()['reconciliations'][0]['actor_name'] == 'Member'
        assert client.post(base + '/inventory/reconcile', json=correction).status_code == 422


def test_api_commit_still_rejects_dummy_origin(tmp_path):
    store = AccessStore(tmp_path / 'auth.sqlite3')
    store.init_admin('admin', 'Admin', PASSWORD)
    app = FastAPI()
    app.state.voyage_registry_path = tmp_path / 'registry.sqlite3'
    app.include_router(router)
    install_access(app, store, {'http://testserver'}, secure=False)
    changes = records()
    changes['voyages'][0].update(data_origin='dummy', dummy_fields='status')
    changes['cargo'][0].update(data_origin='dummy')
    with TestClient(app, headers={'Origin': 'http://testserver'}) as client:
        login(client)
        response = client.post('/api/voyage-registry/commit', json={'changes': changes, 'revision': 0})
        assert response.status_code == 200
        saved = response.json()
    assert {a['origin'] for a in saved['audit']} == {'manual'}
    assert {r['data_origin'] for r in saved['voyages'] + saved['cargo']} == {'entered'}
    assert saved['voyages'][0]['dummy_fields'] is None
