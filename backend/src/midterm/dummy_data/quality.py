"""Synthesize internally consistent dummy coal assays from public-range profiles and check them."""
from __future__ import annotations

import random

from midterm.voyage_registry import SCHEMA

LABORATORY = '더미(공개 일반값)'

# The order in which profile fields draw from the random stream. Changing it changes every result.
SAMPLE_ORDER = ('tm_ar', 'im_adb', 'vm_adb', 'ash_adb', 'c_db', 'h_db', 'n_db', 's_db', 'gcv_arb',
                'sio2', 'al2o3', 'fe2o3', 'cao', 'mgo', 'na2o', 'k2o', 'so3', 'tio2',
                'fusion_it', 'hgi', 'csn', 'chlorine_db_ppm')
OXIDES = ('sio2', 'al2o3', 'fe2o3', 'cao', 'mgo', 'na2o', 'k2o', 'so3', 'tio2')
FUSION_ORDER = ('fusion_it', 'fusion_st', 'fusion_ht', 'fusion_ft')
INTEGER_FIELDS = ('gcv_arb', 'fusion_it', 'chlorine_db_ppm')

PROXIMATE_TOLERANCE = 0.1
ULTIMATE_TOLERANCE = 0.5
ASH_TOLERANCE = 0.5
SULFUR_TOLERANCE = 0.01
MIN_OXYGEN_DB = 2.0

# Public general values, not coal-specific.
COMBUSTION_START = (250, 340)
COMBUSTION_PEAK = (400, 480)
COMBUSTION_END = (560, 680)
COMBUSTION_RATE = (5, 15)
SIZE_2MM = (20, 35)
SIZE_025MM = (5, 12)
MAX_UNLOADING_MOISTURE_GAIN = 1.5


def _r2(value: float) -> float:
    return round(value, 2)


