"""수급 예측 화면의 한국어 지시를 계산 조건(JSON)으로 바꾼다.

LLM은 조건 해석만 맡고 재고·접안 계산은 화면의 계산 엔진이 한다. LLM 결과는 아래 검증을 통과한
항목만 돌려준다. LLM을 쓰지 않거나 실패하면 화면이 규칙 기반 해석으로 대신한다.

설정(ZGX 환경 변수, Git에 넣지 않는다)
- GENFORECAST_ASSISTANT_LLM=1 : 사용
- OPENAI_API_KEY : OpenAI API 키
- GENFORECAST_ASSISTANT_MODEL : 기본 gpt-5.5
"""
from __future__ import annotations

import json
import os
from typing import Any, Callable

DEFAULT_MODEL = "gpt-5.5"
KINDS = ("delay", "outage", "load", "strategy")
STRATEGIES = ("calorific", "price", "environment", "fifo")
STRATEGY_LABEL = {"calorific": "발열량 우선", "price": "가격 우선", "environment": "환경 우선", "fifo": "선입선출"}


class AssistantUnavailable(RuntimeError):
    """LLM을 쓸 수 없음(미설정·호출 실패·거절). 화면은 규칙 해석으로 대신한다."""


def enabled() -> bool:
    return os.getenv("GENFORECAST_ASSISTANT_LLM") == "1"


SYSTEM = """당신은 발전소 석탄 수급 예측 화면의 조건 해석기입니다. 담당자의 한국어 지시를 계산 조건 목록으로 바꿉니다.
계산이나 추천은 하지 않습니다. 지시에 없는 조건을 만들지 않습니다.

시간 기준: 기준시각은 D+0 00시(KST)입니다. 시간(hour)은 기준시각부터의 경과 시간, 날(day)은 D+N의 N입니다.
'오늘'=D+0, '내일'=D+1, '모레'=D+2입니다. 시각 없이 '오전'이면 06~12시, '오후'면 12~18시로 봅니다.
기간이 없는 설비 정지는 12시간으로 봅니다. 'N주간'은 시작일부터 7N일, '다음 주까지'는 D+0~D+7입니다.

조건 종류(kind)
- delay: 선박 입항 지연. vessel_id는 반드시 context.vessels의 id 중 하나, days는 지연 일수(음수면 앞당김).
- outage: 부두 설비(CV·컨베이어·하역기·CSU) 정지. berth는 context.berths 중 하나, from_hour·to_hour, factor는 0(완전 정지)~0.9(속도 비율, 하역기 한 대만 멈추면 0.5).
- load: 석탄 발전량 변화. from_day·to_day, pct는 증감 퍼센트(감소는 음수).
- strategy: 상탄·혼탄 전략. strategy는 calorific(발열량 우선), price(가격·저열량 위주), environment(환경·저황), fifo(선입선출) 중 하나. from_day, to_day(끝이 없으면 null).

쓰지 않는 필드는 null로 둡니다. 각 조건의 explanation에 담당자가 확인할 한 줄 설명을 씁니다.
해석할 수 없는 부분은 unparsed에 원문 그대로 넣습니다. reply에는 담당자에게 보여 줄 짧은 확인 문장을 씁니다."""

_nullable = lambda t: {"type": [t, "null"]}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "vessel_id": _nullable("string"),
                    "days": _nullable("number"),
                    "berth": _nullable("integer"),
                    "from_hour": _nullable("integer"),
                    "to_hour": _nullable("integer"),
                    "factor": _nullable("number"),
                    "from_day": _nullable("integer"),
                    "to_day": _nullable("integer"),
                    "pct": _nullable("number"),
                    "strategy": {"type": ["string", "null"], "enum": [*STRATEGIES, None]},
                    "note": _nullable("string"),
                    "explanation": {"type": "string"},
                },
                "required": ["kind", "vessel_id", "days", "berth", "from_hour", "to_hour", "factor",
                             "from_day", "to_day", "pct", "strategy", "note", "explanation"],
                "additionalProperties": False,
            },
        },
        "unparsed": {"type": "array", "items": {"type": "string"}},
        "reply": {"type": "string"},
    },
    "required": ["changes", "unparsed", "reply"],
    "additionalProperties": False,
}


