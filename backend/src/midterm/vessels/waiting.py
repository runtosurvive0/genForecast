"""당진 부두 앞바다에서 멈춰 있는 화물선(부두 대기 후보)을 기록하고 판별한다.

공개 AIS만으로 석탄선·체선을 단정하지 않는다. 규칙으로 후보와 근거를 만들고 사람이 확인한다.
"""
import json
import sqlite3
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from .berths import berth_distance_m, distance_km, on_berth, plane_m
from .navigation import epoch

RECORD_INTERVAL_S = 300
RETENTION_S = 7 * 86400
STOP_SOG_KN = 1.0
MIN_DWELL_S = 2 * 3600
MAX_DRIFT_M = 1000
MAX_GAP_S = 3600
STALE_AFTER_S = 3600
HEAD_PRUNE_S = 3600


def _cargo_or_unknown(ship_type) -> bool:
    return ship_type is None or (isinstance(ship_type, (int, float)) and 70 <= ship_type <= 79)


class WaitingStore:
    """부두 반경 안 화물선·선종 미상 배의 위치(배마다 5분 간격, 7일)와 사용자별 확인 답을 보관한다."""

    def __init__(self, path, radius_km: float = 15.0):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.radius_km = radius_km
        # lock: 메모리 큐만 보호한다(AIS 수신 콜백이 잡으므로 짧게). db_lock: SQLite 작업.
        self.lock = threading.RLock()
        self.db_lock = threading.RLock()
        self._last_prune = -float("inf")
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS waiting_points(mmsi TEXT, at REAL, lon REAL, lat REAL, sog REAL, nav_status INTEGER,
                                                    PRIMARY KEY(mmsi, at));
          CREATE INDEX IF NOT EXISTS waiting_points_time ON waiting_points(at);
          CREATE TABLE IF NOT EXISTS waiting_heads(mmsi TEXT PRIMARY KEY, body TEXT);
          CREATE TABLE IF NOT EXISTS waiting_answers(user_id TEXT, mmsi TEXT, answer TEXT, at REAL, evidence TEXT);
          CREATE INDEX IF NOT EXISTS waiting_answers_user ON waiting_answers(user_id, mmsi, at);
        """)
        self.last_point = dict(self.db.execute("SELECT mmsi, max(at) FROM waiting_points GROUP BY mmsi"))
        self.pending: list[tuple] = []
        self.dirty: dict[str, dict] = {}

    def record(self, vessel: dict) -> None:
        if vessel.get("source") != "aisstream":
            return
        ais = vessel.get("ais") or {}
        pos = ais.get("position")
        mmsi = vessel.get("mmsi")
        if not pos or not mmsi or not _cargo_or_unknown(ais.get("shipType")):
            return
        try:
            at = epoch(pos["observedAt"])
            lon, lat = float(pos["longitude"]), float(pos["latitude"])
        except (ValueError, KeyError, TypeError, AttributeError):
            return
        if not (-180 <= lon <= 180 and -90 <= lat <= 90) or at > time.time() + 60:
            return
        if distance_km(lon, lat) > self.radius_km:
            return
        sog = pos.get("sogKn")
        nav = ais.get("navStatus")
        with self.lock:
            if at - self.last_point.get(mmsi, -float("inf")) >= RECORD_INTERVAL_S:
                self.pending.append((mmsi, at, lon, lat, sog, nav))
                self.last_point[mmsi] = at
            self.dirty[mmsi] = deepcopy(vessel)

    def flush(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        cutoff = now - RETENTION_S
        with self.lock:
            pending, self.pending = self.pending, []
            dirty, self.dirty = self.dirty, {}
            self.last_point = {m: at for m, at in self.last_point.items() if at >= cutoff}
        heads = [(m, json.dumps(v, ensure_ascii=False)) for m, v in dirty.items()]
        with self.db_lock, self.db:
            self.db.executemany("INSERT OR REPLACE INTO waiting_points VALUES(?,?,?,?,?,?)", pending)
            self.db.executemany("INSERT OR REPLACE INTO waiting_heads VALUES(?,?)", heads)
            if now - self._last_prune >= HEAD_PRUNE_S:  # 7일치 전체를 훑는 정리는 한 시간에 한 번만
                self._last_prune = now
                self.db.execute("DELETE FROM waiting_points WHERE at < ?", (cutoff,))
                self.db.execute("DELETE FROM waiting_heads WHERE mmsi NOT IN (SELECT DISTINCT mmsi FROM waiting_points)")

    def snapshot(self, now: float, hours: float = 24):
        since = now - hours * 3600
        points: dict[str, list[tuple]] = {}
        with self.db_lock:
            for mmsi, at, lon, lat, sog, nav in self.db.execute(
                    "SELECT mmsi, at, lon, lat, sog, nav_status FROM waiting_points WHERE at >= ? ORDER BY mmsi, at",
                    (since,)):
                points.setdefault(mmsi, []).append((at, lon, lat, sog, nav))
            heads = {m: json.loads(body) for m, body in self.db.execute("SELECT mmsi, body FROM waiting_heads")
                     if m in points}
        return points, heads

    def save_answer(self, user_id: str, mmsi: str, answer: str, evidence: dict, at: float) -> None:
        if answer not in ("yes", "no"):
            raise ValueError("answer must be yes or no")
        with self.db_lock, self.db:
            self.db.execute("INSERT INTO waiting_answers VALUES(?,?,?,?,?)",
                            (user_id, mmsi, answer, at, json.dumps(evidence, ensure_ascii=False)))

    def answers(self, user_id: str) -> dict[str, tuple[str, float]]:
        with self.db_lock:
            rows = self.db.execute("SELECT mmsi, answer, at FROM waiting_answers WHERE user_id=? ORDER BY at, rowid",
                                   (user_id,)).fetchall()
        return {mmsi: (answer, at) for mmsi, answer, at in rows}


def _stopped(sog, nav) -> bool:
    return nav == 1 or (sog is not None and sog <= STOP_SOG_KN)


def _dwell_start(track: list[tuple]) -> float | None:
    """가장 최근 점부터 거꾸로 정지 구간의 시작 시각. 마지막 점이 정지가 아니면 None."""
    last_at, last_lon, last_lat, sog, nav = track[-1]
    if not _stopped(sog, nav):
        return None
    start, previous = last_at, last_at
    for at, lon, lat, sog, nav in reversed(track[:-1]):
        if previous - at > MAX_GAP_S or not _stopped(sog, nav) or plane_m(lon, lat, last_lon, last_lat) > MAX_DRIFT_M:
            break
        start = previous = at
    return start


def waiting_candidates(points: dict, heads: dict, now: float, exclude: set) -> list[dict]:
    found = []
    for mmsi, track in points.items():
        if mmsi in exclude or not track:
            continue
        track = sorted(track)
        last_at, lon, lat, sog, nav = track[-1]
        if on_berth(lon, lat):
            continue
        start = _dwell_start(track)
        if start is None or last_at - start < MIN_DWELL_S:
            continue
        head = heads.get(mmsi) or {}
        ais = head.get("ais") or {}
        ship_type = ais.get("shipType")
        destination = (ais.get("destination") or "").strip() or None
        dwell = round((last_at - start) / 3600, 1)
        km = round(berth_distance_m(lon, lat) / 1000, 1)
        reasons = []
        if nav == 1:
            reasons.append("묘박 상태")
        if sog is not None:
            reasons.append(f"속력 {sog:.1f}노트")
        reasons.append(f"목적지 {destination}" if destination else "목적지 미기재")
        reasons.append("선종 미상" if ship_type is None else "화물선")
        reasons.append(f"{dwell:.1f}시간 정지")
        reasons.append(f"부두까지 {km:.1f}km")
        observed = datetime.fromtimestamp(last_at, timezone.utc).isoformat().replace("+00:00", "Z")
        found.append({
            "mmsi": mmsi,
            "name": (head.get("name") or "").strip() or f"MMSI {mmsi}",
            "shipType": ship_type,
            "navStatus": nav,
            "sogKn": sog,
            "destination": destination,
            "position": {"latitude": lat, "longitude": lon, "observedAt": observed},
            "dwellHours": dwell,
            "distanceKm": km,
            "stale": now - last_at > STALE_AFTER_S,
            "reasons": reasons,
        })
    found.sort(key=lambda c: c["dwellHours"], reverse=True)
    return found


def evidence_for(candidate: dict, now: float) -> dict:
    """답 저장용 근거. 서버가 계산한 값만 담는다."""
    keys = ("position", "sogKn", "navStatus", "dwellHours", "distanceKm", "stale", "reasons")
    return {**{k: deepcopy(candidate[k]) for k in keys}, "at": now}
