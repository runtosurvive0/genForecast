"""Synthetic provider-shaped fixtures; never actual navigation information."""
import asyncio
from copy import deepcopy

from midterm.vessels.cyclones import CycloneService, parse_timeline

NOW = 1791547200  # 2026-10-09 12:00 UTC
EVENT = {"properties": {"eventtype": "TC", "eventid": 123, "episodeid": 2,
    "eventname": "TEST ONLY", "source": "JTWC", "iscurrent": "true"}}
ROW = {"storm_id": "123", "advisory_number": "2", "advisory_datetime": "09 Oct 2026 12:00",
       "actual": "True", "current": "true", "longitude": "125", "latitude": "35",
       **{f"windrad_nm_34kt_{q}": str(v) for q, v in zip(["ne", "se", "sw", "nw"], [90, 80, 60, 70])}}


def timeline():
    return {"channel": {"item": [ROW, {**ROW, "actual": "False", "current": "false",
            "advisory_datetime": "10 Oct 2026 00:00", "longitude": "126"}]}}


def test_timeline_uses_valid_times_and_preserves_quadrant_radii():
    result = parse_timeline(EVENT, timeline())
    assert result["advisoryAt"] == "2026-10-09T12:00:00Z"
    assert result["points"][1]["at"] == "2026-10-10T00:00:00Z"
    assert result["points"][1]["forecast"] is True
    assert result["points"][0]["radii34Nm"] == [90, 80, 60, 70]
    broken = timeline()
    broken["channel"]["item"][1]["windrad_nm_34kt_ne"] = "bad"
    assert parse_timeline(EVENT, broken)["points"][1]["radii34Nm"][0] is None
    broken["channel"]["item"][1]["longitude"] = "181"
    assert len(parse_timeline(EVENT, broken)["points"]) == 1
    # An old advisory's forecasts must not sneak into the newest forecast track.
    old = deepcopy(ROW)
    old.update(actual="False", current="false", advisory_number="1", advisory_datetime="10 Oct 2026 06:00")
    data = timeline(); data["channel"]["item"].append(old)
    assert len(parse_timeline(EVENT, data)["points"]) == 2


def test_service_coalesces_calls_and_expires_old_cache_without_claiming_no_storms():
    calls = []
    fail = [False]
    async def fetch(path):
        calls.append(path)
        if fail[0]:
            raise OSError("upstream offline")
        if "EVENTS4APP" in path:
            return {"type": "FeatureCollection", "features": [EVENT]}
        if "geteventdata" in path:
            return {"type": "Feature", "properties": {"impacts": [{"source": "JTWC", "resource": {"timeline": "https://www.gdacs.org/gdacsapi/api/export/gettimeline?id=42"}}]}}
        return timeline()
    async def check():
        clock = [NOW]
        service = CycloneService(fetch=fetch, clock=lambda: clock[0])
        a, b = await asyncio.gather(service.snapshot(), service.snapshot())
        assert a["status"] == b["status"] == "ready"
        assert len(calls) == 3
        fail[0] = True; clock[0] += 1801
        stale = await service.snapshot()
        assert stale["status"] == "stale" and len(stale["storms"]) == 1
        assert stale["fetchedAt"] == a["fetchedAt"]
        clock[0] += 6 * 3600
        unavailable = await service.snapshot()
        assert unavailable["status"] == "unavailable" and not unavailable["storms"]
    asyncio.run(check())
