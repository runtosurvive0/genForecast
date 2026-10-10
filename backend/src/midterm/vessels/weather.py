"""Forecast exposure for confirmed watchlist routes; never a speed/ETA correction."""
import asyncio
from collections import OrderedDict, deque
from datetime import datetime, timezone
import json
from math import ceil, cos, isfinite, radians
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from midterm.vessels.navigation import distance_nm, epoch

VARIABLES = {
    "air": {"wind_speed_10m": ("windKn", "kn"), "wind_gusts_10m": ("gustKn", "kn"), "wind_direction_10m": ("windFromDeg", "°"), "visibility": ("visibilityM", "m")},
    "marine": {"wave_height": ("waveM", "m"), "wave_direction": ("waveFromDeg", "°"), "wave_period": ("wavePeriodS", "s")},
}
HOUR = 3600
TTL = 3 * HOUR


def iso(at):
    return datetime.fromtimestamp(at, timezone.utc).isoformat().replace("+00:00", "Z")


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value)


def wrap(lon):
    return (lon + 180) % 360 - 180


def sample_route(route, current, speed, observed):
    """Sample the remaining polyline, carrying observed-time distances across the dateline."""
    coords = route["coordinates"]
    lengths = [distance_nm(a, b) for a, b in zip(coords, coords[1:])]
    total = sum(lengths)
    if total <= 0 or not finite(route["distanceNm"]) or route["distanceNm"] <= 0:
        raise ValueError("예상 항로 거리를 확인해 주세요.")
    nearest, progress, traversed = float("inf"), 0, 0
    for a, b, length in zip(coords, coords[1:], lengths):
        scale = cos(radians((a[1] + b[1]) / 2))
        x, y = wrap(b[0] - a[0]) * scale, b[1] - a[1]
        px, py = wrap(current[0] - a[0]) * scale, current[1] - a[1]
        t = max(0, min(1, (px*x + py*y) / (x*x+y*y))) if x*x+y*y else 0
        separation = distance_nm(current, [wrap(a[0] + wrap(b[0]-a[0])*t), a[1]+y*t])
        if separation < nearest:
            nearest, progress = separation, traversed + length*t
        traversed += length
    if nearest > 5 or route["startOffsetNm"] > 5 or route["endOffsetNm"] > 20:
        raise ValueError("관측 위치·목적항과 항로망의 차이가 커서 통과 예보를 보류합니다.")
    if distance_nm(current, route["origin"]) < .1:
        progress = 0
    remaining = route["distanceNm"] * (1-progress/total)
    hours = min(72, remaining / speed)
    if hours <= 0:
        raise ValueError("입항 여부와 최신 위치를 확인해 주세요.")
    count = min(12, max(2, ceil(hours/6)+1))
    points = []
    for i in range(count):
        elapsed = hours*i/(count-1)
        target = progress + elapsed*speed/route["distanceNm"]*total
        before = 0
        for a, b, length in zip(coords, coords[1:], lengths):
            if target <= before + length + 1e-8:
                t = max(0, min(1, (target-before)/length)) if length else 0
                points.append({"longitude": wrap(a[0]+wrap(b[0]-a[0])*t), "latitude": a[1]+(b[1]-a[1])*t,
                               "passageAt": observed + elapsed*HOUR})
                break
            before += length
    return points


def match_hour(series, at, field):
    hourly = series.get("hourly", {})
    times = hourly.get("time", [])
    if not times or at < times[0] or at > times[-1]:
        return None
    index = min(range(len(times)), key=lambda i: abs(times[i]-at))
    values = hourly.get(field, [])
    value = values[index] if index < len(values) and abs(times[index]-at) <= 1800 else None
    return value if finite(value) and value >= 0 and ("direction" not in field or value <= 360) else None


