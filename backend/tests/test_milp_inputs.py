import asyncio
import io
import json
from datetime import date, timedelta

import numpy as np
import pytest
from fastapi import HTTPException, UploadFile

from midterm import milp_store
from midterm.database import connect
from midterm.fleet import load_heat_prices
from midterm.scenario import Scenario
from midterm.supply import DEFAULTS, GROUPS, UNITS, read_supply, simulate, timestamp
from midterm.web import inputs_api, ledger_api


def input_payload():
    return milp_store.clean_input(Scenario(start=date(2027, 1, 1), end=date(2027, 12, 31)).to_json(),
        load_heat_prices(), {"calorific_kcal_kg": 5500, "is_assumption": True, "source": "test"})


def result_bytes():
    summary = {"scenario": {"name": "test", "start": "2027-01-01", "end": "2027-01-15"},
        "daily": [{"date": f"2027-01-{i:02d}", "coal_solved_avg_mw": 1000, "starts": 0, "units_online_avg": 10} for i in range(1, 16)],
        "outages": {"coal": []}, "warnings": [], "model_info": {}}
    buf = io.BytesIO()
    output = np.full((15 * 24, 10), 100.)
    np.savez_compressed(buf, names=np.array(list(UNITS)), output=output, online=output > 0,
        demand=np.full(360, 80000), solar=np.full(360, 10000), coal_available=np.full(360, 50000))
    return summary, buf.getvalue()


def test_input_and_result_roundtrip_from_db_without_run_files(tmp_path, monkeypatch):
    path = tmp_path / "local.sqlite3"
    payload = input_payload()
    first = milp_store.save_input(payload, path)
    assert milp_store.save_input(payload, path)["id"] == first["id"]
    milp_store.begin_run("test-db", first["id"], path)
    summary, raw = result_bytes()
    milp_store.finish_run("test-db", summary, raw, path=path)
    from midterm import supply_plans
    original = milp_store.stored_run
    monkeypatch.setattr(milp_store, "stored_run", lambda run_id: original(run_id, path))
    plan, models, source = supply_plans.run_plan("test-db")
    assert len(plan) == 360
    assert len(models) == 15
    assert models[0]["coal_available_mw"] == 50000
    assert source["start"] == "2027-01-01"
    assert milp_store.get_input(first["id"], path)["payload"] == payload


def test_upload_validates_before_writing_and_preserves_checksum(tmp_path, monkeypatch):
    path = tmp_path / "test.sqlite3"
    monkeypatch.setattr(inputs_api, "save_input", lambda payload: milp_store.save_input(payload, path))
    scenario = Scenario().to_json()
    prices = load_heat_prices()
    csv = "unit," + ",".join(f"{m}월" for m in range(1, 13)) + "\n"
    csv += "\n".join(u + "," + ",".join(str(v) for v in vals) for u, vals in prices.items())
    def file(name, raw):
        return UploadFile(filename=name, file=io.BytesIO(raw))
    saved = asyncio.run(inputs_api.upload(scenario=file("scenario.json", json.dumps(scenario).encode()),
        heat_prices=file("prices.csv", csv.encode()), nuclear=None, coal=None, calorific=5500, assumption=True))
    assert saved["payload"]["files"][0]["sha256"]
    assert set(saved["payload"]["heat_prices"]) == set(prices)
    scenario["coal_oh"] = [{"unit": "미등록호기", "start": "2027-01-01", "end": "2027-01-03"}]
    with pytest.raises(HTTPException) as error:
        asyncio.run(inputs_api.upload(scenario=file("bad.json", json.dumps(scenario).encode()),
            heat_prices=file("prices.csv", csv.encode()), nuclear=None, coal=None, calorific=5500, assumption=True))
    assert error.value.status_code == 400
    assert len(milp_store.list_inputs(path)) == 1
    with pytest.raises(HTTPException) as invalid_excel:
        asyncio.run(inputs_api.upload(scenario=file("scenario.json", json.dumps(Scenario().to_json()).encode()),
            heat_prices=file("bad.xlsx", b"not an excel archive"), nuclear=None, coal=None, calorific=5500, assumption=True))
    assert invalid_excel.value.status_code == 400
    assert len(milp_store.list_inputs(path)) == 1


def test_invalid_price_and_month_adjustment_are_rejected():
    payload = input_payload()
    payload["heat_prices"]["당진1"][0] = float("nan")
    with pytest.raises(ValueError):
        milp_store.clean_input(payload["scenario"], payload["heat_prices"], payload["fuel"])
    scenario = Scenario().to_json()
    scenario["coal_adjust_pct"] = [0]
    with pytest.raises(ValueError):
        milp_store.clean_input(scenario, load_heat_prices(), payload["fuel"])


def test_simulation_initial_stock_is_scoped_and_not_overwritten(tmp_path, monkeypatch):
    path = tmp_path / "local.sqlite3"
    monkeypatch.setattr(ledger_api, "connect", lambda: connect(path))
    monkeypatch.setattr(ledger_api, "stored_run", lambda _: {"summary": {"scenario": {"start": "2027-01-01"}}})
    body = ledger_api.StartingStock(run_id="sim-test", high_tonnes={"g14": 50000, "g58": 100000, "g910": 150000},
        low_tonnes={"g14": 90000, "g58": 100000, "g910": 150000})
    assert ledger_api.starting_stock(body)["total_tonnes"] == 640000
    records = read_supply(path)
    assert len(records["stock_lots"]) == 6
    assert [r["tonnes"] for r in records["baselines"]] == [140000, 200000, 300000]
    assert records["baselines"][0]["cv"] == pytest.approx(5357.142857)
    assert all(r["run_id"] == "sim-test" for r in records["baselines"])
    with pytest.raises(HTTPException) as duplicate:
        ledger_api.starting_stock(body)
    assert duplicate.value.status_code == 409


