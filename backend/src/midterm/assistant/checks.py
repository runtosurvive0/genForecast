"""Read-only screen checks: what the open screen is missing, faking, sampling or has gone stale on."""
import logging
from datetime import date

from midterm import milp_store, stock_baseline, voyage_registry
from midterm.baseline_quality import QUALITY_FIELDS, match_lot_quality
from midterm.fleet import load_coal_units
from midterm.stacking import load_layout, yard_space
from midterm.supply import KST

logger = logging.getLogger(__name__)


class CheckError(ValueError):
    """이 모듈이 직접 만든 검증 오류. 메시지는 응답에 그대로 실어도 된다."""

SCREENS = ('blend', 'forecast', 'simulation', 'planning_input', 'scenario')
SCREEN_LABELS = {'blend': '상탄·혼탄', 'forecast': '수급 예측', 'simulation': '통합 시뮬레이션',
                 'planning_input': '전망 입력·계산', 'scenario': '시나리오 분석'}
BASELINE_STALE_DAYS = 3
MAX_TARGETS = 20
KIND_ORDER = {'missing': 0, 'stale': 1, 'dummy': 2, 'sample': 3}
ESTIMATED_PRICE_MONTHS = ('2026-11', '2026-12')
LIVE_INPUTS = {'stock': '저탄장 재고', 'ships': '하역 잔량', 'units': '호기 출력'}
FIELD_REASONS = {'gcv_arb': '발열량 없음', 'tm_ar': '총수분 없음', 'sulfur_ar': '황분 없음'}


def sort_items(items):
    return sorted(items, key=lambda i: (KIND_ORDER[i['kind']], -i['count']))


def _item(id, kind, title, detail, targets=(), action=None, count=None):
    targets = list(targets)
    return {'id': id, 'kind': kind, 'title': title, 'detail': detail,
            'count': len(targets) if count is None else count,
            'targets': targets[:MAX_TARGETS], 'action': action}


def _grouped(id, kind, title_text, detail, targets, action):
    if not targets:
        return None
    return _item(id, kind, f'{title_text} {len(targets)}건', detail, targets, action)


def _lot_label(row):
    return f"{row.get('location')} · {row.get('coal_name')} · {row.get('voyage_number') or '항차 미확인'}"


def _stacking_items(lots):
    """적치 추천이 모의 값을 쓴다는 알림과, 구간을 모르는 원탄(추천에서 빠지는 Pile)."""
    items = [_item('stacking.mock_layout', 'dummy', '적치 추천은 모의 Pile 길이·칸 용량을 씁니다',
                   'Pile 길이, 구간 정보가 없는 Pile의 m당 톤수, Shed 칸 용량과 반입 경로는 모의 값입니다.', count=1)]
    if lots:
        space = yard_space(lots, load_layout())['piles']
        unplaced = [{'label': _lot_label(r), 'reason': '구간 미확인'} for r in lots
                    if space.get(str(r.get('location') or '').strip().upper(), {}).get('unplaced')]
        items.append(_grouped('stacking.unplaced', 'missing', '구간을 모르는 원탄',
                              'Pile의 시작·끝 위치(m)가 없는 원탄이 있는 Pile은 적치 추천에서 빠집니다.',
                              unplaced, {'page': 'inventory', 'label': '재고 원장에서 확인'}))
    return items


