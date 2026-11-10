"""접안 추천 풀이: 시간 격자 MILP(scipy `milp`, HiGHS)와 일정 평가.

시간은 `inputs.t0`(정시) 기준 시간 단위로 센다. 격자는 기간 + 7일까지 두어 기간 끝을 넘는 하역도
부두를 막게 한다. 재고는 `StockSeries.base`(하루 끝 재고, 0일 = `inputs.midnight`)에 하역완료
입하를 더해 판정한다."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from midterm.berth_plan.inputs import Berth, BerthInputs, Outage, Voyage, unload_hours

HOUR = timedelta(hours=1)
DAY = timedelta(days=1)
WINDOW_HOURS = 168
GRID_EXTRA_DAYS = 7
DANGER_COST_USD = 1e8
# 같은 비용의 답 중 일찍 시작하는 쪽을 고르게 하는 아주 작은 값(USD/시간). 결과를 안정시킨다.
START_TIE_BREAK_USD = 1e-3


@dataclass
class Assignment:
    voyage_no: str
    berth_id: str | None
    berth_at: datetime | None
    unload_end: datetime | None
    fixed: bool = False


@dataclass
class OptionResult:
    status: str  # 'optimal' | 'time_limit' | 'infeasible'
    gap_pct: float | None
    assignments: list[Assignment]
    danger_violated: bool
    message: str | None


@dataclass(frozen=True)
class _Candidate:
    voyage: int
    berth: str
    start: datetime
    end: datetime
    hours: range  # 격자에서 점유하는 시간 칸


def _merged(outages: list[Outage], berth_id: str) -> list[tuple[datetime, datetime]]:
    spans = sorted((o.start, o.end) for o in outages if o.berth == berth_id and o.end > o.start)
    merged: list[list[datetime]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def _occupancy(duration: timedelta, start: datetime, spans: list[tuple[datetime, datetime]]) -> datetime:
    end = start + duration
    for o_start, o_end in spans:
        if o_end <= start:
            continue
        if o_start >= end:
            break
        end += o_end - max(o_start, start)
    return end


def occupancy(v: Voyage, berth: Berth, start: datetime, outages: list[Outage]) -> datetime:
    """하역완료 시각. 하역 중 정비가 끼면 그 길이만큼 늦어진다."""
    return _occupancy(unload_hours(v.tonnes, berth) * HOUR, start, _merged(outages, berth.id))


def _in_outage(start: datetime, spans: list[tuple[datetime, datetime]]) -> bool:
    return any(o_start < start + HOUR and start < o_end for o_start, o_end in spans)


def _hours(start: datetime, end: datetime, t0: datetime, grid: int) -> range:
    first = math.floor((start - t0) / HOUR)
    last = math.ceil((end - t0) / HOUR)
    return range(max(0, first), min(grid, last))


def _demurrage_hours(v: Voyage, start: datetime) -> float | None:
    if v.laytime_hours is None or v.demurrage_usd_per_day is None:
        return None
    return max(0., (start - v.eta) / HOUR - v.laytime_hours)


def _receipt_day(inputs: BerthInputs, end: datetime | None) -> int | None:
    if end is None or end >= inputs.midnight + inputs.horizon_days * DAY:
        return None
    return max(0, math.floor((end - inputs.midnight) / DAY))


def _infeasible(message: str) -> OptionResult:
    return OptionResult('infeasible', None, [], False, message)


def _blocked(inputs: BerthInputs, grid: int) -> dict[str, set[int]]:
    blocked: dict[str, set[int]] = {b: set() for b in inputs.berths}
    grid_end = inputs.t0 + grid * HOUR
    for f in inputs.fixed:
        if f.berth in blocked:
            blocked[f.berth].update(_hours(inputs.t0, f.until or grid_end, inputs.t0, grid))
    return blocked


def _candidates(inputs: BerthInputs, locks, grid: int) -> tuple[list[_Candidate], str | None]:
    t0 = inputs.t0
    spans = {b: _merged(inputs.outages, b) for b in inputs.berths}
    blocked = _blocked(inputs, grid)
    index = {v.voyage_no: i for i, v in enumerate(inputs.voyages)}
    locked: dict[int, dict] = {}
    for lock in locks:
        no = lock.get('voyage_no')
        if no not in index:
            return [], f'고정 항차 {no}가 배정 대상에 없음'
        i = index[no]
        if i in locked and (locked[i]['berth_id'], locked[i]['berth_at']) != (lock['berth_id'], lock['berth_at']):
            return [], f'항차 {no}에 고정이 둘 이상임'
        locked[i] = lock
    last_start = t0 + (24 * inputs.horizon_days - 1) * HOUR
    result: list[_Candidate] = []
    for i, v in enumerate(inputs.voyages):
        if i in locked:
            berth_id, start = locked[i]['berth_id'], locked[i]['berth_at']
            if berth_id not in inputs.berths or berth_id not in v.allowed:
                return [], f'고정 항차 {v.voyage_no}: 부두 {berth_id}는 이 항차의 저탄장으로 보낼 수 없음'
            if start < v.eta:
                return [], f'고정 항차 {v.voyage_no}: 입항 예정(ETA) 전 접안'
            if start < t0:
                return [], f'고정 항차 {v.voyage_no}: 기준시각 전 접안'
            if _in_outage(start, spans[berth_id]):
                return [], f'고정 항차 {v.voyage_no}: 부두 {berth_id} 정비 시간에 시작'
            end = occupancy(v, inputs.berths[berth_id], start, inputs.outages)
            hours = _hours(start, end, t0, grid)
            if blocked[berth_id].intersection(hours):
                return [], f'고정 항차 {v.voyage_no}: 부두 {berth_id} 접안 중 선박과 겹침'
            result.append(_Candidate(i, berth_id, start, end, hours))
            continue
        lower = max(t0 + math.ceil((v.eta - t0) / HOUR) * HOUR, t0)
        upper = max(lower, min(last_start, lower + WINDOW_HOURS * HOUR))
        count = 0
        for berth_id in v.allowed:
            if berth_id not in inputs.berths:
                continue
            duration = unload_hours(v.tonnes, inputs.berths[berth_id]) * HOUR
            start = lower
            while start <= upper:
                if not _in_outage(start, spans[berth_id]):
                    end = _occupancy(duration, start, spans[berth_id])
                    hours = _hours(start, end, t0, grid)
                    if not blocked[berth_id].intersection(hours):
                        result.append(_Candidate(i, berth_id, start, end, hours))
                        count += 1
                start += HOUR
        if not count:
            return [], f'항차 {v.voyage_no}: 가능한 부두·접안 시각 없음'
    return result, None


def solve_option(inputs: BerthInputs, caution_weight_usd: float, locks: list[dict] = (),
                 time_limit_s: float = 30.) -> OptionResult:
    if not inputs.voyages:
        if locks:
            return _infeasible(f'고정 항차 {locks[0].get("voyage_no")}가 배정 대상에 없음')
        return OptionResult('optimal', 0., [], False, None)
    grid = 24 * (inputs.horizon_days + GRID_EXTRA_DAYS)
    cands, problem = _candidates(inputs, list(locks), grid)
    if problem:
        return _infeasible(problem)
    voyages = inputs.voyages
    cost: list[float] = []
    for c in cands:
        v = voyages[c.voyage]
        wait = _demurrage_hours(v, c.start)
        money = 0. if wait is None else wait / 24 * v.demurrage_usd_per_day
        cost.append(money + START_TIE_BREAK_USD * (c.start - inputs.t0) / HOUR)
    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []
    lbs: list[float] = []
    ubs: list[float] = []

    def add(terms, lb, ub):
        row = len(lbs)
        for col, value in terms:
            rows.append(row)
            cols.append(col)
            vals.append(value)
        lbs.append(lb)
        ubs.append(ub)

    by_voyage: dict[int, list[int]] = {}
    covering: dict[tuple[str, int], list[int]] = {}
    for k, c in enumerate(cands):
        by_voyage.setdefault(c.voyage, []).append(k)
        for hour in c.hours:
            covering.setdefault((c.berth, hour), []).append(k)
    for ks in by_voyage.values():
        add([(k, 1.) for k in ks], 1., 1.)
    for ks in covering.values():
        if len(ks) > 1:
            add([(k, 1.) for k in ks], -np.inf, 1.)

    forced_danger = False
    z_cols: list[int] = []
    stock = inputs.stock
    if stock is not None:
        days = [_receipt_day(inputs, c.end) for c in cands]
        for g, base in stock.base.items():
            denom = stock.denom.get(g) or []
            mine = [k for k, c in enumerate(cands) if voyages[c.voyage].group == g]
            for d in range(min(inputs.horizon_days, len(base), len(denom))):
                if denom[d] <= 0:
                    continue
                terms = [(k, voyages[cands[k].voyage].tonnes) for k in mine
                         if days[k] is not None and days[k] <= d]
                reachable = base[d] + sum(t for _, t in terms)
                for limit, weight, is_danger in ((inputs.danger_days, DANGER_COST_USD, True),
                                                 (inputs.normal_days, caution_weight_usd, False)):
                    need = limit * denom[d]
                    if base[d] >= need or (not is_danger and weight <= 0):
                        continue
                    if reachable < need:
                        forced_danger = forced_danger or is_danger
                        continue  # 어떻게 배정해도 못 넘는 날: 상수라서 변수를 두지 않는다
                    col = len(cost)
                    cost.append(weight)
                    if is_danger:
                        z_cols.append(col)
                    add(terms + [(col, need - base[d])], need - base[d], np.inf)

    count = len(cost)
    matrix = coo_matrix((vals, (rows, cols)), shape=(len(lbs), count)).tocsc()
    res = milp(np.array(cost), integrality=np.ones(count), bounds=Bounds(np.zeros(count), np.ones(count)),
               constraints=[LinearConstraint(matrix, np.array(lbs), np.array(ubs))],
               options={'time_limit': time_limit_s, 'mip_rel_gap': 1e-6})
    if res.x is None:
        if res.status == 2:
            return _infeasible('제약을 모두 지키는 일정 없음(부두 점유·정비·고정 항차 충돌 또는 ETA 뒤 7일 안 접안 불가)')
        if res.status == 1:
            return _infeasible('제한 시간 안에 해를 찾지 못함')
        return _infeasible(f'풀이 실패: {res.message}')
    if res.status == 0:
        status, gap = 'optimal', 0.
    else:
        status, gap = 'time_limit', float(getattr(res, 'mip_gap', None) or 0.) * 100
    chosen = [cands[k] for k in range(len(cands)) if res.x[k] > .5]
    assignments = [Assignment(voyages[c.voyage].voyage_no, c.berth, c.start, c.end)
                   for c in sorted(chosen, key=lambda c: (c.start, voyages[c.voyage].voyage_no))]
    violated = forced_danger or any(res.x[col] > .5 for col in z_cols)
    return OptionResult(status, gap, assignments, violated, None)


def evaluate(inputs: BerthInputs, assignments: list[Assignment]) -> dict:
    voyages = {v.voyage_no: v for v in inputs.voyages}
    per_voyage: dict[str, dict] = {}
    total_hours = total_usd = 0.
    receipts: dict[str, list[tuple[int, float]]] = {}
    for a in assignments:
        v = voyages.get(a.voyage_no)
        hours = usd = None
        if v is not None and not a.fixed:
            if a.berth_id is not None and a.berth_at is not None:
                hours = _demurrage_hours(v, a.berth_at)
                if hours is not None:
                    usd = hours / 24 * v.demurrage_usd_per_day
                    total_hours += hours
                    total_usd += usd
            day = _receipt_day(inputs, a.unload_end)
            if day is not None and v.group is not None:
                receipts.setdefault(v.group, []).append((day, v.tonnes))
        per_voyage[a.voyage_no] = {'demurrage_hours': hours, 'demurrage_usd': usd}
    result = {'demurrage_hours': total_hours, 'demurrage_usd': total_usd,
              'min_days': None, 'caution_days': None, 'danger_days': None, 'per_voyage': per_voyage}
    stock = inputs.stock
    if stock is None:
        return result
    levels: list[float] = []
    for g, base in stock.base.items():
        denom = stock.denom.get(g) or []
        for d in range(min(inputs.horizon_days, len(base), len(denom))):
            if denom[d] <= 0:
                continue
            amount = base[d] + sum(t for day, t in receipts.get(g, []) if day <= d)
            levels.append(amount / denom[d])
    result['caution_days'] = sum(1 for x in levels if x < inputs.normal_days)
    result['danger_days'] = sum(1 for x in levels if x < inputs.danger_days)
    result['min_days'] = min(levels) if levels else None
    return result
