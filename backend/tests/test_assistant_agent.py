import json
import sqlite3
from datetime import datetime

import pytest

from midterm.assistant.agent import ask
from midterm.assistant.llm import AssistantUnavailable, FakeLlm, LlmTurn, ToolCall
from midterm.assistant.tools import ToolContext
from midterm.supply import KST
from test_assistant_tools import tmp_registry  # noqa: F401

LV = {'status': None, 'from_day': None, 'to_day': None}
LIMIT_GAP = '도구 호출 한도 또는 시간 초과'
DASH_AS_OF = '2026-11-09T09:00:00+09:00'


def final(answer, facts=(), gaps=()):
    return {'answer': answer, 'facts': list(facts), 'proposals': [], 'gaps': list(gaps)}


def fact(value, call_id, source='actual', as_of='2026-11-09 09:00'):
    return {'label': '값', 'value': value, 'unit': None, 'as_of': as_of, 'source': source,
            'tool_call_id': call_id}


def boom(*_):
    raise sqlite3.OperationalError('database is locked')


@pytest.fixture
def tmp_ctx(tmp_registry):  # noqa: F811
    return ToolContext(request=None, now=datetime(2026, 11, 9, 9, 0, tzinfo=KST), db_path=tmp_registry)


def _dashboard(issues=(), stale=False, demo=False):
    group = {'id': 'g58', 'name': '5~8호기', 'stock': 123456, 'cv': 5500, 'days': 4.27, 'risk': 'normal',
             'baseline': {'at': '2026-11-08T00:00:00+09:00'}, 'stale': False, 'min_days': 4.27, 'min_stock': 900}
    source = {'source_name': 'MIP', 'classification': 'functional_demo' if demo else 'generation_plan'}
    return lambda horizon, at, plan_key, adjust=None: {
        'as_of': DASH_AS_OF, 'groups': [group], 'kpis': {'risk': 'normal'}, 'issues': list(issues),
        'plan_stale': stale, 'plan_source': source, 'fuel_calendar': {'daily': []}, 'forecast': []}


@pytest.fixture
def fake_dashboard(monkeypatch):
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard', _dashboard())


def test_tool_then_final_answer(tmp_ctx):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('당진행 항차는 3건입니다.', facts=[fact(3, 'c1')]))])
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


def test_invented_number_retry_then_fallback(tmp_ctx, fake_dashboard):
    bad = final('재고는 98,000 t', facts=[fact(123456, 'c1')])
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'stock_snapshot', {'at': None})], None), LlmTurn([], bad), LlmTurn([], bad)])
    out = ask('재고?', [], tmp_ctx, llm)
    assert out['answer'] == '아래 근거 표를 확인해 주세요.' and out['facts'][0]['value'] == 123456


def test_limit_then_final_answer_is_partial(tmp_ctx):
    """도구 6회 뒤 LLM이 (도구 없이) 최종 답을 주면 partial이고 한도 문구가 gaps에 한 번만 붙는다."""
    turns = [LlmTurn([ToolCall(f'c{i}', 'list_voyages', LV)], None) for i in range(6)]
    turns.append(LlmTurn([], final('항차는 3건입니다.', facts=[fact(3, 'c0'), fact(77, 'c1')], gaps=[LIMIT_GAP])))
    llm = FakeLlm(turns)
    out = ask('계속', [], tmp_ctx, llm)
    assert out['partial'] is True and len(out['tool_calls']) == 6
    assert out['answer'] == '항차는 3건입니다.'
    assert [f['value'] for f in out['facts']] == [3]  # 77은 도구 결과에 없어 버린다
    assert out['gaps'].count(LIMIT_GAP) == 1


def test_tool_calls_after_limit_still_end_partial(tmp_ctx):
    loop = [LlmTurn([ToolCall(f'c{i}', 'waiting_vessels', {})], None) for i in range(9)]
    out = ask('계속', [], tmp_ctx, FakeLlm(loop))
    assert out['partial'] is True and len(out['tool_calls']) == 6 and out['facts'] == []
    assert LIMIT_GAP in out['gaps']


