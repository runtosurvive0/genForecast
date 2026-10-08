"""입력(원전·석탄 OH, 가정) → 미리보기 → 1년 MILP 실행 → 당진 일·월 결과 화면.

실행은 서버 프로세스 안의 스레드 하나가 맡고(동시에 한 건), MILP 는 그 안에서 프로세스 병렬로 돈다.
결과는 runs/<id>/ 에 남으므로 서버를 다시 켜도 지난 실행을 볼 수 있다.
"""

from __future__ import annotations

import io
import json
import threading
import time
import traceback
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from midterm.fleet import load_coal_units, load_nuclear_units
from midterm.database import connect, load_settings, save_settings, save_fuel_settings
from midterm.dashboard import historical_fuel, planned_fuel
from midterm.outages import parse_outage_rows, parse_rows_text, validate_units
from midterm.scenario import QUALITY, ROOT, Scenario, default_scenario

RUNS = ROOT / "runs"
LAST_SCENARIO = ROOT / "inputs" / "last_scenario.json"
HERE = Path(__file__).resolve().parent

app = FastAPI(title="중기 석탄 MILP · 당진본부")
app.mount("/assets", StaticFiles(directory=HERE / "static"), name="assets")
from midterm.web.supply_api import router as supply_router
app.include_router(supply_router)
_job_lock = threading.Lock()
_job: dict = {"state": "idle"}


class FuelSettingsUpdate(BaseModel):
    calorific_kcal_kg: float | None = Field(default=None, ge=1000, le=10000, allow_inf_nan=False)
    is_assumption: bool = True
    source: str = Field(default="", max_length=200)


def _scenario_from(body: dict) -> Scenario:
    try:
        return Scenario.from_json(body)
    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(400, f"입력 오류: {error}") from None


def _check_units(scenario: Scenario) -> None:
    problems = []
    unknown = validate_units(scenario.nuclear_oh, [u.name for u in load_nuclear_units()], "원전")
    if unknown:
        problems.append(f"원전 호기 이름 확인: {', '.join(unknown)}")
    unknown = validate_units(scenario.coal_oh, [u.name for u in load_coal_units()], "석탄")
    if unknown:
        problems.append(f"석탄 호기 이름 확인: {', '.join(unknown)}")
    if scenario.end < scenario.start:
        problems.append("종료일이 시작일보다 앞섭니다")
    if problems:
        raise HTTPException(400, " / ".join(problems))


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (HERE / "supply.html").read_text(encoding="utf-8")


@app.get("/planning", response_class=HTMLResponse)
def planning() -> str:
    return (HERE / "index.html").read_text(encoding="utf-8")


@app.get("/api/meta")
def meta() -> dict:
    from midterm.coal_curve import load_coal_curve_model
    from midterm.net_demand import load_net_demand_model

    scenario = Scenario.from_json(load_settings()["scenario"])
    net = load_net_demand_model()
    coal = load_coal_curve_model()
    return {
        "nuclear_units": [{"unit": u.name, "available_mw": u.available_mw, "active": u.active}
                          for u in load_nuclear_units()],
        "coal_units": [{"unit": u.name, "plant": u.plant, "installed_mw": u.installed_mw,
                        "max_mw": u.max_mw, "min_mw": u.min_mw}
                       for u in load_coal_units()],
        "scenario": scenario.to_json(),
        "default_scenario": default_scenario().to_json(),
        "quality": {k: {"time_limit_s": v[0], "gap": v[1]} for k, v in QUALITY.items()},
        "models": {
            "net_demand": {"trained": f"{net.trained_from} ~ {net.trained_through}",
                           "demand_growth_pct": round(net.demand_growth * 100, 2),
                           "solar_growth_pct": round(net.solar_growth * 100, 1),
                           "weather_years": sorted({d.year for d in net.weather_years
                                                    if sum(1 for x in net.weather_years if x.year == d.year) > 330})},
            "coal_curve": {"trained": f"{coal.first_day} ~ {coal.last_day}", "kind": coal.model_kind}},
    }


@app.get("/api/settings")
def settings() -> dict:
    return load_settings()


@app.put("/api/settings")
def update_settings(body: dict) -> dict:
    scenario = _scenario_from(body.get("scenario", {}))
    _check_units(scenario)
    try:
        return save_settings(scenario, body.get("fuel", load_settings()["fuel"]))
    except (ValueError, TypeError) as error:
        raise HTTPException(400, str(error)) from None


@app.get("/api/fuel-settings")
def fuel_settings() -> dict:
    return load_settings()["fuel"]


