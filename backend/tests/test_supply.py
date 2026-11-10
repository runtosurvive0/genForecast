from datetime import timedelta

import pytest

from midterm.fleet import load_coal_units
from midterm.supply import DEFAULTS, GROUPS, UNITS, simulate, timestamp, unloading

START = timestamp('2026-10-08T00:00:00+09:00')


def records():
    return {'config': {**DEFAULTS, 'heat_rates': dict.fromkeys(UNITS, 2000)},
            'baselines': [{'id': i, 'group_id': g, 'at': START.isoformat(), 'tonnes': 100000.,
                           'cv': 5500., 'moisture': 10, 'ash': 10, 'sulfur': .5}
                          for i, g in enumerate(GROUPS)], 'vessels': [], 'transfers': []}


def plan(days=15, mw=55.):
    return {(START + timedelta(hours=i)).isoformat():
            {u: {'mw': mw, 'online': mw > 0} for u in UNITS} for i in range(days * 24)}


def vessel():
    return {'id': 1, 'cargo': 1000., 'incoming_cv': 6500., 'arrival_at': START.isoformat(),
            'points': [{'at': START.isoformat(), 'cumulative': 0., 'rate': 100.,
                        'allocations': {'g14': 1., 'g58': 0., 'g910': 0.}}]}


def test_unloading_caps_at_cargo_and_future_allocation_keeps_prior_receipts():
    v = vessel()
    v['points'].append({'at': (START + timedelta(hours=3)).isoformat(), 'cumulative': 300., 'rate': 100.,
                        'allocations': {'g14': 0., 'g58': 1., 'g910': 0.}})
    assert unloading(v, START + timedelta(hours=2))['allocated']['g14'] == 200
    at_five = unloading(v, START + timedelta(hours=5))
    assert at_five['allocated'] == {'g14': 300., 'g58': 200., 'g910': 0.}
    final = unloading(v, START + timedelta(hours=30))
    assert final['cumulative'] == 1000
    assert final['allocated'] == {'g14': 300., 'g58': 700., 'g910': 0.}


def test_manual_cumulative_correction_is_applied_at_correction_time_and_can_pause():
    v = vessel()
    v['points'].append({'at': (START + timedelta(hours=3)).isoformat(), 'cumulative': 250., 'rate': 0.,
                        'allocations': {'g14': 1., 'g58': 0., 'g910': 0.}})
    assert unloading(v, START + timedelta(hours=2))['cumulative'] == 200
    assert unloading(v, START + timedelta(hours=3))['cumulative'] == 250
    assert unloading(v, START + timedelta(hours=20))['cumulative'] == 250


def test_transfer_conserves_mass_and_calorific_energy():
    r = records()
    r['baselines'][1]['cv'] = 6500
    r['transfers'] = [{'id': 1, 'at': START.isoformat(), 'from_group': 'g14', 'to_group': 'g58', 'tonnes': 10000.}]
    output = simulate(r, plan(mw=0), START, 7)
    g = {x['id']: x for x in output['groups']}
    assert sum(x['stock'] for x in g.values()) == 300000
    before = 100000 * (5500 + 6500 + 5500)
    after = sum(x['stock'] * x['cv'] for x in g.values())
    assert after == pytest.approx(before)
    assert g['g58']['cv'] == pytest.approx((100000 * 6500 + 10000 * 5500) / 110000)


def test_yard_baseline_with_unknown_quality_never_publishes_estimated_burn():
    r = records()
    r['baselines'][0]['cv'] = None
    result = simulate(r, plan(), START, 7)
    group = result['groups'][0]
    assert group['baseline']['tonnes'] == 100000
    assert group['stock'] is None and group['cv'] is None
    assert result['forecast'][0]['groups']['g14']['burn'] is None
    assert any('발열량 확인 필요' in issue for issue in result['transfer_issues'])


