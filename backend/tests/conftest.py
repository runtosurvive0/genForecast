"""CI는 사내 호기 마스터 대신 명시적인 합성 운전특성을 사용한다."""
import pytest

from midterm import fleet


@pytest.fixture(autouse=True)
def synthetic_coal_master(monkeypatch):
    original = fleet._read_csv
    rows = [{"unit": f"당진{i}", "plant": "당진", "installed_mw": 500 if i < 9 else 1000,
             "min_mw": 100, "max_mw": 500 if i < 9 else 1000,
             "ramp_up_mw_min": 20, "ramp_down_mw_min": 20, "min_up_h": 4, "min_down_h": 4,
             "startup_cost_won": 10000, "heat_a2": .001, "heat_a1": 2, "heat_a0": 10,
             "retire_on": ""} for i in range(1, 11)]
    monkeypatch.setattr(fleet, "_read_csv", lambda path: rows if path.name == "coal_units.csv" else original(path))
