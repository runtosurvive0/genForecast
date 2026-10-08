"""한국 공휴일 달력과 세 가지 요일유형. `national-solar-forecast` 의 `holiday_calendar.py` 를
포크했다 (원본 커밋 be2a0a0). 석탄곡선 모델의 `day_type`/`is_major_holiday` 특징이 이 함수에서
나오므로 **의미를 바꾸지 않는다** -- 바꾸면 저장된 모델이 다른 달력으로 읽힌다.

포크에서 바꾼 것은 하나: 연간 전망이 2027년을 다뤄야 하므로 `CALENDAR_TO` 를 2027-12-31 로
늘리고 2027년 공휴일을 선언했다. 2027년 항목은 공표 달력에서 옮긴 값이며 실적으로 확인되지
않았다 (`VERIFIED_THROUGH` 이후). 설은 한국 표준시 기준 음력 1월 1일이 2월 7일(일)이라 중국
춘절(2월 6일)과 하루 다르다.

--- 원본 설명 ---
The Korean holiday calendar, and the three day types the demand series actually has.

Three classes, measured rather than assumed. Each day was normalised by its own peak — the way
`forecast.demand_shape.learn_demand_shapes` does, so the level divides out — and the mean absolute
distance between the resulting curves, in points of the day's own peak, came out as:

|              | 평일 | 토요일 | 일요일 |
|--------------|-----:|-------:|-------:|
| 일반공휴일    | 5.36 |   2.41 |   1.77 |
| 명절 (설·추석)| 7.40 |   3.60 |   1.20 |

So a public holiday's shape *is* a Sunday's shape, and the previous two-way weekday/weekend split
was wrong twice over: it filed holidays as working days, and it merged Saturday with Sunday, which
are 4.12 apart across 304 days — a larger error than the holiday one, on nine times the days.

`설`/`추석` get no shape class of their own. Their curve is nearer a Sunday's (1.20) than an
ordinary holiday's is, and there are 20 such days in three years, so a per-month shape learned from
them would learn noise. What makes them distinctive is level — 0.768 of a weekday against 0.874 for
an ordinary holiday — and level is the gross-load model's business, not the shape's.
`is_major_holiday` is here for that model to use.

Bridge days (징검다리) are deliberately absent. They were proposed but never measured, and adding an
unmeasured class is the mistake this module exists to correct.

**The list cannot be computed.** 설, 추석 and 부처님오신날 are lunar; the substitute-holiday rules
have been extended more than once; and 임시공휴일 and election days are declared one at a time — six
of the entries below exist for no reason a rule could reproduce. So this is a declared list with a
stated span, and outside that span the holiday question answers "not known" rather than "no".
Answering "no" for a 2027 설 that falls on a Wednesday would overstate demand by 23%, in the
direction that invents unit stops.

근로자의날 (5월 1일) is **not** here. It is not a 관공서 공휴일, and the measurement that produced the
three classes counted it as a working day; including it now would change the classes without
re-measuring them. Industrial demand does drop on it, so it is worth measuring separately.
"""

from collections.abc import Mapping
from datetime import date, datetime
from types import MappingProxyType

#: An ordinary working day.
WEEKDAY = "weekday"
#: Saturday, which the previous two-way split merged into a single weekend class.
SATURDAY = "saturday"
#: Sunday and every public holiday. One class because their normalised curves are 1.2-1.8 points
#: apart, against 5.4-7.4 points from a weekday's.
SUNDAY_OR_HOLIDAY = "sunday_or_holiday"

#: The span this list speaks for. `covers` refuses days outside it rather than calling them
#: ordinary.
CALENDAR_FROM = date(2023, 1, 1)
CALENDAR_TO = date(2027, 12, 31)

#: The last day whose entries were cross-checked against the loaded demand series, where 설/추석 came
#: out at 0.75-0.79 of a weekday and ordinary holidays at 0.87-0.93. Entries after it are declared
#: from the published calendar but not corroborated by data, which is weaker confidence and worth
#: knowing before an answer for such a day is trusted.
VERIFIED_THROUGH = date(2026, 8, 31)

