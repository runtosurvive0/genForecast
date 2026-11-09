from datetime import datetime, timedelta

import pytest

from midterm import voyage_registry
from midterm.assistant import checks
from midterm.assistant.checks import run_checks, sort_items
from midterm.assistant.tools import ToolContext
from midterm.stock_baseline import save_baseline
from midterm.stock_inventory import LOCATIONS
from midterm.supply import KST

AS_OF = '2026-11-05'
LOCS = sorted(LOCATIONS)
FULL = {'gcv_arb': 5800, 'tm_ar': 12, 'sulfur_ar': 0.5}


def ctx_for(path, days_after=0):
    day = datetime.fromisoformat(AS_OF).replace(hour=9, tzinfo=KST) + timedelta(days=days_after)
    return ToolContext(request=None, now=day, db_path=path)


def build(path, lots, assays=None, origin='manual', baseline_lots=None):
    """lots: (source_id, coal, tonnes, extra) rows; every lot gets its own voyage and cargo."""
    voyages, cargo, assay_rows, rows = [], [], [], []
    for i, (sid, coal, tonnes, extra) in enumerate(lots, 1):
        number = f'26-1-{i:03}'
        rows.append({'source_id': sid, 'location': LOCS[(i - 1) % len(LOCS)], 'coal_name': coal, 'tonnes': tonnes,
                     'voyage_number': number, 'grade': '고열량', **extra.get('lot', {})})
        voyages.append({'voyage_no': f'V{i}', 'voyage_number': number, 'status': 'arrived'})
        cargo.append({'cargo_no': f'C{i}', 'voyage_no': f'V{i}', 'destination_plant_id': 'dangjin', 'coal_name': coal,
                      'planned_t': 1000})
        if 'assay' in extra:
            assay_rows.append({'assay_id': f'A{i}', 'cargo_no': f'C{i}', 'stage': 'unloading',
                               'result_status': 'confirmed', **extra['assay']})
    voyage_registry.commit({'voyages': voyages, 'cargo': cargo, 'assays': assay_rows}, 0, 'user', origin, path)
    save_baseline({'as_of': AS_OF, 'lots': baseline_lots or rows}, 0, 'operator', path)


def by_id(result):
    return {i['id']: i for i in result['items']}


@pytest.fixture
def db(tmp_path):
    return tmp_path / 'checks.sqlite3'


def test_blend_quality_missing(db):
    build(db, [('s1', 'A', 100, {'assay': FULL}), ('s2', 'B', 100, {'assay': FULL}), ('s3', 'C', 100, {})])
    got = by_id(run_checks('blend', {}, ctx_for(db)))['blend.quality_missing']
    assert got['count'] == 1
    assert got['targets'][0]['reason'] == '성분 분석 없음'
    assert got['targets'][0]['label'] == f'{LOCS[2]} · C · 26-1-003'
    assert got['action'] == {'page': 'vessels', 'label': '항차 원장에서 확인'}
    assert got['title'] == '성분 분석과 연결되지 않은 원탄 1건'


@pytest.mark.parametrize('blank,reason', [('sulfur_ar', '황분 없음'), ('gcv_arb', '발열량 없음'), ('tm_ar', '총수분 없음')])
def test_blend_blank_field_is_missing(db, blank, reason):
    build(db, [('s1', 'A', 100, {'assay': {**FULL, blank: None}})])
    got = by_id(run_checks('blend', {}, ctx_for(db)))['blend.quality_missing']
    assert got['targets'][0]['reason'] == reason


def test_blend_quality_dummy(db):
    build(db, [('s1', 'A', 100, {'assay': {**FULL, 'data_origin': 'dummy', 'dummy_fields': 'gcv_arb'}}),
               ('s2', 'B', 100, {'assay': FULL})], origin='dummy-data')
    result = run_checks('blend', {}, ctx_for(db))
    assert by_id(result)['blend.quality_dummy']['count'] == 1
    assert result['details']['lots']['s1']['dummy'] is True
    assert result['details']['lots']['s2']['dummy'] is False


