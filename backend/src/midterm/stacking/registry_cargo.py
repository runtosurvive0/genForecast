"""Turn voyage-registry voyages into stacking cargo requests (read-only)."""
from __future__ import annotations

import re

from midterm.stacking.space import grade_of

DESTINATION = "dangjin"
_BERTHS = {"BD-1": 1, "BD-2": 2, "BD-3": 3}
_CLASS_GRADE = {"high_cv": "고", "low_cv": "저"}


def _tonnes(row: dict):
    for key in ("planned_t", "bl_t"):
        value = row.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
    return None


def _yard(value) -> int | None:
    match = re.search(r"[1-3]", str(value)) if value is not None else None
    return int(match.group()) if match else None


def _grade(coal_name, baseline: dict, profiles: dict) -> str | None:
    for lot in baseline.get("lots") or []:
        if lot.get("coal_name") == coal_name:
            grade = grade_of(lot.get("grade"))
            if grade:
                return grade
    coal = (profiles.get("coals") or {}).get(coal_name) or {}
    return _CLASS_GRADE.get(coal.get("class"))


def _dangjin_cargo(voyage_no: str, register: dict) -> list[dict]:
    return [c for c in register.get("cargo") or []
            if c.get("voyage_no") == voyage_no and c.get("destination_plant_id") == DESTINATION]


def cargo_from_voyage(voyage_no: str, register: dict, baseline: dict, profiles: dict) -> tuple[dict | None, str | None]:
    voyage = next((v for v in register.get("voyages") or [] if v.get("voyage_no") == voyage_no), None)
    if voyage is None:
        return None, "항차 없음"
    rows = _dangjin_cargo(voyage_no, register)
    if not rows:
        return None, "당진행 화물 없음"
    coals = {r.get("coal_name") for r in rows}
    if len(coals) != 1:
        return None, "한 항차 여러 탄종"
    berth = _BERTHS.get(voyage.get("berth_id"))
    if berth is None:
        return None, "부두 미배정"
    amounts = [_tonnes(r) for r in rows]
    if any(a is None for a in amounts):
        return None, "화물 물량 미확인"
    coal_name = coals.pop()
    grade = _grade(coal_name, baseline, profiles)
    if grade is None:
        return None, "고/저 구분 미확인"
    cvs = {r.get("cv") for r in rows}
    ship = next((s for s in register.get("ships") or [] if s.get("ship_code") == voyage.get("ship_code")), None)
    return {
        "source": "registry",
        "ref": voyage_no,
        "vessel_name": (ship or {}).get("name") or voyage.get("ship_code") or voyage_no,
        "voyage_number": voyage.get("voyage_number"),
        "coal_name": coal_name,
        "grade": grade,
        "cv": cvs.pop() if len(cvs) == 1 else None,
        "tonnes": sum(amounts),
        "berth": berth,
        "destination_yard": _yard(voyage.get("yard")),
    }, None


def waiting_voyages(register: dict, baseline: dict, profiles: dict) -> list[dict]:
    stacked = {lot.get("voyage_number") for lot in baseline.get("lots") or [] if lot.get("voyage_number")}
    found = []
    for voyage in register.get("voyages") or []:
        if (voyage.get("status") != "arrived" or not voyage.get("berth_id") or voyage.get("actual_unload_end")
                or voyage.get("voyage_number") in stacked or not _dangjin_cargo(voyage["voyage_no"], register)):
            continue
        found.append(voyage)
    found.sort(key=lambda v: (v.get("planned_arrival") is None, v.get("planned_arrival") or ""))
    result = []
    for voyage in found:
        cargo, blocked = cargo_from_voyage(voyage["voyage_no"], register, baseline, profiles)
        name = (cargo or {}).get("vessel_name") or next(
            (s.get("name") for s in register.get("ships") or [] if s.get("ship_code") == voyage.get("ship_code")),
            voyage.get("ship_code"))
        result.append({"voyage_no": voyage["voyage_no"], "vessel_name": name, "cargo": cargo, "blocked": blocked})
    return result
