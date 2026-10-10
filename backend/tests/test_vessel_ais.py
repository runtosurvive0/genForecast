import json

from midterm.vessels.ais import AisCatalog
from midterm.vessels.digitraffic import normalize_digitraffic


def test_default_subscription_covers_overseas_origins_not_only_korea(monkeypatch):
    monkeypatch.delenv("AISSTREAM_BOUNDING_BOXES", raising=False)
    catalog = AisCatalog(api_key="")
    for lat, lon in [(-33, 152), (-1, 117), (-34, 18), (35, 126), (0, -130)]:
        assert any(min(a[0], b[0]) <= lat <= max(a[0], b[0]) and
                   min(a[1], b[1]) <= lon <= max(a[1], b[1]) for a, b in catalog.boxes)
    assert "전 세계" in catalog.snapshot()["coverage"]
    monkeypatch.setenv("AISSTREAM_BOUNDING_BOXES", "[[[30,120],[40,135]]]")
    regional = AisCatalog(api_key="")
    assert regional.boxes == [[[30, 120], [40, 135]]]
    assert "서버 지정" in regional.snapshot()["coverage"]


def message(kind, report, name="TEST CARGO"):
    return {"MessageType": kind, "MetaData": {"MMSI": 440123456, "ShipName": name},
            "Message": {kind: {"UserID": 440123456, "Valid": True, **report}}}


def test_catalog_keeps_20000_vessels_and_evicts_least_recently_received():
    catalog = AisCatalog(api_key="")
    def receive(index):
        payload = message("PositionReport", {"Latitude": 35, "Longitude": 125})
        payload["MetaData"]["MMSI"] = 440000000 + index
        catalog.ingest(payload, "2026-10-09T00:00:00Z")
    for index in range(20000):
        receive(index)
    assert catalog.snapshot()["capacity"] == 20000
    assert len(catalog.snapshot()["vessels"]) == 20000
    receive(0)
    receive(20000)
    rows = catalog.snapshot()["vessels"]
    assert len(rows) == 20000
    assert rows[0]["mmsi"] == "440020000"
    assert any(row["mmsi"] == "440000000" for row in rows)
    assert not any(row["mmsi"] == "440000001" for row in rows)


def test_static_metadata_does_not_fabricate_or_refresh_position():
    catalog = AisCatalog(api_key="")
    catalog.ingest(message("ShipStaticData", {"ImoNumber": 1234567, "Type": 70, "Destination": "DANGJIN"}), "2026-10-09T00:00:00Z")
    ship = catalog.snapshot()["vessels"][0]
    assert ship["ais"]["position"] is None
    assert ship["imo"] == "1234567"
    catalog.ingest(message("PositionReport", {"Latitude": 35, "Longitude": 125, "Sog": 11.5, "Cog": 90, "NavigationalStatus": 0}), "2026-10-09T00:01:00Z")
    catalog.ingest(message("ShipStaticData", {"Type": 70}), "2026-10-09T00:02:00Z")
    ship = catalog.snapshot()["vessels"][0]
    assert ship["ais"]["position"]["observedAt"] == "2026-10-09T00:01:00Z"
    assert ship["ais"]["position"]["sogKn"] == 11.5
    assert ship["ais"]["destination"] == "DANGJIN"


def test_invalid_positions_and_ais_sentinels_are_not_operational_values():
    catalog = AisCatalog(api_key="")
    catalog.ingest(message("PositionReport", {"Latitude": 91, "Longitude": 181}), "2026-10-09T00:00:00Z")
    assert not catalog.snapshot()["vessels"]
    catalog.ingest(message("PositionReport", {"Latitude": 35, "Longitude": 125, "Sog": 102.3, "Cog": 360}), "2026-10-09T00:01:00Z")
    pos = catalog.snapshot()["vessels"][0]["ais"]["position"]
    assert pos["sogKn"] is None and pos["cogDeg"] is None
    assert catalog.snapshot()["vessels"][0]["source"] == "aisstream"


def test_unconfigured_catalog_is_explicit_and_never_exposes_credentials():
    catalog = AisCatalog(api_key="")
    assert catalog.snapshot()["status"] == "not_configured"
    secret_catalog = AisCatalog(api_key="do-not-expose-this-value")
    assert "do-not-expose" not in json.dumps(secret_catalog.snapshot())


def test_out_of_order_reports_do_not_move_vessel_backwards_in_time():
    catalog = AisCatalog(api_key="")
    catalog.ingest(message("PositionReport", {"Latitude": 35, "Longitude": 125}), "2026-10-09T00:02:00Z")
    catalog.ingest(message("PositionReport", {"Latitude": 34, "Longitude": 124}), "2026-10-09T00:01:00Z")
    assert catalog.snapshot()["vessels"][0]["ais"]["position"]["latitude"] == 35
    catalog.ingest(message("PositionReport", {"Latitude": 36, "Longitude": 125}), "2026-10-09T00:02:00.100000Z")
    assert catalog.snapshot()["vessels"][0]["ais"]["position"]["latitude"] == 36


def test_public_provider_coalesces_requests_and_preserves_last_snapshot_on_error(monkeypatch):
    import asyncio
    from midterm.vessels import digitraffic
    calls = []
    def fetch(resource):
        calls.append(resource)
        return [] if resource == "vessels" else {"features": []}
    monkeypatch.setattr(digitraffic, "fetch_json", fetch)
    async def check():
        catalog = digitraffic.DigitrafficCatalog()
        results = await asyncio.gather(catalog.snapshot(), catalog.snapshot())
        assert results[0]["status"] == "snapshot"
        assert len(calls) == 2
        fetched_at = results[0]["fetchedAt"]
        catalog._attempt_at -= 61
        def fail(resource):
            raise OSError("upstream failed")
        monkeypatch.setattr(digitraffic, "fetch_json", fail)
        old = await catalog.snapshot()
        assert old["status"] == "cached_error"
        assert old["fetchedAt"] == fetched_at
    asyncio.run(check())


def test_digitraffic_joins_by_mmsi_and_uses_external_milliseconds_not_ais_seconds():
    rows = normalize_digitraffic([
        {"mmsi": 230123456, "name": "TEST", "imo": 0, "shipType": 70, "timestamp": 1791500000000},
    ], {"features": [{"properties": {"mmsi": 230123456, "timestamp": 55,
        "timestampExternal": 1791502974413, "sog": 102.3, "navStat": 5},
        "geometry": {"type": "Point", "coordinates": [19.5, 59.1]}}]})
    assert len(rows) == 1
    assert rows[0]["source"] == "digitraffic"
    assert rows[0]["imo"] == ""
    assert rows[0]["ais"]["shipType"] == 70
    assert rows[0]["ais"]["position"]["latitude"] == 59.1
    assert rows[0]["ais"]["position"]["observedAt"] == "2026-10-08T23:42:54.413000Z"
    assert rows[0]["ais"]["position"]["sogKn"] is None