def _num(value: Any, lo: float, hi: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if lo <= value <= hi else None


def validate(raw: dict, context: dict) -> dict:
    """LLM 출력을 화면 조건 형식으로 바꾼다. 범위·목록을 벗어난 항목은 버리고 이유를 남긴다."""
    horizon = int(context["horizon_days"])
    vessels = {v["id"]: v["name"] for v in context["vessels"]}
    berths = set(context["berths"])
    changes: list[dict] = []
    explanations: list[str] = []
    rejected: list[str] = [str(x)[:200] for x in raw.get("unparsed", []) if isinstance(x, str)]
    for item in raw.get("changes", []) if isinstance(raw.get("changes"), list) else []:
        if not isinstance(item, dict):
            continue
        kind, text = item.get("kind"), str(item.get("explanation") or "")[:200]
        change: dict | None = None
        if kind == "delay":
            days = _num(item.get("days"), -10, 30)
            if item.get("vessel_id") in vessels and days:
                change = {"kind": "delay", "vesselId": item["vessel_id"], "vesselName": vessels[item["vessel_id"]], "days": days}
        elif kind == "outage":
            start, end = _num(item.get("from_hour"), 0, horizon * 24), _num(item.get("to_hour"), 1, horizon * 24 + 24 * 14)
            factor = _num(item.get("factor") if item.get("factor") is not None else 0, 0, 0.9)
            if item.get("berth") in berths and start is not None and end is not None and end > start and factor is not None:
                note = str(item.get("note") or f"{item['berth']}부두 설비 정지")[:60]
                change = {"kind": "outage", "berth": item["berth"], "from": int(start), "to": int(end), "factor": factor, "note": note}
        elif kind == "load":
            start, end, pct = _num(item.get("from_day"), 0, horizon), _num(item.get("to_day"), 0, horizon), _num(item.get("pct"), -60, 60)
            if start is not None and end is not None and end >= start and pct:
                change = {"kind": "load", "fromDay": int(start), "toDay": int(end), "pct": pct, "note": str(item.get("note") or "지시 입력")[:60]}
        elif kind == "strategy":
            start = _num(item.get("from_day"), 0, horizon)
            end = item.get("to_day")
            end = None if end is None else _num(end, 0, horizon)
            if item.get("strategy") in STRATEGIES and start is not None and (item.get("to_day") is None or (end is not None and end >= start)):
                change = {"kind": "strategy", "fromDay": int(start), "toDay": None if end is None else int(end), "strategy": item["strategy"]}
        if change:
            changes.append(change)
            explanations.append(text or kind)
        else:
            rejected.append(f"확인 불가: {text or kind}")
    return {"changes": changes, "explanations": explanations, "unparsed": rejected, "reply": str(raw.get("reply") or "")[:300]}


def _call_openai(text: str, context: dict) -> dict:
    import openai  # 선택 기능이라 필요할 때만 불러온다.

    client = openai.OpenAI(timeout=25.0, max_retries=1)
    try:
        response = client.responses.create(
            model=os.getenv("GENFORECAST_ASSISTANT_MODEL", DEFAULT_MODEL),
            instructions=SYSTEM,
            input="context:\n" + json.dumps(context, ensure_ascii=False) + "\n\n지시:\n" + text,
            reasoning={"effort": "low"},
            text={"format": {"type": "json_schema", "name": "forecast_changes", "schema": SCHEMA, "strict": True}},
            store=False,
        )
    except openai.APIConnectionError as exc:
        raise AssistantUnavailable("LLM 서버에 연결하지 못했습니다.") from exc
    except openai.RateLimitError as exc:
        raise AssistantUnavailable("LLM 호출 한도를 넘었습니다.") from exc
    except openai.APIStatusError as exc:
        raise AssistantUnavailable(f"LLM 호출 실패({exc.status_code})") from exc
    if response.status != "completed" or not response.output_text:
        raise AssistantUnavailable("LLM 응답이 완료되지 않았습니다.")
    try:
        return json.loads(response.output_text)
    except json.JSONDecodeError as exc:
        raise AssistantUnavailable("LLM 응답 형식이 올바르지 않습니다.") from exc


def interpret(text: str, context: dict, call: Callable[[str, dict], dict] | None = None) -> dict:
    if call is None:
        if not enabled():
            raise AssistantUnavailable("LLM 해석이 설정되지 않았습니다.")
        call = _call_openai
    result = validate(call(text, context), context)
    result["source"] = "llm"
    result["model"] = os.getenv("GENFORECAST_ASSISTANT_MODEL", DEFAULT_MODEL)
    return result
