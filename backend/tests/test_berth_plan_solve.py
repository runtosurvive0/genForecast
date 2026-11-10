import time
from dataclasses import replace
from datetime import timedelta

from midterm.berth_plan.inputs import Berth, BerthInputs, Fixed, Outage, StockSeries, Voyage
from midterm.berth_plan.solve import Assignment, evaluate, occupancy, solve_option
from midterm.supply import timestamp

T0 = timestamp('2026-11-10T00:00:00+09:00')


def h(n):
    return T0 + timedelta(hours=n)


def berth(key, tph=1000., hours=24., yards=('1',)):
    return Berth(key, tph, hours, tuple(yards))


def ship(no, eta, tonnes, rate=24000., laytime=0., yard='1', group='g14'):
    return Voyage(no, None, None, yard, group, float(tonnes), eta, laytime, rate, (), None, None, None)


def make_inputs(berths, voyages, outages=(), fixed=(), stock=None, horizon_days=3, as_of=T0):
    t0 = as_of.replace(minute=0, second=0, microsecond=0)
    if t0 < as_of:
        t0 += timedelta(hours=1)
    midnight = as_of.replace(hour=0, minute=0, second=0, microsecond=0)
    berths = {b.id: b for b in berths}
    voyages = [replace(v, allowed=tuple(sorted(b.id for b in berths.values() if v.yard in b.yards)))
               for v in voyages]
    return BerthInputs(as_of, t0, midnight, horizon_days, berths, list(outages), voyages, list(fixed), stock,
                       7., 15., [])


def by_no(result):
    return {a.voyage_no: a for a in result.assignments}


def assert_no_overlap(result):
    spans = sorted((a.berth_id, a.berth_at, a.unload_end) for a in result.assignments)
    for (b1, s1, e1), (b2, s2, _) in zip(spans, spans[1:]):
        if b1 == b2:
            assert e1 <= s2, (b1, s1, e1, s2)


def test_hand_example_three_ships_two_berths():
    inputs = make_inputs([berth('X'), berth('Y')],
                         [ship('a', h(0), 24000, 24000.), ship('b', h(0), 24000, 48000.),
                          ship('c', h(0), 12000, 24000.)])
    result = solve_option(inputs, 0.)
    assert result.status == 'optimal'
    assert result.gap_pct == 0
    got = by_no(result)
    assert got['b'].berth_at == h(0) and got['c'].berth_at == h(0)
    assert got['b'].berth_id != got['c'].berth_id
    assert got['a'].berth_id == got['c'].berth_id and got['a'].berth_at == h(12)
    assert got['a'].unload_end == h(36)
    scores = evaluate(inputs, result.assignments)
    assert scores['demurrage_usd'] == 12000
    assert scores['demurrage_hours'] == 12
    assert scores['per_voyage']['a'] == {'demurrage_hours': 12, 'demurrage_usd': 12000}
    assert scores['min_days'] is None and scores['caution_days'] is None and scores['danger_days'] is None
    worse = [Assignment('b', 'X', h(0), h(24)), Assignment('a', 'Y', h(0), h(24)),
             Assignment('c', 'X', h(24), h(36))]
    assert evaluate(inputs, worse)['demurrage_usd'] == 24000


def test_caution_penalty_changes_order():
    stock = StockSeries({'g14': [1e6] * 3, 'g58': [100.] * 3}, {'g14': [10.] * 3, 'g58': [10.] * 3})
    inputs = make_inputs([berth('X', yards=('1', '5'))],
                         [ship('p', h(0), 12000, 48000., group='g14'),
                          ship('q', h(1), 12000, 24000., yard='5', group='g58')], stock=stock)
    plain = solve_option(inputs, 0.)
    weighted = solve_option(inputs, 20000.)
    assert plain.status == weighted.status == 'optimal'
    assert by_no(plain)['p'].berth_at < by_no(plain)['q'].berth_at
    assert by_no(weighted)['q'].berth_at < by_no(weighted)['p'].berth_at
    plain_scores, weighted_scores = evaluate(inputs, plain.assignments), evaluate(inputs, weighted.assignments)
    assert weighted_scores['caution_days'] < plain_scores['caution_days']
    assert plain_scores['caution_days'] == 1 and weighted_scores['caution_days'] == 0
    assert plain_scores['demurrage_usd'] == 11000 and weighted_scores['demurrage_usd'] == 26000
    assert plain.danger_violated is False and weighted.danger_violated is False


def test_no_start_before_eta():
    inputs = make_inputs([berth('X')], [ship('a', h(5.5), 5000)])
    result = solve_option(inputs, 0.)
    assert by_no(result)['a'].berth_at == h(6)
    assert evaluate(inputs, result.assignments)['per_voyage']['a']['demurrage_hours'] == 0.5


