"""Optional no-key Finnish AIS discovery, never a fallback for Korean coverage."""
import asyncio
from datetime import datetime, timezone
import gzip
import json
import time
from urllib.request import Request, urlopen

from midterm.vessels.ais import AisCatalog, MAX_VESSELS, utc_now


def milliseconds(value):
    if not isinstance(value, (float, int)) or isinstance(value, bool):
        return None
    try:
        parsed = datetime.fromtimestamp(value / 1000, timezone.utc)
        if not 2000 <= parsed.year <= 2100:
            return None
        return parsed.isoformat().replace("+00:00", "Z")
    except (ValueError, OverflowError, OSError):
        return None


def normalize_digitraffic(metadata, locations):
    if not isinstance(metadata, list) or not isinstance(locations, dict) or not isinstance(locations.get("features"), list):
        raise ValueError("Invalid Digitraffic response")
    collector = AisCatalog(api_key="")
    for ship in metadata:
        if not isinstance(ship, dict):
            continue
        at = milliseconds(ship.get("timestamp"))
        if at is None:
            continue
        collector.ingest({"MessageType": "ShipStaticData", "MetaData": {"MMSI": ship.get("mmsi"), "ShipName": ship.get("name")},
                          "Message": {"ShipStaticData": {"ImoNumber": ship.get("imo"), "Type": ship.get("shipType", ship.get("type")),
                                                          "Destination": ship.get("destination")}}}, at)
    for feature in locations["features"]:
        if not isinstance(feature, dict):
            continue
        p, geometry = feature.get("properties"), feature.get("geometry")
        if not isinstance(p, dict) or not isinstance(geometry, dict):
            continue
        coords = geometry.get("coordinates")
        at = milliseconds(p.get("timestampExternal"))
        if geometry.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2 or at is None:
            continue
        collector.ingest({"MessageType": "PositionReport", "MetaData": {"MMSI": p.get("mmsi", feature.get("mmsi"))},
                          "Message": {"PositionReport": {"Longitude": coords[0], "Latitude": coords[1],
                                                          "Sog": p.get("sog"), "Cog": p.get("cog"), "NavigationalStatus": p.get("navStat")}}}, at)
    rows = collector.snapshot()["vessels"]
    for row in rows:
        row["source"] = "digitraffic"
        row["id"] = f"digitraffic-{row['mmsi']}"
    return rows


def fetch_json(resource):
    request = Request(f"https://meri.digitraffic.fi/api/ais/v1/{resource}", headers={
        "Accept": "application/json", "Accept-Encoding": "gzip", "Digitraffic-User": "genForecast/1.0"})
    with urlopen(request, timeout=8) as response:
        body = response.read(12_000_001)
        if len(body) > 12_000_000:
            raise ValueError("Response too large")
        if response.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return json.loads(body)


class DigitrafficCatalog:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._snapshot = None
        self._attempt_at = -float("inf")

    async def snapshot(self):
        async with self._lock:
            if time.monotonic() - self._attempt_at < 60 and self._snapshot:
                return self._snapshot
            self._attempt_at = time.monotonic()
            try:
                metadata, locations = await asyncio.gather(
                    asyncio.to_thread(fetch_json, "vessels"), asyncio.to_thread(fetch_json, "locations"))
                vessels = normalize_digitraffic(metadata, locations)
                self._snapshot = {"provider": "digitraffic", "status": "snapshot", "coverage": "핀란드 해역 · 공개 AIS (한국 해역 아님)",
                                  "vessels": vessels, "capacity": MAX_VESSELS, "fetchedAt": utc_now(),
                                  "lastReceivedAt": max((v["ais"]["position"]["observedAt"] for v in vessels if v["ais"]["position"]), default=None)}
            except Exception:
                if self._snapshot:
                    self._snapshot = {**self._snapshot, "status": "cached_error"}
                else:
                    self._snapshot = {"provider": "digitraffic", "status": "unavailable", "coverage": "핀란드 해역 · 공개 AIS (한국 해역 아님)",
                                      "vessels": [], "capacity": MAX_VESSELS, "fetchedAt": utc_now(), "lastReceivedAt": None}
            return self._snapshot
