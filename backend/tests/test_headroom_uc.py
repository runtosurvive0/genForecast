import numpy as np
import pytest
from scipy.optimize import Bounds, LinearConstraint
from scipy.sparse import csc_matrix

from midterm import uc as core
from midterm import headroom_uc as p3
from midterm.highs_backend import Backend, violation
from midterm.rolling import solve_rolling


def data(hours=4, units=1):
    shape = (hours, units)
    args = (np.full(hours, 7.), np.full(shape, 5.), np.full(shape, 10.), np.full(shape, 1.),
            np.ones(shape), np.zeros(shape, bool), np.zeros(shape, bool), [1]*units, [1]*units)
    kw = {'initial_online': [True]*units, 'initial_output': [7.]*units, 'initial_elapsed_hours': [5.]*units,
        'startup_cost': [100.]*units, 'fuel_curve': np.tile([.1, 2., 3.], (*shape, 1)), 'fuel_segments': 2,
        'time_limit': 2, 'cost_time_limit': 2, 'up_need': np.ones(hours), 'down_need': np.ones(hours),
        'reserve_mask': [True]*units, 'pmax_rated': [10.]*units}
    return args, kw


def test_both_prices_apply_only_in_the_cost_stage_and_raw_deficits_are_visible(tmp_path):
    args, kw = data(2)
    kw.update(up_need=[5.]*2, down_need=[5.]*2, validation_log_dir=tmp_path / 'solver')
    original = core.milp
    answer = p3.solve_headroom_uc(*args, **kw)
    assert core.milp is original and answer['has_plan'] and answer['target_met']
    assert answer['up_short_mw'] == pytest.approx([2., 2.])
    assert answer['down_short_mw'] == pytest.approx([3., 3.])
    assert not answer['reserve_met']
    stage = answer['solver_stages'][-1]
    assert stage['kind'] == 'cost' and stage['validation']['seed_validated']
    assert stage['validation']['seed_set_status'] == 'HighsStatus.kOk'
    log = (tmp_path / 'solver' / '02-cost.log').read_text(encoding='utf-8')
    assert stage['validation']['solver_accepted_seed_log'] == ('MIP start solution is feasible' in log)
    assert all(s['extra_off_rows'] == 0 for s in answer['solver_stages'])
    models = sorted((tmp_path / 'solver').glob('*-model.npz'))
    with np.load(models[0]) as z:
        assert not np.any(z['objective'][-4:])
    with np.load(models[-1]) as z:
        assert np.array_equal(z['objective'][-4:], np.full(4, 3e6))
        with np.load(tmp_path / 'solver' / '02-solution.npz') as solution:
            assert stage['objective'] == pytest.approx(float(z['objective'] @ solution['x']))


def test_price_changes_no_physics_and_zero_original_cost_still_has_a_cost_stage():
    args, kw = data(2)
    models = [p3.solve_headroom_uc(*args, **kw, reserve_price=p, _build_only=True) for p in (1e7, 3e6)]
    assert np.array_equal(models[0]['lower'], models[1]['lower'])
    for a, b in zip(models[0]['constraints'], models[1]['constraints']):
        assert (a.A != b.A).nnz == 0 and np.array_equal(a.lb, b.lb) and np.array_equal(a.ub, b.ub)
    args = (*args[:4], np.zeros((2, 1)), *args[5:])
    kw.pop('fuel_curve')
    kw.update(startup_cost=[0.])
    answer = p3.solve_headroom_uc(*args, **kw)
    assert answer['cost_solve_returned'] and answer['solver_stages'][-1]['kind'] == 'cost'
    assert answer['solver_stages'][-1]['validation']['seed_validated']


def test_off_noise_does_not_activate_the_downward_seed_selector(monkeypatch, tmp_path):
    class NoisyFront(Backend):
        def __call__(self, c, **kw):
            result = super().__call__(c, **kw)
            if result.x is not None and not np.any(c[self.fuel_start:]):
                result.x[:self.size] = 1e-13
                self.last = result.x.copy()
            return result

    monkeypatch.setattr(p3, 'Backend', NoisyFront)
    args, kw = data(2)
    args = (np.zeros(2), *args[1:])
    kw.update(initial_online=[False], initial_output=[0.], initial_elapsed_hours=[100.],
              up_need=[0.]*2, down_need=[0.]*2, validation_log_dir=tmp_path / 'noise')
    answer = p3.solve_headroom_uc(*args, **kw)
    assert answer['has_plan'] and not np.asarray(answer['online']).any()
    assert answer['solver_stages'][-1]['validation']['seed_max_violation'] <= 1e-5
    with np.load(max((tmp_path / 'noise').glob('*-model.npz'))) as z:
        assert (z['seed'][-6:-4] == 0).all()


def test_no_extra_maximum_off_rule_for_a_long_initial_stop():
    args, kw = data(50)
    args = (np.zeros(50), *args[1:])
    kw.update(initial_online=[False], initial_output=[0.], initial_elapsed_hours=[100.],
              up_need=np.zeros(50), down_need=np.zeros(50))
    answer = solve_rolling(p3.solve_headroom_uc, *args, **kw)
    assert answer['has_plan'] and not np.asarray(answer['online']).any()
    assert not any(answer['joined_physical_check'].values())