def test_tool_budget_45s_switches_to_final_call_with_remaining_time(tmp_ctx):
    import itertools
    ticks = itertools.chain(iter([0, 1, 46]), itertools.repeat(47))
    llm = RecordingLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                        LlmTurn([], final('항차는 3건입니다.', facts=[fact(3, 'c1')]))])
    out = ask('느림', [], tmp_ctx, llm, clock=lambda: next(ticks))
    assert out['partial'] is True and out['facts'][0]['value'] == 3 and LIMIT_GAP in out['gaps']
    assert llm.timeouts == [59, 14] and llm.tools[1] == []


def test_no_llm_call_after_total_60s(tmp_ctx):
    import itertools
    ticks = itertools.chain(iter([0, 10]), itertools.repeat(61))
    llm = RecordingLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                        LlmTurn([], final('답'))])
    out = ask('느림', [], tmp_ctx, llm, clock=lambda: next(ticks))
    assert out['partial'] is True and len(llm.timeouts) == 1
    assert out['answer'] == '일부만 확인됨: 질문을 끝까지 처리하지 못했습니다.' and LIMIT_GAP in out['gaps']


def test_unavailable_after_limit_becomes_partial(tmp_ctx):
    turns = [LlmTurn([ToolCall(f'c{i}', 'list_voyages', LV)], None) for i in range(6)]
    turns.append(AssistantUnavailable('LLM 호출에 실패했습니다.'))
    out = ask('계속', [], tmp_ctx, FakeLlm(turns))
    assert out['partial'] is True and out['facts'] == [] and len(out['tool_calls']) == 6
    assert out['answer'] == '일부만 확인됨: 질문을 끝까지 처리하지 못했습니다.' and LIMIT_GAP in out['gaps']


def test_unavailable_during_number_rewrite_becomes_partial(tmp_ctx, fake_dashboard):
    bad = final('재고는 98,000 t', facts=[fact(123456, 'c1')])
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'stock_snapshot', {'at': None})], None), LlmTurn([], bad),
                   AssistantUnavailable('LLM 호출에 실패했습니다.')])
    out = ask('재고?', [], tmp_ctx, llm)
    assert out['partial'] is True and out['facts'] == [] and len(out['tool_calls']) == 1
    assert LIMIT_GAP in out['gaps']


def test_unavailable_on_first_call_propagates(tmp_ctx):
    with pytest.raises(AssistantUnavailable):
        ask('q', [], tmp_ctx, FakeLlm([AssistantUnavailable('LLM 호출에 실패했습니다.')]))


def test_unknown_call_id_dropped_and_long_question_rejected(tmp_ctx):
    assert ask('q', [], tmp_ctx, FakeLlm([LlmTurn([], final('답', facts=[fact(1, 'nope')]))]))['facts'] == []
    with pytest.raises(ValueError):
        ask('가' * 1001, [], tmp_ctx, FakeLlm([]))


# ---------------------------------------------------------------- F1: facts 서버 대조
def test_invented_fact_value_is_dropped(tmp_ctx):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('확인했습니다.', facts=[fact(999, 'c1'), fact(3, 'c1'), fact('ALPHA', 'c1'),
                                                         fact('OMEGA', 'c1'), fact(True, 'c1')]))])
    out = ask('항차?', [], tmp_ctx, llm)
    assert [f['value'] for f in out['facts']] == [3, 'ALPHA']


def test_source_and_as_of_come_from_tool_envelope(tmp_ctx, fake_dashboard):
    args = {'changes': [], 'horizon_days': 7}
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'simulate_scenario', args)], None),
                   LlmTurn([], final('최소 재고는 900 t입니다.', facts=[fact(900, 'c1', source='actual', as_of='아무 때')]))])
    out = ask('가정?', [], tmp_ctx, llm)
    assert out['facts'][0]['source'] == 'simulation' and out['facts'][0]['as_of'] == DASH_AS_OF


def test_nested_value_and_rounding_match(tmp_ctx, fake_dashboard):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'simulate_scenario', {'changes': [], 'horizon_days': 7})], None),
                   LlmTurn([], final('최소 4.3일, 최소 재고 900 t', facts=[fact(4.3, 'c1'), fact(900, 'c1'), fact(4.5, 'c1')]))])
    out = ask('가정?', [], tmp_ctx, llm)
    assert [f['value'] for f in out['facts']] == [4.3, 900]