def test_dated_yard_snapshots_feed_supply_without_same_day_receipt(tmp_path):
    from midterm.stock_baseline import save_baseline
    from midterm.supply import read_supply
    path = tmp_path / 'stock.sqlite3'
    save_baseline({'as_of':'2026-10-06', 'lots':[
        {'location':'P1', 'coal_name':'A', 'tonnes':100},
        {'location':'P5', 'coal_name':'B', 'tonnes':200},
        {'location':'A2', 'coal_name':'C', 'tonnes':300}]}, 0, 'operator', path)
    save_baseline({'as_of':'2026-10-09', 'lots':[
        {'location':'P1', 'coal_name':'A', 'tonnes':999}]}, 1, 'operator', path)
    r = read_supply(path)
    earlier = simulate(r, {}, START, 1)
    groups = {g['id']: g for g in earlier['groups']}
    assert [groups[g]['baseline']['tonnes'] for g in GROUPS] == [100, 200, 300]
    assert groups['g14']['baseline']['at'].startswith('2026-10-07T00:00:00')
    assert all(groups[g]['cv'] is None for g in GROUPS)


def test_yard_quality_requires_unique_matching_confirmed_dated_assays(tmp_path):
    from midterm.stock_baseline import save_baseline
    from midterm.voyage_registry import commit
    from midterm.supply import read_supply
    path = tmp_path / 'stock.sqlite3'
    commit({'voyages':[{'voyage_no':'V1', 'voyage_number':'26-1-001', 'berth_id':'BD-1', 'status':'planned'}],
            'cargo':[{'cargo_no':'C1','voyage_no':'V1','destination_plant_id':'dangjin','coal_name':'A','planned_t':100}],
            'assays':[{'assay_id':'A1','cargo_no':'C1','stage':'loading','result_status':'confirmed','analysis_date':'2026-10-05','gcv_arb':5500},
                      {'assay_id':'A2','cargo_no':'C1','stage':'unloading','result_status':'confirmed','analysis_date':'2026-10-09','gcv_arb':6000}]}, 0, 'operator', 'manual', path)
    save_baseline({'as_of':'2026-10-06','lots':[{'location':'P1','coal_name':'A','voyage_number':'26-1-001','tonnes':100}]}, 0, 'operator', path)
    b = next(row for row in read_supply(path)['baselines'] if row['group_id'] == 'g14')
    assert b['cv'] == 5500


def test_unload_mixes_yard_cv_and_burn_uses_mixed_cv():
    r = records()
    r['vessels'] = [vessel()]
    r['baselines'][0]['tonnes'] = 1000.
    output = simulate(r, plan(), START + timedelta(hours=1), 7)
    g = output['groups'][0]
    mixed_cv = (1000 * 5500 + 100 * 6500) / 1100
    assert g['cv'] == pytest.approx(mixed_cv)
    assert g['stock'] == pytest.approx(1100 - 4 * 55 * 2000 / mixed_cv)


def test_seven_thousand_daily_unloading_reconciles_inventory_partial_days_and_cargo_caps():
    r = records()
    r['vessels'] = []
    for i, (group, cargo, delay) in enumerate(zip(GROUPS, [80000, 9000, 3000], [0, 12, 24])):
        v = {**vessel(), 'id': i + 1, 'cargo': cargo, 'incoming_cv': 5500, 'berth_id': f'BD-{i + 1}'}
        v['points'] = [{'at': (START + timedelta(hours=delay)).isoformat(), 'cumulative': 0,
                        'rate': 7000 / 24, 'allocations': {g: float(g == group) for g in GROUPS}}]
        r['vessels'].append(v)
    output = simulate(r, plan(), START, 7)
    assert output['kpis']['stock'] == 300000
    first = output['forecast'][0]['groups']
    assert [first[g]['receipts'] for g in GROUPS] == pytest.approx([7000, 3500, 0])
    for g in GROUPS:
        previous = 100000
        for row in output['forecast']:
            day = row['groups'][g]
            assert day['stock'] == pytest.approx(previous + day['receipts'] - day['burn'])
            previous = day['stock']
    assert [sum(row['groups'][g]['receipts'] for row in output['forecast']) for g in GROUPS] == pytest.approx([49000, 9000, 3000])
    assert [v['unloading_rate_tpd'] for v in output['vessels']] == pytest.approx([7000, 0, 0])
    assert [v['today_receipts'] for v in output['vessels']] == pytest.approx([7000, 3500, 0])
    later = simulate(r, plan(), START + timedelta(days=2), 7)
    assert later['vessels'][1]['remaining'] == 0 and later['vessels'][1]['unloading_rate_tpd'] == 0
    assert later['groups'][1]['received'] == pytest.approx(9000)