@app.put("/api/fuel-settings")
def update_fuel_settings(body: FuelSettingsUpdate) -> dict:
    """외부 시스템도 동일 API 로 발열량·가정 여부·출처를 갱신할 수 있다."""
    try:
        return save_fuel_settings(body.model_dump(exclude_unset=True))["fuel"]
    except (ValueError, TypeError) as error:
        raise HTTPException(400, str(error)) from None


@app.get("/api/dashboard")
def dashboard(run_id: str | None = None) -> dict:
    from midterm.history import DANGJIN_ACTUAL_PATH

    config = load_settings()
    calorific = config["fuel"]["calorific_kcal_kg"]
    available = runs()
    if run_id is None and available:
        run_id = available[0]["id"]
    summary, plan = None, None
    if run_id:
        folder = _run_dir(run_id)
        summary = json.loads((folder / "summary.json").read_text(encoding="utf-8"))
        plan = planned_fuel(folder, summary, calorific)
    actual_by_day = defaultdict(dict)
    with connect() as db:
        for row in db.execute("SELECT * FROM fuel_actual_daily ORDER BY day,unit"):
            actual_by_day[row["day"]][row["unit"]] = row["tonnes"]
    units = [u.name for u in load_coal_units() if u.is_dangjin]
    actual = [{"period": day, "unit_tonnes": {u: values.get(u) for u in units},
               "tonnes": sum(values[u] for u in units) if all(u in values for u in units) else None}
              for day, values in sorted(actual_by_day.items())]
    return {"run_id": run_id, "runs": available, "summary": summary, "plan": plan,
            "historical": historical_fuel(DANGJIN_ACTUAL_PATH, calorific),
            "actual": {"daily": actual, "classification": "measured_fuel"},
            "settings": config, "units": sorted(units, key=lambda n: int(n.removeprefix("당진"))),
            "method": {"heat": "시간별 호기 열량 = (a2 × 출력² + a1 × 출력 + a0) × 운전여부",
                       "tonnes": "석탄 톤 = 열량(Gcal) × 1,000 ÷ 발열량(kcal/kg)",
                       "scope": "연료 열량곡선 기반 추정. 별도의 기동용 연료는 포함하지 않음.",
                       "curve_source": "data/coal_units.csv", "plan_source": "hourly.npz",
                       "historical_source": "data/dangjin_actual_hourly.csv"}}


