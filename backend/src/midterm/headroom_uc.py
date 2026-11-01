"""P3: rated upward and clipped downward headroom, validated cost start, no OFF cap."""
import numpy as np
from scipy.optimize import Bounds, LinearConstraint
from scipy.sparse import coo_matrix, hstack

from midterm import uc as core
from midterm.highs_backend import PRIMAL_TOLERANCE, Backend, finite, violation

RESERVE_PRICE = core.RESERVE_SHORTFALL_WON_PER_MW
EXTRA_KEYS = ('up_need', 'down_need', 'reserve_mask', 'pmax_rated', 'reserve_price', 'validation_log_dir')


def extension(args, count, up_need, down_need, mask, rated):
    """Same columns/rows as the validated clipped-headroom model; no new hard rule."""
    h, n = np.shape(args[1])
    size, minimum, outage = h*n, np.asarray(args[1], float), np.asarray(args[6], bool)
    cells = [(t, j) for t in range(h) for j in np.flatnonzero(mask) if not outage[t, j]]
    m, extra = len(cells), 2*len(cells)+2*h
    low, high, integer = np.zeros(extra), np.full(extra, np.inf), np.zeros(extra)
    high[m:2*m], integer[m:2*m] = 1., 1
    rows, lower, upper = [], [], []
    for k, (t, j) in enumerate(cells):
        d, selector = count+k, count+m+k
        high[k] = max(0., rated[j]-minimum[t, j])
        rows.extend([[(d, 1.), (t*n+j, -1.), (size+t*n+j, minimum[t, j]), (selector, minimum[t, j])],
                     [(d, 1.), (selector, -high[k])], [(selector, 1.), (size+t*n+j, -1.)]])
        lower.extend([-np.inf]*3)
        upper.extend([minimum[t, j], 0., 0.])
    for t in range(h):
        units = np.flatnonzero(mask)
        rows.append([(size+t*n+j, rated[j]) for j in units]+[(t*n+j, -1.) for j in units]
                    +[(count+2*m+t, 1.)])
        lower.append(float(up_need[t]))
        upper.append(np.inf)
        rows.append([(count+k, 1.) for k, (s, _j) in enumerate(cells) if s == t]+[(count+2*m+h+t, 1.)])
        lower.append(float(down_need[t]))
        upper.append(np.inf)
    rr, cc, vv = [], [], []
    for r, terms in enumerate(rows):
        for col, value in terms:
            rr.append(r)
            cc.append(col)
            vv.append(value)
    added = LinearConstraint(coo_matrix((vv, (rr, cc)), shape=(len(rows), count+extra)).tocsc(), lower, upper)
    return low, high, integer, added, cells


def floor_cuts(problem, minimum, cells, extra_count):
    """Valid cuts derived from the original minimum-output rows, including startup relief."""
    h, n = np.shape(minimum)
    size = h*n
    source, found = problem['constraints'][0], {}
    matrix = source.A.tocsr()
    for r in np.flatnonzero(np.isfinite(source.lb)):
        row = matrix.getrow(r)
        powers = [int(c) for c, v in zip(row.indices, row.data) if c < size and v != 0]
        if len(powers) != 1:
            continue
        p = powers[0]
        if row[0, p] != 1 or row[0, size+p] != -minimum.ravel()[p]:
            continue
        if any(v != 0 and c not in (p, size+p) and not 2*size <= c < 4*size
               for c, v in zip(row.indices, row.data)):
            continue
        if source.lb[r] > 0 or any(v < 0 for c, v in zip(row.indices, row.data) if 2*size <= c < 4*size):
            continue
        found[p] = int(r)
    count, rr, cc, vv, lower = len(problem['lower']), [], [], [], []
    for k, (t, j) in enumerate(cells):
        p = t*n+j
        if p not in found:
            raise ValueError(f'No original minimum-output row for {t}/{j}')
        r = found[p]
        row = matrix.getrow(r)
        for col, value in zip(row.indices, row.data):
            rr.append(k)
            cc.append(int(col))
            vv.append(float(value))
        rr.append(k)
        cc.append(count+k)
        vv.append(-1.)
        lower.append(source.lb[r])
    return LinearConstraint(coo_matrix((vv, (rr, cc)), shape=(len(cells), count+extra_count)).tocsc(), lower, np.inf)