def _blend(params, ctx):
    baseline = stock_baseline.read_baseline(ctx.db_path)
    if not baseline.get('as_of') or not baseline['lots']:
        item = _item('blend.no_baseline', 'missing', '기준재고가 없습니다',
                     '등록된 기준재고가 없어 혼탄 계산에 쓸 원탄이 없습니다.',
                     action={'page': 'inventory', 'label': '재고 원장에서 등록'}, count=1)
        return [item], {'lots': {}}
    lots = [r for r in baseline['lots'] if (r.get('tonnes') or 0) > 0]
    register = voyage_registry.snapshot(ctx.db_path)
    missing, grade_unknown, q_dummy, b_dummy, details = [], [], [], [], {}
    for row in lots:
        label = _lot_label(row)
        match = match_lot_quality(row, register)
        assay = match['assay']
        reasons = [match['reason']] if not assay else [FIELD_REASONS[k] for k in QUALITY_FIELDS if assay.get(k) is None]
        if reasons:
            missing.append({'label': label, 'reason': ', '.join(reasons)})
        used_dummy = bool(assay) and (assay.get('data_origin') == 'dummy'
                                      or bool(stock_baseline.dummy_names(assay) & set(QUALITY_FIELDS)))
        if used_dummy:
            q_dummy.append({'label': label, 'reason': '더미 성분 사용'})
        names = stock_baseline.dummy_names(row)
        if names:
            b_dummy.append({'label': label, 'reason': '더미 칸: ' + ', '.join(sorted(names))})
        text = str(row.get('grade') or '').strip()
        if not text:
            grade_unknown.append({'label': label, 'reason': '고열량·저열량 구분 없음'})
        a = assay or {}
        key = row.get('source_id') or label
        n = 1
        while key in details:
            n += 1
            key = f"{row.get('source_id') or label} ({n})"
        details[key] = {
            'grade': text[:1] if text[:1] in ('고', '저') else None,
            'gcv_arb': a.get('gcv_arb'), 'sulfur_ar': a.get('sulfur_ar'), 'tm_ar': a.get('tm_ar'),
            'dummy': used_dummy, 'reason': ', '.join(reasons) or None}
    items = [
        _grouped('blend.quality_missing', 'missing', '성분 분석과 연결되지 않은 원탄',
                 '항차·탄종으로 화물을 찾지 못했거나 발열량·총수분·황분이 없어 혼탄 계산에서 빠집니다.',
                 missing, {'page': 'vessels', 'label': '항차 원장에서 확인'}),
        _grouped('blend.grade_unknown', 'missing', '고열량·저열량 구분이 없는 원탄',
                 '고열량·저열량을 구분하지 못하면 저열 우선 소진 판단을 할 수 없습니다.',
                 grade_unknown, {'page': 'inventory', 'label': '재고 원장에서 확인'}),
        _grouped('blend.quality_dummy', 'dummy', '더미 성분을 쓰는 원탄',
                 '성분 분석 값이 더미 자료입니다.', q_dummy, {'page': 'vessels', 'label': '항차 원장에서 확인'}),
        _grouped('blend.baseline_dummy', 'dummy', '더미로 채운 기준재고 칸이 있는 원탄',
                 '기준재고 일부 칸이 더미 값입니다.', b_dummy, {'page': 'inventory', 'label': '재고 원장에서 확인'}),
    ]
    age = (ctx.now.astimezone(KST).date() - date.fromisoformat(baseline['as_of'])).days
    if age > BASELINE_STALE_DAYS:
        items.append(_item('blend.baseline_stale', 'stale',
                           f"기준재고가 {age}일 전({baseline['as_of']}) 기준입니다",
                           f'기준일이 {BASELINE_STALE_DAYS}일을 넘게 지났습니다. 현재 재고와 다를 수 있습니다.',
                           action={'page': 'inventory', 'label': '재고 원장에서 갱신'}, count=1))
    items.extend(_stacking_items(lots))
    return [i for i in items if i], {'lots': details}


def _horizon(run_id, ctx):
    """계산 기간 이하에서 snapshot이 허용하는 가장 큰 조회 기간(최대 30일). 기간을 모르면 30."""
    for record in milp_store.stored_runs(ctx.db_path):
        if record.get('id') != run_id:
            continue
        scenario = ((record.get('summary') or {}).get('scenario')) or {}
        try:
            days = (date.fromisoformat(str(scenario['end'])[:10]) - date.fromisoformat(str(scenario['start'])[:10])).days + 1
        except (KeyError, ValueError):
            return 30
        return 30 if days >= 30 else 7
    return 30


def _simulation(params, ctx):
    from midterm.web import planning_api
    run_id = params.get('run_id')
    if not run_id:
        done = [r for r in milp_store.stored_runs(ctx.db_path) if r.get('state') == 'done']
        if not done:
            item = _item('simulation.no_run', 'missing', '완료된 계산이 없습니다',
                         '통합 시뮬레이션이 읽을 완료된 계산이 없습니다.',
                         action={'page': 'data', 'label': '전망 입력·계산 열기'}, count=1)
            return [item], None
        run_id = done[0]['id']
    issues = planning_api.snapshot(run_id, None, _horizon(run_id, ctx))['issues']
    items = []
    for n, text in enumerate(issues):
        kind = 'stale' if ('경과' in text or 'stale' in text.lower()) else 'missing'
        items.append(_item(f'simulation.issue.{n}', kind, text, '선택한 계산 결과를 읽으며 확인된 사항입니다.', count=1))
    return items, None


