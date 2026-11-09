"""답변 속 숫자를 도구 근거(facts)와 대조한다."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Iterable

_N = r"(?<![\d.,])"  # 더 긴 숫자의 일부를 가리지 않는다.
_MASKS = [
    re.compile(r"\d{4}-\d{2}-\d{2}"),
    re.compile(r"\d{1,2}월\s*\d{1,2}일"),
    re.compile(r"\d{1,2}:\d{2}"),
    re.compile(r"D\+\d+"),
    re.compile(r"(?:1~4|5~8|9~10)"),
    re.compile(_N + r"\d{4}년"),
    re.compile(_N + r"\d{1,2}월"),
    re.compile(_N + r"\d{1,2}/\d{1,2}(?![\d/])"),
    re.compile(_N + r"\d+시간"),
    re.compile(_N + r"\d{1,2}시(?:\s*\d{1,2}분)?"),
    re.compile(_N + r"\d+일 전망"),
]
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?(?P<unit>[만억])?")
_SKIP_AFTER = re.compile(r"^(?:호기|부두|일 뒤|일간|주)")
_SCALE = {None: 1.0, "만": 1e4, "억": 1e8}


def _matches(shown: str, number: float, scale: float, decimals: int, values: list[float]) -> bool:
    for fv in values:
        if fv == 0:
            if number == 0:
                return True
            continue
        if abs(number * scale - fv) <= 0.01 * abs(fv):
            return True
        if abs(round(fv / scale, decimals) - number) < 1e-9:
            return True
    return False


def _decimals(value: float) -> int:
    try:
        exponent = Decimal(repr(value)).as_tuple().exponent
    except InvalidOperation:
        return 0
    return max(0, -exponent) if isinstance(exponent, int) else 0


def value_matches(value: float, candidates: Iterable[float]) -> bool:
    """fact 값이 도구 결과 숫자 중 하나와 맞는지(상대오차 1% 이하 또는 표시 자릿수 반올림). 부호까지 본다."""
    values = [float(c) for c in candidates]
    return _matches(repr(value), float(value), 1.0, _decimals(value), values)


def _numbers_in(text: str) -> list[float]:
    found: list[float] = []
    for m in _NUMBER.finditer(text):
        unit = m.group("unit")
        body = (m.group(0)[:-1] if unit else m.group(0)).rstrip(",").replace(",", "")
        if body:
            found.append(float(body) * _SCALE[unit])
    return found


def unverified_numbers(answer: str, facts: list[dict], allowed: Iterable[str] = ()) -> list[str]:
    """facts 값이나 allowed 문자열(질문 원문, 도구 호출 인자)에 없는 답변 속 숫자 목록."""
    values = [abs(float(f["value"])) for f in facts
              if isinstance(f.get("value"), (int, float)) and not isinstance(f.get("value"), bool)]
    for text_allowed in allowed:
        values.extend(_numbers_in(str(text_allowed)))
    text = answer
    for mask in _MASKS:
        text = mask.sub(lambda m: " " * len(m.group(0)), text)
    bad: list[str] = []
    for m in _NUMBER.finditer(text):
        raw = m.group(0)
        unit = m.group("unit")
        body = raw[:-1] if unit else raw
        body = body.rstrip(",")
        if not body:
            continue
        shown = body + (unit or "")
        if "." not in body and not unit and _SKIP_AFTER.match(text[m.end():]):
            continue
        number = float(body.replace(",", ""))
        decimals = len(body.split(".")[1]) if "." in body else 0
        if not _matches(shown, number, _SCALE[unit], decimals, values) and shown not in bad:
            bad.append(shown)
    return bad
