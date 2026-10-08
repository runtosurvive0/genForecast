"""호기 마스터(석탄·원전)를 읽고, 기간과 정비계획을 받아 MILP 입력행렬과 원전 출력을 만든다."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

from midterm.outages import Outage, outage_hours
from midterm.units import canonical_unit_name, group_of, plant_of, TRANSMISSION

ROOT = Path(__file__).resolve().parents[2]
COAL_UNITS = ROOT / "data" / "coal_units.csv"
HEAT_PRICE = ROOT / "data" / "heat_price.csv"
NUCLEAR_UNITS = ROOT / "data" / "nuclear_units.csv"

#: 원전 실제 출력 / KPX 공급가능용량. 2026-08-31~10-01 21일 일평균 비의 중앙값(1.003).
NUCLEAR_OUTPUT_FACTOR = 1.003

DANGJIN = "당진"
#: 당진 머스트런: 1~4호기 중 1기, 5~10호기 중 1기 (원천 `unit_groups.py` MustRunGroup).
DANGJIN_MUST_RUN_GROUPS = ((1, 2, 3, 4), (5, 6, 7, 8, 9, 10))
#: 원천 `coal_uc_comparison.PLANT_MINIMUMS`. 영흥은 석탄목표 25 GW 이상이면 3기.
PLANT_MINIMUMS = (("삼천포", 1), ("여수", 1), ("영흥", 2))
YEONGHEUNG_HIGH_TARGET_MW = 25_000.0


def _read_csv(path: Path) -> list[dict]:
    from midterm.storage import read_table
    return read_table(path)


@dataclass(frozen=True, slots=True)
class CoalUnit:
    name: str
    plant: str
    installed_mw: float
    min_mw: float
    max_mw: float
    ramp_up: float          # MW/min
    ramp_down: float
    min_up_h: float
    min_down_h: float
    startup_cost_won: float
    heat: tuple[float, float, float]   # Gcal/h = a2 P² + a1 P + a0
    retire_on: date | None

    @property
    def is_dangjin(self) -> bool:
        return self.plant == DANGJIN


@dataclass(frozen=True, slots=True)
class NuclearUnit:
    name: str
    installed_mw: float
    available_mw: float
    active: bool


def load_coal_units(path: Path = COAL_UNITS) -> list[CoalUnit]:
    units = []
    for row in _read_csv(path):
        units.append(CoalUnit(
            name=row["unit"], plant=row["plant"] or plant_of(row["unit"]),
            installed_mw=float(row["installed_mw"] or row["max_mw"]),
            min_mw=float(row["min_mw"]), max_mw=float(row["max_mw"]),
            ramp_up=float(row["ramp_up_mw_min"]), ramp_down=float(row["ramp_down_mw_min"]),
            min_up_h=float(row["min_up_h"]), min_down_h=float(row["min_down_h"]),
            startup_cost_won=float(row["startup_cost_won"]),
            heat=(float(row["heat_a2"]), float(row["heat_a1"]), float(row["heat_a0"])),
            retire_on=date.fromisoformat(row["retire_on"]) if row.get("retire_on") else None))
    return units


def load_heat_prices(path: Path = HEAT_PRICE) -> dict[str, list[float]]:
    """호기 → 1~12월 열량단가(원/Gcal)."""
    out = {}
    for row in _read_csv(path):
        out[row["unit"]] = [float(row[f"{m}월"]) for m in range(1, 13)]
    return out


def load_nuclear_units(path: Path = NUCLEAR_UNITS) -> list[NuclearUnit]:
    return [NuclearUnit(row["unit"], float(row["installed_mw"]), float(row["available_mw"]),
                        row["active"].strip() in ("1", "true", "True", "Y"))
            for row in _read_csv(path)]


def hours_of(days: list[date]) -> list[datetime]:
    return [datetime.combine(d, datetime.min.time()) + timedelta(hours=h) for d in days for h in range(24)]


# ------------------------------------------------------------------------------------------
# 원전
# ------------------------------------------------------------------------------------------

def nuclear_hourly(units: list[NuclearUnit], outages: list[Outage], hours: list[datetime]
                   ) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """시간별 원전 출력(MW)과 호기별 가동여부. 출력 = Σ 가동호기 공급가능용량 × 1.003."""
    total = np.zeros(len(hours))
    running = {}
    for unit in units:
        if not unit.active:
            continue
        off = np.asarray(outage_hours(outages, unit.name, hours), bool)
        running[unit.name] = ~off
        total += np.where(off, 0.0, unit.available_mw)
    return total * NUCLEAR_OUTPUT_FACTOR, running


# ------------------------------------------------------------------------------------------
# 석탄 MILP 입력
# ------------------------------------------------------------------------------------------

@dataclass(slots=True)
class CoalInputs:
    names: list[str]
    hours: list[datetime]
    minimum: np.ndarray
    maximum: np.ndarray
    ramp_up: np.ndarray
    ramp_down: np.ndarray
    costs: np.ndarray          # 원/kWh -- 연료곡선 할선(최소~최대)의 기울기
    no_load: np.ndarray        # 원/h -- 같은 할선의 절편(운전 중 고정비)
    fuel_curve: np.ndarray     # (h, n, 3) 원/h -- 결과 연료비를 정확히 다시 셀 때
    must: np.ndarray
    outage: np.ndarray
    uptime: np.ndarray
    downtime: np.ndarray
    startup_cost: np.ndarray   # (h, n) 원

    @property
    def available_max(self) -> np.ndarray:
        return (self.maximum * ~self.outage).sum(axis=1)


def coal_inputs(units: list[CoalUnit], prices: dict[str, list[float]], outages: list[Outage],
                hours: list[datetime]) -> CoalInputs:
    h, n = len(hours), len(units)
    months = np.asarray([at.month - 1 for at in hours])
    outage = np.zeros((h, n), bool)
    for j, unit in enumerate(units):
        outage[:, j] = outage_hours(outages, unit.name, hours)
        if unit.retire_on is not None:
            outage[:, j] |= np.asarray([at.date() >= unit.retire_on for at in hours])
    minimum = np.tile([u.min_mw for u in units], (h, 1)).astype(float)
    maximum = np.tile([u.max_mw for u in units], (h, 1)).astype(float)
    price = np.asarray([prices[u.name] for u in units], float).T[months]       # (h, n)
    heat = np.asarray([u.heat for u in units], float)                          # (n, 3)
    fuel_curve = heat[None, :, :] * price[:, :, None]
    a, b, c = fuel_curve[..., 0], fuel_curve[..., 1], fuel_curve[..., 2]
    # 2차 곡선을 최소~최대 할선 하나로: 비용 ≈ (a(min+max)+b)·P + (c − a·min·max)·u.
    # 연료곡선 보조변수를 두면 창당 40초 넘게 걸려(2027-01 48시간 실측) 1년을 풀 수 없다.
    slope = a * (minimum + maximum) + b
    no_load = c - a * minimum * maximum
    return CoalInputs(
        names=[u.name for u in units], hours=hours, minimum=minimum, maximum=maximum,
        ramp_up=np.tile([u.ramp_up for u in units], (h, 1)).astype(float),
        ramp_down=np.tile([u.ramp_down for u in units], (h, 1)).astype(float),
        costs=slope / 1000.0, no_load=no_load, fuel_curve=fuel_curve, must=np.zeros((h, n), bool), outage=outage,
        uptime=np.asarray([u.min_up_h for u in units], float),
        downtime=np.asarray([u.min_down_h for u in units], float),
        startup_cost=np.tile([u.startup_cost_won for u in units], (h, 1)).astype(float))


def group_constraints(inputs: CoalInputs, target: np.ndarray) -> dict:
    """집단 기수 하한(당진 2묶음·삼천포·여수·영흥), 동해안 MW 상한, 동해안 발전소별 1기 상한.

    하한을 채울 가용 호기가 모자란 시간은 그 시간의 하한을 가용 대수로 낮춘다(원천은 그 발전소
    제약을 통째로 뺐다 -- 1년을 푸는 여기서는 정비 몇 주 때문에 1년 내내 빼면 안 된다).
    """
    from midterm.uc import (EAST_ABSOLUTE_MW, EAST_PLANT_COAL_MAX_MW, EAST_PLANT_MAX_UNITS,
                            EAST_PLANTS, EAST_SHARE_OF_COAL)

    names, outage = inputs.names, inputs.outage
    available = ~outage
    minimums, notes = [], []

    def add_minimum(label, index, requested):
        requested = np.broadcast_to(np.asarray(requested, float), (len(target),))
        free = available[:, index].sum(axis=1)
        line = np.minimum(requested, free)
        minimums.append({"indices": index, "minimum_units": line.tolist()})
        notes.append({"group": label, "units": [names[j] for j in index],
                      "limited_hours": int((free < requested).sum())})

    for group in DANGJIN_MUST_RUN_GROUPS:
        index = [j for j, name in enumerate(names) if plant_of(name) == DANGJIN
                 and int(canonical_unit_name(name)[len(DANGJIN):]) in group]
        if index:
            add_minimum(f"당진{group[0]}~{group[-1]} 중 1기", index, 1)
    for plant, least in PLANT_MINIMUMS:
        index = [j for j, name in enumerate(names) if plant_of(name) == plant]
        if not index:
            continue
        requested = (np.where(target >= YEONGHEUNG_HIGH_TARGET_MW, 3, least) if plant == "영흥"
                     else least)
        add_minimum(f"{plant} 최소 {least}기", index, requested)

    east = [j for j, name in enumerate(names) if group_of(name) == TRANSMISSION]
    caps = ([{"indices": east,
              "maximum_mw": np.minimum(EAST_SHARE_OF_COAL * target, EAST_ABSOLUTE_MW).tolist()}]
            if east else [])
    maximums = []
    for plant in EAST_PLANTS:
        index = [j for j, name in enumerate(names) if plant_of(name) == plant]
        if len(index) > EAST_PLANT_MAX_UNITS:
            line = np.where(target <= EAST_PLANT_COAL_MAX_MW, EAST_PLANT_MAX_UNITS, len(index))
            maximums.append({"indices": index, "maximum_units": line.tolist()})
    return {"group_online_minimums": minimums, "group_caps": caps,
            "group_online_maximums": maximums, "notes": notes}
