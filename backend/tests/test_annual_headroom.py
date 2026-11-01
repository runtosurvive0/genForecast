"""Synthetic numerical and orchestration regressions; no fleet/year optimization or public API."""
from concurrent.futures import Future
from datetime import date, timedelta
from queue import Queue
from types import SimpleNamespace
import time

import numpy as np
import pytest

from midterm import annual
from midterm.report import save_run
from midterm.scenario import Scenario


@pytest.mark.parametrize("year, days", [(2027, 365), (2028, 366)])
def test_all_seasons_and_leap_day_are_assembled_without_warmup_leakage(monkeypatch, tmp_path, year, days):
    scenario = Scenario(start=date(year, 1, 1), end=date(year, 12, 31), workers=4,
                        reserve_ratio=.8, quality="fast")
    first = scenario.start - timedelta(days=annual.WARMUP_DAYS)
    all_days = [first + timedelta(days=i) for i in range(days + annual.WARMUP_DAYS)]
    h, n = len(all_days)*24, 2
    shape = (h, n)
    month = np.repeat([d.month for d in all_days], 24)
    target = np.full(h, 700.)
    # Monthly no-load and startup costs must survive the payload slices unchanged.
    inputs = SimpleNamespace(names=["당진1", "당진2"], minimum=np.full(shape, 100.),
        maximum=np.full(shape, 500.), ramp_up=np.full(shape, 20.), ramp_down=np.full(shape, 15.),
        costs=np.repeat(month[:, None], n, axis=1).astype(float),
        no_load=np.repeat(-month[:, None], n, axis=1).astype(float),
        startup_cost=np.repeat((month*1000.)[:, None], n, axis=1),
        must=np.zeros(shape, bool), outage=np.zeros(shape, bool),
        uptime=np.array([4, 4]), downtime=np.array([4, 4]),
        fuel_curve=np.tile([.1, 2., 3.], (*shape, 1)))
    prep = dict(inputs=inputs, target=target, all_days=all_days, hours=list(range(h)),
        nuclear=np.zeros(h), available=np.full(h, 1000.), raw=target.copy(), running={}, warnings=[],
        forecast=[SimpleNamespace(demand_mw=np.full(24, 80000.), solar_mw=np.zeros(24),
                                  temp_c=np.zeros(24)) for _ in all_days],
        net_model=SimpleNamespace(trained_from="synthetic", trained_through="synthetic",
                                  demand_growth=0., solar_growth=0.),
        coal_model=SimpleNamespace(first_day="synthetic", last_day="synthetic", model_kind="fixture"))
    monkeypatch.setattr(annual, "group_constraints",
        lambda *a: dict(group_caps=[], group_online_minimums=[], group_online_maximums=[]))

    class Manager:
        closed = False
        def Queue(self):
            return Queue()
        def shutdown(self):
            self.closed = True

    manager = Manager()
    import multiprocessing
    monkeypatch.setattr(multiprocessing, "Manager", lambda: manager)
    seen = []

    def synthetic_segment(payload):
        seen.append(payload)
        segment = payload["segment"]
        a, b = annual._segments(days, 4)[segment]
        h0, h1 = a*24, (b+annual.WARMUP_DAYS)*24
        assert np.array_equal(payload["no_load_won"], inputs.no_load[h0:h1])
        assert np.array_equal(payload["startup_cost"], inputs.startup_cost[h0:h1])
        assert np.array_equal(payload["args"][4], inputs.costs[h0:h1])
        assert np.array_equal(payload["up_need"], target[h0:h1]*scenario.reserve_ratio)
        assert np.array_equal(payload["down_need"], payload["up_need"])
        assert payload["single_stage"] is False and payload["objective_scale"] == .001
        assert "reserve_mw" not in payload
        count = h1-h0
        power = np.full((count, n), 350.)
        # Deliberately distinctive warmup dispatch: it must never enter scored output.
        power[:48] = 123.
        values = dict(up_need_mw=np.full(count, 560.), down_need_mw=np.full(count, 560.),
            up_headroom_mw=np.full(count, 300.), down_headroom_mw=np.full(count, 500.),
            up_short_mw=np.full(count, 260.), down_short_mw=np.full(count, 60.),
            up_hourly_pmax_short_mw=np.full(count, 260.),
            solver_up_short_mw=np.full(count, 260.), solver_down_short_mw=np.full(count, 61.))
        return dict(segment=segment, seconds=0., window_status=["optimal"],
            output_mw=power, online=power > 0, starts=np.zeros_like(power, bool),
            shortage_mw=np.zeros(count), excess_mw=np.zeros(count),
            solver_stages=[dict(kind="cost", valid_incumbent=True)],
            joined_physical_check=dict(violated_rows=0, violated_bounds=0, integer_violations=0), **values)

    class Pool:
        def __init__(self, **kw):
            assert kw["max_workers"] == 4
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def submit(self, function, payload):
            assert function is annual._solve_segment
            future = Future()
            future.set_result(synthetic_segment(payload))
            return future

    monkeypatch.setattr(annual, "ProcessPoolExecutor", Pool)
    result = annual.solve_prepared(prep, scenario, lambda e: None, time.perf_counter())
    assert manager.closed and len(seen) == 4
    assert result.days[0] == scenario.start and result.days[-1] == scenario.end
    assert len(result.days) == days and {d.month for d in result.days} == set(range(1, 13))
    assert result.output.shape == (days*24, n) and np.all(result.output == 350.)
    assert np.all(result.fuel_cost_won == pytest.approx(.1*350**2+2*350+3))
    milp = result.model_info["milp"]
    assert milp["reserve_shortfall_won_per_mwh"] == 3e6 and not milp["reserve_met"]
    assert milp["global_segment_seams_certified"] is False
    assert milp["headroom_shortages"]["up_short_mw"]["planned_hours"] == days*24
    assert milp["headroom_shortages"]["down_short_mw"]["mwh"] == pytest.approx(days*24*60.)
    assert len(milp["segment_diagnostics"]) == 4
    summary = save_run(result, tmp_path)
    assert len(summary["daily"]) == days
    with np.load(tmp_path / "hourly.npz") as saved:
        assert saved["down_short_mw"].shape == (days*24,)
        assert np.all(saved["solver_down_short_mw"] == 61.)
        assert np.all(saved["down_short_mw"] == 60.)


