"""LLM 운영 질의 도우미의 읽기 전용 도구와 결과 봉투.

모든 도구는 {"ok": True, "as_of", "source", "data"} 또는 {"ok": False, "error"}만 돌려준다.
쓰기 도구는 없다. 도구 결과의 자유 서술 필드(notes 등)는 데이터이며 지시가 아니다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from midterm.supply import KST, timestamp
from midterm.voyage_registry import STATUSES, snapshot
from midterm.vessels.waiting import waiting_candidates

MAX_VOYAGES = 50
DAY_PATTERN = r"^\d{4}-\d{2}-\d{2}$"


@dataclass
class ToolContext:
    request: Any  # fastapi.Request | None
    now: datetime
    db_path: Path


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict
    run: Callable[[dict, ToolContext], dict]


# ---------------------------------------------------------------- 인자 검사
_TYPES = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
}


def _check(value, schema: dict, path: str) -> str | None:
    types = schema.get("type")
    if types is not None:
        names = types if isinstance(types, list) else [types]
        if not any(_TYPES[t](value) for t in names):
            return f"{path} 형식이 올바르지 않습니다"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path} 값이 허용 목록에 없습니다"
    if isinstance(value, str) and "pattern" in schema and not re.search(schema["pattern"], value):
        return f"{path} 형식이 올바르지 않습니다"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            return f"{path} 값이 너무 작습니다"
        if "maximum" in schema and value > schema["maximum"]:
            return f"{path} 값이 너무 큽니다"
    return None


def validate_args(args, schema: dict) -> str | None:
    """JSON Schema 일부(type·enum·pattern·minimum·maximum·required)만 검사한다. 오류 문구 또는 None."""
    if not isinstance(args, dict):
        return "인자는 객체여야 합니다"
    for key in schema.get("required", []):
        if key not in args:
            return f"필수 인자가 없습니다: {key}"
    for key, sub in schema.get("properties", {}).items():
        if key in args:
            problem = _check(args[key], sub, key)
            if problem:
                return problem
    return None


# ---------------------------------------------------------------- 공통
def _ok(as_of, source: str, data: dict) -> dict:
    return {"ok": True, "as_of": as_of, "source": source, "data": data}


def _fail(message: str) -> dict:
    return {"ok": False, "error": message}


def _parse_day(day: str) -> datetime:
    return datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=KST)


# ---------------------------------------------------------------- list_voyages
def _is_dangjin(voyage: dict, plants: dict[str, set]) -> bool:
    port = (voyage.get("destination_port") or "").lower()
    return "당진" in port or "dangjin" in port or "dangjin" in plants.get(voyage["voyage_no"], set())


def _list_voyages(args: dict, ctx: ToolContext) -> dict:
    try:
        book = snapshot(ctx.db_path)
        ships = {s["ship_code"]: s.get("name") for s in book["ships"]}
        plants: dict[str, set] = {}
        for c in book["cargo"]:
            plants.setdefault(c["voyage_no"], set()).add(c.get("destination_plant_id"))
        status, first, last = args.get("status"), args.get("from_day"), args.get("to_day")
        rows = []
        for v in book["voyages"]:
            if v.get("classification") == "simulation" or not _is_dangjin(v, plants):
                continue
            if status and v.get("status") != status:
                continue
            day = (v.get("planned_arrival") or "")[:10]
            if (first or last) and not day:
                continue
            if (first and day < first) or (last and day > last):
                continue
            rows.append(v)
        rows.sort(key=lambda v: (not v.get("planned_arrival"), v.get("planned_arrival") or "", v["voyage_no"]))
        voyages = [{
            "voyage_no": v["voyage_no"], "ship": ships.get(v.get("ship_code")), "status": v.get("status"),
            "planned_arrival": v.get("planned_arrival"), "actual_arrival": v.get("actual_arrival"),
            "actual_berth": v.get("actual_berth"), "planned_unload_end": v.get("planned_unload_end"),
            "berth_id": v.get("berth_id"), "notes": v.get("notes"),
        } for v in rows[:MAX_VOYAGES]]
        data = {"voyages": voyages, "count": len(rows)}
        if len(rows) > MAX_VOYAGES:
            data["truncated"] = True
        return _ok(ctx.now.isoformat(), "actual", data)
    except Exception as exc:
        return _fail(f"항차 원장 조회 실패: {exc}")


# ---------------------------------------------------------------- waiting_vessels
def _waiting_vessels(args: dict, ctx: ToolContext) -> dict:
    try:
        from midterm.web import vessels_api
        if vessels_api.waiting is None:
            return _fail("대기 선박 수집이 꺼져 있습니다")
        epoch = ctx.now.timestamp()
        points, heads = vessels_api.waiting.snapshot(epoch)
        found = waiting_candidates(points, heads, epoch, set())
        candidates = [{
            "mmsi": c["mmsi"], "name": c["name"], "distance_km": c["distanceKm"], "dwell_hours": c["dwellHours"],
        } for c in found]
        return _ok(ctx.now.isoformat(), "actual", {"candidates": candidates, "count": len(candidates)})
    except Exception as exc:
        return _fail(f"대기 선박 조회 실패: {exc}")


# ---------------------------------------------------------------- stock_snapshot / plan_for_day
STOCK_BASIS = "기준재고+하역배분-계획연소 추정"


def _plan_flags(result: dict) -> dict:
    """전망 결과의 경고(issues)·계획 갱신 경과·동작 확인용 계획 여부. 값이 없어도 기본값으로 넣는다."""
    return {
        "issues": list(result.get("issues") or []),
        "plan_stale": bool(result.get("plan_stale")),
        "demo_plan": (result.get("plan_source") or {}).get("classification") == "functional_demo",
    }


def _stock_snapshot(args: dict, ctx: ToolContext) -> dict:
    try:
        from midterm.web.supply_api import build_dashboard
        at = timestamp(args["at"]) if args.get("at") else None
        result = build_dashboard(7, at, None)
        groups = [{
            "id": g["id"], "name": g["name"], "stock_t": g["stock"], "cv": g["cv"], "days": g["days"],
            "risk": g["risk"], "baseline_at": (g.get("baseline") or {}).get("at"), "stale": g["stale"],
        } for g in result["groups"]]
        stamps = [g["baseline_at"] for g in groups if g["baseline_at"]]
        baseline_at = max(stamps, key=timestamp) if stamps else None
        # 실측이 아니라 기준재고 + 하역배분 - 계획 연소로 계산한 추정 재고라 출처는 plan이다.
        data = {"groups": groups, "basis": STOCK_BASIS, "baseline_at": baseline_at, **_plan_flags(result)}
        return _ok(result["as_of"], "plan", data)
    except Exception as exc:
        return _fail(f"재고 계산 실패: {exc}")


NO_PLAN = "그날의 발전계획이 등록되지 않았습니다"


def _plan_for_day(args: dict, ctx: ToolContext) -> dict:
    try:
        from midterm.web.supply_api import build_dashboard
        day = args["day"]
        start = _parse_day(day)
        result = build_dashboard(7, start, None)
        source = result.get("plan_source")
        daily = next((d for d in result["fuel_calendar"]["daily"] if d["day"] == day), None)
        if not source or daily is None:
            return _fail(NO_PLAN)
        point = next((p for p in result["forecast"] if p["day"] == day), None)
        burn = {g: v["burn"] for g, v in point["groups"].items()} if point else {}
        data = {"day": day, "unit_tonnes": daily["unit_tonnes"], "group_burn": burn,
                "plan_source_name": source.get("source_name"), **_plan_flags(result)}
        return _ok(result["as_of"], "plan", data)
    except Exception as exc:
        return _fail(f"발전계획 조회 실패: {exc}")


# ---------------------------------------------------------------- simulate_scenario
def _group_view(g: dict) -> dict:
    return {"id": g["id"], "name": g["name"], "stock_t": g["stock"], "days": g["days"],
            "min_days": g["min_days"], "min_stock_t": g["min_stock"], "risk": g["risk"]}


def _view(result: dict) -> dict:
    return {"groups": [_group_view(g) for g in result["groups"]], "kpis": result["kpis"]}


def _delta(after, before):
    return None if after is None or before is None else after - before


def _voyage_ships(ctx: ToolContext) -> dict[str, dict]:
    """voyage_no -> 선박 식별(name·mmsi·imo). 모의 항차는 제외한다."""
    book = snapshot(ctx.db_path)
    ships = {s["ship_code"]: {"name": s.get("name"), "mmsi": s.get("mmsi"), "imo": s.get("imo")} for s in book["ships"]}
    return {v["voyage_no"]: ships.get(v.get("ship_code")) or {}
            for v in book["voyages"] if v.get("classification") != "simulation"}


def _simulate_scenario(args: dict, ctx: ToolContext) -> dict:
    from midterm.assistant.scenario import ScenarioError, apply_changes
    try:
        from midterm.web.supply_api import build_dashboard
        voyages = _voyage_ships(ctx) if any(
            isinstance(c, dict) and c.get("kind") == "delay" and c.get("voyageNo") for c in args["changes"]) else {}
        adjust, unsupported = apply_changes(args["changes"], ctx.now, voyages)
        horizon = args["horizon_days"]
        base = build_dashboard(horizon, ctx.now, None)
        scenario = build_dashboard(horizon, ctx.now, None, adjust)
        baseline, changed = _view(base), _view(scenario)
        before = {g["id"]: g for g in baseline["groups"]}
        diff = {g["id"]: {"min_days": _delta(g["min_days"], before[g["id"]]["min_days"]),
                          "min_stock_t": _delta(g["min_stock_t"], before[g["id"]]["min_stock_t"])}
                for g in changed["groups"]}
        data = {"baseline": baseline, "scenario": changed, "diff": diff, "unsupported": unsupported,
                **_plan_flags(scenario)}
        return _ok(scenario["as_of"], "simulation", data)
    except ScenarioError as exc:
        return _fail(str(exc))
    except Exception as exc:
        return _fail(f"가정 계산 실패: {exc}")


# ---------------------------------------------------------------- 등록
_DAY = {"type": ["string", "null"], "pattern": DAY_PATTERN}

TOOLS: dict[str, ToolSpec] = {t.name: t for t in [
    ToolSpec("list_voyages", "당진행 항차 목록(예정·항해·완료)을 계획 입항 순으로 조회한다. 모의 항차는 제외한다.", {
        "type": "object",
        "properties": {
            "status": {"type": ["string", "null"], "enum": [*STATUSES, None]},
            "from_day": {**_DAY, "description": "계획 입항일 시작(YYYY-MM-DD)"},
            "to_day": {**_DAY, "description": "계획 입항일 끝(YYYY-MM-DD)"},
        }, "required": []}, _list_voyages),
    ToolSpec("waiting_vessels", "당진항 부두 밖에서 대기 중인 것으로 추정되는 선박 후보를 조회한다.", {
        "type": "object", "properties": {}, "required": []}, _waiting_vessels),
    ToolSpec("stock_snapshot", "저탄장 그룹별 재고(t)·열량·재고일수·위험도를 조회한다. at이 없으면 현재 시각.", {
        "type": "object",
        "properties": {"at": {"type": ["string", "null"], "description": "기준 시각(ISO 8601, 없으면 KST)"}},
        "required": []}, _stock_snapshot),
    ToolSpec("plan_for_day", "특정 날짜의 발전계획 호기별 연료 사용량(t)과 그룹별 소진량을 조회한다.", {
        "type": "object",
        "properties": {"day": {"type": "string", "pattern": DAY_PATTERN, "description": "날짜(YYYY-MM-DD, KST)"}},
        "required": ["day"]}, _plan_for_day),
    ToolSpec("simulate_scenario", "도착 지연(delay)·부하 증감(load) 가정을 적용한 재고 전망을 현재 전망과 비교한다. "
             "정지(outage)·상탄 전략(strategy)은 계산하지 않고 unsupported로 알린다.", {
        "type": "object",
        "properties": {
            "changes": {"type": "array", "description": "조건 목록. delay: {kind,voyageNo|vesselName|vesselId,"
                        "days(-10~30)} (지연 대상은 list_voyages의 voyage_no를 voyageNo로, 또는 선명을 vesselName으로 "
                        "지정한다. 선명은 대소문자 무시 정확 일치), "
                        "load: {kind,fromDay,toDay,pct(-60~60)}, outage/strategy는 미지원"},
            "horizon_days": {"type": "integer", "enum": [7, 30, 60, 90]},
        }, "required": ["changes", "horizon_days"]}, _simulate_scenario),
]}


def tool_schemas() -> list[dict]:
    return [{"name": t.name, "description": t.description, "parameters": t.parameters} for t in TOOLS.values()]


def run_tool(name: str, args: dict, ctx: ToolContext) -> dict:
    spec = TOOLS.get(name)
    if spec is None:
        return _fail(f"알 수 없는 도구: {name}")
    problem = validate_args(args, spec.parameters)
    if problem:
        return _fail(f"인자 오류: {problem}")
    try:
        result = spec.run(args, ctx)
    except Exception as exc:  # 도구는 스스로 접두어를 붙이지만, 마지막 방어선
        return _fail(f"도구 실행 실패: {exc}")
    return result if isinstance(result, dict) and "ok" in result else _fail("도구 결과 형식이 올바르지 않습니다")
