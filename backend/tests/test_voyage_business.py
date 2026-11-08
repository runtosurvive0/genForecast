import io
from datetime import datetime
import pytest
from openpyxl import load_workbook
from midterm.voyage_registry import snapshot, preview, commit, KST
from midterm.voyage_registry_excel import workbook_bytes, parse_workbook


def test_excel_drafts_group_cargo_without_plan_name_and_keep_existing_roundtrip(tmp_path):
    path = tmp_path / 'draft-groups.db'
    book = load_workbook(io.BytesIO(workbook_bytes(snapshot(path), template=True, business=True)))
    voyages = book['배선등록']
    headers = {cell.value: cell.column for cell in voyages[1]}
    assert '계획명' not in headers
    assert '배선 묶음' in headers
    for row, coal in [(2, 'COAL A'), (3, 'COAL B')]:
        for label, value in {'배선 묶음': 'A', '화물순번': row - 1, '탄종': coal,
                             '목적발전소코드': '당진', '예정물량(t)': 100}.items():
            voyages.cell(row, headers[label], value)
    assays = book['성상분석']
    assay_headers = {cell.value: cell.column for cell in assays[1]}
    assert '계획명' not in assay_headers
    for label, value in {'배선 묶음': 'A', '화물순번': 2, '분석구분': '하역'}.items():
        assays.cell(2, assay_headers[label], value)
    stream = io.BytesIO(); book.save(stream); raw = stream.getvalue()
    parsed, revision = parse_workbook(raw)
    assert revision is None
    assert parsed == parse_workbook(raw)[0]
    saved = commit(parsed, 0, 'test', 'excel', path)
    assert len(saved['voyages']) == 1
    assert saved['voyages'][0]['voyage_number'] is None
    assert saved['voyages'][0]['plan_name'] is None
    assert len(saved['cargo']) == 2
    assert saved['assays'][0]['cargo_no'] == next(c['cargo_no'] for c in saved['cargo'] if c['coal_name'] == 'COAL B')
    assert not preview(parse_workbook(raw)[0], path)['changes']
    exported, _ = parse_workbook(workbook_bytes(saved, business=True))
    assert not preview(exported, path)['changes']


def test_excel_single_unnumbered_row_needs_no_group_and_legacy_headers_still_work(tmp_path):
    for legacy in (False, True):
        path = tmp_path / ('legacy.db' if legacy else 'single.db')
        book = load_workbook(io.BytesIO(workbook_bytes(snapshot(path), template=True, business=True)))
        if legacy:
            for title in ('배선등록', '성상분석'):
                for cell in book[title][1]:
                    if cell.value == '배선 묶음':
                        cell.value = '계획명'
        sheet = book['배선등록']
        headers = {cell.value: cell.column for cell in sheet[1]}
        for label, value in {'탄종': 'TEST', '목적발전소코드': '당진', '예정물량(t)': 100}.items():
            sheet.cell(2, headers[label], value)
        if legacy:
            sheet.cell(2, headers['계획명'], '이전 배선')
        stream = io.BytesIO(); book.save(stream)
        parsed, _ = parse_workbook(stream.getvalue())
        saved = commit(parsed, 0, 'test', 'excel', path)
        assert len(saved['voyages']) == len(saved['cargo']) == 1
        assert saved['voyages'][0]['voyage_number'] is None
        assert saved['voyages'][0]['plan_name'] == ('이전 배선' if legacy else None)


