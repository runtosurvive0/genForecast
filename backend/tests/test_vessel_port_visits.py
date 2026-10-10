import asyncio
from uuid import uuid4

import pytest

from midterm.vessels.port_visits import PortVisitService, ProviderError

NOW = 1791590400.0  # 2026-10-10 UTC
MMSI = "440123456"


def ship():
    return {"source": "aisstream", "mmsi": MMSI, "imo": "9459101"}


def identity(vid="track-a", imo="9459101", mmsi=MMSI):
    return {"id": vid, "ssvid": mmsi, "imo": imo, "shipname": "TEST SHIP",
            "transmissionDateFrom": "2026-01-01T00:00:00Z", "transmissionDateTo": "2026-10-06T00:00:00Z"}


def event(eid="event-a", vid="track-a", end="2026-10-04T12:00:00Z"):
    return {"id": eid, "type": "port_visit", "start": "2026-10-03T00:00:00Z", "end": end,
            "vessel": {"id": vid, "ssvid": MMSI}, "port_visit": {"confidence": 3,
            "intermediateAnchorage": {"name": "NEWCASTLE", "flag": "AUS", "id": "aus-newcastle"}}}


def test_no_token_makes_no_upstream_request():
    async def fetch(*args):
        pytest.fail("no request without token")
    result = asyncio.run(PortVisitService(token="", fetch=fetch, clock=lambda: NOW).lookup(ship()))
    assert result["status"] == "unconfigured"
    assert result["visits"] == []


def test_exact_identity_all_matching_tracks_pagination_dedup_and_cache():
    calls = []
    async def fetch(path, params):
        calls.append((path, params))
        if path == "vessels/search":
            assert params["query"] == MMSI
            return {"total": 1, "entries": [{"selfReportedInfo": [identity(), identity("track-b"),
                identity("unrelated", mmsi="440999999")]}]}
        assert set(v for k, v in params.items() if k.startswith("vessels[")) == {"track-a", "track-b"}
        assert params["start-date"] == "2026-09-10"
        assert params["end-date"] == "2026-10-11"
        if params["offset"] == 0:
            return {"total": 3, "nextOffset": 2, "entries": [event(), event("event-b", "track-b", None)]}
        return {"total": 3, "nextOffset": None, "entries": [event()]}
    async def check():
        service = PortVisitService(token="fake-test-token", fetch=fetch, clock=lambda: NOW)
        a, b = await asyncio.gather(service.lookup(ship()), service.lookup(ship()))
        assert a == b
        assert a["status"] == "ready"
        assert len(a["visits"]) == 2
        assert a["visits"][0]["portName"] == "NEWCASTLE"
        assert any(v["departureAt"] is None for v in a["visits"])
        assert a["matchBasis"] == "mmsi_imo"
        assert len(calls) == 3
        assert "fake-test-token" not in str(a)
    asyncio.run(check())


def test_identity_conflict_and_missing_are_not_empty_history():
    async def check(infos, status):
        async def fetch(path, params):
            assert path == "vessels/search"
            return {"total": len(infos), "entries": [{"selfReportedInfo": infos}]}
        result = await PortVisitService(token="fake", fetch=fetch, clock=lambda: NOW).lookup(ship())
        assert result["status"] == status
    asyncio.run(check([identity(imo="9999999")], "ambiguous"))
    asyncio.run(check([identity(mmsi="440999999")], "not_found"))


def test_bad_events_are_partial_not_a_false_clean_history():
    async def fetch(path, params):
        if path == "vessels/search":
            return {"total": 1, "entries": [{"selfReportedInfo": [identity()]}]}
        wrong = event("wrong", "other-ship")
        backwards = event("backwards", end="2026-10-01T00:00:00Z")
        return {"total": 3, "entries": [event(), wrong, backwards]}
    result = asyncio.run(PortVisitService(token="fake", fetch=fetch, clock=lambda: NOW).lookup(ship()))
    assert result["status"] == "partial"
    assert len(result["visits"]) == 1


@pytest.mark.parametrize("code,status", [(401, "unauthorized"), (403, "forbidden"), (429, "rate_limited"), (503, "unavailable")])
def test_provider_errors_are_safe_and_throttled(code, status):
    calls = []
    async def fetch(*args):
        calls.append(args)
        raise ProviderError(code)
    async def check():
        service = PortVisitService(token="secret", fetch=fetch, clock=lambda: NOW)
        result = await service.lookup(ship())
        assert result["status"] == status
        assert result["visits"] == []
        await service.lookup({**ship(), "mmsi": "440654321"})
        assert len(calls) == 1
        assert "secret" not in str(result)
    asyncio.run(check())


def test_failed_refresh_preserves_old_timestamp_and_marks_stale():
    clock = [NOW]
    async def fetch(path, params):
        if clock[0] > NOW:
            raise OSError("provider detail must not be exposed")
        return {"total": 1, "entries": [{"selfReportedInfo": [identity()]}]} if path == "vessels/search" else {"total": 1, "entries": [event()]}
    async def check():
        service = PortVisitService(token="fake", fetch=fetch, clock=lambda: clock[0])
        first = await service.lookup(ship())
        clock[0] += 3601
        later = await service.lookup(ship())
        assert later["status"] == "stale"
        assert later["fetchedAt"] == first["fetchedAt"]
        assert later["visits"] == first["visits"]
        assert "provider detail" not in str(later)
    asyncio.run(check())


def test_endpoint_only_queries_registered_interests(monkeypatch):
    from fastapi import HTTPException, Response
    from midterm.web import vessels_api
    class Store:
        def registered_member(self, owner, source, mmsi):
            return None
    monkeypatch.setattr(vessels_api, "tracks", Store())
    with pytest.raises(HTTPException) as error:
        asyncio.run(vessels_api.vessel_port_visits(uuid4(), "aisstream", MMSI, Response(), 30))
    assert error.value.status_code == 404


def test_registered_ship_without_live_position_can_query_history(tmp_path, monkeypatch):
    from fastapi import Response
    from midterm.vessels.navigation import TrackStore
    from midterm.web import vessels_api
    store = TrackStore(tmp_path / "tracks.sqlite3")
    owner = uuid4()
    store.sync(str(owner), [{"source": "aisstream", "mmsi": MMSI}])
    class Service:
        async def lookup(self, vessel, days):
            assert vessel["mmsi"] == MMSI
            return {"status": "empty"}
    monkeypatch.setattr(vessels_api, "tracks", store)
    monkeypatch.setattr(vessels_api, "port_visit_service", Service())
    try:
        assert asyncio.run(vessels_api.vessel_port_visits(owner, "aisstream", MMSI, Response(), 30))["status"] == "empty"
    finally:
        store.close()
