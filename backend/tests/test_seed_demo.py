import io
import json
import sqlite3

import numpy as np
import pytest

from midterm import milp_store
from midterm.database import connect, load_settings
from midterm.seed_demo import SEED, TABLES, seed_demo
from midterm.supply import init_supply, read_supply


def test_seed_is_curated_and_preserves_existing_records_and_ids(tmp_path):
    with sqlite3.connect(SEED.as_uri() + "?mode=ro", uri=True) as db:
        assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} == set(TABLES)
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    path = tmp_path / "local.sqlite3"
    with connect(path) as db:
        milp_store.init_store(db)
        init_supply(db)
        db.execute("INSERT INTO milp_inputs VALUES(7,'existing','기존','{}','2026-10-01')")
        db.execute("INSERT INTO supply_baselines VALUES(42,'g14','2026-10-01',?, '2026-10-01')",
                   (json.dumps({"tonnes": 42, "cv": 5500}),))
        db.execute("INSERT INTO supply_vessels(id,name,cargo,incoming_cv,arrival_at,recorded_at) VALUES(12,'기존',100,5500,'2029-01-01','2026-10-01')")
        db.execute("INSERT INTO fuel_actual_daily VALUES('2026-10-01','당진1',123,'실측')")
    result = seed_demo(path)
    assert result["status"] == "seeded"
    run = milp_store.stored_run(result["run_id"], path)
    assert run["input_id"] == run["summary"]["input_id"] == 8
    with np.load(io.BytesIO(run["hourly"]), allow_pickle=False) as arrays:
        assert arrays["output"].shape == (8760, 58)
    records = read_supply(path)
    lots = records["stock_lots"]
    assert sum(r["tonnes"] for r in lots) == 640000
    assert {r["cv"] for r in lots if r["grade"] == "high"} == {6000}
    assert {r["cv"] for r in lots if r["grade"] == "low"} == {5000}
    assert all(r["baseline_id"] > 42 and r["is_assumption"] for r in lots)
    vessel = next(v for v in records["vessels"] if v["run_id"] == result["run_id"])
    assert vessel["id"] == 13
    assert vessel["points"][0]["rate"] * 24 == pytest.approx(7000)
    with connect(path) as db:
        db.execute("UPDATE supply_vessels SET name='사용자 수정' WHERE id=13")
    assert seed_demo(path)["status"] == "already_seeded"
    with connect(path) as db:
        assert db.execute("SELECT count(*) FROM milp_runs").fetchone()[0] == 1
        assert db.execute("SELECT name FROM supply_vessels WHERE id=13").fetchone()[0] == "사용자 수정"
        assert db.execute("SELECT tonnes FROM fuel_actual_daily").fetchone()[0] == 123
        assert db.execute("SELECT payload FROM supply_baselines WHERE id=42").fetchone()[0] == json.dumps({"tonnes": 42, "cv": 5500})
        assert not db.execute("PRAGMA foreign_key_check").fetchall()


def test_conflicting_baseline_rolls_back_entire_import(tmp_path):
    path = tmp_path / "conflict.sqlite3"
    with connect(path) as db:
        init_supply(db)
        db.execute("INSERT INTO supply_baselines(group_id,at,payload,recorded_at) VALUES('g14','2027-01-01T00:00:00+09:00','{}','2026-10-01')")
    with pytest.raises(ValueError, match="기존 데이터를 보존"):
        seed_demo(path)
    with connect(path) as db:
        assert db.execute("SELECT count(*) FROM supply_baselines").fetchone()[0] == 1
        for table in ("milp_inputs", "milp_runs", "supply_stock_lots", "supply_vessels"):
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0


def test_seed_snapshot_links_milp_generation_inventory_and_unloading(tmp_path, monkeypatch):
    from midterm.web import planning_api, supply_api
    path = tmp_path / "linked.sqlite3"
    result = seed_demo(path)
    original_run, original_runs = milp_store.stored_run, milp_store.stored_runs
    monkeypatch.setattr(milp_store, "stored_run", lambda key: original_run(key, path))
    monkeypatch.setattr(milp_store, "stored_runs", lambda: original_runs(path))
    monkeypatch.setattr(supply_api, "connect", lambda: connect(path))
    monkeypatch.setattr(supply_api, "read_supply", lambda: read_supply(path))
    monkeypatch.setattr(supply_api, "load_settings", lambda: load_settings(path))
    monkeypatch.setattr(supply_api, "latest_forecast", lambda: None)
    data = planning_api.snapshot(result["run_id"], horizon=30)
    assert data["classification"] == "functional_demo"
    assert len(data["units"]) == 10 and len(data["daily"]) == 30 and len(data["monthly"]) == 12
    assert all(d["generation_mwh"] is not None and d["fuel_tonnes"] is not None for d in data["daily"])
    assert len(data["models"]) == 30 and all(d["coal_available_mw"] is not None for d in data["models"])
    assert data["outages"] and data["inventory"]["kpis"]["stock"] == 640000
    daily = data["inventory"]["daily"]
    first = daily[0]["groups"]["g14"]
    assert first["receipts"] == pytest.approx(7000)
    assert first["stock"] == pytest.approx(140000 + 7000 - first["burn"])
    assert sum(d["groups"]["g14"]["receipts"] for d in daily) == pytest.approx(80000)
    assert all(d["groups"][g]["receipts"] == 0 for d in daily for g in ("g58", "g910"))


def test_published_databases_cannot_be_used_as_import_targets():
    for path in (SEED, SEED.parent.parent / "data" / "planning.sqlite3"):
        with pytest.raises(ValueError, match="작업 DB"):
            seed_demo(path)
