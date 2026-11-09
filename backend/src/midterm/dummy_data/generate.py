"""Build the deterministic dummy-data change list for the voyage registry and the filled yard baseline.

Only empty fields are filled. Real rows get partial `mixed` changes; new rows are whole `dummy` rows."""
from __future__ import annotations

import math
import random
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from midterm.stock_inventory import LOCATIONS
from midterm.voyage_registry import KST, SCHEMA, dummy_keys

from .profiles import load_berths, load_profiles
from .quality import cargo_summary, check_assay, make_loading_assay, make_unloading_assay
from .schedule import EVENTS, Slot, fill_chain, iso, order_problems, overlap_problems, parse, plan_berth

DEFAULT_SEED = 20261110
YEAR = 26
LAST_SERIAL = {1: 41, 2: 22, 3: 38}
ENTITIES = ('voyages', 'cargo', 'assays')

ANTHRACITE_CAP = math.floor(0.05 * sum(LAST_SERIAL.values()))
ANTHRACITE_WEIGHT = 0.2
KNOWN_COAL_BONUS = 0.5
CAPESIZE_COALS = ('AVRA', 'Glencore', 'Centennial')
CAPESIZE_SHARE = 0.4
CAPESIZE_BL = (120000, 170000)
PANAMAX_BL = (60000, 85000)
RECEIPT_TOLERANCE = 0.005
ARRIVAL_JITTER_H = 12
BERTH_WAIT_H = (2, 18)
LAYTIME_H = (72, 120)
DEMURRAGE = {True: (25000, 35000), False: (15000, 25000)}  # keyed by Capesize
DEMURRAGE_STEP = 500
ASSAY_LAG = timedelta(days=2)
DESTINATION_PORT = '당진'
DESTINATION_PLANT = 'dangjin'
# Keyword in the profile origin → loading country, generic loading ports (assumed) and sailing days to 당진.
COUNTRIES = (
    ('인도네시아', '인도네시아', ('Samarinda', 'Balikpapan', 'Tarahan'), (8, 10)),
    ('호주', '호주', ('Newcastle',), (12, 14)),
    ('러시아', '러시아', ('Vostochny',), (5, 7)),
    ('남아프리카', '남아프리카공화국', ('Richards Bay',), (18, 22)),
)
OTHER_SAILING_DAYS = (18, 22)
GRADE_LABEL = {'high_cv': '고열', 'low_cv': '저열'}
TEMPERATURE = dict(base=25.0, age_cap=180, age_rise=25.0, low_cv=8.0, noise=2.0, low=25.0, high=60.0)


@dataclass
class DummyPlan:
    changes: dict          # {'voyages': [...], 'cargo': [...], 'assays': [...]} — commit에 그대로 넣는 형식
    baseline: dict | None  # {'as_of': ..., 'lots': [...]} 보완본, 바뀐 것이 없으면 None
    stats: dict            # {'create': {...}, 'fill': {...}, 'kept_real_values': int, ...}


def voyage_numbers() -> list[str]:
    return [f'{YEAR}-{berth}-{serial:03}' for berth, last in LAST_SERIAL.items() for serial in range(1, last + 1)]


def _real(row: dict, entity: str) -> dict | None:
    """The values a person entered: whole-dummy rows are none, dummy-filled fields are hidden."""
    if row.get('data_origin') == 'dummy':
        return None
    hidden = dummy_keys(row, entity)
    return {k: v for k, v in row.items() if k not in hidden}


def _country(origin: str) -> tuple[str | None, tuple[str, ...], tuple[int, int]]:
    hits = [(origin.find(keyword), country, ports, days) for keyword, country, ports, days in COUNTRIES
            if keyword in origin]
    if not hits:
        return None, (), OTHER_SAILING_DAYS
    _, country, ports, days = min(hits)
    return country, ports, days


def _pick(options, fraction: float):
    return options[min(int(fraction * len(options)), len(options) - 1)]


