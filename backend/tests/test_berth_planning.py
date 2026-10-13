from copy import deepcopy
from datetime import timedelta, date
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from midterm.database import connect
from midterm.supply import DEFAULTS, GROUPS, UNITS, timestamp
from midterm.berth_planning import init_berths, recommendations, project, find_slot, replay, apply_assignments, scope_records, calendar
from midterm.web import berths_api


def fixture():
    at = timestamp("2027-01-01")
    records = {"config": {**DEFAULTS, "heat_rates": dict.fromkeys(UNITS, 2000)}, "transfers": [],
        "baselines": [{"id": i, "group_id": g, "at": at.isoformat(), "tonnes": q, "cv": 5500} for i, (g, q) in enumerate(zip(GROUPS, [150000, 10000, 150000]))],
        "vessels": [{"id": 1, "name": "대기선", "cargo": 14000., "incoming_cv": 6000.,
                     "arrival_at": at.isoformat(), "classification": "simulation", "run_id": "test", "points": []}],
        "port_visits": [], "stock_lots": []}
    state = {"berths": [{"id": f"BD-{i}", "group_id": g, "rate_tpd": 7000., "enabled": 1} for i, g in enumerate(GROUPS, 1)], "assignments": []}
    plan = {(at + timedelta(hours=i)).isoformat(): {u: {"mw": 100., "online": True} for u in UNITS} for i in range(60 * 24)}
    master = {u: SimpleNamespace(heat=[0, 2, 0], installed_mw=500) for u in UNITS}
    return records, state, plan, at, master


def test_recommendation_checks_eta_occupancy_and_inventory_priority():
    r, s, p, at, m = fixture()
    assert recommendations(r, s, p, at, 30, 1, master=m)[0]["id"] == "BD-2"
    busy = {**r["vessels"][0], "id": 2, "berth_id": "BD-2", "points": [{"at": at.isoformat(), "cumulative": 0, "rate": 7000 / 24,
             "allocations": {"g14": 0, "g58": 1, "g910": 0}}]}
    r["vessels"].append(busy)
    candidates = recommendations(r, s, p, at, 30, 1, master=m)
    assert candidates[0]["id"] != "BD-2"  # 빈 부두 우선
    assert next(c for c in candidates if c["id"] == "BD-2")["wait_hours"] == pytest.approx(48)
    busy["points"][-1]["rate"] = 0
    assert next(c for c in recommendations(r, s, p, at, 30, 1, master=m) if c["id"] == "BD-2")["start_at"] is None
    assert find_slot(at, 24, [{"start_at": (at + timedelta(days=1)).isoformat(), "end_at": (at + timedelta(days=2)).isoformat()}]) == at


def test_waiting_mode_preserves_source_caps_cargo_and_conserves_pool():
    r, s, p, at, m = fixture()
    before = deepcopy((r, s))
    base = project(r, s, p, at, 30, master=m)
    case = project(r, s, p, at, 30, "include_waiting", master=m)
    assert sum(d["groups"]["g58"]["receipts"] for d in base["forecast"]) == 0
    assert sum(d["groups"]["g58"]["receipts"] for d in case["forecast"]) == pytest.approx(14000)
    assert case["forecast"][0]["groups"]["g58"]["receipts"] == pytest.approx(7000)
    first = case["forecast"][0]
    assert first["groups"]["g58"]["stock"] == pytest.approx(10000 + 7000 - first["groups"]["g58"]["burn"])
    assert first["port_remaining"] == pytest.approx(7000)
    assert first["stock_including_port"] == pytest.approx(310000 + 14000 - sum(g["burn"] for g in first["groups"].values()))
    assert len(case["estimated_assignments"]) == 1 and (r, s) == before


def test_virtual_queue_does_not_double_book_and_unknown_data_is_not_zero():
    r, s, p, at, m = fixture()
    for i in range(2, 6):
        r["vessels"].append({**deepcopy(r["vessels"][0]), "id": i})
    case = project(r, s, p, at, 30, "include_waiting", master=m)
    bookings = case["estimated_assignments"]
    assert len(bookings) == 5
    for a in bookings:
        for b in bookings:
            if a is not b and a["berth_id"] == b["berth_id"]:
                assert a["end_at"] <= b["start_at"] or b["end_at"] <= a["start_at"]
    r["baselines"] = []
    missing = project(r, s, p, at, 30, "include_waiting", master=m)
    assert missing["kpis"]["stock"] is None and not missing["estimated_assignments"]


