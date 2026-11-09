"""LLM 어댑터. 에이전트 루프는 step()만 반복 호출한다."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..demo_assistant import DEFAULT_MODEL, AssistantUnavailable


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LlmTurn:
    tool_calls: list[ToolCall] = field(default_factory=list)
    final: dict | None = None


class Llm(Protocol):
    def step(self, system: str, messages: list[dict], tools: list[dict], final_schema: dict, timeout_s: float) -> LlmTurn: ...


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _to_input(messages: list[dict]) -> list[dict]:
    items: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            items.append({"type": "function_call_output", "call_id": m["tool_call_id"], "output": m["content"]})
        elif m.get("tool_calls"):
            for c in m["tool_calls"]:
                items.append({
                    "type": "function_call", "call_id": c.id, "name": c.name,
                    "arguments": json.dumps(c.arguments, ensure_ascii=False),
                })
        else:
            items.append({"role": role, "content": m["content"]})
    return items


class OpenAiLlm:
    def __init__(self, client: Any = None):
        self._client = client

    def step(self, system: str, messages: list[dict], tools: list[dict], final_schema: dict, timeout_s: float) -> LlmTurn:
        client = self._client
        if client is None:
            import openai  # 선택 기능이라 필요할 때만 불러온다.

            client = openai.OpenAI(timeout=timeout_s, max_retries=1)
        kwargs: dict[str, Any] = {
            "model": os.getenv("GENFORECAST_ASSISTANT_MODEL", DEFAULT_MODEL),
            "instructions": system,
            "input": _to_input(messages),
            "text": {"format": {"type": "json_schema", "name": "assistant_answer", "schema": final_schema, "strict": True}},
            "store": False,
        }
        if tools:
            kwargs["tools"] = [
                {"type": "function", "name": t["name"], "description": t["description"],
                 "parameters": t["parameters"], "strict": False}
                for t in tools
            ]
        try:
            response = client.responses.create(**kwargs)
        except AssistantUnavailable:
            raise
        except Exception as exc:
            raise AssistantUnavailable("LLM 호출에 실패했습니다.") from exc
        return self._parse(response)

    @staticmethod
    def _parse(response: Any) -> LlmTurn:
        output = _get(response, "output") or []
        calls: list[ToolCall] = []
        for item in output:
            if _get(item, "type") == "function_call":
                try:
                    args = json.loads(_get(item, "arguments") or "{}")
                except json.JSONDecodeError as exc:
                    raise AssistantUnavailable("LLM 도구 인자 형식이 올바르지 않습니다.") from exc
                if not isinstance(args, dict):
                    raise AssistantUnavailable("LLM 도구 인자 형식이 올바르지 않습니다.")
                calls.append(ToolCall(_get(item, "call_id"), _get(item, "name"), args))
        if calls:
            return LlmTurn(calls, None)
        for item in output:
            for part in _get(item, "content") or []:
                if _get(part, "type") == "refusal":
                    raise AssistantUnavailable("LLM이 답변을 거절했습니다.")
        status = _get(response, "status")
        text = _get(response, "output_text")
        if (status is not None and status != "completed") or not text:
            raise AssistantUnavailable("LLM 응답이 완료되지 않았습니다.")
        try:
            final = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AssistantUnavailable("LLM 응답 형식이 올바르지 않습니다.") from exc
        if not isinstance(final, dict):
            raise AssistantUnavailable("LLM 응답 형식이 올바르지 않습니다.")
        return LlmTurn([], final)


def default_llm() -> Llm:
    if os.getenv("GENFORECAST_ASSISTANT_LLM") != "1":
        raise AssistantUnavailable("도우미가 설정되지 않았습니다")
    return OpenAiLlm()


class FakeLlm:
    def __init__(self, script: list[LlmTurn | Exception]):
        self._script = list(script)
        self.calls: list[list[dict]] = []

    def step(self, system: str, messages: list[dict], tools: list[dict], final_schema: dict, timeout_s: float) -> LlmTurn:
        self.calls.append([dict(m) for m in messages])
        if not self._script:
            raise AssistantUnavailable("가짜 응답 소진")
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