def _assign_coals(numbers: list[str], known: dict[str, str], coals: dict, seed: int) -> dict[str, str]:
    """Known coals stay; the rest are drawn per berth in proportion to that berth's known coals."""
    by_berth: dict[str, Counter] = {}
    for number, coal in known.items():
        by_berth.setdefault(number.split('-')[1], Counter())[coal] += 1
    anthracite = sum(coals.get(coal, {}).get('anthracite') is True for coal in known.values())
    names = sorted(coals)
    result = dict(known)
    for number in numbers:
        if number in result:
            continue
        counts = by_berth.get(number.split('-')[1], Counter())
        weights = [(ANTHRACITE_WEIGHT if anthracite < ANTHRACITE_CAP else 0.0) if coals[name]['anthracite']
                   else counts[name] + KNOWN_COAL_BONUS for name in names]
        target = random.Random(f'{seed}:{number}:coal').random() * sum(weights)
        choice = names[-1]
        for name, weight in zip(names, weights):
            if target < weight:
                choice = name
                break
            target -= weight
        anthracite += coals[choice]['anthracite'] is True
        result[number] = choice
    return result


def _draws(seed: int, number: str, coal: str, profile: dict | None) -> dict:
    """Every random value of one voyage, drawn in a fixed order from its own sub-seed."""
    rng = random.Random(f'{seed}:{number}:{coal}')
    d = dict(capesize=rng.random(), bl=rng.random(), receipt=rng.uniform(-RECEIPT_TOLERANCE, RECEIPT_TOLERANCE),
             port=rng.random(), sailing=rng.random(), jitter=rng.uniform(-ARRIVAL_JITTER_H, ARRIVAL_JITTER_H),
             wait=rng.uniform(*BERTH_WAIT_H), laytime=rng.randint(*LAYTIME_H), demurrage=rng.random(),
             yard=rng.random())
    if profile:
        d['loading'] = make_loading_assay(profile, rng)
        d['unloading'] = make_unloading_assay(d['loading'], rng)
    return d


def _received(bl: int, offset: float) -> int:
    value = round(bl * (1 + offset))
    return min(max(value, math.ceil(bl * (1 - RECEIPT_TOLERANCE))), math.floor(bl * (1 + RECEIPT_TOLERANCE)))


class _Emitter:
    """Turns proposals into commit rows: whole rows for new or dummy rows, blank-only fills for real rows."""

    def __init__(self, snapshot: dict):
        self.current = {e: {row[SCHEMA[e]['key']]: row for row in snapshot.get(e, [])} for e in ENTITIES}
        self.changes = {e: [] for e in ENTITIES}
        self.create = {e: 0 for e in ENTITIES}
        self.fill = {e: {'rows': 0, 'fields': 0} for e in ENTITIES}
        self.kept = 0

    def emit(self, entity: str, key: str, proposal: dict) -> dict:
        """Return the row as it will stand after commit."""
        key_field = SCHEMA[entity]['key']
        row = self.current[entity].get(key)
        if row is None or row.get('data_origin') == 'dummy':
            self.create[entity] += row is None
            change = {key_field: key, **proposal, 'data_origin': 'dummy', 'dummy_fields': None}
            self.changes[entity].append(change)
            return {**(row or {}), **change}
        real = _real(row, entity)
        self.kept += sum(v is not None and real.get(k) is not None for k, v in proposal.items())
        fill = {k: v for k, v in proposal.items() if v is not None and row.get(k) is None}
        if not fill:
            return dict(row)
        self.fill[entity]['rows'] += 1
        self.fill[entity]['fields'] += len(fill)
        marked = ','.join(sorted(set(fill) | dummy_keys(row, entity)))
        change = {key_field: key, **fill, 'data_origin': 'mixed', 'dummy_fields': marked}
        self.changes[entity].append(change)
        return {**row, **change}