def setup_api(tmp_path, monkeypatch):
    r, s, p, at, m = fixture()
    path = tmp_path / "bookings.sqlite3"
    with connect(path) as db:
        init_berths(db)
        for i in (1, 2):
            db.execute("INSERT INTO supply_vessels(id,name,cargo,incoming_cv,arrival_at,recorded_at,run_id,classification) VALUES(?, '선박',14000,6000,?,?,'test','simulation')", (i, at.isoformat(), at.isoformat()))
    snap = {"run_id": "test", "records": r, "berths": s, "plan": p, "as_of": at.isoformat(), "horizon": 30, "fuel_cv": 5500,
            "master": {u: {"installed_mw": v.installed_mw, "heat": v.heat} for u, v in m.items()}}
    monkeypatch.setattr(berths_api, "connect", lambda: connect(path))
    monkeypatch.setattr(berths_api, "inputs", lambda _: deepcopy(snap))
    monkeypatch.setattr(berths_api, "now", lambda: at)
    request = SimpleNamespace(state=SimpleNamespace(session={"user": {"id": "operator"}}))
    return path, snap, request


def test_assignment_conflict_revision_history_and_idempotency(tmp_path, monkeypatch):
    path, snap, request = setup_api(tmp_path, monkeypatch)
    body = berths_api.Assignment(run_id="test", start=date(2027, 1, 1), vessel_id=1, berth_id="BD-2",
                                start_at=snap["as_of"], expected_version=0)
    assert berths_api.assign(body, request)["version"] == 1
    assert berths_api.assign(body, request)["version"] == 1
    with pytest.raises(HTTPException) as clash:
        berths_api.assign(body.model_copy(update={"vessel_id": 2}), request)
    assert clash.value.status_code == 409
    with pytest.raises(HTTPException) as stale:
        berths_api.assign(body.model_copy(update={"berth_id": "BD-1"}), request)
    assert stale.value.status_code == 409
    assert berths_api.assign(body.model_copy(update={"expected_version": 1, "berth_id": "BD-1"}), request)["version"] == 2
    with connect(path) as db:
        assert db.execute("SELECT count(*) FROM supply_berth_assignments").fetchone()[0] == 2
        assert db.execute("SELECT count(*) FROM supply_unload_points").fetchone()[0] == 0


def test_recommendation_accepts_http_numeric_query_and_rejects_invalid_period(tmp_path, monkeypatch):
    setup_api(tmp_path, monkeypatch)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(berths_api.router)
    client = TestClient(app)
    query = {"run_id": "test", "start": "2027-01-01", "vessel_id": 1, "horizon": 30}
    response = client.get("/api/supply/berth-recommendations", params=query)
    assert response.status_code == 200
    assert response.json()["candidates"][0]["id"] == "BD-2"
    assert client.get("/api/supply/berth-recommendations", params={**query, "horizon": 31}).status_code == 400


def test_saved_simulation_freezes_inputs_and_daily_results(tmp_path, monkeypatch):
    path, snap, request = setup_api(tmp_path, monkeypatch)
    result = berths_api.save_simulation(berths_api.Simulation(run_id="test", start=date(2027, 1, 1)), request)
    saved = berths_api.saved_simulation(result["id"])
    with connect(path) as db:
        frozen = json.loads(db.execute("SELECT input_snapshot FROM supply_simulation_runs").fetchone()[0])
        db.execute("UPDATE supply_vessels SET cargo=50000")
    replayed = replay(frozen, "include_waiting")
    assert replayed["forecast"][0] == saved["daily"][0]["include_waiting"]
    assert len(saved["daily"]) == 30
    assert len(berths_api.simulations()) == 1


def test_observed_waiting_pool_is_not_consumed_by_past_planned_unloading():
    r, s, p, at, m = fixture()
    vessel = r["vessels"][0]
    vessel["classification"] = "planned"
    vessel["points"] = [{"at": (at - timedelta(days=3)).isoformat(), "cumulative": 0, "rate": 7000 / 24,
                         "allocations": {"g14": 1, "g58": 0, "g910": 0}}]
    r["port_visits"] = [{"vessel_id": 1, "arrived_at": (at - timedelta(days=3)).isoformat(), "berthed_at": None, "departed_at": None}]
    base = project(r, s, p, at, 30, master=m)
    assert base["kpis"]["port_remaining"] == 14000
    assert base["forecast"][0]["port_remaining"] == 14000
    assert base["forecast"][0]["groups"]["g14"]["receipts"] == 0
    # 미접안 항차의 지난 하역 예정은 새 가상 접안으로 재계산한다.
    result = project(r, s, p, at, 30, "include_waiting", master=m)
    assert result["kpis"]["stock"] == 310000
    assert result["forecast"][0]["groups"]["g58"]["receipts"] == pytest.approx(7000)
    assert r["port_visits"][0]["berthed_at"] is None


def test_unknown_actual_arrival_remains_unknown():
    r, s, p, at, m = fixture()
    r["vessels"][0]["classification"] = "planned"
    result = project(r, s, p, at, 30, master=m)
    assert result["kpis"]["port_remaining"] is None
    assert result["kpis"]["stock_including_port"] is None
    assert result["scheduling_issues"]


