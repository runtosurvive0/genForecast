import io
import pytest
from openpyxl import load_workbook
from midterm.voyage_registry import RegistryError, SCHEMA, snapshot, preview, commit, purge, dummy_keys
from midterm.voyage_registry_excel import workbook_bytes, parse_workbook


def records():
    return {
        'ships': [{'ship_code': 'SHIP-001', 'name': 'TEST BULK', 'mmsi': '001234567'}],
        'voyages': [{'voyage_no': '26-1-041', 'ship_code': 'SHIP-001', 'status': 'planned',
                     'origin_port': 'Newcastle', 'destination_port': '당진',
                     'planned_departure': '2026-11-01 08:30', 'planned_arrival': '2026-11-12 09:00'}],
        'cargo': [{'cargo_no': 'C-001', 'voyage_no': '26-1-041', 'destination_plant_id': 'dangjin',
                   'coal_name': 'TEST COAL', 'planned_t': 30000, 'cv': 5900, 'cv_basis': 'GAR', 'sulfur_pct': 0, 'analysis_basis': 'AR'}],
    }


def test_voyage_classification_persists_and_defaults_to_actual(tmp_path):
    path = tmp_path / 'classification.sqlite3'
    changes = {'voyages': [
        {'voyage_no':'A1','status':'arrived'},
        {'voyage_no':'S1','status':'underway','classification':'simulation'},
    ]}
    commit(changes, 0, 'user', 'manual', path)
    values = {v['voyage_no']:v['classification'] for v in snapshot(path)['voyages']}
    assert values == {'A1':'actual','S1':'simulation'}
    assert preview({'voyages':[{'voyage_no':'S1','classification':'other'}]}, path)['errors']


def test_voyage_number_uses_berth_not_stockyard(tmp_path):
    path = tmp_path / 'berth-number.sqlite3'
    item = {'voyage_no': 'V1', 'status': 'planned', 'voyage_number': '26-1-019', 'berth_id': 'BD-1', 'yard': '2'}
    assert preview({'voyages': [item]}, path)['errors'] == []
    item['berth_id'] = 'BD-2'
    assert any('부두' in error['message'] for error in preview({'voyages': [item]}, path)['errors'])


def test_registry_relations_persistence_revision_and_audit(tmp_path):
    path = tmp_path / 'registry.sqlite3'
    changes = records()
    result = preview(changes, path)
    assert result['revision'] == 0 and len(result['changes']) == 3
    assert snapshot(path)['cargo'] == []  # Preview is read-only.
    commit(changes, 0, 'admin-a', 'manual', path)
    saved = snapshot(path)
    assert saved['ships'][0]['mmsi'] == '001234567'
    assert saved['cargo'][0]['sulfur_pct'] == 0 and saved['cargo'][0]['bl_t'] is None
    assert saved['voyages'][0]['planned_departure'] == '2026-11-01T08:30:00+09:00'
    assert saved['revision'] == 1 and len(saved['audit']) == 3
    changes['voyages'].append({'voyage_no': '26-1-042', 'ship_code': 'SHIP-001', 'status': 'planned'})
    changes['cargo'].append({**changes['cargo'][0], 'cargo_no': 'C-002', 'destination_plant_id': 'boryeong'})
    commit(changes, 1, 'admin-b', 'excel', path)
    assert len(snapshot(path)['voyages']) == 2 and len(snapshot(path)['cargo']) == 2
    with pytest.raises(RegistryError, match='다른 변경'):
        commit(changes, 1, 'admin-a', 'manual', path)
    # Unchanged rows do not create spurious history/revisions.
    commit(changes, 2, 'admin-a', 'excel', path)
    assert snapshot(path)['revision'] == 2


@pytest.mark.parametrize('field,value', [('planned_t', -1), ('cv', float('nan')), ('sulfur_pct', 101), ('destination_plant_id', 'unknown')])
def test_bad_cargo_rolls_back_whole_batch(tmp_path, field, value):
    path = tmp_path / 'registry.sqlite3'
    changes = records()
    changes['cargo'][0][field] = value
    assert preview(changes, path)['errors']
    with pytest.raises(RegistryError):
        commit(changes, 0, 'admin', 'excel', path)
    assert snapshot(path)['ships'] == []


