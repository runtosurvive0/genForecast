"""시간별 실적 스냅샷. 원천 DB(national-solar-forecast PostgreSQL)에서 한 번 뽑아 CSV 로 둔다.

연간 전망은 실시간 수집이 필요 없다 -- 학습에 쓸 과거 실적만 있으면 된다. 그래서 원천 DB 에
매번 붙지 않고 `data/history_hourly.csv` 하나로 끊는다. 다시 뽑으려면 `snapshot` 을 돌린다.

열 정의는 석탄곡선 학습(`commands.run_coal_curve_training`)과 **같은 식**이다. 다르게 뽑으면
기존 석탄 모델이 학습 때와 다른 '순수요'를 받는다:

* demand  = 5분 연료원별 출력 전체 합의 시간 평균 (BTM·PPA 추정 태양광 포함 총수요)
* solar   = 태양광(전력시장) + 태양광(BTM,추정) + 태양광(PPA,추정)
* nuclear = 원자력
* coal    = 석탄 + 유연탄 + 국내탄 (2026-07 부터 '석탄' 한 이름으로 바뀜)
* 순수요  = demand − solar  (= 태양광을 뺀 모든 연료원 출력 합)

BTM·PPA 추정은 2024-11-22 부터 있다. 그 전은 총수요·태양광 모두 시장분만 들어 있지만 그
차이(순수요)는 같은 것을 센다 -- 태양광 아닌 발전기가 맡은 몫. 그래서 순수요 계열은 2023-09
부터 일관되고, 총수요·태양광은 따로 쓸 때 시기 구분이 필요하다(`solar_basis` 열).

기온은 ASOS 17개 지점 시간 기온의 단순평균이다.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PATH = ROOT / "data" / "history_hourly.csv"
#: 당진 호기별 시간 실적(운영자 업로드 `unit_generation_hour`). 배분 백테스트의 정답.
DANGJIN_ACTUAL_PATH = ROOT / "data" / "dangjin_actual_hourly.csv"

#: BTM·PPA 추정 태양광이 연료원별 계열에 들어오기 시작한 날(KST).
BEHIND_METER_FROM = date(2024, 11, 22)

COLUMNS = ("hour", "demand_mw", "solar_mw", "solar_market_mw", "nuclear_mw", "coal_mw",
           "temp_c", "samples")

_MIX_SQL = """
WITH instants AS (
  SELECT timestamp, sum(output_mw) AS demand,
    sum(CASE WHEN fuel IN ('석탄','유연탄','국내탄') THEN output_mw ELSE 0 END) AS coal,
    sum(CASE WHEN fuel = '원자력' THEN output_mw ELSE 0 END) AS nuclear,
    sum(CASE WHEN fuel IN ('태양광(전력시장)','태양광(BTM,추정)','태양광(PPA,추정)')
        THEN output_mw ELSE 0 END) AS solar,
    sum(CASE WHEN fuel = '태양광(전력시장)' THEN output_mw ELSE 0 END) AS solar_market
  FROM supply_mix_5min GROUP BY timestamp)
SELECT date_trunc('hour', timestamp) AS hour, avg(demand), avg(solar), avg(solar_market),
       avg(nuclear), avg(coal), count(*)
