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
    assert result['errors'] == ['상탄·혼탄 점검 실패: boom']
