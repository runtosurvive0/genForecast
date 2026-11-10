"""Rank empty pile segments and shed cells for one waiting cargo (read-only)."""
from __future__ import annotations

import math
import re

from midterm.stacking.space import SHED_CELLS, yard_space

MAX_OPTIONS = 3
_EPS = 1e-9  # metres; keeps edges exactly min_gap away from counting as touching
SHED_YARD = 3
_PILE = re.compile(r"^P(\d+)$")
_SOURCES = ("scenario", "registry")
_GRADES = ("고", "저")


def _int_in(value: object, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _text_or_none(raw: dict, key: str, label: str) -> str | None:
    value = raw.get(key)
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{label}을(를) 확인하세요")
    return value


def validate_cargo(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("화물 정보 형식이 올바르지 않습니다")
    if raw.get("source") not in _SOURCES:
        raise ValueError("화물 출처를 확인하세요")
    for key, label in (("ref", "화물 참조"), ("vessel_name", "선명")):
        if not isinstance(raw.get(key), str):
            raise ValueError(f"{label}을(를) 확인하세요")
    tonnes = raw.get("tonnes")
    if not _number(tonnes) or not 0 < tonnes <= 1_000_000:
        raise ValueError("물량은 0 초과 1,000,000 t 이하여야 합니다")
    if not _int_in(raw.get("berth"), 1, 3):
        raise ValueError("하역 부두는 1~3이어야 합니다")
    destination = raw.get("destination_yard")
    if destination is not None and not _int_in(destination, 1, 3):
        raise ValueError("목적 저탄장은 1~3이어야 합니다")
    grade = raw.get("grade")
    if grade is not None and grade not in _GRADES:
        raise ValueError("고/저 구분은 고 또는 저여야 합니다")
    cv = raw.get("cv")
    if cv is not None and (not _number(cv) or cv <= 0):
        raise ValueError("열량을 확인하세요")
    return {
        "source": raw["source"],
        "ref": raw["ref"],
        "vessel_name": raw["vessel_name"],
        "voyage_number": _text_or_none(raw, "voyage_number", "항차 번호"),
        "coal_name": _text_or_none(raw, "coal_name", "탄종"),
        "grade": grade,
        "cv": cv,
        "tonnes": tonnes,
        "berth": raw["berth"],
        "destination_yard": destination,
    }


def _t(value: float) -> float:
    rounded = round(value, 1)
    return int(rounded) if rounded == int(rounded) else rounded


def _pile_label(pid: str) -> str:
    m = _PILE.match(pid)
    return f"Pile {int(m.group(1))}" if m else pid


def _usable(lots: list[dict], a: float, b: float, grade: str, min_gap: float) -> tuple[float, float]:
    """Part of gap [a, b] kept min_gap away from coal of another grade."""
    lo, hi = a, b
    for seg in lots:
        if seg["grade"] is None or seg["grade"] == grade:
            continue
        if seg["to_m"] <= a:
            lo = max(lo, seg["to_m"] + min_gap)
        elif seg["from_m"] >= b:
            hi = min(hi, seg["from_m"] - min_gap)
    return lo, hi


def _slots(space: dict, reachable: set[str], grade: str, layout: dict) -> tuple[list[dict], list[str]]:
    slots: list[dict] = []
    gaps: list[str] = []
    for pid, pile in space["piles"].items():
        if pid not in reachable:
            continue
        if pile["unplaced"]:
            gaps.append(f"구간 미확인: {_pile_label(pid)}")
            continue
        for a, b in pile["gaps"]:
            lo, hi = _usable(pile["lots"], a, b, grade, layout["min_gap_m"])
            if hi - lo <= 0:
                continue
            slots.append({"kind": "pile", "pid": pid, "label": _pile_label(pid), "yard": pile["yard"],
                          "from": lo, "to": hi, "t_per_m": pile["t_per_m"], "mock": pile["t_per_m_mock"],
                          "lots": pile["lots"], "capacity": (hi - lo) * pile["t_per_m"]})
    for name, shed in space["sheds"].items():
        if name not in reachable:
            continue
        cells = shed["cells"]
        for i in range(1, SHED_CELLS + 1):
            if cells[i] is not None:
                continue
            near = [cells[j] for j in (i - 1, i + 1) if j in cells and cells[j] is not None]
            slots.append({"kind": "shed", "label": f"Shed {name} {i}칸", "yard": SHED_YARD,
                          "near": near, "capacity": layout["shed_cell_t"]})
    return slots, gaps


def _pile_near(slot: dict, a: float, b: float, min_gap: float) -> list[dict]:
    return [s for s in slot["lots"] if max(s["from_m"] - b, a - s["to_m"], 0) < min_gap - _EPS]


def _check(near: list[dict], grade: str, layout: dict) -> dict | None:
    """None when an other-grade neighbour excludes the place, else neighbour notes."""
    warnings: list[str] = []
    risky = False
    for seg in near:
        if seg["grade"] is None:
            warnings.append("옆 구간 원탄 등급 미확인")
        elif seg["grade"] != grade:
            return None
        age, temp = seg.get("age_days"), seg.get("temperature_c")
        if _number(age) and age >= layout["old_age_days"]:
            risky = True
            warnings.append(f"옆 구간 {seg.get('coal_name')} 원탄 적치 {age}일")
        if _number(temp) and temp >= layout["hot_temperature_c"]:
            risky = True
            warnings.append(f"옆 구간 {seg.get('coal_name')} 원탄 {temp}°C")
    return {"risky": risky, "warnings": warnings}


def _place(slot: dict, tonnes: float, grade: str, layout: dict, whole: bool = False) -> dict | None:
    """Placement of `tonnes` from the front of the slot's usable part (or all of it)."""
    if slot["kind"] == "shed":
        if tonnes > slot["capacity"] + 1e-9:
            return None
        check = _check(slot["near"], grade, layout)
        if check is None:
            return None
        return {"placement": {"yard": slot["yard"], "target": slot["label"], "from_m": None, "to_m": None,
                              "tonnes": _t(tonnes)}, "slot": slot, **check}
    lo, hi = slot["from"], slot["to"]
    if not whole:
        length = math.ceil(round(tonnes / slot["t_per_m"] / 0.5, 9)) * 0.5
        if length > hi - lo:
            return None
        hi = lo + length
    check = _check(_pile_near(slot, lo, hi, layout["min_gap_m"]), grade, layout)
    if check is None:
        return None
    return {"placement": {"yard": slot["yard"], "target": slot["label"], "from_m": _t(lo), "to_m": _t(hi),
                          "tonnes": _t(tonnes)}, "slot": slot, **check}


def _option(parts: list[dict], cargo: dict) -> dict:
    destination = cargo["destination_yard"]
    yards = {p["placement"]["yard"] for p in parts}
    matches = destination is not None and yards == {destination}
    risky = any(p["risky"] for p in parts)
    reasons: list[str] = []
    if matches:
        reasons.append(f"{destination}저탄장(목적지)")
    if len(parts) == 1:
        reasons.append("한 곳에 모두 적치")
    if not risky:
        reasons.append("옆 구간에 오래되거나 뜨거운 원탄 없음")
    warnings: list[str] = []
    for p in parts:
        warnings.extend(p["warnings"])
    if cargo["cv"] is None:
        warnings.append("열량 미확인")
    assumptions = ["반입 경로 모의 설비"]
    piles = [p["slot"] for p in parts if p["slot"]["kind"] == "pile"]
    if piles:
        assumptions.append("Pile 길이 모의 값")
        assumptions.extend(f"모의 m당 톤수: {slot['label']}" for slot in piles if slot["mock"])
    if any(p["slot"]["kind"] == "shed" for p in parts):
        assumptions.append("Shed 칸 용량 모의 값")
    leftover = sum(p["slot"]["capacity"] for p in parts) - cargo["tonnes"]
    targets = [p["placement"]["target"] for p in parts]
    key = (0 if destination is None or matches else 1, len(parts), 1 if risky else 0, round(leftover, 6), targets)
    return {
        "key": key,
        "option": {
            "placements": [p["placement"] for p in parts],
            "reasons": reasons,
            "warnings": list(dict.fromkeys(warnings)),
            "assumptions": list(dict.fromkeys(assumptions)),
        },
    }


def _largest(slots: list[dict], grade: str, layout: dict) -> dict | None:
    best = None
    for slot in slots:
        found = _place(slot, slot["capacity"], grade, layout, whole=True)
        if found and (best is None or slot["capacity"] > best["slot"]["capacity"]):
            best = found
    return best["placement"] if best else None


def recommend(cargo: dict, baseline: dict, layout: dict, routes: dict[int, set[str]]) -> dict:
    cargo = validate_cargo(cargo)
    lots = (baseline or {}).get("lots") or []
    result = {"as_of": (baseline or {}).get("as_of"), "cargo": cargo, "options": [], "no_fit": None,
              "gaps": [], "blocked": None}
    if not lots:
        result["blocked"] = "기준재고 없음"
        return result
    grade = cargo["grade"]
    if grade is None:
        result["blocked"] = "고/저 구분 미확인"
        return result
    slots, gaps = _slots(yard_space(lots, layout), routes.get(cargo["berth"], set()), grade, layout)
    result["gaps"] = gaps
    tonnes = cargo["tonnes"]
    built = [_option([p], cargo) for s in slots if (p := _place(s, tonnes, grade, layout))]
    if not built:
        pairs: dict[frozenset, dict] = {}
        for i, first in enumerate(slots):
            if first["capacity"] >= tonnes:
                continue
            head = _place(first, first["capacity"], grade, layout, whole=True)
            if head is None:
                continue
            for j, second in enumerate(slots):
                if i == j or second["yard"] != first["yard"]:
                    continue
                tail = _place(second, tonnes - _t(first["capacity"]), grade, layout)
                if tail is None:
                    continue
                candidate = _option([head, tail], cargo)
                pair = frozenset((i, j))
                if pair not in pairs or candidate["key"] < pairs[pair]["key"]:
                    pairs[pair] = candidate
        built = list(pairs.values())
    built.sort(key=lambda item: item["key"])
    result["options"] = [{"rank": n, **item["option"]} for n, item in enumerate(built[:MAX_OPTIONS], start=1)]
    if not result["options"]:
        result["no_fit"] = {"message": "들어갈 빈 곳 없음", "largest": _largest(slots, grade, layout)}
    return result
