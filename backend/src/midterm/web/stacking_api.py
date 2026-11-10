"""저탄장 적치 추천 API. 읽기 전용이며 재고·원장·기준재고를 저장하지 않는다."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from midterm import database
from midterm.dummy_data.profiles import load_profiles
from midterm.stacking import load_layout, load_routes, recommend, validate_cargo
from midterm.stacking.registry_cargo import cargo_from_voyage, waiting_voyages
from midterm.stock_baseline import read_baseline
from midterm.voyage_registry import RegistryError, snapshot
from midterm.web.auth_api import get_store

router = APIRouter(prefix="/api/stacking", tags=["저탄장 적치 추천"])
logger = logging.getLogger(__name__)


def get_stacking_paths(request: Request) -> Path:
    # 재정의는 격리된 시험 앱에서만 설정하며 HTTP 호출자는 바꿀 수 없다.
    return Path(getattr(request.app.state, "voyage_registry_path", database.DATABASE))


def _user_id(request: Request) -> str:
    session = getattr(request.state, "session", None)
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    user_id = session["user"]["id"]
    get_store(request).rate_limit("stacking:" + user_id, 60, 60)
    return user_id


def _read_inputs(db_path: Path) -> tuple[dict, dict]:
    try:
        return snapshot(db_path), read_baseline(db_path)
    except RegistryError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.post("/recommend")
def post_recommend(request: Request, body=Body(...), db_path: Path = Depends(get_stacking_paths)) -> dict:
    _user_id(request)
    try:
        if not isinstance(body, dict):
            raise ValueError("요청 형식이 올바르지 않습니다")
        if "voyage_no" in body and len(body) > 1:
            raise ValueError("항차 번호와 화물 정보를 함께 보낼 수 없습니다")
        if "voyage_no" in body:
            voyage_no = body["voyage_no"]
            if not isinstance(voyage_no, str) or not voyage_no:
                raise ValueError("항차 번호를 확인하세요")
            register, baseline = _read_inputs(db_path)
            cargo, blocked = cargo_from_voyage(voyage_no, register, baseline, load_profiles())
            if blocked:
                return {"as_of": baseline.get("as_of"), "cargo": None, "options": [], "no_fit": None,
                        "gaps": [], "blocked": blocked}
        else:
            cargo = validate_cargo(body)
            baseline = read_baseline(db_path)
        return recommend(cargo, baseline, load_layout(), load_routes())
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        logger.exception("Stacking recommendation failed")
        raise HTTPException(500, "내부 오류(서버 로그 확인)") from None


@router.get("/candidates")
def get_candidates(request: Request, db_path: Path = Depends(get_stacking_paths)) -> dict:
    _user_id(request)
    try:
        register, baseline = _read_inputs(db_path)
        return {"as_of": baseline.get("as_of"), "items": waiting_voyages(register, baseline, load_profiles())}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Stacking candidates failed")
        raise HTTPException(500, "내부 오류(서버 로그 확인)") from None
