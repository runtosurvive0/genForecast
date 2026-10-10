"""Cached GDACS tropical cyclone context, not a navigation warning service."""
import asyncio
from datetime import datetime, timezone
import json
import re
import time
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

from midterm.vessels.weather import finite, iso

ROOT = "https://www.gdacs.org/gdacsapi/"
FEED = "api/Events/geteventlist/EVENTS4APP"


def fetch_json(path):
    # Paths are built here, never taken from a client or followed from provider HTML.
    with urlopen(Request(ROOT + path, headers={"Accept": "application/json", "User-Agent": "genForecast-POC/1.0"}), timeout=8) as response:
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("Cyclone response too large")
        return json.loads(body)


def number(value, low, high):
    try:
        n = float(value)
        return n if finite(n) and low <= n <= high else None
    except (ValueError, TypeError):
        return None


def parse_timeline(event, data):
    p = event["properties"]
    rows = data.get("channel", {}).get("item", [])
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValueError("Invalid cyclone timeline")
    current = next((r for r in rows if str(r.get("current")).lower() == "true" and str(r.get("actual")).lower() == "true"), None)
    if current is None:
        raise ValueError("No current advisory")

    def at(row):
        return datetime.strptime(row["advisory_datetime"], "%d %b %Y %H:%M").replace(tzinfo=timezone.utc).timestamp()

    advisory = at(current)
    points = {}
    for row in rows:
        if str(row.get("storm_id")) != str(p["eventid"]):
            continue
        actual = str(row.get("actual")).lower()
        if actual not in ("true", "false"):
            continue
        forecast = actual == "false"
        if forecast and row.get("advisory_number") != current.get("advisory_number"):
            continue
        try:
            valid_at = at(row)
        except (ValueError, KeyError, TypeError):
            continue
        if not advisory - 24*3600 <= valid_at <= advisory + 7*86400 or (forecast and valid_at <= advisory):
            continue
        lon, lat = number(row.get("longitude"), -180, 180), number(row.get("latitude"), -85, 85)
        if lon is None or lat is None:
            continue
        points[valid_at] = {"at": iso(valid_at), "longitude": lon, "latitude": lat, "forecast": forecast,
            "radii34Nm": [number(row.get("windrad_nm_34kt_" + quadrant), 0, 1000) for quadrant in ("ne", "se", "sw", "nw")]}
    if not points:
        raise ValueError("No valid cyclone points")
    return {"id": str(p["eventid"]), "name": str(p.get("eventname", "Tropical cyclone"))[:100],
        "source": str(p.get("source", "GDACS"))[:60], "advisoryAt": iso(advisory),
        "reportUrl": f"https://www.gdacs.org/report.aspx?eventtype=TC&eventid={int(p['eventid'])}",
        "points": [points[k] for k in sorted(points)]}


class CycloneService:
    def __init__(self, fetch=None, clock=time.time):
        self.fetch, self.clock = fetch, clock
        self.lock = asyncio.Lock()
        self.cached = None
        self.retry_after = 0

    async def _get(self, path):
        return await self.fetch(path) if self.fetch else await asyncio.to_thread(fetch_json, path)

    async def _storm(self, event):
        p = event["properties"]
        event_id = int(p["eventid"])
        details = await self._get(f"api/events/geteventdata?eventtype=TC&eventid={event_id}")
        resource = next((v for v in details.get("properties", {}).get("impacts", []) if v.get("source") == p.get("source") and v.get("resource", {}).get("timeline")), None)
        if resource is None:
            raise ValueError("No cyclone timeline resource")
        url = urlparse(resource["resource"]["timeline"])
        timeline_id = parse_qs(url.query).get("id", [""])[0]
        if url.hostname != "www.gdacs.org" or not re.fullmatch(r"\d{1,12}", timeline_id):
            raise ValueError("Invalid timeline reference")
        return parse_timeline(event, await self._get(f"api/export/gettimeline?id={timeline_id}"))

    async def snapshot(self):
        async with self.lock:
            now = self.clock()
            if self.cached and 0 <= now - self.cached[0] < 1800:
                return self.cached[1]
            if now >= self.retry_after:
                try:
                    feed = await self._get(FEED)
                    if feed.get("type") != "FeatureCollection" or not isinstance(feed.get("features"), list):
                        raise ValueError("Invalid cyclone feed")
                    events = [f for f in feed["features"] if f.get("properties", {}).get("eventtype") == "TC"
                              and str(f["properties"].get("iscurrent")).lower() == "true"]
                    semaphore = asyncio.Semaphore(4)
                    async def one(event):
                        async with semaphore:
                            return await self._storm(event)
                    rows = await asyncio.wait_for(asyncio.gather(*(one(e) for e in events[:16]), return_exceptions=True), timeout=35)
                    storms = [r for r in rows if isinstance(r, dict)]
                    if events and not storms:
                        raise ValueError("All cyclone timelines unavailable")
                    incomplete = len(storms) != len(events)
                    result = {"status": "partial" if incomplete else "ready", "fetchedAt": iso(now), "storms": storms,
                        "reason": "GDACS 최근 4일·최대 100개 재난 목록의 열대저기압 · 전 세계 완전성 보장 없음" + (" · 일부 태풍 상세 조회 실패" if incomplete else "")}
                    self.cached = (now, result)
                    return result
                except Exception:
                    self.retry_after = now + 60
            if self.cached and 0 <= now - self.cached[0] <= 6*3600:
                return {**self.cached[1], "status": "stale", "reason": "태풍 갱신 실패 · 이전 조회 자료이며 최신 경보가 아닙니다."}
            return {"status": "unavailable", "fetchedAt": None, "storms": [], "reason": "태풍 자료 조회 불가 · 태풍 없음으로 해석하지 않습니다."}