def test_draft_can_receive_number_without_losing_cargo(tmp_path):
    path = tmp_path / 'draft.db'
    changes = {'voyages': [{'voyage_no': 'PLAN-A', 'plan_name': '시험 배선', 'status': 'planned'}],
               'cargo': [{'cargo_no': 'C-A', 'voyage_no': 'PLAN-A', 'destination_plant_id': 'dangjin',
                          'coal_name': 'TEST', 'planned_t': 12000, 'receipt_date': '2026-11-06'}]}
    saved = commit(changes, 0, 'test', 'manual', path)
    assert saved['voyages'][0]['ship_code'] is None
    voyage = {k: v for k, v in saved['voyages'][0].items() if not k.startswith('updated_')}
    voyage['voyage_number'] = '1-19'
    saved = commit({'voyages': [voyage]}, 1, 'test', 'manual', path)
    assert saved['voyages'][0]['voyage_number'] == f'{datetime.now(KST).year % 100:02}-1-019'
    assert saved['cargo'][0]['voyage_no'] == 'PLAN-A'
    assert saved['cargo'][0]['receipt_date'] == '2026-11-06'
    assert len(saved['audit']) == 3
    bad = {**voyage, 'voyage_no': 'PLAN-B'}
    assert any('중복' in e['message'] for e in preview({'voyages': [bad]}, path)['errors'])


def test_assays_preserve_three_stages_and_select_unloading(tmp_path):
    path = tmp_path / 'assays.db'
    commit({'voyages': [{'voyage_no': 'V', 'status': 'planned'}], 'cargo': [
        {'cargo_no': 'C', 'voyage_no': 'V', 'destination_plant_id': 'dangjin', 'coal_name': 'TEST', 'planned_t': 1}]},
        0, 'test', 'manual', path)
    base = {'cargo_no': 'C', 'result_status':'confirmed', 'cv': 5500, 'cv_basis': 'GAR', 'moisture_pct': 20,
            'ash_pct': 10, 'sulfur_pct': .2, 'analysis_basis': 'AR', 'analysis_date': '2026-11-05'}
    rows = [{**base, 'assay_id': stage, 'stage': stage} for stage in ('loading', 'unloading', 'buyer')]
    rows[1]['cv'] = 5300
    saved = commit({'assays': rows}, 1, 'test', 'manual', path)
    assert len(saved['assays']) == 3
    assert saved['quality_selection']['C']['assay_id'] == 'unloading'
    assert saved['quality_selection']['C']['cv'] == 5300
    rows[1]['ash_pct'] = None
    saved = commit({'assays': [rows[1]]}, 2, 'test', 'manual', path)
    assert saved['quality_selection']['C']['ash_pct'] is None
    assert 'ash_adb' in saved['quality_selection']['C']['missing']
    assert saved['cargo'][0]['cv'] is None
    assert preview({'assays': [{**base, 'assay_id': 'X', 'stage': 'loading', 'cargo_no': 'missing'}]}, path)['errors']


def test_business_workbook_roundtrip_draft_multicargo_and_assays(tmp_path):
    path = tmp_path / 'excel.db'
    changes = {'voyages': [{'voyage_no': 'P', 'plan_name': '시험 계획', 'status': 'planned', 'laycan_start': '2026-11-01', 'charter_type': 'long_term'}],
               'cargo': [{'cargo_no': f'C{i}', 'voyage_no': 'P', 'coal_name': f'TEST{i}', 'destination_plant_id': 'dangjin',
                          'planned_t': 1000 * i, 'contract_type': 'tender', 'incoterms': 'FOB'} for i in (1, 2)]}
    saved = commit(changes, 0, 'test', 'manual', path)
    raw = workbook_bytes(saved, business=True)
    book = load_workbook(io.BytesIO(raw))
    assert '배선등록' in book and '성상분석' in book
    rows, revision = parse_workbook(raw)
    assert revision == 1
    result = preview(rows, path)
    assert not result['errors'] and not result['changes']


def test_business_entries_generate_internal_ids_and_reject_conflicting_repeats(tmp_path):
    path = tmp_path / 'entries.db'
    base = {'plan_name': '시험 신규 배선', 'status': 'planned', 'name': 'TEST BULK', 'imo': '1234567',
            'origin_port': 'TEST PORT', 'coal_name': 'TEST', 'destination_plant_id': 'dangjin', 'planned_t': 100}
    entries = [{**base, 'cargo_index': i} for i in (1, 2)]
    saved = commit({'entries': entries}, 0, 'test', 'excel', path)
    assert len(saved['ships']) == 1 and len(saved['voyages']) == 1 and len(saved['cargo']) == 2
    assert not preview({'entries': entries}, path)['changes']
    entries[1]['origin_port'] = 'DIFFERENT'
    with pytest.raises(Exception, match='같은 배선'):
        commit({'entries': entries}, 1, 'test', 'excel', path)


