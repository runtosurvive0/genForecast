"""가상 시작재고와 AIS 입항·체선 원장. AIS 좌표만으로 화물량을 만들지 않는다."""
import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from midterm.database import connect
from midterm.milp_store import stored_run
from midterm.supply import GROUPS, UNITS, init_supply, now, timestamp

router = APIRouter(prefix="/api/supply", tags=["재고·입항 원장"])


class StartingStock(BaseModel):
    run_id: str = Field(min_length=1, max_length=150)
    high_cv: float = Field(default=6000, ge=1000, le=10000, allow_inf_nan=False)
    low_cv: float = Field(default=5000, ge=1000, le=10000, allow_inf_nan=False)
    high_tonnes: dict[Literal["g14", "g58", "g910"], float]
    low_tonnes: dict[Literal["g14", "g58", "g910"], float]


@router.post("/simulation-stock")
def starting_stock(body: StartingStock):
    import math
    if body.high_cv <= body.low_cv:
        raise HTTPException(400, "고열량 기준은 저열량 기준보다 커야 합니다")
    for values in (body.high_tonnes, body.low_tonnes):
        if set(values) != set(GROUPS) or any(not math.isfinite(v) or v < 0 for v in values.values()):
            raise HTTPException(400, "세 처의 고·저열량 재고를 유한한 음수 없는 톤으로 입력하세요")
    if any(body.high_tonnes[g] + body.low_tonnes[g] <= 0 for g in GROUPS):
        raise HTTPException(400, "각 처의 합계 재고는 0보다 커야 합니다")
    run = stored_run(body.run_id)
    if not run:
        raise HTTPException(404, "DB에 완료된 MILP 계산이 없습니다")
    at = timestamp(run["summary"]["scenario"]["start"]).isoformat()
    with connect() as db:
        init_supply(db)
        db.execute("BEGIN IMMEDIATE")
        exists = db.execute("SELECT 1 FROM supply_stock_lots WHERE run_id=?", (body.run_id,)).fetchone()
        if exists:
            raise HTTPException(409, "이 계산의 시작재고가 이미 등록돼 있습니다")
        for g in GROUPS:
            high, low = body.high_tonnes[g], body.low_tonnes[g]
            cv = (high * body.high_cv + low * body.low_cv) / (high + low)
            payload = {"tonnes": high + low, "cv": cv, "moisture": None, "ash": None, "sulfur": None,
                       "run_id": body.run_id, "classification": "simulation", "is_assumption": True,
                       "source": "사용자 지정 가상 시작재고 · 성상 미측정"}
            row = db.execute("INSERT INTO supply_baselines(group_id,at,payload,recorded_at) VALUES(?,?,?,?)",
                             (g, at, json.dumps(payload, ensure_ascii=False), now().isoformat()))
            for grade, tonnes, value in (("high", high, body.high_cv), ("low", low, body.low_cv)):
                db.execute("INSERT INTO supply_stock_lots(run_id,baseline_id,group_id,grade,tonnes,cv,is_assumption) VALUES(?,?,?,?,?,?,1)",
                           (body.run_id, row.lastrowid, g, grade, tonnes, value))
    return {"run_id": body.run_id, "at": at, "total_tonnes": sum(body.high_tonnes.values()) + sum(body.low_tonnes.values()),
            "classification": "simulation"}


class PortVisit(BaseModel):
    source: Literal["aisstream", "digitraffic", "manual"]
    event_id: str = Field(min_length=1, max_length=150)
    vessel_id: int
    port_id: Literal["DANGJIN"] = "DANGJIN"
    arrived_at: str
    berthed_at: str | None = None
    departed_at: str | None = None
    berth_id: str | None = Field(default=None, max_length=50)


@router.post("/port-visits")
def port_visit(body: PortVisit):
    try:
        arrived = timestamp(body.arrived_at)
        berth = timestamp(body.berthed_at) if body.berthed_at else None
        departed = timestamp(body.departed_at) if body.departed_at else None
    except ValueError:
        raise HTTPException(400, "입항·접안·출항 시각을 확인하세요") from None
    if arrived > now() or (berth and not arrived <= berth <= now()) or (departed and not (berth or arrived) <= departed <= now()):
        raise HTTPException(400, "관측시각은 입항→접안→출항 순서의 과거 시각이어야 합니다")
    with connect() as db:
        init_supply(db)
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM supply_vessels WHERE id=?", (body.vessel_id,)).fetchone():
            raise HTTPException(404, "먼저 선박·화물량·처별 배분을 수급 원장에 등록하세요")
        existing = db.execute("SELECT * FROM supply_port_visits WHERE source=? AND event_id=?", (body.source, body.event_id)).fetchone()
        if existing and existing["vessel_id"] != body.vessel_id:
            raise HTTPException(409, "같은 AIS 이벤트를 다른 화물에 연결할 수 없습니다")
        if existing and existing["arrived_at"] != arrived.isoformat():
            raise HTTPException(409, "같은 AIS 입항 이벤트의 입항시각을 바꿀 수 없습니다")
        effective_berth = berth or (timestamp(existing["berthed_at"]) if existing and existing["berthed_at"] else None)
        if departed and effective_berth and departed < effective_berth:
            raise HTTPException(400, "출항시각은 저장된 접안시각 이후여야 합니다")
        db.execute("""INSERT INTO supply_port_visits(source,event_id,vessel_id,port_id,arrived_at,berthed_at,departed_at,berth_id,recorded_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source,event_id) DO UPDATE SET
          berthed_at=COALESCE(excluded.berthed_at,supply_port_visits.berthed_at),
          departed_at=COALESCE(excluded.departed_at,supply_port_visits.departed_at),
          berth_id=COALESCE(excluded.berth_id,supply_port_visits.berth_id),recorded_at=excluded.recorded_at""",
          (body.source, body.event_id, body.vessel_id, body.port_id, arrived.isoformat(),
           berth.isoformat() if berth else None, departed.isoformat() if departed else None, body.berth_id, now().isoformat()))
    return {"source": body.source, "event_id": body.event_id, "vessel_id": body.vessel_id}