@app.post("/api/outages/parse")
async def parse_outages(kind: str, file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if len(raw) > 4 * 1024 * 1024:
        raise HTTPException(400, "파일이 4MB 를 넘습니다")
    try:
        if file.filename.lower().endswith((".xlsx", ".xlsm")):
            import openpyxl
            workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
            rows = [list(r) for r in workbook.worksheets[0].iter_rows(values_only=True)
                    if any(c not in (None, "") for c in r)]
        else:
            text = None
            for encoding in ("utf-8-sig", "cp949"):
                try:
                    text = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            rows = parse_rows_text(text or "")
        outages = parse_outage_rows(rows)
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    known = ([u.name for u in load_nuclear_units()] if kind == "nuclear"
             else [u.name for u in load_coal_units()])
    return {"rows": [o.as_row() for o in outages],
            "unknown_units": validate_units(outages, known, kind)}


@app.get("/api/template/{kind}")
def template(kind: str) -> Response:
    sample = {"nuclear": "unit,start,end,note\n한빛#3,2027-03-02,2027-04-20,계획예방정비 예시\n",
              "coal": "unit,start,end,note\n당진3,2027-04-01,2027-05-10,계획예방정비 예시\n"}.get(kind)
    if sample is None:
        raise HTTPException(404)
    return Response(("﻿" + sample).encode("utf-8"), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={kind}_oh_template.csv"})


@app.post("/api/preview")
def preview(body: dict) -> dict:
    """MILP 없이 순수요·원전·석탄목표·가용설비를 월·일 단위로."""
    from midterm.annual import WARMUP_DAYS, prepare

    scenario = _scenario_from(body)
    _check_units(scenario)
    prep = prepare(scenario)
    keep = slice(WARMUP_DAYS * 24, None)
    hours = prep["hours"][keep]
    demand = np.concatenate([f.demand_mw for f in prep["forecast"]])[keep]
    solar = np.concatenate([f.solar_mw for f in prep["forecast"]])[keep]
    series = {"demand": demand, "solar": solar, "net": demand - solar,
              "nuclear": prep["nuclear"][keep], "coal_model": prep["raw"][keep],
              "coal_target": prep["target"][keep], "coal_available": prep["available"][keep]}
    monthly, daily = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    for k, at in enumerate(hours):
        for key, values in series.items():
            monthly[at.strftime("%Y-%m")][key].append(values[k])
            daily[at.date().isoformat()][key].append(values[k])
    pack = lambda table: [{"period": p, **{k: round(float(np.mean(v)), 0) for k, v in vals.items()}}  # noqa: E731
                          for p, vals in sorted(table.items())]
    return {"monthly": pack(monthly), "daily": pack(daily), "warnings": prep["warnings"]}


def _run_job(scenario: Scenario, run_id: str) -> None:
    from midterm.annual import run_annual
    from midterm.report import save_run

    def progress(event):
        with _job_lock:
            _job.update({k: v for k, v in event.items() if k != "stage"}, stage=event.get("stage"))

    try:
        result = run_annual(scenario, progress)
        save_run(result, RUNS / run_id)
        with _job_lock:
            _job.update(state="done", run_id=run_id, finished=time.time())
    except Exception as error:  # noqa: BLE001 - 화면에 그대로 보여 준다
        with _job_lock:
            _job.update(state="error", error=f"{type(error).__name__}: {error}",
                        trace=traceback.format_exc()[-2000:])


@app.post("/api/run")
def run(body: dict | None = None) -> dict:
    config = load_settings()
    scenario = _scenario_from(body if body is not None else config["scenario"])
    _check_units(scenario)
    with _job_lock:
        if _job.get("state") == "running":
            raise HTTPException(409, "이미 실행 중입니다")
        scenario.save(LAST_SCENARIO)
        save_settings(scenario, config["fuel"])
        safe = "".join(c for c in scenario.name if c.isalnum() or c in "-_가-힣")[:30]
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + (f"-{safe}" if safe else "")
        _job.clear()
        _job.update(state="running", run_id=run_id, started=time.time(), stage="prepare",
                    message="순수요·원전·석탄목표 계산", windows_done=0, windows_total=None)
    threading.Thread(target=_run_job, args=(scenario, run_id), daemon=True).start()
    return {"run_id": run_id}


@app.get("/api/job")
def job() -> dict:
    with _job_lock:
        state = dict(_job)
    if state.get("started"):
        state["elapsed"] = time.time() - state["started"]
        done, total = state.get("windows_done") or 0, state.get("windows_total")
        if state.get("state") == "running" and total and done:
            solve_elapsed = state.get("elapsed", 0)
            state["eta_seconds"] = solve_elapsed / done * (total - done)
    return state


@app.get("/api/runs")
def runs() -> list[dict]:
    out = []
    for folder in sorted(RUNS.glob("*/summary.json"), reverse=True):
        try:
            summary = json.loads(folder.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({"id": folder.parent.name, "name": summary["scenario"]["name"],
                    "period": f"{summary['scenario']['start']} ~ {summary['scenario']['end']}",
                    "annual": summary["annual"], "elapsed": summary["solve"]["elapsed_seconds"]})
    return out


def _run_dir(run_id: str) -> Path:
    folder = (RUNS / run_id).resolve()
    if RUNS.resolve() not in folder.parents or not (folder / "summary.json").exists():
        raise HTTPException(404, "실행 결과가 없습니다")
    return folder


@app.get("/api/runs/{run_id}")
def run_summary(run_id: str) -> dict:
    return json.loads((_run_dir(run_id) / "summary.json").read_text(encoding="utf-8"))


@app.get("/api/runs/{run_id}/excel")
def run_excel(run_id: str) -> FileResponse:
    folder = _run_dir(run_id)
    path = folder / "당진_일월발전량.xlsx"
    if not path.exists():
        # 이 PC 는 .xlsx 를 주기적으로 지운다(storage.py). summary.json 에서 다시 만든다.
        from midterm.report import write_excel
        write_excel(json.loads((folder / "summary.json").read_text(encoding="utf-8")), path)
    return FileResponse(path, filename=f"dangjin_{run_id}.xlsx")


@app.get("/api/runs/{run_id}/hourly")
def run_hourly(run_id: str, day: str) -> dict:
    """하루 24시간 호기별 출력(일별 상세 보기)."""
    data = np.load(_run_dir(run_id) / "hourly.npz")
    summary = json.loads((_run_dir(run_id) / "summary.json").read_text(encoding="utf-8"))
    days = [d["date"] for d in summary["daily"]]
    if day not in days:
        raise HTTPException(404, "그 날짜가 결과에 없습니다")
    k = days.index(day)
    rows = slice(24 * k, 24 * k + 24)
    names = [str(n) for n in data["names"]]
    dj = [j for j, n in enumerate(names) if n.startswith("당진")]
    return {"day": day, "units": [names[j] for j in dj],
            "output": data["output"][rows][:, dj].round(1).tolist(),
            "coal_target": data["coal_target"][rows].round(0).tolist(),
            "net": (data["demand"][rows] - data["solar"][rows]).round(0).tolist(),
            "nuclear": data["nuclear"][rows].round(0).tolist()}