def test_analysis_bases_ash_conversion_and_unknown_ncv(tmp_path):
    path = tmp_path / 'quality.db'
    commit({'voyages':[{'voyage_no':'V','status':'planned'}], 'cargo':[
        {'cargo_no':'C','voyage_no':'V','coal_name':'TEST','destination_plant_id':'dangjin','planned_t':10}]},0,'test','manual',path)
    row = {'assay_id':'A','cargo_no':'C','stage':'unloading','result_status':'confirmed',
           'gcv_arb':5000,'gcv_adb':6000,'gcv_db':6250,'ncv':4800,'ncv_basis':'unknown',
           'tm_ar':20,'sulfur_ar':.3,'im_adb':4,'ash_adb':12,'vm_adb':30,'fc_adb':54,
           'c_db':70,'h_db':5,'n_db':1,'o_db':11,'s_db':.5,'sio2':50,'al2o3':25}
    saved = commit({'assays':[row]},1,'test','manual',path)
    selected = saved['quality_selection']['C']
    assert selected['derived_ash_db'] == pytest.approx(12.5)
    assert selected['ncv_usable'] is False
    row['im_adb'] = None
    saved = commit({'assays':[row]},2,'test','manual',path)
    assert saved['quality_selection']['C']['derived_ash_db'] is None
    row['im_adb'] = 100
    assert preview({'assays':[row]},path)['errors']


def test_extended_assays_excel_and_confirmed_fallback(tmp_path):
    path = tmp_path / 'extended.db'
    saved = commit({'entries':[{'plan_name':'QUALITY PLAN','cargo_index':1,'coal_name':'TEST',
        'planned_t':30000,'destination_plant_id':'dangjin','receipt_date':'2026-11-01',
        'receipt_end_date':'2026-11-03','received_t':28000}]},0,'test','manual',path)
    cid = saved['cargo'][0]['cargo_no']
    row = {'assay_id':'FULL','cargo_no':cid,'stage':'loading','result_status':'confirmed',
        'analysis_date':'2026-11-04','sample_date':'2026-11-03','report_no':'QA-1',
        'gcv_arb':5000,'gcv_adb':6000,'gcv_db':6250,'ncv':4800,'ncv_basis':'unknown',
        'tm_ar':20,'sulfur_ar':.3,'hgi':55,'im_adb':4,'vm_adb':30,'ash_adb':12,'fc_adb':54,
        'c_db':70,'h_db':5,'n_db':1,'o_db':11,'s_db':.5,
        'sio2':50,'al2o3':25,'cao':4,'mgo':2,'na2o':1,'k2o':2,'so3':3,'tio2':1,'ash_other':12,
        'combustion_start_c':300,'combustion_end_c':700,'combustion_peak_c':520,'combustion_max_rate':7.5,
        'fusion_it':1100,'fusion_st':1200,'fusion_ht':1300,'fusion_ft':1400,
        'size_2mm':97,'size_025mm':25,'chlorine_db_ppm':120,'csn':.5}
    saved=commit({'assays':[row,{**row,'assay_id':'DRAFT','stage':'unloading','result_status':'draft'},
        {**row,'assay_id':'BUYER','stage':'buyer'}], 'ships':[{'ship_code':'UNASSIGNED','name':'NO VOYAGE'}]},1,'test','manual',path)
    assert saved['quality_selection'][cid]['assay_id']=='FULL'
    parsed, revision=parse_workbook(workbook_bytes(saved,business=True))
    assert not preview(parsed,path)['changes']
    other=tmp_path/'import.db'
    imported=commit(parsed,0,'test','excel',other)
    assert imported['ships'][0]['name']=='NO VOYAGE'
    full=next(a for a in imported['assays'] if a['assay_id']=='FULL')
    assert all(full[k]==v for k,v in row.items())
    assert imported['cargo'][0]['received_t']==28000
    bad={**row,'size_025mm':98}
    assert preview({'assays':[bad]},path)['errors']
    commit({'assays':[{**row,'assay_id':'UNLOAD','stage':'unloading','gcv_arb':None}]},2,'test','manual',path)
    selected=snapshot(path)['quality_selection'][cid]
    assert selected['assay_id']=='UNLOAD' and selected['gcv_arb'] is None


