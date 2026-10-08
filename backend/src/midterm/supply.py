"""처별 연료수급 원장 및 전망. 시각은 KST, 구간은 [시작, 종료).

입고·이탄·기준재고 변경을 시각순으로 반영하고 최대 한 시간 간격으로 연소한다.
없거나 일부만 있는 발전계획을 0으로 취급하지 않는다.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from midterm.database import DATABASE, connect, _put
from midterm.fleet import load_coal_units

KST = ZoneInfo("Asia/Seoul")
GROUPS = {"g14": "1~4호기 처", "g58": "5~8호기 처", "g910": "9~10호기 처"}
UNITS = {f"당진{i}": "g14" if i <= 4 else "g58" if i <= 8 else "g910" for i in range(1, 11)}
DEFAULTS = {"danger_days": 7., "normal_days": 15., "baseline_stale_hours": 72.,
            "plan_stale_hours": 48., "heat_method": "curve", "heat_rates": {}}


def timestamp(value) -> datetime:
    at = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if not isinstance(value, datetime) else value
    return at.replace(tzinfo=KST) if at.tzinfo is None else at.astimezone(KST)


def now() -> datetime:
    return datetime.now(KST)


def init_supply(db):
    db.executescript("""
      CREATE TABLE IF NOT EXISTS supply_baselines (
        id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, at TEXT NOT NULL,
        payload TEXT NOT NULL, recorded_at TEXT NOT NULL, UNIQUE(group_id,at));
      CREATE TABLE IF NOT EXISTS supply_vessels (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, cargo REAL NOT NULL,
        incoming_cv REAL NOT NULL, arrival_at TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supply_unload_points (
        id INTEGER PRIMARY KEY, vessel_id INTEGER NOT NULL REFERENCES supply_vessels(id),
        at TEXT NOT NULL, cumulative REAL NOT NULL, rate REAL NOT NULL,
        allocations TEXT NOT NULL, recorded_at TEXT NOT NULL, UNIQUE(vessel_id,at));
      CREATE TABLE IF NOT EXISTS supply_transfers (
        id INTEGER PRIMARY KEY, at TEXT NOT NULL, from_group TEXT NOT NULL,
        to_group TEXT NOT NULL, tonnes REAL NOT NULL, note TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supply_plan_batches (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, source_name TEXT NOT NULL,
        as_of TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supply_plan_hours (
        batch_id INTEGER NOT NULL REFERENCES supply_plan_batches(id), at TEXT NOT NULL,
        unit TEXT NOT NULL, mw REAL NOT NULL, online INTEGER NOT NULL,
        PRIMARY KEY(batch_id,at,unit));
      CREATE TABLE IF NOT EXISTS supply_forecasts (
        id INTEGER PRIMARY KEY, as_of TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS supply_schedule_changes (
        id INTEGER PRIMARY KEY, vessel_id INTEGER NOT NULL REFERENCES supply_vessels(id),
        old_schedule TEXT NOT NULL, new_schedule TEXT NOT NULL, recorded_at TEXT NOT NULL);
    """)


def read_supply(path=DATABASE) -> dict:
    with connect(path) as db:
        init_supply(db)
        config_row = db.execute("SELECT value FROM settings WHERE key='supply'").fetchone()
        config = {**DEFAULTS, **(json.loads(config_row[0]) if config_row else {})}
        baselines = [{**dict(r), **json.loads(r["payload"])} for r in db.execute(
            "SELECT * FROM supply_baselines ORDER BY at,id")]
        vessels = []
        for row in db.execute("SELECT * FROM supply_vessels ORDER BY arrival_at,id"):
            points = [{**dict(r), "allocations": json.loads(r["allocations"])} for r in db.execute(
                "SELECT * FROM supply_unload_points WHERE vessel_id=? ORDER BY at,id", (row["id"],))]
            vessels.append({**dict(row), "points": points})
        transfers = [dict(r) for r in db.execute("SELECT * FROM supply_transfers ORDER BY at,id")]
        changes = [dict(r) for r in db.execute("SELECT * FROM supply_schedule_changes ORDER BY id")]
        return {"config": config, "baselines": baselines, "vessels": vessels, "transfers": transfers,
                "schedule_changes": changes}


def unloading(vessel, at) -> dict:
    """누적량 보정은 해당 시각에 반영. 배분 변경은 변경시각 이후에만 적용."""
    at = timestamp(at)
    points = vessel["points"]
    allocated = dict.fromkeys(GROUPS, 0.)
    if not points or at < timestamp(points[0]["at"]):
        return {"cumulative": 0., "allocated": allocated}
    for i, p in enumerate(points):
        start = timestamp(p["at"])
        if at < start:
            break
        stop = timestamp(points[i + 1]["at"]) if i + 1 < len(points) else at
        end = min(at, stop)
        projected = min(vessel["cargo"], p["cumulative"] + p["rate"] * (end - start).total_seconds() / 3600)
        quantity = projected - p["cumulative"]
        if i + 1 < len(points) and at >= stop:
            # 이전 배분으로 인식한 입고를 유지; 수기 누적량 보정 차이는 보정시각에 반영.
            quantity = points[i + 1]["cumulative"] - p["cumulative"]
        for group, ratio in p["allocations"].items():
            allocated[group] += quantity * ratio
        if end == at and (i + 1 == len(points) or at < stop):
            break
    return {"cumulative": sum(allocated.values()), "allocated": allocated}


def heat_gcal(unit, mw, online, config, master) -> float:
    if not online:
        return 0.
    hr = config["heat_rates"].get(unit)
    if hr is not None:
        return mw * hr / 1000
    u = master[unit]
    if config["heat_method"] == "heat_rate":
        # 표준 실측 HR 미확보: 기존 곡선의 정격출력 환산치를 임시 기본값으로 사용.
        peers = [x for n, x in master.items() if UNITS[n] == UNITS[unit]]
        rate = sum((x.heat[0] * x.installed_mw ** 2 + x.heat[1] * x.installed_mw + x.heat[2])
                   * 1000 / x.installed_mw for x in peers) / len(peers)
        return mw * rate / 1000
    a2, a1, a0 = u.heat
    return max(0., a2 * mw ** 2 + a1 * mw + a0)


def simulate(records, plan, as_of, horizon, fallback_cv=5500, master=None) -> dict:
    as_of = timestamp(as_of)
    midnight = as_of.replace(hour=0, minute=0, second=0, microsecond=0)
    end = midnight + timedelta(days=horizon + 7)
    config = records["config"]
    master = master or {u.name: u for u in load_coal_units() if u.is_dangjin}
    anchors = {g: max((b for b in records["baselines"] if b["group_id"] == g and timestamp(b["at"]) <= as_of),
                      key=lambda b: timestamp(b["at"]), default=None) for g in GROUPS}
    history = [b for b in records["baselines"] if timestamp(b["at"]) <= as_of]
    begin = min([midnight] + [timestamp(b["at"]) for b in history])
    times = {begin, as_of, end}
    hour = begin.replace(minute=0, second=0, microsecond=0)
    while hour < end:
        if hour >= begin:
            times.add(hour)
        hour += timedelta(hours=1)
    times.update(timestamp(b["at"]) for b in history)
    for vessel in records["vessels"]:
        for point in vessel["points"]:
            at = timestamp(point["at"])
            if begin <= at < end:
                times.add(at)
            if point["rate"] > 0:
                finish = at + timedelta(hours=(vessel["cargo"] - point["cumulative"]) / point["rate"])
                if begin < finish < end:
                    times.add(finish)
    transfers = defaultdict(list)
    for tr in records["transfers"]:
        at = timestamp(tr["at"])
        if begin <= at < end:
            transfers[at].append(tr)
            times.add(at)
    state = {g: {"stock": 0., "cv": fallback_cv, "known": False} for g in GROUPS}
    active_anchors = dict.fromkeys(GROUPS)
    baseline_events = defaultdict(list)
    for b in history:
        baseline_events[timestamp(b["at"])].append(b)
    current, stock_days = {}, {}
    unit_daily = defaultdict(lambda: {u: {"mwh": 0., "tonnes": 0., "hours": 0., "online_hours": 0.} for u in UNITS})
    daily_coverage = defaultdict(lambda: dict.fromkeys(GROUPS, True))
    transfer_issues = []
    ordered = sorted(times)
    for t, nxt in zip(ordered, ordered[1:]):
        for b in baseline_events[t]:
            g = b["group_id"]
            state[g] = {"stock": b["tonnes"], "cv": b["cv"], "known": True}
            active_anchors[g] = b
        for tr in transfers[t]:
            src, dst = state[tr["from_group"]], state[tr["to_group"]]
            src_anchor, dst_anchor = active_anchors[tr["from_group"]], active_anchors[tr["to_group"]]
            use_src = src_anchor and t >= timestamp(src_anchor["at"])
            use_dst = dst_anchor and t >= timestamp(dst_anchor["at"])
            # 출발 처를 새 기준재고로 덮은 경우에도 과거 열량을 임의로 추정하지 않는다.
            if use_dst and (not use_src or not src["known"]):
                dst["known"] = False
                transfer_issues.append(f"{tr['id']}: 출발 처의 이탄시각 열량 확인 필요")
            elif use_dst:
                q = tr["tonnes"]
                dst["cv"] = (max(dst["stock"], 0) * dst["cv"] + q * src["cv"]) / (max(dst["stock"], 0) + q)
                dst["stock"] += q
            if use_src:
                if src["stock"] < tr["tonnes"]:
                    transfer_issues.append(f"{tr['id']}: 이탄량이 출발 처 추정재고보다 큼")
                    src["known"] = False
                    if use_dst:
                        dst["known"] = False
                src["stock"] -= tr["tonnes"]
        if t == as_of:
            current = {g: dict(v) for g, v in state.items()}
        dt = (nxt - t).total_seconds() / 3600
        day = t.date().isoformat()
        # 구간 입고 후 구간 연소. 시각 경계에서 분할하므로 기준재고/보정을 중복하지 않는다.
        for v in records["vessels"]:
            before, after = unloading(v, t)["allocated"], unloading(v, nxt)["allocated"]
            for g, st in state.items():
                q = after[g] - before[g]
                b = active_anchors[g]
                if q and b and t >= timestamp(b["at"]):
                    if q > 0:
                        weight = max(st["stock"], 0)
                        st["cv"] = (weight * st["cv"] + q * v["incoming_cv"]) / (weight + q)
                    elif st["stock"] + q > 0:
                        st["cv"] = (st["stock"] * st["cv"] + q * v["incoming_cv"]) / (st["stock"] + q)
                    else:
                        st["known"] = False
                    st["stock"] += q
        at_hour = t.replace(minute=0, second=0, microsecond=0).isoformat()
        rows = plan.get(at_hour, {})
        for u, g in UNITS.items():
            st, row = state[g], rows.get(u)
            if row is None or not st["cv"] or st["cv"] <= 0:
                if active_anchors[g]:
                    st["known"] = False
                daily_coverage[day][g] = False
                continue
            burn = heat_gcal(u, row["mw"], row["online"], config, master) * 1000 / st["cv"] * dt
            totals = unit_daily[day][u]
            totals["mwh"] += row["mw"] * dt
            totals["tonnes"] += burn
            totals["hours"] += dt
            totals["online_hours"] += row["online"] * dt
            if active_anchors[g]:
                st["stock"] -= burn
        if nxt.hour == 0 and nxt.minute == 0 and nxt.second == 0:
            stock_days[day] = {g: dict(v) for g, v in state.items()}

    def daily_burn(day, g):
        totals = unit_daily[day]
        names = [u for u in UNITS if UNITS[u] == g]
        return sum(totals[u]["tonnes"] for u in names) if (daily_coverage[day][g] and
            all(abs(totals[u]["hours"] - 24) < 1e-6 for u in names)) else None

    def days_of_stock(stock, first, g):
        burns = [daily_burn((first + timedelta(days=k)).date().isoformat(), g) for k in range(7)]
        if not stock["known"] or any(x is None for x in burns):
            return None
        avg = sum(burns) / 7
        # 정지 등으로 7일간 연소가 0이면 무한대 대신 별도 휴지 상태.
        return stock["stock"] / avg if avg > 0 else None

    forecast = []
    for i in range(horizon):
        d = midnight + timedelta(days=i)
        day = d.date().isoformat()
        point = {"day": day, "groups": {}}
        for g in GROUPS:
            st = stock_days.get(day, {}).get(g, {"stock": 0, "cv": None, "known": False})
            point["groups"][g] = {"stock": st["stock"] if st["known"] else None,
                "days": days_of_stock(st, d + timedelta(days=1), g), "cv": st["cv"], "burn": daily_burn(day, g)}
        forecast.append(point)
    groups = []
    for g, label in GROUPS.items():
        st = current.get(g, state[g])
        values = [x["groups"][g]["days"] for x in forecast]
        full = all(x is not None for x in values)
        minimum = min(values) if full else None
        b = anchors[g]
        stale = bool(b and (as_of - timestamp(b["at"])).total_seconds() / 3600 > config["baseline_stale_hours"])
        risk = "unknown" if minimum is None or stale else "danger" if minimum < config["danger_days"] else "caution" if minimum < config["normal_days"] else "normal"
        first_risk = next((x["day"] for x in forecast if x["groups"][g]["days"] is not None and
                           x["groups"][g]["days"] < config["normal_days"]), None)
        stocks = [x["groups"][g]["stock"] for x in forecast]
        today = daily_burn(midnight.date().isoformat(), g)
        groups.append({"id": g, "name": label, "stock": st["stock"] if st["known"] else None,
            "cv": st["cv"] if b else None, "baseline": b,
            "delta": st["stock"] - b["tonnes"] if st["known"] and b else None,
            "days": days_of_stock(st, midnight + timedelta(days=1), g), "min_days": minimum,
            "min_stock": min(stocks) if all(x is not None for x in stocks) else None,
            "risk": risk, "stale": stale, "first_risk": first_risk, "today_burn": today,
            "received": sum(unloading(v, as_of)["allocated"][g] - unloading(v, timestamp(b["at"]))["allocated"][g]
                            for v in records["vessels"]) if b else None,
            "expected_receipts": sum(unloading(v, midnight + timedelta(days=horizon))["allocated"][g] - unloading(v, as_of)["allocated"][g]
                                     for v in records["vessels"])})
    known = all(g["stock"] is not None for g in groups)
    status = "danger" if any(g["risk"] == "danger" for g in groups) else "unknown" if any(g["risk"] == "unknown" for g in groups) else "caution" if any(g["risk"] == "caution" for g in groups) else "normal"
    vessels = [{**v, **unloading(v, as_of), "remaining": v["cargo"] - unloading(v, as_of)["cumulative"]} for v in records["vessels"]]
    incoming = [v for v in vessels if as_of <= timestamp(v["arrival_at"]) < midnight + timedelta(days=horizon)]
    for v in vessels:
        latest = next((p for p in reversed(v["points"]) if timestamp(p["at"]) <= as_of), None)
        v["state"] = "입항예정" if timestamp(v["arrival_at"]) > as_of else "하역대기" if latest is None else "완료" if v["remaining"] <= 0 else "하역중" if latest["rate"] > 0 else "하역중단"
    active = [v for v in vessels if v["state"] == "하역중"]
    amounts = [g["today_burn"] for g in groups]
    unit_summary = []
    for u, g in UNITS.items():
        rows = [unit_daily[(midnight + timedelta(days=i)).date().isoformat()][u] for i in range(horizon)]
        complete = all(abs(r["hours"] - 24) < 1e-6 for r in rows)
        unit_summary.append({"unit": u, "group": g,
            "cf_pct": sum(r["mwh"] for r in rows) / (master[u].installed_mw * 24 * horizon) * 100 if complete else None,
            "tonnes": sum(r["tonnes"] for r in rows) if complete else None,
            "mw": sum(r["mwh"] for r in rows) / (24 * horizon) if complete else None,
            "online_hours": sum(r["online_hours"] for r in rows) if complete else None})
    stock_total = sum(g["stock"] for g in groups) if known else None
    current_days = [g["days"] for g in groups]
    return {"as_of": as_of.isoformat(), "horizon": horizon, "groups": groups, "forecast": forecast,
        "units": unit_summary, "vessels": vessels, "transfer_issues": transfer_issues,
        "kpis": {"risk": status, "stock": stock_total,
            "days": min(current_days) if all(x is not None for x in current_days) else None,
            "min_days": min(g["min_days"] for g in groups) if all(g["min_days"] is not None for g in groups) else None,
            "unloading_cargo": sum(v["cargo"] for v in active), "unloading": sum(v["cumulative"] for v in active),
            "unloading_remaining": sum(v["remaining"] for v in active), "active_vessels": len(active),
            "arrival_count": len(incoming), "arrivals": sum(v["cargo"] for v in incoming),
            "incoming_cv": sum(v["cargo"] * v["incoming_cv"] for v in incoming) / sum(v["cargo"] for v in incoming) if incoming else None,
            "today_burn": sum(amounts) if all(x is not None for x in amounts) else None,
            "period_burn": sum(u["tonnes"] for u in unit_summary) if all(u["tonnes"] is not None for u in unit_summary) else None}}