def test_duplicate_fk_and_schedule_errors_are_explicit(tmp_path):
    path = tmp_path / 'registry.sqlite3'
    changes = records()
    changes['ships'].append(dict(changes['ships'][0]))
    changes['cargo'][0]['voyage_no'] = 'MISSING'
    changes['voyages'][0]['planned_arrival'] = '2026-10-01 10:00'
    errors = preview(changes, path)['errors']
    assert any('중복' in e['message'] for e in errors)
    assert any('항차' in e['message'] for e in errors)
    assert any('순서' in e['message'] for e in errors)


def test_excel_roundtrip_text_identifiers_blanks_and_formula_protection(tmp_path):
    path = tmp_path / 'registry.sqlite3'
    changes = records()
    changes['ships'][0]['name'] = '=NOT_A_FORMULA'
    commit(changes, 0, 'admin', 'manual', path)
    data = workbook_bytes(snapshot(path))
    rows, revision = parse_workbook(data)
    assert revision == 1
    assert rows['ships'][0]['name'] == '=NOT_A_FORMULA'
    assert rows['ships'][0]['mmsi'] == '001234567'
    assert preview(rows, path)['changes'] == []
    book = load_workbook(io.BytesIO(data))
    book['선박']['B2'] = '=1+1'
    output = io.BytesIO(); book.save(output)
    with pytest.raises(RegistryError, match='수식'):
        parse_workbook(output.getvalue())


def test_excel_headers_are_mapped_and_invalid_headers_rejected(tmp_path):
    book = load_workbook(io.BytesIO(workbook_bytes(snapshot(tmp_path / 'r.sqlite3'))))
    assert book['항차'].freeze_panes == 'A2'
    book['선박']['A1'] = '잘못된 헤더'
    output = io.BytesIO(); book.save(output)
    with pytest.raises(RegistryError, match='헤더'):
        parse_workbook(output.getvalue())


def test_valid_ship_identifier_exchange_is_atomic(tmp_path):
    path = tmp_path / 'swap.sqlite3'
    ships = [{'ship_code': 'A', 'name': 'A', 'mmsi': '001234567', 'imo': '1234567'},
             {'ship_code': 'B', 'name': 'B', 'mmsi': '009876543', 'imo': '7654321'}]
    commit({'ships': ships}, 0, 'admin', 'manual', path)
    ships[0]['mmsi'], ships[1]['mmsi'] = ships[1]['mmsi'], ships[0]['mmsi']
    ships[0]['imo'], ships[1]['imo'] = ships[1]['imo'], ships[0]['imo']
    assert not preview({'ships': ships}, path)['errors']
    saved = commit({'ships': ships}, 1, 'admin', 'excel', path)
    assert saved['ships'][0]['mmsi'] == '009876543'
    assert saved['ships'][1]['imo'] == '1234567'
    assert saved['revision'] == 2 and len(saved['audit']) == 4


NEW_FIELDS = {'data_origin', 'dummy_fields', 'laytime_hours', 'demurrage_usd_per_day', 'fe2o3'}


def dummy_base():
    return {
        'voyages': [{'voyage_no': 'V1', 'status': 'completed'}],
        'cargo': [{'cargo_no': 'C1', 'voyage_no': 'V1', 'destination_plant_id': 'dangjin', 'coal_name': 'COAL',
                   'planned_t': 1000, 'cv_basis': 'GAR', 'analysis_basis': 'AR'}],
        'assays': [{'assay_id': 'A1', 'cargo_no': 'C1', 'stage': 'loading'}],
    }


