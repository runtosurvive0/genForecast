"""Fork of national-solar-forecast be2a0a0, with P3 startup carry and joined validation.

5일 창을 한 번에 풀지 않고 48시간씩 이어 푼다 -- `solve_coal_uc` 를 감싸는 얇은 층.

한 번에 122시간을 풀면 한 시간이라도 정확해가 없을 때 창 전체가 무너진다. 2026-09-30 수동 실행은
10-03 개천절 한낮 목표(8.8 GW)가 켜 둬야 하는 23기의 최저출력 하한(약 9.0 GW) 아래였고, HiGHS 가
그것을 증명하지 못한 채 앞단 30분을 쓴 뒤 10-01~02 저녁에 41.7 GW 모자란 근사해를 냈다 -- 저장되지
않았다. 같은 기능을 켠 48시간 창은 9월 소급에서 약 40초에 풀렸다. 이어 풀면 풀 수 없는 시간은 그 창에만
남고, 창마다 작아서 빠르다.

창 k 는 [k·step, k·step + window) 를 풀고 앞 step 시간만 쓴다(마지막 창은 끝까지). 다음 창의 초기상태는
쓴 부분의 마지막 시각에서 넘긴다: 운전 여부·출력·같은 상태로 이어진 시간. 뒤 window-step 시간은 앞을 보고
정하라고 두는 것이다 -- 저녁에 다시 켤 호기를 한낮에 세우지 않게.
"""

import numpy as np
from midterm.uc import startup_ramp, ramp_floor_from, solve_coal_uc as build_original

#: 시간 축이 첫 축인 인자. 자리 인자는 target, minimum, maximum, ramp, costs, must, outage 순이다.
_HOURLY_POSITIONAL = 7
_HOURLY_KEYWORDS = ("fuel_curve", "ramp_down", "reserve_mw", "commitment_reference", "fixed_commitment",
                    "no_load_won", "up_need", "down_need")  # [포크] no_load_won 추가
_GROUP_KEYWORDS = ("group_caps", "group_online_minimums", "group_online_maximums", "group_online_targets")
_STATUS_ORDER = ("optimal", "time_limit_feasible", "approximate")


def _slice(value, a, b, hours):
    arr = np.asarray(value)
    if arr.ndim >= 1 and arr.shape[0] == hours:
        return arr[a:b]
    return value


def _slice_group(group, a, b, hours):
    out = {}
    for key, value in group.items():
        if key == "indices":
            out[key] = value
        elif isinstance(value, (list, tuple, np.ndarray)) and len(value) == hours:
            out[key] = list(np.asarray(value)[a:b])
        else:
            out[key] = value
    return out


def _windows(hours, window, step):
    """[(시작, 끝, 쓸 시간)]. 마지막 창은 끝까지 푼다."""
    out, a = [], 0
    while a + window < hours:
        out.append((a, a + window, step))
        a += step
    out.append((a, hours, hours - a))
    return out


def _elapsed(history, initial_online, initial_elapsed, online_now):
    """같은 상태로 이어진 시간. 이어 붙인 기간 내내 같은 상태이고 첫 초기상태도 같으면 그 경과시간을 더한다."""
    k = 0
    for state in reversed(history):
        if state != online_now:
            return float(k)
        k += 1
    return float(k + (initial_elapsed if initial_online == online_now else 0.0))


def _startup_relief(minimum, maximum, ramp, history, origin, output, a, b):
    """Move only already-adopted startup terms to the next window's floor RHS."""
    low, high, rr = (np.asarray(v, float)[a:b] for v in (minimum, maximum, ramp))
    floors, _ = startup_ramp(low, high, rr)
    relief = np.zeros(low.shape)
    for j, past in enumerate(history):
        prior, starts = bool(origin[0][j]), []
        for s, on in enumerate(past):
            if on and not prior:
                starts.append(s)
            prior = on
        for t in range(b-a):
            if origin[0][j] and output[j] < low[t, j]:
                relief[t, j] = low[t, j]-ramp_floor_from(output[j], low[t, j], rr[t, j], a+t)
            for s in starts:
                age = a+t-s
                if age < len(floors):
                    relief[t, j] += max(0., low[t, j]-floors[age][t, j])
    return relief


