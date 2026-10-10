"""Local AIS history and visualization-only sea routes; never an operations ledger."""
from copy import deepcopy
from datetime import datetime, timezone
from functools import lru_cache
from math import asin, cos, isfinite, radians, sin, sqrt
from pathlib import Path
import json
import sqlite3
import threading
import time

PORTS = {"dangjin": [126.45, 36.98], "boryeong": [126.47, 36.4],
         "hadong": [127.79, 34.95], "donghae": [129.15, 37.49]}


def epoch(at):
    value = datetime.fromisoformat(at.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    return value.timestamp()


def distance_nm(a, b):
    lon1, lat1, lon2, lat2 = map(radians, [*a, *b])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 3440.065 * 2 * asin(sqrt(min(1, max(0, h))))


class TrackStore:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS members(owner TEXT, source TEXT, mmsi TEXT, PRIMARY KEY(owner,source,mmsi));
          CREATE TABLE IF NOT EXISTS vessels(source TEXT, mmsi TEXT, body TEXT, PRIMARY KEY(source,mmsi));
          CREATE TABLE IF NOT EXISTS points(source TEXT, mmsi TEXT, at REAL, lon REAL, lat REAL, PRIMARY KEY(source,mmsi,at));
          CREATE INDEX IF NOT EXISTS points_time ON points(at);
        """)
        self.active = set(self.db.execute("SELECT DISTINCT source,mmsi FROM members"))
        self.heads = {(s, m): json.loads(body) for s, m, body in self.db.execute("SELECT source,mmsi,body FROM vessels")}
        self.pending = []
        self.dirty = set()
        self.last_point = {(s, m): at for s, m, at in self.db.execute("SELECT source,mmsi,max(at) FROM points GROUP BY source,mmsi")}

    def sync(self, owner, members):
        keys = {(m["source"], m["mmsi"]) for m in members}
        with self.lock:
            others = set(self.db.execute("SELECT source,mmsi FROM members WHERE owner != ?", (owner,)))
            if len(others | keys) > 1000:
                raise ValueError("서버 추적 한도(1,000척)에 도달했습니다.")
            with self.db:
                self.db.execute("DELETE FROM members WHERE owner=?", (owner,))
                self.db.executemany("INSERT INTO members VALUES(?,?,?)", [(owner, *key) for key in keys])
            self.active = others | keys

    def record(self, vessel):
        key = (vessel["source"], vessel["mmsi"])
        with self.lock:
            if key not in self.active:
                return
            pos = vessel.get("ais", {}).get("position")
            old = self.heads.get(key, {}).get("ais", {}).get("position")
            if pos:
                try:
                    at = epoch(pos["observedAt"])
                    lon, lat = pos["longitude"], pos["latitude"]
                    if not (-180 <= lon <= 180 and -90 <= lat <= 90) or at > time.time() + 60:
                        return
                    if old:
                        elapsed = at - epoch(old["observedAt"])
                        if elapsed < 0:
                            return
                        distance = distance_nm([old["longitude"], old["latitude"]], [lon, lat])
                        if distance > 1 + max(0, elapsed) / 3600 * 60:
                            return
                except (ValueError, KeyError, TypeError):
                    return
                if at - self.last_point.get(key, -float("inf")) >= 60:
                    self.pending.append((*key, at, lon, lat))
                    self.last_point[key] = at
            elif old:
                vessel = deepcopy(vessel)
                vessel["ais"]["position"] = old
            self.heads[key] = deepcopy(vessel)
            self.dirty.add(key)

    def flush(self):
        with self.lock, self.db:
            self.db.executemany("INSERT OR IGNORE INTO points VALUES(?,?,?,?,?)", self.pending)
            self.db.executemany("INSERT OR REPLACE INTO vessels VALUES(?,?,?)",
                                [(s, m, json.dumps(self.heads[(s, m)])) for s, m in self.dirty])
            self.pending.clear()
            self.dirty.clear()
            self.db.execute("DELETE FROM points WHERE at < ?", (time.time() - 30 * 86400,))

    def registered_member(self, owner, source, mmsi):
        """Historical lookups need registration, but not a current AIS reception."""
        with self.lock:
            row = self.db.execute("SELECT 1 FROM members WHERE owner=? AND source=? AND mmsi=?",
                                  (owner, source, mmsi)).fetchone()
            if row is None:
                return None
            return deepcopy(self.heads.get((source, mmsi), {"source": source, "mmsi": mmsi, "imo": ""}))

    def latest(self, owner):
        with self.lock:
            keys = list(self.db.execute("SELECT source,mmsi FROM members WHERE owner=?", (owner,)))
            return [deepcopy(self.heads[key]) for key in keys if key in self.heads]

    def history(self, owner, source, mmsi, hours, now=None):
        with self.lock:
            if not self.db.execute("SELECT 1 FROM members WHERE owner=? AND source=? AND mmsi=?", (owner, source, mmsi)).fetchone():
                raise KeyError("관심 선박 등록이 필요합니다.")
            self.flush()
            rows = list(reversed(self.db.execute(
                "SELECT at,lon,lat FROM points WHERE source=? AND mmsi=? AND at>=? ORDER BY at DESC LIMIT 5001",
                (source, mmsi, (time.time() if now is None else now) - hours * 3600)).fetchall()))
            truncated = len(rows) > 5000
            rows = rows[-5000:]
            segments = []
            last = None
            for at, lon, lat in rows:
                if last is None or at - last > 6 * 3600:
                    segments.append([])
                segments[-1].append({"longitude": lon, "latitude": lat,
                                     "observedAt": datetime.fromtimestamp(at, timezone.utc).isoformat()})
                last = at
            return {"segments": segments, "pointCount": len(rows), "truncated": truncated,
                    "vessel": deepcopy(self.heads.get((source, mmsi))), "retentionDays": 30}

    def close(self):
        self.flush()
        self.db.close()


class SeaRouter:
    def __init__(self):
        self.lock = threading.Lock()

    @staticmethod
    def destination_coordinates(destination):
        from midterm.vessels.destinations import port_coordinates
        return list(PORTS[destination]) if destination in PORTS else port_coordinates(destination)

    def route(self, longitude, latitude, destination):
        if not all(isinstance(n, (float, int)) and not isinstance(n, bool) and isfinite(n) for n in [longitude, latitude]):
            raise ValueError("유효한 좌표가 필요합니다.")
        if not (-180 <= longitude <= 180 and -85 <= latitude <= 85):
            raise ValueError("좌표 또는 목적항을 확인해 주세요.")
        self.destination_coordinates(destination)
        with self.lock:
            return deepcopy(self._calculate(round(longitude, 4), round(latitude, 4), destination))

    @lru_cache(maxsize=128)
    def _calculate(self, lon, lat, destination):
        import searoute
        endpoint = self.destination_coordinates(destination)
        route = searoute.searoute([lon, lat], endpoint, units="naut")
        coordinates = [[(x + 180) % 360 - 180, y] for x, y in route["geometry"]["coordinates"]]
        if len(coordinates) < 2:
            raise ValueError("현재 위치와 목적항이 같은 항로 노드입니다. 상세 입항 경로는 제공하지 않습니다.")
        return {"kind": "estimated", "provider": "searoute", "destinationId": destination,
                "origin": [lon, lat], "coordinates": coordinates,
                "distanceNm": route["properties"]["length"],
                "startOffsetNm": distance_nm([lon, lat], coordinates[0]),
                "endOffsetNm": distance_nm(endpoint, coordinates[-1])}