def test_new_contract_fields_are_declared():
    fields = {e: {f['key']: f for f in SCHEMA[e]['fields']} for e in SCHEMA}
    for entity in ('voyages', 'cargo', 'assays'):
        assert fields[entity]['data_origin']['system'] and fields[entity]['dummy_fields']['system']
        assert set(fields[entity]['data_origin']['choices']) == {'entered', 'dummy', 'mixed'}
        assert fields[entity]['data_origin']['label'] == '더미 구분'
        assert fields[entity]['dummy_fields']['label'] == '더미 칸'
        assert fields[entity]['dummy_fields']['kind'] == 'memo'
    assert 'data_origin' not in fields['ships']
    assert fields['voyages']['laytime_hours']['label'] == '허용정박시간(h)'
    assert fields['voyages']['laytime_hours']['max'] == 1000
    assert fields['voyages']['demurrage_usd_per_day']['label'] == '체선료(USD/일)'
    assert fields['voyages']['demurrage_usd_per_day']['max'] == 1000000
    keys = [f['key'] for f in SCHEMA['assays']['fields']]
    assert keys.index('fe2o3') == keys.index('tio2') + 1
    assert fields['assays']['fe2o3']['group'] == '회성분 분석 · %wt'
    assert fields['assays']['fe2o3']['label'] == 'Fe2O3' and fields['assays']['fe2o3']['max'] == 100


def test_migration_marks_existing_rows_entered(tmp_path, monkeypatch):
    path = tmp_path / 'old.sqlite3'
    for spec in SCHEMA.values():
        monkeypatch.setitem(spec, 'fields', [f for f in spec['fields'] if f['key'] not in NEW_FIELDS])
    commit(dummy_base(), 0, 'user', 'manual', path)
    monkeypatch.undo()
    saved = snapshot(path)
    for entity in ('voyages', 'cargo', 'assays'):
        assert [(r['data_origin'], r['dummy_fields']) for r in saved[entity]] == [('entered', None)]
    assert saved['voyages'][0]['laytime_hours'] is None


def test_manual_commit_cannot_set_dummy_markers(tmp_path):
    path = tmp_path / 'manual.sqlite3'
    changes = dummy_base()
    changes['voyages'][0].update(data_origin='dummy', dummy_fields='cv')
    saved = commit(changes, 0, 'user', 'manual', path)
    assert (saved['voyages'][0]['data_origin'], saved['voyages'][0]['dummy_fields']) == ('entered', None)
    assert preview({'voyages': [{'voyage_no': 'V1', 'data_origin': 'dummy'}]}, path)['changes'] == []


def test_dummy_commit_records_markers_and_new_rows_default_entered(tmp_path):
    path = tmp_path / 'dummy.sqlite3'
    saved = commit({'voyages': [{'voyage_no': 'V1', 'status': 'completed'},
                                {'voyage_no': 'V2', 'status': 'completed', 'data_origin': 'dummy'}]},
                   0, 'dummy-seed', 'dummy-data', path)
    assert {v['voyage_no']: v['data_origin'] for v in saved['voyages']} == {'V1': 'entered', 'V2': 'dummy'}
    assert {a['origin'] for a in saved['audit']} == {'dummy-data'}


def test_human_edit_removes_field_from_dummy_fields(tmp_path):
    path = tmp_path / 'mixed.sqlite3'
    commit(dummy_base(), 0, 'user', 'manual', path)
    commit({'cargo': [{'cargo_no': 'C1', 'cv': 5800, 'sulfur_pct': 0.5,
                       'data_origin': 'mixed', 'dummy_fields': 'cv,sulfur_pct'}]}, 1, 'dummy-seed', 'dummy-data', path)
    cargo = commit({'cargo': [{'cargo_no': 'C1', 'cv': 6000}]}, 2, 'user', 'manual', path)['cargo'][0]
    assert (cargo['data_origin'], cargo['dummy_fields']) == ('mixed', 'sulfur_pct')
    cargo = commit({'cargo': [{'cargo_no': 'C1', 'sulfur_pct': 0.4}]}, 3, 'user', 'manual', path)['cargo'][0]
    assert (cargo['data_origin'], cargo['dummy_fields']) == ('entered', None)
    assert cargo['cv'] == 6000 and cargo['sulfur_pct'] == 0.4


def test_human_edit_of_dummy_row_becomes_mixed(tmp_path):
    path = tmp_path / 'dummy-row.sqlite3'
    commit({'voyages': [{'voyage_no': 'V1', 'status': 'completed', 'voyage_number': '26-1-001',
                         'berth_id': 'BD-1', 'data_origin': 'dummy'}]}, 0, 'dummy-seed', 'dummy-data', path)
    expected = {'status', 'voyage_number', 'berth_id', 'classification'}
    assert dummy_keys(snapshot(path)['voyages'][0], 'voyages') == expected
    voyage = commit({'voyages': [{'voyage_no': 'V1', 'notes': '사람 확인'}]}, 1, 'user', 'manual', path)['voyages'][0]
    assert voyage['data_origin'] == 'mixed' and voyage['notes'] == '사람 확인'
    assert set(voyage['dummy_fields'].split(',')) == expected
    assert dummy_keys(voyage, 'voyages') == expected


