from datetime import date, datetime
import copy

import numpy as np
import pytest

from midterm.fleet import CoalUnit, NuclearUnit, coal_inputs, nuclear_hourly
from midterm.milp_store import clean_input, get_input, price_rows, save_input
from midterm.outages import parse_outage_rows
from midterm.reference_data import normalize_master, regress_prices, rows_from_file, validate_reference
from midterm.scenario import ROOT, Scenario


def reference_fixture():
    coal = normalize_master(rows_from_file(ROOT / 'data/coal_units.csv.json'), 'coal')
    nuclear = normalize_master(rows_from_file(ROOT / 'data/nuclear_units.csv.json'), 'nuclear')
    dated = {r['unit']: {f'{year}-{month:02d}': 100. + month for year in (2026,2027) for month in range(1,13)} for r in coal}
    return {'coal_units':coal,'nuclear_units':nuclear,'heat_prices_by_month':dated}


def test_csv_prices_accept_grouped_numbers_and_outage_templates_skip_empty_dates():
    rows = [['unit',*[f'{m}월' for m in range(1,13)],''], ['당진1',*[' 12,345 ']*12,'']]
    assert price_rows(rows)['당진1'] == [12345.]*12
    assert not parse_outage_rows([['unit','start','end'],['당진1','','']])
    with pytest.raises(ValueError,match='날짜'):
        parse_outage_rows([['unit','start','end'],['당진1','2027-01-01','']])


def test_regression_uses_only_prior_months_and_preserves_holdout_separation():
    row = {'unit':'당진1', **{f'2026-{m:02d}':100.+10*m for m in range(1,11)}, '2027-01':999999.}
    prices, models = regress_prices([row],['2026-11','2026-12'])
    assert prices['당진1'] == {'2026-11':210.,'2026-12':220.}
    assert models['당진1']['trained_through'] == '2026-10'
    assert models['당진1']['holdout_training_through'] == '2026-08'
    assert models['당진1']['holdout_months'] == ['2026-09','2026-10']
    assert models['당진1']['holdout_rmse'] == pytest.approx(0)
    del row['2026-06']
    with pytest.raises(ValueError,match='월 누락'):
        regress_prices([row],['2026-11','2026-12'])


def test_prices_keep_different_years_and_nuclear_activation_respects_outage_end():
    u = CoalUnit('당진1','당진',50,10,50,1,1,1,1,0,(0,1,1),None)
    inputs = coal_inputs([u],{'당진1':[1.]*12},[],[datetime(2026,11,9),datetime(2027,11,9)],
                         prices_by_month={'당진1':{'2026-11':11.,'2027-11':110.}})
    assert inputs.costs[1,0] == pytest.approx(inputs.costs[0,0]*10)
    outage = parse_outage_rows([['unit','start','end'],['원전A','2027-01-02','2027-01-02']])
    total,_ = nuclear_hourly([NuclearUnit('원전A',1000,1000,False,date(2027,1,1))],outage,
        [datetime(2026,12,31),datetime(2027,1,1),datetime(2027,1,2),datetime(2027,1,3)])
    np.testing.assert_allclose(total,[0,1003,0,1003])


def test_reference_is_frozen_in_db_and_missing_month_is_rejected(tmp_path):
    reference = reference_fixture()
    scenario = Scenario(start=date(2026,11,9),end=date(2027,2,6))
    prices = {r['unit']:[100.]*12 for r in reference['coal_units']}
    original = copy.deepcopy(reference)
    payload = clean_input(scenario.to_json(),prices,{'calorific_kcal_kg':5500,'is_assumption':True},input_reference=reference)
    saved = save_input(payload,tmp_path/'private.sqlite3')
    reference['coal_units'][0]['heat_a1'] = 999
    assert get_input(saved['id'],tmp_path/'private.sqlite3')['payload']['input_reference']['coal_units'][0]['heat_a1'] == original['coal_units'][0]['heat_a1']
    del original['heat_prices_by_month'][original['coal_units'][0]['unit']]['2026-11']
    with pytest.raises(ValueError,match='연월 단가'):
        validate_reference(original,scenario)


def test_schedule_reads_saved_input_and_keeps_inclusive_csv_end(monkeypatch):
    from midterm import milp_store
    from midterm.web.inputs_api import outage_schedule
    scenario = Scenario(start=date(2026,11,9),end=date(2027,2,6)).to_json()
    scenario['coal_oh'] = [{'unit':'당진1','start':'2027-01-02','end':'2027-01-03','note':'test'}]
    monkeypatch.setattr(milp_store,'active_input',lambda:{'id':7,'payload':{'scenario':scenario,'input_reference':reference_fixture()}})
    result = outage_schedule()
    assert result['input_id'] == 7
    assert result['default_year'] == 2027
    assert result['rows'][0]['end'] == '2027-01-03'
    assert result['rows'][0]['end_at'] == '2027-01-04T00:00:00+09:00'


def test_reference_file_survives_the_upload_endpoint(tmp_path, monkeypatch):
    import asyncio
    import io
    import json
    from fastapi import UploadFile
    from midterm import milp_store
    from midterm.web import inputs_api
    reference = reference_fixture()
    scenario = Scenario(start=date(2026,11,9),end=date(2027,2,6)).to_json()
    columns = ['unit',*[f'{m}월' for m in range(1,13)]]
    prices = {'columns':columns,'rows':[{**{'unit':r['unit']},**{f'{m}월':100 for m in range(1,13)}} for r in reference['coal_units']]}
    def file(name, value):
        return UploadFile(filename=name,file=io.BytesIO(json.dumps(value).encode()))
    monkeypatch.setattr(inputs_api,'save_input',lambda payload:milp_store.save_input(payload,tmp_path/'test.sqlite3'))
    saved = asyncio.run(inputs_api.upload(scenario=file('scenario.json',scenario),heat_prices=file('prices.json',prices),
        nuclear=None,coal=None,input_reference=file('reference.json',reference),calorific=5500,assumption=True))
    assert saved['payload']['input_reference']['heat_prices_by_month'] == reference['heat_prices_by_month']
    assert len(saved['payload']['input_reference']['coal_units']) == 58
