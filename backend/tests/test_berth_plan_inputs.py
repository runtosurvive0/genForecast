from datetime import timedelta

import pytest

from midterm import supply
from midterm.berth_plan import inputs as bp
from midterm.berth_plan.inputs import (StockSeries, build_inputs, load_berths, read_stock, unload_hours)
from midterm.supply import timestamp
from midterm.web.supply_api import DashboardInputError, PlanNotFound

AS_OF = timestamp('2026-11-10T09:30:00+09:00')


def voyage(no, status, **kw):
    base = {'voyage_no': no, 'voyage_number': '26-1-' + no[-3:], 'ship_code': 'S1', 'status': status,
            'classification': 'actual', 'yard': '2', 'planned_arrival': '2026-11-12T08:00:00+09:00',
            'laytime_hours': 72, 'demurrage_usd_per_day': 20000, 'berth_id': None}
    return {**base, **kw}


def cargo(no, voyage_no, plant='dangjin', **kw):
    return {'cargo_no': no, 'voyage_no': voyage_no, 'destination_plant_id': plant, 'bl_t': 40000., 'planned_t': 39000.,
            **kw}


def registry(**extra):
    return {'ships': [{'ship_code': 'S1', 'name': '가나다호'}],
            'voyages': [voyage('V-PLAN', 'planned'), voyage('V-WAY', 'underway'), voyage('V-ARR', 'arrived'),
                        voyage('V-BERTH', 'berthed', berth_id='BD-1', planned_unload_end='2026-11-11T12:00:00+09:00'),
                        voyage('V-DONE', 'completed'), voyage('V-SIM', 'planned', classification='simulation')],
            'cargo': [cargo(f'C-{n}', n) for n in ('V-PLAN', 'V-WAY', 'V-ARR', 'V-BERTH', 'V-DONE', 'V-SIM')]
                     + [cargo('C-OTHER', 'V-PLAN', plant='boryeong', bl_t=5000.)],
            'assays': [], **extra}


def build(reg=None, **kw):
    berths, outages = load_berths()
    args = dict(stock=None, as_of=AS_OF, horizon_days=14)
    args.update(kw)
    return build_inputs(reg or registry(), berths, outages, args.pop('stock'), args.pop('as_of'),
                        args.pop('horizon_days'), **args)


def kinds(result, kind):
    return [g for g in result.gaps if g['kind'] == kind]


def test_load_berths_reads_dummy_file():
    berths, outages = load_berths()
    assert berths['BD-1'].unload_tph == 1800
    assert berths['BD-1'].yards == ('1', '2')
    assert len(outages) == 1
    assert outages[0].berth == 'BD-2'
    assert outages[0].start == timestamp('2026-11-20T08:00:00+09:00')
    assert outages[0].end == timestamp('2026-11-21T20:00:00+09:00')


def test_unload_hours():
    berths, _ = load_berths()
    assert unload_hours(36000, berths['BD-1']) == 24
    assert unload_hours(1, berths['BD-3']) == 1


def test_targets_and_fixed_selection():
    result = build()
    assert {v.voyage_no for v in result.voyages} == {'V-PLAN', 'V-WAY', 'V-ARR'}
    assert [f.voyage_no for f in result.fixed] == ['V-BERTH']
    assert result.fixed[0].berth == 'BD-1'
    assert result.fixed[0].until == timestamp('2026-11-11T12:00:00+09:00')
    far = registry()
    far['voyages'][0]['planned_arrival'] = '2026-11-25T09:31:00+09:00'
    assert 'V-PLAN' not in {v.voyage_no for v in build(far).voyages}
    edge = registry()
    edge['voyages'][0]['planned_arrival'] = '2026-11-24T09:30:00+09:00'
    assert 'V-PLAN' in {v.voyage_no for v in build(edge).voyages}


def test_times_are_hour_ceiling_and_kst_midnight():
    result = build()
    assert result.t0 == timestamp('2026-11-10T10:00:00+09:00')
    assert result.midnight == timestamp('2026-11-10T00:00:00+09:00')
    assert build(as_of=timestamp('2026-11-10T09:00:00+09:00')).t0 == timestamp('2026-11-10T09:00:00+09:00')


def test_tonnes_use_bl_then_planned_dangjin_only():
    reg = registry()
    reg['cargo'] += [cargo('C-X', 'V-PLAN', bl_t=None, planned_t=3000.)]
    by_no = {v.voyage_no: v for v in build(reg).voyages}
    assert by_no['V-PLAN'].tonnes == 43000.
    assert by_no['V-WAY'].tonnes == 40000.


def test_missing_eta_and_tonnes_go_to_gaps():
    reg = registry()
    reg['voyages'][0]['planned_arrival'] = None
    reg['cargo'] = [c for c in reg['cargo'] if c['voyage_no'] != 'V-WAY'] + [
        cargo('C-ZERO', 'V-WAY', bl_t=None, planned_t=0)]
    result = build(reg)
    assert [g['voyage_no'] for g in kinds(result, 'no_eta')] == ['V-PLAN']
    assert [g['voyage_no'] for g in kinds(result, 'no_tonnes')] == ['V-WAY']
    assert {v.voyage_no for v in result.voyages} == {'V-ARR'}


