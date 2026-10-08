from datetime import date
from pathlib import Path
import json
import runpy

import pytest


def load_reader():
    return runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "backtest_allocation.py"))["ranking_outages"]


def test_backtest_monthly_assumptions_come_from_local_input_and_keep_period_boundaries(tmp_path):
    path = tmp_path / "ranking.json"
    path.write_text(json.dumps({"1": ["합성발전소1"], "3": ["합성발전소2"]}), encoding="utf-8")
    rows = load_reader()(date(2027, 1, 1), date(2027, 2, 28), path)
    assert [o.unit for o in rows] == ["합성발전소1"]
    assert rows[0].start.date() == date(2027, 1, 1)
    assert rows[0].end.date() == date(2027, 2, 1)


def test_missing_local_outage_input_is_reported(tmp_path):
    with pytest.raises(FileNotFoundError, match="ranking_oh.json"):
        load_reader()(date(2027, 1, 1), date(2027, 2, 28), tmp_path / "absent.json")


def test_invalid_month_is_rejected(tmp_path):
    path = tmp_path / "ranking.json"
    path.write_text('{"13":["합성발전소1"]}', encoding="utf-8")
    with pytest.raises(ValueError, match="1~12"):
        load_reader()(date(2027, 1, 1), date(2027, 12, 31), path)
