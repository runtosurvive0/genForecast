"""simulate_scenario: 도착 지연·부하 증감 가정을 기존 공급 전망 계산에 얹어 비교한다.

원본 데이터는 바꾸지 않고 복사본에만 조건을 적용한다. 부두 설비 정지·상탄 전략은 백엔드 모델이 없어 계산하지 않는다.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Callable

from midterm.supply import timestamp

UNSUPPORTED = {
    "outage": "부두 설비 정지는 아직 백엔드 전망에 반영되지 않습니다",
    "strategy": "상탄 전략은 아직 백엔드 전망에 반영되지 않습니다",
}


class ScenarioError(ValueError):
    """가정 조건이 올바르지 않을 때. 메시지는 사용자에게 그대로 보인다."""


def _number(change: dict, key: str) -> float:
    value = change.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ScenarioError(f"조건 값이 올바르지 않습니다: {key}")
    return value


def _check(change) -> None:
    if not isinstance(change, dict):
        raise ScenarioError("조건 형식이 올바르지 않습니다")
    kind = change.get("kind")
    if not isinstance(kind, str):
        raise ScenarioError("조건 종류가 올바르지 않습니다")
    if kind == "delay":
        if not isinstance(change.get("vesselId"), str) or not change["vesselId"]:
            raise ScenarioError("조건 값이 올바르지 않습니다: vesselId")
        days = _number(change, "days")
        if days != int(days) or not -10 <= days <= 30:
            raise ScenarioError("도착 지연은 -10일에서 30일 사이 정수로 입력하세요")
    elif kind == "load":
        first, last, pct = _number(change, "fromDay"), _number(change, "toDay"), _number(change, "pct")
        if first > last or first < 0:
            raise ScenarioError("부하 변경 기간이 올바르지 않습니다")
        if not -60 <= pct <= 60:
            raise ScenarioError("부하 변경률은 -60%에서 60% 사이로 입력하세요")
    elif kind not in UNSUPPORTED:
        raise ScenarioError(f"알 수 없는 조건 종류입니다: {kind}")


def apply_changes(changes: list[dict], as_of: datetime) -> tuple[Callable[[dict, dict], tuple[dict, dict]], list[str]]:
    """(adjust 함수, 계산하지 못한 조건 설명 목록)을 돌려준다. 조건이 잘못되면 ScenarioError."""
    for change in changes:
        _check(change)
    unsupported: list[str] = []
    for change in changes:
        text = UNSUPPORTED.get(change["kind"])
        if text and text not in unsupported:
            unsupported.append(text)
    delays = [c for c in changes if c["kind"] == "delay"]
    loads = [c for c in changes if c["kind"] == "load"]
    origin_at = timestamp(as_of)
    origin = origin_at.date()

    def adjust(data: dict, plan: dict) -> tuple[dict, dict]:
        vessels = list(data["vessels"])
        for change in delays:
            index = next((i for i, v in enumerate(vessels) if str(v["id"]) == change["vesselId"]), None)
            if index is None:
                raise ScenarioError(f"선박을 찾을 수 없습니다: {change['vesselId']}")
            visited = {r["vessel_id"] for r in data.get("port_visits", []) if timestamp(r["arrived_at"]) <= origin_at}
            if vessels[index]["id"] in visited:
                note = f"이미 입항이 관측된 선박은 입항 지연을 반영하지 않습니다: {vessels[index].get('name')}"
                if note not in unsupported:
                    unsupported.append(note)
                continue
            shift = timedelta(days=change["days"])
            moved = dict(vessels[index])
            for key in ("arrival_at", "start_at"):
                if moved.get(key):
                    moved[key] = (timestamp(moved[key]) + shift).isoformat()
            moved["points"] = [{**p, "at": (timestamp(p["at"]) + shift).isoformat()} for p in moved["points"]]
            vessels[index] = moved
        data = {**data, "vessels": vessels}
        if loads:
            plan = {hour: dict(rows) for hour, rows in plan.items()}
            for change in loads:
                factor = 1 + change["pct"] / 100
                applied = 0
                for hour, rows in plan.items():
                    offset = (timestamp(hour).date() - origin).days
                    if change["fromDay"] <= offset <= change["toDay"]:
                        for unit, row in rows.items():
                            if row.get("online"):
                                rows[unit] = {**row, "mw": row["mw"] * factor}
                                applied += 1
                if not applied:
                    note = f"발전량 변경을 적용할 계획 구간이 없습니다 (D+{change['fromDay']}~D+{change['toDay']})"
                    if note not in unsupported:
                        unsupported.append(note)
        return data, plan

    return adjust, unsupported