def generate(snapshot: dict, baseline: dict, *, seed: int = DEFAULT_SEED,
             profiles: dict | None = None, berths: dict | None = None) -> DummyPlan:
    coals = (profiles or load_profiles())['coals']
    berth_specs = (berths or load_berths())['berths']
    if not baseline or not baseline.get('as_of'):
        raise ValueError('기준재고 기준일(as_of)이 필요합니다.')
    as_of_day = date.fromisoformat(baseline['as_of'])
    as_of = datetime.combine(as_of_day, time(0), KST)
    numbers = voyage_numbers()
    wanted = set(numbers)

    real_voyages: dict[str, tuple[dict, dict]] = {}
    for row in snapshot.get('voyages', []):
        view = _real(row, 'voyages')
        if view and view.get('classification') != 'simulation' and view.get('voyage_number') in wanted:
            real_voyages[view['voyage_number']] = (row, view)
    real_keys = {row['voyage_no']: number for number, (row, _) in real_voyages.items()}
    real_cargo: dict[str, tuple[dict, dict]] = {}
    for row in sorted(snapshot.get('cargo', []), key=lambda c: c['cargo_no']):
        view = _real(row, 'cargo')
        if view and row['voyage_no'] in real_keys:
            real_cargo.setdefault(real_keys[row['voyage_no']], (row, view))
    real_assay_stages = {(row['cargo_no'], row['stage']) for row in snapshot.get('assays', []) if _real(row, 'assays')}

    lots_by_number: dict[str, list[dict]] = {}
    for lot in baseline.get('lots', []):
        if lot.get('voyage_number') in wanted:
            lots_by_number.setdefault(lot['voyage_number'], []).append(lot)
    baseline_coal, baseline_yard = {}, {}
    for number, lots in lots_by_number.items():
        ranked = sorted(lots, key=lambda lot: -(lot.get('tonnes') or 0))
        coal = next((lot['coal_name'] for lot in ranked if lot.get('coal_name') in coals), None)
        if coal:
            baseline_coal[number] = coal
        location = next((lot['location'] for lot in ranked if lot.get('location') in LOCATIONS), None)
        if location:
            baseline_yard[number] = str(LOCATIONS[location])

    known = {}
    for number in numbers:
        coal = (real_cargo.get(number, (None, {}))[1].get('coal_name')) or baseline_coal.get(number)
        if coal:
            known[number] = coal
    coal_of = _assign_coals(numbers, known, coals, seed)

    info: dict[str, dict] = {}
    for number in numbers:
        berth_no, serial = int(number.split('-')[1]), int(number.split('-')[2])
        berth_id = f'BD-{berth_no}'
        spec = berth_specs[berth_id]
        coal = coal_of[number]
        profile = coals.get(coal)
        d = _draws(seed, number, coal, profile)
        country, ports, days = _country(profile['origin']) if profile else (None, (), OTHER_SAILING_DAYS)
        cargo_view = real_cargo.get(number, (None, {}))[1]
        real_bl = cargo_view.get('bl_t') or cargo_view.get('planned_t')
        if real_bl:
            bl, capesize = real_bl, real_bl >= CAPESIZE_BL[0]
        else:
            capesize = (coal in CAPESIZE_COALS and d['capesize'] < CAPESIZE_SHARE
                        and spec['max_dwt'] >= CAPESIZE_BL[1])
            low, high = CAPESIZE_BL if capesize else PANAMAX_BL
            bl = round(low + d['bl'] * (high - low))
        view = real_voyages.get(number, (None, None))[1]
        info[number] = dict(berth_id=berth_id, serial=serial, spec=spec, coal=coal, profile=profile, d=d,
                            country=country, ports=ports, bl=bl, capesize=capesize, view=view,
                            sailing=timedelta(days=days[0] + d['sailing'] * (days[1] - days[0])),
                            completed=view is None or bool(view.get('actual_unload_end')))

    times: dict[str, dict] = {}
    for berth_no, last in LAST_SERIAL.items():
        slots = {}
        for number in numbers:
            item = info[number]
            if item['berth_id'] != f'BD-{berth_no}':
                continue
            view = item['view'] or {}
            spec = item['spec']
            slots[item['serial']] = Slot(
                serial=item['serial'], dummy=item['view'] is None,
                actual={e: parse(view.get(f'actual_{e}')) for e in EVENTS if view.get(f'actual_{e}')},
                planned={e: parse(view.get(f'planned_{e}')) for e in EVENTS if view.get(f'planned_{e}')},
                duration=timedelta(hours=item['bl'] / spec['unload_tph'] / spec['work_hours_per_day'] * 24),
                sailing=item['sailing'], jitter=timedelta(hours=item['d']['jitter']),
                wait=timedelta(hours=item['d']['wait']))
        planned = plan_berth(slots, last, as_of)
        for number in numbers:
            if info[number]['berth_id'] == f'BD-{berth_no}':
                times[number] = planned[info[number]['serial']]

    out = _Emitter(snapshot)
    final_voyages: dict[str, dict] = {}
    generated_assays: list[dict] = []
    for number in numbers:
        item, d = info[number], info[number]['d']
        voyage_row = real_voyages.get(number, (None, None))[0]
        voyage_key = voyage_row['voyage_no'] if voyage_row else f'DV-{number}'
        yard_options = item['spec']['yards']
        low, high = DEMURRAGE[item['capesize']]
        proposal = dict(origin_port=_pick(item['ports'], d['port']) if item['ports'] else None,
                        loading_country=item['country'], destination_port=DESTINATION_PORT,
                        berth_id=item['berth_id'],
                        yard=baseline_yard.get(number) or _pick(yard_options, d['yard']),
                        laytime_hours=d['laytime'],
                        demurrage_usd_per_day=round((low + d['demurrage'] * (high - low)) / DEMURRAGE_STEP) * DEMURRAGE_STEP)
        event_times = times[number]
        if voyage_row is None:
            proposal = dict(classification='actual', voyage_number=number, status='completed', **proposal,
                            **{f'{p}_{e}': iso(event_times[e]) for p in ('planned', 'actual') for e in EVENTS})
        else:
            events = EVENTS if item['view'].get('status') == 'completed' else ('departure', 'arrival')
            filled = fill_chain({e: voyage_row.get(f'planned_{e}') for e in EVENTS},
                                {e: event_times[e] for e in events})
            proposal.update({f'planned_{e}': filled.get(e) or iso(event_times[e]) for e in events})
        voyage = out.emit('voyages', voyage_key, proposal)
        final_voyages[number] = voyage

        cargo_entry = real_cargo.get(number)
        cargo_key = cargo_entry[0]['cargo_no'] if cargo_entry else f'DC-{number}'
        completed = item['completed']
        assay = d.get('unloading' if completed else 'loading')
        cargo = dict(destination_plant_id=DESTINATION_PLANT, supplier=item['coal'],
                     origin_country=item['country'], coal_name=item['coal'],
                     **(cargo_summary(assay) if assay else {}))
        departure = voyage.get('actual_departure') or voyage.get('planned_departure')
        unload_end = voyage.get('actual_unload_end')
        if completed:
            cargo.update(receipt_date=(voyage.get('actual_berth') or voyage.get('planned_berth'))[:10],
                         receipt_end_date=unload_end[:10])
        if cargo_entry:
            bl = cargo_entry[1].get('bl_t')
            if bl is not None:
                cargo['planned_t'] = bl
        else:
            cargo = dict(voyage_no=voyage_key, **cargo, mine=None, bl_t=item['bl'], planned_t=item['bl'],
                         received_t=_received(item['bl'], d['receipt']) if completed else None)
        out.emit('cargo', cargo_key, cargo)

        if not item['profile']:
            continue
        stages = [('loading', 'L', departure)] + ([('unloading', 'U', unload_end)] if completed else [])
        for stage, suffix, sampled in stages:
            if (cargo_key, stage) in real_assay_stages:
                continue
            assay_key = f'DA-{number}-{suffix}'
            sample_day = sampled[:10]
            values = dict(cargo_no=cargo_key, stage=stage, sample_date=sample_day,
                          analysis_date=(date.fromisoformat(sample_day) + ASSAY_LAG).isoformat(),
                          report_no=f'DUMMY-{assay_key}', **d[stage])
            generated_assays.append(out.emit('assays', assay_key, values))

    _check(generated_assays, final_voyages, out, snapshot, as_of)
    filled_baseline, baseline_fill = _fill_baseline(baseline, final_voyages, coals, seed, as_of_day)
    coal_counts = Counter(coal_of.values())
    stats = dict(create=out.create, fill=out.fill, kept_real_values=out.kept, baseline_fill=baseline_fill,
                 coal_counts={name: coal_counts[name] for name in sorted(coal_counts)})
    return DummyPlan(changes=out.changes, baseline=filled_baseline, stats=stats)