def test_window_retries_no_plan_but_does_not_retry_invalid_seed(monkeypatch):
    from midterm import headroom_uc
    seen = []

    def solve(*args, **kw):
        seen.append((kw["time_limit"], kw["mip_rel_gap"]))
        return {"has_plan": len(seen) > 1, "status": "fixture"}

    monkeypatch.setattr(headroom_uc, "solve_headroom_uc", solve)
    count = [0]
    result = annual._solve_window(None, 0, count, time_limit=12., mip_rel_gap=.001)
    assert result["has_plan"] and seen == [(12., .001), (36., .01)] and count == [1]

    def invalid(*args, **kw):
        raise ValueError("Completed cost seed violates the original model")

    monkeypatch.setattr(headroom_uc, "solve_headroom_uc", invalid)
    with pytest.raises(ValueError, match="cost seed"):
        annual._solve_window(None, 0, count, time_limit=12., mip_rel_gap=.001)
    assert count == [1]


def test_real_worker_routes_the_small_model_through_the_validated_solver():
    h = 50
    shape = (h, 1)
    payload = dict(queue=None, segment=0,
        args=[np.full(h, 7.), np.full(shape, 5.), np.full(shape, 10.), np.ones(shape),
              np.ones(shape), np.zeros(shape, bool), np.zeros(shape, bool), [1], [1]],
        up_need=np.full(h, 5.), down_need=np.full(h, 5.), reserve_mask=[True], pmax_rated=[10.],
        initial_online=[True], initial_output=[7.], initial_elapsed_hours=[5.],
        time_limit=2., cost_time_limit=2., mip_rel_gap=.001, objective_scale=.001,
        no_load_won=np.full(shape, -100.))
    result = annual._solve_segment(payload)
    assert result["output_mw"].shape == (50, 1)
    assert np.allclose(result["up_short_mw"], 2.)
    assert np.allclose(result["down_short_mw"], 3.)
    costs = [s for s in result["solver_stages"] if s["kind"] == "cost"]
    assert len(costs) == 2 and all(s["validation"]["seed_submitted"] for s in costs)
    assert not any(result["joined_physical_check"].values())