def test_dummy_keys_rules():
    assert dummy_keys({'voyage_no': 'V1', 'data_origin': 'entered', 'status': 'planned'}, 'voyages') == set()
    assert dummy_keys({'cargo_no': 'C1', 'data_origin': 'mixed', 'dummy_fields': 'cv, ash_pct'}, 'cargo') == {'cv', 'ash_pct'}
    assert dummy_keys({'cargo_no': 'C1', 'data_origin': 'mixed', 'dummy_fields': None}, 'cargo') == set()


def test_purge_deletes_children_first_and_audits(tmp_path):
    path = tmp_path / 'purge.sqlite3'
    commit(dummy_base(), 0, 'dummy-seed', 'dummy-data', path)
    saved = purge({'assays': ['A1'], 'cargo': ['C1'], 'voyages': ['V1']}, 1, 'dummy-seed', 'dummy-data', path)
    assert saved['revision'] == 2
    assert saved['voyages'] == saved['cargo'] == saved['assays'] == []
    removed = sorted((a for a in saved['audit'] if a['revision'] == 2), key=lambda a: a['id'])
    assert [a['entity'] for a in removed] == ['assays', 'cargo', 'voyages']
    assert all(a['after_json'] == 'null' and a['origin'] == 'dummy-data' and a['before_json'] for a in removed)


def test_purge_rejects_non_dummy_origin_and_stale_revision(tmp_path):
    path = tmp_path / 'purge-reject.sqlite3'
    commit(dummy_base(), 0, 'user', 'manual', path)
    with pytest.raises(RegistryError):
        purge({'voyages': ['V1']}, 1, 'user', 'manual', path)
    with pytest.raises(RegistryError) as stale:
        purge({'assays': ['A1']}, 0, 'dummy-seed', 'dummy-data', path)
    assert stale.value.status == 409
    assert len(snapshot(path)['assays']) == 1 and snapshot(path)['revision'] == 1


def test_excel_template_excludes_system_fields(tmp_path):
    path = tmp_path / 'excel.sqlite3'
    commit(dummy_base(), 0, 'dummy-seed', 'dummy-data', path)
    data = snapshot(path)
    for business in (False, True):
        book = load_workbook(io.BytesIO(workbook_bytes(data, business=business)))
        headers = {c.value for sheet in book.worksheets for c in sheet[1]}
        assert not headers & {'더미 구분', '더미 칸'}
    headers = {c.value for c in load_workbook(io.BytesIO(workbook_bytes(data)))['항차'][1]}
    assert {'허용정박시간(h)', '체선료(USD/일)'} <= headers
    rows, _ = parse_workbook(workbook_bytes(data))
    assert all('data_origin' not in r for sheet_rows in rows.values() for r in sheet_rows if r)
    assert preview(rows, path)['changes'] == []


def test_workbooks_exported_before_new_columns_still_parse(tmp_path):
    path = tmp_path / 'old-excel.sqlite3'
    commit(dummy_base(), 0, 'user', 'manual', path)
    data = snapshot(path)
    for business, removals in ((False, {'항차': ['허용정박시간(h)', '체선료(USD/일)'], '성상분석': ['Fe2O3']}),
                               (True, {'배선등록': ['허용정박시간(h)', '체선료(USD/일)'], '성상분석': ['Fe2O3 (%wt)']})):
        book = load_workbook(io.BytesIO(workbook_bytes(data, business=business)))
        for title, labels in removals.items():
            for label in labels:
                sheet = book[title]
                sheet.delete_cols([c.value for c in sheet[1]].index(label) + 1)
        output = io.BytesIO(); book.save(output)
        rows, _ = parse_workbook(output.getvalue())
        assert preview(rows, path)['errors'] == []