FROM instants GROUP BY 1
HAVING count(*) >= 10 AND avg(demand) > 0
ORDER BY 1
"""

_TEMP_SQL = """
SELECT hour, avg(temperature_c) FROM weather_observation
WHERE temperature_c IS NOT NULL GROUP BY hour
"""


@dataclass(frozen=True, slots=True)
class HourRecord:
    hour: datetime          # KST, 정각
    demand_mw: float
    solar_mw: float
    solar_market_mw: float
    nuclear_mw: float
    coal_mw: float
    temp_c: float | None
    samples: int

    @property
    def net_demand_mw(self) -> float:
        return self.demand_mw - self.solar_mw


def snapshot(dsn: str | None = None, path: Path = DEFAULT_PATH) -> str:
    """원천 DB 에서 시간별 실적을 뽑아 CSV 로 쓴다."""
    dsn = dsn or os.environ.get("MIDTERM_SOURCE_DSN")
    if not dsn:
        raise ValueError("실적 수집 DB 연결정보를 MIDTERM_SOURCE_DSN 환경변수 또는 --dsn으로 지정하세요")
    import asyncio

    import asyncpg

    async def fetch():
        connection = await asyncpg.connect(dsn)
        try:
            mix = await connection.fetch(_MIX_SQL)
            temperature = await connection.fetch(_TEMP_SQL)
            dangjin = await connection.fetch(
                "SELECT hour, unit_name, output_mw FROM unit_generation_hour "
                "WHERE unit_name LIKE '당진%' ORDER BY hour, unit_name")
        finally:
            await connection.close()
        return mix, temperature, dangjin

    mix, temperature, dangjin = asyncio.run(fetch())
    from midterm.storage import write_table
    write_table(DANGJIN_ACTUAL_PATH, ["hour", "unit", "output_mw"], [
        {"hour": at.astimezone(SEOUL).strftime("%Y-%m-%dT%H:00"), "unit": unit,
         "output_mw": f"{output:.1f}"} for at, unit, output in dangjin])
    temps = {row[0].astimezone(SEOUL): float(row[1]) for row in temperature}
    rows = []
    for at, demand, solar, market, nuclear, coal, samples in mix:
        local = at.astimezone(SEOUL)
        temp = temps.get(local)
        rows.append(dict(zip(COLUMNS, [local.strftime("%Y-%m-%dT%H:00"), f"{demand:.1f}", f"{solar:.1f}",
                                       f"{market:.1f}", f"{nuclear:.1f}", f"{coal:.1f}",
                                       "" if temp is None else f"{temp:.2f}", samples])))
    write_table(path, list(COLUMNS), rows)
    first = mix[0][0].astimezone(SEOUL)
    last = mix[-1][0].astimezone(SEOUL)
    return (f"{path}: {len(mix):,}시간 ({first:%Y-%m-%d %H} ~ {last:%Y-%m-%d %H} KST) · "
            f"당진 호기실적 {len(dangjin):,}행")


def load_dangjin_actual(path: Path = DANGJIN_ACTUAL_PATH) -> dict[datetime, dict[str, float]]:
    """시각 → {호기: MW}."""
    from midterm.storage import read_table
    out: dict[datetime, dict[str, float]] = {}
    for row in read_table(path):
        out.setdefault(datetime.fromisoformat(row["hour"]), {})[row["unit"]] = float(row["output_mw"])
    return out


def load_history(path: Path = DEFAULT_PATH) -> list[HourRecord]:
    from midterm.storage import exists, read_table
    if not exists(path):
        raise FileNotFoundError(f"{path} 가 없습니다. 먼저 `python -m midterm snapshot` 을 실행하세요")
    return [HourRecord(
        hour=datetime.fromisoformat(row["hour"]),
        demand_mw=float(row["demand_mw"]), solar_mw=float(row["solar_mw"]),
        solar_market_mw=float(row["solar_market_mw"]),
        nuclear_mw=float(row["nuclear_mw"]), coal_mw=float(row["coal_mw"]),
        temp_c=float(row["temp_c"]) if row["temp_c"] else None,
        samples=int(row["samples"])) for row in read_table(path)]


def complete_days(records: list[HourRecord]) -> dict[date, dict[int, HourRecord]]:
    """24시간이 모두 있는 날만. 반쪽 날은 일 형상을 반만 가르친다."""
    days: dict[date, dict[int, HourRecord]] = {}
    for record in records:
        days.setdefault(record.hour.date(), {})[record.hour.hour] = record
    return {d: hours for d, hours in days.items() if len(hours) == 24}


def day_range(first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]
