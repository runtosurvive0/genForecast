import copy
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from midterm.dummy_data.generate import FUTURE_DAILY_T, FUTURE_DAYS, generate as _generate
from midterm.dummy_data.profiles import load_berths, load_profiles
from midterm.dummy_data.quality import check_assay
from midterm.voyage_registry import SCHEMA, commit, snapshot

FIXTURE = Path(__file__).parent / 'fixtures' / 'dummy_registry_snapshot.json'
ALL_101_NUMBERS = {f'26-{berth}-{serial:03}' for berth, last in ((1, 41), (2, 22), (3, 38))
                   for serial in range(1, last + 1)}
SYSTEM = {'data_origin', 'dummy_fields'}
TIMES = ('departure', 'arrival', 'berth', 'unload_end')
PANAMAX, CAPESIZE = (60000, 85000), (120000, 170000)
CAPESIZE_COALS = {'AVRA', 'Glencore', 'Centennial'}
STOCKED_KEY = 'V-test-26-3-034'  # the one entered 'arrived' voyage whose coal is in the baseline
AS_OF = datetime.fromisoformat('2026-11-08T00:00:00+09:00')


def generate(*args, **kwargs):
    """Past 101-voyage range only; the planned voyages after as_of have their own tests below."""
    kwargs.setdefault('future_days', 0)
    return _generate(*args, **kwargs)


def _full(entity, row):
    """Mimic a stored snapshot row: every schema column present, data_origin defaulted."""
    out = {f['key']: None for f in SCHEMA[entity]['fields']}
    out.update(row)
    if 'data_origin' in out:
        out['data_origin'] = out['data_origin'] or 'entered'
    return out


@pytest.fixture
def fixture():
    raw = json.loads(FIXTURE.read_text(encoding='utf-8'))
    snap = {'revision': raw['registry']['revision']}
    for entity in SCHEMA:
        snap[entity] = [_full(entity, row) for row in raw['registry'][entity]]
    real_numbers = {v['voyage_number'] for v in snap['voyages']
                    if v['classification'] == 'actual' and v['voyage_number']}
    return SimpleNamespace(raw=raw, snapshot=snap, baseline=raw['baseline'], real_numbers=real_numbers)


def _by_key(rows, entity):
    return {row[SCHEMA[entity]['key']]: row for row in rows}


def _merged(fixture, plan):
    """Final rows after applying the plan to the fixture, the way commit merges partial rows."""
    out = {}
    for entity in ('voyages', 'cargo', 'assays'):
        rows = {key: dict(row) for key, row in _by_key(fixture.snapshot[entity], entity).items()}
        for change in plan.changes.get(entity, []):
            key = change[SCHEMA[entity]['key']]
            rows[key] = {**{f['key']: None for f in SCHEMA[entity]['fields']}, **rows.get(key, {}), **change}
        out[entity] = rows
    return out


def _dt(value):
    return datetime.fromisoformat(value)


