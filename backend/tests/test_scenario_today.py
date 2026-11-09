from datetime import date, datetime, timedelta, timezone

import pytest

from midterm import scenario


@pytest.mark.parametrize('start', [date(2026, 11, 9), date(2026, 12, 30), date(2028, 2, 28)])
def test_new_scenario_is_ninety_days_from_today_without_rebasing_saved_inputs(monkeypatch, start):
    monkeypatch.setattr(scenario, 'today_kst', lambda: start)
    for new in [scenario.Scenario(), scenario.default_scenario()]:
        assert new.start == start
        assert new.end == start + timedelta(days=89)
        assert len(new.days) == 90
    saved = scenario.Scenario.from_json({'start': '2027-01-01', 'end': '2027-12-31'})
    assert saved.start == date(2027, 1, 1)
    assert saved.end == date(2027, 12, 31)


def test_today_is_korean_date_even_when_system_date_is_utc(monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 11, 8, 15, tzinfo=timezone.utc).astimezone(tz)
    monkeypatch.setattr(scenario, 'datetime', Clock)
    assert scenario.today_kst() == date(2026, 11, 9)