def test_port_waiting_cargo_is_separate_and_never_projected_as_unloaded():
    start = timestamp("2026-10-08")
    records = {"config": {**DEFAULTS, "heat_rates": dict.fromkeys(UNITS, 2000)}, "transfers": [],
        "baselines": [{"id": i, "group_id": g, "at": start.isoformat(), "tonnes": 100000, "cv": 5500} for i, g in enumerate(GROUPS)],
        "vessels": [{"id": 1, "cargo": 1000, "incoming_cv": 6000, "arrival_at": start.isoformat(),
            "points": [{"at": start.isoformat(), "cumulative": 0, "rate": 100, "allocations": {"g14": 1, "g58": 0, "g910": 0}}]}],
        "port_visits": [{"vessel_id": 1, "arrived_at": start.isoformat(), "berthed_at": None, "departed_at": None}]}
    plan = {(start + timedelta(hours=i)).isoformat(): {u: {"mw": 0, "online": False} for u in UNITS} for i in range(15 * 24)}
    result = simulate(records, plan, start + timedelta(hours=12), 7)
    assert result["kpis"]["stock"] == 300000
    assert result["kpis"]["waiting_cargo"] == 1000
    assert result["kpis"]["stock_including_port"] == 301000
    assert result["vessels"][0]["cumulative"] == 0
    assert result["vessels"][0]["state"] == "하역대기"
    assert result["vessels"][0]["demurrage_hours"] == 12
    assert result["forecast"][0]["groups"]["g14"]["receipts"] == 0
    records["port_visits"][0]["berthed_at"] = (start + timedelta(hours=6)).isoformat()
    after = simulate(records, plan, start + timedelta(hours=12), 7)
    assert after["kpis"]["stock"] == 300600
    assert after["kpis"]["port_remaining"] == 400
    assert after["kpis"]["stock_including_port"] == 301000
    assert after["forecast"][0]["groups"]["g14"]["receipts"] == 1000


def test_port_events_are_idempotent_and_require_registered_cargo(tmp_path, monkeypatch):
    from midterm.supply import init_supply, now
    path = tmp_path / "port.sqlite3"
    monkeypatch.setattr(ledger_api, "connect", lambda: connect(path))
    at = (now() - timedelta(hours=8)).isoformat()
    body = ledger_api.PortVisit(source="aisstream", event_id="visit-1", vessel_id=1, arrived_at=at)
    with pytest.raises(HTTPException) as missing:
        ledger_api.port_visit(body)
    assert missing.value.status_code == 404
    with connect(path) as db:
        init_supply(db)
        db.execute("INSERT INTO supply_vessels(name,cargo,incoming_cv,arrival_at,recorded_at) VALUES(?,?,?,?,?)", ("TEST", 1000, 6000, at, at))
    ledger_api.port_visit(body)
    ledger_api.port_visit(body)
    assert len(read_supply(path)["port_visits"]) == 1
    body.berthed_at = (now() - timedelta(hours=2)).isoformat()
    ledger_api.port_visit(body)
    assert read_supply(path)["port_visits"][0]["berthed_at"] == body.berthed_at
    previous = body.berthed_at
    body.berthed_at = None
    ledger_api.port_visit(body)
    assert read_supply(path)["port_visits"][0]["berthed_at"] == previous


def test_internal_generation_contract_separates_actual_and_future(tmp_path, monkeypatch):
    from midterm.web import supply_api
    from midterm.supply import now
    from midterm.supply_plans import db_plan
    path = tmp_path / "actual.sqlite3"
    monkeypatch.setattr(supply_api, "connect", lambda: connect(path))
    at = now().replace(minute=0, second=0, microsecond=0)
    body = supply_api.PlanBatch(source="API", source_name="DCS 시간평균 발전실적", as_of=at.isoformat(),
        classification="observed_generation", rows=[{"at": (at - timedelta(hours=1)).isoformat(), "unit": u, "mw": 100} for u in UNITS])
    saved = supply_api.import_plan(body)
    plan, source = db_plan(saved["id"], path)
    assert source["classification"] == "observed_generation"
    assert plan[(at - timedelta(hours=1)).isoformat()]["당진1"]["mw"] == 100
    body.rows[0].at = at.isoformat()
    with pytest.raises(HTTPException):
        supply_api.import_plan(body)
    with connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM supply_plan_batches").fetchone()[0] == 1


def test_windows_server_uses_selector_loop(monkeypatch):
    import uvicorn
    from midterm import __main__ as cli
    called = {}
    monkeypatch.setattr(cli.sys, "platform", "win32")
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: called.update(app=app, **kwargs))
    cli.main(["serve", "--port", "8093"])
    assert called["loop"] == "asyncio:SelectorEventLoop"
    assert called["host"] == "127.0.0.1"
    assert called["port"] == 8093
