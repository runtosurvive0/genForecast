import copy

from midterm.dummy_data.profiles import load_berths, load_profiles, validate_profiles

COALS = {'AVRA', 'MERCURIA', 'Flame', 'Glencore', 'Glencore(무연탄)', 'Centennial',
         'KCH(Kaltim)', 'KCH(adaro)', 'KCH(Arutmin)', 'LXI'}


def test_profiles_cover_all_registry_coals():
    assert set(load_profiles()['coals']) == COALS


def test_profiles_are_valid_and_marked_dummy():
    data = load_profiles()
    assert data['classification'] == 'dummy'
    assert validate_profiles(data) == []


def test_every_coal_has_source_or_estimate_label():
    for c in load_profiles()['coals'].values():
        assert c['confidence'] in ('근거있음', '추정')
        assert c['confidence'] == '추정' or c['sources']


def test_mercuria_differs_from_arutmin():
    coals = load_profiles()['coals']
    assert coals['MERCURIA']['fields'] != coals['KCH(Arutmin)']['fields']
    assert coals['MERCURIA']['confidence'] == '추정'


def test_validate_catches_out_of_order_range():
    data = load_profiles()
    data['coals']['LXI']['fields']['tm_ar']['min'] = 99
    assert validate_profiles(data)


def test_berths_cover_three_berths():
    assert set(load_berths()['berths']) == {'BD-1', 'BD-2', 'BD-3'}


def test_classes_follow_public_import_ranges():
    data = load_profiles()
    assert data['classes']['high_cv']['gcv_arb_min'] == 5700
    assert data['classes']['high_cv']['gcv_arb_max'] == 6500
    assert data['classes']['low_cv']['gcv_arb_min'] == 3700
    assert data['classes']['low_cv']['gcv_arb_max'] == 5349
    assert data['classes']['high_cv']['sulfur_ar_max'] == 0.8
    assert data['classes']['low_cv']['sulfur_ar_max'] == 1.0
    coals = data['coals']
    assert {k for k, c in coals.items() if c['class'] == 'low_cv'} == {
        'AVRA', 'MERCURIA', 'KCH(adaro)', 'KCH(Arutmin)', 'LXI'}
    assert coals['Glencore(무연탄)']['anthracite'] is True
    assert sum(c['anthracite'] for c in coals.values()) == 1


def test_low_cv_coals_are_wetter_than_high_cv_coals():
    coals = load_profiles()['coals']
    wettest_high = max(c['fields']['tm_ar']['typ'] for c in coals.values() if c['class'] == 'high_cv')
    driest_low = min(c['fields']['tm_ar']['typ'] for c in coals.values() if c['class'] == 'low_cv')
    assert wettest_high < driest_low


def test_fields_use_registry_column_names_only():
    from midterm.voyage_registry import SCHEMA
    numeric = {f['key'] for f in SCHEMA['assays']['fields'] if f['kind'] == 'number'}
    for c in load_profiles()['coals'].values():
        assert set(c['fields']) <= numeric
        assert 'fe2o3' in c['fields'] and 'chlorine_db_ppm' in c['fields']


def _broken(mutate):
    data = copy.deepcopy(load_profiles())
    mutate(data)
    return validate_profiles(data)


def test_validate_catches_each_rule():
    assert _broken(lambda d: d['coals'].pop('LXI'))
    assert _broken(lambda d: d['coals']['LXI'].update({'class': 'mid_cv'}))
    assert _broken(lambda d: d['coals']['LXI']['fields']['gcv_arb'].update({'typ': 6000, 'max': 6100}))
    assert _broken(lambda d: d['coals']['Flame']['fields']['fusion_st'].update({'typ': 1000, 'min': 900}))
    assert _broken(lambda d: d['coals']['Flame']['fields']['chlorine_db_ppm'].update({'max': 2_000_000}))
    assert _broken(lambda d: d['coals']['Flame']['fields'].update({'nar': {'typ': 1, 'min': 0, 'max': 2}}))
    assert _broken(lambda d: d['coals']['Flame'].update({'confidence': '확실'}))


def test_load_profiles_rejects_invalid_file(tmp_path):
    import json
    import pytest
    data = load_profiles()
    data['coals']['LXI']['fields']['tm_ar']['min'] = 99
    path = tmp_path / 'bad.json'
    path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    with pytest.raises(ValueError):
        load_profiles(path)
