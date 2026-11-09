"""Read-only screen checks: what the open screen is missing, faking, sampling or has gone stale on."""
from datetime import date

from midterm import stock_baseline, voyage_registry
from midterm.baseline_quality import QUALITY_FIELDS, match_lot_quality
from midterm.supply import KST

SCREENS = ('blend', 'forecast', 'simulation', 'planning_input', 'scenario')
SCREEN_LABELS = {'blend': '상탄·혼탄', 'forecast': '수급 예측', 'simulation': '통합 시뮬레이션',
                 'planning_input': '전망 입력·계산', 'scenario': '시나리오 분석'}
BASELINE_STALE_DAYS = 3
MAX_TARGETS = 20
KIND_ORDER = {'missing': 0, 'stale': 1, 'dummy': 2, 'sample': 3}
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
        details[row.get('source_id') or label] = {
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
    return [i for i in items if i], {'lots': details}


def _no_rules(params, ctx):
    return [], None


_RULES = {'blend': _blend, 'forecast': _no_rules, 'simulation': _no_rules,
          'planning_input': _no_rules, 'scenario': _no_rules}


def run_checks(screen, params, ctx):
    if screen not in SCREENS:
        raise ValueError(f'알 수 없는 화면: {screen}')
    result = {'screen': screen, 'as_of': ctx.now.astimezone(KST).isoformat(), 'items': [], 'errors': []}
    try:
        items, details = _RULES[screen](params or {}, ctx)
    except Exception as exc:  # a failing rule is reported, never turned into an item
        result['errors'].append(f'{SCREEN_LABELS[screen]} 점검 실패: {exc}')
        return result
    result['items'] = sort_items(items)
    if details is not None:
        result['details'] = details
    return result