def _joined_physical_check(args, kwargs, answer):
    """Original full-horizon physical rows, preserving the original partial initial data."""
    problem = build_original(*args, **kwargs, _build_only=True)
    h, n = np.shape(args[1])
    size = h*n
    x = np.zeros(len(problem['lower']))
    for k, key in enumerate(('output_mw', 'online', 'starts', 'stops')):
        x[k*size:(k+1)*size] = np.asarray(answer[key]).ravel()
    x[4*size:4*size+h], x[4*size+h:4*size+2*h] = answer['shortage_mw'], answer['excess_mw']
    con = problem['constraints'][0]
    lhs = con.A @ x
    physical = np.asarray(con.A[:, 4*size+2*h:].getnnz(axis=1)).ravel() == 0
    rows = int(np.count_nonzero(physical & ((lhs < con.lb-1e-5) | (lhs > con.ub+1e-5))))
    bounds = int(np.count_nonzero((x[:4*size+2*h] < problem['lower'][:4*size+2*h]-1e-5)
                                | (x[:4*size+2*h] > problem['upper'][:4*size+2*h]+1e-5)))
    integer = int(np.count_nonzero(abs(x[size:4*size]-np.rint(x[size:4*size])) > 1e-5))
    return dict(violated_rows=rows, violated_bounds=bounds, integer_violations=integer)


def solve_rolling(solve, target, minimum, maximum, ramp, costs, must, outage, uptime, downtime, *,
                  window=48, step=24, window_time_limit=None, window_cost_time_limit=None, **kwargs):
    """`solve` 와 같은 인자를 받고 같은 모양의 답을 낸다. 창이 하나로 끝나면 그대로 넘긴다."""
    hours = len(target)
    if not 0 < step <= window:
        raise ValueError('Rolling step must be positive and no larger than the window')
    if hours <= window:
        return solve(target, minimum, maximum, ramp, costs, must, outage, uptime, downtime, **kwargs)
    positional = [target, minimum, maximum, ramp, costs, must, outage]
    n = np.asarray(minimum).shape[1]
    if window_time_limit is not None:
        kwargs["time_limit"] = window_time_limit
    if window_cost_time_limit is not None:
        kwargs["cost_time_limit"] = window_cost_time_limit
    p3 = 'up_need' in kwargs
    if p3:
        from midterm.headroom_uc import EXTRA_KEYS, exact_costs
        original_kw = {key: value for key, value in kwargs.items() if key not in EXTRA_KEYS}
    pieces, history, carried, origin = [], [[] for _ in range(n)], {}, None
    for k, (a, b, keep) in enumerate(_windows(hours, window, step)):
        args = [_slice(v, a, b, hours) for v in positional]
        kw = {key: (_slice(value, a, b, hours) if key in _HOURLY_KEYWORDS else value) for key, value in kwargs.items()}
        for key in _GROUP_KEYWORDS:
            if key in kw:
                kw[key] = [_slice_group(g, a, b, hours) for g in kw[key]]
        if kw.get("event_penalty") is not None:
            kw["event_penalty"] = {key: _slice(v, a, b, hours) for key, v in kw["event_penalty"].items()}
        if "startup_cost" in kw:
            kw["startup_cost"] = _slice(kw["startup_cost"], a, b, hours)
        if k > 0:
            kw.pop("initial_target", None)
            kw.update(carried)
            if p3:
                kw["_initial_floor_relief"] = _startup_relief(minimum, maximum, ramp, history, origin,
                    pieces[0][3]["initial_output_mw"], a, b)
        if kw.get('validation_log_dir') is not None:
            from pathlib import Path
            kw['validation_log_dir'] = Path(kw['validation_log_dir']) / f'window-{k}'
        result = solve(*args, uptime, downtime, **kw)
        if not result.get("has_plan"):
            return {**result, "rolling": {"window": window, "step": step, "failed_window": k,
                                          "window_start_hour": a}}
        if origin is None:  # 첫 창이 쓴(추정했을 수도 있는) 초기상태 -- 경과시간을 이어 세는 기준
            origin = (list(result["initial_online"]), list(result["initial_elapsed_hours"]))
        pieces.append((a, keep, b - a, result))
        online = np.asarray(result["online"], bool)
        output = np.asarray(result["output_mw"], float)
        last = keep - 1
        for j in range(n):
            history[j].extend(bool(x) for x in online[:keep, j])
        carried = {
            "initial_online": [bool(online[last, j]) for j in range(n)],
            "initial_output": [float(output[last, j]) if online[last, j] else 0.0 for j in range(n)],
            "initial_elapsed_hours": [_elapsed(history[j], bool(origin[0][j]), float(origin[1][j]),
                                               bool(online[last, j])) for j in range(n)],
        }
    answer = _stitch(pieces, hours, window, step)
    if p3:
        answer['joined_physical_check'] = _joined_physical_check((*positional, uptime, downtime), original_kw, answer)
        if any(answer['joined_physical_check'].values()):
            answer.update(has_plan=False, status='joined_constraints_violated',
                          message='Joined rolling plan failed the original full-horizon physical constraints')
        exact_costs(answer, (*positional, uptime, downtime), original_kw)
    return answer


