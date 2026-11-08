import io
import pytest
from openpyxl import load_workbook
from midterm.voyage_registry import RegistryError, snapshot, preview, commit
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