def _check(assays: list[dict], voyages: dict[str, dict], out: _Emitter, snapshot: dict, as_of: datetime) -> None:
    problems = []
    for assay in assays:
        problems += [f"{assay['assay_id']}: {p}" for p in check_assay(assay)]
    for voyage in voyages.values():
        problems += order_problems(voyage)
        if voyage['voyage_no'].startswith('DV-') and parse(voyage['actual_unload_end']) >= as_of:
            problems.append(f"{voyage['voyage_number']}: 더미 항차의 하역완료가 기준일 이후입니다.")
    merged = {row['voyage_no']: row for row in snapshot.get('voyages', [])
              if row.get('classification') != 'simulation'}
    merged.update({v['voyage_no']: v for v in voyages.values()})
    problems += overlap_problems(list(merged.values()))
    if problems:
        raise ValueError('더미 자료 검사 실패: ' + '; '.join(problems[:10]))


def _fill_baseline(baseline: dict, voyages: dict[str, dict], coals: dict, seed: int,
                   as_of: date) -> tuple[dict | None, int]:
    """Fill blank age_days, temperature_c and grade of each yard file and list them in its dummy_fields."""
    lots, total = [], 0
    for lot in baseline.get('lots', []):
        new, filled = dict(lot), set()
        number, coal = lot.get('voyage_number'), lot.get('coal_name')
        voyage = voyages.get(number)
        if new.get('age_days') is None and voyage:
            reference = voyage.get('actual_unload_end') or voyage.get('planned_arrival')
            if reference:
                new['age_days'] = max(0, (as_of - date.fromisoformat(reference[:10])).days)
                filled.add('age_days')
        if not new.get('grade') and coal in coals:
            new['grade'] = GRADE_LABEL[coals[coal]['class']]
            filled.add('grade')
        if new.get('temperature_c') is None and new.get('age_days') is not None:
            low_cv = str(new.get('grade') or '').startswith('저') or (
                not new.get('grade') and coals.get(coal, {}).get('class') == 'low_cv')
            rng = random.Random(f"{seed}:{number}:{coal}:temperature:{lot.get('source_id') or lot.get('location')}")
            t = TEMPERATURE
            value = (t['base'] + min(new['age_days'], t['age_cap']) / t['age_cap'] * t['age_rise']
                     + (t['low_cv'] if low_cv else 0) + rng.uniform(-t['noise'], t['noise']))
            new['temperature_c'] = round(min(max(value, t['low']), t['high']), 1)
            filled.add('temperature_c')
        if filled:
            previous = {k.strip() for k in str(lot.get('dummy_fields') or '').split(',') if k.strip()}
            new['dummy_fields'] = ','.join(sorted(previous | filled))
            total += len(filled)
        lots.append(new)
    if not total:
        return None, 0
    return {'as_of': baseline['as_of'], 'lots': lots}, total
