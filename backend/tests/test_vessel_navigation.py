import pytest
from midterm.vessels.navigation import TrackStore, SeaRouter, epoch
from midterm.vessels.ais import AisCatalog


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr("midterm.vessels.navigation.time.time", lambda: epoch("2026-10-09T12:00:00Z"))


def ship(at, lon=125, lat=35):
    return {"id": "ais-440123456", "name": "TEST BULK", "imo": "", "mmsi": "440123456", "source": "aisstream",
            "ais": {"updatedAt": at, "destination": "DANGJIN", "shipType": 70, "navStatus": 0,
                    "position": {"longitude": lon, "latitude": lat, "observedAt": at, "sogKn": 12, "cogDeg": 0}}}


def test_tracking_survives_restart_and_owner_removal_does_not_remove_other_owner(tmp_path):
    path = tmp_path / "tracks.sqlite3"
    store = TrackStore(path)
    members = [{"mmsi": "440123456", "source": "aisstream"}]
    store.sync("a", members)
    store.sync("b", members)
    store.record(ship("2026-10-09T00:00:00Z"))
    store.record(ship("2026-10-09T00:00:00Z"))
    store.record(ship("2026-10-09T00:01:00Z", 125.001))
    store.sync("a", [])
    store.close()
    store = TrackStore(path)
    assert ("aisstream", "440123456") in store.active
    result = store.history("b", "aisstream", "440123456", 720, now=1791504000)
    assert len(result["segments"]) == 1 and len(result["segments"][0]) == 2
    assert result["vessel"]["ais"]["position"]["longitude"] == 125.001
    with pytest.raises(KeyError):
        store.history("a", "aisstream", "440123456", 24)
    store.sync("b", [])
    assert not store.active
    store.close()


def test_history_does_not_join_gaps_or_impossible_jumps(tmp_path):
    store = TrackStore(tmp_path / "tracks.db")
    store.sync("a", [{"mmsi": "440123456", "source": "aisstream"}])
    for value in [ship("2026-10-09T00:00:00Z"), ship("2026-10-09T00:05:00Z", 125.01),
                  ship("2026-10-09T10:00:00Z", 126), ship("2026-10-09T10:01:00Z", -80),
                  ship("2026-10-09T09:59:00Z", 127)]:
        store.record(value)
    result = store.history("a", "aisstream", "440123456", 720, now=1791543600)
    assert len(result["segments"]) == 2
    assert result["vessel"]["ais"]["position"]["longitude"] == 126
    assert result["pointCount"] == 3
    store.close()


def test_catalog_retains_registered_positions_outside_discovery_cache(tmp_path):
    store = TrackStore(tmp_path / "tracks.db")
    store.sync("a", [{"mmsi": "440123456", "source": "aisstream"}])
    catalog = AisCatalog(api_key="", on_observation=store.record)
    catalog.ingest({"MessageType": "PositionReport", "MetaData": {"MMSI": 440123456},
                    "Message": {"PositionReport": {"Latitude": 35, "Longitude": 125}}}, "2026-10-09T00:00:00Z")
    catalog._rows.clear()
    assert store.latest("a")[0]["mmsi"] == "440123456"
    store.close()


@pytest.mark.parametrize('restart', [False, True])
def test_position_after_eviction_or_restart_preserves_static_metadata(tmp_path, restart):
    path = tmp_path / 'metadata.db'
    store = TrackStore(path)
    store.sync('a', [{'mmsi': '440123456', 'source': 'aisstream'}])
    def catalog_for_store():
        catalog = AisCatalog(api_key='', on_observation=store.record)
        catalog.lookup_observation = lambda mmsi: store.active_observation('aisstream', mmsi)
        return catalog
    def ingest(catalog, kind, report, at):
        catalog.ingest({'MessageType': kind, 'MetaData': {'MMSI': 440123456},
                        'Message': {kind: report}}, at)
    catalog = catalog_for_store()
    ingest(catalog, 'ShipStaticData', {'ImoNumber': 9459101, 'Type': 70, 'Destination': 'SGSIN'}, '2026-10-09T00:00:00Z')
    if restart:
        store.close()
        store = TrackStore(path)
        catalog = catalog_for_store()
    else:
        catalog._rows.clear()
        catalog._static_at.clear()
        catalog._destination_at.clear()
    ingest(catalog, 'PositionReport', {'Latitude': 35, 'Longitude': 125, 'Sog': 12}, '2026-10-09T00:10:00Z')
    saved = store.latest('a')[0]
    assert saved['ais']['destination'] == 'SGSIN'
    assert saved['imo'] == '9459101'
    assert saved['ais']['shipType'] == 70
    # Stale static data cannot overwrite the restored metadata.
    ingest(catalog, 'ShipStaticData', {'ImoNumber': 1234567, 'Destination': 'KRPUS'}, '2026-10-08T23:59:00Z')
    assert store.latest('a')[0]['ais']['destination'] == 'SGSIN'
    # An explicitly received blank destination IS a real update, unlike absent fields.
    ingest(catalog, 'ShipStaticData', {'Destination': ''}, '2026-10-09T00:11:00Z')
    saved = store.latest('a')[0]
    assert saved['ais']['destination'] == ''
    assert saved['imo'] == '9459101'
    assert saved['ais']['position']['observedAt'] == '2026-10-09T00:10:00Z'
    store.sync('a', [])
    assert store.active_observation('aisstream', '440123456') is None
    store.close()