def _clip(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def _round_field(key: str, value: float):
    if key in INTEGER_FIELDS:
        return int(round(value))
    if key == 'hgi':
        return round(value, 1)
    if key == 'csn':
        return round(value * 2) / 2
    return _r2(value)


def _sample(spec: dict, rng: random.Random) -> float:
    value = spec['typ'] + rng.gauss(0, (spec['max'] - spec['min']) / 6)
    return _clip(value, spec['min'], spec['max'])


def _within(value: float, spec: dict) -> bool:
    return spec['min'] <= value <= spec['max']


def _proximate(fields: dict, im: float, vm: float, ash: float) -> tuple[float, float, float, float]:
    """Close IM+VM+Ash+FC=100 with FC as the remainder, moving VM, then Ash and IM toward typ."""
    fc_spec, vm_spec = fields['fc_adb'], fields['vm_adb']
    typ = {k: _r2(fields[k]['typ']) for k in ('im_adb', 'vm_adb', 'ash_adb')}
    for im_try, ash_try in ((im, ash), (im, typ['ash_adb']), (typ['im_adb'], typ['ash_adb'])):
        fc = _r2(100 - im_try - vm - ash_try)
        if _within(fc, fc_spec):
            return im_try, vm, ash_try, fc
        target = _r2(_clip(fc, fc_spec['min'], fc_spec['max']))
        vm_try = _r2(100 - im_try - ash_try - target)
        if _within(vm_try, vm_spec):
            return im_try, vm_try, ash_try, _r2(100 - im_try - vm_try - ash_try)
    im, vm, ash = typ['im_adb'], typ['vm_adb'], typ['ash_adb']
    return im, vm, ash, _r2(100 - im - vm - ash)


def _ar(value_adb: float, tm: float, im: float) -> float:
    return _r2(value_adb * (100 - tm) / (100 - im))


def _apply_moisture(a: dict, tm: float) -> None:
    """Recompute every as-received value from DB/ADB values for the total moisture tm."""
    a['tm_ar'] = tm
    a['gcv_arb'] = int(round(a['gcv_db'] * (100 - tm) / 100))
    a['sulfur_ar'] = _r2(a['s_db'] * (100 - tm) / 100)
    a['ncv'] = int(round(a['gcv_arb'] - 5.83 * (9 * a['h_db'] * (100 - tm) / 100 + tm)))
    a['ncv_basis'] = 'AR'
    a.update(cv=a['gcv_arb'], cv_basis='GAR', moisture_pct=tm, sulfur_pct=a['sulfur_ar'], analysis_basis='AR',
             ash_pct=_ar(a['ash_adb'], tm, a['im_adb']), volatile_pct=_ar(a['vm_adb'], tm, a['im_adb']),
             fixed_carbon_pct=_ar(a['fc_adb'], tm, a['im_adb']))


def make_loading_assay(profile: dict, rng: random.Random) -> dict:
    fields = profile['fields']
    s = {key: _round_field(key, _sample(fields[key], rng)) for key in SAMPLE_ORDER}
    a: dict = {}

    im, vm, ash, fc = _proximate(fields, s['im_adb'], s['vm_adb'], s['ash_adb'])
    a.update(im_adb=im, vm_adb=vm, ash_adb=ash, fc_adb=fc)

    ash_db = ash * 100 / (100 - im)
    c, h, n, sulfur = s['c_db'], s['h_db'], s['n_db'], s['s_db']
    o = _r2(100 - c - h - n - sulfur - ash_db)
    if o < MIN_OXYGEN_DB:
        c = _r2(c - (MIN_OXYGEN_DB - o))
        o = _r2(100 - c - h - n - sulfur - ash_db)
    a.update(c_db=c, h_db=h, n_db=n, o_db=o, s_db=sulfur)

    tm = s['tm_ar']
    a['gcv_db'] = int(round(s['gcv_arb'] * 100 / (100 - tm)))
    a['gcv_adb'] = int(round(a['gcv_db'] * (100 - im) / 100))

    oxides = {k: s[k] for k in OXIDES}
    other = _r2(100 - sum(oxides.values()))
    if other < 0:
        oxides['sio2'] = _r2(oxides['sio2'] + other)
        other = 0.0
    a.update(oxides, ash_other=other)

    it = s['fusion_it']
    st = it + int(round(rng.uniform(20, 60)))
    ht = st + int(round(rng.uniform(10, 40)))
    ft = ht + int(round(rng.uniform(10, 50)))
    a.update(fusion_it=it, fusion_st=st, fusion_ht=ht, fusion_ft=ft)

    a['combustion_start_c'] = int(round(_clip(340 - (vm - 25) * 3, *COMBUSTION_START)))
    a['combustion_peak_c'] = int(round(rng.uniform(*COMBUSTION_PEAK)))
    a['combustion_end_c'] = int(round(rng.uniform(*COMBUSTION_END)))
    a['combustion_max_rate'] = _r2(rng.uniform(*COMBUSTION_RATE))
    size_2mm = _r2(rng.uniform(*SIZE_2MM))
    a['size_2mm'] = size_2mm
    a['size_025mm'] = min(_r2(rng.uniform(*SIZE_025MM)), size_2mm)

    a.update(hgi=s['hgi'], csn=s['csn'], chlorine_db_ppm=s['chlorine_db_ppm'])
    _apply_moisture(a, tm)
    a.update(result_status='confirmed', laboratory=LABORATORY)
    return a


def make_unloading_assay(loading: dict, rng: random.Random) -> dict:
    """Copy the loading assay, add moisture in transit and recompute only as-received values."""
    a = dict(loading)
    tm = _r2(min(loading['tm_ar'] + rng.uniform(0, MAX_UNLOADING_MOISTURE_GAIN), 100))
    _apply_moisture(a, tm)
    return a


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _bounds() -> dict[str, tuple[float, float]]:
    return {f['key']: (f['min'], f['max']) for f in SCHEMA['assays']['fields'] if f['kind'] == 'number'}


def check_assay(a: dict) -> list[str]:
    """Return the broken consistency rules; an empty list means the assay passes."""
    problems: list[str] = []

    def need(rule: str, *keys: str) -> bool:
        missing = [k for k in keys if not _number(a.get(k))]
        if missing:
            problems.append(f'{rule}: 값이 없습니다({", ".join(missing)}).')
        return not missing

    if need('공업분석', 'im_adb', 'vm_adb', 'ash_adb', 'fc_adb'):
        total = a['im_adb'] + a['vm_adb'] + a['ash_adb'] + a['fc_adb']
        if abs(total - 100) > PROXIMATE_TOLERANCE + 1e-9:
            problems.append(f'공업분석 합 IM+VM+Ash+FC={total:.2f}가 100±{PROXIMATE_TOLERANCE}이 아닙니다.')
    if need('원소분석', 'c_db', 'h_db', 'n_db', 's_db', 'o_db', 'ash_adb', 'im_adb') and a['im_adb'] < 100:
        ash_db = a['ash_adb'] * 100 / (100 - a['im_adb'])
        total = a['c_db'] + a['h_db'] + a['n_db'] + a['s_db'] + a['o_db'] + ash_db
        if abs(total - 100) > ULTIMATE_TOLERANCE + 1e-9:
            problems.append(f'원소분석 합 C+H+N+S+O+ash_db={total:.2f}가 100±{ULTIMATE_TOLERANCE}이 아닙니다.')
    if need('발열량 순서', 'gcv_arb', 'gcv_adb', 'gcv_db'):
        if not a['gcv_arb'] < a['gcv_adb'] < a['gcv_db']:
            problems.append('발열량 순서 gcv_arb < gcv_adb < gcv_db가 아닙니다.')
    if need('ncv', 'ncv', 'gcv_arb') and not a['ncv'] < a['gcv_arb']:
        problems.append('ncv가 gcv_arb보다 작지 않습니다.')
    if need('sulfur_ar', 'sulfur_ar', 's_db', 'tm_ar'):
        expected = a['s_db'] * (100 - a['tm_ar']) / 100
        if abs(a['sulfur_ar'] - expected) > SULFUR_TOLERANCE + 1e-9:
            problems.append(f'sulfur_ar가 s_db×(100−tm_ar)/100={expected:.3f}과 {SULFUR_TOLERANCE} 넘게 다릅니다.')
    if need('sulfur_pct', 'sulfur_pct', 'sulfur_ar') and a['sulfur_pct'] != a['sulfur_ar']:
        problems.append('sulfur_pct가 sulfur_ar와 다릅니다.')
    if need('회성분', *OXIDES, 'ash_other'):
        total = sum(a[k] for k in OXIDES) + a['ash_other']
        if abs(total - 100) > ASH_TOLERANCE + 1e-9:
            problems.append(f'회성분 합={total:.2f}가 100±{ASH_TOLERANCE}이 아닙니다.')
    if need('회융점', *FUSION_ORDER):
        values = [a[k] for k in FUSION_ORDER]
        if values != sorted(values):
            problems.append('회융점 순서 IT ≤ ST ≤ HT ≤ FT가 아닙니다.')
    if need('size_025mm', 'size_025mm', 'size_2mm') and a['size_025mm'] > a['size_2mm']:
        problems.append('size_025mm가 size_2mm보다 큽니다.')
    for key, (low, high) in _bounds().items():
        value = a.get(key)
        if value is None:
            continue
        if not _number(value) or not low <= value <= high:
            problems.append(f'{key}: 원장 범위({low}~{high})를 벗어납니다({value}).')
    return problems


def cargo_summary(a: dict) -> dict:
    """Cargo-level quality values, all on the as-received basis."""
    return {'cv': a['gcv_arb'], 'cv_basis': 'GAR', 'moisture_pct': a['tm_ar'],
            'ash_pct': _ar(a['ash_adb'], a['tm_ar'], a['im_adb']), 'sulfur_pct': a['sulfur_ar'],
            'analysis_basis': 'AR'}