def test_existing_database_migrates_without_losing_relations_or_audit(tmp_path):
    from midterm.database import connect
    path=tmp_path/'migration.db'
    with connect(path) as db:
        db.executescript("""
        CREATE TABLE voyage_registry_ships(ship_code TEXT PRIMARY KEY,name TEXT NOT NULL,mmsi TEXT,imo TEXT,
          operator TEXT,flag TEXT,notes TEXT,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
        CREATE TABLE voyage_registry_voyages(voyage_no TEXT PRIMARY KEY,ship_code TEXT NOT NULL REFERENCES voyage_registry_ships(ship_code),
          status TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
        CREATE TABLE voyage_registry_cargo(cargo_no TEXT PRIMARY KEY,voyage_no TEXT NOT NULL REFERENCES voyage_registry_voyages(voyage_no),
          destination_plant_id TEXT NOT NULL,coal_name TEXT NOT NULL,planned_t REAL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
        INSERT INTO voyage_registry_ships(ship_code,name,updated_at,updated_by) VALUES('S','OLD SHIP','2026-11-01','test');
        INSERT INTO voyage_registry_voyages VALUES('26-1-019','S','planned','2026-11-01','test');
        INSERT INTO voyage_registry_cargo VALUES('C','26-1-019','dangjin','OLD COAL',1000,'2026-11-01','test');
        """)
    saved=snapshot(path)
    assert saved['voyages'][0]['voyage_number']=='26-1-019'
    assert saved['cargo'][0]['voyage_no']=='26-1-019'
    assert saved['cargo'][0]['planned_t']==1000
    assert saved['cargo'][0]['receipt_date'] is None
    commit({'voyages':[{'voyage_no':'DRAFT','plan_name':'No ship','status':'planned'}]},0,'test','manual',path)
    with connect(path) as db:
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert len(snapshot(path)['voyages'])==2


def test_v1_excel_update_preserves_new_fields_and_analysis(tmp_path):
    from openpyxl import Workbook
    path=tmp_path/'v1.db'
    saved=commit({'ships':[{'ship_code':'S','name':'SHIP'}],
        'voyages':[{'voyage_no':'V','ship_code':'S','plan_name':'PRESERVE','voyage_number':'26-1-010','status':'planned'}],
        'cargo':[{'cargo_no':'C','voyage_no':'V','coal_name':'TEST','destination_plant_id':'dangjin','planned_t':100,'received_t':90}]},0,'test','manual',path)
    saved=commit({'assays':[{'assay_id':'A','cargo_no':'C','stage':'loading','result_status':'confirmed','gcv_arb':5000}]},1,'test','manual',path)
    book=Workbook();book.remove(book.active)
    for title,headers,values in [
        ('선박',['선박코드','선박명','선적국'],['S','RENAMED','TEST']),
        ('항차',['항차번호','선박코드','진행상태','출항항','주 도착항'],['V','S','planned','TEST PORT','당진']),
        ('화물',['화물번호','항차번호','목적발전소코드','탄종','예정물량(t)'],['C','V','dangjin','TEST',120])]:
        sheet=book.create_sheet(title);sheet.append(headers);sheet.append(values)
    buffer=io.BytesIO();book.save(buffer)
    changes,_=parse_workbook(buffer.getvalue())
    saved=commit(changes,2,'test','excel',path)
    assert saved['voyages'][0]['voyage_number']=='26-1-010'
    assert saved['voyages'][0]['plan_name']=='PRESERVE'
    assert saved['cargo'][0]['received_t']==90
    assert saved['cargo'][0]['planned_t']==120
    assert saved['assays'][0]['gcv_arb']==5000