def test_sea_route_uses_ocean_network_and_caches_without_mutable_aliases():
    router = SeaRouter()
    route = router.route(151.8, -32.9, "dangjin")
    assert route["kind"] == "estimated"
    assert route["distanceNm"] > 3000
    assert len(route["coordinates"]) > 5
    assert route["destinationId"] == "dangjin"
    route["coordinates"].clear()
    assert len(router.route(151.8, -32.9, "dangjin")["coordinates"]) > 5
    with pytest.raises(ValueError):
        router.route(181, 35, "dangjin")
    with pytest.raises(ValueError):
        router.route(125, 35, "unknown")


def test_retention_source_isolation_and_future_observation_rejection(tmp_path):
    store = TrackStore(tmp_path / "tracks.db")
    store.sync("a", [{"mmsi": "440123456", "source": "aisstream"}])
    store.record(ship("2026-09-01T00:00:00Z"))
    store.record(ship("2026-10-09T11:00:00Z"))
    store.record(ship("2026-10-10T00:00:00Z", 126))
    foreign = ship("2026-10-09T11:05:00Z", 126)
    foreign["source"] = "digitraffic"
    store.record(foreign)
    result = store.history("a", "aisstream", "440123456", 720)
    assert result["pointCount"] == 1
    assert result["vessel"]["ais"]["position"]["longitude"] == 125
    store.close()


def test_navigation_http_validation_membership_and_lifespan_restart(tmp_path, monkeypatch):
    import asyncio
    import json
    from fastapi import FastAPI
    from midterm.web import vessels_api as api
    monkeypatch.setenv("AIS_TRACK_DB", str(tmp_path / "api.sqlite3"))
    monkeypatch.setenv("AISSTREAM_API_KEY", "")
    starts = []
    monkeypatch.setattr(AisCatalog, "start", lambda self: starts.append(True))
    app = FastAPI()
    app.include_router(api.router)
    owner = "00000000-0000-4000-8000-000000000001"

    async def request(method, path, body=None, query=""):
        sent = []
        async def receive():
            return {"type": "http.request", "body": json.dumps(body).encode() if body else b"", "more_body": False}
        async def send(message):
            sent.append(message)
        await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
                   "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": query.encode(),
                   "headers": [(b"content-type", b"application/json")], "client": ("127.0.0.1", 1), "server": ("test", 80)}, receive, send)
        return sent[0]["status"], json.loads(b"".join(m.get("body", b"") for m in sent))

    async def run():
        async with app.router.lifespan_context(app):
            path = f"/api/vessels/tracking/{owner}"
            assert (await request("PUT", path, {"vessels": [{"mmsi": "invalid", "source": "aisstream"}]}))[0] == 422
            assert (await request("GET", "/api/vessels/route", query="longitude=125&latitude=35"))[0] == 422
            assert (await request("PUT", path, {"vessels": [{"mmsi": "440123456", "source": "aisstream"}]}))[0] == 200
            api.tracks.record(ship("2026-10-09T11:00:00Z"))
            assert (await request("GET", path))[1]["vessels"][0]["mmsi"] == "440123456"
            assert (await request("GET", path + "/aisstream/440123456", query="hours=24"))[1]["pointCount"] == 1
            assert (await request("GET", path + "/digitraffic/440123456"))[0] == 404
            assert (await request("GET", path + "/aisstream/440123456", query="hours=10"))[0] == 422
            assert (await request("GET", "/api/vessels/route", query="longitude=151.8&latitude=-32.9&destination=dangjin"))[1]["kind"] == "estimated"
            resolved = await request("POST", "/api/vessels/destinations/resolve", {"destinations": ["KR PUS", "SGSIN", "UNKNOWN"]})
            assert resolved[0] == 200
            assert [r['status'] for r in resolved[1]['destinations']] == ['resolved', 'resolved', 'unresolved']
            assert (await request("POST", "/api/vessels/destinations/resolve", {"destinations": ['x' * 101]}))[0] == 422
            assert (await request("POST", "/api/vessels/destinations/resolve", {"destinations": ['KR PUS'] * 201}))[0] == 422
            assert (await request("GET", "/api/vessels/route", query="longitude=125&latitude=35&destination=port:SGSIN"))[1]['destinationId'] == 'port:SGSIN'
            assert (await request("GET", "/api/vessels/route", query="longitude=125&latitude=35&destination=port:XXXXX"))[0] == 422
            weather_path = f'/api/vessels/weather/{owner}/aisstream/440123456'
            assert (await request("GET", weather_path, query='destination=port:XXXXX'))[0] == 422
            async def forecast(vessel, destination):
                return {'destinationId': destination}
            monkeypatch.setattr(api.weather_service, 'forecast', forecast)
            assert (await request("GET", weather_path, query='destination=port:SGSIN'))[1]['destinationId'] == 'port:SGSIN'
        starts.clear()
        async with app.router.lifespan_context(app):
            assert starts, "Persisted subscriptions resume without a browser request"
            assert (await request("GET", path))[1]["vessels"][0]["name"] == "TEST BULK"
    asyncio.run(run())
