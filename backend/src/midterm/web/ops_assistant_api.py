"""LLM 운영 도우미 API. 읽기 전용 도구만 쓰며 공용 자료를 바꾸지 않는다."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, model_validator

from midterm import database
from midterm.assistant.agent import ask as run_ask
from midterm.assistant.checks import LIVE_INPUTS, run_checks
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


CONTEXT_KEYS = {"yard", "unit", "lot", "run_id", "input_id", "view"}


class AskContext(BaseModel):
    screen: Literal["blend", "forecast", "simulation", "planning_input", "scenario"]
    selection: dict[str, str | int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _limits(self):
        for key, value in self.selection.items():
            if key not in CONTEXT_KEYS:
                raise ValueError(f"허용되지 않는 맥락 키: {key}")
            if isinstance(value, str) and len(value) > 80:
                raise ValueError("맥락 값은 80자 이하여야 합니다")
        if len(json.dumps(self.model_dump(), ensure_ascii=False).encode("utf-8")) > 1024:
            raise ValueError("화면 맥락이 너무 큽니다")
        return self


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    context: AskContext | None = None


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


@router.get("/checks")
def checks(request: Request, screen: str, run_id: str | None = None, input_id: int | None = None,
           yard: int | None = Query(None, ge=1, le=3), live: str | None = None,
           ctx: ToolContext = Depends(get_tool_context)) -> dict:
    session = getattr(request.state, "session", None)
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    get_store(request).rate_limit("assistant-checks:" + session["user"]["id"], 60, 60)
    params: dict = {}
    if run_id is not None:
        params["run_id"] = run_id
    if input_id is not None:
        params["input_id"] = input_id
    if yard is not None:
        params["yard"] = yard
    if live is not None:
        names = [n for n in live.split(",") if n] if live else []
        unknown = [n for n in names if n not in LIVE_INPUTS]
        if unknown:
            raise HTTPException(422, "알 수 없는 live 입력 이름: " + ", ".join(unknown))
        params["live"] = names
    try:
        return run_checks(screen, params, ctx)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/ask")
def ask(body: AskRequest, request: Request, llm: Llm = Depends(get_llm),
        ctx: ToolContext = Depends(get_tool_context), log_path: Path = Depends(get_log_path)) -> dict:
    session = getattr(request.state, "session", None)
    if not session:
        raise HTTPException(401, "로그인이 필요합니다.")
    user_id = session["user"]["id"]
    get_store(request).rate_limit("assistant:" + user_id, 20, 60)
    try:
        result = run_ask(body.question, [m.model_dump() for m in body.history], ctx, llm,
                         context=body.context.model_dump() if body.context else None)
    except AssistantUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        record(log_path, user_id, body.question, result.get("tool_calls", []), result, now())
    except Exception:
        logger.exception("Assistant query log write failed; answer returned without log.")
    return result
