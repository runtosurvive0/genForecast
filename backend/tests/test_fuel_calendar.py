from datetime import timedelta
from types import SimpleNamespace

import pytest

from midterm.fuel_calendar import fuel_calendar
from midterm.supply import DEFAULTS, UNITS, timestamp


def calendar_plan(start, days):
    first = timestamp(start)
    return {(first + timedelta(hours=h)).isoformat(): {
        u: {"mw": 100, "online": True} for u in UNITS} for h in range(days * 24)}


def calculate(plan, year=2027, cv=5500, config=None):
    master = {u: SimpleNamespace(heat=(0, 2.2, 0), installed_mw=500) for u in UNITS}
    return fuel_calendar(plan, year, config or DEFAULTS,
                         {"calorific_kcal_kg": cv, "is_assumption": True}, master)


def test_complete_month_is_sum_of_hourly_fuel_and_other_months_stay_unknown():
    result = calculate(calendar_plan("2027-01-01", 31))
    january, february = result["monthly"][:2]
    assert january["unit_tonnes"]["당진1"] == pytest.approx(31 * 24 * 40)
    assert january["complete_days"]["당진1"] == 31
    assert february["unit_tonnes"]["당진1"] is None
    assert february["complete_days"]["당진1"] == 0
    assert len(result["daily"]) == 365


def test_missing_single_unit_hour_invalidates_its_day_and_month_only():
    plan = calendar_plan("2027-01-01", 31)
    del plan["2027-01-13T12:00:00+09:00"]["당진1"]
    result = calculate(plan)
    assert result["daily"][12]["unit_tonnes"]["당진1"] is None
    assert result["monthly"][0]["unit_tonnes"]["당진1"] is None
    assert result["monthly"][0]["complete_days"]["당진1"] == 30
    assert result["monthly"][0]["unit_tonnes"]["당진2"] == pytest.approx(31 * 24 * 40)


def test_leap_month_stopped_unit_and_changed_calorific_value():
    plan = calendar_plan("2028-02-01", 29)
    for rows in plan.values():
        rows["당진1"] = {"mw": 0, "online": False}
    result = calculate(plan, year=2028, cv=4400)
    february = result["monthly"][1]
    assert len(result["daily"]) == 366
    assert february["expected_days"] == 29
    assert february["unit_tonnes"]["당진1"] == 0
    assert february["unit_tonnes"]["당진2"] == pytest.approx(29 * 24 * 50)


def test_manual_heat_rate_overrides_curve_in_monthly_totals():
    config = {**DEFAULTS, "heat_rates": {"당진1": 2750}}
    result = calculate(calendar_plan("2027-01-01", 31), config=config)
    assert result["monthly"][0]["unit_tonnes"]["당진1"] == pytest.approx(31 * 24 * 50)
    assert result["monthly"][0]["unit_tonnes"]["당진2"] == pytest.approx(31 * 24 * 40)
