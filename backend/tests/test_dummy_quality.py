import random

import pytest

from midterm.dummy_data.profiles import load_profiles
from midterm.dummy_data.quality import cargo_summary, check_assay, make_loading_assay, make_unloading_assay
from midterm.voyage_registry import SCHEMA

ALL_COALS = sorted(load_profiles()['coals'])


def _pair(name='Glencore', seed=0):
    p = load_profiles()['coals'][name]
    rng = random.Random(f'{seed}:{name}')
    a = make_loading_assay(p, rng)
    return a, make_unloading_assay(a, rng)


@pytest.mark.parametrize('name', ALL_COALS)
@pytest.mark.parametrize('seed', range(20))
def test_assays_pass_all_consistency_rules(name, seed):
    p = load_profiles()['coals'][name]; rng = random.Random(f'{seed}:{name}')
    a = make_loading_assay(p, rng); u = make_unloading_assay(a, rng)
    assert check_assay(a) == [] and check_assay(u) == []


def test_loading_assay_has_only_assay_value_fields():
    a, _ = _pair()
    keys = {f['key'] for f in SCHEMA['assays']['fields']}
    assert set(a) <= keys
    assert not {'assay_id', 'cargo_no', 'sample_date', 'analysis_date'} & set(a)
    assert a['result_status'] == 'confirmed' and a['laboratory'] == '더미(공개 일반값)'
    assert a['ncv_basis'] == 'AR' and a['cv_basis'] == 'GAR' and a['analysis_basis'] == 'AR'
    assert a['csn'] * 2 == int(a['csn'] * 2)
    assert all(isinstance(a[k], int) for k in ('gcv_arb', 'gcv_adb', 'gcv_db', 'ncv', 'fusion_it', 'fusion_ft'))


def _break(key, value):
    return lambda a: a.__setitem__(key, value)


def _shift(key, delta):
    return lambda a: a.__setitem__(key, a[key] + delta)


BROKEN = [
    ('공업분석', _shift('fc_adb', 0.5)),
    ('원소분석', _shift('o_db', 1.0)),
    ('발열량 순서', lambda a: a.__setitem__('gcv_adb', a['gcv_db'] + 1)),
    ('발열량 순서', lambda a: a.__setitem__('gcv_arb', a['gcv_adb'])),
    ('ncv', lambda a: a.__setitem__('ncv', a['gcv_arb'])),
    ('sulfur_ar', _shift('sulfur_ar', 0.05)),
    ('sulfur_pct', _shift('sulfur_pct', 0.05)),
    ('회성분', _shift('ash_other', 1.0)),
    ('회융점', lambda a: a.__setitem__('fusion_st', a['fusion_it'] - 1)),
    ('회융점', lambda a: a.__setitem__('fusion_ft', a['fusion_ht'] - 1)),
    ('원장 범위', _break('hgi', 250)),
    ('원장 범위', _break('ash_pct', -1)),
    ('원장 범위', _break('cv', 500)),
    ('size_025mm', lambda a: a.__setitem__('size_025mm', a['size_2mm'] + 1)),
]


@pytest.mark.parametrize('phrase, breaker', BROKEN)
def test_check_assay_rules(phrase, breaker):
    a, _ = _pair()
    assert check_assay(a) == []
    breaker(a)
    problems = check_assay(a)
    assert any(phrase in p for p in problems), problems


def test_check_assay_reports_missing_values():
    a, _ = _pair()
    del a['s_db']
    assert any('s_db' in p for p in check_assay(a))


def test_unloading_moisture_rises_and_ar_heat_falls():
    for name in ALL_COALS:
        for seed in range(5):
            a, u = _pair(name, seed)
            assert 0 <= u['tm_ar'] - a['tm_ar'] <= 1.5
            assert u['gcv_arb'] <= a['gcv_arb']
            assert u['gcv_db'] == a['gcv_db'] and u['gcv_adb'] == a['gcv_adb']
            for k in ('im_adb', 'vm_adb', 'ash_adb', 'fc_adb', 'c_db', 'h_db', 'o_db', 's_db', 'sio2', 'fusion_it'):
                assert u[k] == a[k]
            assert u['moisture_pct'] == u['tm_ar'] and u['cv'] == u['gcv_arb'] and u['sulfur_pct'] == u['sulfur_ar']


def test_unloading_uses_rng_once():
    a, _ = _pair()
    rng1, rng2 = random.Random(7), random.Random(7)
    make_unloading_assay(a, rng1)
    rng2.random()
    assert rng1.random() == rng2.random()


def test_unloading_does_not_change_loading():
    a, _ = _pair()
    before = dict(a)
    make_unloading_assay(a, random.Random(1))
    assert a == before


def test_same_seed_same_assay():
    assert _pair('LXI', 3) == _pair('LXI', 3)
    assert _pair('LXI', 3) != _pair('LXI', 4)


def test_cargo_summary_uses_ar_basis():
    _, u = _pair('KCH(adaro)', 2)
    expected_ash = round(u['ash_adb'] * (100 - u['tm_ar']) / (100 - u['im_adb']), 2)
    assert cargo_summary(u) == {'cv': u['gcv_arb'], 'cv_basis': 'GAR', 'moisture_pct': u['tm_ar'],
                                'ash_pct': expected_ash, 'sulfur_pct': u['sulfur_ar'], 'analysis_basis': 'AR'}
