"""페어발전기·대단위 발전단지 기동·정지 기준이 MILP 답에 지켜지는가 -- `solve_coal_uc(transition_rules=...)`.

national-solar-forecast `test_pair_rules` 와 같은 시험이다(2026-11-24 이식). 당진 합계 상한과 롤링 창 연결은 끝에 더했다.
"""
import numpy as np
import pytest

from midterm import pair_rules
from midterm.uc import solve_coal_uc


def solve(target, costs, *, initial_online, rules, minimum=100.0, maximum=200.0, elapsed=None):
    h, n = len(target), len(costs)
    initial_online = list(initial_online)
    output = [minimum if on else 0.0 for on in initial_online]
    return solve_coal_uc(
        np.asarray(target, float), np.full((h, n), minimum), np.full((h, n), maximum), np.full((h, n), 50.0),
        np.tile(np.asarray(costs, float), (h, 1)), np.zeros((h, n), bool), np.zeros((h, n), bool),
        [2] * n, [2] * n, initial_online=initial_online, initial_output=output,
        initial_elapsed_hours=elapsed or [30.0] * n, transition_rules=rules)


def starts(answer, j):
    return [t for t, row in enumerate(answer['starts']) if row[j]]


def stops(answer, j):
    return [t for t, row in enumerate(answer['stops']) if row[j]]


def pair_only(start_hours=(4, 4, 4), stop_hours=2.0):
    return {'pairs': [{'indices': (1, 2), 'start_hours': start_hours, 'stop_hours': stop_hours, 'label': 'p'}]}


def test_a_pair_that_would_start_together_is_staggered_by_the_start_interval():
    # 0 은 싸고 혼자 150 을 낸다. 5시부터 550 이 필요해 1·2 를 둘 다 켜야 한다 -- 비용만 보면 둘 다 5시에 켠다.
    target = [150.0] * 5 + [550.0] * 5
    free = solve(target, [10, 50, 50], initial_online=[True, False, False], rules=None)
    assert free['target_met'] and starts(free, 1) == starts(free, 2) == [5]
    ruled = solve(target, [10, 50, 50], initial_online=[True, False, False], rules=pair_only())
    assert ruled['target_met']
    (a,), (b,) = starts(ruled, 1), starts(ruled, 2)
    assert abs(a - b) >= 4 and max(a, b) <= 5


def test_the_later_unit_coming_back_cold_needs_the_longer_interval():
    # 둘 다 사흘 넘게 서 있었다(Cold 경계 72시간) -- DSS 4시간이 아니라 Cold 8시간을 띄운다.
    target = [150.0] * 9 + [550.0] * 3
    rules = {**pair_only(start_hours=(4, 4, 8)), 'warm_after_hours': 24.0, 'cold_after_hours': 72.0}
    ruled = solve(target, [10, 50, 50], initial_online=[True, False, False], rules=rules,
                  elapsed=[30.0, 80.0, 80.0])
    assert ruled['target_met']
    (a,), (b,) = starts(ruled, 1), starts(ruled, 2)
    assert abs(a - b) >= 8


def test_a_partner_started_just_before_the_window_still_counts():
    # 2 는 창 시작 1시간 전에 켜졌다(경과 1시간, 아는 상태). 1 은 가장 싸서 바로 켜고 싶지만 3시간 기다린다.
    target = [350.0] * 8
    kwargs = dict(initial_online=[True, False, True], elapsed=[30.0, 30.0, 1.0])
    free = solve(target, [50, 10, 50], rules=None, **kwargs)
    assert starts(free, 1)[0] < 3
    ruled = solve(target, [50, 10, 50], rules=pair_only(), **kwargs)
    assert ruled['target_met'] and starts(ruled, 1)[0] >= 3


def test_pair_stops_keep_their_interval():
    # 셋이 다 돌다가 4시부터 150 만 필요하다 -- 1·2 를 같은 시각에 세우지 않는다.
    target = [600.0] * 4 + [150.0] * 6
    free = solve(target, [10, 50, 50], initial_online=[True, True, True], rules=None)
    assert stops(free, 1) == stops(free, 2)
    ruled = solve(target, [10, 50, 50], initial_online=[True, True, True], rules=pair_only())
    (a,), (b,) = stops(ruled, 1), stops(ruled, 2)
    assert abs(a - b) >= 2


def test_a_group_stops_at_most_half_of_what_was_running():
    target = [800.0] * 3 + [200.0] * 7
    rules = {'group_stop_limits': [{'indices': [0, 1, 2, 3], 'label': 'g'}]}
    ruled = solve(target, [10, 20, 30, 40], initial_online=[True] * 4, rules=rules)
    assert ruled['target_met']
    online = np.asarray(ruled['online'])
    previous = np.vstack([[True] * 4, online[:-1]])
    stopped = np.asarray(ruled['stops']).sum(axis=1)
    assert (2 * stopped <= previous.sum(axis=1)).all()