def test_rebase_counts_only_events_after_new_baseline():
    r = records()
    r['vessels'] = [vessel()]
    r['baselines'].append({**r['baselines'][0], 'at': (START + timedelta(hours=2)).isoformat(), 'tonnes': 5000., 'cv': 6000.})
    output = simulate(r, plan(mw=0), START + timedelta(hours=3), 7)
    g = output['groups'][0]
    assert g['stock'] == pytest.approx(5100)
    assert g['received'] == pytest.approx(100)
    assert g['delta'] == pytest.approx(100)
    assert g['cv'] == pytest.approx((5000 * 6000 + 100 * 6500) / 5100)


def test_registry_actual_receipt_is_counted_once_after_baseline_and_rebase():
    r = records()
    r['registry_receipts'] = [{'cargo_no': 'C1', 'group': 'g14', 'at': (START + timedelta(hours=1)).isoformat(),
                               'tonnes': 1000., 'cv': 6000., 'mmsi': None, 'vessel_name': None, 'needs_review': False}]
    result = simulate(r, plan(mw=0), START + timedelta(hours=2), 7)
    assert result['groups'][0]['stock'] == pytest.approx(101000)
    assert result['groups'][0]['received'] == pytest.approx(1000)
    r['baselines'].append({**r['baselines'][0], 'at': (START + timedelta(hours=1)).isoformat(), 'tonnes': 99000.})
    result = simulate(r, plan(mw=0), START + timedelta(hours=2), 7)
    assert result['groups'][0]['stock'] == pytest.approx(99000)
    assert result['groups'][0]['received'] == pytest.approx(0)


def test_registry_receipt_without_assay_or_duplicate_vessel_makes_forecast_unknown():
    r = records()
    event = {'cargo_no': 'C1', 'group': 'g14', 'at': (START + timedelta(hours=1)).isoformat(),
             'tonnes': 1000., 'cv': None, 'mmsi': '123456789', 'vessel_name': None, 'needs_review': False}
    r['registry_receipts'] = [event]
    assert simulate(r, plan(mw=0), START + timedelta(hours=2), 7)['groups'][0]['stock'] is None
    r['vessels'] = [{**vessel(), 'mmsi': '123456789'}]
    event['cv'] = 6000.
    result = simulate(r, plan(mw=0), START + timedelta(hours=2), 7)
    assert result['groups'][0]['stock'] is None
    assert any('중복' in issue for issue in result['transfer_issues'])


def test_manual_pile_balance_change_does_not_invent_group_burn_allocation():
    r = records()
    r['registry_receipts'] = [{'cargo_no': 'C1', 'group': 'g14', 'at': (START + timedelta(hours=1)).isoformat(),
                               'tonnes': 1000., 'cv': 6000., 'mmsi': None, 'vessel_name': None, 'needs_review': False,
                               'balance_updated_at': (START + timedelta(hours=2)).isoformat(), 'remaining_t': 700.}]
    result = simulate(r, plan(mw=0), START + timedelta(hours=3), 7)
    assert result['groups'][0]['stock'] is None
    assert any('잔량' in issue for issue in result['transfer_issues'])


