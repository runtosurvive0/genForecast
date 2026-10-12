"""업로드 입력과 실행 결과를 보존하는 로컬 DB. 실행 입력은 덮어쓰지 않는다."""
from __future__ import annotations

import hashlib
import io
import json
import math
from datetime import datetime, timezone

from midterm.database import DATABASE, connect, _clean_fuel
from midterm.fleet import load_coal_units, load_nuclear_units
from midterm.outages import validate_units
from midterm.scenario import QUALITY, Scenario


def init_store(db):
    db.executescript("""
      CREATE TABLE IF NOT EXISTS milp_inputs (
        id INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        payload TEXT NOT NULL, recorded_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS milp_runs (
        run_id TEXT PRIMARY KEY, input_id INTEGER NOT NULL REFERENCES milp_inputs(id),
        state TEXT NOT NULL, summary TEXT, hourly BLOB, error TEXT,
        started_at TEXT NOT NULL, finished_at TEXT);
    """)


def clean_input(scenario_data, prices, fuel, files=None):
    scenario = Scenario.from_json(scenario_data)
    if not isinstance(scenario.name, str) or not 1 <= len(scenario.name.strip()) <= 100:
        raise ValueError("시나리오 이름은 1~100자 문자열로 입력하세요")
    if not 6 <= (scenario.end - scenario.start).days <= 731:
        raise ValueError("대시보드 계산 기간은 7일 이상, 최대 2년으로 입력하세요")
    if scenario.quality not in QUALITY or (scenario.workers is not None and
            (not isinstance(scenario.workers, int) or not 1 <= scenario.workers <= 32)):
        raise ValueError("풀이 품질 또는 작업자 수(1~32)를 확인하세요")
    numbers = [scenario.reserve_ratio, *scenario.coal_adjust_pct,
               *[v for v in (scenario.demand_growth_pct, scenario.solar_growth_pct) if v is not None]]
    if len(scenario.coal_adjust_pct) != 12 or any(not math.isfinite(float(v)) for v in numbers):
        raise ValueError("월별 보정은 유한한 숫자 12개로 입력하세요")
    if not 0 <= scenario.reserve_ratio <= 1 or any(v < -100 or v > 300 for v in scenario.coal_adjust_pct):
        raise ValueError("운전예비율은 0~1, 월별 보정은 -100~300%로 입력하세요")
    if any(v is not None and not -100 <= v <= 300 for v in (scenario.demand_growth_pct, scenario.solar_growth_pct)):
        raise ValueError("수요·태양광 증가율은 -100~300%로 입력하세요")
    for kind, units in (("coal", load_coal_units()), ("nuclear", load_nuclear_units())):
        unknown = validate_units(getattr(scenario, kind + "_oh"), [u.name for u in units], kind)
        if unknown:
            raise ValueError("미등록 호기: " + ", ".join(unknown))
    required = {u.name for u in load_coal_units()}
    if not required.issubset(prices):
        raise ValueError("열량단가 누락 호기: " + ", ".join(sorted(required - set(prices))))
    for unit, values in prices.items():
        if len(values) != 12 or any(not math.isfinite(float(v)) or float(v) <= 0 for v in values):
            raise ValueError(f"{unit}: 1~12월 열량단가는 양수 12개(원/Gcal)가 필요합니다")
    return {"scenario": scenario.to_json(), "heat_prices": prices, "fuel": _clean_fuel(fuel),
            "files": files or [], "classification": "scenario_forecast"}


def save_input(payload, path=DATABASE):
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with connect(path) as db:
        init_store(db)
        db.execute("INSERT OR IGNORE INTO milp_inputs(digest,name,payload,recorded_at) VALUES(?,?,?,?)",
                   (digest, payload["scenario"]["name"], encoded, datetime.now(timezone.utc).isoformat()))
        row = db.execute("SELECT id FROM milp_inputs WHERE digest=?", (digest,)).fetchone()
    return get_input(row[0], path)


def get_input(input_id, path=DATABASE):
    with connect(path) as db:
        init_store(db)
        row = db.execute("SELECT * FROM milp_inputs WHERE id=?", (input_id,)).fetchone()
        if row is None:
            raise ValueError("저장된 입력 세트가 없습니다")
        return {**dict(row), "payload": json.loads(row["payload"])}


def list_inputs(path=DATABASE):
    with connect(path) as db:
        init_store(db)
        return [{"id": r["id"], "name": r["name"], "recorded_at": r["recorded_at"],
                 "start": json.loads(r["payload"])["scenario"]["start"],
                 "end": json.loads(r["payload"])["scenario"]["end"]}
                for r in db.execute("SELECT * FROM milp_inputs ORDER BY id DESC")]


def begin_run(run_id, input_id, path=DATABASE):
    with connect(path) as db:
        init_store(db)
        db.execute("INSERT INTO milp_runs(run_id,input_id,state,started_at) VALUES(?,?,'running',?)",
                   (run_id, input_id, datetime.now(timezone.utc).isoformat()))


def finish_run(run_id, summary=None, hourly=None, error=None, path=DATABASE):
    with connect(path) as db:
        init_store(db)
        db.execute("UPDATE milp_runs SET state=?,summary=?,hourly=?,error=?,finished_at=? WHERE run_id=?",
                   ("error" if error else "done", json.dumps(summary, ensure_ascii=False) if summary else None,
                    hourly, error, datetime.now(timezone.utc).isoformat(), run_id))


def stored_run(run_id, path=DATABASE):
    with connect(path) as db:
        init_store(db)
        row = db.execute("SELECT * FROM milp_runs WHERE run_id=? AND state='done'", (run_id,)).fetchone()
        if row:
            return {**dict(row), "summary": json.loads(row["summary"])}
    return None


def stored_runs(path=DATABASE):
    with connect(path) as db:
        init_store(db)
        return [{"id": r["run_id"], "input_id": r["input_id"], "state": r["state"],
                 "started_at": r["started_at"], "finished_at": r["finished_at"], "error": r["error"],
                 "summary": json.loads(r["summary"]) if r["summary"] else None}
                for r in db.execute("SELECT run_id,input_id,state,started_at,finished_at,error,summary FROM milp_runs ORDER BY started_at DESC")]


def table_rows(raw, filename):
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("파일당 최대 4MB까지 업로드할 수 있습니다")
    if filename.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
        try:
            return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True) if any(x is not None for x in r)]
        finally:
            wb.close()
    if filename.lower().endswith(".json"):
        body = json.loads(raw.decode("utf-8-sig"))
        return [body["columns"], *[[r.get(k, "") for k in body["columns"]] for r in body["rows"]]]
    from midterm.outages import parse_rows_text
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return parse_rows_text(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
    raise ValueError("파일 인코딩은 UTF-8 또는 CP949를 사용하세요")


def price_rows(rows):
    header, *data = rows
    columns = [str(c).strip() for c in header]
    keys = ["unit", *[f"{m}월" for m in range(1, 13)]]
    if any(k not in columns for k in keys):
        raise ValueError("열량단가 헤더는 unit,1월,...,12월입니다")
    prices = {}
    for row in data:
        values = dict(zip(columns, row))
        unit = str(values.get("unit", "")).strip()
        if unit in prices:
            raise ValueError("열량단가 호기 중복: " + unit)
        prices[unit] = [float(values[f"{m}월"]) for m in range(1, 13)]
    return prices
