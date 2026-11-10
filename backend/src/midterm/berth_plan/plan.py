"""접안 추천 조립: 세 안(A 체선 최소·B 균형·C 재고 우선)을 풀어 현재 계획과 비교한 JSON을 만든다."""
from __future__ import annotations

from datetime import datetime

from midterm.berth_plan.explain import current_plan, fixed_assignments, reasons
from midterm.berth_plan.inputs import BerthInputs
from midterm.berth_plan.solve import HOUR, Assignment, OptionResult, evaluate, solve_option

NO_TARGETS_MESSAGE = '기간 안 입항 예정 선박 없음'
DANGER_WARNING = '위험 기준을 지킬 수 없음'
ALL_SAME_LABEL = '세 안 같음 · 체선·재고 차이 없음'


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _kpis(scores: dict) -> dict:
    return {key: scores[key] for key in ('demurrage_hours', 'demurrage_usd', 'min_days', 'caution_days', 'danger_days')}


def _assignment_rows(inputs: BerthInputs, assignments: list[Assignment], scores: dict | None,
                     current: dict[str, Assignment] | None) -> list[dict]:
    voyages = {v.voyage_no: v for v in inputs.voyages}
    fixed = {f.voyage_no: f for f in inputs.fixed}
    why = reasons(inputs, assignments)
    rows = []
    for a in assignments:
        v, f = voyages.get(a.voyage_no), fixed.get(a.voyage_no)
        src = f if a.fixed else v
        per = ((scores or {}).get('per_voyage') or {}).get(a.voyage_no) or {}
        changed = False
        if current is not None and not a.fixed:
            base = current.get(a.voyage_no)
            changed = (base is None or base.berth_id != a.berth_id or base.berth_at is None or a.berth_at is None
                       or abs(base.berth_at - a.berth_at) >= HOUR)
        rows.append({
            'voyage_no': a.voyage_no,
            'voyage_number': getattr(src, 'voyage_number', None),
            'vessel_name': getattr(src, 'vessel_name', None),
            'yard': getattr(src, 'yard', None),
            'berth_id': a.berth_id,
            'eta': _iso(v.eta) if v is not None and not a.fixed else None,
            'berth_at': _iso(a.berth_at),
            'unload_end': _iso(a.unload_end),
            'tonnes': v.tonnes if v is not None and not a.fixed else None,
            'demurrage_hours': per.get('demurrage_hours'),
            'demurrage_usd': per.get('demurrage_usd'),
            'reasons': why.get(a.voyage_no, []),
            'changed': changed,
            'fixed': a.fixed,
        })
    return rows


def _key(result: OptionResult):
    if result.status == 'infeasible':
        return None
    return frozenset((a.voyage_no, a.berth_id, a.berth_at) for a in result.assignments)


def recommend_berth_plan(inputs: BerthInputs, penalty_usd: float = 20000., locks: list[dict] = (),
                         time_limit_s: float = 30.) -> dict:
    out = {
        'as_of': _iso(inputs.as_of),
        'horizon_days': inputs.horizon_days,
        'source': {'berths': 'dummy', 'voyages': 'registry', 'stock': 'supply_ledger'},
        'assumptions': ['부두 능력: 시연용 가정값', 'ETA 기산 가정',
                        f'벌점 단가 {penalty_usd:,.0f} USD/그룹·일(가정값)'],
        'gaps': list(inputs.gaps),
        'message': None,
        'current': None,
        'options': [],
    }
    if not inputs.voyages:
        out['message'] = NO_TARGETS_MESSAGE
        return out
    current = current_plan(inputs)
    current_scores = evaluate(inputs, current)
    current_by_no = {a.voyage_no: a for a in current}
    out['current'] = {'label': '현재 계획', 'kpis': _kpis(current_scores),
                      'assignments': _assignment_rows(inputs, current, current_scores, None)}

    definitions = [('A', 'A. 체선 최소', 0.), ('B', 'B. 균형', penalty_usd), ('C', 'C. 재고 우선', 10 * penalty_usd)]
    if inputs.stock is None:
        definitions = definitions[:1]
    solved = [(oid, label, solve_option(inputs, weight, list(locks), time_limit_s))
              for oid, label, weight in definitions]

    groups: list[list[tuple[str, str, OptionResult]]] = []
    for item in solved:
        key = _key(item[2])
        for group in groups:
            if key is not None and _key(group[0][2]) == key:
                group.append(item)
                break
        else:
            groups.append([item])
    groups.sort(key=lambda g: (not any(m[0] == 'B' for m in g), g[0][0]))

    fixed_rows = fixed_assignments(inputs)
    for rank, group in enumerate(groups, 1):
        members = [m[0] for m in group]
        head_id, head_label, head = group[0]
        if any(m == 'B' for m in members):
            head_id, head_label, head = next(m for m in group if m[0] == 'B')
        if len(group) == 1:
            label = head_label
        elif len(group) == len(definitions) and len(group) == 3:
            label = ALL_SAME_LABEL
        else:
            label = '·'.join(members) + ' 같음'
        warnings = [DANGER_WARNING] if any(m[2].danger_violated for m in group) else []
        if head.status == 'infeasible':
            assignments, kpis = fixed_rows, None
            rows = _assignment_rows(inputs, assignments, None, None)
        else:
            assignments = fixed_rows + head.assignments
            scores = evaluate(inputs, assignments)
            kpis = _kpis(scores)
            kpis['demurrage_usd_delta'] = scores['demurrage_usd'] - current_scores['demurrage_usd']
            rows = _assignment_rows(inputs, assignments, scores, current_by_no)
        gaps = [m[2].gap_pct for m in group if m[2].gap_pct is not None]
        out['options'].append({
            'id': head_id, 'rank': rank, 'label': label, 'merged': members,
            'status': 'time_limit' if any(m[2].status == 'time_limit' for m in group) else head.status,
            'gap_pct': max(gaps) if gaps else None,
            'message': head.message, 'kpis': kpis, 'warnings': warnings, 'assignments': rows,
        })
    return out
