import pytest
from midterm.stock_baseline import read_baseline, save_baseline


def test_baseline_independent_of_cargo_and_preserves_history(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    first = {'as_of': '2026-11-04', 'lots': [
        {'location': 'P1', 'coal_name': 'COAL A', 'tonnes': 100, 'voyage_number': None},
        {'location': 'A2', 'coal_name': 'COAL B', 'tonnes': 200, 'voyage_number': '26-1-001'}]}
    saved = save_baseline(first, 0, 'operator', path)
    assert saved['revision'] == 1 and saved['total_t'] == 300
    assert len(saved['lots']) == 2
    second = {'as_of': '2026-11-05', 'lots': [{'location': 'P1', 'coal_name': 'COAL A', 'tonnes': 50}]}
    assert save_baseline(second, 1, 'operator', path)['total_t'] == 50
    assert read_baseline(path, '2026-11-04')['total_t'] == 300
    assert read_baseline(path)['total_t'] == 50
    with pytest.raises(ValueError, match='변경'):
        save_baseline(second, 1, 'operator', path)
    assert read_baseline(path)['revision'] == 2


def test_invalid_baseline_does_not_replace_existing(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    valid = {'as_of': '2026-11-04', 'lots': [{'location': 'P1', 'coal_name': 'A', 'tonnes': 1}]}
    save_baseline(valid, 0, 'operator', path)
    for row in ({'location': 'P9', 'coal_name': 'A', 'tonnes': 1},
                {'location': 'P1', 'coal_name': 'A', 'tonnes': -1}):
        with pytest.raises(ValueError):
            save_baseline({'as_of': '2026-11-05', 'lots': [row]}, 1, 'operator', path)
    assert read_baseline(path)['total_t'] == 1


def test_baseline_accepts_temperature_and_dummy_fields(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    lot = {'location': 'P1', 'coal_name': 'A', 'tonnes': 10, 'temperature_c': 41.5, 'dummy_fields': 'age_days,temperature_c'}
    saved = save_baseline({'as_of': '2026-11-04', 'lots': [lot, {**lot, 'temperature_c': None, 'dummy_fields': None}]}, 0, 'dummy-seed', path)
    got = read_baseline(path)['lots']
    assert got[0]['temperature_c'] == 41.5 and got[0]['dummy_fields'] == 'age_days,temperature_c'
    assert got[1]['temperature_c'] is None and got[1]['dummy_fields'] is None
    assert saved['revision'] == 1


@pytest.mark.parametrize('bad', [-1, 151, True, float('inf'), '40'])
def test_baseline_rejects_bad_temperature(tmp_path, bad):
    lot = {'location': 'P1', 'coal_name': 'A', 'tonnes': 10, 'temperature_c': bad}
    with pytest.raises(ValueError):
        save_baseline({'as_of': '2026-11-04', 'lots': [lot]}, 0, 'operator', tmp_path / 's.sqlite3')


def test_baseline_rejects_bad_dummy_fields(tmp_path):
    lot = {'location': 'P1', 'coal_name': 'A', 'tonnes': 10, 'dummy_fields': 'x' * 201}
    with pytest.raises(ValueError):
        save_baseline({'as_of': '2026-11-04', 'lots': [lot]}, 0, 'operator', tmp_path / 's.sqlite3')


def _seeded(path):
    lots = [{'source_id': 'f1', 'location': 'P1', 'coal_name': 'A', 'tonnes': 10, 'age_days': 30,
             'temperature_c': 41.5, 'dummy_fields': 'age_days,temperature_c'},
            {'source_id': 'f2', 'location': 'P2', 'coal_name': 'B', 'tonnes': 20, 'temperature_c': 30.0,
             'dummy_fields': 'temperature_c'}]
    save_baseline({'as_of': '2026-11-04', 'lots': lots}, 0, 'dummy-seed', path)
    return [dict(lot) for lot in lots]


def test_human_edit_of_dummy_field_drops_it_from_dummy_fields(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    lots = _seeded(path)
    lots[0]['temperature_c'] = 44.0  # a person measured it
    save_baseline({'as_of': '2026-11-04', 'lots': lots}, 1, 'operator', path)
    got = read_baseline(path)['lots']
    assert got[0]['temperature_c'] == 44.0 and got[0]['dummy_fields'] == 'age_days'
    assert got[1]['dummy_fields'] == 'temperature_c'
    lots[1]['temperature_c'] = 31.0
    save_baseline({'as_of': '2026-11-04', 'lots': lots}, 2, 'operator', path)
    assert 'dummy_fields' not in read_baseline(path)['lots'][1]


def test_person_cannot_add_dummy_marks(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    lots = _seeded(path)
    lots[1]['dummy_fields'] = 'grade,temperature_c,tonnes'
    lots.append({'source_id': 'f3', 'location': 'P3', 'coal_name': 'C', 'tonnes': 5, 'dummy_fields': 'tonnes'})
    save_baseline({'as_of': '2026-11-04', 'lots': lots}, 1, 'operator', path)
    got = read_baseline(path)['lots']
    assert got[1]['dummy_fields'] == 'temperature_c'
    assert 'dummy_fields' not in got[2]


def test_duplicate_lot_keys_lose_dummy_marks_on_human_save(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    lots = _seeded(path)
    twin = {**lots[0], 'tonnes': 5}
    save_baseline({'as_of': '2026-11-04', 'lots': [lots[0], twin, lots[1]]}, 1, 'operator', path)
    got = read_baseline(path)['lots']
    assert 'dummy_fields' not in got[0] and 'dummy_fields' not in got[1]
    assert got[2]['dummy_fields'] == 'temperature_c'


def test_previous_day_baseline_is_used_when_same_day_missing(tmp_path):
    path = tmp_path / 'stock.sqlite3'
    lots = _seeded(path)
    lots[0]['age_days'] = 31
    save_baseline({'as_of': '2026-11-05', 'lots': lots}, 1, 'operator', path)
    assert read_baseline(path)['lots'][0]['dummy_fields'] == 'temperature_c'
