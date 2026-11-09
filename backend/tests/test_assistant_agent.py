import json
import sqlite3
from datetime import datetime

import pytest

from midterm.assistant.agent import ask
from midterm.assistant.llm import FakeLlm, LlmTurn, ToolCall
from midterm.assistant.tools import ToolContext
from midterm.supply import KST
from test_assistant_tools import tmp_registry  # noqa: F401

LV = {'status': None, 'from_day': None, 'to_day': None}


def final(answer, facts=(), gaps=()):
    return {'answer': answer, 'facts': list(facts), 'proposals': [], 'gaps': list(gaps)}


def fact(value, call_id):
    return {'label': '값', 'value': value, 'unit': None, 'as_of': '2026-11-09 09:00', 'source': 'actual',
            'tool_call_id': call_id}


def boom(*_):
    raise sqlite3.OperationalError('database is locked')


@pytest.fixture
def tmp_ctx(tmp_registry):  # noqa: F811
    return ToolContext(request=None, now=datetime(2026, 11, 9, 9, 0, tzinfo=KST), db_path=tmp_registry)


def test_tool_then_final_answer(tmp_ctx):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('당진행 입항 예정은 2건입니다.', facts=[fact(2, 'c1')]))])
    out = ask('입항 예정 몇 척?', [], tmp_ctx, llm)
    assert out['partial'] is False and out['tool_calls'][0]['ok'] is True and out['facts'][0]['tool_call_id'] == 'c1'
    assert json.loads(llm.calls[1][-1]['content'])['ok'] is True


def test_unknown_vessel_goes_to_gaps(tmp_ctx):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('원장에서 OCEAN호를 찾지 못했습니다.', facts=[], gaps=['원장에 없는 선박: OCEAN']))])
    out = ask('OCEAN호 언제 와?', [], tmp_ctx, llm)
    assert out['gaps'] == ['원장에 없는 선박: OCEAN'] and out['facts'] == []


def test_tool_exception_reaches_llm(monkeypatch, tmp_ctx):
    monkeypatch.setattr('midterm.assistant.tools.snapshot', boom)
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('조회하지 못했습니다.', gaps=['항차 원장 조회 실패']))])
    out = ask('입항 예정?', [], tmp_ctx, llm)
    assert json.loads(llm.calls[1][-1]['content'])['ok'] is False and out['tool_calls'][0]['ok'] is False


def test_invented_number_retry_then_fallback(tmp_ctx):
    bad = final('재고는 98,000 t', facts=[fact(123456, 'c1')])
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'stock_snapshot', {'at': None})], None), LlmTurn([], bad), LlmTurn([], bad)])
    out = ask('재고?', [], tmp_ctx, llm)
    assert out['answer'] == '아래 근거 표를 확인해 주세요.' and out['facts'][0]['value'] == 123456


def test_tool_limit_and_timeout_end_partial(tmp_ctx):
    import itertools
    loop = [LlmTurn([ToolCall(f'c{i}', 'waiting_vessels', {})], None) for i in range(9)]
    out = ask('계속', [], tmp_ctx, FakeLlm(loop))
    assert out['partial'] is True and len(out['tool_calls']) == 6 and out['facts'] == []
    ticks = itertools.chain(iter([0, 10, 61, 62, 63, 64]), itertools.repeat(1000))
    out2 = ask('느림', [], tmp_ctx, FakeLlm(loop), clock=lambda: next(ticks))
    assert out2['partial'] is True


def test_unknown_call_id_dropped_and_long_question_rejected(tmp_ctx):
    assert ask('q', [], tmp_ctx, FakeLlm([LlmTurn([], final('답', facts=[fact(1, 'nope')]))]))['facts'] == []
    with pytest.raises(ValueError):
        ask('가' * 1001, [], tmp_ctx, FakeLlm([]))
