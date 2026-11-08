"""수급 예측 화면의 자연어 지시 해석 API. 조건만 돌려주고 공용 자료는 바꾸지 않는다."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from midterm import demo_assistant
from midterm.web.auth_api import get_store

router = APIRouter(prefix="/api/demo-forecast", tags=["수급 예측 어시스턴트"])


class VesselRef(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    eta_hour: float = Field(ge=-24 * 60, le=24 * 400, allow_inf_nan=False)


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    horizon_days: int = Field(ge=1, le=120)
    berths: list[int] = Field(min_length=1, max_length=10)
    vessels: list[VesselRef] = Field(max_length=200)


@router.get("/assistant")
def assistant_status() -> dict:
    return {"llm": demo_assistant.enabled(), "model": demo_assistant.DEFAULT_MODEL if demo_assistant.enabled() else None}


@router.post("/interpret")
async def interpret(body: InterpretRequest, request: Request) -> dict:
    session = getattr(request.state, "session", None)
    if session:  # 외부 LLM 비용을 보호하려고 사용자별 호출 수를 제한한다.
        await run_in_threadpool(get_store(request).rate_limit, "assistant:" + session["user"]["id"], 20, 60)
    context = {"horizon_days": body.horizon_days, "berths": body.berths, "vessels": [v.model_dump() for v in body.vessels]}
    try:
        return await run_in_threadpool(demo_assistant.interpret, body.text, context)
    except demo_assistant.AssistantUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