def test_shipment_key_is_idempotent_for_common_and_simulated_voyages(tmp_path, monkeypatch):
    path, snap, request = setup_api(tmp_path, monkeypatch)
    from midterm import milp_store
    monkeypatch.setattr(milp_store, "stored_run", lambda _: {"summary": {}})
    for run_id in (None, "test"):
        body = berths_api.Shipment(run_id=run_id, name="등록선", cargo=50000, incoming_cv=6000,
            arrival_at=snap["as_of"], mmsi="440123456", voyage_key="voyage-2027")
        first = berths_api.register_shipment(body)
        assert berths_api.register_shipment(body) == first
        with pytest.raises(HTTPException) as duplicate:
            berths_api.register_shipment(body.model_copy(update={"cargo": 80000}))
        assert duplicate.value.status_code == 409
    with connect(path) as db:
        assert db.execute("SELECT count(*) FROM supply_vessels WHERE voyage_key='voyage-2027'").fetchone()[0] == 2


def test_reserved_berth_config_and_actual_cumulative_are_protected(tmp_path, monkeypatch):
    path, snap, request = setup_api(tmp_path, monkeypatch)
    body = berths_api.Assignment(run_id="test", start=date(2027, 1, 1), vessel_id=1, berth_id="BD-2",
                                start_at=snap["as_of"], expected_version=0)
    berths_api.assign(body, request)
    with pytest.raises(HTTPException) as occupied:
        berths_api.update_berth("BD-2", berths_api.BerthConfig(rate_tpd=10000))
    assert occupied.value.status_code == 409
    cancelled = body.model_copy(update={"expected_version": 1, "status": "cancelled"})
    berths_api.assign(cancelled, request)
    assert berths_api.update_berth("BD-2", berths_api.BerthConfig(rate_tpd=10000))["rate_tpd"] == 10000
    with connect(path) as db:
        db.execute("INSERT INTO supply_unload_points(vessel_id,at,cumulative,rate,allocations,recorded_at) VALUES(1,?,100,100,?,?)",
                   (snap["as_of"], json.dumps({"g14": 1, "g58": 0, "g910": 0}), snap["as_of"]))
    with pytest.raises(HTTPException) as actual:
        berths_api.assign(body.model_copy(update={"expected_version": 2}), request)
    assert actual.value.status_code == 409


def test_measurement_and_actual_berth_override_reservation_without_erasing_history():
    r, s, p, at, m = fixture()
    s["assignments"] = [{"vessel_id": 1, "version": 1, "berth_id": "BD-1", "start_at": at.isoformat(), "status": "reserved"}]
    r["port_visits"] = [{"vessel_id": 1, "arrived_at": at.isoformat(), "berthed_at": at.isoformat(), "berth_id": "BD-2"}]
    prepared = apply_assignments(r, s)
    assert prepared["vessels"][0]["berth_id"] == "BD-2"
    assert prepared["vessels"][0]["points"][0]["allocations"]["g58"] == 1
    measured = {"at": at.isoformat(), "cumulative": 100, "rate": 0, "allocations": {"g14": 0, "g58": 1, "g910": 0}}
    r["vessels"][0]["points"] = [measured]
    prepared = apply_assignments(r, s)
    from midterm.supply import unloading
    assert prepared["vessels"][0]["points"] == [measured]
    assert unloading(prepared["vessels"][0], at)["cumulative"] == 100


def test_voyage_shadow_does_not_double_count_common_cargo():
    r, s, p, at, m = fixture()
    r["vessels"][0]["voyage_key"] = "same-business-voyage"
    r["vessels"].append({**deepcopy(r["vessels"][0]), "id": 2, "run_id": None})
    assert [v["id"] for v in scope_records(r, "test")["vessels"]] == [1]
    assert [v["id"] for v in scope_records(r, None)["vessels"]] == [2]


def test_completed_unloading_keeps_actual_berth_until_departure():
    r, s, p, at, m = fixture()
    vessel = r["vessels"][0]
    vessel["berth_id"] = "BD-2"
    vessel["points"] = [{"at": at.isoformat(), "cumulative": 14000, "rate": 0,
                         "allocations": {"g14": 0, "g58": 1, "g910": 0}}]
    visit = {"vessel_id": 1, "arrived_at": (at - timedelta(days=3)).isoformat(),
             "berthed_at": (at - timedelta(days=2)).isoformat(), "berth_id": "BD-2", "departed_at": None}
    r["port_visits"] = [visit]
    assert calendar(r, s, as_of=at)[0]["end_at"] is None
    assert project(r, s, p, at, 30, master=m)["vessels"][0]["berth_occupied"]
    visit["departed_at"] = at.isoformat()
    assert calendar(r, s, as_of=at)[0]["end_at"] == at.isoformat()
    assert not project(r, s, p, at, 30, master=m)["vessels"][0]["berth_occupied"]
