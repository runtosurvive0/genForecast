"""접안 추천 입력 모으기: 항차 원장·부두 자료·수급 원장 재고를 한 묶음으로 만든다.

읽기 전용이다. 없는 값은 지어내지 않고 `gaps`에 적는다."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from midterm import supply
from midterm.supply import timestamp

BERTHS_FILE = Path(__file__).resolve().parents[1] / 'dummy_data' / 'berths.json'
TARGET_STATUSES = {'planned', 'underway', 'arrived'}
FIXED_STATUSES = {'berthed', 'unloading'}


@dataclass(frozen=True)
class Berth:
    id: str
    unload_tph: float
    work_hours_per_day: float
    yards: tuple[str, ...]


@dataclass(frozen=True)
class Outage:
    berth: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Voyage:
    voyage_no: str
    voyage_number: str | None
    vessel_name: str | None
    yard: str | None
    group: str | None
    tonnes: float
    eta: datetime
    laytime_hours: float | None
    demurrage_usd_per_day: float | None
    allowed: tuple[str, ...]
    current_berth: str | None
    current_berth_at: datetime | None
    current_unload_end: datetime | None


@dataclass(frozen=True)
class Fixed:
    voyage_no: str
    voyage_number: str | None
    vessel_name: str | None
    yard: str | None
    berth: str
    until: datetime | None


@dataclass(frozen=True)
class StockSeries:
    base: dict[str, list[float]]   # 그룹 -> 날짜별(하루 끝) 재고 t. 대상 항차 입하는 뺀 값
    denom: dict[str, list[float]]  # 그룹 -> 날짜별 다음 7일 사용 평균 t/일


@dataclass(frozen=True)
class BerthInputs:
    as_of: datetime
    t0: datetime
    midnight: datetime
    horizon_days: int
    berths: dict[str, Berth]
    outages: list[Outage]
    voyages: list[Voyage]
    fixed: list[Fixed]
    stock: StockSeries | None
    danger_days: float
    normal_days: float
    gaps: list[dict]


def load_berths(path: Path | None = None) -> tuple[dict[str, Berth], list[Outage]]:
    raw = json.loads(Path(path or BERTHS_FILE).read_text(encoding='utf-8'))
    berths = {key: Berth(key, float(v['unload_tph']), float(v['work_hours_per_day']),
                         tuple(str(y) for y in v.get('yards') or []))
              for key, v in (raw.get('berths') or {}).items()}
    outages = [Outage(o['berth'], timestamp(o['start']), timestamp(o['end']))
               for o in raw.get('outage_examples') or []]
    return berths, outages


def unload_hours(tonnes: float, berth: Berth) -> int:
    hours = tonnes / berth.unload_tph / berth.work_hours_per_day * 24
    return max(1, math.ceil(round(hours, 9)))


def _number(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _time(value) -> datetime | None:
    return timestamp(value) if value else None


def _gap(gaps: list, kind: str, voyage_no: str | None, message: str):
    gaps.append({'kind': kind, 'voyage_no': voyage_no, 'message': message})


def build_inputs(registry: dict, berths: dict[str, Berth], outages: list[Outage], stock: StockSeries | None,
                 as_of: datetime, horizon_days: int, danger_days: float = 7., normal_days: float = 15.,
                 stock_gap: str | None = None) -> BerthInputs:
    as_of = timestamp(as_of)
    t0 = as_of.replace(minute=0, second=0, microsecond=0)
    if t0 < as_of:
        t0 += timedelta(hours=1)
    midnight = as_of.replace(hour=0, minute=0, second=0, microsecond=0)
    limit = as_of + timedelta(days=horizon_days)
    ships = {s.get('ship_code'): s for s in registry.get('ships') or []}
    tonnes_by_voyage: dict[str, float] = {}
    for cargo in registry.get('cargo') or []:
        if cargo.get('destination_plant_id') != 'dangjin':
            continue
        amount = _number(cargo.get('bl_t')) or _number(cargo.get('planned_t')) or 0.
        tonnes_by_voyage[cargo.get('voyage_no')] = tonnes_by_voyage.get(cargo.get('voyage_no'), 0.) + amount
    gaps: list[dict] = []
    voyages: list[Voyage] = []
    fixed: list[Fixed] = []
    for v in sorted(registry.get('voyages') or [], key=lambda r: str(r.get('voyage_no'))):
        no = v.get('voyage_no')
        if no not in tonnes_by_voyage or v.get('classification') == 'simulation':
            continue
        status = v.get('status')
        name = (ships.get(v.get('ship_code')) or {}).get('name')
        yard = str(v['yard']).strip() if v.get('yard') else None
        if status in FIXED_STATUSES:
            berth = v.get('berth_id')
            if not berth:
                continue
            until = _time(v.get('planned_unload_end'))
            if until is None:
                _gap(gaps, 'fixed_end_unknown', no, '접안 중 하역 완료 예정 없음 · 기간 끝까지 부두 점유로 둠')
            fixed.append(Fixed(no, v.get('voyage_number'), name, yard, berth, until))
            continue
        if status not in TARGET_STATUSES:
            continue
        eta = _time(v.get('planned_arrival'))
        if eta is None:
            _gap(gaps, 'no_eta', no, '입항 예정 시각 없음 · 배정 대상에서 제외')
        elif eta > limit:
            continue
        tonnes = tonnes_by_voyage[no]
        if tonnes <= 0:
            _gap(gaps, 'no_tonnes', no, '당진 화물량 없음 · 배정 대상에서 제외')
        if eta is None or tonnes <= 0:
            continue
        if yard:
            allowed = tuple(sorted(b.id for b in berths.values() if yard in b.yards))
        else:
            allowed = tuple(sorted(berths))
            _gap(gaps, 'no_yard', no, '저탄장 미배정 · 모든 부두 허용')
        laytime, demurrage = _number(v.get('laytime_hours')), _number(v.get('demurrage_usd_per_day'))
        if laytime is None or demurrage is None:
            _gap(gaps, 'no_demurrage', no, '체선료 값 없음 · 체선료 계산에서 제외')
        voyages.append(Voyage(no, v.get('voyage_number'), name, yard, supply.YARD_GROUP.get(yard or ''), tonnes, eta,
                              laytime, demurrage, allowed, v.get('berth_id') or None,
                              _time(v.get('planned_berth')), _time(v.get('planned_unload_end'))))
    voyages.sort(key=lambda r: (r.eta, r.voyage_no))
    _gap(gaps, 'no_vessel_size', None, '선형 제한 미적용(선박 제원 없음)')
    if stock is None:
        _gap(gaps, 'stock_unknown', None, (stock_gap or '재고 모름') + ' · 재고 제약·벌점 끔')
    return BerthInputs(as_of, t0, midnight, horizon_days, berths, outages, voyages, fixed, stock,
                       danger_days, normal_days, gaps)


def read_stock(as_of: datetime, horizon_days: int,
               exclude_voyages: set[str]) -> tuple[StockSeries | None, str | None, dict]:
    from midterm.web.supply_api import build_dashboard

    def adjust(data, plan):
        data = {**data, 'registry_planned': [r for r in data.get('registry_planned') or []
                                             if r.get('voyage_no') not in exclude_voyages]}
        return data, plan

    horizon = 30 if horizon_days <= 23 else 60
    result = build_dashboard(horizon, as_of, None, adjust)
    forecast = result.get('forecast') or []
    need = horizon_days + 7
    if len(forecast) < need:
        return None, '수급 전망 기간 부족', result
    if any(g.get('stale') for g in result.get('groups') or []):
        return None, '기준재고 기준시각 경과', result
    base, denom = {}, {}
    for g in supply.GROUPS:
        stocks = [forecast[d]['groups'][g].get('stock') for d in range(horizon_days)]
        burns = [forecast[d]['groups'][g].get('burn') for d in range(need)]
        if any(x is None for x in stocks) or any(x is None for x in burns):
            return None, '기준재고 또는 계획 사용량 없음', result
        base[g] = [float(x) for x in stocks]
        denom[g] = [sum(burns[d + 1:d + 8]) / 7 for d in range(horizon_days)]
    return StockSeries(base, denom), None, result


def load_inputs(db_path: Path, as_of: datetime, horizon_days: int) -> BerthInputs:
    from midterm.voyage_registry import snapshot
    registry = snapshot(db_path)
    berths, outages = load_berths()
    first = build_inputs(registry, berths, outages, None, as_of, horizon_days)
    stock, reason, result = read_stock(as_of, horizon_days, {v.voyage_no for v in first.voyages})
    config = {**supply.DEFAULTS, **(result.get('config') or {})}
    return build_inputs(registry, berths, outages, stock, as_of, horizon_days,
                        float(config['danger_days']), float(config['normal_days']), reason)