def test_blend_baseline_dummy(db):
    build(db, [('s1', 'A', 100, {'assay': FULL, 'lot': {'dummy_fields': 'age_days'}}),
               ('s2', 'B', 100, {'assay': FULL})], baseline_lots=None)
    # the human-edit rule drops marks on a first save, so check via the dummy actor
    rows = [{'source_id': 's1', 'location': LOCS[0], 'coal_name': 'A', 'tonnes': 100, 'voyage_number': '26-1-001',
             'grade': '고열량', 'dummy_fields': 'age_days'}]
    save_baseline({'as_of': AS_OF, 'lots': rows}, 1, 'dummy-seed', db)
    got = by_id(run_checks('blend', {}, ctx_for(db)))['blend.baseline_dummy']
    assert got['count'] == 1
    assert got['title'] == '더미로 채운 기준재고 칸이 있는 원탄 1건'


def test_blend_baseline_stale(db):
    build(db, [('s1', 'A', 100, {'assay': FULL})])
    old = by_id(run_checks('blend', {}, ctx_for(db, 4)))['blend.baseline_stale']
    assert old['kind'] == 'stale'
    assert old['title'] == '기준재고가 4일 전(2026-11-05) 기준입니다'
    assert 'blend.baseline_stale' not in by_id(run_checks('blend', {}, ctx_for(db, 3)))


def test_blend_grade_unknown(db):
    build(db, [('s1', 'A', 100, {'assay': FULL, 'lot': {'grade': ''}}), ('s2', 'B', 100, {'assay': FULL})])
    result = run_checks('blend', {}, ctx_for(db))
    assert by_id(result)['blend.grade_unknown']['count'] == 1
    assert result['details']['lots']['s1']['grade'] is None
    assert result['details']['lots']['s2']['grade'] == '고'


def test_blend_tonnes_zero_ignored(db):
    build(db, [('s1', 'A', 0, {'lot': {'grade': ''}})])
    result = run_checks('blend', {}, ctx_for(db))
    assert result['items'] == []
    assert result['details'] == {'lots': {}}


def test_blend_no_baseline(db):
    result = run_checks('blend', {}, ctx_for(db))
    assert [i['id'] for i in result['items']] == ['blend.no_baseline']
    item = result['items'][0]
    assert item['kind'] == 'missing' and item['title'] == '기준재고가 없습니다'
    assert item['action'] == {'page': 'inventory', 'label': '재고 원장에서 등록'}
    assert result['details'] == {'lots': {}}
    assert result['errors'] == []


def test_targets_capped_at_20(db):
    build(db, [(f's{i}', f'C{i}', 10, {}) for i in range(25)])
    got = by_id(run_checks('blend', {}, ctx_for(db)))['blend.quality_missing']
    assert got['count'] == 25
    assert len(got['targets']) == 20


def test_result_shape_and_as_of(db):
    build(db, [('s1', 'A', 100, {'assay': FULL})])
    result = run_checks('blend', {}, ctx_for(db))
    assert result['screen'] == 'blend' and result['as_of'] == '2026-11-05T09:00:00+09:00'
    assert result['items'] == [] and result['errors'] == []


def test_sort_order():
    def item(id, kind, count):
        return {'id': id, 'kind': kind, 'count': count}
    items = [item('sample', 'sample', 1), item('dummy', 'dummy', 1), item('missing1', 'missing', 1),
             item('missing5', 'missing', 5), item('stale', 'stale', 1)]
    assert [i['id'] for i in sort_items(items)] == ['missing5', 'missing1', 'stale', 'dummy', 'sample']


def test_unknown_screen(db):
    with pytest.raises(ValueError, match='알 수 없는 화면'):
        run_checks('x', {}, ctx_for(db))


def test_rule_exception_goes_to_errors(db, monkeypatch):
    def boom(params, ctx):
        raise RuntimeError('boom')
    monkeypatch.setitem(checks._RULES, 'blend', boom)
    result = run_checks('blend', {}, ctx_for(db))
    assert result['items'] == []
    assert result['errors'] == ['상탄·혼탄 점검 실패: 내부 오류(서버 로그 확인)']