def exact_costs(answer, args, kwargs):
    """Actual adopted dispatch cost, never time-prorated overlapping-window cost."""
    if not answer.get('has_plan'):
        return
    power, on = np.asarray(answer['output_mw']), np.asarray(answer['online'], bool)
    curve = kwargs.get('fuel_curve')
    if curve is None:
        no_load = 0. if kwargs.get('no_load_won') is None else np.asarray(kwargs['no_load_won'])
        fuel = float((power*np.asarray(args[4])*1000 + on*no_load).sum())
    else:
        a, b, c = np.moveaxis(np.asarray(curve), -1, 0)
        fuel = float(((a*power**2+b*power+c)*on).sum())
    starts = float((np.asarray(answer['starts'])*np.asarray(kwargs.get('startup_cost', 0.))).sum())
    stops = float(np.asarray(answer['stops']).sum()*kwargs.get('shutdown_cost', 0.))
    answer.update(cost_won=fuel+starts+stops, fuel_cost_won=fuel, fuel_cost_exact_curve_won=fuel,
                  startup_cost_total_won=starts, shutdown_cost_total_won=stops,
                  cost_basis=('채택시간 원시 발전량의 ' + ('2차 연료비' if curve is not None else '선형 연료비+no-load')
                              + '+기동/정지비 · 유도/예비력 벌점 제외'))
    answer.pop('fuel_cost_approximation_error_won', None)
    if 'rolling' in answer:
        answer['rolling']['cost_basis'] = answer['cost_basis']


