"""당진 부두 선분. 프런트 `src/data/berths/dangjin-berths.json`과 같은 사본을 읽는다.

배포 스크립트가 `backend/src`만 복사하므로 백엔드 안에 사본을 두고, 두 파일이 같은지 테스트로 확인한다.
"""
import json
import math
from pathlib import Path

_DATA = json.loads(Path(__file__).with_name("dangjin_berths.json").read_text(encoding="utf-8"))
FACES: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {
    k: (tuple(a), tuple(b)) for k, (a, b) in _DATA["faces"].items()
}
BERTH_RADIUS_M: float = float(_DATA["berthRadiusM"])
_ENDS = [p for face in FACES.values() for p in face]
CENTER: tuple[float, float] = (sum(p[0] for p in _ENDS) / len(_ENDS), sum(p[1] for p in _ENDS) / len(_ENDS))
_M_PER_DEG = 111320.0


def _segment_m(lon: float, lat: float, a, b) -> float:
    # src/domain/berth-ais.ts의 distance와 같은 평면 근사
    east = _M_PER_DEG * math.cos(math.radians(lat))
    dx, dy = (b[0] - a[0]) * east, (b[1] - a[1]) * _M_PER_DEG
    x, y = (lon - a[0]) * east, (lat - a[1]) * _M_PER_DEG
    t = max(0.0, min(1.0, (x * dx + y * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - t * dx, y - t * dy)


def berth_distance_m(lon: float, lat: float) -> float:
    """가장 가까운 부두 선분까지 거리(m)"""
    return min(_segment_m(lon, lat, a, b) for a, b in FACES.values())


def on_berth(lon: float, lat: float) -> bool:
    return berth_distance_m(lon, lat) <= BERTH_RADIUS_M


def plane_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """두 점 사이 평면 근사 거리(m)"""
    east = _M_PER_DEG * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon2 - lon1) * east, (lat2 - lat1) * _M_PER_DEG)


def distance_km(lon: float, lat: float) -> float:
    """부두 중심까지 거리(km)"""
    return plane_m(lon, lat, CENTER[0], CENTER[1]) / 1000
