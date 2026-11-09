from midterm.assistant.numbers import unverified_numbers

F = [{'label': '5~8호기 재고', 'value': 123456, 'unit': 't', 'as_of': 'x', 'source': 'actual', 'tool_call_id': 'c1'},
     {'label': '최소 재고일수', 'value': 4.27, 'unit': '일', 'as_of': 'x', 'source': 'simulation', 'tool_call_id': 'c2'}]


def test_numbers_match_with_rounding_and_korean_units():
    assert unverified_numbers('재고는 약 12만 t, 정확히 123,456 t입니다. 최소 4.3일.', F) == []


def test_ignores_dates_units_berths_and_groups():
    assert unverified_numbers('2026-11-09 06:00 기준 5호기, 2부두, D+3, 3일 뒤, 5~8호기', F) == []


def test_flags_invented_number():
    assert unverified_numbers('재고는 98,000 t입니다.', F) == ['98,000']
