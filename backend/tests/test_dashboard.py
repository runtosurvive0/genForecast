from datetime import date

import numpy as np
import pytest

from midterm.dashboard import aggregate_fuel, heat_consumption
from midterm.database import connect, load_settings, save_fuel_settings, save_settings
from midterm.outages import parse_outage_rows
from midterm.scenario import Scenario


def test_fuel_uses_hourly_quadratic_curve_and_excludes_idle_heat():
    output = np.array([[100., 0.], [300., 100.]])
    online = np.array([[1, 0], [1, 1]])
    coefficients = np.array([[.01, 2., 50.], [.02, 1., 80.]])
    heat = heat_consumption(output, online, coefficients)
    np.testing.assert_allclose(heat, [[350, 0], [1550, 380]])
    # 월평균 출력에 곡선을 적용하면 비선형 항을 과소평가한다.
    assert heat[:, 0].sum() != 2 * (.01 * 200 ** 2 + 2 * 200 + 50)


def test_daily_monthly_and_unit_tonnes_reconcile_at_5500_kcal():
    result = aggregate_fuel(['2027-01-31', '2027-01-31', '2027-02-01'],
                            ['당진1', '당진2'], np.array([[5500, 11000], [5500, 0], [0, 5500]]), 5500)
    assert result['daily'][0]['tonnes'] == 4000
    assert result['daily'][0]['unit_tonnes'] == {'당진1': 2000, '당진2': 2000}
    assert sum(r['tonnes'] for r in result['monthly']) == result['total']['tonnes'] == 5000


def test_unconfigured_calorific_value_stays_missing():
    result = aggregate_fuel(['2027-01-01'], ['당진1'], np.array([[5500]]), None)
    assert result['daily'][0]['heat_gcal'] == 5500
    assert result['daily'][0]['tonnes'] is None
    assert result['daily'][0]['unit_tonnes']['당진1'] is None


def test_db_persists_outages_and_external_fuel_update_preserves_them(tmp_path):
    path = tmp_path / 'planning.sqlite3'
    scenario = Scenario(name='DB 계획', start=date(2027, 1, 1), end=date(2027, 12, 31),
                        coal_oh=parse_outage_rows([['unit', 'start', 'end'],
                                                  ['당진3', '2027-03-01', '2027-04-10']]))
    save_settings(scenario, {'calorific_kcal_kg':5500, 'is_assumption':True}, path)
    with connect(path) as db:
        db.execute("INSERT INTO fuel_actual_daily VALUES('2027-01-01','당진1',100,'계량')")
    updated = save_fuel_settings({'calorific_kcal_kg':6000, 'is_assumption':False, 'source':'연계'}, path)
    assert updated['scenario']['coal_oh'][0]['end'] == '2027-04-10'
    assert updated['fuel']['calorific_kcal_kg'] == 6000
    assert updated['fuel']['source'] == '연계'
    assert load_settings(path)['scenario']['name'] == 'DB 계획'
    with connect(path) as db:
        assert db.execute('SELECT tonnes FROM fuel_actual_daily').fetchone()[0] == 100


@pytest.mark.parametrize('invalid', [-1, 0, 999, 10001, float('nan'), float('inf')])
def test_invalid_calorific_value_is_rejected(tmp_path, invalid):
    with pytest.raises(ValueError):
        save_settings(Scenario(), {'calorific_kcal_kg':invalid}, tmp_path / 'planning.sqlite3')
