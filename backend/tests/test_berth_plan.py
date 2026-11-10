from dataclasses import replace
from datetime import timedelta

from midterm.berth_plan import recommend_berth_plan
from midterm.berth_plan.explain import current_plan, reasons
from midterm.berth_plan.inputs import Berth, BerthInputs, Fixed, Outage, StockSeries, Voyage
from midterm.berth_plan.solve import Assignment, occupancy
from midterm.supply import timestamp

T0 = timestamp('2026-11-10T00:00:00+09:00')


def h(n):
    return T0 + timedelta(hours=n)


def berth(key, tph=1000., hours=24., yards=('1',)):
    return Berth(key, tph, hours, tuple(yards))


def ship(no, eta, tonnes, rate=24000., laytime=0., yard='1', group='g14', number=None):
    return Voyage(no, number, f'선박 {no}', yard, group, float(tonnes), eta, laytime, rate, (), None, None, None)


def make_inputs(berths, voyages, outages=(), fixed=(), stock=None, horizon_days=3, as_of=T0):
    berths = {b.id: b for b in berths}
    voyages = [replace(v, allowed=tuple(sorted(b.id for b in berths.values() if v.yard in b.yards)))
               for v in voyages]
    return BerthInputs(as_of, as_of, as_of, horizon_days, berths, list(outages), voyages, list(fixed), stock,
                       7., 15., [{'kind': 'x', 'voyage_no': None, 'message': 'm'}])


def rich_stock():
    return StockSeries({'g14': [1e6] * 3, 'g58': [1e6] * 3}, {'g14': [10.] * 3, 'g58': [10.] * 3})


def test_reasons_berth_busy():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 24000), ship('b', h(0), 24000)])
    got = reasons(inputs, [Assignment('a', 'X', h(0), h(24)), Assignment('b', 'X', h(24), h(48))])
    assert got['b'] == ['berth_busy'] and 'a' not in got


def test_reasons_outage():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)], outages=[Outage('X', h(0), h(6))])
    got = reasons(inputs, [Assignment('a', 'X', h(6), h(18))])
    assert got['a'] == ['outage']


def test_reasons_stock_priority_names_other_voyage():
    # 다른 그룹의 배가 재고 벌점(가중치 > 0) 아래에서 먼저 들어갔다.
    inputs = make_inputs([berth('X', yards=('1', '5'))],
                         [ship('a', h(0), 12000, number='V-A'),
                          ship('b', h(2), 12000, yard='5', group='g58', number='V-B')], stock=rich_stock())
    got = reasons(inputs, [Assignment('b', 'X', h(2), h(14)), Assignment('a', 'X', h(14), h(26))], 20000.)
    assert 'stock_priority:V-B' in got['a']
    assert not any(r.startswith('order:') for r in got['a'])


def test_reasons_same_group_is_order_not_stock_priority():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000, number='V-A'), ship('b', h(2), 12000, number='V-B')],
                         stock=rich_stock())
    got = reasons(inputs, [Assignment('b', 'X', h(2), h(14)), Assignment('a', 'X', h(14), h(26))], 20000.)
    assert 'order:V-B' in got['a']
    assert not any(r.startswith('stock_priority') for r in got['a'])


def test_reasons_zero_weight_or_no_stock_is_order():
    voyages = [ship('a', h(0), 12000, number='V-A'), ship('b', h(2), 12000, yard='5', group='g58', number='V-B')]
    plan = [Assignment('b', 'X', h(2), h(14)), Assignment('a', 'X', h(14), h(26))]
    for stock, weight in ((rich_stock(), 0.), (None, 20000.)):
        inputs = make_inputs([berth('X', yards=('1', '5'))], voyages, stock=stock)
        got = reasons(inputs, plan, weight)
        assert 'order:V-B' in got['a'] and not any(r.startswith('stock_priority') for r in got['a'])


def test_stock_unknown_demurrage_rate_reorder_is_order():
    # 재고 모름(A안만): ETA가 늦은 b의 체선료 단가가 커서 b가 먼저 들어간다. 재고 때문이 아니다.
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000, 24000., number='V-A'),
                                        ship('b', h(1), 12000, 480000., number='V-B')])
    out = recommend_berth_plan(inputs)
    rows = {r['voyage_no']: r for r in out['options'][0]['assignments']}
    assert rows['b']['berth_at'] == h(1).isoformat()
    assert 'order:V-B' in rows['a']['reasons']
    assert not any(r.startswith('stock_priority') for r in rows['a']['reasons'])


def test_reasons_wait_when_no_other_cause():
    # 고른 부두 X는 고정 점유, 다른 부두 Y는 정비: berth_busy·outage·order 어느 것도 아니다.
    inputs = make_inputs([berth('X'), berth('Y')], [ship('a', h(0), 12000)], outages=[Outage('Y', h(0), h(10))])
    got = reasons(inputs, [Assignment('f', 'X', h(0), h(10), True), Assignment('a', 'X', h(10), h(22))])
    assert got['a'] == ['wait']


