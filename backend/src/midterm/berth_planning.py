"""부두 예약과 재고 전망. 가상 배정은 입력 원장에 쓰지 않는다."""
from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
import math
from types import SimpleNamespace

from midterm.database import DATABASE, connect
from midterm.fleet import load_coal_units
from midterm.supply import GROUPS, UNITS, DEFAULT_UNLOAD_TPD, init_supply, simulate, timestamp, unloading, now


def init_berths(db):
    init_supply(db)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS supply_berths (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE,
        rate_tpd REAL NOT NULL CHECK(rate_tpd>0), enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS supply_berth_assignments (
        id INTEGER PRIMARY KEY, vessel_id INTEGER NOT NULL REFERENCES supply_vessels(id),
        version INTEGER NOT NULL, berth_id TEXT NOT NULL REFERENCES supply_berths(id),
        start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL,
        created_by TEXT NOT NULL, recorded_at TEXT NOT NULL,
        UNIQUE(vessel_id,version));
      CREATE INDEX IF NOT EXISTS berth_assignment_vessel ON supply_berth_assignments(vessel_id,version);
      CREATE TABLE IF NOT EXISTS supply_simulation_runs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, input_snapshot TEXT NOT NULL,
        summary TEXT NOT NULL, created_by TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supply_simulation_daily (
        run_id TEXT NOT NULL REFERENCES supply_simulation_runs(id), day TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(run_id,day));
    """)
    for i, group in enumerate(GROUPS, 1):
        db.execute("INSERT OR IGNORE INTO supply_berths VALUES(?,?,?,1)",
                   (f"BD-{i}", group, DEFAULT_UNLOAD_TPD))
    db.commit()  # 스키마·기본 부두 초기화 후 호출자가 원장 트랜잭션을 시작한다.


def read_berths(path=DATABASE):
    with connect(path) as db:
        init_berths(db)
        return {"berths": [dict(r) for r in db.execute("SELECT * FROM supply_berths ORDER BY id")],
                "assignments": [dict(r) for r in db.execute("SELECT a.* FROM supply_berth_assignments a WHERE version=(SELECT max(version) FROM supply_berth_assignments WHERE vessel_id=a.vessel_id)")]}


def master_snapshot():
    return {u.name: {"installed_mw": u.installed_mw, "heat": list(u.heat)}
            for u in load_coal_units() if u.name in UNITS}


def scope_records(records, run_id):
    result = deepcopy(records)
    for key in ("baselines", "vessels"):
        result[key] = [r for r in result[key] if not r.get("run_id") or r["run_id"] == run_id]
    overrides = {v["voyage_key"] for v in result["vessels"] if run_id and v.get("run_id") == run_id and v.get("voyage_key")}
    result["vessels"] = [v for v in result["vessels"] if v.get("run_id") or v.get("voyage_key") not in overrides]
    return result


def _visits(records, vessel):
    return [p for p in records.get("port_visits", []) if p["vessel_id"] == vessel["id"]]


def _points(vessel, berth, start):
    return [{"at": timestamp(start).isoformat(), "cumulative": 0., "rate": berth["rate_tpd"] / 24,
             "allocations": {g: float(g == berth["group_id"]) for g in GROUPS}}]


def apply_assignments(records, state):
    result = deepcopy(records)
    berths = {b["id"]: b for b in state["berths"]}
    assignments = {a["vessel_id"]: a for a in state["assignments"]}
    for vessel in result["vessels"]:
        a = assignments.get(vessel["id"])
        measured = any(p["cumulative"] > 0 for p in vessel["points"])
        if a and not measured:
            vessel["assignment_version"] = a["version"]
            if a["status"] == "reserved":
                vessel["berth_id"] = a["berth_id"]
                vessel["points"] = _points(vessel, berths[a["berth_id"]], a["start_at"])
                vessel["projected_berth_at"] = a["start_at"]
            else:
                vessel["points"] = []
                vessel["berth_id"] = None
        visits = _visits(result, vessel)
        actual = next((p for p in reversed(visits) if p.get("berthed_at") and p.get("berth_id") in berths), None)
        if actual:
            vessel["berth_id"] = actual["berth_id"]
            vessel.pop("projected_berth_at", None)
            if not measured:
                vessel["points"] = _points(vessel, berths[actual["berth_id"]], actual["berthed_at"])
    return result


def calendar(records, state, exclude=None, as_of=None):
    """기존 하역 원장도 점유로 취급한다. 종료 미확정 중단선은 빈 부두가 아니다."""
    rows = []
    for v in records["vessels"]:
        if v["id"] == exclude or not v.get("berth_id") or not v["points"]:
            continue
        p = v["points"][-1]
        if p["cumulative"] >= v["cargo"]:
            end = timestamp(p["at"])
        else:
            end = timestamp(p["at"]) + timedelta(hours=(v["cargo"] - p["cumulative"]) / p["rate"]) if p["rate"] > 0 else None
        start = timestamp(v["points"][0]["at"])
        visits = _visits(records, v)
        if visits and visits[-1].get("berthed_at"):
            start = timestamp(visits[-1]["berthed_at"])
            if end and not any(p["cumulative"] > 0 for p in v["points"]):
                end = max(end, start + timedelta(hours=v["cargo"] / p["rate"])) if p["rate"] > 0 else None
        if visits and visits[-1].get("departed_at"):
            end = timestamp(visits[-1]["departed_at"])
        elif visits and visits[-1].get("berthed_at") and (p["cumulative"] >= v["cargo"] or end and end <= timestamp(as_of or now())):
            end = None  # 실제 접안이 계속되는 선박은 추정 완료시각만으로 부두를 비우지 않는다.
        rows.append({"vessel_id": v["id"], "name": v["name"], "berth_id": v["berth_id"],
                     "start_at": start.isoformat(), "end_at": end.isoformat() if end else None})
    return rows


def find_slot(eta, hours, occupied):
    start = timestamp(eta)
    for row in sorted(occupied, key=lambda r: r["start_at"]):
        left, right = timestamp(row["start_at"]), timestamp(row["end_at"]) if row["end_at"] else None
        if right and right <= start:
            continue
        if start + timedelta(hours=hours) <= left:
            break
        if right is None:
            return None
        start = max(start, right)
    return start


def recommendations(records, state, plan, as_of, horizon, vessel_id, fuel_cv=5500, master=None):
    vessel = next((v for v in records["vessels"] if v["id"] == vessel_id), None)
    if not vessel:
        raise ValueError("선택한 계산의 수급 항차가 없습니다")
    if any(p["cumulative"] > 0 for p in vessel["points"]):
        raise ValueError("실제 누적 하역량이 등록된 항차는 배정을 변경할 수 없습니다")
    as_of = timestamp(as_of)
    visits = [v for v in _visits(records, vessel) if timestamp(v["arrived_at"]) <= as_of]
    known_waiting = bool(visits and not visits[-1].get("berthed_at"))
    if not known_waiting and unloading(vessel, as_of)["cumulative"] > 0:
        raise ValueError("조회 기준시각에 이미 하역이 진행된 항차입니다")
    eta = max(as_of, timestamp(vessel["arrival_at"]))
    without = deepcopy(records)
    without["vessels"] = [v for v in records["vessels"] if v["id"] != vessel_id]
    base = simulate(without, plan, as_of, horizon, fuel_cv, master)
    occupied = calendar(records, state, vessel_id, as_of)
    rows = []
    for berth in state["berths"]:
        start = find_slot(eta, vessel["cargo"] / (berth["rate_tpd"] / 24),
                          [r for r in occupied if r["berth_id"] == berth["id"]]) if berth["enabled"] else None
        point = next((r["groups"][berth["group_id"]] for r in base["forecast"] if start and r["day"] == start.date().isoformat()), {})
        days = point.get("days")
        wait = (start - eta).total_seconds() / 3600 if start else None
        known = days is not None and math.isfinite(days)
        row = {**berth, "vessel_id": vessel_id, "start_at": start.isoformat() if start else None,
               "end_at": (start + timedelta(days=vessel["cargo"] / berth["rate_tpd"])).isoformat() if start else None,
               "wait_hours": wait, "inventory_days": days, "risk_known": known,
               "reason": "사용 중단 또는 하역 종료시각 미확정" if not start else
                   f"{'빈 부두' if wait == 0 else f'예상 대기 {wait:.1f}시간'} · {GROUPS[berth['group_id']]} · " +
                   (f"시작일말 예상 재고 {days:.1f}일" if known else "재고/발전계획 부족으로 위험도 미확정")}
        rows.append(row)
    # 빈 부두 우선 → 재고일수 낮은 처 → 대기시간. 미확정 위험을 안전으로 확정하지 않는다.
    rows.sort(key=lambda r: (r["start_at"] is None, r["wait_hours"] != 0,
                            r["wait_hours"] if r["wait_hours"] is not None else float("inf"),
                            not r["risk_known"], r["inventory_days"] if r["risk_known"] else float("inf"),
                            r["wait_hours"] if r["wait_hours"] is not None else float("inf"), r["id"]))
    return rows


def project(records, state, plan, as_of, horizon, mode="assigned", fuel_cv=5500, master=None):
    if mode not in ("assigned", "include_waiting"):
        raise ValueError("전망 옵션을 확인하세요")
    prepared = apply_assignments(records, state)
    virtual = []
    warnings = []
    if mode == "include_waiting":
        # ponytail: 항차마다 전망을 다시 계산한다. 대량 항차에서 느려지면 기준 전망을 재사용한다.
        for vessel in sorted(prepared["vessels"], key=lambda v: (v["arrival_at"], v["id"])):
            visits = [v for v in _visits(prepared, vessel) if timestamp(v["arrived_at"]) <= timestamp(as_of)]
            overdue_waiting = (visits and not visits[-1].get("berthed_at") and vessel["points"]
                and all(p["cumulative"] == 0 for p in vessel["points"])
                and timestamp(vessel["points"][0]["at"]) <= timestamp(as_of)
                and not any(a["vessel_id"] == vessel["id"] and a["status"] == "reserved" for a in state["assignments"]))
            if overdue_waiting:
                vessel["points"] = []
                vessel["berth_id"] = None
            if vessel["points"] or timestamp(vessel["arrival_at"]) >= timestamp(as_of) + timedelta(days=horizon):
                continue
            candidates = recommendations(prepared, state, plan, as_of, horizon, vessel["id"], fuel_cv, master)
            best = next((r for r in candidates if r["start_at"] and r["risk_known"]), None)
            if not best:
                warnings.append(f"{vessel['name']}: 사용 가능한 부두 또는 재고·계획자료 부족 · 가상 배정 보류")
                continue
            vessel["berth_id"] = best["id"]
            vessel["points"] = _points(vessel, best, best["start_at"])
            vessel["projected_berth_at"] = best["start_at"]
            virtual.append({"vessel_id": vessel["id"], "berth_id": best["id"], "start_at": best["start_at"],
                            "end_at": best["end_at"], "reason": best["reason"], "classification": "simulation"})
    for v in prepared["vessels"]:
        visits = _visits(prepared, v)
        if v.get("projected_berth_at") and visits and not visits[-1].get("berthed_at"):
            v["projected_berth_at"] = max(timestamp(v["projected_berth_at"]), timestamp(as_of)).isoformat()
            v["points"][0]["at"] = v["projected_berth_at"]
    result = simulate(prepared, plan, as_of, horizon, fuel_cv, master)
    def port_remaining(at):
        total = 0.
        for v in result["vessels"]:
            visits = [p for p in _visits(prepared, v) if timestamp(p["arrived_at"]) <= at]
            visit = visits[-1] if visits else None
            simulated = v.get("classification") == "simulation" and timestamp(v["arrival_at"]) <= at
            # 미래 일별 전망은 등록 ETA로 예상 입항한다. 현재 항내 확보량은 관측/가상 자료만 사용.
            forecast_arrival = at > timestamp(as_of) and timestamp(v["arrival_at"]) <= at
            if (visit or simulated or forecast_arrival) and not (visit and visit.get("departed_at") and timestamp(visit["departed_at"]) <= at):
                total += max(0., v["cargo"] - unloading(v, at)["cumulative"])
        return total
    result["kpis"]["port_remaining"] = port_remaining(timestamp(as_of))
    stock = result["kpis"]["stock"]
    result["kpis"]["stock_including_port"] = stock + result["kpis"]["port_remaining"] if stock is not None else None
    for vessel in result["vessels"]:
        visit = vessel.get("port_visit")
        vessel["berth_occupied"] = bool(visit and visit.get("berthed_at") and timestamp(visit["berthed_at"]) <= timestamp(as_of)
            and not (visit.get("departed_at") and timestamp(visit["departed_at"]) <= timestamp(as_of)))
        original = next(v for v in prepared["vessels"] if v["id"] == vessel["id"])
        if original.get("classification") == "simulation" and timestamp(original["arrival_at"]) <= timestamp(as_of):
            vessel["port_remaining"] = vessel["remaining"]
    result["kpis"]["waiting_cargo"] = sum(v["port_remaining"] for v in result["vessels"] if v["state"] == "하역대기")
    unknown_port = any(v["remaining"] > 0 and timestamp(v["arrival_at"]) <= timestamp(as_of)
                       and v.get("classification") != "simulation" and not v.get("port_visit")
                       for v in result["vessels"])
    if unknown_port:
        for key in ("port_remaining", "stock_including_port", "waiting_cargo"):
            result["kpis"][key] = None
        warnings.append("입항 예정시각이 지난 운영 화물의 입항 관측 미등록 · 현재 항내 확보량 미확정")
    for daily in result["forecast"]:
        pool = port_remaining(timestamp(daily["day"]) + timedelta(days=1))
        stocks = [g["stock"] for g in daily["groups"].values()]
        daily["port_remaining"] = pool
        daily["stock_including_port"] = sum(stocks) + pool if all(s is not None for s in stocks) else None
        for group in daily["groups"].values():
            group["shortage"] = max(0., -group["stock"]) if group["stock"] is not None else None
    result.update(inventory_mode=mode, estimated_assignments=virtual,
                  berth_schedule=calendar(prepared, state, as_of=as_of), scheduling_issues=warnings)
    return result


def replay(snapshot, mode):
    master = {u: SimpleNamespace(**v) for u, v in snapshot["master"].items()}
    return project(snapshot["records"], snapshot["berths"], snapshot["plan"], snapshot["as_of"],
                   snapshot["horizon"], mode, snapshot["fuel_cv"], master)