def test_six_unit_group_starts_the_far_end_through_the_middle():
    # 0(가장자리 A)만 돈다. 가장 싼 4(반대쪽 C)를 켜려면 가운데 2·3 중 하나가 먼저 켜져 있어야 한다.
    rules = {'start_bridges': [{'unit': 4, 'bridge': [2, 3], 'also': [5]},
                               {'unit': 5, 'bridge': [2, 3], 'also': [4]}]}
    target = [150.0] * 3 + [450.0] * 7
    costs = [30, 30, 50, 50, 10, 10]
    free = solve(target, costs, initial_online=[True] + [False] * 5, rules=None)
    assert free['target_met'] and not any(np.asarray(free['online'])[:, 2:4].any(axis=1))
    ruled = solve(target, costs, initial_online=[True] + [False] * 5, rules=rules)
    assert ruled['target_met']
    online = np.asarray(ruled['online'])
    for j in (4, 5):
        for t in starts(ruled, j):
            assert t > 0 and online[t - 1, [2, 3, 4, 5]].any()


def group_starts(answer):
    return sorted(t for j in (1, 2, 3) for t in starts(answer, j))


def test_group_start_spacing_keeps_starts_two_hours_apart():
    # 비용만 보면 1·2시에 연달아 켠다. 그룹 안 기동 간격 2시간이면 0·2·4시로 당겨 켠다.
    target = [200.0, 300.0, 500.0, 600.0] + [800.0] * 6
    kwargs = dict(initial_online=[True, False, False, False])
    free = solve(target, [10, 50, 50, 50], rules=None, **kwargs)
    assert any(b - a < 2 for a, b in zip(group_starts(free), group_starts(free)[1:]))
    spaced = solve(target, [10, 50, 50, 50], **kwargs,
                   rules={'group_start_spacing': [{'indices': [1, 2, 3], 'hours': 2, 'label': 'g'}]})
    assert spaced['target_met']
    times = group_starts(spaced)
    assert len(times) == 3 and all(b - a >= 2 for a, b in zip(times, times[1:]))


def test_group_start_cap_spreads_a_jump_over_hours():
    target = [200.0, 200.0] + [600.0] * 8
    kwargs = dict(initial_online=[True, False, False, False])
    free = solve(target, [10, 50, 50, 50], rules=None, **kwargs)
    assert max(np.asarray(free['starts'])[:, 1:].sum(axis=1)) == 2
    capped = solve(target, [10, 50, 50, 50], **kwargs,
                   rules={'group_start_caps': [{'indices': [1, 2, 3], 'maximum': 1, 'label': 'g'}]})
    assert capped['target_met'] and max(np.asarray(capped['starts'])[:, 1:].sum(axis=1)) <= 1


def test_start_order_puts_the_second_unit_first():
    # 1 이 싸서 먼저 켜고 싶지만 여수처럼 2 → 1 순이다. 둘 사이는 페어 간격 10시간.
    target = [150.0] * 2 + [350.0] * 10 + [550.0] * 8
    kwargs = dict(initial_online=[True, False, False])
    free = solve(target, [10, 40, 60], rules=pair_only(start_hours=(10, 10, 11)), **kwargs)
    assert starts(free, 1)[0] < starts(free, 2)[0]
    ruled = solve(target, [10, 40, 60], **kwargs,
                  rules={'start_order': [{'first': 2, 'then': 1, 'label': 'o'}],
                         **pair_only(start_hours=(10, 10, 11))})
    assert ruled['target_met']
    (a,), (b,) = starts(ruled, 1), starts(ruled, 2)
    assert b < a and a - b >= 10


def test_rules_are_rejected_when_they_name_a_unit_outside_the_fleet():
    with pytest.raises(ValueError, match='transition rule'):
        solve([150.0] * 3, [10, 50, 50], initial_online=[True, False, False],
              rules={'pairs': [{'indices': (1, 7), 'start_hours': (4, 4, 4), 'stop_hours': 2}]})


