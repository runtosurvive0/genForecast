"""1년 실행: 순수요 전망 → 원전(정비 반영) → 기존 석탄곡선 모델 → 석탄 MILP(롤링·병렬).

MILP 는 원천과 같은 48시간 창·24시간 확정으로 이어 푼다(`rolling.solve_rolling`). 1년은 창이
365개라 한 줄로 이으면 몇 시간이 걸린다. 그래서 기간을 작업자 수만큼 구간으로 나눠 **프로세스
병렬**로 풀고, 구간마다 앞에 2일 예열을 붙여 그 2일은 버린다 -- 구간 첫 시각의 운전상태를
추정이 아니라 앞 이틀의 풀이에서 받기 위해서다. 구간 경계의 연속성은 예열로만 맞추므로 경계에서
최소운전·정지시간이 완벽히 이어진다고 보장하지는 않는다(보고서에 적는다).
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Callable

import numpy as np

from midterm.coal_curve import load_coal_curve_model, predict_coal_curve
from midterm.fleet import (NUCLEAR_OUTPUT_FACTOR, coal_inputs, group_constraints, hours_of,
                           load_coal_units, load_heat_prices, load_nuclear_units, nuclear_hourly)
from midterm.net_demand import forecast_net_demand, load_net_demand_model
from midterm.scenario import QUALITY, Scenario

WINDOW_HOURS = 48
STEP_HOURS = 24
WARMUP_DAYS = 2
#: 석탄 목표는 정비 제외 가용 최대출력의 이 비율을 넘지 않게 자른다(넘는 몫은 LNG 등 몫).
TARGET_CAP_OF_AVAILABLE = 0.97
SLACK_PENALTY_WON = 5e7

Progress = Callable[[dict], None]


@dataclass(slots=True)
class AnnualResult:
    scenario: Scenario
    days: list[date]
    names: list[str]
    demand: np.ndarray
    solar: np.ndarray
    temp: np.ndarray
    nuclear: np.ndarray
    coal_model: np.ndarray        # 석탄곡선 모델 원값(보정 전)
    coal_target: np.ndarray       # 월보정·가용상한 적용 후 MILP 목표
    coal_available: np.ndarray
    output: np.ndarray            # (h, n) MW
    online: np.ndarray
    starts: np.ndarray
    shortage: np.ndarray
    excess: np.ndarray
    fuel_cost_won: np.ndarray     # (h, n) 2차 곡선으로 다시 센 연료비
    nuclear_running: dict[str, np.ndarray]
    window_status: list[str]
    elapsed_seconds: float
    model_info: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def net(self) -> np.ndarray:
        return self.demand - self.solar


# ------------------------------------------------------------------------------------------
# 병렬 작업자
# ------------------------------------------------------------------------------------------

def _solve_window(queue, segment, counter, *args, **kwargs):
    """창 하나. 해가 없으면 시간을 늘리고 간격을 넓혀 두 번 더 시도한다."""
    from midterm.uc import solve_coal_uc

    attempts = [(1.0, kwargs["mip_rel_gap"]), (3.0, max(kwargs["mip_rel_gap"], 0.01)),
                (6.0, 0.05)]
    base = kwargs["time_limit"]
    result = None
    for factor, gap in attempts:
        kw = {**kwargs, "time_limit": base * factor, "cost_time_limit": base * factor,
              "mip_rel_gap": gap}
        result = solve_coal_uc(*args, **kw)
        if result.get("has_plan"):
            break
    counter[0] += 1
    if queue is not None:
        queue.put({"segment": segment, "windows_done": counter[0],
                   "status": result.get("status")})
    return result


def _solve_segment(payload: dict) -> dict:
    """구간 하나를 48/24 롤링으로 푼다(별도 프로세스)."""
    from midterm.rolling import solve_rolling

    queue, segment = payload.pop("queue"), payload.pop("segment")
    counter = [0]
    args = payload.pop("args")
    began = time.perf_counter()
    result = solve_rolling(
        lambda *a, **k: _solve_window(queue, segment, counter, *a, **k),
        *args, window=WINDOW_HOURS, step=STEP_HOURS, **payload)
    if not result.get("has_plan"):
        raise RuntimeError(f"구간 {segment} 창 {result.get('rolling', {}).get('failed_window')} "
                           f"해 없음: {result.get('message')}")
    keys = ("output_mw", "online", "starts", "stops", "shortage_mw", "excess_mw")
    return {"segment": segment, "seconds": time.perf_counter() - began,
            "window_status": result.get("rolling", {}).get("window_status", [result["status"]]),
            **{k: np.asarray(result[k]) for k in keys}}


# ------------------------------------------------------------------------------------------
# 본체
# ------------------------------------------------------------------------------------------

def _segments(total_days: int, count: int) -> list[tuple[int, int]]:
    count = max(1, min(count, total_days // 7 or 1))
    edges = np.linspace(0, total_days, count + 1).round().astype(int)
    return [(int(a), int(b)) for a, b in zip(edges[:-1], edges[1:]) if b > a]


def prepare(scenario: Scenario) -> dict:
    """MILP 직전까지: 순수요·원전·석탄목표·입력행렬. 화면 미리보기도 이것을 쓴다."""
    warmup_first = scenario.start - timedelta(days=WARMUP_DAYS)
    all_days = [warmup_first + timedelta(days=i)
                for i in range((scenario.end - warmup_first).days + 1)]
    net_model = load_net_demand_model()
    forecast = forecast_net_demand(
        net_model, all_days, weather=scenario.weather,
        demand_growth=None if scenario.demand_growth_pct is None else scenario.demand_growth_pct / 100,
        solar_growth=None if scenario.solar_growth_pct is None else scenario.solar_growth_pct / 100)
    hours = hours_of(all_days)
    nuclear, running = nuclear_hourly(load_nuclear_units(), scenario.nuclear_oh, hours)
    coal_model = load_coal_curve_model()
    raw = np.concatenate([
        predict_coal_curve(coal_model, day=f.day, demand_mw=f.demand_mw, solar_mw=f.solar_mw,
                           nuclear_mw=nuclear[24 * i:24 * i + 24])
        for i, f in enumerate(forecast)])
    adjust = np.asarray([1 + scenario.coal_adjust_pct[at.month - 1] / 100 for at in hours])
    units = load_coal_units()
    inputs = coal_inputs(units, load_heat_prices(), scenario.coal_oh, hours)
    available = inputs.available_max
    target = np.clip(raw * adjust, 0, available * TARGET_CAP_OF_AVAILABLE)
    warnings = []
    unseen = sorted({at.month for at in hours[WARMUP_DAYS * 24:]} - set(range(1, 10)))
    if unseen and all(abs(scenario.coal_adjust_pct[m - 1]) < 1e-9 for m in unseen):
        warnings.append(
            "석탄곡선 모델은 2026-01~09 실적으로만 학습돼 10~12월을 본 적이 없습니다. "
            "2025-10~12 표본외 검증에서 +15~+40% 과대예측했습니다 -- 월별 석탄목표 보정을 검토하세요.")
    nuclear_units = [u for u in load_nuclear_units() if u.active]
    fleet_mw = sum(u.available_mw for u in nuclear_units) * NUCLEAR_OUTPUT_FACTOR
    share = float(nuclear[WARMUP_DAYS * 24:].mean()) / fleet_mw if fleet_mw else 0.0
    if share > 0.90:
        warnings.append(
            f"원전 평균출력이 가동 가능 설비의 {share:.0%} 입니다(2023~26 실적 연평균 72~78%). "
            "연간 계획예방정비(OH)가 빠졌는지 확인하세요 -- 원전이 과대하면 석탄목표와 당진 발전량이 "
            "낮게 나옵니다.")
    clipped = float(((raw * adjust) - target).clip(min=0).sum())
    if clipped > 0:
        warnings.append(f"석탄목표가 가용설비의 {TARGET_CAP_OF_AVAILABLE:.0%} 를 넘은 몫 "
                        f"{clipped / 1e3:,.0f} GWh 를 잘랐습니다(정비로 가용설비 부족).")
    return dict(all_days=all_days, hours=hours, forecast=forecast, nuclear=nuclear,
                running=running, raw=raw, target=target, available=available, inputs=inputs,
                net_model=net_model, coal_model=coal_model, warnings=warnings)


def run_annual(scenario: Scenario, progress: Progress | None = None) -> AnnualResult:
    began = time.perf_counter()
    notify = progress or (lambda event: None)
    notify({"stage": "prepare", "message": "순수요·원전·석탄목표 계산"})
    return solve_prepared(prepare(scenario), scenario, notify, began)


def solve_prepared(prep: dict, scenario: Scenario, notify: Progress, began: float) -> AnnualResult:
    """`prepare` 가 만든 목표·입력행렬로 MILP 를 푼다. 백테스트는 실적 석탄을 목표로 넣어 부른다."""
    inputs, target = prep["inputs"], prep["target"]
    groups = group_constraints(inputs, target)
    time_limit, gap = QUALITY[scenario.quality]
    total_days = len(prep["all_days"]) - WARMUP_DAYS
    workers = scenario.workers or max(1, (os.cpu_count() or 2) - 1)
    segments = _segments(total_days, workers)
    windows_total = sum((b - a) + WARMUP_DAYS - 1 for a, b in segments)
    notify({"stage": "solve", "message": f"MILP {len(segments)}개 구간 병렬", "windows_total": windows_total,
            "windows_done": 0})

    def hourly_slice(array, a, b):
        return np.asarray(array)[a:b]

    def group_slice(groups_, key, a, b):
        return [{**g, key: list(np.asarray(g[key])[a:b])} for g in groups_]

    import multiprocessing
    manager = multiprocessing.Manager()
    queue = manager.Queue()
    payloads = []
    for k, (a, b) in enumerate(segments):
        # 구간 a..b(대상일 기준) ↔ 전체 시간축(예열 포함)에서 [a, b+WARMUP) 일. 구간 시작 앞 2일이 예열.
        h0, h1 = a * 24, (b + WARMUP_DAYS) * 24
        payloads.append({
            "segment": k, "queue": queue,
            "args": [hourly_slice(x, h0, h1) for x in (target, inputs.minimum, inputs.maximum,
                                                         inputs.ramp_up, inputs.costs, inputs.must,
                                                         inputs.outage)] + [inputs.uptime, inputs.downtime],
            "startup_cost": hourly_slice(inputs.startup_cost, h0, h1),
            "ramp_down": hourly_slice(inputs.ramp_down, h0, h1),
            "no_load_won": hourly_slice(inputs.no_load, h0, h1),
            "reserve_mw": (hourly_slice(target, h0, h1) * scenario.reserve_ratio
                           if scenario.reserve_ratio > 0 else None),
            "group_caps": group_slice(groups["group_caps"], "maximum_mw", h0, h1),
            "group_online_minimums": group_slice(groups["group_online_minimums"], "minimum_units", h0, h1),
            "group_online_maximums": group_slice(groups["group_online_maximums"], "maximum_units", h0, h1),
            "allow_approximate": True, "single_stage": True, "slack_penalty_won": SLACK_PENALTY_WON,
            "objective_scale": 1e-3, "time_limit": time_limit, "cost_time_limit": time_limit,
            "mip_rel_gap": gap,
        })
        if payloads[-1]["reserve_mw"] is None:
            payloads[-1].pop("reserve_mw")

    h = len(prep["hours"]) - WARMUP_DAYS * 24
    n = len(inputs.names)
    output, online = np.zeros((h, n)), np.zeros((h, n), bool)
    starts = np.zeros((h, n), bool)
    shortage, excess = np.zeros(h), np.zeros(h)
    statuses: dict[int, list[str]] = {}
    done = {k: 0 for k in range(len(segments))}
    with ProcessPoolExecutor(max_workers=min(workers, len(segments))) as pool:
        futures = {pool.submit(_solve_segment, p): p["segment"] for p in payloads}
        pending = set(futures)
        while pending:
            while not queue.empty():
                event = queue.get()
                done[event["segment"]] = event["windows_done"]
                notify({"stage": "solve", "windows_total": windows_total,
                        "windows_done": sum(done.values()),
                        "elapsed": time.perf_counter() - began})
            finished = [f for f in pending if f.done()]
            for future in finished:
                pending.discard(future)
                part = future.result()
                k = part["segment"]
                a, b = segments[k]
                keep = slice(WARMUP_DAYS * 24, None)
                rows = slice(a * 24, b * 24)
                output[rows] = part["output_mw"][keep]
                online[rows] = part["online"][keep]
                starts[rows] = part["starts"][keep]
                shortage[rows] = part["shortage_mw"][keep]
                excess[rows] = part["excess_mw"][keep]
                statuses[k] = part["window_status"]
            if pending:
                time.sleep(0.5)
    manager.shutdown()

    keep = slice(WARMUP_DAYS * 24, None)
    fuel = inputs.fuel_curve[keep]
    fuel_cost = (fuel[..., 0] * output ** 2 + fuel[..., 1] * output + fuel[..., 2]) * online
    window_status = [s for k in sorted(statuses) for s in statuses[k]]
    net_model = prep["net_model"]
    result = AnnualResult(
        scenario=scenario, days=prep["all_days"][WARMUP_DAYS:], names=inputs.names,
        demand=np.concatenate([f.demand_mw for f in prep["forecast"]])[keep],
        solar=np.concatenate([f.solar_mw for f in prep["forecast"]])[keep],
        temp=np.concatenate([f.temp_c for f in prep["forecast"]])[keep],
        nuclear=prep["nuclear"][keep], coal_model=prep["raw"][keep], coal_target=target[keep],
        coal_available=prep["available"][keep], output=output, online=online, starts=starts,
        shortage=shortage, excess=excess, fuel_cost_won=fuel_cost,
        nuclear_running={k: v[keep] for k, v in prep["running"].items()},
        window_status=window_status, elapsed_seconds=time.perf_counter() - began,
        model_info={
            "net_demand": {"trained": f"{net_model.trained_from} ~ {net_model.trained_through}",
                           "demand_growth_pct": (scenario.demand_growth_pct if scenario.demand_growth_pct
                                                 is not None else net_model.demand_growth * 100),
                           "solar_growth_pct": (scenario.solar_growth_pct if scenario.solar_growth_pct
                                                is not None else net_model.solar_growth * 100)},
            "coal_curve": {"trained": f"{prep['coal_model'].first_day} ~ {prep['coal_model'].last_day}",
                           "kind": prep["coal_model"].model_kind},
            "milp": {"window_h": WINDOW_HOURS, "step_h": STEP_HOURS, "segments": len(segments),
                     "warmup_days": WARMUP_DAYS, "time_limit_s": time_limit, "mip_rel_gap": gap,
                     "cost": "연료곡선 할선(최소~최대) 선형 + 기동비", "reserve_ratio": scenario.reserve_ratio}},
        warnings=prep["warnings"])
    notify({"stage": "done", "elapsed": result.elapsed_seconds})
    return result
