"""발전계획 입력 어댑터. MIP 파일과 외부 시간별 계획은 같은 정규형을 사용."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

from midterm.database import connect, DATABASE
from midterm.scenario import ROOT, Scenario
from midterm.supply import timestamp, now, init_supply


@lru_cache(maxsize=3)
def _read_run(folder: str, modified: tuple):
    folder = Path(folder)
    summary = json.loads((folder / "summary.json").read_text(encoding="utf-8"))
    start = timestamp(summary["scenario"]["start"])
    plan, forecasts = {}, []
    with np.load(folder / "hourly.npz") as data:
        names = [str(n) for n in data["names"]]
        output, online = data["output"], data["online"]
        demand, solar = data["demand"], data["solar"]
        coal = data["coal_model"] if "coal_model" in data else None
        for i in range(len(output)):
            at = start + timedelta(hours=i)
            plan[at.isoformat()] = {u: {"mw": float(output[i, j]), "online": bool(online[i, j])}
                                   for j, u in enumerate(names) if u.startswith("당진")}
        for d in summary["daily"]:
            i = int((timestamp(d["date"]) - start).total_seconds() / 3600)
            sl = slice(i, i + 24)
            forecasts.append({"day": d["date"], "demand_mw": float(demand[sl].mean()),
                "demand_peak_mw": float(demand[sl].max()), "solar_mw": float(solar[sl].mean()),
                "solar_mwh": float(solar[sl].sum()), "solar_peak_mw": float(solar[i + 12]),
                "coal_ml_mw": float(coal[sl].mean()) if coal is not None else None, "coal_mip_mw": d["coal_solved_avg_mw"],
                "starts": d["starts"], "units_off": 10 - d["units_online_avg"]})
    return plan, forecasts, summary


def run_plan(run_id):
    folder = (ROOT / "runs" / run_id).resolve()
    if (ROOT / "runs").resolve() not in folder.parents or not (folder / "hourly.npz").exists():
        raise ValueError("저장된 발전계획이 없습니다")
    plan, forecasts, summary = _read_run(str(folder), ((folder / "hourly.npz").stat().st_mtime_ns,
                                                    (folder / "summary.json").stat().st_mtime_ns))
    return plan, forecasts, {"source": "FORECAST", "source_name": "동작 확인용 MIP 전망" if summary.get("classification") == "functional_demo" else "저장된 MIP 발전계획", "run_id": run_id,
        "as_of": datetime.fromtimestamp((folder / "hourly.npz").stat().st_mtime, now().tzinfo).isoformat(),
        "start": summary["scenario"]["start"], "end": summary["scenario"]["end"],
        "warnings": summary["warnings"], "model_info": summary["model_info"],
        "outages": summary["outages"], "name": summary["scenario"]["name"],
        "classification": summary.get("classification", "scenario_forecast"),
        "classification_note": summary.get("classification_note", "")}


def db_plan(batch_id, path=DATABASE):
    with connect(path) as db:
        init_supply(db)
        row = db.execute("SELECT * FROM supply_plan_batches WHERE id=?", (batch_id,)).fetchone()
        if not row:
            raise ValueError("등록된 계획자료가 없습니다")
        plan = {}
        for r in db.execute("SELECT * FROM supply_plan_hours WHERE batch_id=? ORDER BY at,unit", (batch_id,)):
            plan.setdefault(r["at"], {})[r["unit"]] = {"mw": r["mw"], "online": bool(r["online"])}
        return plan, {**dict(row), "start": min(plan)[:10], "end": max(plan)[:10], "warnings": []}


def model_forecast(scenario: Scenario, path=DATABASE):
    """MIP 를 호출하지 않고 세 모델의 독립 결과 스냅샷을 DB에 보존."""
    from midterm.annual import prepare, WARMUP_DAYS
    prep = prepare(scenario)
    keep = slice(WARMUP_DAYS * 24, None)
    demand = np.concatenate([f.demand_mw for f in prep["forecast"]])[keep]
    solar = np.concatenate([f.solar_mw for f in prep["forecast"]])[keep]
    coal = prep["raw"][keep]
    daily = []
    for i, day in enumerate(scenario.days):
        sl = slice(i * 24, i * 24 + 24)
        daily.append({"day": day.isoformat(), "demand_mw": float(demand[sl].mean()),
            "demand_peak_mw": float(demand[sl].max()), "solar_mw": float(solar[sl].mean()),
            "solar_mwh": float(solar[sl].sum()), "solar_peak_mw": float(solar[i * 24 + 12]),
            "coal_ml_mw": float(coal[sl].mean()), "coal_mip_mw": None})
    payload = {"daily": daily, "scenario": scenario.to_json(), "warnings": prep["warnings"],
        "source": "FORECAST", "source_name": "중기 수요 ML · 태양광 패턴 · 석탄곡선 ML", "as_of": now().isoformat()}
    with connect(path) as db:
        init_supply(db)
        db.execute("INSERT INTO supply_forecasts(as_of,payload) VALUES(?,?)", (payload["as_of"], json.dumps(payload, ensure_ascii=False)))
    return payload


def latest_forecast(path=DATABASE):
    with connect(path) as db:
        init_supply(db)
        row = db.execute("SELECT payload FROM supply_forecasts ORDER BY id DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None
