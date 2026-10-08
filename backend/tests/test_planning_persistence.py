from datetime import date

import numpy as np
import pytest

from midterm.annual import AnnualResult
from midterm.report import save_run
from midterm.scenario import Scenario
from midterm.supply import UNITS


def test_new_run_preserves_capacity_series_and_uses_master_for_utilization(tmp_path):
    output = np.full((24, 10), 100.)
    zeros = np.zeros(24)
    result = AnnualResult(scenario=Scenario(start=date(2027, 1, 1), end=date(2027, 1, 1)),
        days=[date(2027, 1, 1)], names=list(UNITS), demand=np.full(24, 80000.), solar=zeros,
        temp=zeros, nuclear=zeros, coal_model=np.full(24, 1100.), coal_target=np.full(24, 1000.),
        coal_available=np.full(24, 6000.), output=output, online=np.ones_like(output, dtype=bool),
        starts=np.zeros_like(output), shortage=zeros, excess=zeros,
        fuel_cost_won=np.zeros_like(output), nuclear_running={}, window_status=['optimal'],
        elapsed_seconds=0, model_info={'net_demand': {'demand_growth_pct': 0, 'solar_growth_pct': 0,
            'trained': 'synthetic fixture'}, 'coal_curve': {'trained': 'synthetic fixture'}, 'milp': {}})
    summary = save_run(result, tmp_path)
    assert summary['installed_mw'] == 6000  # synthetic fixture, never hard-coded 6040
    assert summary['unit_capacity_mw']['당진9'] == 1000
    assert summary['annual']['dangjin_cf_pct'] == pytest.approx(16.67)
    with np.load(tmp_path / 'hourly.npz') as stored:
        np.testing.assert_array_equal(stored['coal_available'], result.coal_available)