def test_two_window_raw_costs_and_headroom_flags_do_not_use_the_first_window_only():
    args, kw = data(6)
    kw['down_need'] = [0.]*4+[5.]*2
    answer = solve_rolling(p3.solve_headroom_uc, *args, **kw, window=4, step=2)
    assert answer['has_plan'] and not answer['reserve_met']
    assert len(answer['down_short_mw']) == 6 and answer['down_short_mw'][-1] == pytest.approx(3.)
    assert not any(answer['joined_physical_check'].values())
    assert answer['cost_won'] == pytest.approx(6*21.9)
    assert len(answer['initial_online']) == 1 and '원시 발전량' in answer['rolling']['cost_basis']


def test_startup_floor_relief_crosses_the_adopted_boundary():
    args, kw = data(8)
    args = ([0., 0., 0., 3., 23/3, 9., 9., 9.], np.full((8, 1), 8.), args[2],
            np.full((8, 1), .1), *args[4:])
    kw.update(initial_online=[False], initial_output=[0.], initial_elapsed_hours=[100.],
              up_need=np.zeros(8), down_need=np.zeros(8))
    answer = solve_rolling(p3.solve_headroom_uc, *args, **kw, window=6, step=4)
    assert answer['has_plan'] and answer['target_met']
    assert answer['starts'][3][0] and answer['output_mw'][4][0] == pytest.approx(23/3)
    assert not any(answer['joined_physical_check'].values())


def test_original_rows_bounds_and_integer_tolerances_are_not_relaxed():
    bound = Bounds(np.zeros(2), np.ones(2))
    con = [LinearConstraint(csc_matrix([[1., 1.]]), [1.], [1.])]
    assert violation(np.array([0., 1.]), bound, con, np.ones(2)) == 0
    assert violation(np.array([.5, .5]), bound, con, np.ones(2)) == .5
    assert violation(np.array([0., 1.1]), bound, con, np.ones(2)) > .09


def test_an_invalid_returned_incumbent_is_not_used_as_a_fallback(monkeypatch):
    class BadReturn(Backend):
        def __call__(self, c, **kw):
            result = super().__call__(c, **kw)
            if result.x is not None:
                result.x[0] += 1.
            return result

    monkeypatch.setattr(p3, 'Backend', BadReturn)
    args, kw = data()
    with pytest.raises(ValueError, match='incumbent'):
        p3.solve_headroom_uc(*args, **kw)


def test_a_bad_cost_seed_is_rejected_before_submission(monkeypatch):
    class BadSeed(Backend):
        def __init__(self, size, fuel_start, complete_seed, log_dir=None):
            def invalid(x, cons):
                x = complete_seed(x, cons)
                x[size] = .5
                return x
            super().__init__(size, fuel_start, invalid, log_dir)

    monkeypatch.setattr(p3, 'Backend', BadSeed)
    args, kw = data()
    with pytest.raises(ValueError, match='cost seed'):
        p3.solve_headroom_uc(*args, **kw)


@pytest.mark.parametrize('override', [{'inertia_won': 1.}, {'reserve_ratio': [.1]*4},
                                      {'reserve_mw': [1.]*4}, {'up_need': [float('nan')]*4},
                                      {'reserve_mask': [2]}, {'reserve_price': -1.}])
def test_old_or_invalid_requirements_cannot_be_silently_mixed_in(override):
    args, kw = data()
    with pytest.raises(ValueError):
        p3.solve_headroom_uc(*args, **{**kw, **override})
def test_scaling_includes_both_shortage_prices_and_no_load_is_not_lost(tmp_path):
    args, kw = data(2)
    kw.pop('fuel_curve')
    kw.update(up_need=[5., 5.], down_need=[5., 5.], no_load_won=[-100.],
              objective_scale=.001, validation_log_dir=tmp_path / 'scaled')
    answer = p3.solve_headroom_uc(*args, **kw)
    assert answer['has_plan'] and answer['fuel_cost_won'] == pytest.approx(2*(7000.-100.))
    with np.load(tmp_path / 'scaled' / '02-model.npz') as z:
        assert z['objective'][-4:] == pytest.approx([3000.]*4)
        assert z['objective'][2:4] == pytest.approx([-.1]*2)
    assert answer['solver_stages'][-1]['objective_scale'] == .001


def test_unknown_initial_state_remains_partial_during_joined_validation():
    args, kw = data(6, 2)
    kw.pop('fuel_curve')
    kw.update(initial_online=[True, None], initial_output=[7., None],
              initial_elapsed_hours=[5., None])
    answer = solve_rolling(p3.solve_headroom_uc, *args, **kw, window=4, step=2)
    assert answer['has_plan']
    assert answer['initial_state_source'] == 'partial'
    assert answer['initial_state_known_units'] == 1
    assert not any(answer['joined_physical_check'].values())


def test_unit_metadata_is_not_stitched_when_units_equal_window_hours():
    args, kw = data(6, 4)
    answer = solve_rolling(p3.solve_headroom_uc, *args, **kw, window=4, step=2)
    assert answer['has_plan'] and len(answer['initial_online']) == 4


@pytest.mark.parametrize('override', [{'single_stage': True}, {'objective_scale': 0.},
                                      {'pmax_rated': [9.]}, {'_initial_floor_relief': [[-1.]]}])
def test_annual_port_rejects_unsupported_or_inconsistent_settings(override):
    args, kw = data()
    with pytest.raises(ValueError):
        p3.solve_headroom_uc(*args, **{**kw, **override})
