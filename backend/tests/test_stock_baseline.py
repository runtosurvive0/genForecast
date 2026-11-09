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
