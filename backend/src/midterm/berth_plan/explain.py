"""접안 추천 사후 설명: 현재 계획 구성과 체선 원인 판정.

원인은 결과 일정에서 사후에 판정한다(MILP 쌍대값을 쓰지 않는다)."""
from __future__ import annotations

import math
from datetime import datetime

from midterm.berth_plan.inputs import BerthInputs
from midterm.berth_plan.solve import HOUR, Assignment, occupancy, _demurrage_hours


def fixed_assignments(inputs: BerthInputs) -> list[Assignment]:
    """접안 중 항차: 지금부터 하역 완료 예정(모르면 None)까지 부두를 점유한다."""
    return [Assignment(f.voyage_no, f.berth, inputs.t0, f.until, True) for f in inputs.fixed]


def current_plan(inputs: BerthInputs) -> list[Assignment]:
    """원장의 부두·접안·하역완료 값을 그대로 쓴 일정. 값이 없으면 미배정(berth_id None)."""
    result = fixed_assignments(inputs)
    for v in inputs.voyages:
        if v.current_berth and v.current_berth_at:
            end = v.current_unload_end
            if end is None and v.current_berth in inputs.berths:
                end = occupancy(v, inputs.berths[v.current_berth], v.current_berth_at, inputs.outages)
            result.append(Assignment(v.voyage_no, v.current_berth, v.current_berth_at, end))
        else:
            result.append(Assignment(v.voyage_no, None, None, v.current_unload_end))
    return result


def _occupied(at: datetime, berth_id: str, others: list[Assignment]) -> bool:
    for a in others:
        if a.berth_id == berth_id and a.berth_at is not None and a.berth_at <= at \
                and (a.unload_end is None or at < a.unload_end):
            return True
    return False


def reasons(inputs: BerthInputs, assignments: list[Assignment],
            caution_weight_usd: float = 0.) -> dict[str, list[str]]:
    """체선이 생긴 항차마다 원인 코드. 하나도 해당하지 않으면 `wait`.

    - `berth_busy`: 기다린 모든 시간에 허용 부두가 모두 다른 배로 차 있었다.
    - `outage`: 고른 부두의 정비 때문에 시작을 미뤘다.
    - `stock_priority:<항차번호>`: ETA가 늦은 다른 그룹의 배가 같은 허용 부두에서 먼저 시작했고,
      그 안에 재고 벌점 항이 있었다(재고를 알고 `caution_weight_usd` > 0).
    - `order:<항차번호>`: ETA가 늦은 배가 먼저 시작했지만 재고 때문이라고 할 근거가 없다
      (재고 모름·가중치 0·같은 그룹 등. 예: 체선료 단가 차이).
    - `wait`: 체선은 있으나 위 원인을 특정할 수 없다(예: 다른 부두 정비 + 고른 부두 점유).
    현재 계획은 풀이 결과가 아니므로 `caution_weight_usd` 0으로 부른다."""
    voyages = {v.voyage_no: v for v in inputs.voyages}
    stock_term = inputs.stock is not None and caution_weight_usd > 0
    result: dict[str, list[str]] = {}
    for a in assignments:
        v = voyages.get(a.voyage_no)
        if v is None or a.fixed or a.berth_id is None or a.berth_at is None:
            continue
        hours = _demurrage_hours(v, a.berth_at)
        if not hours or hours <= 0:
            continue
        found: list[str] = []
        others = [o for o in assignments if o.voyage_no != a.voyage_no]
        lower = max(inputs.t0, inputs.t0 + math.ceil((v.eta - inputs.t0) / HOUR) * HOUR)
        waits = []
        t = lower
        while t < a.berth_at:
            waits.append(t)
            t += HOUR
        allowed = [b for b in v.allowed if b in inputs.berths]
        if waits and allowed and all(all(_occupied(t, b, others) for b in allowed) for t in waits):
            found.append('berth_busy')
        if any(o.berth == a.berth_id and o.start < a.berth_at and v.eta < o.end for o in inputs.outages):
            found.append('outage')
        ahead = sorted((o for o in others
                        if not o.fixed and o.berth_id in v.allowed and o.berth_at is not None
                        and o.berth_at < a.berth_at and voyages.get(o.voyage_no) is not None
                        and voyages[o.voyage_no].eta > v.eta),
                       key=lambda o: (o.berth_at, o.voyage_no))
        for o in ahead:
            other = voyages[o.voyage_no]
            name = other.voyage_number or other.voyage_no
            other_group = stock_term and v.group is not None and other.group is not None and other.group != v.group
            found.append(f'stock_priority:{name}' if other_group else f'order:{name}')
        result[a.voyage_no] = found or ['wait']
    return result