def test_current_plan_reasons_never_stock_priority():
    inputs = crowded()
    inputs = replace(inputs, voyages=[
        replace(inputs.voyages[0], current_berth='X', current_berth_at=h(13), current_unload_end=h(25)),
        replace(inputs.voyages[1], current_berth='X', current_berth_at=h(1), current_unload_end=h(13))])
    out = recommend_berth_plan(inputs, 20000.)
    current = {r['voyage_no']: r for r in out['current']['assignments']}
    assert 'order:V-Q' in current['p']['reasons']
    assert not any(r.startswith('stock_priority') for r in current['p']['reasons'])
    best = {r['voyage_no']: r for r in out['options'][0]['assignments']}
    assert 'stock_priority:V-Q' in best['p']['reasons']


def test_current_plan_uses_registry_values():
    inputs = make_inputs([berth('X')], [
        replace(ship('a', h(0), 12000), current_berth='X', current_berth_at=h(3), current_unload_end=h(20)),
        replace(ship('b', h(0), 12000), current_berth='X', current_berth_at=h(30)),
        replace(ship('c', h(0), 12000), current_unload_end=h(40)),
        ship('d', h(0), 12000)])
    got = {a.voyage_no: a for a in current_plan(inputs)}
    assert (got['a'].berth_id, got['a'].berth_at, got['a'].unload_end) == ('X', h(3), h(20))
    assert got['b'].unload_end == occupancy(inputs.voyages[1], inputs.berths['X'], h(30), [])
    assert got['c'].berth_id is None and got['c'].berth_at is None and got['c'].unload_end == h(40)
    assert got['d'].berth_id is None and got['d'].unload_end is None


def crowded():
    stock = StockSeries({'g14': [1e6] * 3, 'g58': [100.] * 3}, {'g14': [10.] * 3, 'g58': [10.] * 3})
    return make_inputs([berth('X', yards=('1', '5'))],
                       [ship('p', h(0), 12000, 48000., group='g14', number='V-P'),
                        ship('q', h(1), 12000, 24000., yard='5', group='g58', number='V-Q')], stock=stock)


def test_three_options_and_ranking():
    out = recommend_berth_plan(crowded(), 20000.)
    assert [o['id'] for o in out['options']] == ['B', 'A']
    assert [o['rank'] for o in out['options']] == [1, 2]
    assert out['options'][0]['label'] == 'B·C 같음'
    assert out['options'][0]['merged'] == ['B', 'C']
    a = out['options'][1]
    assert a['label'] == 'A. 체선 최소' and a['merged'] == ['A']
    assert a['assignments'][0]['voyage_no'] == 'p'
    assert out['options'][0]['assignments'][0]['voyage_no'] == 'q'


def test_infeasible_b_ranked_after_feasible(monkeypatch):
    from midterm.berth_plan import plan
    from midterm.berth_plan.solve import OptionResult
    real = plan.solve_option

    def fake(inputs, weight, locks, time_limit_s):
        if weight == 20000.:
            return OptionResult('infeasible', None, [], False, '해 없음(시험)')
        return real(inputs, weight, locks, time_limit_s)
    monkeypatch.setattr(plan, 'solve_option', fake)
    out = recommend_berth_plan(crowded(), 20000.)
    assert [o['id'] for o in out['options']] == ['A', 'C', 'B']
    assert [o['rank'] for o in out['options']] == [1, 2, 3]
    assert out['options'][2]['status'] == 'infeasible'


def test_identical_options_merged():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000, laytime=999.)], stock=rich_stock())
    out = recommend_berth_plan(inputs)
    assert len(out['options']) == 1
    o = out['options'][0]
    assert o['merged'] == ['A', 'B', 'C'] and o['id'] == 'B' and o['rank'] == 1
    assert o['label'] == '세 안 같음 · 체선·재고 차이 없음'


def test_stock_unknown_only_option_a():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)])
    out = recommend_berth_plan(inputs)
    assert [o['id'] for o in out['options']] == ['A']
    assert out['options'][0]['rank'] == 1
    assert out['options'][0]['label'] == 'A. 체선 최소'
    assert out['options'][0]['kpis']['min_days'] is None


def test_no_targets_returns_empty_options():
    out = recommend_berth_plan(make_inputs([berth('X')], []))
    assert out['options'] == [] and out['current'] is None
    assert out['message'] == '기간 안 입항 예정 선박 없음'
    assert set(out) >= {'as_of', 'horizon_days', 'source', 'assumptions', 'gaps', 'message', 'current', 'options'}
    assert out['source'] == {'berths': 'dummy', 'voyages': 'registry', 'stock': 'supply_ledger'}


