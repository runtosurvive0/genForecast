"""공통 수급 배정과 재현 가능한 전망 저장. 쓰기 권한은 기존 관리자 규칙을 따른다."""
from copy import deepcopy
from datetime import date
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from midterm.database import connect
from midterm.berth_planning import (init_berths, read_berths, scope_records, apply_assignments,
                                    calendar, recommendations, project, replay, master_snapshot)
from midterm.supply import read_supply, timestamp, now
from midterm.supply_plans import run_plan

router = APIRouter(prefix="/api/supply", tags=["부두 배정·재고 시뮬레이션"])


class Context(BaseModel):
    run_id: str = Field(min_length=1, max_length=150)
    start: date
    horizon: Literal[7, 30, 60, 90] = 30


def inputs(body: Context):
    try:
        plan, _, source = run_plan(body.run_id)
    except ValueError as error:
        raise HTTPException(404, str(error)) from None
    from datetime import timedelta
    if body.start.isoformat() < source["start"] or (body.start + timedelta(days=body.horizon - 1)).isoformat() > source["end"]:
        raise HTTPException(400, "조회 기간이 MILP 계산 기간을 벗어납니다")
    return {"run_id": body.run_id, "records": scope_records(read_supply(), body.run_id), "berths": read_berths(),
            "plan": plan, "master": master_snapshot(), "as_of": timestamp(body.start).isoformat(),
            "horizon": body.horizon, "fuel_cv": (source.get("fuel") or {}).get("calorific_kcal_kg", 5500)}


class Shipment(BaseModel):
    run_id: str | None = Field(default=None, min_length=1, max_length=150)
    name: str = Field(min_length=1, max_length=100)
    cargo: float = Field(gt=0, le=1000000, allow_inf_nan=False)
    incoming_cv: float = Field(ge=1000, le=10000, allow_inf_nan=False)
    arrival_at: str
    mmsi: str | None = Field(default=None, pattern=r"^\d{9}$")
    imo: str | None = Field(default=None, pattern=r"^\d{7}$")
    coal_grade: Literal["high", "low", "blend"] | None = None
    voyage_key: str = Field(min_length=1, max_length=150)


@router.post("/shipments")
def register_shipment(body: Shipment):
    from midterm.milp_store import stored_run
    if body.run_id and not stored_run(body.run_id):
        raise HTTPException(404, "DB에 완료된 MILP 계산을 선택하세요")
    if not body.name.strip() or not body.voyage_key.strip():
        raise HTTPException(400, "선박명과 항차 키를 입력하세요")
    try:
        arrival = timestamp(body.arrival_at)
    except ValueError:
        raise HTTPException(400, "입항 예정시각을 확인하세요") from None
    with connect() as db:
        init_berths(db)
        columns = {r[1] for r in db.execute("PRAGMA table_info(supply_vessels)")}
        if "voyage_key" not in columns:
            db.execute("ALTER TABLE supply_vessels ADD COLUMN voyage_key TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS shipment_key ON supply_vessels(coalesce(run_id,'operational'),voyage_key)")
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT * FROM supply_vessels WHERE run_id IS ? AND voyage_key=?", (body.run_id, body.voyage_key)).fetchone()
        if existing:
            if all(existing[k] == v for k, v in {"name": body.name.strip(), "cargo": body.cargo,
                "incoming_cv": body.incoming_cv, "arrival_at": arrival.isoformat(), "mmsi": body.mmsi,
                "imo": body.imo, "coal_grade": body.coal_grade}.items()):
                return {"id": existing["id"]}
            raise HTTPException(409, "동일 항차 키의 다른 화물이 이미 등록되어 있습니다")
        row = db.execute("INSERT INTO supply_vessels(name,cargo,incoming_cv,arrival_at,recorded_at,mmsi,imo,coal_grade,run_id,classification,voyage_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (body.name.strip(), body.cargo, body.incoming_cv, arrival.isoformat(), now().isoformat(), body.mmsi,
             body.imo, body.coal_grade, body.run_id, "simulation" if body.run_id else "planned", body.voyage_key))
        return {"id": row.lastrowid}


@router.get("/berths")
def berths():
    return read_berths()


class BerthConfig(BaseModel):
    rate_tpd: float = Field(gt=0, le=100000, allow_inf_nan=False)
    enabled: bool = True


