"""Free pile segments and shed cells computed from the yard baseline (read-only)."""
from __future__ import annotations

import re

_PILE = re.compile(r"^P(\d+)$")
_SHED = re.compile(r"^([AB])(\d+)$")
SHED_NAMES = ("A", "B")
SHED_CELLS = 10


def grade_of(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith("고"):
        return "고"
    if text.startswith("저"):
        return "저"
    return None


def _seg(lot: dict, with_range: bool) -> dict:
    seg = {
        "grade": grade_of(lot.get("grade")),
        "age_days": lot.get("age_days"),
        "temperature_c": lot.get("temperature_c"),
        "voyage_number": lot.get("voyage_number"),
        "coal_name": lot.get("coal_name"),
        "tonnes": lot.get("tonnes"),
    }
    if with_range:
        seg = {"from_m": lot["start_m"], "to_m": lot["end_m"], **seg}
    return seg


def _gaps(intervals: list[tuple[float, float]], length: float, min_gap: float) -> list[tuple[float, float]]:
    clipped = sorted(
        (max(0.0, a), min(float(length), b)) for a, b in intervals if min(float(length), b) > max(0.0, a)
    )
    merged: list[list[float]] = []
    for a, b in clipped:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    gaps: list[tuple[float, float]] = []
    cursor = 0.0
    for a, b in merged + [[float(length), float(length)]]:
        if a - cursor >= min_gap:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    return [(int(a) if a == int(a) else a, int(b) if b == int(b) else b) for a, b in gaps]


def yard_space(lots: list[dict], layout: dict) -> dict:
    min_gap = layout["min_gap_m"]
    by_pile: dict[str, list[dict]] = {pid: [] for pid in layout["piles"]}
    unplaced: set[str] = set()
    cells: dict[str, dict[int, dict | None]] = {n: {i: None for i in range(1, SHED_CELLS + 1)} for n in SHED_NAMES}
    for lot in lots:
        tonnes = lot.get("tonnes")
        if not isinstance(tonnes, (int, float)) or tonnes <= 0:
            continue
        location = str(lot.get("location") or "").strip().upper()
        if location in by_pile:
            if lot.get("start_m") is None or lot.get("end_m") is None:
                unplaced.add(location)
            else:
                by_pile[location].append(lot)
            continue
        m = _SHED.match(location)
        if m and 1 <= int(m.group(2)) <= SHED_CELLS:
            cells[m.group(1)][int(m.group(2))] = _seg(lot, False)
    piles: dict[str, dict] = {}
    for pid, spec in layout["piles"].items():
        length = spec["length_m"]
        placed = sorted(by_pile[pid], key=lambda l: (l["start_m"], l["end_m"]))
        span = sum(l["end_m"] - l["start_m"] for l in placed if l["end_m"] > l["start_m"])
        mass = sum(l["tonnes"] for l in placed if l["end_m"] > l["start_m"])
        mock = span <= 0
        number = int(_PILE.match(pid).group(1)) if _PILE.match(pid) else 0
        piles[pid] = {
            "yard": spec.get("yard", 1 if number <= 4 else 2),
            "length_m": length,
            "t_per_m": layout["default_t_per_m"] if mock else mass / span,
            "t_per_m_mock": mock,
            "lots": [_seg(l, True) for l in placed],
            "gaps": _gaps([(l["start_m"], l["end_m"]) for l in placed], length, min_gap),
            "unplaced": pid in unplaced,
        }
    return {"piles": piles, "sheds": {n: {"cells": cells[n]} for n in SHED_NAMES}}