def solve_headroom_uc(*args, up_need, down_need, reserve_mask, pmax_rated,
                      reserve_price=RESERVE_PRICE, validation_log_dir=None, **kwargs):
    h, n = np.shape(args[1])
    size = h*n
    up, down, rated = (np.asarray(v, float) for v in (up_need, down_need, pmax_rated))
    mask = np.asarray(reserve_mask)
    if (up.shape != (h,) or down.shape != (h,) or rated.shape != (n,) or mask.shape != (n,)
            or not np.isin(mask, [0, 1]).all() or not mask.any()
            or any(not np.isfinite(v).all() or (v < 0).any() for v in (up, down, rated))
            or not np.isfinite(reserve_price) or reserve_price <= 0):
        raise ValueError('Invalid P3 headroom requirement/capacity/price')
    mask = mask.astype(bool)
    if (rated < np.max(np.asarray(args[2]), axis=0)-1e-8).any():
        raise ValueError('Rated capacity must cover every hourly maximum')
    if kwargs.get('single_stage'):
        raise ValueError('Validated cost starts require the feasibility front stage')
    scale = kwargs.get('objective_scale', 1.)
    if not np.isfinite(scale) or scale <= 0:
        raise ValueError('Objective scale must be finite and positive')
    if kwargs.get('inertia_won', 0.) != 0 or kwargs.get('reserve_ratio') is not None or kwargs.get('reserve_mw') is not None:
        raise ValueError('P3 replaces the old reserve requirement and disables inertia')
    problem = core.solve_coal_uc(*args, **{**kwargs, '_build_only': True})
    count = len(problem['lower'])
    lo, hi, ints, added, cells = extension(args, count, up, down, mask, rated)
    m = len(cells)
    cuts = floor_cuts(problem, np.asarray(args[1]), cells, len(lo))

    def extend(cons):
        return [LinearConstraint(hstack([c.A, coo_matrix((c.A.shape[0], len(lo)))]).tocsc(), c.lb, c.ub)
                for c in cons]+[added, cuts]

    if kwargs.get('_build_only'):
        return {**problem, 'constraints': extend(problem['constraints']),
                'lower': np.r_[problem['lower'], lo], 'upper': np.r_[problem['upper'], hi],
                'integrality': np.r_[np.zeros(size), np.ones(3*size), np.zeros(count-4*size), ints]}

    def complete_seed(x, cons):
        power, on = x[:size].reshape(h, n), x[size:2*size].reshape(h, n)
        f0, f1 = problem['fuel_start'], problem['fuel_end']
        x[f0:f1] = 0.
        for con in cons:
            fuel = con.A[:, f0:f1].tocsr()
            for r in np.flatnonzero(np.asarray(fuel.getnnz(axis=1)).ravel()):
                row = fuel.getrow(r)
                if len(row.indices) != 1 or row.data[0] <= 0:
                    raise ValueError('Unexpected fuel epigraph row')
                col, coefficient = f0+row.indices[0], row.data[0]
                bound = float(((con.lb[r]-con.A.getrow(r) @ x)/coefficient+x[col]).item())
                x[col] = max(x[col], bound, 0.)
        base = problem['reserve_end']
        if problem['reserve_start'] != base:
            raise ValueError('P3 must not double-count the legacy reserve constraint')
        for k, group in enumerate(kwargs.get('group_online_targets', ())):
            delta = on[:, group['indices']].sum(axis=1)-np.broadcast_to(group['target'], (h,))
            x[base+2*h*k:base+2*h*k+h] = np.maximum(delta, 0.)
            x[base+2*h*k+h:base+2*h*(k+1)] = np.maximum(-delta, 0.)
        head = np.zeros(h)
        for k, (t, j) in enumerate(cells):
            # Integral OFF wins over ~1e-13 MW solver noise; keep the original tolerances.
            value = max(power[t, j]-np.asarray(args[1])[t, j]*on[t, j], 0.) if on[t, j] > .5 else 0.
            x[count+k], x[count+m+k] = value, float(value > 0.)
            head[t] += value
        x[count+2*m:count+2*m+h] = np.maximum(up-((rated*on-power)[:, mask]).sum(axis=1), 0.)
        x[count+2*m+h:count+2*m+2*h] = np.maximum(down-head, 0.)
        return x

    backend = Backend(size, problem['fuel_start'], complete_seed, validation_log_dir)
    stages, full_return = [], None

    def call(c, *, integrality, bounds, constraints, options, _cost_stage=False):
        nonlocal full_return
        objective = np.r_[c, np.zeros(len(lo))]
        if _cost_stage:
            objective[count+2*m:count+2*m+2*h] = reserve_price
            objective *= scale
        bounds = Bounds(np.r_[bounds.lb, lo], np.r_[bounds.ub, hi])
        cons, integer = extend(constraints), np.r_[integrality, ints]
        options = {**options, 'threads': 1}
        result = backend(objective, integrality=integer, bounds=bounds, constraints=cons, options=options,
                         cost_stage=_cost_stage, objective_scale=scale if _cost_stage else 1.)
        valid = result.x is not None
        if valid and violation(result.x, bounds, cons, integer) > PRIMAL_TOLERANCE:
            raise ValueError('Returned P3 incumbent violates the actual extended model')
        stages.append({'kind': 'cost' if _cost_stage else 'front', 'valid_incumbent': valid,
            'status': int(result.status), 'success': bool(result.success), 'gap': finite(result.get('mip_gap')),
            'objective': finite(result.get('fun')), 'dual_bound': finite(result.get('mip_dual_bound')),
            'nodes': result.get('mip_node_count'), 'request_seconds': options['time_limit'],
            'validation': result.get('validation'), 'extra_off_rows': 0, 'reserve_price': reserve_price,
            'objective_scale': scale if _cost_stage else 1.})
        if valid:
            full_return = result.x.copy()
            result.x = result.x[:count]
        return result

    answer = core.solve_coal_uc(*args, **kwargs, _milp=call)
    costs = [s for s in stages if s['kind'] == 'cost']
    answer.update(solver_stages=stages, cost_solve_attempted=bool(costs),
        cost_solve_returned=any(s['valid_incumbent'] for s in costs),
        cost_optimal=any(s['valid_incumbent'] and s['success'] for s in costs),
        mip_gap=next((s['gap'] for s in reversed(costs) if s['valid_incumbent']), None))
    if answer.get('status') == 'optimal' and not answer['cost_optimal']:
        answer['status'] = 'time_limit_feasible'
    if answer.get('has_plan'):
        power, on = np.asarray(answer['output_mw']), np.asarray(answer['online'], bool)
        up_head = ((rated*on-power)[:, mask]).sum(axis=1)
        actual_up = ((np.asarray(args[2])*on-power)[:, mask]).sum(axis=1)
        down_head = np.maximum(power-np.asarray(args[1])*on, 0.)[:, mask].sum(axis=1)
        up_short, down_short = np.maximum(up-up_head, 0.), np.maximum(down-down_head, 0.)
        answer.update(up_need_mw=up.tolist(), down_need_mw=down.tolist(),
            up_headroom_mw=up_head.tolist(), down_headroom_mw=down_head.tolist(),
            up_short_mw=up_short.tolist(), down_short_mw=down_short.tolist(),
            up_hourly_pmax_short_mw=np.maximum(up-actual_up, 0.).tolist(),
            reserve_shortfall_mw=up_short.tolist(), reserve_met=bool(max(up_short.max(), down_short.max()) <= .01),
            solver_up_short_mw=full_return[count+2*m:count+2*m+h].tolist(),
            solver_down_short_mw=full_return[count+2*m+h:count+2*m+2*h].tolist())
        from midterm.rolling import _joined_physical_check
        answer['joined_physical_check'] = _joined_physical_check(args, kwargs, answer)
        if any(answer['joined_physical_check'].values()):
            answer.update(has_plan=False, status='joined_constraints_violated',
                          message='P3 dispatch failed the original physical rows after binary projection')
        exact_costs(answer, args, kwargs)
    return answer
