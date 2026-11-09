"""답변 속 숫자를 도구 근거(facts)와 대조한다."""
from __future__ import annotations

import re

_MASKS = [
    re.compile(r"\d{4}-\d{2}-\d{2}"),
    re.compile(r"\d{1,2}월\s*\d{1,2}일"),
    re.compile(r"\d{1,2}:\d{2}"),
    re.compile(r"D\+\d+"),
    re.compile(r"(?:1~4|5~8|9~10)"),
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


def unverified_numbers(answer: str, facts: list[dict]) -> list[str]:
    values = [abs(float(f["value"])) for f in facts
              if isinstance(f.get("value"), (int, float)) and not isinstance(f.get("value"), bool)]
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
