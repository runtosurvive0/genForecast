"""[포크] national-solar-forecast `dss/coal_curve_model.py` (커밋 be2a0a0) 그대로. 기존 석탄예측모델을
연간 전망에 쓰기 위해 경로·달력 import 만 바꿨다. 학습식·특징 순서는 원본과 같아야 한다.

순수요와 원전으로 기준 석탄량을 만들고 LightGBM이 그 오차만 보정한다.

학습 원전은 ``supply_mix_5min`` 실적이다. 운영 원전은 전망 계산에 들어온 KPX 공급능력표
적용값이다. 과거 석탄을 예측 특징으로 쓰지 않아 먼 전망에 묵은 "전일" 실적을 넣지 않는다.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from math import cos, pi, sin
from pathlib import Path
from statistics import median
from typing import Any

from midterm.calendar import day_type, is_major_holiday

#: 열 순서는 모델의 일부다. 저장된 모델을 다른 순서로 읽으면 태양광 자리에 원자력이 들어가고
#: 답은 자신 있게 틀린다. `gross_load_registry` 가 같은 이유로 같은 검사를 한다.
FEATURE_NAMES: tuple[str, ...] = (
    "net_demand_mw",
    "nuclear_mw",
    "net_after_nuclear_mw",
    "baseline_coal_mw",
    "hour_sin",
    "hour_cos",
    "day_type_code",
    "previous_day_type_code",
    "next_day_type_code",
    "month",
    "is_major_holiday",
)

#: 학습에서 본 요일유형만 코드가 있다. 못 본 유형은 이 값으로 보내 평일 잎으로 새지 않게 한다.
DAY_TYPE_CODES: Mapping[str, int] = {"saturday": 0, "sunday_or_holiday": 1, "weekday": 2}
UNSEEN_DAY_TYPE_CODE = -1

#: 학습에 필요한 최소 일수. 이보다 적으면 후보를 내지 않는다 -- 얇은 학습으로 낸 곡선을
#: 화면에 올리면 후보가 아니라 잡음이다.
MIN_TRAINING_DAYS = 120

BOOSTER_SUFFIX = ".txt"
METADATA_SUFFIX = ".json"
DEFAULT_STEM = Path(__file__).resolve().parents[2] / "models" / "coal-curve"
MODEL_KIND = "net-load-nuclear-residual-v2"


@dataclass(frozen=True, slots=True)
class CoalCurveModel:
    booster: Any
    feature_names: tuple[str, ...]
    training_rows: int
    training_days: int
    first_day: date
    last_day: date
    baseline_shares: tuple[float, ...]
    model_kind: str = MODEL_KIND


def feature_row(
    *,
    hour: int,
    day: date,
    net_demand_mw: float,
    nuclear_mw: float,
    baseline_coal_mw: float,
) -> list[float]:
    """한 시간의 특징. 학습과 예측이 같은 함수를 쓴다 -- 두 벌로 두면 언젠가 어긋난다."""
    return [
        net_demand_mw,
        nuclear_mw,
        net_demand_mw - nuclear_mw,
        baseline_coal_mw,
        sin(2 * pi * hour / 24),
        cos(2 * pi * hour / 24),
        float(DAY_TYPE_CODES.get(day_type(day), UNSEEN_DAY_TYPE_CODE)),
        float(DAY_TYPE_CODES.get(day_type(day - timedelta(days=1)), UNSEEN_DAY_TYPE_CODE)),
        float(DAY_TYPE_CODES.get(day_type(day + timedelta(days=1)), UNSEEN_DAY_TYPE_CODE)),
        float(day.month),
        float(is_major_holiday(day)),
    ]


def _share_index(day: date, hour: int) -> int:
    return DAY_TYPE_CODES[day_type(day)] * 24 + hour


def baseline_share(shares: Sequence[float], day: date, hour: int) -> float:
    """Same baseline in fitting and prediction; calendar transitions are learned as features.

    Mixing neighboring day classes here degraded held-out midnight errors. Keep the empirical
    same-hour ratio and let the residual model use cyclic time and calendar context instead.
    """
    return shares[_share_index(day, hour)]


def baseline_shares(
    days: Mapping[date, Mapping[int, tuple[float, float, float, float]]],
) -> tuple[float, ...]:
    """요일유형·시간별 ``석탄 / (총수요-태양광-원전)`` 중앙값."""
    buckets: list[list[float]] = [[] for _ in range(len(DAY_TYPE_CODES) * 24)]
    hourly: list[list[float]] = [[] for _ in range(24)]
    for day, hours in days.items():
        if set(hours) != set(range(24)):
            continue
        for hour, (demand, coal, nuclear, solar) in hours.items():
            remainder = demand - solar - nuclear
            if remainder <= 0 or coal < 0:
                continue
            ratio = coal / remainder
            if 0 <= ratio <= 1:
                buckets[_share_index(day, hour)].append(ratio)
                hourly[hour].append(ratio)
    if any(not values for values in hourly):
        raise ValueError("석탄 담당비율 학습에 24시간 실적이 모두 필요합니다")
    fallback = [median(values) for values in hourly]
    return tuple(
        median(values) if values else fallback[index % 24]
        for index, values in enumerate(buckets)
    )


def training_matrix(days: Mapping[date, Mapping[int, tuple[float, float, float, float]]],
                    shares: Sequence[float] | None = None):
    """`{날짜: {시각: (총수요, 석탄, 원자력, 태양광)}}` 에서 (특징행렬, 목표) 를 만든다.

    하루의 일부만 쓰면 그 날의 형상이 반쪽만 들어가므로 완전한 날만 사용한다.
    """
    shares = tuple(shares or baseline_shares(days))
    rows, targets = [], []
    for day in sorted(days):
        hours = days[day]
        if set(hours) != set(range(24)):
            continue
        for hour in range(24):
            demand, coal, nuclear, solar = hours[hour]
            net = demand - solar
            baseline = max(0.0, net - nuclear) * baseline_share(shares, day, hour)
            rows.append(feature_row(
                hour=hour, day=day, net_demand_mw=net, nuclear_mw=nuclear,
                baseline_coal_mw=baseline))
            targets.append(coal - baseline)
    return rows, targets


def train_coal_curve_model(
    days: Mapping[date, Mapping[int, tuple[float, float, float, float]]],
) -> CoalCurveModel:
    """실적에서 석탄 곡선 모델을 적합한다."""
    import lightgbm as lgb
    import numpy as np

    shares = baseline_shares(days)
    rows, targets = training_matrix(days, shares)
    complete = sorted(d for d in days if set(days[d]) == set(range(24)))
    if len(complete) < MIN_TRAINING_DAYS:
        raise ValueError(
            f"석탄 곡선 학습에 완전한 하루 {MIN_TRAINING_DAYS}일이 필요합니다 "
            f"(현재 {len(complete)}일)"
        )
    booster = lgb.train(
        {"objective": "regression", "learning_rate": 0.05, "num_leaves": 31,
         "min_data_in_leaf": 20, "verbose": -1},
        lgb.Dataset(np.asarray(rows, dtype=float), label=np.asarray(targets, dtype=float),
                    feature_name=list(FEATURE_NAMES),
                    categorical_feature=['day_type_code', 'previous_day_type_code',
                                         'next_day_type_code']),
        num_boost_round=300,
    )
    return CoalCurveModel(
        booster=booster, feature_names=FEATURE_NAMES, training_rows=len(rows),
        training_days=len(complete), first_day=complete[0], last_day=complete[-1],
        baseline_shares=shares,
    )


def predict_coal_curve(
    model: CoalCurveModel,
    *,
    day: date,
    demand_mw: Sequence[float],
    solar_mw: Sequence[float],
    nuclear_mw: Sequence[float],
) -> list[float]:
    """하루 24시간 석탄 MW."""
    import numpy as np

    given = (demand_mw, solar_mw, nuclear_mw)
    if any(len(x) != 24 for x in given):
        raise ValueError("석탄 곡선 예측에는 24시간이 모두 필요합니다")
    baselines = [
        max(0.0, demand_mw[hour] - solar_mw[hour] - nuclear_mw[hour])
        * baseline_share(model.baseline_shares, day, hour)
        for hour in range(24)
    ]
    rows = [feature_row(
        hour=hour, day=day, net_demand_mw=demand_mw[hour] - solar_mw[hour],
        nuclear_mw=nuclear_mw[hour], baseline_coal_mw=baselines[hour])
        for hour in range(24)]
    corrections = model.booster.predict(np.asarray(rows, dtype=float))
    return [max(0.0, base + float(delta))
            for base, delta in zip(baselines, corrections, strict=True)]


def _paths(stem: Path) -> tuple[Path, Path]:
    return stem.with_suffix(BOOSTER_SUFFIX), stem.with_suffix(METADATA_SUFFIX)


def save_coal_curve_model(model: CoalCurveModel, stem: Path = DEFAULT_STEM) -> Path:
    booster, metadata = _paths(stem)
    booster.parent.mkdir(parents=True, exist_ok=True)
    model.booster.save_model(str(booster))
    metadata.write_text(json.dumps({
        "feature_names": list(model.feature_names),
        "training_rows": model.training_rows,
        "training_days": model.training_days,
        "first_day": model.first_day.isoformat(),
        "last_day": model.last_day.isoformat(),
        "baseline_shares": list(model.baseline_shares),
        "model_kind": model.model_kind,
        "nuclear_training_basis": "supply_mix_5min actual nuclear generation",
        "nuclear_prediction_basis": "KPX supply availability applied to outlook allocation",
        "day_type_codes": dict(DAY_TYPE_CODES),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return stem


def load_coal_curve_model(stem: Path = DEFAULT_STEM) -> CoalCurveModel:
    """저장된 모델을 읽는다. 특징 순서가 다르면 거부한다."""
    import lightgbm as lgb

    booster_path, metadata_path = _paths(stem)
    if not booster_path.exists() or not metadata_path.exists():
        raise FileNotFoundError(f"{stem} 에 저장된 석탄 곡선 모델이 없습니다")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    stored = tuple(metadata.get("feature_names", ()))
    if stored != FEATURE_NAMES:
        raise ValueError(
            "저장된 모델의 특징 순서가 지금과 다릅니다. 그대로 읽으면 열이 어긋난 채 "
            f"답합니다.\n  저장: {stored}\n  현재: {FEATURE_NAMES}")
    if metadata.get("model_kind") != MODEL_KIND:
        raise ValueError("저장된 석탄 곡선 모델 방식이 현재와 다릅니다. 다시 학습해야 합니다")
    shares = tuple(float(value) for value in metadata.get("baseline_shares", ()))
    if len(shares) != len(DAY_TYPE_CODES) * 24:
        raise ValueError("저장된 석탄 담당비율이 없거나 시간축이 다릅니다. 다시 학습해야 합니다")
    return CoalCurveModel(
        booster=lgb.Booster(model_file=str(booster_path)),
        feature_names=stored,
        training_rows=int(metadata["training_rows"]),
        training_days=int(metadata["training_days"]),
        first_day=date.fromisoformat(metadata["first_day"]),
        last_day=date.fromisoformat(metadata["last_day"]),
        baseline_shares=shares,
        model_kind=metadata["model_kind"],
    )