@router.put("/berths/{berth_id}")
def update_berth(berth_id: Literal["BD-1", "BD-2", "BD-3"], body: BerthConfig):
    with connect() as db:
        init_berths(db)
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute("SELECT * FROM supply_berths WHERE id=?", (berth_id,)).fetchone()
        if previous["rate_tpd"] != body.rate_tpd or previous["enabled"] != int(body.enabled):
            occupied = db.execute("SELECT 1 FROM supply_berth_assignments a WHERE berth_id=? AND status='reserved' AND end_at>? AND version=(SELECT max(version) FROM supply_berth_assignments WHERE vessel_id=a.vessel_id)", (berth_id, now().isoformat())).fetchone()
            occupied = occupied or db.execute("SELECT 1 FROM supply_port_visits WHERE berth_id=? AND berthed_at IS NOT NULL AND departed_at IS NULL", (berth_id,)).fetchone()
            for vessel in db.execute("SELECT * FROM supply_vessels WHERE berth_id=?", (berth_id,)):
                if db.execute("SELECT 1 FROM supply_berth_assignments WHERE vessel_id=?", (vessel["id"],)).fetchone():
                    continue
                visit = db.execute("SELECT departed_at FROM supply_port_visits WHERE vessel_id=? ORDER BY arrived_at DESC,id DESC LIMIT 1", (vessel["id"],)).fetchone()
                if visit and visit["departed_at"] and timestamp(visit["departed_at"]) <= now():
                    continue
                point = db.execute("SELECT * FROM supply_unload_points WHERE vessel_id=? ORDER BY at DESC LIMIT 1", (vessel["id"],)).fetchone()
                if point and point["cumulative"] < vessel["cargo"]:
                    from datetime import timedelta
                    end = timestamp(point["at"]) + timedelta(hours=(vessel["cargo"] - point["cumulative"]) / point["rate"]) if point["rate"] > 0 else None
                    occupied = occupied or end is None or end > now()
            if occupied:
                raise HTTPException(409, "진행·예약 중인 배정을 먼저 조정한 뒤 부두 조건을 변경하세요")
        db.execute("UPDATE supply_berths SET rate_tpd=?,enabled=? WHERE id=?", (body.rate_tpd, int(body.enabled), berth_id))
        return dict(db.execute("SELECT * FROM supply_berths WHERE id=?", (berth_id,)).fetchone())


@router.get("/berth-recommendations")
def recommend(run_id: str, start: date, vessel_id: int, horizon: int = 30):
    if horizon not in (7, 30, 60, 90):
        raise HTTPException(400, "전망 기간은 7일, 30일, 60일, 90일 중 선택하세요")
    snap = inputs(Context(run_id=run_id, start=start, horizon=horizon))
    from types import SimpleNamespace
    records = apply_assignments(snap["records"], snap["berths"])
    target = next((v for v in records["vessels"] if v["id"] == vessel_id), None)
    if target and not target.get("run_id"):
        records["vessels"] = [v for v in records["vessels"] if not v.get("run_id")]
    try:
        result = recommendations(records, snap["berths"], snap["plan"], snap["as_of"], horizon, vessel_id,
                                 snap["fuel_cv"], {u: SimpleNamespace(**v) for u, v in snap["master"].items()})
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    version = next((a["version"] for a in snap["berths"]["assignments"] if a["vessel_id"] == vessel_id), 0)
    return {"candidates": result, "version": version}


class Assignment(Context):
    vessel_id: int = Field(gt=0)
    berth_id: Literal["BD-1", "BD-2", "BD-3"]
    start_at: str
    expected_version: int = Field(ge=0)
    status: Literal["reserved", "cancelled"] = "reserved"