def test_yard_limits_allowed_berths():
    reg = registry()
    reg['voyages'][0]['yard'] = '3'
    reg['voyages'][1]['yard'] = None
    by_no = {v.voyage_no: v for v in build(reg).voyages}
    assert by_no['V-PLAN'].allowed == ('BD-2', 'BD-3')
    assert by_no['V-PLAN'].group == 'g910'
    assert by_no['V-WAY'].allowed == ('BD-1', 'BD-2', 'BD-3')
    assert [g['voyage_no'] for g in kinds(build(reg), 'no_yard')] == ['V-WAY']


def test_missing_demurrage_kept_with_gap():
    reg = registry()
    reg['voyages'][0]['demurrage_usd_per_day'] = None
    result = build(reg)
    assert 'V-PLAN' in {v.voyage_no for v in result.voyages}
    assert [g['voyage_no'] for g in kinds(result, 'no_demurrage')] == ['V-PLAN']


def test_fixed_without_end_blocks_to_grid_end():
    reg = registry()
    reg['voyages'][3]['planned_unload_end'] = None
    result = build(reg)
    assert result.fixed[0].until is None
    assert [g['voyage_no'] for g in kinds(result, 'fixed_end_unknown')] == ['V-BERTH']


def test_vessel_size_gap_once():
    gaps = kinds(build(), 'no_vessel_size')
    assert len(gaps) == 1
    assert gaps[0]['message'] == '선형 제한 미적용(선박 제원 없음)'


def test_stock_unknown_gap():
    result = build(stock=None, stock_gap='기준재고 없음')
    assert len(kinds(result, 'stock_unknown')) == 1
    assert '기준재고 없음' in kinds(result, 'stock_unknown')[0]['message']
    assert not kinds(build(stock=StockSeries({}, {})), 'stock_unknown')


def test_current_plan_fields_carried():
    reg = registry()
    reg['voyages'][0].update(berth_id='BD-2', planned_berth='2026-11-12T10:00:00+09:00',
                             planned_unload_end='2026-11-13T10:00:00+09:00')
    v = next(v for v in build(reg).voyages if v.voyage_no == 'V-PLAN')
    assert (v.current_berth, v.vessel_name) == ('BD-2', '가나다호')
    assert v.current_berth_at == timestamp('2026-11-12T10:00:00+09:00')
    assert v.current_unload_end == timestamp('2026-11-13T10:00:00+09:00')


def fake_dashboard(burn=100., stale=False, hole=False, days=40):
    def make(horizon, at, plan_key, adjust=None):
        data = {'registry_planned': [{'voyage_no': 'V-A', 'tonnes': 1}, {'voyage_no': 'V-B', 'tonnes': 2}]}
        data, _ = adjust(data, {})
        make.seen = [r['voyage_no'] for r in data['registry_planned']]
        make.horizon = horizon
        forecast = []
        for d in range(days):
            groups = {g: {'stock': 1000. + d, 'burn': burn + d} for g in supply.GROUPS}
            if hole and d == 3:
                groups['g58']['burn'] = None
            forecast.append({'day': str(d), 'groups': groups})
        return {'forecast': forecast, 'groups': [{'id': g, 'stale': stale} for g in supply.GROUPS],
                'config': {'danger_days': 6., 'normal_days': 12.}}
    return make


def test_read_stock_excludes_targets_and_averages_next_seven_days(monkeypatch):
    fake = fake_dashboard()
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard', fake)
    stock, reason, result = read_stock(AS_OF, 14, {'V-A'})
    assert reason is None and result['config']['danger_days'] == 6.
    assert fake.seen == ['V-B']
    assert fake.horizon == 30
    assert len(stock.base['g14']) == 14 == len(stock.denom['g14'])
    assert stock.base['g14'][2] == 1002.
    assert stock.denom['g14'][0] == pytest.approx(sum(100 + d for d in range(1, 8)) / 7)


def test_read_stock_uses_60_days_for_long_horizon(monkeypatch):
    fake = fake_dashboard(days=60)
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard', fake)
    stock, _, _ = read_stock(AS_OF, 30, set())
    assert fake.horizon == 60 and len(stock.base['g58']) == 30


@pytest.mark.parametrize('kwargs', [{'stale': True}, {'hole': True}])
def test_read_stock_returns_none_with_reason(monkeypatch, kwargs):
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard', fake_dashboard(**kwargs))
    stock, reason, result = read_stock(AS_OF, 14, set())
    assert stock is None and reason and 'forecast' in result


def test_load_inputs_excludes_targets_then_builds(monkeypatch, tmp_path):
    reg = registry()
    seen = {}

    def fake_read(as_of, horizon_days, exclude):
        seen['exclude'] = exclude
        return None, '기준재고 없음', {}

    monkeypatch.setattr('midterm.voyage_registry.snapshot', lambda path: reg)
    monkeypatch.setattr(bp, 'read_stock', fake_read)
    result = bp.load_inputs(tmp_path / 'x.sqlite3', AS_OF, 14)
    assert seen['exclude'] == {'V-PLAN', 'V-WAY', 'V-ARR'}
    assert result.danger_days == supply.DEFAULTS['danger_days']
    assert kinds(result, 'stock_unknown')
    assert result.t0 - result.as_of < timedelta(hours=1)


@pytest.mark.parametrize('error', [DashboardInputError('전망 기간 오류'), PlanNotFound('계획 없음')])
def test_read_stock_degrades_when_dashboard_fails(monkeypatch, error):
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr('midterm.web.supply_api.build_dashboard', fail)
    stock, reason, result = read_stock(AS_OF, 14, set())
    assert stock is None and str(error) in reason and result == {}
