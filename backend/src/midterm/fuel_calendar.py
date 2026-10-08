"""연간 발전계획의 일·월 석탄량. 누락된 시간은 사용량 0으로 바꾸지 않는다."""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta

from midterm.fleet import load_coal_units
from midterm.supply import UNITS, heat_gcal, timestamp


def fuel_calendar(plan, year, config, fuel, master=None):
    """고정 기준열량으로 연간 구매 계획을 환산. 저탄장 혼합열량 전망과 구분."""
    master = master or {u.name: u for u in load_coal_units() if u.is_dangjin}
    cv = fuel["calorific_kcal_kg"]
    start = timestamp(datetime(year, 1, 1))
    end = timestamp(datetime(year + 1, 1, 1))
    daily = []
    day = start
    while day < end:
        rows = [plan.get((day + timedelta(hours=h)).isoformat(), {}) for h in range(24)]
        totals = {}
        for unit in UNITS:
            if all(unit in r for r in rows):
                totals[unit] = sum(heat_gcal(unit, r[unit]["mw"], r[unit]["online"], config, master)
                                   for r in rows) * 1000 / cv
            else:
                totals[unit] = None
        daily.append({"day": day.date().isoformat(), "unit_tonnes": totals})
        day += timedelta(days=1)
    monthly = []
    for month in range(1, 13):
        period = f"{year}-{month:02d}"
        rows = [r for r in daily if r["day"].startswith(period)]
        monthly.append({"month": period, "expected_days": calendar.monthrange(year, month)[1],
                        "unit_tonnes": {u: sum(r["unit_tonnes"][u] for r in rows)
                                        if all(r["unit_tonnes"][u] is not None for r in rows) else None
                                        for u in UNITS},
                        "complete_days": {u: sum(r["unit_tonnes"][u] is not None for r in rows)
                                          for u in UNITS}})
    return {"year": year, "daily": daily, "monthly": monthly,
            "calorific_kcal_kg": cv, "is_assumption": fuel["is_assumption"],
            "method": "고정 기준 발열량과 호기별 열량곡선/Heat Rate로 발전계획을 톤 환산. "
                      "월 합계는 해당 월 모든 시간계획이 있는 호기만 표시. "
                      "재고전망의 저탄장 혼합열량 기반 사용량과 다를 수 있음."}
