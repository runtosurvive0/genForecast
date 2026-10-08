"""저장된 시간별 발전계획과 실적 스냅샷을 일·월 연료사용량으로 집계한다."""

from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import numpy as np

from midterm.fleet import COAL_UNITS, load_coal_units
from midterm.storage import exists, mirror_of, read_table
from midterm.units import canonical_unit_name


def heat_consumption(output: np.ndarray, online: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    """시간별 Gcal. 정지한 호기의 무부하 열량은 제외한다."""
    a2, a1, a0 = coefficients.T
    return np.maximum(0, (a2 * output ** 2 + a1 * output + a0) * online)


def aggregate_fuel(dates: list[str], units: list[str], heat: np.ndarray,
                   calorific_kcal_kg: float | None) -> dict:
    """톤 = Gcal × 1000 / (kcal/kg). 일·월·기간합계는 같은 원자료에서 계산."""
    by_day = defaultdict(lambda: np.zeros(len(units)))
    for day, row in zip(dates, heat, strict=True):
        by_day[day[:10]] += row
    by_month = defaultdict(lambda: np.zeros(len(units)))

    def pack(period, values):
        tonnes = values * 1000 / calorific_kcal_kg if calorific_kcal_kg else None
        return {"period": period, "heat_gcal": round(float(values.sum()), 3),
                "tonnes": round(float(tonnes.sum()), 3) if tonnes is not None else None,
                "unit_heat_gcal": {u: round(float(v), 3) for u, v in zip(units, values)},
                "unit_tonnes": {u: round(float(v), 3) for u, v in zip(units, tonnes)}
                if tonnes is not None else {u: None for u in units}}

    daily = []
    for day, values in sorted(by_day.items()):
        daily.append(pack(day, values))
        by_month[day[:7]] += values
    total = sum(by_day.values(), np.zeros(len(units)))
    return {"daily": daily, "monthly": [pack(m, v) for m, v in sorted(by_month.items())],
            "total": pack("total", total)}


def planned_fuel(folder: Path, summary: dict, calorific: float | None) -> dict:
    master = {u.name: u for u in load_coal_units()}
    with np.load(folder / "hourly.npz") as data:
        names = [str(n) for n in data["names"]]
        indices = [names.index(u) for u in summary["units"]]
        coefficients = np.asarray([master[u].heat for u in summary["units"]])
        heat = heat_consumption(data["output"][:, indices].astype(float),
                                data["online"][:, indices], coefficients)
    dates = [d["date"] for d in summary["daily"] for _ in range(24)]
    return aggregate_fuel(dates, summary["units"], heat, calorific)


@lru_cache(maxsize=2)
def _generation_snapshot(path: str, modified: int, curve_modified: int) -> tuple:
    # CSV 또는 복구용 JSON 변경 시 캐시를 갱신한다.
    master = {u.name: u for u in load_coal_units() if u.is_dangjin}
    units = sorted(master, key=lambda u: int(u.removeprefix("당진")))
    grouped = defaultdict(dict)
    for r in read_table(Path(path)):
        unit = canonical_unit_name(r["unit"])
        if unit in master and r["output_mw"] != "":
            grouped[r["hour"]][unit] = float(r["output_mw"])
    dates, outputs, incomplete = [], [], set()
    for hour, values in sorted(grouped.items()):
        if len(values) != len(units):
            incomplete.add(hour[:10])
            continue
        dates.append(hour[:10])
        outputs.append([values[u] for u in units])
    counts = defaultdict(int)
    for day in dates:
        counts[day] += 1
    complete = {day for day, count in counts.items() if count == 24 and day not in incomplete}
    keep = [i for i, day in enumerate(dates) if day in complete]
    values = np.asarray(outputs, dtype=float).reshape(-1, len(units))[keep]
    coefficients = np.asarray([master[u].heat for u in units])
    heat = heat_consumption(values, values > 0.5, coefficients)
    return [dates[i] for i in keep], units, heat, len((set(counts) | incomplete) - complete)


def historical_fuel(path: Path, calorific: float | None) -> dict:
    if not exists(path):
        return {"daily": [], "monthly": [], "omitted_days": 0, "source": str(path)}
    source = path if path.exists() else mirror_of(path)
    curve_source = COAL_UNITS if COAL_UNITS.exists() else mirror_of(COAL_UNITS)
    dates, units, heat, omitted = _generation_snapshot(str(path), source.stat().st_mtime_ns,
                                                      curve_source.stat().st_mtime_ns)
    return {**aggregate_fuel(dates, units, heat, calorific), "omitted_days": omitted,
            "source": str(path), "classification": "generation_based_estimate"}
