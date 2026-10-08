"""React용 저장 MILP 조회 계약. 계산을 실행하거나 합성 실적으로 대체하지 않는다."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from midterm.fleet import load_coal_units
from midterm.fuel_calendar import fuel_calendar
from midterm.outages import parse_outage_rows
from midterm.supply import UNITS, timestamp
from midterm.supply_plans import run_plan
from midterm.web.supply_api import dashboard

router = APIRouter(prefix="/api/planning", tags=["React MILP 조회"])


def complete_sum(values):
    return sum(values) if values and all(v is not None for v in values) else None


@router.get("/runs/{run_id}/snapshot")
def snapshot(run_id: str, start: date | None = None, horizon: int = Query(default=30)):
    if horizon not in (7, 30, 60, 90):
        raise HTTPException(400, "조회 기간은 7, 30, 60, 90일 중 선택하세요")
    try:
        plan, _, source = run_plan(run_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    first = start or date.fromisoformat(source["start"])
    last = first + timedelta(days=horizon - 1)
    if first.isoformat() < source["start"] or last.isoformat() > source["end"]:
        raise HTTPException(400, "조회 기간이 선택한 MILP 계산 기간을 벗어납니다")
    data = dashboard(horizon=horizon, at=first.isoformat(), plan_key="mip:" + run_id)
    master = {u.name: u for u in load_coal_units() if u.is_dangjin}
    capacities = source.get("unit_capacity_mw") or {u: master[u].installed_mw for u in UNITS}
    calendars = [data["fuel_calendar"] if year == first.year else
                 fuel_calendar(plan, year, data["config"], data["fuel"], master)
                 for year in range(int(source["start"][:4]), int(source["end"][:4]) + 1)]
    fuel_days = {d["day"]: d["unit_tonnes"] for c in calendars for d in c["daily"]}
    units, daily = [], []
    at = timestamp(first.isoformat())
    energy = {u: [] for u in UNITS}
    online = {u: [] for u in UNITS}
    for i in range(horizon):
        day = at + timedelta(days=i)
        rows = [plan.get((day + timedelta(hours=h)).isoformat(), {}) for h in range(24)]
        for u in UNITS:
            complete = all(u in r for r in rows)
            energy[u].append(sum(r[u]["mw"] for r in rows) if complete else None)
            online[u].append(sum(r[u]["online"] for r in rows) if complete else None)
        day_key = day.date().isoformat()
        daily.append({"date": day_key,
            "generation_mwh": complete_sum([energy[u][-1] for u in UNITS]),
            "fuel_tonnes": complete_sum(list(fuel_days[day_key].values()))})
    for u in UNITS:
        mwh = complete_sum(energy[u])
        capacity = capacities[u]
        units.append({"unit_id": "dj-" + u.removeprefix("당진"), "name": u + "호기",
            "capacity_mw": capacity, "generation_mwh": mwh,
            "capacity_factor_pct": mwh / (capacity * horizon * 24) * 100 if mwh is not None else None,
            "online_hours": complete_sum(online[u]),
            "fuel_tonnes": complete_sum([fuel_days[d["date"]][u] for d in daily])})
    outages = parse_outage_rows([["unit", "start", "end", "note"]] +
                               [[o["unit"], o["start"], o["end"], o.get("note", "")]
                                for o in source["outages"]["coal"]])
    periods = [{"unit_id": "dj-" + o.unit.removeprefix("당진"), "name": o.unit + "호기",
                "start_at": timestamp(o.start).isoformat(), "end_at": timestamp(o.end).isoformat(),
                "note": o.note} for o in outages if o.unit in UNITS]
    monthly = [{"month": m["month"], "expected_days": m["expected_days"],
                "complete_days": min(m["complete_days"].values()),
                "fuel_tonnes": complete_sum(list(m["unit_tonnes"].values()))}
               for c in calendars for m in c["monthly"]
               if source["start"][:7] <= m["month"] <= source["end"][:7]]
    issues = list(dict.fromkeys([*source["warnings"], *data["issues"]]))
    if not source.get("unit_capacity_mw"):
        issues.append("이전 계산의 설비용량 스냅샷 미보존 · 현재 설비 원장으로 이용률 계산")
    if any(r.get("coal_available_mw") is None for r in data["models"]):
        issues.append("이전 계산에 가용용량 시계열 미보존 · 새 계산부터 표시")
    if not periods:
        issues.append("선택한 계산에 당진 계획정지 일정 미등록 · 무정비 확정을 의미하지 않음")
    return {"schema_version": 1, "plant_id": "dangjin", "run_id": run_id,
        "name": source["name"], "classification": source["classification"],
        "classification_note": source["classification_note"], "generated_at": source["as_of"],
        "run_start": source["start"], "run_end": source["end"], "start": first.isoformat(),
        "end": last.isoformat(), "horizon_days": horizon, "timezone": "Asia/Seoul",
        "fuel": data["fuel"], "fuel_method": data["fuel_calendar"]["method"],
        "units": units, "daily": daily, "monthly": monthly, "outages": periods,
        "models": data["models"], "model_info": source["model_info"],
        "inventory": {"groups": data["groups"], "daily": data["forecast"],
                      "kpis": data["kpis"], "plan_stale": data["plan_stale"],
                      "thresholds": {key: data["config"][key] for key in ("danger_days", "normal_days")}},
        "vessels": data["vessels"], "issues": issues}