def test_generates_full_voyage_range(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    created = {r['voyage_number'] for r in plan.changes['voyages'] if r['voyage_no'].startswith('DV-')}
    assert len(created) == 89
    assert created | fixture.real_numbers == ALL_101_NUMBERS
    dummy = [r for r in plan.changes['voyages'] if r['voyage_no'].startswith('DV-')]
    assert all(r['voyage_no'] == f"DV-{r['voyage_number']}" for r in dummy)
    assert all(r['classification'] == 'actual' and r['data_origin'] == 'dummy' and r['dummy_fields'] is None
               and r['status'] == 'completed' and r.get('ship_code') is None for r in dummy)
    assert all(r['berth_id'] == f"BD-{r['voyage_number'].split('-')[1]}" for r in dummy)
    assert plan.stats['create']['voyages'] == 89
    assert not plan.changes.get('ships')


def test_same_seed_same_plan_and_other_seed_differs(fixture):
    first = generate(copy.deepcopy(fixture.snapshot), copy.deepcopy(fixture.baseline))
    again = generate(copy.deepcopy(fixture.snapshot), copy.deepcopy(fixture.baseline))
    other = generate(copy.deepcopy(fixture.snapshot), copy.deepcopy(fixture.baseline), seed=7)
    assert first.changes == again.changes and first.baseline == again.baseline and first.stats == again.stats
    assert first.changes != other.changes


def test_real_values_are_never_overwritten(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    checked = 0
    for entity in ('voyages', 'cargo', 'assays'):
        real = _by_key(fixture.snapshot[entity], entity)
        for change in plan.changes[entity]:
            key = change[SCHEMA[entity]['key']]
            if key not in real:
                continue
            checked += 1
            kept = {k for k, v in real[key].items() if v is not None and k not in SYSTEM}
            filled = set(change) - {SCHEMA[entity]['key']} - SYSTEM
            if key == STOCKED_KEY:  # entered 'arrived', but the yard baseline holds it: status becomes completed
                assert 'status' in filled
                kept -= {'status'}
            assert not filled & kept, (key, filled & kept)
            assert change['data_origin'] == 'mixed'
            assert change['dummy_fields'] == ','.join(sorted(filled))
    assert checked >= 12
    assert plan.stats['kept_real_values'] > 0


def test_real_arrived_voyages_get_no_actuals_or_unloading_assay(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    changes = _by_key(plan.changes['voyages'], 'voyages')
    assays = plan.changes['assays']
    arrived = [v for v in fixture.snapshot['voyages'] if v['classification'] == 'actual' and v['status'] == 'arrived']
    assert len(arrived) == 11
    for voyage in arrived:
        if voyage['voyage_no'] == STOCKED_KEY:
            continue
        change = changes[voyage['voyage_no']]
        forbidden = {'status', 'planned_berth', 'planned_unload_end'} | {f'actual_{t}' for t in TIMES}
        assert not forbidden & set(change), voyage['voyage_number']
        cargo_no = next(c['cargo_no'] for c in fixture.snapshot['cargo'] if c['voyage_no'] == voyage['voyage_no'])
        mine = [a for a in assays if a['cargo_no'] == cargo_no]
        assert [a['assay_id'] for a in mine] == [f"DA-{voyage['voyage_number']}-L"]
        assert mine[0]['stage'] == 'loading'
        cargo_change = next(c for c in plan.changes['cargo'] if c['cargo_no'] == cargo_no)
        assert 'receipt_date' not in cargo_change and 'receipt_end_date' not in cargo_change
    # The planned arrival a person entered stays; only the departure before it is added.
    v040 = changes['V-test-26-1-040']
    assert 'planned_arrival' not in v040 and v040['planned_departure'] < '2026-11-04T00:00:00+09:00'


def test_real_completed_voyage_gets_planned_times_cargo_and_two_assays(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    change = _by_key(plan.changes['voyages'], 'voyages')['V-test-26-1-001']
    assert {f'planned_{t}' for t in TIMES} <= set(change)
    assert not {'status', 'actual_unload_end'} & set(change)
    assert change['planned_unload_end'] <= '2026-01-19T15:00:00+09:00'
    cargo = _by_key(plan.changes['cargo'], 'cargo')['DC-26-1-001']
    assert cargo['voyage_no'] == 'V-test-26-1-001' and cargo['data_origin'] == 'dummy'
    assert cargo['receipt_end_date'] == '2026-01-19'
    ids = sorted(a['assay_id'] for a in plan.changes['assays'] if a['cargo_no'] == 'DC-26-1-001')
    assert ids == ['DA-26-1-001-L', 'DA-26-1-001-U']


def test_unloaded_voyage_without_berth_time_is_a_clear_error(fixture):
    snap = copy.deepcopy(fixture.snapshot)
    voyage = _by_key(snap['voyages'], 'voyages')['V-test-26-1-001']
    voyage.update(status='berthed', actual_berth=None, planned_berth=None)  # unload end but no berth time at all
    with pytest.raises(ValueError, match='26-1-001.*접안'):
        generate(snap, fixture.baseline)


def test_coal_assignment_keeps_known_coals_and_caps_anthracite(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)
    assert all('coal_name' not in c for c in plan.changes['cargo'] if c['cargo_no'].startswith('C-test-'))
    voyage_number = {k: v['voyage_number'] for k, v in merged['voyages'].items()}
    coal_by_number = {voyage_number[c['voyage_no']]: c['coal_name'] for c in merged['cargo'].values()
                      if voyage_number[c['voyage_no']]}
    assert set(coal_by_number) == ALL_101_NUMBERS
    for lot in fixture.baseline['lots']:
        assert coal_by_number[lot['voyage_number']] == lot['coal_name']
    for cargo in fixture.snapshot['cargo']:
        number = voyage_number[cargo['voyage_no']]
        if number:
            assert coal_by_number[number] == cargo['coal_name']
    assert sum(name == 'Glencore(무연탄)' for name in coal_by_number.values()) <= 5
    assert set(coal_by_number.values()) <= set(load_profiles()['coals'])
    assert plan.stats['coal_counts'] == {name: list(coal_by_number.values()).count(name)
                                         for name in sorted(set(coal_by_number.values()))}


def test_no_berth_overlap_and_dummy_voyages_are_past(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)['voyages']
    for berth in ('1', '2', '3'):
        rows = sorted((v for v in merged.values() if v['voyage_number'] and v['voyage_number'].split('-')[1] == berth
                       and v['actual_berth'] and v['actual_unload_end']), key=lambda v: v['voyage_number'])
        intervals = [(_dt(v['actual_berth']), _dt(v['actual_unload_end'])) for v in rows]
        assert intervals == sorted(intervals), berth  # lower number unloads first
        for (_, end), (start, _) in zip(intervals, intervals[1:]):
            assert end <= start, berth
    for v in merged.values():
        for prefix in ('planned', 'actual'):
            times = [v[f'{prefix}_{t}'] for t in TIMES if v[f'{prefix}_{t}']]
            assert times == sorted(times), v['voyage_no']
        if v['voyage_no'].startswith('DV-'):
            assert all(v[f'{p}_{t}'] for p in ('planned', 'actual') for t in TIMES)
            assert _dt(v['actual_unload_end']) < AS_OF
            assert _dt(v['actual_departure']) >= datetime.fromisoformat('2025-12-01T00:00:00+09:00')


def test_unloading_time_follows_berth_capacity(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)
    berths = load_berths()['berths']
    cargo = {c['voyage_no']: c for c in merged['cargo'].values()}
    for v in merged['voyages'].values():
        if not v['voyage_no'].startswith('DV-'):
            continue
        spec = berths[v['berth_id']]
        hours = (_dt(v['actual_unload_end']) - _dt(v['actual_berth'])).total_seconds() / 3600
        expected = cargo[v['voyage_no']]['bl_t'] / spec['unload_tph'] / spec['work_hours_per_day'] * 24
        assert abs(hours - expected) <= 1 / 60 + 1e-9
        assert v['yard'] in spec['yards']
    assert merged['voyages']['DV-26-1-035']['yard'] == '1'  # baseline location P1
    assert merged['voyages']['DV-26-2-020']['yard'] == '2'  # baseline location P6


def test_cargo_volumes_and_receipt_tolerance(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    berths = load_berths()['berths']
    voyages = _by_key(plan.changes['voyages'], 'voyages')
    dummy = [c for c in plan.changes['cargo'] if c['cargo_no'].startswith('DC-')]
    assert len(dummy) == 90  # 89 dummy voyages + the real completed voyage without cargo
    for c in dummy:
        bl = c['bl_t']
        assert PANAMAX[0] <= bl <= PANAMAX[1] or CAPESIZE[0] <= bl <= CAPESIZE[1]
        if bl >= CAPESIZE[0]:
            assert c['coal_name'] in CAPESIZE_COALS
            berth = voyages.get(c['voyage_no'], {}).get('berth_id') or 'BD-1'
            assert berths[berth]['max_dwt'] >= bl
        assert c['planned_t'] == bl and bl == int(bl)
        assert abs(c['received_t'] / bl - 1) <= 0.005 and c['received_t'] == int(c['received_t'])
        assert c['destination_plant_id'] == 'dangjin' and c['supplier'] == c['coal_name'] and c['mine'] is None
        assert all(c.get(k) is None for k in ('contract_type', 'incoterms', 'contract_no', 'bl_no', 'contract_date'))
    assert any(c['bl_t'] >= CAPESIZE[0] for c in dummy)


def test_loading_port_and_sailing_days_follow_origin(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)
    days = {'인도네시아': (8, 10), '호주': (12, 14), '러시아': (5, 7), '남아프리카공화국': (18, 22)}
    ports = {'호주': {'Newcastle'}, '러시아': {'Vostochny'}}
    cargo = {c['voyage_no']: c for c in merged['cargo'].values()}
    seen = set()
    for v in merged['voyages'].values():
        if not v['voyage_no'].startswith('DV-'):
            continue
        c = cargo[v['voyage_no']]
        assert v['loading_country'] == c['origin_country'] and v['destination_port'] == '당진'
        seen.add(v['loading_country'])
        sail = (_dt(v['actual_arrival']) - _dt(v['actual_departure'])).total_seconds() / 86400
        low, high = days[v['loading_country']]
        assert low - 1e-3 <= sail <= high + 1e-3
        if v['loading_country'] in ports:
            assert v['origin_port'] in ports[v['loading_country']]
    assert {'인도네시아', '호주'} <= seen
    v041 = _by_key(plan.changes['voyages'], 'voyages')['V-test-26-1-041']
    assert 'origin_port' not in v041 and 'loading_country' not in v041


def test_demurrage_and_laytime_ranges(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)
    cargo = {c['voyage_no']: c for c in merged['cargo'].values()}
    for v in merged['voyages'].values():
        if v['classification'] != 'actual':
            continue
        assert 72 <= v['laytime_hours'] <= 120 and v['laytime_hours'] == int(v['laytime_hours'])
        if v['voyage_no'] in ('V-test-26-2-021', 'V-test-26-3-036'):
            continue  # real values kept
        dem = v['demurrage_usd_per_day']
        assert dem % 500 == 0
        if cargo[v['voyage_no']]['bl_t'] >= CAPESIZE[0]:
            assert 25000 <= dem <= 35000
        else:
            assert 15000 <= dem <= 25000
    assert merged['voyages']['V-test-26-2-021']['laytime_hours'] == 96
    assert merged['voyages']['V-test-26-3-036']['demurrage_usd_per_day'] == 22000


def test_assays_are_consistent_and_cargo_quality_comes_from_unloading(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    merged = _merged(fixture, plan)
    assays = merged['assays']
    for a in assays.values():
        assert check_assay(a) == [], a['assay_id']
        assert a['laboratory'] == '더미(공개 일반값)' and a['result_status'] == 'confirmed'
        assert a['report_no'] == 'DUMMY-' + a['assay_id']
        lag = date.fromisoformat(a['analysis_date']) - date.fromisoformat(a['sample_date'])
        assert lag.days == 2
    voyages = merged['voyages']
    for c in merged['cargo'].values():
        if c['voyage_no'].startswith('V-test-sim'):
            continue
        v = voyages[c['voyage_no']]
        number = v['voyage_number']
        source = assays.get(f'DA-{number}-U') or assays[f'DA-{number}-L']
        assert c['cv'] == source['gcv_arb'] and c['moisture_pct'] == source['tm_ar']
        assert c['sulfur_pct'] == source['sulfur_ar'] and c['cv_basis'] == 'GAR' and c['analysis_basis'] == 'AR'
        loading = assays[f'DA-{number}-L']
        departure = v['actual_departure'] or v['planned_departure']
        assert loading['sample_date'] == departure[:10]
        if f'DA-{number}-U' in assays:
            assert assays[f'DA-{number}-U']['sample_date'] == v['actual_unload_end'][:10]
            assert c['receipt_date'] == (v['actual_berth'] or v['planned_berth'])[:10]
            assert c['receipt_end_date'] == v['actual_unload_end'][:10]
    assert len([a for a in assays if a.endswith('-U')]) == 91  # 90 + the stocked voyage


def test_simulation_rows_untouched(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    sim_voyages = {'V-test-sim-01', 'V-test-sim-02'}
    assert not sim_voyages & {r['voyage_no'] for r in plan.changes['voyages']}
    assert not [c for c in plan.changes['cargo'] if c.get('voyage_no') in sim_voyages or c['cargo_no'] == 'C-test-sim-01']
    assert not [a for a in plan.changes['assays'] if a['cargo_no'] == 'C-test-sim-01']


def test_baseline_fill_marks_dummy_fields_and_bounds_temperature(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    assert plan.baseline['as_of'] == '2026-11-08'
    lots = plan.baseline['lots']
    originals = fixture.baseline['lots']
    assert len(lots) == len(originals)
    for lot, original in zip(lots, originals):
        assert 25 <= lot['temperature_c'] <= 60 and round(lot['temperature_c'], 1) == lot['temperature_c']
        filled = {k for k in ('age_days', 'temperature_c', 'grade') if original.get(k) in (None, '')}
        assert set(filter(None, (lot.get('dummy_fields') or '').split(','))) == filled
        for k, v in original.items():
            if v not in (None, ''):
                assert lot[k] == v, k
        assert isinstance(lot['age_days'], int) and lot['age_days'] >= 0
    by_source = {lot['source_id']: lot for lot in lots}
    assert by_source['test-file-02']['grade'] == '저열'  # KCH(adaro) is low_cv
    assert by_source['test-file-04']['grade'] == '저열'  # LXI
    assert by_source['test-file-06']['temperature_c'] == 41.5
    assert plan.baseline is not fixture.baseline and fixture.baseline['lots'][1]['grade'] == ''


def test_plan_commits_cleanly_into_empty_registry(tmp_path, fixture):
    path = tmp_path / 'registry.sqlite3'
    rows = {entity: fixture.raw['registry'][entity] for entity in ('ships', 'voyages', 'cargo')}
    commit(rows, 0, 'fixture', 'manual', path)
    before = snapshot(path)
    plan = generate(before, fixture.baseline)
    after = commit(plan.changes, before['revision'], 'dummy-seed', 'dummy-data', path)
    assert after['revision'] == before['revision'] + 1
    assert len(after['voyages']) == len(before['voyages']) + 89
    real = _by_key(before['voyages'], 'voyages')
    for row in after['voyages']:
        if row['voyage_no'] in real:
            for k, v in real[row['voyage_no']].items():
                if v is not None and k not in SYSTEM | {'updated_at', 'updated_by'}:
                    assert row[k] == v or (row['voyage_no'] == STOCKED_KEY and k == 'status')
    # Re-running on the loaded registry proposes the same values, so commit changes nothing.
    again = generate(after, plan.baseline)
    assert again.baseline is None
    final = commit(again.changes, after['revision'], 'dummy-seed', 'dummy-data', path)
    assert final['revision'] == after['revision']
    assert again.stats['create'] == {'voyages': 0, 'cargo': 0, 'assays': 0}


def test_check_failure_raises(fixture, monkeypatch):
    import importlib
    module = importlib.import_module("midterm.dummy_data.generate")
    monkeypatch.setattr(module, 'check_assay', lambda a: ['고장'])
    with pytest.raises(ValueError):
        generate(fixture.snapshot, fixture.baseline)


def test_crowded_berth_pushes_berthing_after_previous_unloading():
    from datetime import timedelta

    from midterm.dummy_data.schedule import BERTH_GAP, Slot, plan_berth
    as_of = datetime.fromisoformat('2026-01-05T00:00:00+09:00')
    slots = {s: Slot(serial=s, dummy=True, actual={}, planned={}, duration=timedelta(days=3),
                     sailing=timedelta(days=9), jitter=timedelta(0), wait=timedelta(hours=2)) for s in (1, 2, 3)}
    times = plan_berth(slots, 3, as_of)
    for s in (1, 2):
        assert times[s + 1]['berth'] == times[s]['unload_end'] + BERTH_GAP
        assert times[s + 1]['unload_end'] - times[s + 1]['berth'] == timedelta(days=3)


def test_stocked_voyage_is_completed_with_consistent_past_times(fixture):
    plan = generate(fixture.snapshot, fixture.baseline)
    again = generate(fixture.snapshot, fixture.baseline)
    assert plan.changes == again.changes  # deterministic
    change = _by_key(plan.changes['voyages'], 'voyages')[STOCKED_KEY]
    assert change['status'] == 'completed' and change['data_origin'] == 'mixed'
    assert {'status', 'actual_arrival', 'actual_berth', 'actual_unload_end'} <= set(change['dummy_fields'].split(','))
    times = [_dt(change[f'actual_{t}']) for t in TIMES]
    assert times == sorted(times) and times[-1] <= AS_OF
    merged = _merged(fixture, plan)['voyages'][STOCKED_KEY]
    assert merged['classification'] == 'actual' and merged['voyage_number'] == '26-3-034'


def test_at_most_one_voyage_is_berthed_per_berth(fixture):
    """arrived + berth_id + no unload end = at the berth now; two ships cannot be at one berth at once."""
    merged = _merged(fixture, generate(fixture.snapshot, fixture.baseline))['voyages']
    at_berth = {}
    for v in merged.values():
        if v['classification'] == 'actual' and v['status'] == 'arrived' and v['berth_id'] and not v['actual_unload_end']:
            at_berth.setdefault(v['berth_id'], []).append(v['voyage_number'])
    assert all(len(numbers) <= 1 for numbers in at_berth.values()), at_berth
    # Every voyage whose coal sits in the yard baseline has finished unloading.
    stocked = {lot['voyage_number'] for lot in fixture.baseline['lots']}
    for v in merged.values():
        if v['voyage_number'] in stocked:
            assert v['status'] == 'completed' and v['actual_unload_end'], v['voyage_number']


# ---- 기준일 뒤 계획 항차 -------------------------------------------------------------------------

TODAY = date(2026, 11, 10)
START = datetime.fromisoformat('2026-11-10T00:00:00+09:00')


def _future(plan):
    return [v for v in plan.changes['voyages'] if v.get('status') in ('planned', 'underway')]


def test_future_voyages_cover_the_window_with_cargo_not_yet_received(fixture):
    plan = _generate(fixture.snapshot, fixture.baseline, today=TODAY)
    future = _future(plan)
    assert plan.stats['future_voyages'] == len(future) > 30
    cargo = {c.get('voyage_no'): c for c in plan.changes['cargo']}
    for v in future:
        assert v['voyage_no'] == f"DV-{v['voyage_number']}" and v['data_origin'] == 'dummy'
        assert v['classification'] == 'actual' and v['berth_id'] is None
        assert all(v[f'planned_{t}'] for t in TIMES) and not any(v[f'actual_{t}'] for t in TIMES[1:])
        assert [v[f'planned_{t}'] for t in TIMES] == sorted(v[f'planned_{t}'] for t in TIMES)
        assert START < _dt(v['planned_unload_end'])
        assert _dt(v['planned_arrival']) < START + timedelta(days=FUTURE_DAYS)
        assert v['yard'] in FUTURE_DAILY_T[f"BD-{v['voyage_number'].split('-')[1]}"]
        assert (v['status'] == 'underway') == (_dt(v['planned_departure']) <= START)
        assert (v['actual_departure'] is not None) == (v['status'] == 'underway')
        c = cargo[v['voyage_no']]
        assert c['cargo_no'] == f"DC-{v['voyage_number']}" and c['received_t'] is None and c['receipt_date'] is None
        assert c['destination_plant_id'] == 'dangjin' and c['bl_t'] == c['planned_t'] > 0
        assert c['cv_basis'] == 'GAR' and 4000 <= c['cv'] <= 7500
    # 앞 배 하역이 끝난 뒤에만 접안하고, 과거 항차 사슬 뒤에서 시작한다.
    merged = _merged(fixture, plan)['voyages']
    for berth in ('1', '2', '3'):
        rows = sorted((v for v in future if v['voyage_number'].split('-')[1] == berth), key=lambda v: v['planned_berth'])
        for a, b in zip(rows, rows[1:]):
            assert _dt(a['planned_unload_end']) <= _dt(b['planned_berth'])
        past_end = max(_dt(v['actual_unload_end']) for v in merged.values()
                       if v['actual_unload_end'] and v['voyage_number'] and v['voyage_number'].split('-')[1] == berth)
        assert past_end <= _dt(rows[0]['planned_berth'])
    assert {v['status'] for v in future} == {'planned', 'underway'}
    assert any(v['voyage_number'].startswith('27-') for v in future)  # 해가 바뀌면 새 번호


def test_future_receipts_follow_the_daily_targets_by_yard(fixture):
    plan = _generate(fixture.snapshot, fixture.baseline, today=TODAY)
    cargo = {c.get('voyage_no'): c for c in plan.changes['cargo']}
    by_yard = {}
    for v in _future(plan):
        by_yard[v['yard']] = by_yard.get(v['yard'], 0) + cargo[v['voyage_no']]['bl_t']
    targets = {}
    for yards in FUTURE_DAILY_T.values():
        for yard, t in yards.items():
            targets[yard] = targets.get(yard, 0) + t
    total = sum(by_yard.values()) / FUTURE_DAYS
    assert 0.8 * sum(targets.values()) <= total <= 1.2 * sum(targets.values())
    for yard, target in targets.items():
        assert 0.5 * target <= by_yard.get(yard, 0) / FUTURE_DAYS <= 1.6 * target, yard


def test_underway_voyage_has_loading_assay_and_planned_has_none(fixture):
    plan = _generate(fixture.snapshot, fixture.baseline, today=TODAY)
    assays = {a['assay_id']: a for a in plan.changes['assays']}
    for v in _future(plan):
        number = v['voyage_number']
        assert f'DA-{number}-U' not in assays
        if v['status'] == 'underway':
            a = assays[f'DA-{number}-L']
            assert check_assay(a) == [] and a['sample_date'] == v['planned_departure'][:10]
        else:
            assert f'DA-{number}-L' not in assays


def test_future_voyages_start_from_today_when_baseline_is_older(fixture):
    later = _generate(fixture.snapshot, fixture.baseline, today=date(2026, 11, 20))
    first = min(_dt(v['planned_arrival']) for v in _future(later))
    assert first >= datetime.fromisoformat('2026-11-21T00:00:00+09:00')
    earlier = _generate(fixture.snapshot, fixture.baseline, today=date(2026, 11, 1))  # 기준일보다 앞이면 기준일
    assert min(_dt(v['planned_arrival']) for v in _future(earlier)) >= AS_OF + timedelta(days=1)


def test_future_numbers_skip_numbers_already_in_the_registry(fixture):
    snap = copy.deepcopy(fixture.snapshot)
    snap['voyages'].append(_full('voyages', {'voyage_no': 'V-real-26-1-042', 'classification': 'actual',
                                             'voyage_number': '26-1-042', 'status': 'planned'}))
    plan = _generate(snap, fixture.baseline, today=TODAY)
    numbers = [v['voyage_number'] for v in _future(plan)]
    assert '26-1-042' not in numbers and '26-1-043' in numbers


def test_future_plan_is_deterministic_and_reload_is_a_noop(tmp_path, fixture):
    path = tmp_path / 'registry.sqlite3'
    commit({entity: fixture.raw['registry'][entity] for entity in ('ships', 'voyages', 'cargo')}, 0, 'fixture',
           'manual', path)
    before = snapshot(path)
    plan = _generate(before, fixture.baseline, today=TODAY)
    assert plan.changes == _generate(before, fixture.baseline, today=TODAY).changes
    after = commit(plan.changes, before['revision'], 'dummy-seed', 'dummy-data', path)
    again = _generate(after, plan.baseline, today=TODAY)
    assert again.stale is None and again.stats['create'] == {'voyages': 0, 'cargo': 0, 'assays': 0}
    assert commit(again.changes, after['revision'], 'dummy-seed', 'dummy-data', path)['revision'] == after['revision']
    # 하루 뒤 다시 만들면 기간 끝이 늘고, 사라진 번호만 지울 대상(stale)으로 남는다.
    later = _generate(after, plan.baseline, today=date(2026, 11, 25))
    kept = {v['voyage_no'] for v in later.changes['voyages']}
    stale = later.stale or {'voyages': []}
    old = {v['voyage_no'] for v in _future(plan)}
    assert set(stale['voyages']) == old - kept
    assert all(c.startswith('DC-') for c in (later.stale or {}).get('cargo', []))


def test_supply_forecast_counts_the_dummy_planned_voyages(tmp_path, fixture):
    """적재한 계획 항차가 수급 전망의 예정 입하(registry_planned)로 들어간다."""
    from midterm.supply import planned_receipts
    path = tmp_path / 'registry.sqlite3'
    commit({entity: fixture.raw['registry'][entity] for entity in ('ships', 'voyages', 'cargo')}, 0, 'fixture',
           'manual', path)
    before = snapshot(path)
    plan = _generate(before, fixture.baseline, today=TODAY)
    after = commit(plan.changes, before['revision'], 'dummy-seed', 'dummy-data', path)
    rows = planned_receipts(after)
    future = {v['voyage_no'] for v in _future(plan)}
    assert {r['voyage_no'] for r in rows} >= future
    mine = [r for r in rows if r['voyage_no'] in future]
    assert all(r['group'] in ('g14', 'g58', 'g910') and r['cv'] is not None and r['tonnes'] > 0 for r in mine)