def test_pile_reconciliation_preserves_previous_view_and_requires_new_baseline_for_both_groups():
    r = records()
    original = {'cargo_no':'C1','group':'g14','at':(START + timedelta(hours=1)).isoformat(),
                'tonnes':1000.,'cv':5500.,'mmsi':None,'vessel_name':None,'needs_review':False}
    moved = {**original,'group':'g58'}
    r['registry_receipts'] = [moved]
    r['registry_reconciliations'] = [{'cargo_no':'C1','at':(START + timedelta(hours=3)).isoformat(),
                                      'groups':['g14','g58'],'before':[original]}]
    before = simulate(r, plan(mw=0), START + timedelta(hours=2), 7)
    assert before['groups'][0]['stock'] == 101000
    assert before['groups'][1]['stock'] == 100000
    after = simulate(r, plan(mw=0), START + timedelta(hours=4), 7)
    assert after['groups'][0]['stock'] is None and after['groups'][1]['stock'] is None
    assert any('정정' in message for message in after['transfer_issues'])
    for i in (0, 1):
        r['baselines'].append({**r['baselines'][i], 'at':(START + timedelta(hours=3, minutes=30)).isoformat(), 'tonnes':99000.})
    rebased = simulate(r, plan(mw=0), START + timedelta(hours=4), 7)
    assert [rebased['groups'][i]['stock'] for i in (0,1)] == [99000,99000]


def test_pile_multiple_reconciliations_roll_back_in_order_for_historical_views():
    r = records()
    original = {'cargo_no':'C1','group':'g14','at':(START + timedelta(hours=1)).isoformat(),
                'tonnes':1000.,'cv':5500.,'mmsi':None,'vessel_name':None,'needs_review':False}
    middle = {**original, 'group':'g58'}
    current = {**original, 'group':'g910'}
    r['registry_receipts'] = [current]
    r['registry_reconciliations'] = [
        {'cargo_no':'C1','at':(START + timedelta(hours=3)).isoformat(),'groups':['g14','g58'],'before':[original]},
        {'cargo_no':'C1','at':(START + timedelta(hours=5)).isoformat(),'groups':['g58','g910'],'before':[middle]},
    ]
    before = simulate(r, plan(mw=0), START + timedelta(hours=2), 7)
    assert [x['stock'] for x in before['groups']] == [101000,100000,100000]
    middle_view = simulate(r, plan(mw=0), START + timedelta(hours=4), 7)
    assert middle_view['groups'][2]['stock'] == 100000


def test_source_rebase_after_transfer_does_not_lose_destination_transfer_cv():
    r = records()
    r['baselines'][1]['cv'] = 6500
    r['transfers'] = [{'id': 1, 'at': (START + timedelta(hours=1)).isoformat(),
                       'from_group': 'g14', 'to_group': 'g58', 'tonnes': 10000.}]
    r['baselines'].append({**r['baselines'][0], 'at': (START + timedelta(hours=2)).isoformat(), 'tonnes': 90000., 'cv': 6000.})
    output = simulate(r, plan(mw=0), START + timedelta(hours=3), 7)
    g = {x['id']: x for x in output['groups']}
    assert g['g58']['stock'] == 110000
    assert g['g58']['cv'] == pytest.approx((100000 * 6500 + 10000 * 5500) / 110000)
    assert g['g14']['stock'] == 90000


def test_missing_plan_hour_is_not_zero_burn_or_normal_risk():
    r, p = records(), plan()
    del p[(START + timedelta(hours=1)).isoformat()]['당진1']
    output = simulate(r, p, START + timedelta(hours=2), 7)
    g = output['groups'][0]
    assert g['stock'] is None
    assert g['risk'] == 'unknown'
    assert g['today_burn'] is None
    assert output['kpis']['risk'] == 'unknown'


def test_baseline_one_day_before_plan_start_keeps_stock_and_warns_once():
    r = records()
    for b in r['baselines']:
        b['at'] = (START - timedelta(days=1)).isoformat()
        b['source_date'] = '2026-10-06'
    output = simulate(r, plan(), START + timedelta(hours=2), 7)
    hourly = 10 * 55 * 2000 / 5500  # 처별 시간당 사용량 합(모든 호기 동일)
    for g in output['groups']:
        names = [u for u in UNITS if UNITS[u] == g['id']]
        assert g['stock'] == pytest.approx(100000 - 2 * len(names) * 55 * 2000 / 5500)
        assert g['days'] is not None
    assert output['kpis']['stock'] == pytest.approx(300000 - 2 * hourly)
    assert output['plan_issues'] == ['기준재고(2026-10-06) 이후 계획 시작(2026-10-08) 전 24시간 사용량 미반영']
    # 계획 공백일의 사용량은 0으로 확정하지 않는다.
    earlier = simulate(r, plan(), START - timedelta(hours=12), 7)
    assert earlier['forecast'][0]['groups']['g14']['burn'] is None
    assert earlier['forecast'][0]['groups']['g14']['stock'] == pytest.approx(100000)


