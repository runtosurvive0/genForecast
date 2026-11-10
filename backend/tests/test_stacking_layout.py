import pytest

from midterm.stacking.layout import load_layout, load_routes


def test_layout_values():
    layout = load_layout()
    assert layout['classification'] == '모의'
    assert [layout['piles'][f'P{i}']['length_m'] for i in range(1, 9)] == [420] * 4 + [720] * 4
    assert layout['default_t_per_m'] == 150 and layout['min_gap_m'] == 5 and layout['shed_cell_t'] == 30000
    assert layout['old_age_days'] == 30 and layout['hot_temperature_c'] == 40


def test_routes_from_catalog():
    routes = load_routes()
    assert routes[1] == {'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'A', 'B'}
    assert routes[2] == routes[3] == {'P1', 'P2', 'P5', 'P6', 'P7', 'P8', 'A', 'B'}


def test_bad_layout_rejected(tmp_path):
    bad = tmp_path / 'layout.json'
    bad.write_text('{"classification": "모의", "piles": {}}', encoding='utf-8')
    with pytest.raises(ValueError):
        load_layout(bad)


def test_missing_routes_file_is_clear_error(tmp_path):
    with pytest.raises(ValueError, match='반입 경로'):
        load_routes(tmp_path / 'none.json')
