"""연간(1년 앞) 시간별 순수요 예측모델.

    순수요(h) = 총수요(h) − 태양광(h)

석탄곡선 모델이 받는 `net_demand_mw` 와 같은 정의다(`history.py` 참고). 1년 앞에는 기상예보가
없으므로 두 성분을 따로, 서로 다른 근거로 만든다.

**총수요 — LightGBM(달력 + 기온).** 시간·요일유형(전/후일 포함)·명절·연중 위치·기온(시간/일평균/
최고/최저/3일평균)으로 학습한다. 학습은 *실측 기온*으로 해서 기온 민감도를 배우고, 예측은
*평년 기온*(같은 날짜 ±7일, 학습 전 기간 평균)이나 *기준 기상연도*의 실측 기온을 넣는다. 트리는
추세를 외삽하지 못하므로 수준은 따로 맞춘다: 최근 365일 실적 / 같은 기간 모델값 = 수준계수,
그리고 연 증가율을 그 기간 중앙에서 대상일까지 복리로 곱한다.

**태양광 — 최근 1년 형상 × 증가율.** 설비가 해마다 15~20% 늘어 트리로 배울 수 없다. 최근 365일
실적을 날짜(±15일)·시각별로 평균한 형상을 쓰고(평년), 기준일에서 대상일까지 태양광 증가율을
복리로 곱한다. 기준 기상연도 모드는 그해 같은 날의 실제 태양광을 증가율만큼 키운다 -- 맑은 날과
흐린 날이 섞여 석탄 감발·정지 빈도가 현실적으로 나온다.

**BTM·PPA 이전 구간.** 2024-11-22 전에는 태양광 추정치가 연료원 계열에 없어 총수요·태양광이
시장분뿐이다. 그 구간 총태양광 = 시장태양광 × k (겹치는 첫 90일 비율, ≈3.34) 로 채우고 총수요 =
순수요 + 총태양광 으로 다시 세운다. 순수요 자체는 전 구간 일관된다.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from math import cos, pi, sin
from pathlib import Path
from statistics import mean
from typing import Any

import numpy as np

from midterm.calendar import day_type, is_major_holiday
from midterm.coal_curve import DAY_TYPE_CODES, UNSEEN_DAY_TYPE_CODE
from midterm.history import BEHIND_METER_FROM, HourRecord, complete_days

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STEM = ROOT / "models" / "net-demand"
MODEL_KIND = "gross-lgbm-solar-profile-v1"

FEATURE_NAMES: tuple[str, ...] = (
    "hour_sin", "hour_cos", "hour",
    "day_type_code", "previous_day_type_code", "next_day_type_code", "is_major_holiday",
    "doy_sin", "doy_cos",
    "temp_c", "temp_day_mean", "temp_day_max", "temp_day_min", "temp_3day_mean",
)
CATEGORICAL = ["day_type_code", "previous_day_type_code", "next_day_type_code"]

#: 평년 기온의 날짜 창(±일)과 태양광 평년 형상의 날짜 창(±일).
TEMP_WINDOW_DAYS = 7
SOLAR_WINDOW_DAYS = 15
#: 수준계수·증가율을 재는 창.
LEVEL_WINDOW_DAYS = 365
MIN_TRAINING_DAYS = 365


def _code(day: date) -> float:
    return float(DAY_TYPE_CODES.get(day_type(day), UNSEEN_DAY_TYPE_CODE))


def _doy(day: date) -> int:
    """윤년과 무관한 연중 위치(1~365). 2/29 는 2/28 로 본다."""
    month_day = (day.month, min(day.day, 28) if day.month == 2 else day.day)
    return date(2001, *month_day).timetuple().tm_yday


def _same_day_in(year: int, day: date) -> date:
    return date(year, day.month, 28 if (day.month, day.day) == (2, 29) else day.day)


def feature_rows(day: date, temps: list[float], previous_means: list[float]) -> list[list[float]]:
    """하루 24행. `temps` 는 그날 시간 기온, `previous_means` 는 전일·전전일 일평균 기온."""
    day_mean = mean(temps)
    three_day = mean([day_mean, *previous_means])
    doy = _doy(day)
    common = [_code(day), _code(day - timedelta(days=1)), _code(day + timedelta(days=1)),
              float(is_major_holiday(day)), sin(2 * pi * doy / 365), cos(2 * pi * doy / 365)]
    return [[sin(2 * pi * h / 24), cos(2 * pi * h / 24), float(h), *common,
             temps[h], day_mean, max(temps), min(temps), three_day] for h in range(24)]


@dataclass(frozen=True, slots=True)
class DayForecast:
    day: date
    demand_mw: list[float]
    solar_mw: list[float]
    temp_c: list[float]

    @property
    def net_mw(self) -> list[float]:
        return [d - s for d, s in zip(self.demand_mw, self.solar_mw, strict=True)]


@dataclass(slots=True)
class NetDemandModel:
    booster: Any
    trained_from: date
    trained_through: date
    training_days: int
    level_factor: float
    demand_growth: float
    solar_growth: float
    solar_backfill_ratio: float
    #: (연중일 1~365) → 24시간 평년기온
    temp_normals: dict[int, list[float]]
    #: 최근 365일 실적: 날짜 → (24시간 총태양광, 24시간 기온)
    reference: dict[date, tuple[list[float], list[float]]]
    #: 기준 기상연도 재생용 전 기간 실측: 날짜 → (24시간 총태양광, 24시간 기온)
    weather_years: dict[date, tuple[list[float], list[float]]] = field(repr=False)
    model_kind: str = MODEL_KIND

    @property
    def level_center(self) -> date:
        return self.trained_through - timedelta(days=LEVEL_WINDOW_DAYS // 2)


# ------------------------------------------------------------------------------------------
# 학습
# ------------------------------------------------------------------------------------------

def _prepare(records: list[HourRecord], through: date | None):
    """완전한 날만, 결측기온 보간, BTM 이전 태양광 채움. → {날짜: (총수요24, 총태양광24, 기온24)}"""
    days = complete_days(records)
    if through is not None:
        days = {d: h for d, h in days.items() if d <= through}
    overlap = [r for d, hours in days.items()
               if BEHIND_METER_FROM <= d < BEHIND_METER_FROM + timedelta(days=90)
               for r in hours.values() if r.solar_market_mw > 50]
    ratio = (sum(r.solar_mw for r in overlap) / sum(r.solar_market_mw for r in overlap)
             if overlap else 3.34)
    prepared = {}
    for d, hours in sorted(days.items()):
        temps = [hours[h].temp_c for h in range(24)]
        known = [t for t in temps if t is not None]
        if len(known) < 18:
            continue
        temps = [t if t is not None else mean(known) for t in temps]
        if d < BEHIND_METER_FROM:
            solar = [hours[h].solar_market_mw * ratio for h in range(24)]
            demand = [hours[h].net_demand_mw + solar[h] for h in range(24)]
        else:
            solar = [hours[h].solar_mw for h in range(24)]
            demand = [hours[h].demand_mw for h in range(24)]
        prepared[d] = (demand, solar, temps)
    return prepared, ratio


def _matrix(prepared, days):
    rows, targets = [], []
    for d in days:
        demand, _, temps = prepared[d]
        previous = [mean(prepared[p][2]) if p in prepared else mean(temps)
                    for p in (d - timedelta(days=1), d - timedelta(days=2))]
        rows.extend(feature_rows(d, temps, previous))
        targets.extend(demand)
    return rows, targets


def _window(prepared, end: date, length: int = LEVEL_WINDOW_DAYS) -> list[date]:
    start = end - timedelta(days=length - 1)
    return [d for d in prepared if start <= d <= end]


def train_net_demand_model(records: list[HourRecord], *, through: date | None = None
                           ) -> NetDemandModel:
    """`through` 까지의 실적으로 학습한다(백테스트는 과거 날짜로 자른다)."""
    import lightgbm as lgb

    prepared, ratio = _prepare(records, through)
    days = sorted(prepared)
    if len(days) < MIN_TRAINING_DAYS + LEVEL_WINDOW_DAYS // 2:
        raise ValueError(f"순수요 모델 학습에 완전한 날이 부족합니다 ({len(days)}일)")
    rows, targets = _matrix(prepared, days)
    booster = lgb.train(
        {"objective": "regression_l1", "learning_rate": 0.05, "num_leaves": 63,
         "min_data_in_leaf": 120, "feature_fraction": 0.9, "bagging_fraction": 0.9,
         "bagging_freq": 1, "seed": 7, "deterministic": True, "verbose": -1},
        lgb.Dataset(np.asarray(rows, float), label=np.asarray(targets, float),
                    feature_name=list(FEATURE_NAMES), categorical_feature=CATEGORICAL),
        num_boost_round=600,
    )
    last = days[-1]

    def level(window: list[date]) -> float:
        rows_w, actual = _matrix(prepared, window)
        return float(np.sum(actual) / np.sum(booster.predict(np.asarray(rows_w, float))))

    recent = _window(prepared, last)
    prior = _window(prepared, last - timedelta(days=LEVEL_WINDOW_DAYS))
    level_factor = level(recent)
    # 기온 보정된 전년 대비 증가율: 두 해의 수준계수 비. 원시 수요 비보다 여름 더위 하나에 덜 흔들린다.
    demand_growth = level_factor / level(prior) - 1 if len(prior) > 300 else 0.0
    solar_recent = sum(sum(prepared[d][1]) for d in recent) / len(recent)
    solar_prior = (sum(sum(prepared[d][1]) for d in prior) / len(prior)) if prior else solar_recent
    solar_growth = solar_recent / solar_prior - 1 if len(prior) > 300 else 0.15

    by_doy: dict[int, list[list[float]]] = defaultdict(list)
    for d in days:
        by_doy[_doy(d)].append(prepared[d][2])
    normals = {}
    for doy in range(1, 366):
        pool = [temps for offset in range(-TEMP_WINDOW_DAYS, TEMP_WINDOW_DAYS + 1)
                for temps in by_doy.get((doy - 1 + offset) % 365 + 1, [])]
        normals[doy] = [float(np.mean([t[h] for t in pool])) for h in range(24)]

    return NetDemandModel(
        booster=booster, trained_from=days[0], trained_through=last, training_days=len(days),
        level_factor=level_factor, demand_growth=demand_growth, solar_growth=solar_growth,
        solar_backfill_ratio=ratio, temp_normals=normals,
        reference={d: (prepared[d][1], prepared[d][2]) for d in recent},
        weather_years={d: (prepared[d][1], prepared[d][2]) for d in days},
    )


# ------------------------------------------------------------------------------------------
# 예측
# ------------------------------------------------------------------------------------------

def _growth(rate: float, start: date, end: date) -> float:
    return (1.0 + rate) ** ((end - start).days / 365.25)


def _reference_day(model: NetDemandModel, day: date) -> date:
    """최근 365일 창 안에서 같은 월·일. 그날 실적이 비었으면 가장 가까운 날."""
    for offset in sorted(range(-7, 8), key=abs):
        for year in (model.trained_through.year, model.trained_through.year - 1):
            candidate = _same_day_in(year, day) + timedelta(days=offset)
            if candidate in model.reference:
                return candidate
    raise ValueError(f"{day} 의 기준일을 최근 1년 실적에서 찾지 못했습니다")


def _normal_solar(model: NetDemandModel, day: date) -> tuple[list[float], date]:
    center = _reference_day(model, day)
    pool = []
    for offset in range(-SOLAR_WINDOW_DAYS, SOLAR_WINDOW_DAYS + 1):
        candidate = center + timedelta(days=offset)
        if candidate not in model.reference:
            # 창 끝을 넘으면 1년 반대편의 같은 날을 쓴다 -- 창이 정확히 1년이라 계절이 같다.
            shifted = candidate + timedelta(days=365 if candidate < center else -365)
            candidate = shifted if shifted in model.reference else None
        if candidate is not None:
            pool.append(model.reference[candidate][0])
    return [float(np.mean([p[h] for p in pool])) for h in range(24)], center


def forecast_net_demand(
    model: NetDemandModel,
    days: list[date],
    *,
    weather: str | int = "normal",
    demand_growth: float | None = None,
    solar_growth: float | None = None,
) -> list[DayForecast]:
    """대상일들의 시간별 총수요·태양광. `weather` 는 "normal"(평년) 또는 기준 기상연도(int)."""
    g_demand = model.demand_growth if demand_growth is None else demand_growth
    g_solar = model.solar_growth if solar_growth is None else solar_growth
    replay = weather != "normal"
    year = int(weather) if replay else None

    def weather_of(day: date) -> tuple[list[float], list[float], date]:
        if not replay:
            solar, center = _normal_solar(model, day)
            return model.temp_normals[_doy(day)], solar, center
        source = _same_day_in(year, day)
        if source not in model.weather_years:
            raise ValueError(f"기준 기상연도 {year} 에 {source} 실적이 없습니다")
        solar, temps = model.weather_years[source]
        return temps, solar, source

    ordered = sorted(days)
    temps_by_day = {}
    for offset in range(-2, (ordered[-1] - ordered[0]).days + 1):
        day = ordered[0] + timedelta(days=offset)
        temps_by_day[day] = weather_of(day)
    rows = []
    for day in ordered:
        previous = [mean(temps_by_day[day - timedelta(days=k)][0]) for k in (1, 2)]
        rows.extend(feature_rows(day, temps_by_day[day][0], previous))
    predicted = model.booster.predict(np.asarray(rows, float)) * model.level_factor
    out = []
    for i, day in enumerate(ordered):
        temps, solar, source = temps_by_day[day]
        demand_scale = _growth(g_demand, model.level_center, day)
        solar_scale = _growth(g_solar, source, day)
        out.append(DayForecast(
            day=day,
            demand_mw=[float(v) * demand_scale for v in predicted[24 * i:24 * i + 24]],
            solar_mw=[s * solar_scale for s in solar],
            temp_c=list(temps)))
    return out


# ------------------------------------------------------------------------------------------
# 저장
# ------------------------------------------------------------------------------------------

def save_net_demand_model(model: NetDemandModel, stem: Path = DEFAULT_STEM) -> Path:
    stem.parent.mkdir(parents=True, exist_ok=True)
    model.booster.save_model(str(stem.with_suffix(".txt")))
    pack = lambda table: {d.isoformat(): [list(map(float, a)) for a in v]  # noqa: E731
                          for d, v in table.items()}
    stem.with_suffix(".json").write_text(json.dumps({
        "model_kind": model.model_kind, "feature_names": list(FEATURE_NAMES),
        "trained_from": model.trained_from.isoformat(),
        "trained_through": model.trained_through.isoformat(),
        "training_days": model.training_days, "level_factor": model.level_factor,
        "demand_growth": model.demand_growth, "solar_growth": model.solar_growth,
        "solar_backfill_ratio": model.solar_backfill_ratio,
        "temp_normals": {str(k): v for k, v in model.temp_normals.items()},
        "reference_days": sorted(d.isoformat() for d in model.reference),
        "weather_years": pack(model.weather_years),
    }, ensure_ascii=False), encoding="utf-8")
    return stem


def load_net_demand_model(stem: Path = DEFAULT_STEM) -> NetDemandModel:
    import lightgbm as lgb

    booster_path, meta_path = stem.with_suffix(".txt"), stem.with_suffix(".json")
    if not booster_path.exists() or not meta_path.exists():
        raise FileNotFoundError(f"{stem} 에 순수요 모델이 없습니다. `python -m midterm train` 을 먼저 실행하세요")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if tuple(meta["feature_names"]) != FEATURE_NAMES or meta["model_kind"] != MODEL_KIND:
        raise ValueError("저장된 순수요 모델의 특징/방식이 현재 코드와 다릅니다. 다시 학습하세요")
    weather = {date.fromisoformat(k): (v[0], v[1]) for k, v in meta["weather_years"].items()}
    reference_days = {date.fromisoformat(k) for k in meta["reference_days"]}
    return NetDemandModel(
        booster=lgb.Booster(model_file=str(booster_path)),
        trained_from=date.fromisoformat(meta["trained_from"]),
        trained_through=date.fromisoformat(meta["trained_through"]),
        training_days=meta["training_days"], level_factor=meta["level_factor"],
        demand_growth=meta["demand_growth"], solar_growth=meta["solar_growth"],
        solar_backfill_ratio=meta["solar_backfill_ratio"],
        temp_normals={int(k): v for k, v in meta["temp_normals"].items()},
        reference={d: weather[d] for d in reference_days}, weather_years=weather)