def test_missing_unit_row_after_plan_start_still_unknown_with_early_baseline():
    r, p = records(), plan()
    for b in r['baselines']:
        b['at'] = (START - timedelta(days=1)).isoformat()
    del p[(START + timedelta(hours=1)).isoformat()]['당진1']
    output = simulate(r, p, START + timedelta(hours=2), 7)
    groups = {g['id']: g for g in output['groups']}
    assert groups['g14']['stock'] is None and groups['g14']['risk'] == 'unknown'
    assert groups['g58']['stock'] is not None


def test_empty_plan_does_not_count_as_plan_gap():
    output = simulate(records(), {}, START + timedelta(hours=2), 7)
    assert all(g['stock'] is None for g in output['groups'])
    assert output['plan_issues'] == []


def test_missing_extra_seven_days_prevents_false_safe_risk():
    output = simulate(records(), plan(days=7), START, 7)
    assert output['groups'][0]['min_days'] is None
    assert output['kpis']['risk'] == 'unknown'


def test_risk_uses_future_minimum_and_worst_group_not_total_stock():
    r = records()
    r['baselines'][0]['tonnes'] = 26000
    output = simulate(r, plan(), START, 7)
    g = output['groups'][0]
    assert g['days'] == pytest.approx(26000 / 1920)
    assert g['min_days'] == pytest.approx((26000 - 7 * 1920) / 1920)
    assert g['risk'] == 'danger'
    assert output['kpis']['risk'] == 'danger'
    assert output['kpis']['stock'] == 226000


def test_stale_baseline_cannot_be_normal():
    r = records()
    r['config']['baseline_stale_hours'] = 1
    output = simulate(r, plan(), START + timedelta(hours=2), 7)
    assert all(g['stale'] and g['risk'] == 'unknown' for g in output['groups'])


def test_kst_and_utc_same_instant_and_partial_hour_burn():
    r, p = records(), plan()
    a = simulate(r, p, '2026-10-08T00:30:00+09:00', 7)
    b = simulate(r, p, '2026-10-07T15:30:00Z', 7)
    assert a['kpis']['stock'] == b['kpis']['stock'] == pytest.approx(300000 - 10 * 55 * 2000 / 5500 * .5)


def test_hourly_quadratic_heat_works_without_manual_hr():
    r = records()
    r['config']['heat_rates'] = {}
    master = {u.name: u for u in load_coal_units() if u.is_dangjin}
    output = simulate(r, plan(mw=100), START + timedelta(hours=1), 7)
    expected = sum((master[u].heat[0] * 100**2 + master[u].heat[1] * 100 + master[u].heat[2]) * 1000/5500 for u in UNITS)
    assert output['kpis']['stock'] == pytest.approx(300000 - expected)


def test_exhausted_stock_reports_zero_days_not_negative_days():
    r = records()
    r['baselines'][0]['tonnes'] = 5000  # 1,920 t/일이면 사흘 안에 소진
    output = simulate(r, plan(), START, 7)
    g = output['groups'][0]
    assert g['min_days'] == 0
    assert g['min_stock'] == 0  # 재고는 0에서 멈추고
    assert g['shortage'] == pytest.approx(7 * 1920 - 5000)  # 못 태운 양은 부족량으로 따로 남는다
    assert g['exhausted_on'] == '2026-10-10'
    assert g['risk'] == 'danger'
    assert all(p['groups']['g14']['days'] >= 0 for p in output['forecast'])
    assert all(p['groups']['g14']['stock'] >= 0 for p in output['forecast'])
    assert [p['groups']['g14']['shortage'] for p in output['forecast'][:4]] == pytest.approx([0, 0, 760, 1920])
    assert output['kpis']['min_days'] == 0


