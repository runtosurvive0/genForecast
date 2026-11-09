from midterm.assistant.numbers import unverified_numbers

F = [{'label': '5~8호기 재고', 'value': 123456, 'unit': 't', 'as_of': 'x', 'source': 'actual', 'tool_call_id': 'c1'},
     {'label': '최소 재고일수', 'value': 4.27, 'unit': '일', 'as_of': 'x', 'source': 'simulation', 'tool_call_id': 'c2'}]


def test_numbers_match_with_rounding_and_korean_units():
    assert unverified_numbers('재고는 약 12만 t, 정확히 123,456 t입니다. 최소 4.3일.', F) == []


def test_ignores_dates_units_berths_and_groups():
    assert unverified_numbers('2026-11-09 06:00 기준 5호기, 2부두, D+3, 3일 뒤, 5~8호기', F) == []


def test_flags_invented_number():
    assert unverified_numbers('재고는 98,000 t입니다.', F) == ['98,000']


def test_numbers_from_question_and_tool_args_are_allowed():
    assert unverified_numbers('A호가 3일 늦으면 최소 4.3일입니다.', F, allowed=['A호가 3일 늦으면 어떻게 돼?']) == []
    args = '{"changes": [{"kind": "load", "fromDay": 0, "toDay": 6, "pct": -20}], "horizon_days": 7}'
    assert unverified_numbers('부하 20% 감소 시 최소 4.3일', F, allowed=[args]) == []
    assert unverified_numbers('부하 20% 감소', F) == ['20']  # %는 마스크하지 않는다


def test_calendar_and_duration_expressions_pass():
    for text in ['30일 전망 기준', '2026년 11월', '11/9 기준', '오전 9시', '오후 3시 30분', '24시간']:
        assert unverified_numbers(text, F) == [], text


def test_rounded_invented_number_still_flagged():
    assert unverified_numbers('약 10만 t', F) == ['10만']