@router.post("/berth-assignments")
def assign(body: Assignment, request: Request):
    # 로컬 스냅샷 계산 후 쓰기 락 안에서 최신 예약을 다시 검증한다.
    snap = inputs(body)
    try:
        start = timestamp(body.start_at)
    except ValueError:
        raise HTTPException(400, "하역 시작시각을 확인하세요") from None
    with connect() as db:
        init_berths(db)
        db.execute("BEGIN IMMEDIATE")
        vessel = db.execute("SELECT * FROM supply_vessels WHERE id=?", (body.vessel_id,)).fetchone()
        if not vessel or (vessel["run_id"] and vessel["run_id"] != body.run_id):
            raise HTTPException(404, "선택한 계산의 항차가 없습니다")
        current = db.execute("SELECT * FROM supply_berth_assignments WHERE vessel_id=? ORDER BY version DESC LIMIT 1", (body.vessel_id,)).fetchone()
        version = current["version"] if current else 0
        if current and all(current[k] == v for k, v in {"berth_id": body.berth_id, "start_at": start.isoformat(), "status": body.status}.items()):
            return dict(current)
        if version != body.expected_version:
            raise HTTPException(409, "다른 사용자가 배정을 변경했습니다. 추천을 다시 조회하세요")
        if start < max(timestamp(vessel["arrival_at"]), timestamp(body.start)):
            raise HTTPException(400, "입항·조회 기준시각 이전에 하역할 수 없습니다")
        if db.execute("SELECT 1 FROM supply_unload_points WHERE vessel_id=? AND cumulative>0", (body.vessel_id,)).fetchone():
            raise HTTPException(409, "실제 누적 하역량이 등록된 항차는 배정을 변경할 수 없습니다")
        if db.execute("SELECT 1 FROM supply_port_visits WHERE vessel_id=? AND berthed_at IS NOT NULL AND departed_at IS NULL", (body.vessel_id,)).fetchone():
            raise HTTPException(409, "실제 접안 중인 항차는 배정을 변경할 수 없습니다")
        berth = db.execute("SELECT * FROM supply_berths WHERE id=?", (body.berth_id,)).fetchone()
        if not berth["enabled"]:
            raise HTTPException(409, "사용 중단 부두입니다")
        from datetime import timedelta
        end = start + timedelta(days=vessel["cargo"] / berth["rate_tpd"])
        latest = [dict(r) for r in db.execute("SELECT a.* FROM supply_berth_assignments a WHERE version=(SELECT max(version) FROM supply_berth_assignments WHERE vessel_id=a.vessel_id)")]
        state = {"berths": [dict(r) for r in db.execute("SELECT * FROM supply_berths")], "assignments": latest}
        # 최신 원장도 같은 트랜잭션에서 읽는다. 외부 연결은 쓰기 락을 잡지 않는다.
        raw = deepcopy(snap["records"])
        raw["port_visits"] = [dict(r) for r in db.execute("SELECT * FROM supply_port_visits ORDER BY arrived_at,id")]
        raw["vessels"] = []
        for row in db.execute("SELECT * FROM supply_vessels WHERE run_id=? OR run_id IS NULL", (body.run_id,)):
            if not vessel["run_id"] and row["run_id"]:
                continue
            points = [{**dict(p), "allocations": json.loads(p["allocations"])} for p in db.execute("SELECT * FROM supply_unload_points WHERE vessel_id=? ORDER BY at", (row["id"],))]
            raw["vessels"].append({**dict(row), "points": points})
        occupied = calendar(apply_assignments(raw, state), state, body.vessel_id, body.start)
        if body.status == "reserved" and any(r["berth_id"] == body.berth_id and timestamp(r["start_at"]) < end and
            (r["end_at"] is None or timestamp(r["end_at"]) > start) for r in occupied):
            raise HTTPException(409, "선택한 시간에 부두가 점유·예약되어 있습니다. 추천을 다시 조회하세요")
        actor = request.state.session["user"]["id"]
        row = db.execute("INSERT INTO supply_berth_assignments(vessel_id,version,berth_id,start_at,end_at,status,created_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
            (body.vessel_id, version + 1, body.berth_id, start.isoformat(), end.isoformat(), body.status, actor, now().isoformat()))
        return dict(db.execute("SELECT * FROM supply_berth_assignments WHERE id=?", (row.lastrowid,)).fetchone())


class Simulation(Context):
    name: str = Field(default="연료수급 비교", min_length=1, max_length=100)


@router.post("/simulations")
def save_simulation(body: Simulation, request: Request):
    snap = inputs(body)
    results = {mode: replay(snap, mode) for mode in ("assigned", "include_waiting")}
    run_id = str(uuid4())
    with connect() as db:
        init_berths(db)
        summary = {m: {"kpis": r["kpis"], "estimated_assignments": r["estimated_assignments"],
                        "warnings": r["scheduling_issues"]} for m, r in results.items()}
        db.execute("INSERT INTO supply_simulation_runs VALUES(?,?,?,?,?,?)",
            (run_id, body.name, json.dumps(snap, ensure_ascii=False), json.dumps(summary, ensure_ascii=False),
             request.state.session["user"]["id"], now().isoformat()))
        for i in range(body.horizon):
            payload = {m: result["forecast"][i] for m, result in results.items()}
            db.execute("INSERT INTO supply_simulation_daily VALUES(?,?,?)", (run_id, results["assigned"]["forecast"][i]["day"], json.dumps(payload, ensure_ascii=False)))
    return {"id": run_id, "summary": summary}


@router.get("/simulations")
def simulations():
    with connect() as db:
        init_berths(db)
        return [dict(r) for r in db.execute("SELECT id,name,created_by,recorded_at FROM supply_simulation_runs ORDER BY recorded_at DESC LIMIT 50")]


@router.get("/simulations/{run_id}")
def saved_simulation(run_id: str):
    with connect() as db:
        init_berths(db)
        row = db.execute("SELECT * FROM supply_simulation_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "저장된 시뮬레이션이 없습니다")
        return {"id": run_id, "name": row["name"], "summary": json.loads(row["summary"]),
                "daily": [{"day": r["day"], **json.loads(r["payload"])} for r in db.execute("SELECT * FROM supply_simulation_daily WHERE run_id=? ORDER BY day", (run_id,))]}
