"""One server-side AISstream subscription, bounded in-memory discovery cache."""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from contextlib import suppress
from datetime import datetime, timezone
import json
import math
import os
import random
import re
from midterm.vessels.korean_destinations import korean_destination

DEFAULT_BOXES = [[[-90, -180], [90, 180]]]
MAX_VESSELS = 20_000
MAX_KOREA_CANDIDATES = 1000
KOREA_RETENTION_HOURS = 72


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def number(value, low, high):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and low <= value <= high else None


def clean(value, limit=100):
    return value.replace("@", "").strip()[:limit] if isinstance(value, str) else ""


def epoch(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def observed_time(meta, fallback):
    # AISstream UTC timestamp is supplied as "... +0000 UTC" on some feeds.
    raw = meta.get("time_utc")
    if not isinstance(raw, str):
        return fallback
    try:
        normalized = re.sub(r"\s+\+0000(?: UTC)?$", "+00:00", raw.strip())
        value = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        if value.tzinfo is None or value > datetime.now(timezone.utc):
            return fallback
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        return fallback


class AisCatalog:
    def __init__(self, api_key=None, on_observation=None):
        self.on_observation = on_observation
        self._key = os.getenv("AISSTREAM_API_KEY", "").strip() if api_key is None else api_key
        self.status = "idle" if self._key else "not_configured"
        self._rows = OrderedDict()
        self._korea = OrderedDict()
        self._static_at = {}
        self._destination_at = {}
        self._last_prune = -float("inf")
        self._task = None
        self.last_received_at = None
        self.boxes = DEFAULT_BOXES
        self.coverage = "전 세계 수신 범위 · AIS 수신 공백 있음"
        configured = os.getenv("AISSTREAM_BOUNDING_BOXES")
        if configured:
            try:
                boxes = json.loads(configured)
                if not isinstance(boxes, list) or not 1 <= len(boxes) <= 8:
                    raise ValueError()
                for box in boxes:
                    if len(box) != 2:
                        raise ValueError()
                    for corner in box:
                        if len(corner) != 2 or number(corner[0], -90, 90) is None or number(corner[1], -180, 180) is None:
                            raise ValueError()
                self.boxes = boxes
                self.coverage = "서버 지정 수신 영역"
            except (ValueError, TypeError, IndexError):
                self.status = "configuration_error"

    def start(self):
        if self._key and self.status != "configuration_error" and (self._task is None or self._task.done()):
            self.status = "connecting"
            self._task = asyncio.create_task(self._receive())

    async def stop(self):
        if self._task:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def ingest(self, payload, received_at):
        if not isinstance(payload, dict):
            return
        kind = payload.get("MessageType")
        if kind not in ("PositionReport", "ShipStaticData"):
            return
        meta, messages = payload.get("MetaData"), payload.get("Message")
        if not isinstance(meta, dict) or not isinstance(messages, dict):
            return
        report = messages.get(kind)
        if not isinstance(report, dict) or report.get("Valid") is False:
            return
        mmsi = str(meta.get("MMSI", report.get("UserID", "")))
        if not re.fullmatch(r"[1-9]\d{8}", mmsi):
            return
        observed_at = observed_time(meta, received_at)
        if epoch(received_at) - self._last_prune >= 60:
            self._prune_candidates(received_at)
        retained = self._korea.get(mmsi)
        old = self._rows.get(mmsi) or (retained["vessel"] if retained else None)
        static_fresh = mmsi not in self._static_at or epoch(observed_at) >= epoch(self._static_at[mmsi])
        destination_fresh = (kind == "ShipStaticData" and isinstance(report.get("Destination"), str) and
                             (mmsi not in self._destination_at or epoch(observed_at) >= epoch(self._destination_at[mmsi])))
        if kind == "ShipStaticData" and not static_fresh and not destination_fresh:
            return
        row = old or {"id": f"ais-{mmsi}", "name": f"MMSI {mmsi}", "imo": "", "mmsi": mmsi,
                      "source": "aisstream", "ais": {"updatedAt": observed_at, "shipType": None,
                      "navStatus": None, "destination": "", "position": None}}
        ais = row["ais"]
        if kind == "PositionReport":
            latitude = number(report.get("Latitude"), -90, 90)
            longitude = number(report.get("Longitude"), -180, 180)
            if latitude is None or longitude is None:
                return
            if ais["position"] and epoch(observed_at) < epoch(ais["position"]["observedAt"]):
                return
            ais["position"] = {"latitude": latitude, "longitude": longitude, "observedAt": observed_at,
                               "sogKn": number(report.get("Sog"), 0, 102.2), "cogDeg": number(report.get("Cog"), 0, 359.9)}
            ais["navStatus"] = number(report.get("NavigationalStatus"), 0, 14)
        else:
            if static_fresh:
                self._static_at[mmsi] = observed_at
                imo = str(report.get("ImoNumber", ""))
                if re.fullmatch(r"[1-9]\d{6}", imo):
                    row["imo"] = imo
                ship_type = number(report.get("Type"), 1, 99)
                if ship_type is not None:
                    ais["shipType"] = ship_type
            if destination_fresh:
                self._destination_at[mmsi] = observed_at
                destination = clean(report["Destination"])
                ais["destination"] = destination
                match = korean_destination(destination)
                if match and epoch(received_at) - epoch(observed_at) < KOREA_RETENTION_HOURS * 3600:
                    self._korea[mmsi] = {"vessel": row, **match, "destinationObservedAt": observed_at}
                    self._korea.move_to_end(mmsi)
                else:
                    self._korea.pop(mmsi, None)
        name = clean(report.get("Name")) or clean(meta.get("ShipName"))
        if name and (kind == "PositionReport" or static_fresh):
            row["name"] = name
        ais["updatedAt"] = max(ais["updatedAt"], observed_at, key=epoch)
        self._rows[mmsi] = row
        self._rows.move_to_end(mmsi)
        while len(self._rows) > MAX_VESSELS:
            removed, _ = self._rows.popitem(last=False)
            self._forget_static_if_unused(removed)
        while len(self._korea) > MAX_KOREA_CANDIDATES:
            removed, _ = self._korea.popitem(last=False)
            self._forget_static_if_unused(removed)
        self.last_received_at = received_at
        if self.on_observation:
            self.on_observation(row)

    def _forget_static_if_unused(self, mmsi):
        if mmsi not in self._rows and mmsi not in self._korea:
            self._static_at.pop(mmsi, None)
            self._destination_at.pop(mmsi, None)

    def _prune_candidates(self, now):
        self._last_prune = epoch(now)
        for mmsi, entry in list(self._korea.items()):
            if epoch(now) - epoch(entry["destinationObservedAt"]) >= KOREA_RETENTION_HOURS * 3600:
                del self._korea[mmsi]
                self._forget_static_if_unused(mmsi)

    def known_vessels(self):
        """Seed a newly registered interest even after general-cache eviction."""
        self._prune_candidates(utc_now())
        merged = {mmsi: entry["vessel"] for mmsi, entry in self._korea.items()}
        merged.update(self._rows)
        return list(merged.values())

    def snapshot(self):
        # Metadata-only messages must never change position freshness.
        now = utc_now()
        self._prune_candidates(now)
        return {"provider": "aisstream", "status": self.status, "coverage": self.coverage,
                "lastReceivedAt": self.last_received_at, "fetchedAt": now,
                "capacity": MAX_VESSELS, "vessels": list(reversed(self._rows.values())),
                "koreaCandidates": {"capacity": MAX_KOREA_CANDIDATES, "retentionHours": KOREA_RETENTION_HOURS,
                                    "entries": list(reversed(self._korea.values()))}}

    async def _receive(self):
        from websockets.asyncio.client import connect
        delay = 2
        while True:
            try:
                async with connect("wss://stream.aisstream.io/v0/stream", compression="deflate",
                                   open_timeout=15, close_timeout=5, max_size=1048576) as socket:
                    await socket.send(json.dumps({"APIKey": self._key, "BoundingBoxes": self.boxes,
                                                  "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}))
                    self.status = "waiting"
                    async for frame in socket:
                        try:
                            message = json.loads(frame)
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if not isinstance(message, dict):
                            continue
                        if "error" in message or "Error" in message:
                            # Never forward upstream error bodies: they may echo subscription secrets.
                            self.status = "provider_error"
                            return
                        if message.get("MessageType") == "SubscriptionConfirmation":
                            self.status = "waiting"
                            delay = 2
                        previous = self.last_received_at
                        self.ingest(message, utc_now())
                        if self.last_received_at != previous:
                            self.status = "receiving"
                            delay = 2
                self.status = "reconnecting"
            except Exception:
                self.status = "reconnecting"
            await asyncio.sleep(delay + random.random())
            delay = min(60, delay * 2)
