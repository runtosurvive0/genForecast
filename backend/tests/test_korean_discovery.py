"""Korean-bound candidates must follow destination reports, never coordinates."""
import asyncio
from uuid import uuid4

import pytest
from fastapi import Response
from midterm.vessels import ais


AT = "2026-10-10T00:00:00Z"


@pytest.fixture
def catalog(monkeypatch):
    monkeypatch.setattr(ais, "utc_now", lambda: AT)
    return ais.AisCatalog(api_key="")


def receive(catalog, destination=None, *, mmsi=440123456, at=AT, position=False):
    kind = "PositionReport" if position else "ShipStaticData"
    report = {"Latitude": -33, "Longitude": 152, "Sog": 12} if position else {"Name": "BUSAN STAR"}
    if destination is not None:
        report["Destination"] = destination
    catalog.ingest({"MessageType": kind, "MetaData": {"MMSI": mmsi}, "Message": {kind: report}}, at)


@pytest.mark.parametrize("destination,code", [
    ("KR PUS", "KRPUS"), ("krpus@@", "KRPUS"), ("BUSAN, KOREA", "KRPUS"),
    ("PUSAN", "KRPUS"), ("DANGJIN", "KRTJI"), ("BORYEONG", "KRBOR"),
    ("SGSIN -> KR TJI", "KRTJI"), ("SINGAPORE TO ULSAN", "KRUSN"),
    ("평택", "KRPTK"), ("DONGHAE", "KRTGH"),
    ("HADONG", "KRHDG"), ("TAEAN", "KRTAN"),
    ("KR MAS", "KRMAS"),
])
def test_destination_codes_aliases_and_explicit_inbound_route(catalog, destination, code):
    receive(catalog, destination)
    receive(catalog, position=True)
    entries = catalog.snapshot().get("koreaCandidates", {}).get("entries", [])
    assert len(entries) == 1
    assert entries[0]["portCode"] == code
    assert entries[0]["vessel"]["ais"]["position"]["latitude"] == -33
    assert entries[0]["destinationObservedAt"] == AT


@pytest.mark.parametrize("destination", [
    "UKRAINE", "KOREA", "KR", "KPPUS", "KRPUS > SGSIN", "BUSAN/SINGAPORE",
    "NOT BUSAN", "BUSAN NORTH KOREA", "BUSAN STAR", "", "@@@@", "UNKNOWN",
    "KRISTIANDSAND", "KRIMPEN AAN DE IJSSE", "NO KRS", "KR KWY",
])
def test_ambiguous_outbound_or_missing_destination_is_not_a_candidate(catalog, destination):
    receive(catalog, destination)
    assert catalog.snapshot().get("koreaCandidates", {}).get("entries") == []


def test_candidate_survives_general_eviction_and_receives_new_position(catalog, monkeypatch):
    monkeypatch.setattr(ais, "MAX_VESSELS", 2)
    receive(catalog, "DANGJIN")
    receive(catalog, position=True)
    receive(catalog, "SINGAPORE", mmsi=440123457)
    receive(catalog, "SINGAPORE", mmsi=440123458)
    result = catalog.snapshot()
    assert len(result["vessels"]) == 2
    assert len(result.get("koreaCandidates", {}).get("entries", [])) == 1
    receive(catalog, position=True, at="2026-10-10T00:01:00Z")
    result = catalog.snapshot()
    entry = result["koreaCandidates"]["entries"][0]
    assert entry["vessel"]["ais"]["destination"] == "DANGJIN"
    assert entry["vessel"]["ais"]["position"]["observedAt"] == "2026-10-10T00:01:00Z"
    assert entry["destinationObservedAt"] == AT


def test_static_freshness_is_independent_from_newer_positions(catalog):
    receive(catalog, position=True, at="2026-10-10T00:05:00Z")
    receive(catalog, "DANGJIN", at="2026-10-10T00:01:00Z")
    receive(catalog, "SINGAPORE", at=AT)  # Out-of-order static must not replace it.
    assert len(catalog.snapshot().get("koreaCandidates", {}).get("entries", [])) == 1
    receive(catalog, "SINGAPORE", at="2026-10-10T00:02:00Z")
    assert catalog.snapshot()["koreaCandidates"]["entries"] == []


