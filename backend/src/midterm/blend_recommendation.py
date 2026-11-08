"""Find a feasible blend from available lots with consistently based AR assays."""
import math

from scipy.optimize import linprog


def _number(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} 값을 확인하세요')
    return float(value)


def recommend_blend(lots, criteria):
    tonnes = _number(criteria.get('tonnes'), '요청량', .001, 10000000)
    target = _number(criteria.get('target_gcv_arb'), '목표 발열량', 0, 10000)
    tolerance = _number(criteria.get('gcv_tolerance', 0), '발열량 허용오차', 0, 10000)
    limits = {}
    for key, label in [('tm_ar', '총수분'), ('sulfur_ar', '유황분')]:
        value = criteria.get('max_' + key)
        if value is not None:
            limits[key] = _number(value, label, 0, 100)
    eligible, excluded, seen = [], [], set()
    for item in lots:
        identifier = item.get('id')
        if not isinstance(identifier, str) or not identifier.strip() or identifier in seen:
            raise ValueError('원탄 식별자가 없거나 중복됩니다')
        seen.add(identifier)
        available = _number(item.get('available_t'), '가용 재고', 0, 10000000)
        required = ['gcv_arb', *limits]
        missing = [field for field in required if item.get(field) is None]
        if missing:
            excluded.append({'id': identifier, 'missing': missing})
            continue
        clean = {**item, 'available_t': available}
        for field in required:
            clean[field] = _number(item[field], field, 0, 10000 if field == 'gcv_arb' else 100)
        if available > 0:
            eligible.append(clean)
    if not eligible:
        return {'status': 'infeasible', 'lots': [], 'excluded': excluded, 'reason': '조건에 사용할 수 있는 재고가 없습니다'}
    # x_i are tonnes; all weighted bounds use a common AR basis.
    cv = [row['gcv_arb'] for row in eligible]
    matrix = [cv, [-x for x in cv]]
    bounds = [(target + tolerance) * tonnes, -(target - tolerance) * tonnes]
    for name, value in limits.items():
        matrix.append([row[name] for row in eligible])
        bounds.append(value * tonnes)
    # Minimize absolute distance from the target within the user's hard tolerance.
    result = linprog([0.] * len(eligible) + [1., 1.],
                     A_ub=[row + [0., 0.] for row in matrix], b_ub=bounds,
                     A_eq=[[1.] * len(eligible) + [0., 0.], cv + [-1., 1.]],
                     b_eq=[tonnes, target * tonnes],
                     bounds=[(0, row['available_t']) for row in eligible] + [(0, None), (0, None)], method='highs')
    if not result.success:
        if result.status != 2:
            raise RuntimeError('혼탄 계산에 실패했습니다')
        return {'status': 'infeasible', 'lots': [], 'excluded': excluded, 'reason': '재고량과 입력 조건을 동시에 만족하는 조합이 없습니다'}
    used = [(row, float(q)) for row, q in zip(eligible, result.x[:len(eligible)]) if q > 1e-7]
    quality = {'gcv_arb': sum(row['gcv_arb'] * q for row, q in used) / tonnes}
    for name in ('tm_ar', 'sulfur_ar'):
        quality[name] = (sum(row[name] * q for row, q in used) / tonnes
                         if all(row.get(name) is not None for row, _ in used) else None)
    return {'status': 'ok', 'lots': [{'id': row['id'], 'tonnes': q, 'available_t': row['available_t']} for row, q in used],
            'quality': quality, 'excluded': excluded}
