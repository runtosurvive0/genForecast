import pytest

from midterm.voyage_registry import commit
from midterm.stock_inventory import assign_receipt, inventory_snapshot, correct_balance, reconcile_receipt
from midterm.supply import read_supply
from midterm.database import connect


def prepare(path):
    commit({'voyages': [{'voyage_no': 'V1', 'status': 'completed',
                         'actual_unload_end': '2026-11-04 12:00'}],
            'cargo': [{'cargo_no': 'C1', 'voyage_no': 'V1', 'destination_plant_id': 'dangjin',
                       'coal_name': 'TEST', 'planned_t': 100, 'received_t': 100,
                       'receipt_date': '2026-11-03', 'receipt_end_date': '2026-11-04'}],
            'assays': [{'assay_id': 'A1', 'cargo_no': 'C1', 'stage': 'unloading',
                        'result_status': 'confirmed', 'gcv_arb': 5500, 'tm_ar': 10}]}, 0, 'a', 'manual', path)


def test_receipt_split_is_atomic_and_not_posted_twice(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    result = assign_receipt('C1', [{'location': 'P1', 'tonnes': 40}, {'location': 'P2', 'tonnes': 60}], 0, 'a', path)
    assert result['revision'] == 1
    assert sum(row['remaining_t'] for row in result['lots']) == 100
    assert result['lots'][0]['assay']['gcv_arb'] == 5500
    events = read_supply(path)['registry_receipts']
    assert [(event['group'], event['tonnes'], event['cv']) for event in events] == [('g14', 40, 5500), ('g14', 60, 5500)]
    with pytest.raises(ValueError):
        assign_receipt('C1', [{'location': 'P1', 'tonnes': 100}], 1, 'b', path)
    assert sum(row['remaining_t'] for row in inventory_snapshot(path)['lots']) == 100


def test_receipt_requires_actual_end_complete_allocation_and_explicit_location(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    for rows in ([{'location': 'P1', 'tonnes': 50}], [{'location': 'P9', 'tonnes': 100}]):
        with pytest.raises(ValueError):
            assign_receipt('C1', rows, 0, 'a', path)
    assert inventory_snapshot(path)['lots'] == []


def test_balance_correction_is_versioned_and_audited(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    first = assign_receipt('C1', [{'location': 'P1', 'tonnes': 100}], 0, 'a', path)
    lot_id = first['lots'][0]['id']
    changed = correct_balance(lot_id, 70, '상탄 실적 반영', 1, 'b', path)
    assert changed['lots'][0]['remaining_t'] == 70
    assert changed['audit'][0]['actor'] == 'b'
    with pytest.raises(ValueError):
        correct_balance(lot_id, 80, '오래된 화면', 1, 'a', path)
    assert inventory_snapshot(path)['lots'][0]['remaining_t'] == 70


def test_future_actual_discharge_never_creates_real_stock(tmp_path):
    path = tmp_path / 'db.sqlite3'
    commit({'voyages': [{'voyage_no': 'VF', 'status': 'completed', 'actual_unload_end': '2099-11-04 12:00'}],
            'cargo': [{'cargo_no': 'CF', 'voyage_no': 'VF', 'destination_plant_id': 'dangjin',
                       'coal_name': 'TEST', 'planned_t': 10, 'received_t': 10, 'receipt_end_date': '2099-11-04'}]}, 0, 'a', 'manual', path)
    with pytest.raises(ValueError, match='미래'):
        assign_receipt('CF', [{'location': 'P1', 'tonnes': 10}], 0, 'a', path)
    assert inventory_snapshot(path)['lots'] == []


def test_changed_discharge_time_keeps_original_event_and_requires_review(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    assign_receipt('C1', [{'location': 'P1', 'tonnes': 100}], 0, 'a', path)
    commit({'voyages': [{'voyage_no': 'V1', 'status': 'completed', 'actual_unload_end': '2026-11-05 12:00'}]}, 1, 'b', 'manual', path)
    lot = inventory_snapshot(path)['lots'][0]
    assert lot['needs_review'] is True
    assert read_supply(path)['registry_receipts'][0]['at'].startswith('2026-11-04T12:00')


def test_existing_pile_rows_without_original_time_are_preserved_but_unverified(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    with connect(path) as db:
        db.execute('''CREATE TABLE stock_inventory_lots(id INTEGER PRIMARY KEY, cargo_no TEXT NOT NULL,
                      location TEXT NOT NULL, initial_t REAL NOT NULL, remaining_t REAL NOT NULL,
                      updated_at TEXT NOT NULL, UNIQUE(cargo_no, location))''')
        db.execute("INSERT INTO stock_inventory_lots VALUES(1,'C1','P1',100,70,'2026-11-06T00:00:00+00:00')")
    lot = inventory_snapshot(path)['lots'][0]
    assert lot['remaining_t'] == 70
    assert lot['needs_review'] is True


def test_reconcile_moves_split_and_preserves_history_and_balances(tmp_path):
    path = tmp_path / 'db.sqlite3'
    prepare(path)
    initial = assign_receipt('C1', [{'location': 'P1', 'tonnes': 40}, {'location': 'P2', 'tonnes': 60}], 0, 'a', path)
    old_id = initial['lots'][0]['id']
    correct_balance(old_id, 30, '사용 반영', 1, 'a', path)
    changed = reconcile_receipt('C1', [{'location':'P5', 'tonnes':40, 'remaining_t':30},
                                       {'location':'P2', 'tonnes':60, 'remaining_t':55}],
                                '적치 위치 정정', 2, 1, 'b', path)
    assert changed['revision'] == 3
    assert [(r['location'], r['initial_t'], r['remaining_t']) for r in changed['lots']] == [('P2', 60, 55), ('P5', 40, 30)]
    assert all(not r['needs_review'] for r in changed['lots'])
    event = changed['reconciliations'][0]
    assert event['actor'] == 'b' and event['reason'] == '적치 위치 정정'
    assert {(r['location'], r['remaining_t']) for r in event['before']} == {('P1',30),('P2',60)}
    assert {(r['location'], r['remaining_t']) for r in event['after']} == {('P5',30),('P2',55)}
    assert any(a['lot_id'] == old_id and a['reason'] == '사용 반영' for a in changed['audit'])
    assert set(read_supply(path)['registry_reconciliations'][0]['groups']) == {'g14','g58'}


def test_reconcile_rejects_bad_amounts_stale_versions_and_rolls_back(tmp_path):
    path = tmp_path / 'db.sqlite3'; prepare(path)
    assign_receipt('C1', [{'location':'P1','tonnes':100}], 0, 'a', path)
    for rows, revision, registry_revision, reason in [
        ([{'location':'P1','tonnes':90,'remaining_t':90}], 1, 1, '정정'),
        ([{'location':'P1','tonnes':100,'remaining_t':101}], 1, 1, '정정'),
        ([{'location':'P1','tonnes':100,'remaining_t':100}], 0, 1, '정정'),
        ([{'location':'P1','tonnes':100,'remaining_t':100}], 1, 0, '정정'),
        ([{'location':'P1','tonnes':100,'remaining_t':100}], 1, 1, ''),
    ]:
        with pytest.raises(ValueError): reconcile_receipt('C1', rows, reason, revision, registry_revision, 'b', path)
    assert inventory_snapshot(path)['lots'][0]['remaining_t'] == 100
    assert inventory_snapshot(path)['revision'] == 1


def test_reconcile_restores_retired_location_without_losing_audit(tmp_path):
    path = tmp_path / 'db.sqlite3'; prepare(path)
    first = assign_receipt('C1', [{'location':'P1','tonnes':100}], 0, 'a', path)
    old_id = first['lots'][0]['id']
    reconcile_receipt('C1', [{'location':'P5','tonnes':100,'remaining_t':80}], '위치 1차 정정', 1, 1, 'a', path)
    with pytest.raises(ValueError): correct_balance(old_id, 20, '비활성 구역', 2, 'a', path)
    result = reconcile_receipt('C1', [{'location':'P1','tonnes':100,'remaining_t':70}], '위치 재확인', 2, 1, 'b', path)
    assert result['lots'][0]['id'] == old_id and result['lots'][0]['remaining_t'] == 70
    assert len(result['reconciliations']) == 2
    assert result['reconciliations'][1]['before'][0]['location'] == 'P1'


def test_dummy_cargo_never_becomes_real_stock(tmp_path):
    path = tmp_path / 'db.sqlite3'
    commit({'voyages': [{'voyage_no': 'DV1', 'status': 'completed', 'actual_unload_end': '2026-11-04 12:00',
                         'data_origin': 'dummy'}],
            'cargo': [{'cargo_no': 'DC1', 'voyage_no': 'DV1', 'destination_plant_id': 'dangjin',
                       'coal_name': 'TEST', 'planned_t': 100, 'received_t': 100,
                       'receipt_date': '2026-11-03', 'receipt_end_date': '2026-11-04', 'data_origin': 'dummy'}]},
           0, 'dummy-seed', 'dummy-data', path)
    with pytest.raises(ValueError, match='더미 화물은 실제 재고에 반영할 수 없습니다'):
        assign_receipt('DC1', [{'location': 'P1', 'tonnes': 100}], 0, 'a', path)
    assert inventory_snapshot(path)['lots'] == [] and inventory_snapshot(path)['revision'] == 0
    with connect(path) as db:  # a lot left by an older app: it cannot be reconciled either
        db.execute("INSERT INTO stock_inventory_lots(cargo_no,location,initial_t,remaining_t,updated_at,receipt_at,"
                   "recorded_receipt_end) VALUES('DC1','P1',100,100,'2026-11-05T00:00:00+00:00',"
                   "'2026-11-04T12:00:00+09:00','2026-11-04')")
    with pytest.raises(ValueError, match='더미 화물은 실제 재고에 반영할 수 없습니다'):
        reconcile_receipt('DC1', [{'location': 'P2', 'tonnes': 100, 'remaining_t': 100}], '정정', 0, 1, 'a', path)
    assert [r['location'] for r in inventory_snapshot(path)['lots']] == ['P1']


def test_reconcile_after_source_amount_or_time_changes_reconfirms_current_values(tmp_path):
    path = tmp_path / 'db.sqlite3'; prepare(path)
    assign_receipt('C1', [{'location':'P1','tonnes':100}], 0, 'a', path)
    commit({'cargo':[{'cargo_no':'C1','voyage_no':'V1','destination_plant_id':'dangjin',
                      'coal_name':'TEST','planned_t':110,'received_t':110,
                      'receipt_date':'2026-11-03','receipt_end_date':'2026-11-04'}]}, 1, 'b', 'manual', path)
    assert inventory_snapshot(path)['lots'][0]['needs_review'] is True
    with pytest.raises(ValueError):
        reconcile_receipt('C1', [{'location':'P1','tonnes':100,'remaining_t':80}], '정정', 1, 2, 'a', path)
    updated = reconcile_receipt('C1', [{'location':'P1','tonnes':110,'remaining_t':80}], '입하량 확인', 1, 2, 'a', path)
    assert updated['lots'][0]['needs_review'] is False
    assert updated['lots'][0]['initial_t'] == 110
    assert updated['reconciliations'][0]['before'][0]['initial_t'] == 100