def test_rule_value_error_message_is_kept(db, monkeypatch):
    def bad(params, ctx):
        raise ValueError('저장된 입력 세트가 없습니다')
    monkeypatch.setitem(checks._RULES, 'blend', bad)
    result = run_checks('blend', {}, ctx_for(db))
    assert result['errors'] == ['상탄·혼탄 점검 실패: 저장된 입력 세트가 없습니다']


def test_rule_os_error_path_not_in_response(db, monkeypatch):
    def bad(params, ctx):
        raise OSError(2, 'unable to open database file', 'X:/secret/path/db.sqlite3')
    monkeypatch.setitem(checks._RULES, 'blend', bad)
    result = run_checks('blend', {}, ctx_for(db))
    assert 'secret' not in repr(result) and 'sqlite3' not in repr(result)
    assert result['errors'][0].startswith('상탄·혼탄 점검 실패:')


def test_blend_same_label_lots_both_kept(db):
    row = {'location': LOCS[0], 'coal_name': 'A', 'tonnes': 100, 'voyage_number': '26-1-001', 'grade': '고열량'}
    build(db, [('s1', 'A', 100, {'assay': FULL})], baseline_lots=[row, dict(row)])
    lots = run_checks('blend', {}, ctx_for(db))['details']['lots']
    assert len(lots) == 2


# ---- simulation / planning_input / forecast / scenario ----
from midterm import milp_store  # noqa: E402
from midterm.web import planning_api  # noqa: E402

PRICES_OK = {'U1': [100.0] * 12, 'U2': [100.0] * 12}


class FakeUnit:
    def __init__(self, name):
        self.name = name


def stub_input(monkeypatch, scenario=None, prices=None, units=('U1', 'U2'), reference=None):
    scen = {'name': 'x', 'start': '2027-01-01', 'end': '2027-12-31', 'coal_oh': [{'unit': 'U1'}]}
    scen.update(scenario or {})
    payload = {'scenario': scen, 'heat_prices': PRICES_OK if prices is None else prices}
    if reference:
        payload['input_reference'] = reference
    monkeypatch.setattr(milp_store, 'list_inputs', lambda path=None: [{'id': 7, 'name': 'x'}, {'id': 3, 'name': 'y'}])
    monkeypatch.setattr(milp_store, 'get_input', lambda i, path=None: {'id': i, 'payload': payload})
    monkeypatch.setattr(checks, 'load_coal_units', lambda rows=None: [FakeUnit(n) for n in
                        ([r['name'] for r in rows] if rows else units)])


def test_simulation_no_run(db, monkeypatch):
    monkeypatch.setattr(milp_store, 'stored_runs', lambda path=None: [{'id': 'r1', 'state': 'error'}])
    got = run_checks('simulation', {}, ctx_for(db))
    assert [i['id'] for i in got['items']] == ['simulation.no_run']
    assert got['items'][0]['kind'] == 'missing'
    assert got['items'][0]['action'] == {'page': 'data', 'label': '전망 입력·계산 열기'}


def test_simulation_issues_mapped(db, monkeypatch):
    seen = []
    monkeypatch.setattr(milp_store, 'stored_runs', lambda path=None: [
        {'id': 'new', 'state': 'done'}, {'id': 'old', 'state': 'done'}])

    def snap(run_id, start, horizon):
        seen.append((run_id, start, horizon))
        return {'issues': ['수기 기준재고 미등록', '기준시각 경과 · 3일']}
    monkeypatch.setattr(planning_api, 'snapshot', snap)
    got = run_checks('simulation', {}, ctx_for(db))
    items = by_id(got)
    assert seen == [('new', None, 30)]
    assert items['simulation.issue.0']['kind'] == 'missing'
    assert items['simulation.issue.1']['kind'] == 'stale'
    assert all(i['targets'] == [] and i['count'] == 1 for i in got['items'])
    assert got['errors'] == []