def test_names_become_indices_and_half_pairs_are_skipped():
    names = ['당진1', '당진2', '당진9', '당진5', '당진7', '당진8', '여수1', '여수2', '하동1', '하동2', '하동3', '하동4']
    rules = pair_rules.transition_rules(names)
    labels = {p['label']: p for p in rules['pairs']}
    assert labels['당진1·2']['indices'] == (0, 1) and labels['당진1·2']['start_hours'] == (4, 4, 4)
    assert '당진9·10' not in labels  # 당진10 이 순위표에 없다
    assert labels['여수1·2']['stop_hours'] == 60.0
    assert rules['start_order'] == [{'first': 7, 'then': 6, 'label': '여수2→1'}]
    # 당진 5~10 그룹: 가운데 7·8 이 있으니 9 는 그 경로로만 켠다. 5 는 짝(6)이 없어 가운데만 본다.
    bridges = {b['unit']: b for b in rules['start_bridges']}
    assert bridges[2] == {'unit': 2, 'bridge': [4, 5], 'also': []}
    assert bridges[3] == {'unit': 3, 'bridge': [4, 5], 'also': []}
    assert {g['label'] for g in rules['group_stop_limits']} >= {'당진1~4', '당진5~10', '하동1~4'}
    assert rules['group_start_spacing'][0]['hours'] == 2.0


def test_group_minimums_shrink_to_what_maintenance_leaves():
    names = ['보령7', '보령8', '태안2', '태안3']
    outage = np.zeros((3, 4), bool)
    outage[1, [0, 1]] = True
    groups = {g['group']: g for g in pair_rules.group_minimums(names, outage)}
    assert groups['보령7~8']['minimum_units_hourly'] == [1, 0, 1]
    assert groups['태안1~4']['index'] == [2, 3]


def test_a_partner_that_stopped_and_restarted_before_the_window_still_blocks_a_stop():
    # 2 는 10시간 전에 섰다가 5시간 전에 다시 켜졌다. 경과시간(켜진 지 5시간)만 보면 그 정지가 안 보인다.
    # 정지 간격 26시간이면 1 은 16시 전에는 서지 못한다 -- 2026-09-29 소급의 삼천포3·4.
    target = [300.0] * 24
    kwargs = dict(initial_online=[True, True, True], elapsed=[30.0, 30.0, 5.0])
    blind = solve(target, [10, 90, 20], rules=pair_only(stop_hours=26), **kwargs)
    assert stops(blind, 1) and stops(blind, 1)[0] < 16
    h, n = len(target), 3
    seen = solve_coal_uc(
        np.asarray(target), np.full((h, n), 100.0), np.full((h, n), 200.0), np.full((h, n), 50.0),
        np.tile([10.0, 90.0, 20.0], (h, 1)), np.zeros((h, n), bool), np.zeros((h, n), bool), [2] * n, [2] * n,
        initial_online=[True] * 3, initial_output=[100.0] * 3, initial_elapsed_hours=[30.0, 30.0, 5.0],
        initial_since_start=[float('nan'), float('nan'), 5.0], initial_since_stop=[float('nan'), float('nan'), 10.0],
        transition_rules=pair_only(stop_hours=26))
    assert seen['target_met'] and stops(seen, 1)[0] >= 16


def test_rolling_windows_carry_the_last_start_and_stop_separately():
    from midterm.rolling import _since_events
    # 0시 운전(3시간째) -> 1시 정지 -> 3시 기동, 지금 5시: 마지막 기동 2시간 전, 마지막 정지 4시간 전.
    assert _since_events([True, False, False, True, True], True, 3.0, 5) == (2.0, 4.0)
    # 상태가 한 번도 안 바뀌었으면 첫 창 앞의 기동만 안다.
    start, stop = _since_events([True] * 4, True, 3.0, 4)
    assert start == 7.0 and np.isnan(stop)


def test_rolling_passes_the_last_start_and_stop_to_the_next_window():
    from midterm.rolling import solve_rolling
    seen = []

    def fake(target, minimum, maximum, ramp, costs, must, outage, uptime, downtime, **kwargs):
        seen.append(kwargs)
        h, n = len(target), np.shape(minimum)[1]
        # 0번 호기: 2시에 섰다가 3시에 다시 켜진다(창 첫 24시간 안). 1번 호기: 계속 운전.
        online = np.ones((h, n), bool)
        online[2, 0] = False
        on = online.tolist()
        changes = np.diff(np.vstack([[True] * n, online]).astype(int), axis=0)
        return {'has_plan': True, 'status': 'optimal', 'online': on,
                'output_mw': (online * 100.0).tolist(), 'starts': (changes > 0).tolist(),
                'stops': (changes < 0).tolist(), 'shortage_mw': [0.0] * h, 'excess_mw': [0.0] * h,
                'initial_online': [True] * n, 'initial_elapsed_hours': [30.0] * n,
                'initial_output_mw': [100.0] * n}

    h, n = 72, 2
    solve_rolling(fake, np.full(h, 200.0), np.full((h, n), 50.0), np.full((h, n), 100.0),
                  np.full((h, n), 10.0), np.ones((h, n)), np.zeros((h, n), bool), np.zeros((h, n), bool),
                  [1, 1], [1, 1], window=48, step=24, transition_rules={'pairs': []})
    assert 'initial_since_start' not in seen[0]
    # 다음 창은 24시에 열린다: 0번은 3시 기동 21시간 전·2시 정지 22시간 전, 1번은 기동만(첫 창 앞 30+24시간).
    assert seen[1]['initial_since_start'] == [21.0, 54.0]
    assert seen[1]['initial_since_stop'][0] == 22.0 and np.isnan(seen[1]['initial_since_stop'][1])
    assert seen[1]['transition_rules'] == {'pairs': []}


