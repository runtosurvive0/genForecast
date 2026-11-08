import pytest

from midterm.blend_recommendation import recommend_blend


def lot(code, tonnes, cv, moisture, sulfur):
    return {'id': code, 'available_t': tonnes, 'gcv_arb': cv,
            'tm_ar': moisture, 'sulfur_ar': sulfur}


def test_blend_meets_mass_target_and_constraints_with_available_stock():
    result = recommend_blend([
        lot('A', 70, 6000, 10, .8), lot('B', 80, 5000, 20, .2),
    ], {'tonnes': 100, 'target_gcv_arb': 5500, 'max_tm_ar': 16, 'max_sulfur_ar': .6})
    assert result['status'] == 'ok'
    assert sum(row['tonnes'] for row in result['lots']) == pytest.approx(100)
    assert result['quality']['gcv_arb'] == pytest.approx(5500)
    assert result['quality']['tm_ar'] <= 16
    assert result['quality']['sulfur_ar'] <= .6
    assert all(row['tonnes'] <= row['available_t'] for row in result['lots'])


def test_blend_never_substitutes_missing_values_and_explains_infeasibility():
    result = recommend_blend([
        lot('A', 100, 6000, None, .2), lot('B', 30, 5000, 10, .2),
    ], {'tonnes': 100, 'target_gcv_arb': 5500, 'max_tm_ar': 15})
    assert result['status'] == 'infeasible'
    assert result['excluded'] == [{'id': 'A', 'missing': ['tm_ar']}]
    assert result['lots'] == []


def test_blend_rejects_duplicate_ids_and_nonfinite_constraints():
    items = [lot('A', 100, 6000, 10, .2), lot('A', 30, 5000, 10, .2)]
    with pytest.raises(ValueError):
        recommend_blend(items, {'tonnes': 100, 'target_gcv_arb': 5500})
    with pytest.raises(ValueError):
        recommend_blend(items[:1], {'tonnes': float('nan'), 'target_gcv_arb': 5500})


def test_blend_minimizes_distance_from_target_inside_tolerance():
    result = recommend_blend([lot('A', 100, 6000, 10, .2), lot('B', 100, 5000, 10, .2)],
                             {'tonnes': 100, 'target_gcv_arb': 5500, 'gcv_tolerance': 500})
    assert result['status'] == 'ok'
    assert result['quality']['gcv_arb'] == pytest.approx(5500)