def test_simulation_unknown_run(db, monkeypatch):
    monkeypatch.setattr(milp_store, 'stored_runs', lambda path=None: [{'id': 'r1', 'state': 'done'}])

    def snap(run_id, start, horizon):
        raise ValueError('실행 없음')
    monkeypatch.setattr(planning_api, 'snapshot', snap)
    got = run_checks('simulation', {'run_id': 'gone'}, ctx_for(db))
    assert got['items'] == []
    assert got['errors'][0].startswith('통합 시뮬레이션 점검 실패:')


def test_planning_input_price_missing(db, monkeypatch):
    stub_input(monkeypatch, prices={'U1': [100.0] * 11 + [0.0]})
    got = by_id(run_checks('planning_input', {'input_id': 7}, ctx_for(db)))['planning_input.price_missing']
    assert got['kind'] == 'missing'
    labels = {t['label']: t['reason'] for t in got['targets']}
    assert set(labels) == {'U1', 'U2'}
    assert '12월' in labels['U1']


def test_planning_input_price_uses_reference_units(db, monkeypatch):
    stub_input(monkeypatch, prices={'R1': [1.0] * 12}, reference={'coal_units': [{'name': 'R1'}]})
    got = by_id(run_checks('planning_input', {}, ctx_for(db)))
    assert 'planning_input.price_missing' not in got


def test_planning_input_no_maintenance(db, monkeypatch):
    stub_input(monkeypatch, scenario={'coal_oh': []})
    got = by_id(run_checks('planning_input', {}, ctx_for(db)))['planning_input.no_maintenance']
    assert '무정비 확정을 의미하지 않습니다' in got['detail']


def test_planning_input_price_estimated(db, monkeypatch):
    stub_input(monkeypatch, scenario={'start': '2026-11-10', 'end': '2027-02-07'})
    got = by_id(run_checks('planning_input', {}, ctx_for(db)))['planning_input.price_estimated']
    assert got['kind'] == 'stale'
    assert [t['label'] for t in got['targets']] == ['2026-11', '2026-12']
    stub_input(monkeypatch)
    assert 'planning_input.price_estimated' not in by_id(run_checks('planning_input', {}, ctx_for(db)))


def test_planning_input_none_saved(db, monkeypatch):
    monkeypatch.setattr(milp_store, 'list_inputs', lambda path=None: [])
    got = run_checks('planning_input', {}, ctx_for(db))
    assert [i['id'] for i in got['items']] == ['planning_input.no_input']


def test_forecast_sample_inputs(db):
    got = by_id(run_checks('forecast', {'live': ['stock']}, ctx_for(db)))['forecast.sample_inputs']
    assert got['kind'] == 'sample'
    assert [t['label'] for t in got['targets']] == ['하역 잔량', '호기 출력']
    assert run_checks('forecast', {'live': ['stock', 'ships', 'units']}, ctx_for(db))['items'] == []


def test_forecast_unknown_live_name(db):
    with pytest.raises(ValueError):
        run_checks('forecast', {'live': ['x']}, ctx_for(db))


def test_scenario_sample_all(db):
    got = run_checks('scenario', {}, ctx_for(db))
    assert [i['id'] for i in got['items']] == ['scenario.sample_all']
    assert got['items'][0]['title'] == '이 화면은 표본 자료로 계산합니다'
    assert got['items'][0]['kind'] == 'sample'


def test_simulation_http_exception_detail_in_errors(db, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(milp_store, 'stored_runs', lambda path=None: [{'id': 'r1', 'state': 'done'}])

    def snap(run_id, start, horizon):
        raise HTTPException(404, detail='계산 실행을 찾을 수 없습니다')
    monkeypatch.setattr(planning_api, 'snapshot', snap)
    got = run_checks('simulation', {}, ctx_for(db))
    assert got['items'] == []
    assert got['errors'] == ['통합 시뮬레이션 점검 실패: 계산 실행을 찾을 수 없습니다']


def test_live_non_string_is_value_error(db):
    for bad in ([1], [['stock']], [{'a': 1}], 'stock'):
        with pytest.raises(ValueError):
            run_checks('forecast', {'live': bad}, ctx_for(db))
