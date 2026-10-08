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


def test_unload_mixes_yard_cv_and_burn_uses_mixed_cv():
    r = records()
    r['vessels'] = [vessel()]
    r['baselines'][0]['tonnes'] = 1000.
    output = simulate(r, plan(), START + timedelta(hours=1), 7)
    g = output['groups'][0]
    mixed_cv = (1000 * 5500 + 100 * 6500) / 1100
    assert g['cv'] == pytest.approx(mixed_cv)
    assert g['stock'] == pytest.approx(1100 - 4 * 55 * 2000 / mixed_cv)


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