def test_berth_yard_rule():
    berths = [berth('BD-1', tph=5000., yards=('1', '2')), berth('BD-2', yards=('3',))]
    inputs = make_inputs(berths, [ship('a', h(0), 12000, yard='3'), ship('b', h(0), 12000, yard='3')])
    result = solve_option(inputs, 0.)
    assert result.status == 'optimal'
    assert {a.berth_id for a in result.assignments} == {'BD-2'}
    assert_no_overlap(result)


def test_outage_forbids_start_and_extends_unload():
    x = berth('X')
    outages = [Outage('X', h(2), h(4))]
    v = ship('a', h(2), 6000)
    assert occupancy(v, x, h(1), outages) == h(9)
    assert occupancy(v, x, h(4), outages) == h(10)
    assert occupancy(v, x, h(1), [Outage('Y', h(2), h(4))]) == h(7)
    inputs = make_inputs([x], [v], outages=outages)
    result = solve_option(inputs, 0.)
    assert by_no(result)['a'].berth_at == h(4)
    assert by_no(result)['a'].unload_end == h(10)


def test_fixed_occupancy_blocks_berth():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 5000)], fixed=[Fixed('F', None, None, '1', 'X', h(10))])
    result = solve_option(inputs, 0.)
    assert by_no(result)['a'].berth_at == h(10)


def test_fixed_without_end_blocks_berth_to_grid_end():
    inputs = make_inputs([berth('X'), berth('Y', tph=100.)], [ship('a', h(0), 5000, rate=None)],
                         fixed=[Fixed('F', None, None, '1', 'X', None)])
    result = solve_option(inputs, 0.)
    assert by_no(result)['a'].berth_id == 'Y'


def test_arrived_before_as_of_counts_wait_from_eta():
    inputs = make_inputs([berth('X')], [ship('a', h(-5), 5000)])
    result = solve_option(inputs, 0.)
    assert by_no(result)['a'].berth_at == inputs.t0
    assert evaluate(inputs, result.assignments)['per_voyage']['a']['demurrage_hours'] >= 5


def test_unload_past_horizon_blocks_berth_but_not_stock():
    stock = StockSeries({'g14': [100., 100.]}, {'g14': [10., 10.]})
    a = ship('a', h(46), 10000)
    b = ship('b', h(0), 1000, rate=None)
    inputs = make_inputs([berth('X')], [a, b], stock=stock, horizon_days=2)
    blocked = solve_option(inputs, 0., locks=[{'voyage_no': 'b', 'berth_id': 'X', 'berth_at': h(50)}])
    assert blocked.status == 'infeasible'
    assert blocked.assignments == [] and blocked.danger_violated is False and blocked.message
    result = solve_option(inputs, 0., locks=[{'voyage_no': 'b', 'berth_id': 'X', 'berth_at': h(56)}])
    assert result.status == 'optimal'
    assert by_no(result)['a'].berth_at == h(46) and by_no(result)['a'].unload_end == h(56)
    assert by_no(result)['b'].berth_at == h(56)
    scores = evaluate(inputs, result.assignments)
    assert scores['caution_days'] == 2 and scores['danger_days'] == 0 and scores['min_days'] == 10


def test_missing_demurrage_excluded_from_cost_but_assigned():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000), ship('n', h(0), 12000, laytime=None)])
    result = solve_option(inputs, 0.)
    assert set(by_no(result)) == {'a', 'n'}
    assert by_no(result)['a'].berth_at == h(0)
    scores = evaluate(inputs, result.assignments)
    assert scores['per_voyage']['n'] == {'demurrage_hours': None, 'demurrage_usd': None}
    assert scores['demurrage_usd'] == 0


def test_evaluate_unassigned_counts_receipt_without_demurrage():
    stock = StockSeries({'g14': [100., 100., 100.]}, {'g14': [10., 10., 10.]})
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)], stock=stock)
    scores = evaluate(inputs, [Assignment('a', None, None, h(30))])
    assert scores['per_voyage']['a'] == {'demurrage_hours': None, 'demurrage_usd': None}
    assert scores['caution_days'] == 1 and scores['danger_days'] == 0
    assert scores['min_days'] == 10


def test_danger_relaxed_when_unavoidable():
    stock = StockSeries({'g14': [10., 10.]}, {'g14': [10., 10.]})
    inputs = make_inputs([berth('X')], [ship('a', h(30), 12000)], stock=stock, horizon_days=2)
    result = solve_option(inputs, 20000.)
    assert result.status == 'optimal'
    assert result.danger_violated is True
    assert by_no(result)['a'].berth_at == h(30)
    assert evaluate(inputs, result.assignments)['danger_days'] == 1


def test_danger_not_violated_when_reachable():
    stock = StockSeries({'g14': [100., 10., 10.]}, {'g14': [10., 10., 10.]})
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)], stock=stock)
    result = solve_option(inputs, 0.)
    assert result.danger_violated is False


