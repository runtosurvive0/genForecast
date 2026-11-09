from types import SimpleNamespace

import pytest

from midterm.assistant.llm import FakeLlm, Llm, LlmTurn, OpenAiLlm, ToolCall, default_llm
from midterm.assistant.tools import tool_schemas
from midterm.demo_assistant import AssistantUnavailable


class FakeOpenAiClient:
    """responses.create(**kw) 호출마다 다음 출력 목록을 SDK 응답 모양으로 돌려준다."""

    def __init__(self, outputs, error=None):
        self.outputs = list(outputs)
        self.error = error
        self.kwargs = []
        self.responses = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.kwargs.append(kw)
        if self.error:
            raise self.error
        output = self.outputs.pop(0)
        text = "".join(i.get("text", "") for i in output if i.get("type") == "message")
        return SimpleNamespace(status="completed", output=[SimpleNamespace(**i) for i in output], output_text=text)


def test_default_llm_requires_flag(monkeypatch):
    monkeypatch.delenv('GENFORECAST_ASSISTANT_LLM', raising=False)
    with pytest.raises(AssistantUnavailable, match='설정되지 않았습니다'):
        default_llm()


def test_openai_adapter_maps_tool_calls_then_final():
    client = FakeOpenAiClient([
        [{'type': 'function_call', 'call_id': 'c1', 'name': 'list_voyages', 'arguments': '{"status":null,"from_day":null,"to_day":null}'}],
        [{'type': 'message', 'text': '{"answer":"a","facts":[],"proposals":[],"gaps":[]}'}],
    ])
    llm = OpenAiLlm(client=client)
    t1 = llm.step('sys', [{'role': 'user', 'content': 'q'}], tool_schemas(), {'type': 'object'}, 20)
    assert t1 == LlmTurn([ToolCall('c1', 'list_voyages', {'status': None, 'from_day': None, 'to_day': None})], None)
    t2 = llm.step('sys', [{'role': 'user', 'content': 'q'}], tool_schemas(), {'type': 'object'}, 20)
    assert t2.final == {'answer': 'a', 'facts': [], 'proposals': [], 'gaps': []}


def test_openai_adapter_bad_json_is_unavailable():
    llm = OpenAiLlm(client=FakeOpenAiClient([[{'type': 'message', 'text': 'not json'}]]))
    with pytest.raises(AssistantUnavailable):
        llm.step('sys', [{'role': 'user', 'content': 'q'}], [], {'type': 'object'}, 20)


def test_openai_adapter_request_shape(monkeypatch):
    monkeypatch.setenv('GENFORECAST_ASSISTANT_MODEL', 'm-test')
    client = FakeOpenAiClient([[{'type': 'message', 'text': '{"answer":"a"}'}]])
    messages = [
        {'role': 'user', 'content': 'q'},
        {'role': 'assistant', 'tool_calls': [ToolCall('c1', 'list_voyages', {'status': None})]},
        {'role': 'tool', 'tool_call_id': 'c1', 'content': '{"ok":true}'},
    ]
    schema = {'type': 'object'}
    OpenAiLlm(client=client).step('sys', messages, tool_schemas(), schema, 20)
    kw = client.kwargs[0]
    assert kw['model'] == 'm-test'
    assert kw['instructions'] == 'sys'
    assert kw['input'] == [
        {'role': 'user', 'content': 'q'},
        {'type': 'function_call', 'call_id': 'c1', 'name': 'list_voyages', 'arguments': '{"status": null}'},
        {'type': 'function_call_output', 'call_id': 'c1', 'output': '{"ok":true}'},
    ]
    first = tool_schemas()[0]
    assert kw['tools'][0] == {'type': 'function', 'name': first['name'], 'description': first['description'],
                              'parameters': first['parameters'], 'strict': False}
    fmt = kw['text']['format']
    assert fmt['type'] == 'json_schema' and fmt['strict'] is True and fmt['schema'] == schema
    assert kw['store'] is False


def test_openai_adapter_api_error_and_refusal_are_unavailable():
    llm = OpenAiLlm(client=FakeOpenAiClient([], error=RuntimeError('boom')))
    with pytest.raises(AssistantUnavailable):
        llm.step('sys', [{'role': 'user', 'content': 'q'}], [], {'type': 'object'}, 20)
    refused = FakeOpenAiClient([[{'type': 'message', 'text': '', 'content': [SimpleNamespace(type='refusal', refusal='no')]}]])
    with pytest.raises(AssistantUnavailable):
        OpenAiLlm(client=refused).step('sys', [{'role': 'user', 'content': 'q'}], [], {'type': 'object'}, 20)


def test_fake_llm_scripts_turns_and_records_calls():
    turn = LlmTurn([], {'answer': 'x'})
    boom = AssistantUnavailable('실패')
    llm: Llm = FakeLlm([turn, boom])
    msgs = [{'role': 'user', 'content': 'q'}]
    assert llm.step('s', msgs, [], {}, 5) is turn
    msgs.append({'role': 'user', 'content': 'later'})
    with pytest.raises(AssistantUnavailable, match='실패'):
        llm.step('s', msgs, [], {}, 5)
    with pytest.raises(AssistantUnavailable, match='가짜 응답 소진'):
        llm.step('s', msgs, [], {}, 5)
    assert len(llm.calls[0]) == 1 and len(llm.calls[1]) == 2