#: The two whose *level* differs enough to be worth separating downstream. Not a shape class.
MAJOR_HOLIDAY_NAMES = frozenset({"설", "추석"})

_SATURDAY_INDEX = 5
_SUNDAY_INDEX = 6

_HOLIDAYS: dict[date, str] = {
    # --- 2023 ------------------------------------------------------------------------------------
    date(2023, 1, 1): "신정",
    date(2023, 1, 21): "설",
    date(2023, 1, 22): "설",
    date(2023, 1, 23): "설",
    date(2023, 1, 24): "설",  # 대체공휴일
    date(2023, 3, 1): "삼일절",
    date(2023, 5, 5): "어린이날",
    date(2023, 5, 27): "부처님오신날",
    date(2023, 5, 29): "부처님오신날",  # 대체공휴일
    date(2023, 6, 6): "현충일",
    date(2023, 8, 15): "광복절",
    date(2023, 9, 28): "추석",
    date(2023, 9, 29): "추석",
    date(2023, 9, 30): "추석",
    date(2023, 10, 2): "임시공휴일",
    date(2023, 10, 3): "개천절",
    date(2023, 10, 9): "한글날",
    date(2023, 12, 25): "성탄절",
    # --- 2024 ------------------------------------------------------------------------------------
    date(2024, 1, 1): "신정",
    date(2024, 2, 9): "설",
    date(2024, 2, 10): "설",
    date(2024, 2, 11): "설",
    date(2024, 2, 12): "설",  # 대체공휴일
    date(2024, 3, 1): "삼일절",
    date(2024, 4, 10): "국회의원선거",
    date(2024, 5, 5): "어린이날",
    date(2024, 5, 6): "어린이날",  # 대체공휴일
    date(2024, 5, 15): "부처님오신날",
    date(2024, 6, 6): "현충일",
    date(2024, 8, 15): "광복절",
    date(2024, 9, 16): "추석",
    date(2024, 9, 17): "추석",
    date(2024, 9, 18): "추석",
    date(2024, 10, 1): "임시공휴일",  # 국군의날, 2024년에만
    date(2024, 10, 3): "개천절",
    date(2024, 10, 9): "한글날",
    date(2024, 12, 25): "성탄절",
    # --- 2025 ------------------------------------------------------------------------------------
    date(2025, 1, 1): "신정",
    date(2025, 1, 27): "임시공휴일",
    date(2025, 1, 28): "설",
    date(2025, 1, 29): "설",
    date(2025, 1, 30): "설",
    date(2025, 3, 1): "삼일절",
    date(2025, 3, 3): "삼일절",  # 대체공휴일
    date(2025, 5, 5): "어린이날",  # 부처님오신날과 같은 날
    date(2025, 5, 6): "부처님오신날",  # 대체공휴일
    date(2025, 6, 3): "대통령선거",
    date(2025, 6, 6): "현충일",
    date(2025, 8, 15): "광복절",
    date(2025, 10, 3): "개천절",
    date(2025, 10, 5): "추석",
    date(2025, 10, 6): "추석",
    date(2025, 10, 7): "추석",
    date(2025, 10, 8): "추석",  # 대체공휴일
    date(2025, 10, 9): "한글날",
    date(2025, 12, 25): "성탄절",
    # --- 2026 ------------------------------------------------------------------------------------
    # Everything from 2026-09-01 onward is declared from the published calendar but is past
    # VERIFIED_THROUGH -- no loaded demand day corroborates it yet.
    date(2026, 1, 1): "신정",
    date(2026, 2, 16): "설",
    date(2026, 2, 17): "설",
    date(2026, 2, 18): "설",
    date(2026, 3, 1): "삼일절",
    date(2026, 3, 2): "삼일절",  # 대체공휴일
    date(2026, 5, 5): "어린이날",
    date(2026, 5, 24): "부처님오신날",
    date(2026, 5, 25): "부처님오신날",  # 대체공휴일
    date(2026, 6, 3): "지방선거",
    date(2026, 6, 6): "현충일",
    date(2026, 8, 15): "광복절",
    date(2026, 8, 17): "광복절",  # 대체공휴일
    date(2026, 9, 24): "추석",
    date(2026, 9, 25): "추석",
    date(2026, 9, 26): "추석",
    date(2026, 10, 3): "개천절",
    date(2026, 10, 5): "개천절",  # 대체공휴일
    date(2026, 10, 9): "한글날",
    date(2026, 12, 25): "성탄절",
    # --- 2027 (mid-term fork: 공표 달력에서 선언, 실적 미확인) ---------------------------------
    date(2027, 1, 1): "신정",
    date(2027, 2, 6): "설",
    date(2027, 2, 7): "설",
    date(2027, 2, 8): "설",
    date(2027, 2, 9): "설",  # 대체공휴일 (2/7 일요일)
    date(2027, 3, 1): "삼일절",
    date(2027, 5, 5): "어린이날",
    date(2027, 5, 13): "부처님오신날",
    date(2027, 6, 6): "현충일",
    date(2027, 8, 15): "광복절",
    date(2027, 8, 16): "광복절",  # 대체공휴일
    date(2027, 9, 14): "추석",
    date(2027, 9, 15): "추석",
    date(2027, 9, 16): "추석",
    date(2027, 10, 3): "개천절",
    date(2027, 10, 4): "개천절",  # 대체공휴일
    date(2027, 10, 9): "한글날",
    date(2027, 10, 11): "한글날",  # 대체공휴일
    date(2027, 12, 25): "성탄절",
    date(2027, 12, 27): "성탄절",  # 대체공휴일
}