def _stitch(pieces, hours, window, step):
    first, last = pieces[0][3], pieces[-1][3]
    out = dict(first)
    for key, value in first.items():
        unit_keys = ('initial_output_mw', 'initial_online', 'initial_elapsed_hours',
                     'minimum_downtime_hours', 'terminal_minimum_remaining_hours', 'online_target_deviation')
        if key not in unit_keys and isinstance(value, list) and len(value) == pieces[0][2]:
            joined = []
            for _a, keep, _length, result in pieces:
                joined.extend(result[key][:keep])
            out[key] = joined
    for key in ("terminal_minimum_remaining_hours",):
        if key in last:
            out[key] = last[key]
    reasons = []
    for a, keep, _length, result in pieces:
        for reason in result.get("mismatch_reasons") or []:
            if reason.get("hour_index", 0) < keep:
                reasons.append({**reason, "hour_index": reason.get("hour_index", 0) + a})
    out["mismatch_reasons"] = reasons
    statuses = [r["status"] for *_, r in pieces]
    out["status"] = max(statuses, key=lambda s: _STATUS_ORDER.index(s) if s in _STATUS_ORDER else len(_STATUS_ORDER))
    for key in ("target_met", "cost_optimal", "slack_optimal", "peak_optimal", "has_plan", "cost_solve_attempted",
                "cost_solve_returned"):
        if key in first:
            out[key] = all(bool(r.get(key)) for *_, r in pieces)
    out["target_met"] = bool(max(max(out["shortage_mw"]), max(out["excess_mw"])) <= .01)
    if 'up_short_mw' in out:
        out['reserve_met'] = max(max(out['up_short_mw']), max(out['down_short_mw'])) <= .01
    elif 'reserve_shortfall_mw' in out:
        out['reserve_met'] = max(out['reserve_shortfall_mw']) <= .01
    out["exact_feasibility"] = ("found" if all(r.get("exact_feasibility") == "found" for *_, r in pieces)
                                else next(r.get("exact_feasibility") for *_, r in pieces
                                          if r.get("exact_feasibility") != "found"))
    for key in ("front_solve_seconds", "cost_solve_seconds"):
        if key in first:
            out[key] = sum(float(r.get(key) or 0.0) for *_, r in pieces)
    gaps = [r.get("mip_gap") for *_, r in pieces if r.get("mip_gap") is not None]
    out["mip_gap"] = max(gaps) if gaps else None
    # 비용은 창마다 앞을 본 시간까지 들어 있다 -- 쓴 시간의 몫만큼 나눠 더한다(근사).
    for key in ("cost_won", "fuel_cost_won", "fuel_cost_exact_curve_won", "startup_cost_total_won"):
        if key in first:
            out[key] = sum(float(r.get(key) or 0.0) * keep / length for _a, keep, length, r in pieces)
    if "solver_stages" in first:
        out["solver_stages"] = [{**stage, "window": k} for k, (*_, r) in enumerate(pieces)
                                for stage in r.get("solver_stages") or []]
    out["rolling"] = {"window": window, "step": step, "windows": len(pieces),
                      "window_status": statuses, "cost_basis": "창별 비용을 쓴 시간 비율로 나눈 근사"}
    return out