def fetch_provider(kind, coordinates):
    host = "marine-api.open-meteo.com/v1/marine" if kind == "marine" else "api.open-meteo.com/v1/forecast"
    params = {"longitude": ",".join(str(p[0]) for p in coordinates), "latitude": ",".join(str(p[1]) for p in coordinates),
              "hourly": ",".join(VARIABLES[kind]), "timezone": "GMT", "timeformat": "unixtime", "forecast_days": 7, "past_days": 1}
    if kind == "air":
        params.update(wind_speed_unit="kn", cell_selection="nearest")
    else:
        params["cell_selection"] = "sea"
    request = Request("https://" + host + "?" + urlencode(params), headers={"Accept": "application/json", "User-Agent": "genForecast-weather-POC/1.0"})
    with urlopen(request, timeout=12) as response:
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("Forecast response too large")
        value = json.loads(body)
    return value if isinstance(value, list) else [value]


class WeatherService:
    def __init__(self, router, fetch=None, clock=time.time):
        self.router, self.fetch, self.clock = router, fetch, clock
        self.cache = OrderedDict()
        self.routes = OrderedDict()
        self.lock = asyncio.Lock()
        self.retry_after = {}
        self.calls = deque()

    def _reserve(self, count, now):
        while self.calls and self.calls[0][0] <= now - 30*86400:
            self.calls.popleft()
        for interval, limit in [(60, 300), (3600, 2000), (86400, 9000), (30*86400, 250000)]:
            if sum(n for at, n in self.calls if at > now-interval) + count > limit:
                return False
        self.calls.append((now, count))
        return True

    async def _series(self, kind, grids):
        # One lock also coalesces concurrent ships asking for the same forecast grid.
        async with self.lock:
            now = self.clock()
            missing = [p for p in dict.fromkeys(grids) if (kind, *p) not in self.cache or now-self.cache[(kind, *p)][0] >= TTL]
            limited = False
            if missing and now >= self.retry_after.get(kind, 0):
                limited = not self._reserve(len(missing), now)
                if not limited:
                    try:
                        rows = await self.fetch(kind, missing) if self.fetch else await asyncio.to_thread(fetch_provider, kind, missing)
                        if not isinstance(rows, list) or len(rows) != len(missing):
                            raise ValueError("Forecast coordinate count mismatch")
                        for row in rows:
                            times = row.get("hourly", {}).get("time", [])
                            if not times or len(times) > 240 or not all(finite(t) for t in times) or any(a >= b for a, b in zip(times, times[1:])):
                                raise ValueError("Invalid forecast timeline")
                            for field, (_, unit) in VARIABLES[kind].items():
                                if row.get("hourly_units", {}).get(field) != unit or len(row["hourly"].get(field, [])) != len(times):
                                    if field == "visibility":
                                        row["hourly"][field] = [None] * len(times)
                                        continue
                                    raise ValueError("Invalid forecast units or length")
                        for grid, row in zip(missing, rows):
                            self.cache[(kind, *grid)] = (now, row)
                            self.cache.move_to_end((kind, *grid))
                        while len(self.cache) > 1024:
                            self.cache.popitem(last=False)
                    except Exception:
                        self.retry_after[kind] = now+60
            results = []
            for grid in grids:
                cached = self.cache.get((kind, *grid))
                if cached and now-cached[0] <= 6*HOUR:
                    results.append((cached[1], cached[0], "fresh" if now-cached[0] < TTL else "stale"))
                else:
                    results.append(({}, None, "limited" if limited else "missing"))
            return results

    async def forecast(self, vessel, destination):
        now = self.clock()
        base = {"source": vessel["source"], "mmsi": vessel["mmsi"], "destinationId": destination,
                "status": "blocked", "reason": "", "fetchedAt": iso(now), "observedAt": None, "speedKn": None, "horizonHours": 72, "points": []}
        try:
            ais = vessel.get("ais", {})
            p = ais.get("position") or {}
            observed = epoch(p["observedAt"])
            speed, current = p["sogKn"], [p["longitude"], p["latitude"]]
            base["observedAt"] = p["observedAt"]
            if not all(finite(v) for v in [speed, *current]) or not (-180 <= current[0] <= 180 and -85 <= current[1] <= 85):
                raise ValueError("유효한 AIS 위치·속도가 필요합니다.")
            max_speed = 40 if 70 <= (ais.get("shipType") or 0) < 90 else 60
            if not .5 <= speed <= max_speed or ais.get("navStatus") in (1, 5, 6):
                raise ValueError("정박·저속 또는 속도 확인이 필요한 상태입니다.")
            base["speedKn"] = speed
            if not 0 <= now-observed <= HOUR:
                raise ValueError("최근 1시간 이내 AIS 위치가 있어야 통과 예보를 계산합니다.")
            key = (vessel["source"], vessel["mmsi"], destination)
            previous = self.routes.get(key)
            cached_route = previous and now-previous[0] < 6*HOUR and distance_nm(current, previous[1]["origin"]) < 25
            if cached_route:
                route = previous[1]
            else:
                route = await asyncio.to_thread(self.router.route, *current, destination)
                self.routes[key] = (now, route)
                self.routes.move_to_end(key)
                while len(self.routes) > 200:
                    self.routes.popitem(last=False)
            try:
                points = sample_route(route, current, speed, observed)
            except ValueError:
                if not cached_route:
                    raise
                route = await asyncio.to_thread(self.router.route, *current, destination)
                self.routes[key] = (now, route)
                points = sample_route(route, current, speed, observed)
        except (ValueError, KeyError, TypeError, OverflowError):
            base["reason"] = "최신 항해 위치·속도와 목적항/항로를 확인해 주세요. 통과 예보 계산을 보류했습니다."
            return base
        except Exception:
            base.update(status="unavailable", reason="예상 항로를 준비하지 못했습니다. 잠시 후 다시 확인해 주세요.")
            return base
        # Coarse grid is a cache location, never a claim of vessel position precision.
        grids = [(wrap(round(p["longitude"]*4)/4), round(p["latitude"]*4)/4) for p in points]
        air, marine = await asyncio.gather(self._series("air", grids), self._series("marine", grids))
        for point, grid, a, m in zip(points, grids, air, marine):
            at = point["passageAt"]
            point.update(passageAt=iso(at), forecastAt=None, forecastIssuedAt=None, gridLongitude=grid[0], gridLatitude=grid[1])
            for kind, (series, fetched, status) in [("air", a), ("marine", m)]:
                point[kind+"Status"] = status
                point[kind+"FetchedAt"] = iso(fetched) if fetched is not None else None
                times = series.get("hourly", {}).get("time", [])
                matched = min(times, key=lambda t: abs(t-at)) if times and times[0] <= at <= times[-1] else None
                point[kind+"ForecastAt"] = iso(matched) if matched is not None and abs(matched-at) <= 1800 else None
                point[kind+"Grid"] = [series.get("longitude"), series.get("latitude")] if series else None
                for field, (name, _) in VARIABLES[kind].items():
                    point[name] = match_hour(series, at, field)
        complete = all(p["waveM"] is not None and p["windKn"] is not None and p["gustKn"] is not None and p["visibilityM"] is not None and p["airStatus"] == p["marineStatus"] == "fresh" for p in points)
        available = any(p["waveM"] is not None or p["windKn"] is not None for p in points)
        base.update(points=points, status="ready" if complete else "partial" if available else "unavailable",
                    reason="통과 예정 시각의 격자 예보 · 현재 속도 유지 가정 · ETA 감속 보정 미적용" if complete else "일부 예보가 없거나 이전 캐시입니다. 자료 없음을 안전으로 해석하지 않습니다.")
        if any(p["airStatus"] == "limited" or p["marineStatus"] == "limited" for p in points):
            base["reason"] = "서버의 무료 예보 조회 예산에 도달했습니다. 남은 예보는 대기하며 기본 ETA는 유지합니다."
        return base
