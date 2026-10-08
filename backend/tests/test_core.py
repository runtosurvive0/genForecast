from datetime import date, datetime, timedelta

import numpy as np
import pytest

from midterm.calendar import SUNDAY_OR_HOLIDAY, WEEKDAY, covers, day_type, is_major_holiday
from midterm.fleet import NuclearUnit, nuclear_hourly
from midterm.outages import parse_outage_rows, validate_units
from midterm.uc import solve_coal_uc
from midterm.units import canonical_unit_name


def test_2027_holidays_are_declared():
    assert covers(date(2027, 12, 31))
    assert day_type(date(2027, 2, 9)) == SUNDAY_OR_HOLIDAY      # 설 대체공휴일 (화)
    assert is_major_holiday(date(2027, 9, 15))                   # 추석
    assert day_type(date(2027, 10, 11)) == SUNDAY_OR_HOLIDAY    # 한글날 대체 (월)
    assert day_type(date(2027, 3, 2)) == WEEKDAY


@pytest.mark.parametrize("raw, expected", [
    ("당진#5", "당진5"), ("당진5호기", "당진5"), ("당진본부 3호기", "당진3"), ("당진 10", "당진10"),
    ("신보령화력#1", "신보령1"), ("삼척그린파워#2", "삼척그린2"), ("신서천화력1호기", "신서천"),
    ("한빛#1", "한빛1"),
])
def test_unit_names_fold_to_master(raw, expected):
    assert canonical_unit_name(raw) == expected


def test_outage_dates_are_inclusive_and_times_are_exact():
    rows = [["호기", "시작", "종료", "비고"],
            ["당진#3", "2027-04-01", "2027-04-02", "OH"],
            ["당진4", "2027-04-01 13:00", "2027-04-01 18:00", ""]]
    whole, partial = parse_outage_rows(rows)
    assert whole.unit == "당진3"
    assert whole.start == datetime(2027, 4, 1) and whole.end == datetime(2027, 4, 3)
    assert partial.covers_hour(datetime(2027, 4, 1, 13)) and not partial.covers_hour(datetime(2027, 4, 1, 18))
    assert whole.as_row()["end"] == "2027-04-02"


def test_operator_form_is_read():
    rows = [["석탄 정비일정"], ["자원명", "설비용량", "시작년", "월", "일", "종료년", "월", "일"],
            ["당진9호기", "1020", "2027", "5", "1", "2027", "6", "15"]]
    (outage,) = parse_outage_rows(rows)
    assert outage.unit == "당진9" and outage.end == datetime(2027, 6, 16)


def test_unknown_unit_names_are_reported_not_dropped():
    outages = parse_outage_rows([["unit", "start", "end"], ["당진11", "2027-01-01", "2027-01-02"]])
    assert validate_units(outages, ["당진1", "당진10"], "석탄") == ["당진11"]


def test_end_before_start_is_rejected():
    with pytest.raises(ValueError):
        parse_outage_rows([["unit", "start", "end"], ["당진1", "2027-02-01", "2027-01-01"]])


def test_nuclear_output_drops_during_outage():
    units = [NuclearUnit("한빛#1", 950, 1000, True), NuclearUnit("새울#3", 1400, 1455, False)]
    outages = parse_outage_rows([["unit", "start", "end"], ["한빛1", "2027-01-02", "2027-01-02"]])
    hours = [datetime(2027, 1, 1) + timedelta(hours=k) for k in range(72)]
    total, running = nuclear_hourly(units, outages, hours)
    assert total[0] == pytest.approx(1003.0)          # 비활성 새울#3 는 0
    assert total[24:48].max() == 0 and total[48] > 0
    assert set(running) == {"한빛#1"}


def test_single_stage_milp_meets_target_and_respects_outage():
    h, n = 48, 3
    target = np.r_[np.full(24, 900.0), np.full(24, 1300.0)]
    minimum = np.tile([200.0, 200.0, 300.0], (h, 1))
    maximum = np.tile([500.0, 500.0, 900.0], (h, 1))
    ramp = np.full((h, n), 20.0)
    costs = np.tile([80.0, 90.0, 85.0], (h, 1))
    must = np.zeros((h, n), bool)
    outage = np.zeros((h, n), bool)
    outage[:, 1] = True
    result = solve_coal_uc(target, minimum, maximum, ramp, costs, must, outage,
                           np.array([4, 4, 6]), np.array([4, 4, 8]), allow_approximate=True,
                           single_stage=True, objective_scale=1e-3, time_limit=30,
                           cost_time_limit=30, no_load_won=np.tile([1e5, 1e5, 2e5], (h, 1)))
    assert result["has_plan"]
    output = np.asarray(result["output_mw"])
    assert output[:, 1].max() == 0
    assert np.abs(output.sum(axis=1) - target).max() < 1.0


def test_table_is_restored_from_mirror_when_csv_is_deleted(tmp_path):
    from midterm.storage import mirror_of, read_table, write_table

    path = tmp_path / "units.csv"
    write_table(path, ["unit", "retire_on"], [{"unit": "당진1", "retire_on": ""}])
    path.write_text("﻿unit,retire_on\n당진1,2027-06-30\n", encoding="utf-8")   # 사람이 고친 CSV
    assert read_table(path)[0]["retire_on"] == "2027-06-30"                        # 읽으면 사본도 갱신
    path.unlink()                                                                   # 정리 프로그램이 지움
    assert read_table(path)[0]["retire_on"] == "2027-06-30"
    assert path.exists() and mirror_of(path).exists()
