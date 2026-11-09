"""LLM 운영 도우미 API. 읽기 전용 도구만 쓰며 공용 자료를 바꾸지 않는다."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from midterm import database
from midterm.assistant.agent import ask as run_ask
from midterm.assistant.llm import AssistantUnavailable, Llm, default_llm
from midterm.assistant.log import record
from midterm.assistant.tools import ToolContext
from midterm.supply import now
from midterm.web.auth_api import get_store

router = APIRouter(prefix="/api/assistant", tags=["LLM 운영 도우미"])
logger = logging.getLogger(__name__)


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)


def get_llm() -> Llm:
    try:
        return default_llm()
    except AssistantUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


def get_log_path() -> Path:
    return database.DATABASE


def get_tool_context(request: Request) -> ToolContext:
    return ToolContext(request=request, now=now(), db_path=database.DATABASE)


@router.get("/status")
def status() -> dict:
    try:
        default_llm()
    except AssistantUnavailable:
        return {"llm": False}
    return {"llm": True}


@router.post("/ask")
def ask(body: AskRequest, request: Request, llm: Llm = Depends(get_llm),
        ctx: ToolContext = Depends(get_tool_context), log_path: Path = Depends(get_log_path)) -> dict:
    session = getattr(request.state, "session", None)
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    user_id = session["user"]["id"]
    get_store(request).rate_limit("assistant:" + user_id, 20, 60)
    try:
        result = run_ask(body.question, [m.model_dump() for m in body.history], ctx, llm)
    except AssistantUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        record(log_path, user_id, body.question, result.get("tool_calls", []), result, now())
    except Exception:
        logger.exception("Assistant query log write failed; answer returned without log.")
    return result
