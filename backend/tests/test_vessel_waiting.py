from datetime import datetime, timezone

import pytest

from midterm.vessels.berths import CENTER, distance_km, on_berth
from midterm.vessels.navigation import epoch
from midterm.vessels.waiting import WaitingStore, evidence_for, waiting_candidates

NOW = epoch("2026-11-09T12:00:00Z")


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr("midterm.vessels.waiting.time.time", lambda: NOW)


def iso(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat().replace("+00:00", "Z")


def vessel(mmsi, lon, lat, at, sog=0.1, nav=1, ship_type=70, name="SAM WOO 47", destination="KRTJI"):
    stamp = iso(at) if isinstance(at, (int, float)) else at
    return {"id": f"ais-{mmsi}", "name": name, "imo": "", "mmsi": mmsi, "source": "aisstream",
            "ais": {"updatedAt": stamp, "destination": destination, "shipType": ship_type, "navStatus": nav,
                    "position": {"longitude": lon, "latitude": lat, "observedAt": stamp, "sogKn": sog, "cogDeg": 0}}}


def test_berth_geometry_matches_frontend_rules():
    assert on_berth(126.5114, 37.0649) is True
    assert on_berth(126.45, 36.98) is False
    assert abs(CENTER[0] - 126.507) < 0.01
    assert 9 < distance_km(126.45, 36.98) < 12


def test_records_only_cargo_or_unknown_inside_radius(tmp_path):
    store = WaitingStore(tmp_path / "w.sqlite3")
    store.record(vessel("440000001", 126.47, 37.0, NOW - 60))
    store.record(vessel("440000002", 126.47, 37.0, NOW - 60, ship_type=None))
    store.record(vessel("440000003", 126.2, 36.5, NOW - 60))
    store.record(vessel("440000004", 126.47, 37.0, NOW - 60, ship_type=60))
    store.flush(NOW)
    points, heads = store.snapshot(NOW)
    assert set(points) == {"440000001", "440000002"}
    assert set(heads) == {"440000001", "440000002"}


def test_records_at_most_every_five_minutes_and_keeps_seven_days(tmp_path):
    store = WaitingStore(tmp_path / "w.sqlite3")
    for offset in (0, 120, 300):
        store.record(vessel("440000001", 126.47, 37.0, NOW - 600 + offset))
    store.flush(NOW)
    points, _ = store.snapshot(NOW)
    assert len(points["440000001"]) == 2
    later = NOW + 8 * 86400
    store.flush(later)
    points, _ = store.snapshot(later, hours=24 * 30)
    assert points == {}


def test_rejects_future_or_out_of_range_positions(tmp_path):
    store = WaitingStore(tmp_path / "w.sqlite3")
    store.record(vessel("440000001", 126.47, 37.0, NOW + 120))
    store.record(vessel("440000002", 126.47, 95.0, NOW - 60))
    store.record(vessel("440000003", 126.47, 37.0, "not-a-time"))
    store.flush(NOW)
    points, _ = store.snapshot(NOW)
    assert points == {}


def test_points_and_answers_survive_restart(tmp_path):
    path = tmp_path / "w.sqlite3"
    store = WaitingStore(path)
    store.record(vessel("440000001", 126.47, 37.0, NOW - 60))
    store.flush(NOW)
    store.save_answer("u1", "440000001", "yes", {"dwellHours": 2.0}, NOW)
    again = WaitingStore(path)
    points, heads = again.snapshot(NOW)
    assert len(points["440000001"]) == 1 and heads["440000001"]["name"] == "SAM WOO 47"
    assert again.answers("u1") == {"440000001": ("yes", NOW)}


def test_answers_return_latest_per_vessel(tmp_path):
    store = WaitingStore(tmp_path / "w.sqlite3")
    store.save_answer("u1", "440000001", "no", {}, 1)
    store.save_answer("u1", "440000001", "yes", {}, 2)
    store.save_answer("u2", "440000001", "no", {}, 3)
    assert store.answers("u1") == {"440000001": ("yes", 2)}
    assert store.answers("u2") == {"440000001": ("no", 3)}


M = "440000001"
KM_DEG_LON = 1 / (111.32 * 0.7986)  # 위도 37도에서 경도 1km


def stationary(hours, end=NOW, lon=126.47, lat=37.0, sog=0.1, nav=1):
    steps = round(hours * 12)
    return [(end - (steps - i) * 300, lon, lat, sog, nav) for i in range(steps + 1)]


def heads(**kw):
    return {M: vessel(M, 126.47, 37.0, NOW, **kw)}


def test_two_hours_stationary_is_candidate_and_shorter_is_not():
    found = waiting_candidates({M: stationary(2.0)}, heads(), NOW, set())
    assert len(found) == 1 and found[0]["dwellHours"] == 2.0 and found[0]["stale"] is False
    c = found[0]
    assert c["mmsi"] == M and c["name"] == "SAM WOO 47" and c["destination"] == "KRTJI"
    assert c["position"]["observedAt"] == iso(NOW) and 7 < c["distanceKm"] < 9
    assert "묘박 상태" in c["reasons"] and "속력 0.1노트" in c["reasons"] and "목적지 KRTJI" in c["reasons"]
    assert "화물선" in c["reasons"] and "2.0시간 정지" in c["reasons"]
    assert waiting_candidates({M: stationary(110 / 60)}, heads(), NOW, set()) == []


def test_berth_and_outside_radius_are_excluded():
    assert waiting_candidates({M: stationary(3, lon=126.5114, lat=37.0649)}, heads(), NOW, set()) == []


def test_drift_over_one_km_breaks_stationary_run():
    old = [p for p in stationary(3, end=NOW - 3600 - 300)]
    moved = stationary(1, lon=126.47 + 1.5 * KM_DEG_LON)
    assert waiting_candidates({M: old + moved}, heads(), NOW, set()) == []


def test_moving_vessel_is_not_stationary():
    assert waiting_candidates({M: stationary(3, sog=8.0, nav=0)}, heads(nav=0, sog=8.0), NOW, set()) == []


def test_gap_over_one_hour_splits_run():
    first = stationary(2, end=NOW - 3600 - 75 * 60)
    assert waiting_candidates({M: first + stationary(1)}, heads(), NOW, set()) == []


def test_stale_after_one_hour_is_kept_but_marked():
    found = waiting_candidates({M: stationary(3, end=NOW - 5400)}, heads(), NOW, set())
    assert len(found) == 1 and found[0]["stale"] is True


def test_excluded_vessels_are_skipped():
    assert waiting_candidates({M: stationary(3)}, heads(), NOW, {M}) == []


def test_candidates_sorted_by_dwell():
    other = "440000002"
    hs = {**heads(), other: vessel(other, 126.46, 37.0, NOW)}
    found = waiting_candidates({M: stationary(2), other: stationary(4, lon=126.46)}, hs, NOW, set())
    assert [c["mmsi"] for c in found] == [other, M]


def test_reasons_cover_missing_fields():
    found = waiting_candidates({M: stationary(2, sog=None)}, heads(name=None, destination=None, ship_type=None, sog=None),
                               NOW, set())
    c = found[0]
    assert c["name"] == f"MMSI {M}"
    assert {"묘박 상태", "목적지 미기재", "선종 미상"} <= set(c["reasons"])
    assert not any(r.startswith("속력") for r in c["reasons"])


def test_evidence_records_server_side_facts():
    c = waiting_candidates({M: stationary(2)}, heads(), NOW, set())[0]
    ev = evidence_for(c, NOW)
    assert ev["dwellHours"] == 2.0 and ev["stale"] is False and ev["at"] == NOW
    assert ev["position"] == c["position"] and ev["navStatus"] == 1


# --- API: 격리된 테스트 앱·임시 DB. 공용 ZGX에는 쓰지 않는다. ---
PASSWORD = "isolated waiting test password"


@pytest.fixture
def api(tmp_path, monkeypatch):
    import json as jsonlib
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from midterm.auth.store import AccessStore
    from midterm.web import vessels_api
    from midterm.web.auth_api import install_access

    access = AccessStore(tmp_path / "access.sqlite3")
    admin = access.init_admin("admin", "Admin", PASSWORD)
    member = access.register("member", "Member", PASSWORD)
    access.change_user(admin["id"], member["id"], "approve", member["version"])
    store = WaitingStore(tmp_path / "tracks.sqlite3")
    monkeypatch.setattr(vessels_api, "waiting", store)
    app = FastAPI()
    install_access(app, store=access, origins={"http://testserver"}, secure=False)
    app.include_router(vessels_api.waiting_router)

    class Api:
        waiting = store

        def login(self, username):
            self.client.headers["X-CSRF-Token"] = self.client.get("/api/auth/csrf").json()["token"]
            r = self.client.post("/api/auth/login", json={"username": username, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self.uid = r.json()["user"]["id"]
            self.client.headers["X-Account-ID"] = self.uid
            self.client.headers["X-CSRF-Token"] = self.client.get("/api/auth/csrf").json()["token"]

        def watch(self, mmsi):
            payload = {"version": 1, "watchlist": [f"ais-{mmsi}"],
                       "vessels": [{"id": f"ais-{mmsi}", "mmsi": mmsi, "source": "aisstream"}], "voyages": []}
            with access.connect() as db:
                db.execute("INSERT INTO workspaces VALUES(?,?,?,?)", (self.uid, 1, jsonlib.dumps(payload), "{}"))

        def seed(self, *mmsis):
            for i, mmsi in enumerate(mmsis):
                for at, lon, lat, sog, nav in stationary(3, lon=126.46 + i * 0.01):
                    store.pending.append((mmsi, at, lon, lat, sog, nav))
                store.dirty[mmsi] = vessel(mmsi, 126.46 + i * 0.01, 37.0, NOW)
            store.flush(NOW)

    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        result = Api()
        result.client = client
        yield result


def test_candidates_api_excludes_watchlist_and_recent_no(api):
    api.seed("440000001", "440000002")
    api.login("member")
    feed = api.client.get("/api/vessels/waiting-candidates").json()
    assert [c["mmsi"] for c in feed["candidates"]] == ["440000001", "440000002"]
    assert feed["radiusKm"] == 15.0 and feed["confirmed"] == {} and feed["lastReceivedAt"] == iso(NOW)
    api.watch("440000001")
    assert [c["mmsi"] for c in api.client.get("/api/vessels/waiting-candidates").json()["candidates"]] == ["440000002"]
    assert api.client.post("/api/vessels/waiting-candidates/440000002/answer", json={"answer": "no"}).status_code == 200
    assert api.client.get("/api/vessels/waiting-candidates").json()["candidates"] == []


def test_no_answer_expires_after_seven_days(api):
    api.seed("440000001")
    api.login("member")
    api.waiting.save_answer(api.uid, "440000001", "no", {}, NOW - 8 * 86400)
    assert len(api.client.get("/api/vessels/waiting-candidates").json()["candidates"]) == 1


def test_answer_yes_is_recorded_with_server_evidence_and_confirmed(api):
    api.seed("440000001")
    api.login("member")
    r = api.client.post("/api/vessels/waiting-candidates/440000001/answer",
                        json={"answer": "yes", "evidence": {"dwellHours": 99}})
    assert r.status_code == 200 and r.json()["ok"] is True
    with api.waiting.lock:
        evidence = api.waiting.db.execute("SELECT evidence FROM waiting_answers").fetchone()[0]
    import json as jsonlib
    assert jsonlib.loads(evidence)["dwellHours"] == 3.0
    assert api.waiting.answers(api.uid)["440000001"][0] == "yes"
    feed = api.client.get("/api/vessels/waiting-candidates").json()
    assert feed["confirmed"] == {"440000001": r.json()["answeredAt"]}
    assert feed["candidates"] == []


def test_answer_for_non_candidate_is_409_and_requires_csrf(api):
    api.seed("440000001")
    api.login("member")
    r = api.client.post("/api/vessels/waiting-candidates/440999999/answer", json={"answer": "yes"})
    assert r.status_code == 409 and r.json()["detail"] == "후보 상태가 바뀌었습니다."
    assert api.client.post("/api/vessels/waiting-candidates/440000001/answer", json={"answer": "maybe"}).status_code == 422
    api.client.headers.pop("X-CSRF-Token")
    assert api.client.post("/api/vessels/waiting-candidates/440000001/answer", json={"answer": "yes"}).status_code == 403


def test_candidates_require_login_and_report_unready_store(api, monkeypatch):
    from midterm.web import vessels_api
    assert api.client.get("/api/vessels/waiting-candidates").status_code == 401
    api.login("member")
    monkeypatch.setattr(vessels_api, "waiting", None)
    r = api.client.get("/api/vessels/waiting-candidates")
    assert r.status_code == 503 and r.json()["detail"] == "선박 수신기가 준비되지 않았습니다."


def test_normal_user_may_post_answer(api):
    api.seed("440000001")
    api.login("member")
    assert api.client.post("/api/vessels/waiting-candidates/440000001/answer", json={"answer": "yes"}).status_code == 200


def test_yes_after_watchlist_save_is_still_recorded(api):
    """'네'는 관심 등록(PUT)이 먼저 저장된 뒤 답이 도착한다. 이때도 409가 아니어야 한다."""
    api.seed("440000001")
    api.login("member")
    api.watch("440000001")
    r = api.client.post("/api/vessels/waiting-candidates/440000001/answer", json={"answer": "yes"})
    assert r.status_code == 200
    assert api.client.get("/api/vessels/waiting-candidates").json()["confirmed"] == {"440000001": r.json()["answeredAt"]}


def test_old_yes_expires_from_badge_and_exclusion(api):
    api.seed("440000001")
    api.login("member")
    api.waiting.save_answer(api.uid, "440000001", "yes", {}, NOW - 8 * 86400)
    feed = api.client.get("/api/vessels/waiting-candidates").json()
    assert feed["confirmed"] == {} and len(feed["candidates"]) == 1


def test_record_does_not_wait_for_database_work(tmp_path):
    import threading
    store = WaitingStore(tmp_path / "w.sqlite3")
    db_lock = store.db_lock
    held, release = threading.Event(), threading.Event()

    def hold():
        with db_lock:
            held.set()
            release.wait(5)

    worker = threading.Thread(target=hold)
    worker.start()
    assert held.wait(5)
    done = threading.Event()
    threading.Thread(target=lambda: (store.record(vessel(M, 126.47, 37.0, NOW - 60)), done.set())).start()
    try:
        assert done.wait(1), "record() blocked behind database work"
    finally:
        release.set()
        worker.join()