def test_receipt_after_exhaustion_refills_from_zero_not_from_a_deficit():
    r = records()
    r['baselines'][0]['tonnes'] = 1000
    r['registry_planned'] = [{'cargo_no': 'P1', 'group': 'g14', 'at': (START + timedelta(days=3)).isoformat(),
                              'tonnes': 10000., 'cv': 5500., 'vessel_name': 'PLAN ONE', 'mmsi': None}]
    output = simulate(r, plan(), START, 7)
    day3 = output['forecast'][3]['groups']['g14']
    assert day3['receipts'] == 10000
    assert day3['stock'] == pytest.approx(10000 - 1920)


def test_planned_registry_voyage_adds_expected_receipt_after_as_of():
    r = records()
    at = START + timedelta(days=2, hours=6)
    r['registry_planned'] = [{'cargo_no': 'P1', 'group': 'g58', 'at': at.isoformat(), 'tonnes': 80000.,
                              'cv': 6000., 'vessel_name': 'PLAN ONE', 'mmsi': None}]
    base = simulate(records(), plan(), START, 7)
    output = simulate(r, plan(), START, 7)
    day = lambda o, i: o['forecast'][i]['groups']['g58']
    assert day(output, 2)['receipts'] == 80000
    assert day(output, 1)['stock'] == pytest.approx(day(base, 1)['stock'])
    # 고열량탄이 섞여 같은 발전량에 덜 태우므로 기본 + 입하량보다 조금 많이 남는다.
    assert day(output, 2)['stock'] > day(base, 2)['stock'] + 80000
    assert day(output, 2)['stock'] < day(base, 2)['stock'] + 80000 + 1920
    g = {x['id']: x for x in output['groups']}
    assert g['g58']['expected_receipts'] == 80000
    assert g['g58']['planned_receipts'] == 80000
    assert day(output, 3)['cv'] > 5500  # 고열량 입하가 섞인다


def test_planned_receipt_without_calorific_value_is_skipped_and_reported():
    r = records()
    r['registry_planned'] = [{'cargo_no': 'P2', 'group': 'g14', 'at': (START + timedelta(days=1)).isoformat(),
                              'tonnes': 50000., 'cv': None, 'vessel_name': 'NO CV', 'mmsi': None}]
    output = simulate(r, plan(), START, 7)
    assert output['forecast'][1]['groups']['g14']['receipts'] == 0
    assert output['forecast'][3]['groups']['g14']['stock'] is not None
    assert any('P2' in issue and '계획 입하' in issue for issue in output['transfer_issues'])


def test_planned_receipt_in_the_past_is_not_counted():
    r = records()
    r['registry_planned'] = [{'cargo_no': 'P3', 'group': 'g14', 'at': (START + timedelta(hours=1)).isoformat(),
                              'tonnes': 50000., 'cv': 5500., 'vessel_name': 'LATE', 'mmsi': None}]
    output = simulate(r, plan(), START + timedelta(days=1), 5)
    assert all(p['groups']['g14']['receipts'] == 0 for p in output['forecast'])
    assert any('P3' in issue and '하역완료 예정이 지났' in issue for issue in output['transfer_issues'])