def test_changed_flag_and_delta():
    inputs = make_inputs([berth('X'), berth('Y')], [
        replace(ship('a', h(0), 24000, 24000.), current_berth='X', current_berth_at=h(0), current_unload_end=h(24)),
        replace(ship('b', h(0), 24000, 48000.), current_berth='X', current_berth_at=h(24), current_unload_end=h(48))])
    out = recommend_berth_plan(inputs)
    opt = out['options'][0]
    rows = {r['voyage_no']: r for r in opt['assignments']}
    assert rows['b']['berth_at'] == h(0).isoformat()
    assert rows['b']['changed'] is True or rows['a']['changed'] is True
    assert out['current']['kpis']['demurrage_usd'] == 48000
    assert 'demurrage_usd_delta' not in out['current']['kpis']
    assert opt['kpis']['demurrage_usd_delta'] == opt['kpis']['demurrage_usd'] - 48000
    assert opt['kpis']['demurrage_usd_delta'] < 0
    assert all(r['changed'] is False for r in out['current']['assignments'])
    assert any(r['changed'] for r in opt['assignments'])


def test_fixed_assignments_included():
    inputs = make_inputs([berth('X'), berth('Y')], [ship('a', h(0), 12000)],
                         fixed=[Fixed('f', 'V-F', '고정선', '1', 'X', h(10))])
    out = recommend_berth_plan(inputs)
    for rows in [out['current']['assignments']] + [o['assignments'] for o in out['options']]:
        fixed = [r for r in rows if r['fixed']]
        assert len(fixed) == 1 and fixed[0]['voyage_no'] == 'f' and fixed[0]['berth_id'] == 'X'
        assert fixed[0]['unload_end'] == h(10).isoformat() and fixed[0]['eta'] is None
        assert fixed[0]['changed'] is False and fixed[0]['demurrage_usd'] is None


def test_conflicting_lock_gives_infeasible_option():
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)], fixed=[Fixed('f', 'V-F', None, '1', 'X', h(10))])
    out = recommend_berth_plan(inputs, locks=[{'voyage_no': 'a', 'berth_id': 'X', 'berth_at': h(2)}])
    opt = out['options'][0]
    assert opt['status'] == 'infeasible' and opt['message'] and opt['kpis'] is None
    assert [r['voyage_no'] for r in opt['assignments']] == ['f'] and opt['assignments'][0]['fixed']


def test_assumptions_and_gaps():
    stock = StockSeries({'g14': [10.] * 3, 'g58': [1e6] * 3}, {'g14': [1e6] * 3, 'g58': [10.] * 3})
    inputs = make_inputs([berth('X')], [ship('a', h(0), 12000)], stock=stock)
    out = recommend_berth_plan(inputs)
    for text in ('부두 능력: 시연용 가정값', 'ETA 기산 가정', '벌점 단가 20,000 USD/그룹·일(가정값)'):
        assert text in out['assumptions']
    assert out['gaps'] == inputs.gaps
    assert all('위험 기준을 지킬 수 없음' in o['warnings'] for o in out['options'])


def test_berths_and_outages_in_response():
    inputs = make_inputs([berth('Y', yards=('2', '1')), berth('X')], [ship('a', h(0), 12000)], outages=[
        Outage('X', h(-10), h(-1)),          # 기간 전: 제외
        Outage('X', h(-2), h(4)),            # 시작에 걸침: 포함
        Outage('Y', h(70), h(80)),           # 기간 끝(72시간)에 걸침: 포함
        Outage('Y', h(72), h(90)),           # 기간 뒤: 제외
    ])
    inputs = replace(inputs, outages=[replace(o, reason='하역기 정비(예시)') if o.berth == 'X' else o
                                      for o in inputs.outages])
    out = recommend_berth_plan(inputs)
    assert out['berths'] == [{'id': 'X', 'yards': ['1']}, {'id': 'Y', 'yards': ['2', '1']}]
    assert out['outages'] == [
        {'berth': 'X', 'start': h(-2).isoformat(), 'end': h(4).isoformat(), 'reason': '하역기 정비(예시)'},
        {'berth': 'Y', 'start': h(70).isoformat(), 'end': h(80).isoformat(), 'reason': None},
    ]
    assert '정비 일정: 예시값' in out['assumptions']


def test_no_outage_assumption_without_outages():
    out = recommend_berth_plan(make_inputs([berth('X')], [ship('a', h(0), 12000)]))
    assert '정비 일정: 예시값' not in out['assumptions']


def test_no_targets_still_lists_berths_and_outages():
    out = recommend_berth_plan(make_inputs([berth('X')], [], outages=[Outage('X', h(1), h(5))]))
    assert out['options'] == [] and out['berths'] == [{'id': 'X', 'yards': ['1']}]
    assert out['outages'] == [{'berth': 'X', 'start': h(1).isoformat(), 'end': h(5).isoformat(), 'reason': None}]
