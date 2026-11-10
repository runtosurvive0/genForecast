"""접안 추천 API. 읽기 전용이며 항차 원장·기준재고를 저장하지 않는다."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from midterm import database
from midterm.berth_plan import recommend_berth_plan
from midterm.berth_plan.inputs import BerthInputs, load_inputs
from midterm.berth_plan.plan import parse_penalty
from midterm.supply import now, timestamp
from midterm.voyage_registry import RegistryError
from midterm.web.auth_api import get_store

router = APIRouter(prefix="/api/berth-plan", tags=["접안 추천"])
logger = logging.getLogger(__name__)

BODY_KEYS = {"horizon_days", "penalty_usd", "locks"}
LOCK_KEYS = {"voyage_no", "berth_id", "berth_at"}
INTERNAL_ERROR = "내부 오류(서버 로그 확인)"


def get_berth_plan_path(request: Request) -> Path:
    # 재정의는 격리된 시험 앱에서만 설정하며 HTTP 호출자는 바꿀 수 없다.
    return Path(getattr(request.app.state, "voyage_registry_path", database.DATABASE))


def _user_id(request: Request) -> str:
    session = getattr(request.state, "session", None)
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    user_id = session["user"]["id"]
    get_store(request).rate_limit("berth-plan:" + user_id, 20, 60)
    return user_id


def parse_options(body) -> tuple[int, float, list]:
    if not isinstance(body, dict):
        raise ValueError("요청 형식이 올바르지 않습니다")
    unknown = sorted(set(body) - BODY_KEYS)
    if unknown:
        raise ValueError("알 수 없는 항목: " + ", ".join(map(str, unknown)))
    horizon = body.get("horizon_days", 14)
    if not isinstance(horizon, int) or isinstance(horizon, bool) or not 1 <= horizon <= 30:
        raise ValueError("기간(horizon_days)은 1~30 사이 정수여야 합니다")
    penalty = parse_penalty(body.get("penalty_usd", 20000))
    locks = body.get("locks", [])
    if not isinstance(locks, list):
        raise ValueError("고정(locks)은 목록이어야 합니다")
    return horizon, penalty, locks


def validate_locks(locks: list, inputs: BerthInputs) -> list[dict]:
    voyages = {v.voyage_no: v for v in inputs.voyages}
    out = []
    for lock in locks:
        if not isinstance(lock, dict) or set(lock) != LOCK_KEYS:
            raise ValueError("고정 항목은 voyage_no, berth_id, berth_at를 모두 가진 객체여야 합니다")
        no, berth, at = lock["voyage_no"], lock["berth_id"], lock["berth_at"]
        if not isinstance(no, str) or no not in voyages:
            raise ValueError(f"고정할 항차를 찾을 수 없습니다: {no}")
        if not isinstance(berth, str) or berth not in inputs.berths:
            raise ValueError(f"고정할 부두를 찾을 수 없습니다: {berth}")
        voyage = voyages[no]
        if berth not in voyage.allowed:
            raise ValueError(f"{no} 항차는 {berth} 부두에 접안할 수 없습니다(저탄장 불일치)")
        if not isinstance(at, str):
            raise ValueError("접안 시각(berth_at)은 ISO 형식 문자열이어야 합니다")
        try:
            when = timestamp(at)
        except ValueError:
            raise ValueError(f"접안 시각 형식이 올바르지 않습니다: {at}") from None
        if when < voyage.eta:
            raise ValueError(f"{no} 항차의 접안 시각이 입항 예정 시각보다 이릅니다")
        out.append({"voyage_no": no, "berth_id": berth, "berth_at": when})
    return out


@router.post("/recommend")
def post_recommend(request: Request, body=Body(...), db_path: Path = Depends(get_berth_plan_path)) -> dict:
    _user_id(request)
    # 입력 오류(본문·lock)만 422다. 읽기·계산 중 예외는 ValueError라도 500으로 숨기고 로그에 남긴다.
    try:
        horizon, penalty, raw_locks = parse_options(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        inputs = load_inputs(db_path, now(), horizon)
    except RegistryError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except Exception:
        logger.exception("Berth plan inputs failed")
        raise HTTPException(500, INTERNAL_ERROR) from None
    try:
        locks = validate_locks(raw_locks, inputs)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        return recommend_berth_plan(inputs, penalty, locks)
    except Exception:
        logger.exception("Berth plan recommendation failed")
        raise HTTPException(500, INTERNAL_ERROR) from None