def _planning_input(params, ctx):
    input_id = params.get('input_id')
    if input_id is None:
        saved = milp_store.list_inputs(ctx.db_path)
        if not saved:
            item = _item('planning_input.no_input', 'missing', '저장된 전망 입력이 없습니다',
                         '저장된 입력 세트가 없어 점검할 내용이 없습니다.',
                         action={'page': 'data', 'label': '전망 입력·계산 열기'}, count=1)
            return [item], None
        input_id = saved[0]['id']
    try:
        payload = milp_store.get_input(input_id, ctx.db_path)['payload']
    except ValueError:
        raise CheckError('저장된 입력 세트가 없습니다') from None
    scenario = payload.get('scenario') or {}
    reference = payload.get('input_reference')
    units = load_coal_units(rows=reference['coal_units']) if reference else load_coal_units()
    prices = payload.get('heat_prices') or {}
    bad = []
    for unit in sorted(u.name for u in units):
        values = prices.get(unit)
        if not values:
            bad.append({'label': unit, 'reason': '열량단가 없음'})
            continue
        months = [f'{m}월' for m, v in enumerate(values, 1) if not isinstance(v, (int, float)) or not v > 0]
        if months:
            bad.append({'label': unit, 'reason': ', '.join(months) + ' 단가 없음 또는 0 이하'})
    action = {'page': 'data', 'label': '전망 입력·계산 열기'}
    items = [_grouped('planning_input.price_missing', 'missing', '열량단가가 빠진 호기',
                      '호기별 1~12월 열량단가는 양수여야 계산할 수 있습니다.', bad, action)]
    if not scenario.get('coal_oh'):
        items.append(_item('planning_input.no_maintenance', 'missing', '등록된 석탄 정비 일정이 없습니다',
                           '등록된 정비 일정이 없다는 뜻이며, 무정비 확정을 의미하지 않습니다.', action=action, count=1))
    first, last = str(scenario.get('start', ''))[:7], str(scenario.get('end', ''))[:7]
    months = [m for m in ESTIMATED_PRICE_MONTHS if first <= m <= last]
    if months:
        items.append(_item('planning_input.price_estimated', 'stale', '추정 단가를 쓰는 달이 계산 기간에 있습니다',
                           '이 달들의 열량단가는 확정 전 추정 값입니다.',
                           [{'label': m, 'reason': '추정 단가'} for m in months], action))
    return [i for i in items if i], None


def _forecast(params, ctx):
    live = params.get('live') or []
    sample = [{'label': name, 'reason': '표본 자료 사용'} for key, name in LIVE_INPUTS.items() if key not in live]
    items = _stacking_items([])
    if sample:
        items.append(_item('forecast.sample_inputs', 'sample', f'표본 자료로 계산하는 입력 {len(sample)}건',
                           '운전 연결값이 없는 입력은 표본 값으로 계산합니다.', sample))
    return items, None


def _scenario(params, ctx):
    return [_item('scenario.sample_all', 'sample', '이 화면은 표본 자료로 계산합니다',
                  '시나리오 분석은 표본 자료 기준이며 운영 실제 값이 아닙니다.', count=1)], None


_RULES = {'blend': _blend, 'forecast': _forecast, 'simulation': _simulation,
          'planning_input': _planning_input, 'scenario': _scenario}


def _validate(screen, params):
    if screen not in SCREENS:
        raise CheckError(f'알 수 없는 화면: {screen}')
    if screen == 'forecast':
        live = params.get('live') or []
        if not isinstance(live, (list, tuple)) or any(not isinstance(n, str) or n not in LIVE_INPUTS for n in live):
            raise CheckError('알 수 없는 live 입력 이름: 허용 값은 ' + ', '.join(LIVE_INPUTS))


def _reason(exc):
    if isinstance(exc, CheckError):
        return str(exc)
    detail = getattr(exc, 'detail', None)  # fastapi HTTPException messages are ours
    if isinstance(detail, str):
        return detail
    return '내부 오류(서버 로그 확인)'


def run_checks(screen, params, ctx):
    params = params or {}
    _validate(screen, params)
    result = {'screen': screen, 'as_of': ctx.now.astimezone(KST).isoformat(), 'items': [], 'errors': []}
    try:
        items, details = _RULES[screen](params, ctx)
    except Exception as exc:  # a failing rule is reported, never turned into an item
        logger.exception('screen check failed: %s', screen)
        result['errors'].append(f'{SCREEN_LABELS[screen]} 점검 실패: {_reason(exc)}')
        return result
    result['items'] = sort_items(items)
    if details is not None:
        result['details'] = details
    return result