def test_dangjin_caps_switch_at_0700_and_1900():
    from datetime import datetime
    from midterm.fleet import CoalUnit, coal_inputs, group_constraints
    units = [CoalUnit(f'당진{i}', '당진', 500, 280, 500, 10, 10, 2, 2, 0, (0, 1, 0), None) for i in range(1, 5)]
    hours = [datetime(2027, 5, 1, h) for h in (6, 7, 18, 19)]
    inputs = coal_inputs(units, {u.name: [1000] * 12 for u in units}, [], hours)
    caps = {tuple(g['indices']): g['maximum_mw'] for g in group_constraints(inputs, np.full(4, 15000.))['group_caps']}
    assert caps[(0, 1)] == [1000., 800., 800., 1000.]   # 당진1·2: 낮에만 800 MW
    assert caps[(2, 3)] == [1000.] * 4                   # 당진3·4: 4,000 MW 보다 가용 합계가 작다


def test_dangjin_three_to_ten_cap_binds_at_4000_and_shrinks_with_maintenance():
    from datetime import datetime
    from midterm.fleet import CoalUnit, coal_inputs, group_constraints
    from midterm.outages import parse_outage_rows
    units = [CoalUnit(f'당진{i}', '당진', 500 if i <= 8 else 1000, 280, 500 if i <= 8 else 1000,
                      10, 10, 2, 2, 0, (0, 1, 0), None) for i in range(1, 11)]
    hours = [datetime(2027, 5, 1, h) for h in (0, 1)]
    outages = parse_outage_rows([['unit', 'start', 'end'], ['당진9', '2027-05-01 01:00', '2027-05-01 02:00'],
                                 ['당진10', '2027-05-01 01:00', '2027-05-01 02:00'],
                                 ['당진3', '2027-05-01 01:00', '2027-05-01 02:00']])
    inputs = coal_inputs(units, {u.name: [1000] * 12 for u in units}, outages, hours)
    groups = group_constraints(inputs, np.full(2, 15000.))
    caps = {tuple(g['indices']): g['maximum_mw'] for g in groups['group_caps']}
    assert caps[tuple(range(2, 10))] == [4000., 2500.]   # 가용 5,000 MW → 4,000 / 3·9·10호기 정비 뒤 500×5
    labels = {n['group'] for n in groups['notes']}
    assert {'당진1~4', '당진5~10', '하동1~4'} & labels == {'당진1~4', '당진5~10'}


def test_an_approximate_window_is_solved_again_with_more_time(monkeypatch):
    import midterm.headroom_uc as headroom
    from midterm.annual import _solve_window
    calls = []

    def fake(*args, **kwargs):
        calls.append(kwargs['time_limit'])
        short = 100.0 if len(calls) == 1 else 0.0
        return {'has_plan': True, 'target_met': short == 0.0, 'status': 'approximate' if short else 'time_limit_feasible',
                'shortage_mw': [short], 'excess_mw': [0.0]}

    monkeypatch.setattr(headroom, 'solve_headroom_uc', fake)
    result = _solve_window(None, 0, [0], time_limit=30.0, mip_rel_gap=0.005)
    assert calls == [30.0, 90.0] and result['target_met']


def test_the_smallest_mismatch_is_kept_when_every_attempt_falls_short(monkeypatch):
    import midterm.headroom_uc as headroom
    from midterm.annual import _solve_window
    shortages = iter([50.0, 10.0, 30.0])

    def fake(*args, **kwargs):
        short = next(shortages)
        return {'has_plan': True, 'target_met': False, 'status': 'approximate',
                'shortage_mw': [short], 'excess_mw': [0.0]}

    monkeypatch.setattr(headroom, 'solve_headroom_uc', fake)
    assert _solve_window(None, 0, [0], time_limit=30.0, mip_rel_gap=0.005)['shortage_mw'] == [10.0]