#: Read-only so a caller cannot add a holiday at runtime and leave the span claim untrue.
HOLIDAYS: Mapping[date, str] = MappingProxyType(_HOLIDAYS)


def _as_date(moment: datetime | date) -> date:
    return moment.date() if isinstance(moment, datetime) else moment


def covers(moment: datetime | date) -> bool:
    """Whether this list can speak about holidays on that day.

    The weekday split is always computable, so `day_type` always answers; holiday knowledge is not,
    and a caller answering for an uncovered day has to say so beside the answer.
    """
    return CALENDAR_FROM <= _as_date(moment) <= CALENDAR_TO


def holiday_name(moment: datetime | date) -> str | None:
    """The holiday's name, or `None` for an ordinary day inside the span.

    Raises `ValueError` outside the span. `None` there would mean "not a holiday", which is a claim
    this list is not entitled to make.
    """
    day = _as_date(moment)
    if not covers(day):
        raise ValueError(
            f"{day.isoformat()} is outside the declared calendar "
            f"{CALENDAR_FROM.isoformat()}..{CALENDAR_TO.isoformat()}; "
            "extend the list from the published 관보 rather than reading this as an ordinary day"
        )
    return HOLIDAYS.get(day)


def is_major_holiday(moment: datetime | date) -> bool:
    """Whether the day is 설 or 추석 — a level distinction, for the gross-load model.

    `False` outside the span, deliberately: this is a level adjustment a caller applies on top of a
    shape, and refusing here would make an uncovered day unanswerable twice over. `covers` is the
    one place that reports the gap.
    """
    day = _as_date(moment)
    if not covers(day):
        return False
    return HOLIDAYS.get(day) in MAJOR_HOLIDAY_NAMES


def day_type(moment: datetime | date) -> str:
    """Which of the three measured classes the day belongs to.

    Always answers. Outside the declared span it can only apply the weekday split, so an uncovered
    holiday reads as `WEEKDAY` — ask `covers` to find out whether that is what happened.
    """
    day = _as_date(moment)
    if covers(day) and day in HOLIDAYS:
        return SUNDAY_OR_HOLIDAY
    weekday = day.weekday()
    if weekday == _SUNDAY_INDEX:
        return SUNDAY_OR_HOLIDAY
    if weekday == _SATURDAY_INDEX:
        return SATURDAY
    return WEEKDAY