@pytest.mark.parametrize("first,last,expected", [
    ("DANGJIN", "SINGAPORE", []), ("SINGAPORE", "DANGJIN", ["KRTJI"]),
])
def test_delayed_destination_ignores_newer_unrelated_static_metadata(catalog, monkeypatch, first, last, expected):
    # Use past upstream timestamps: the live normalizer rejects future metadata.
    received = "2020-01-01T00:03:00Z"
    monkeypatch.setattr(ais, "utc_now", lambda: received)
    for observed, report in [
        ("2020-01-01T00:00:00Z", {"Destination": first}),
        ("2020-01-01T00:02:00Z", {"Name": "NEW NAME", "Type": 80}),
        ("2020-01-01T00:01:00Z", {"Destination": last, "Name": "OLD NAME", "Type": 70}),
    ]:
        catalog.ingest({"MessageType": "ShipStaticData", "MetaData": {"MMSI": 440123456, "time_utc": observed},
                        "Message": {"ShipStaticData": report}}, received)
    snapshot = catalog.snapshot()
    assert [e["portCode"] for e in snapshot["koreaCandidates"]["entries"]] == expected
    row = snapshot["vessels"][0]
    assert row["ais"]["destination"] == last
    assert row["name"] == "NEW NAME"
    assert row["ais"]["shipType"] == 80


def test_explicit_blank_clears_candidate_but_missing_field_does_not(catalog):
    receive(catalog, "DANGJIN")
    receive(catalog, at="2026-10-10T00:01:00Z")
    assert len(catalog.snapshot().get("koreaCandidates", {}).get("entries", [])) == 1
    receive(catalog, "@@@", at="2026-10-10T00:02:00Z")
    assert catalog.snapshot()["koreaCandidates"]["entries"] == []
    assert catalog.snapshot()["vessels"][0]["ais"]["destination"] == ""


def test_position_and_metadata_without_destination_do_not_extend_retention(catalog, monkeypatch):
    receive(catalog, "DANGJIN", at="2026-10-07T00:01:00Z")
    receive(catalog, position=True)
    receive(catalog)  # Static without destination also cannot refresh its age.
    assert len(catalog.snapshot().get("koreaCandidates", {}).get("entries", [])) == 1
    monkeypatch.setattr(ais, "utc_now", lambda: "2026-10-10T00:01:00Z")
    assert catalog.snapshot()["koreaCandidates"]["entries"] == []


def test_candidate_cache_is_bounded_independently(catalog, monkeypatch):
    monkeypatch.setattr(ais, "MAX_KOREA_CANDIDATES", 2, raising=False)
    for mmsi in (440123456, 440123457, 440123458):
        receive(catalog, "DANGJIN", mmsi=mmsi)
    entries = catalog.snapshot().get("koreaCandidates", {}).get("entries", [])
    assert [e["vessel"]["mmsi"] for e in entries] == ["440123458", "440123457"]


def test_register_retained_candidate_seeds_tracking_after_general_eviction(catalog, monkeypatch, tmp_path):
    from midterm.web import vessels_api
    from midterm.vessels.navigation import TrackStore
    monkeypatch.setattr("midterm.vessels.navigation.time.time", lambda: ais.epoch(AT))
    monkeypatch.setattr(ais, "MAX_VESSELS", 1)
    receive(catalog, "DANGJIN")
    receive(catalog, position=True)
    receive(catalog, "SINGAPORE", mmsi=440123457)
    store = TrackStore(tmp_path / "tracks.sqlite3")
    monkeypatch.setattr(vessels_api, "catalog", catalog)
    monkeypatch.setattr(vessels_api, "tracks", store)
    try:
        result = asyncio.run(vessels_api.sync_tracking(uuid4(), vessels_api.TrackingRequest(
            vessels=[{"source": "aisstream", "mmsi": "440123456"}]), Response()))
        assert len(result["vessels"]) == 1
        assert result["vessels"][0]["ais"]["position"]["longitude"] == 152
    finally:
        store.close()