def test_count_fact_matches_tool_count(tmp_ctx):
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV)], None),
                   LlmTurn([], final('3척입니다.', facts=[fact(3, 'c1')]))])
    out = ask('몇 척?', [], tmp_ctx, llm)
    assert out['facts'][0]['value'] == 3 and out['answer'] == '3척입니다.'


# ---------------------------------------------------------------- F4·F5: 서버가 gaps를 붙인다
def test_failed_tool_is_added_to_gaps_once(monkeypatch, tmp_ctx):
    monkeypatch.setattr('midterm.assistant.tools.snapshot', boom)
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'list_voyages', LV), ToolCall('c2', 'list_voyages', LV)], None),
                   LlmTurn([], final('조회하지 못했습니다.'))])
    out = ask('입항 예정?', [], tmp_ctx, llm)
    assert out['gaps'] == ['list_voyages 조회 실패: 항차 원장 조회 실패: database is locked']


def test_failed_tool_gap_on_partial_path(monkeypatch, tmp_ctx):
    monkeypatch.setattr('midterm.assistant.tools.snapshot', boom)
    loop = [LlmTurn([ToolCall(f'c{i}', 'list_voyages', LV)], None) for i in range(9)]
    out = ask('계속', [], tmp_ctx, FakeLlm(loop))
    assert out['partial'] is True
    assert out['gaps'] == ['list_voyages 조회 실패: 항차 원장 조회 실패: database is locked', LIMIT_GAP]


def test_plan_warnings_are_added_to_gaps(monkeypatch, tmp_ctx):
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard',
                        _dashboard(issues=['처별 수기 기준재고 미등록'], stale=True, demo=True))
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'stock_snapshot', {'at': None})], None),
                   LlmTurn([], final('재고를 확인했습니다.', gaps=['처별 수기 기준재고 미등록']))])
    out = ask('재고?', [], tmp_ctx, llm)
    assert out['gaps'] == ['처별 수기 기준재고 미등록', '발전계획이 최신이 아닙니다', '동작 확인용 계획 기준입니다']


# ---------------------------------------------------------------- F7: 질문·인자 숫자 허용
def test_numbers_from_question_and_args_pass_without_rewrite(tmp_ctx, fake_dashboard):
    args = {'changes': [{'kind': 'load', 'fromDay': 0, 'toDay': 6, 'pct': -20}], 'horizon_days': 7}
    answer = 'A호가 3일 늦고 부하 20% 감소 시 30일 전망 기준 최소 재고는 900 t입니다.'
    llm = FakeLlm([LlmTurn([ToolCall('c1', 'simulate_scenario', args)], None),
                   LlmTurn([], final(answer, facts=[fact(900, 'c1')]))])
    out = ask('A호가 3일 늦으면?', [], tmp_ctx, llm)
    assert out['answer'] == answer and len(llm.calls) == 2


class RecordingLlm(FakeLlm):
    def __init__(self, script):
        super().__init__(script)
        self.timeouts = []
        self.tools = []

    def step(self, system, messages, tools, final_schema, timeout_s):
        self.timeouts.append(timeout_s)
        self.tools.append(tools)
        return super().step(system, messages, tools, final_schema, timeout_s)


def _bad_script():
    bad = final('재고는 98,000 t', facts=[fact(123456, 'c1')])
    return [LlmTurn([ToolCall('c1', 'stock_snapshot', {'at': None})], None), LlmTurn([], bad), LlmTurn([], bad)]


def test_retry_skipped_when_time_is_up(tmp_ctx, fake_dashboard):
    import itertools
    ticks = itertools.chain(iter([0, 1, 2]), itertools.repeat(61))
    llm = RecordingLlm(_bad_script())
    out = ask('재고?', [], tmp_ctx, llm, clock=lambda: next(ticks))
    assert len(llm.timeouts) == 2
    assert out['answer'] == '아래 근거 표를 확인해 주세요.' and out['facts'][0]['value'] == 123456


def test_retry_timeout_is_recomputed(tmp_ctx, fake_dashboard):
    import itertools
    ticks = itertools.chain(iter([0, 1, 2]), itertools.repeat(40))
    llm = RecordingLlm(_bad_script())
    ask('재고?', [], tmp_ctx, llm, clock=lambda: next(ticks))
    assert len(llm.timeouts) == 3 and llm.timeouts[2] == 20
