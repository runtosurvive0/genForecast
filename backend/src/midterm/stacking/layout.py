"""Mock yard layout and berth-to-destination routes for stacking recommendation."""
from __future__ import annotations

import json
from pathlib import Path

_LAYOUT_PATH = Path(__file__).with_name("layout.json")
_NUMBER_KEYS = ("default_t_per_m", "min_gap_m", "shed_cell_t", "old_age_days", "hot_temperature_c")


def _positive(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def load_layout(path: Path | None = None) -> dict:
    target = Path(path) if path else _LAYOUT_PATH
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"적치 배치 설정을 읽을 수 없습니다: {target}") from exc
    if not isinstance(data, dict):
        raise ValueError("적치 배치 설정 형식이 올바르지 않습니다.")
    if not isinstance(data.get("classification"), str) or not data["classification"]:
        raise ValueError("적치 배치 설정에 classification 값이 없습니다.")
    piles = data.get("piles")
    if not isinstance(piles, dict) or not piles:
        raise ValueError("적치 배치 설정에 piles 값이 없습니다.")
    for pile_id, pile in piles.items():
        if not isinstance(pile, dict) or not _positive(pile.get("length_m")):
            raise ValueError(f"{pile_id}의 length_m 값이 올바르지 않습니다.")
    for key in _NUMBER_KEYS:
        if not _positive(data.get(key)):
            raise ValueError(f"적치 배치 설정의 {key} 값이 없거나 올바르지 않습니다.")
    sources = data.get("sources")
    if not isinstance(sources, list) or not all(isinstance(s, str) for s in sources):
        raise ValueError("적치 배치 설정의 sources 값이 올바르지 않습니다.")
    return data


def _destination(endpoint_id: str) -> str | None:
    if endpoint_id.startswith("pile-") and endpoint_id[5:].isdigit():
        return f"P{int(endpoint_id[5:])}"
    if endpoint_id == "shed-a":
        return "A"
    if endpoint_id == "shed-b":
        return "B"
    return None


def load_routes(path: Path | None = None) -> dict[int, set[str]]:
    target = Path(path) if path else Path(__file__).resolve().parents[4] / "src" / "data" / "fuel-reference" / "demo-catalog.json"
    try:
        catalog = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"반입 경로 자료를 읽을 수 없습니다: {target}") from exc
    routes = catalog.get("routes") if isinstance(catalog, dict) else None
    if not isinstance(routes, list) or not routes:
        raise ValueError("반입 경로 자료에 routes 값이 없습니다.")
    result: dict[int, set[str]] = {}
    for route in routes:
        berth = route.get("berth") if isinstance(route, dict) else None
        if not isinstance(berth, int) or isinstance(berth, bool):
            raise ValueError("반입 경로의 berth 값이 올바르지 않습니다.")
        result[berth] = {d for e in route.get("endpoints", []) if (d := _destination(str(e.get("id", ""))))}
    return result