def test_lock_respected():
    inputs = make_inputs([berth('X'), berth('Y')], [ship('a', h(0), 12000), ship('b', h(0), 12000)])
    lock = {'voyage_no': 'a', 'berth_id': 'Y', 'berth_at': h(20)}
    result = solve_option(inputs, 0., locks=[lock])
    assert result.status == 'optimal'
    got = by_no(result)
    assert got['a'].berth_id == 'Y' and got['a'].berth_at == h(20) and got['a'].unload_end == h(32)
    assert got['b'].berth_at == h(0)


def test_lock_outside_window_is_candidate():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 1000)], horizon_days=1)
    result = solve_option(inputs, 0., locks=[{'voyage_no': 'a', 'berth_id': 'X', 'berth_at': h(30)}])
    assert result.status == 'optimal' and by_no(result)['a'].berth_at == h(30)


def test_impossible_lock_is_infeasible_not_exception():
    inputs = make_inputs([berth('X'), berth('Z', yards=('9',))], [ship('a', h(5), 1000)],
                         outages=[Outage('X', h(2), h(4))], fixed=[Fixed('F', None, None, '1', 'X', h(10))])
    for at, b in ((h(3), 'X'), (h(6), 'X'), (h(12), 'Z'), (h(12), 'NOPE'), (h(1), 'X')):
        result = solve_option(inputs, 0., locks=[{'voyage_no': 'a', 'berth_id': b, 'berth_at': at}])
        assert result.status == 'infeasible', (at, b)
        assert result.assignments == [] and result.danger_violated is False and result.gap_pct is None
        assert result.message
    unknown = solve_option(inputs, 0., locks=[{'voyage_no': 'zz', 'berth_id': 'X', 'berth_at': h(12)}])
    assert unknown.status == 'infeasible' and unknown.message


def test_no_voyages_is_trivially_optimal():
    result = solve_option(make_inputs([berth('X')], []), 0.)
    assert result.status == 'optimal' and result.assignments == []


def test_realistic_size_solves_without_overlap():
    berths = [berth('BD-1', 1800., 20., ('1', '2')), berth('BD-2', 1500., 20., ('3', '4', '5', '6')),
              berth('BD-3', 1500., 20., ('7', '8', '9', '10'))]
    yards = ['1', '2', '3', '5', '7', '9']
    groups = {'1': 'g14', '2': 'g14', '3': 'g14', '5': 'g58', '7': 'g58', '9': 'g910'}
    voyages = [ship(f'V{i:02d}', h(9 * i), 40000 + 5000 * (i % 4), rate=15000. + 1000 * i, laytime=24.,
                    yard=yards[i % 6], group=groups[yards[i % 6]]) for i in range(24)]
    stock = StockSeries({g: [150000. - 8000 * d for d in range(14)] for g in ('g14', 'g58', 'g910')},
                        {g: [10000.] * 14 for g in ('g14', 'g58', 'g910')})
    inputs = make_inputs(berths, voyages, outages=[Outage('BD-2', h(240), h(276))], stock=stock, horizon_days=14)
    began = time.perf_counter()
    result = solve_option(inputs, 200000., time_limit_s=30.)
    elapsed = time.perf_counter() - began
    print(f'realistic solve {elapsed:.2f}s status={result.status} gap={result.gap_pct}')
    assert result.status in ('optimal', 'time_limit')
    assert len(result.assignments) == 24
    assert_no_overlap(result)
    for a in result.assignments:
        v = next(x for x in inputs.voyages if x.voyage_no == a.voyage_no)
        assert a.berth_id in v.allowed and a.berth_at >= v.eta


def _fake_time_limit(monkeypatch, status, mip_gap):
    """실제 풀이 결과의 해는 그대로 두고 상태·gap만 바꾼다."""
    from types import SimpleNamespace
    from midterm.berth_plan import solve
    real = solve.milp

    def fake(*args, **kwargs):
        res = real(*args, **kwargs)
        return SimpleNamespace(x=res.x, status=status, mip_gap=mip_gap, message='fake')
    monkeypatch.setattr(solve, 'milp', fake)


def test_time_limit_without_mip_gap_reports_unknown_gap(monkeypatch):
    _fake_time_limit(monkeypatch, 1, None)
    result = solve_option(make_inputs([berth('X')], [ship('a', h(0), 12000)]), 0.)
    assert result.status == 'time_limit' and result.gap_pct is None and result.assignments


def test_time_limit_with_mip_gap_reports_percent(monkeypatch):
    _fake_time_limit(monkeypatch, 1, 0.05)
    result = solve_option(make_inputs([berth('X')], [ship('a', h(0), 12000)]), 0.)
    assert result.status == 'time_limit' and abs(result.gap_pct - 5.) < 1e-9


def test_other_status_with_solution_is_time_limit(monkeypatch):
    _fake_time_limit(monkeypatch, 4, None)
    result = solve_option(make_inputs([berth('X')], [ship('a', h(0), 12000)]), 0.)
    assert result.status == 'time_limit' and result.gap_pct is None
