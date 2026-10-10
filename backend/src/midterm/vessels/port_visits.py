"""GFW apparent port visits for selected interests. Never writes voyage/cargo origins."""
import asyncio
from collections import OrderedDict
from datetime import datetime, timezone, timedelta
import json
import os
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

IDENTITY_DATASET = "public-global-vessel-identity:latest"
EVENT_DATASET = "public-global-port-visits-events:latest"
GATEWAY = "https://gateway.api.globalfishingwatch.org/v3/"


class ProviderError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__("GFW request failed")


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.timestamp() if dt.tzinfo and 2000 <= dt.year <= 2100 else None
    except ValueError:
        return None


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")


def text(value, limit=160):
    return value.strip()[:limit] if isinstance(value, str) else ""


def imo_number(value):
    value = str(value or "").upper().removeprefix("IMO").strip()
    return value if re.fullmatch(r"[1-9][0-9]{6}", value) else ""


def fetch_json(token, path, params):
    request = Request(GATEWAY + path + "?" + urlencode(params), headers={
        "Authorization": f"Bearer {token}", "Accept": "application/json", "User-Agent": "genForecast/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            body = response.read(4_000_001)
            if len(body) > 4_000_000:
                raise ValueError("GFW response too large")
            return json.loads(body)
    except HTTPError as error:
        # Never relay the provider body, request headers or token to the browser/logs.
        raise ProviderError(error.code) from None


def entries(value):
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list):
        raise ValueError("Invalid GFW response")
    return value["entries"]


ERRORS = {
    "unconfigured": "서버에 GFW_API_TOKEN을 설정하면 기항 기록을 조회할 수 있습니다.",
    "unauthorized": "GFW 토큰이 유효하지 않거나 만료되었습니다. 서버 설정을 확인해 주세요.",
    "forbidden": "GFW 데이터 접근 권한이 없습니다. 계정의 데이터 이용 권한을 확인해 주세요.",
    "rate_limited": "GFW 요청 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.",
    "unavailable": "GFW 기항 기록을 가져오지 못했습니다. 잠시 후 다시 확인해 주세요.",
    "not_found": "현재 MMSI와 일치하는 GFW 기록을 찾지 못했습니다. 기항 이력이 없다는 뜻은 아닙니다.",
    "ambiguous": "선박 식별 정보가 충돌하거나 후보가 많아 자동 연결을 보류했습니다. MMSI·IMO를 확인해 주세요.",
}


class PortVisitService:
    def __init__(self, token=None, fetch=None, clock=time.time):
        self.token = os.getenv("GFW_API_TOKEN", "").strip() if token is None else token
        self.fetch = fetch or self._fetch
        self.clock = clock
        self.cache = OrderedDict()
        self.lock = asyncio.Lock()
        self.cooldown_until = 0
        self.failure = "unavailable"

    async def _fetch(self, path, params):
        return await asyncio.to_thread(fetch_json, self.token, path, params)

    def base(self, mmsi, days):
        now = datetime.fromtimestamp(self.clock(), timezone.utc)
        return {"provider": "gfw", "mmsi": mmsi, "days": days, "status": "ready", "message": "",
                "fetchedAt": None, "windowStart": (now - timedelta(days=days)).date().isoformat(),
                "windowEnd": (now + timedelta(days=1)).date().isoformat(), "delayHours": 72,
                "matchBasis": None, "visits": [], "truncated": False, "datasets": []}

    async def lookup(self, vessel, days=30):
        mmsi = vessel.get("mmsi", "")
        if not re.fullmatch(r"[1-9][0-9]{8}", mmsi) or days not in (30, 90):
            raise ValueError("Invalid vessel or lookback")
        base = self.base(mmsi, days)
        if not self.token:
            return {**base, "status": "unconfigured", "message": ERRORS["unconfigured"]}
        key = (mmsi, imo_number(vessel.get("imo")), days)
        async with self.lock:
            now = self.clock()
            cached = self.cache.get(key)
            if cached and now - cached[0] < 3600:
                self.cache.move_to_end(key)
                return cached[1]
            if now < self.cooldown_until:
                return self.failed(base, cached)
            try:
                result = await asyncio.wait_for(self.collect(base, key[1]), timeout=30)
            except (ProviderError, OSError, ValueError, TimeoutError) as error:
                self.failure = {401: "unauthorized", 403: "forbidden", 429: "rate_limited"}.get(
                    getattr(error, "code", None), "unavailable")
                self.cooldown_until = self.clock() + (900 if self.failure == "rate_limited" else 60)
                return self.failed(base, cached)
            result["fetchedAt"] = iso(self.clock())
            self.cache[key] = (self.clock(), result)
            self.cache.move_to_end(key)
            while len(self.cache) > 200:
                self.cache.popitem(last=False)
            return result

    def failed(self, base, cached):
        if cached and self.clock() - cached[0] < 24 * 3600 and cached[1]["visits"]:
            return {**cached[1], "status": "stale", "message": ERRORS[self.failure] + " 이전 조회 기록을 표시합니다."}
        return {**base, "status": self.failure, "message": ERRORS[self.failure]}

    async def collect(self, base, imo):
        found = await self.fetch("vessels/search", {
            "query": base["mmsi"], "datasets[0]": IDENTITY_DATASET, "limit": 50})
        rows = entries(found)
        if not isinstance(found.get("total"), int) or found["total"] > len(rows):
            return {**base, "status": "ambiguous", "message": ERRORS["ambiguous"]}
        infos = []
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("selfReportedInfo"), list):
                raise ValueError("Invalid identity")
            for info in row["selfReportedInfo"]:
                if not isinstance(info, dict) or str(info.get("ssvid")) != base["mmsi"]:
                    continue
                start, end = timestamp(info.get("transmissionDateFrom")), timestamp(info.get("transmissionDateTo"))
                if end is not None and end < timestamp(base["windowStart"] + "T00:00:00Z"):
                    continue
                if start is not None and start > self.clock():
                    continue
                if text(info.get("id")):
                    infos.append(info)
        known_imos = {imo_number(i.get("imo")) for i in infos} - {""}
        if (imo and known_imos and imo not in known_imos) or (not imo and len(known_imos) > 1):
            return {**base, "status": "ambiguous", "message": ERRORS["ambiguous"]}
        # When conflicting IMO identities exist, only the explicit IMO match is safe.
        if imo and len(known_imos | {imo}) > 1:
            infos = [i for i in infos if imo_number(i.get("imo")) == imo]
        ids = sorted({i["id"] for i in infos})
        if not ids:
            return {**base, "status": "not_found", "message": ERRORS["not_found"]}
        if len(ids) > 20:
            return {**base, "status": "ambiguous", "message": ERRORS["ambiguous"]}
        base["matchBasis"] = "mmsi_imo" if imo and all(imo_number(i.get("imo")) == imo for i in infos) else "mmsi"
        params = {"datasets[0]": EVENT_DATASET, "types[0]": "PORT_VISIT", "start-date": base["windowStart"],
                  "end-date": base["windowEnd"], "limit": 100, "offset": 0, "include-regions": "false",
                  **{f"vessels[{i}]": vid for i, vid in enumerate(ids)}}
        visits, datasets = {}, set()
        incomplete = False
        for page in range(5):
            data = await self.fetch("events", params.copy())
            page_rows = entries(data)
            metadata = data.get("metadata") or {}
            if isinstance(metadata, dict) and isinstance(metadata.get("datasets"), list):
                datasets.update(d for d in metadata["datasets"] if isinstance(d, str))
            for row in page_rows:
                visit = self.normalize(row, ids, base)
                if visit is None:
                    incomplete = True
                else:
                    visits[visit["id"]] = visit
            total = data.get("total")
            if not isinstance(total, int) or total < 0:
                raise ValueError("Invalid event total")
            next_offset = data.get("nextOffset")
            consumed = params["offset"] + len(page_rows)
            if consumed >= total:
                break
            if not isinstance(next_offset, int) or next_offset <= params["offset"] or not page_rows or page == 4:
                incomplete = True
                base["truncated"] = True
                break
            params["offset"] = next_offset
        base["visits"] = sorted(visits.values(), key=lambda v: v["arrivalAt"], reverse=True)
        base["datasets"] = sorted(datasets) or [EVENT_DATASET]
        base["status"] = "partial" if incomplete else "ready" if visits else "empty"
        base["message"] = "일부 기록만 확인했습니다. 전체 이력이나 가장 최근 기항을 보장하지 않습니다." if incomplete else (
            "조회 기간에 제공된 기항 기록이 없습니다. 미수신·미반영 가능성이 있습니다." if not visits else "")
        return base

    def normalize(self, row, ids, base):
        if not isinstance(row, dict) or str(row.get("type", "")).lower() != "port_visit":
            return None
        vessel, visit = row.get("vessel"), row.get("port_visit")
        if not isinstance(vessel, dict) or vessel.get("id") not in ids or not isinstance(visit, dict):
            return None
        if vessel.get("ssvid") is not None and str(vessel["ssvid"]) != base["mmsi"]:
            return None
        start, end = timestamp(row.get("start")), timestamp(row.get("end"))
        if start is None or start > self.clock() or (row.get("end") is not None and (end is None or end < start or end > self.clock())):
            return None
        if end is not None and end < timestamp(base["windowStart"] + "T00:00:00Z"):
            return None
        anchorage = next((visit.get(k) for k in ("intermediateAnchorage", "startAnchorage", "endAnchorage")
                          if isinstance(visit.get(k), dict) and text(visit[k].get("name"))), {})
        eid = text(visit.get("visitId")) or text(row.get("id"))
        if not eid:
            return None
        confidence = visit.get("confidence")
        return {"id": eid, "portName": text(anchorage.get("name")) or "항만명 미제공",
                "country": text(anchorage.get("flag"), 3), "arrivalAt": iso(start),
                "departureAt": iso(end) if end is not None else None,
                "confidence": confidence if type(confidence) is int and confidence in (2, 3, 4) else None}