def test_planned_receipts_from_registry_skip_received_cancelled_and_other_plants():
    from midterm.supply import planned_receipts
    v = lambda no, status, yard, end, ship, cls='actual': {
        'voyage_no': no, 'status': status, 'classification': cls, 'yard': yard,
        'planned_unload_end': end, 'actual_unload_end': None, 'ship_code': ship}
    registry = {
        'voyages': [
            v('V1', 'planned', '2', '2026-11-14T06:00:00+09:00', 'S1'),
            v('V2', 'cancelled', '1', '2026-11-15T06:00:00+09:00', 'S1'),
            v('V3', 'planned', '1', '2026-11-15T06:00:00+09:00', 'S1', 'simulation'),
            v('V4', 'underway', '3', '2026-11-16T06:00:00+09:00', 'S2'),
            v('V5', 'planned', None, '2026-11-17T06:00:00+09:00', 'S2'),
        ],
        'cargo': [
            {'cargo_no': 'C1', 'voyage_no': 'V1', 'destination_plant_id': 'dangjin', 'bl_t': 80000, 'planned_t': 81000,
             'received_t': None, 'cv': 5900, 'cv_basis': 'GAR'},
            {'cargo_no': 'C2', 'voyage_no': 'V2', 'destination_plant_id': 'dangjin', 'bl_t': 80000, 'received_t': None, 'cv': 5900},
            {'cargo_no': 'C3', 'voyage_no': 'V3', 'destination_plant_id': 'dangjin', 'bl_t': 80000, 'received_t': None, 'cv': 5900},
            {'cargo_no': 'C4', 'voyage_no': 'V4', 'destination_plant_id': 'taean', 'bl_t': 80000, 'received_t': None, 'cv': 5900},
            {'cargo_no': 'C4b', 'voyage_no': 'V4', 'destination_plant_id': 'dangjin', 'bl_t': None, 'planned_t': 60000,
             'received_t': None, 'cv': 4800, 'cv_basis': 'NAR'},
            {'cargo_no': 'C5', 'voyage_no': 'V5', 'destination_plant_id': 'dangjin', 'bl_t': 70000, 'received_t': None, 'cv': 5000},
        ],
        'ships': [{'ship_code': 'S1', 'name': 'ONE', 'mmsi': '440000001'}, {'ship_code': 'S2', 'name': 'TWO', 'mmsi': None}],
    }
    rows = planned_receipts(registry, received={'C1-old'})
    assert [(r['cargo_no'], r['group'], r['tonnes'], r['cv']) for r in rows] == [
        ('C1', 'g58', 80000, 5900), ('C4b', 'g910', 60000, None), ('C5', None, 70000, 5000)]
    assert rows[0]['vessel_name'] == 'ONE' and rows[0]['mmsi'] == '440000001'
    assert rows[0]['at'] == '2026-11-14T06:00:00+09:00'
    assert planned_receipts(registry, received={'C1'})[0]['cargo_no'] == 'C4b'


def test_planned_receipt_without_yard_is_reported_not_guessed():
    r = records()
    r['registry_planned'] = [{'cargo_no': 'P4', 'group': None, 'at': (START + timedelta(days=1)).isoformat(),
                              'tonnes': 50000., 'cv': 5500., 'vessel_name': 'NO YARD', 'mmsi': None}]
    output = simulate(r, plan(), START, 7)
    assert all(p['groups'][g]['receipts'] == 0 for p in output['forecast'] for g in GROUPS)
    assert any('P4' in issue and '저탄장' in issue for issue in output['transfer_issues'])


def test_old_supply_vessel_does_not_hide_planned_receipts_of_an_unnamed_ship():
    """ZGX에서 10-06 입항 시험 선박(이름·MMSI 없음 판정 창 60일)이 그 뒤 계획 입하를 모두 지웠던 회귀."""
    r = records()
    old = {**vessel(), 'name': 'Pacific Horizon', 'mmsi': None, 'classification': 'planned',
           'arrival_at': (START - timedelta(days=2)).isoformat()}
    old['points'] = [{**old['points'][0], 'at': old['arrival_at']}]
    r['vessels'] = [old]
    at = START + timedelta(days=1, hours=6)
    r['registry_planned'] = [{'cargo_no': 'P1', 'group': 'g58', 'at': at.isoformat(), 'tonnes': 70000.,
                              'cv': 5600., 'vessel_name': None, 'mmsi': None}]
    output = simulate(r, plan(), START, 5)
    assert output['forecast'][1]['groups']['g58']['receipts'] == 70000
    assert not any('P1' in issue for issue in output['transfer_issues'])
    # 같은 배로 확인되면 여전히 중복으로 뺀다.
    r['registry_planned'][0]['vessel_name'] = 'PACIFIC HORIZON'
    again = simulate(r, plan(), START, 5)
    assert again['forecast'][1]['groups']['g58']['receipts'] == 0
    assert any('P1' in issue and '같은 배' in issue for issue in again['transfer_issues'])
