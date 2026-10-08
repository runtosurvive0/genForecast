"""프로젝트 SQLite 수급 입력과 읽기 API. 외부 발전계획의 정규화 경계 포함."""
from __future__ import annotations

import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from midterm.database import connect, load_settings, _put
from midterm.scenario import Scenario, ROOT
from midterm.supply import GROUPS, UNITS, DEFAULTS, timestamp, now, init_supply, read_supply, simulate, unloading
from midterm.supply_plans import run_plan, db_plan, model_forecast, latest_forecast
from midterm.fuel_calendar import fuel_calendar

router = APIRouter(prefix="/api/supply", tags=["연료수급 POC"])
Group = Literal["g14", "g58", "g910"]


class Baseline(BaseModel):
    group_id: Group
    at: str
    tonnes: float = Field(ge=0, allow_inf_nan=False)
    cv: float = Field(ge=1000, le=10000, allow_inf_nan=False)
    moisture: float = Field(ge=0, le=100, allow_inf_nan=False)
    ash: float = Field(ge=0, le=100, allow_inf_nan=False)
    sulfur: float = Field(ge=0, le=100, allow_inf_nan=False)


class Vessel(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    cargo: float = Field(gt=0, allow_inf_nan=False)
    incoming_cv: float = Field(ge=1000, le=10000, allow_inf_nan=False)
    arrival_at: str
    start_at: str
    rate: float = Field(ge=0, allow_inf_nan=False)
    allocations: dict[Group, float]


class UnloadPoint(BaseModel):
    at: str
    cumulative: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    rate: float = Field(ge=0, allow_inf_nan=False)
    allocations: dict[Group, float]


class Transfer(BaseModel):
    at: str
    from_group: Group
    to_group: Group
    tonnes: float = Field(gt=0, allow_inf_nan=False)
    note: str = Field(default="", max_length=300)


class Schedule(BaseModel):
    arrival_at: str
    start_at: str


class Config(BaseModel):
    danger_days: float = Field(default=7, ge=0, le=180, allow_inf_nan=False)
    normal_days: float = Field(default=15, gt=0, le=365, allow_inf_nan=False)
    baseline_stale_hours: float = Field(default=72, gt=0, le=8760, allow_inf_nan=False)
    plan_stale_hours: float = Field(default=48, gt=0, le=8760, allow_inf_nan=False)
    heat_method: Literal["curve", "heat_rate"] = "curve"
    heat_rates: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_config(self):
        import math
        if self.normal_days <= self.danger_days:
            raise ValueError("정상 기준은 위험 기준보다 커야 합니다")
        if any(u not in UNITS or not math.isfinite(v) or not 500 <= v <= 10000 for u, v in self.heat_rates.items()):
            raise ValueError("호기별 Heat Rate는 당진1~10, 500~10,000 kcal/kWh 범위로 입력하세요")
        return self


class PlanHour(BaseModel):
    at: str
    unit: str
    mw: float = Field(ge=0, le=2000, allow_inf_nan=False)
    online: bool | None = None


class PlanBatch(BaseModel):
    source: Literal["API", "FORECAST"]
    source_name: str = Field(min_length=1, max_length=200)
    as_of: str
    rows: list[PlanHour] = Field(min_length=1, max_length=50000)


def parse_at(value):
    try:
        return timestamp(value)
    except (ValueError, TypeError):
        raise HTTPException(400, "시각 형식을 확인하세요. 시간대가 없으면 한국시간(KST)으로 해석합니다") from None


def ratios(values):
    import math
    if set(values) != set(GROUPS) or any(not math.isfinite(v) or v < 0 for v in values.values()) or sum(values.values()) <= 0:
        raise HTTPException(400, "세 처의 배분량/비율을 모두 입력하세요. 음수 없이 합계가 0보다 커야 합니다")
    total = sum(values.values())
    return {g: v / total for g, v in values.items()}


@router.get("/records")
def records():
    data = read_supply()
    with connect() as db:
        init_supply(db)
        data["plan_batches"] = [dict(r) for r in db.execute("SELECT * FROM supply_plan_batches ORDER BY id DESC")]
    return data


@router.post("/baselines")
def baseline(body: Baseline):
    at = parse_at(body.at)
    if at > now():
        raise HTTPException(400, "수기 기준재고의 기준시각은 미래일 수 없습니다")
    with connect() as db:
        init_supply(db)
        if db.execute("SELECT 1 FROM supply_baselines WHERE group_id=? AND at=?", (body.group_id, at.isoformat())).fetchone():
            raise HTTPException(409, "동일 처·시각의 기준재고가 이미 있습니다. 새로운 기준시각으로 등록하세요")
        row = db.execute("INSERT INTO supply_baselines(group_id,at,payload,recorded_at) VALUES(?,?,?,?)",
            (body.group_id, at.isoformat(), json.dumps(body.model_dump(exclude={"at", "group_id"})), now().isoformat()))
        return {"id": row.lastrowid}


@router.post("/vessels")
def vessel(body: Vessel):
    arrival, start = parse_at(body.arrival_at), parse_at(body.start_at)
    if start < arrival:
        raise HTTPException(400, "하역 시작은 입항시각 이후로 입력하세요")
    allocations = ratios(body.allocations)
    with connect() as db:
        init_supply(db)
        row = db.execute("INSERT INTO supply_vessels(name,cargo,incoming_cv,arrival_at,recorded_at) VALUES(?,?,?,?,?)",
            (body.name.strip(), body.cargo, body.incoming_cv, arrival.isoformat(), now().isoformat()))
        db.execute("INSERT INTO supply_unload_points(vessel_id,at,cumulative,rate,allocations,recorded_at) VALUES(?,?,?,?,?,?)",
            (row.lastrowid, start.isoformat(), 0, body.rate, json.dumps(allocations), now().isoformat()))
        return {"id": row.lastrowid}


@router.post("/vessels/{vessel_id}/unloading")
def correct_unloading(vessel_id: int, body: UnloadPoint):
    # 쓰기 트랜잭션 안에서 최신 원장을 읽어 동시 보정도 직렬 처리한다.
    at = parse_at(body.at)
    allocations = ratios(body.allocations)
    with connect() as db:
        init_supply(db)
        db.execute("BEGIN IMMEDIATE")
        v = db.execute("SELECT * FROM supply_vessels WHERE id=?", (vessel_id,)).fetchone()
        if not v:
            raise HTTPException(404, "선박이 없습니다")
        points = [{**dict(r), "allocations": json.loads(r["allocations"])} for r in db.execute(
            "SELECT * FROM supply_unload_points WHERE vessel_id=? ORDER BY at", (vessel_id,))]
        if at <= timestamp(points[-1]["at"]):
            raise HTTPException(400, "최신 보정/배분 시각보다 뒤의 시각을 입력하세요")
        cumulative = unloading({**dict(v), "points": points}, at)["cumulative"] if body.cumulative is None else body.cumulative
        if not points[-1]["cumulative"] <= cumulative <= v["cargo"]:
            raise HTTPException(400, "누적 하역량은 이전 확정 누적량 이상, Cargo 이하로 입력하세요")
        if body.cumulative is not None and at > now():
            raise HTTPException(400, "실제 누적량 보정의 시각은 미래일 수 없습니다")
        row = db.execute("INSERT INTO supply_unload_points(vessel_id,at,cumulative,rate,allocations,recorded_at) VALUES(?,?,?,?,?,?)",
            (vessel_id, at.isoformat(), cumulative, body.rate, json.dumps(allocations), now().isoformat()))
        return {"id": row.lastrowid, "cumulative": cumulative}


@router.post("/transfers")
def transfer(body: Transfer):
    at = parse_at(body.at)
    if body.from_group == body.to_group:
        raise HTTPException(400, "출발 처와 도착 처를 다르게 선택하세요")
    with connect() as db:
        init_supply(db)
        row = db.execute("INSERT INTO supply_transfers(at,from_group,to_group,tonnes,note,recorded_at) VALUES(?,?,?,?,?,?)",
            (at.isoformat(), body.from_group, body.to_group, body.tonnes, body.note, now().isoformat()))
        return {"id": row.lastrowid}


@router.put("/vessels/{vessel_id}/schedule")
def reschedule(vessel_id: int, body: Schedule):
    arrival, start = parse_at(body.arrival_at), parse_at(body.start_at)
    if start < arrival or start <= now():
        raise HTTPException(400, "변경 하역 시작은 입항 이후의 미래 시각이어야 합니다")
    with connect() as db:
        init_supply(db)
        db.execute("BEGIN IMMEDIATE")
        v = db.execute("SELECT * FROM supply_vessels WHERE id=?", (vessel_id,)).fetchone()
        points = list(db.execute("SELECT * FROM supply_unload_points WHERE vessel_id=? ORDER BY at", (vessel_id,)))
        if not v:
            raise HTTPException(404, "선박이 없습니다")
        if len(points) != 1 or timestamp(points[0]["at"]) <= now():
            raise HTTPException(400, "하역 전 선박만 일정 변경이 가능합니다. 하역 중에는 속도/누적량 보정을 사용하세요")
        db.execute("INSERT INTO supply_schedule_changes(vessel_id,old_schedule,new_schedule,recorded_at) VALUES(?,?,?,?)",
            (vessel_id, json.dumps({"arrival_at":v["arrival_at"],"start_at":points[0]["at"]}),
             json.dumps({"arrival_at":arrival.isoformat(),"start_at":start.isoformat()}), now().isoformat()))
        db.execute("UPDATE supply_vessels SET arrival_at=? WHERE id=?", (arrival.isoformat(), vessel_id))
        db.execute("UPDATE supply_unload_points SET at=? WHERE id=?", (start.isoformat(), points[0]["id"]))
    return {"id": vessel_id}


@router.put("/config")
def config(body: Config):
    with connect() as db:
        init_supply(db)
        _put(db, "supply", body.model_dump())
    return body.model_dump()


@router.post("/plans")
def import_plan(body: PlanBatch):
    """KPX/DCS 어댑터는 원천 단위를 MW, KST 시간 구간으로 변환한 후 이 경계에 전달."""
    as_of = parse_at(body.as_of)
    rows, seen = [], set()
    from midterm.fleet import load_coal_units
    master = {u.name: u for u in load_coal_units() if u.is_dangjin}
    for r in body.rows:
        at = parse_at(r.at)
        key = (at.isoformat(), r.unit)
        if r.unit not in UNITS or at.minute or at.second or at.microsecond:
            raise HTTPException(400, "당진1~10의 정각 시간별 MW 자료를 입력하세요")
        if r.mw > master[r.unit].installed_mw:
            raise HTTPException(400, f"{r.unit}의 설비용량을 초과했습니다")
        if key in seen or (r.online is False and r.mw > 0):
            raise HTTPException(400, "시간·호기 중복 또는 정지상태의 양수 출력을 확인하세요")
        seen.add(key)
        rows.append((at.isoformat(), r.unit, r.mw, r.online if r.online is not None else r.mw > .5))
    with connect() as db:
        init_supply(db)
        row = db.execute("INSERT INTO supply_plan_batches(source,source_name,as_of,recorded_at) VALUES(?,?,?,?)",
            (body.source, body.source_name, as_of.isoformat(), now().isoformat()))
        db.executemany("INSERT INTO supply_plan_hours VALUES(?,?,?,?,?)", [(row.lastrowid, *r) for r in rows])
        return {"id": row.lastrowid, "hours": len(rows)}


@router.post("/forecast")
def forecast(start: str, days: int = Query(default=67, ge=14, le=90)):
    config = load_settings()
    first = parse_at(start).date()
    scenario = Scenario.from_json({**config["scenario"], "start": first.isoformat(),
        "end": (first + timedelta(days=days - 1)).isoformat()})
    return model_forecast(scenario)


@router.get("/dashboard")
def dashboard(horizon: int = Query(default=30), at: str | None = None, plan_key: str | None = None):
    if horizon not in (7, 30, 60):
        raise HTTPException(400, "전망 기간은 7일, 30일, 60일 중 선택하세요")
    as_of = parse_at(at) if at else now()
    data = read_supply()
    plans = []
    for path in sorted((ROOT / "runs").glob("*/summary.json"), reverse=True):
        summary = json.loads(path.read_text(encoding="utf-8"))
        demo = summary.get("classification") == "functional_demo"
        plans.append({"key": "mip:" + path.parent.name, "name": "MIP · " + summary["scenario"]["name"] + (" · 동작 확인용" if demo else ""),
            "start": summary["scenario"]["start"], "end": summary["scenario"]["end"], "source": "FORECAST"})
    with connect() as db:
        init_supply(db)
        for r in db.execute("SELECT b.*,min(h.at) AS start,max(h.at) AS end FROM supply_plan_batches b JOIN supply_plan_hours h ON b.id=h.batch_id GROUP BY b.id ORDER BY b.id DESC"):
            plans.insert(0, {"key": "db:" + str(r["id"]), "name": r["source_name"], "start": r["start"][:10], "end": r["end"][:10], "source": r["source"]})
    chosen = next((p for p in plans if p["key"] == plan_key), None) if plan_key else next(
        (p for p in plans if p["start"] <= as_of.date().isoformat() <= p["end"]), None)
    plan, model_rows, source = {}, [], None
    if plan_key and not chosen:
        raise HTTPException(404, "선택한 발전계획이 없습니다")
    if chosen:
        if chosen["key"].startswith("mip:"):
            plan, model_rows, source = run_plan(chosen["key"][4:])
        else:
            plan, source = db_plan(int(chosen["key"][3:]))
    settings = load_settings()
    fallback = settings["fuel"]
    result = simulate(data, plan, as_of, horizon, fallback["calorific_kcal_kg"])
    first, last = as_of.date().isoformat(), (as_of + timedelta(days=horizon - 1)).date().isoformat()
    saved_forecast = latest_forecast()
    if not model_rows and saved_forecast:
        model_rows = saved_forecast["daily"]
    model_rows = [r for r in model_rows if first <= r["day"] <= last]
    stale = bool(source and (now() - timestamp(source["as_of"])).total_seconds() / 3600 > data["config"]["plan_stale_hours"])
    # 원천 갱신시각이 지난 계획으로 정상/주의를 확정하지 않는다. 위험 신호는 보존.
    if stale:
        for g in result["groups"]:
            if g["risk"] != "danger":
                g["risk"] = "unknown"
        if result["kpis"]["risk"] != "danger":
            result["kpis"]["risk"] = "unknown"
    issues = []
    if not all(g["baseline"] for g in result["groups"]):
        issues.append("처별 수기 기준재고 미등록 · 재고와 위험도 판단 보류")
    if not source:
        issues.append("조회기간의 호기별 발전계획 미등록 · KPX API 연결 또는 계획자료 등록 필요")
    elif stale:
        issues.append("발전계획 갱신시각 경과 · 최신 자료 확인 필요")
    if any(g["stale"] for g in result["groups"]):
        issues.append("수기 기준재고 기준시각 경과 · 최신 기준재고 확인 필요")
    if source and any(u["tonnes"] is None for u in result["units"]):
        issues.append("호기별 시간계획이 조회기간 또는 재고일수 계산용 추가 7일을 완전히 덮지 않음")
    if source and source.get("classification") == "functional_demo":
        issues.insert(0, "동작 확인용 MIP 결과 · 운영 계획 확인 필요")
    issues.extend("이탄 원장 " + issue for issue in result["transfer_issues"])
    if source and result["kpis"]["risk"] == "unknown" and not issues:
        issues.append("재고일수 분모가 0이거나 추가 7일 계획자료가 부족하여 위험도 판단 보류")
    forecast_source = source if chosen and chosen["key"].startswith("mip:") else saved_forecast
    model_stale = bool(forecast_source and (now() - timestamp(forecast_source["as_of"])).total_seconds() / 3600 > data["config"]["plan_stale_hours"])
    result.update({"plans": plans, "plan_key": chosen["key"] if chosen else "", "plan_source": source,
        "fuel_calendar": fuel_calendar(plan, as_of.year, data["config"], fallback),
        "plan_stale": stale, "models": model_rows, "model_source": forecast_source,
        "model_stale": model_stale,
        "config": data["config"], "fuel": fallback, "issues": issues,
        "db_outages": settings["scenario"]["coal_oh"],
        "method": {"days": "각 날짜 말 재고 ÷ 다음 7일의 일평균 예상 사용량. 7일 전체 계획이 없거나 사용량이 0이면 일수 미표시.",
            "inventory": "최신 기준재고 + 이후 하역배분 + 이탄 유입 − 이탄 유출 − 계획 연소. 최대 1시간 구간 입고 후 연소, 기준시각에서 분할.",
            "heat": "입력된 호기 Heat Rate 우선; 미입력은 기존 2차 열량곡선. Heat Rate 모드의 미입력 기본값은 설비군 곡선의 정격출력 환산 임시값.",
            "cv": "등록 처는 혼합 저탄장 열량, 미등록 처의 사용량 환산만 전역 임시 발열량 사용. 입항예정탄 열량과 구분."}})
    return result
