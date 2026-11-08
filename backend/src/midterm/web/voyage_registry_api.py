"""Authenticated shared voyage register; independent of AIS and inventory posting."""
import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from midterm.database import DATABASE
from midterm.voyage_registry import SCHEMA, RegistryError, snapshot, preview, commit
from midterm.voyage_registry_excel import MAX_FILE, parse_workbook, workbook_bytes
from midterm.stock_inventory import inventory_snapshot, assign_receipt, correct_balance, reconcile_receipt
from midterm.stock_baseline import read_baseline, save_baseline
from midterm.blend_recommendation import recommend_blend
from midterm.receipt_plans import list_plans, save_plan, PlanConflict

router = APIRouter(prefix='/api/voyage-registry', tags=['voyage-registry'])
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def path(request):
    # Override is set only by isolated test applications, never by an HTTP caller.
    return Path(getattr(request.app.state, 'voyage_registry_path', DATABASE))


def checked(fn, *args):
    try:
        return fn(*args)
    except RegistryError as exc:
        raise HTTPException(exc.status, str(exc)) from None


async def bounded_body(request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_FILE:
            raise HTTPException(413, '파일 또는 요청은 4MB 이하로 보내 주세요.')
    return bytes(data)


async def json_body(request, keys):
    try:
        value = json.loads(await bounded_body(request))
        if not isinstance(value, dict) or set(value) != set(keys):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise HTTPException(422, '입력 구조를 확인하세요.') from None


@router.get('/schema')
def schema():
    return SCHEMA


@router.get('/records')
def records(request: Request):
    return checked(snapshot, path(request))


@router.get('/template')
@router.get('/export')
def download(request: Request):
    template = request.url.path.endswith('/template')
    data = checked(snapshot, path(request))
    filename = 'gen4cast-voyage-template.xlsx' if template else f'gen4cast-voyages-r{data["revision"]}.xlsx'
    return Response(workbook_bytes(data, template, business=True), media_type=XLSX,
                    headers={'Content-Disposition': f'attachment; filename="{filename}"'})


@router.post('/preview')
async def manual_preview(request: Request):
    value = await json_body(request, ['changes'])
    return await run_in_threadpool(checked, preview, value['changes'], path(request))


@router.post('/commit')
async def manual_commit(request: Request):
    value = await json_body(request, ['changes', 'revision'])
    return await run_in_threadpool(checked, commit, value['changes'], value['revision'],
                                   request.state.session['user']['id'], 'manual', path(request))


@router.post('/excel/preview')
async def excel_preview(request: Request):
    raw = await bounded_body(request)
    rows, source_revision = await run_in_threadpool(checked, parse_workbook, raw)
    result = await run_in_threadpool(checked, preview, rows, path(request))
    return {**result, 'file_digest': hashlib.sha256(raw).hexdigest(), 'source_revision': source_revision,
            'stale_workbook': source_revision is not None and source_revision != result['revision']}


@router.post('/excel/commit')
async def excel_commit(request: Request, revision: int, file_digest: str, acknowledge_stale: bool = False):
    raw = await bounded_body(request)
    if hashlib.sha256(raw).hexdigest() != file_digest:
        raise HTTPException(409, '미리 본 파일과 다릅니다. 다시 검토하세요.')
    rows, source_revision = await run_in_threadpool(checked, parse_workbook, raw)
    if source_revision is not None and source_revision != revision and not acknowledge_stale:
        raise HTTPException(409, '내보낸 후 원장이 변경되었습니다. 변경 전후를 확인하고 반영하세요.')
    return await run_in_threadpool(checked, commit, rows, revision,
                                   request.state.session['user']['id'], 'excel', path(request))


def inventory_checked(fn, *args):
    try:
        return fn(*args)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get('/inventory')
def inventory(request: Request):
    return inventory_checked(inventory_snapshot, path(request))


@router.get('/receipt-plans')
def receipt_plans(request: Request):
    return list_plans(path(request))


@router.post('/receipt-plans')
async def receipt_plan_save(request: Request):
    value = await json_body(request, ['id', 'revision', 'plan'])
    try:
        return await run_in_threadpool(inventory_checked, save_plan, value['id'], value['revision'], value['plan'],
                                       request.state.session['user']['id'], path(request))
    except PlanConflict as exc:
        raise HTTPException(409, str(exc)) from None


@router.get('/inventory/baseline')
def yard_baseline(request: Request):
    return inventory_checked(read_baseline, path(request))


@router.post('/inventory/baseline')
async def yard_baseline_save(request: Request):
    value = await json_body(request, ['baseline', 'revision'])
    return await run_in_threadpool(inventory_checked, save_baseline, value['baseline'], value['revision'],
                                   request.state.session['user']['id'], path(request))


@router.post('/inventory/receipts')
async def inventory_receipt(request: Request):
    value = await json_body(request, ['cargo_no', 'allocations', 'revision'])
    return await run_in_threadpool(inventory_checked, assign_receipt, value['cargo_no'], value['allocations'],
                                   value['revision'], request.state.session['user']['id'], path(request))


@router.post('/inventory/balance')
async def inventory_balance(request: Request):
    value = await json_body(request, ['lot_id', 'remaining_t', 'reason', 'revision'])
    return await run_in_threadpool(inventory_checked, correct_balance, value['lot_id'], value['remaining_t'],
                                   value['reason'], value['revision'], request.state.session['user']['id'], path(request))


@router.post('/inventory/reconcile')
async def inventory_reconcile(request: Request):
    value = await json_body(request, ['cargo_no', 'allocations', 'reason', 'revision', 'registry_revision'])
    return await run_in_threadpool(inventory_checked, reconcile_receipt, value['cargo_no'], value['allocations'],
                                   value['reason'], value['revision'], value['registry_revision'],
                                   request.state.session['user']['id'], path(request), request.state.session['user'].get('displayName'))


@router.post('/blend/recommend')
async def blend_recommend(request: Request):
    value = await json_body(request, ['lot_ids', 'criteria'])
    ids, criteria = value['lot_ids'], value['criteria']
    if (not isinstance(ids, list) or not ids or len(ids) > 100 or
        any(isinstance(i, bool) or not isinstance(i, int) for i in ids) or len(set(ids)) != len(ids) or
        not isinstance(criteria, dict) or set(criteria) - {'tonnes', 'target_gcv_arb', 'gcv_tolerance', 'max_tm_ar', 'max_sulfur_ar'}):
        raise HTTPException(422, '대상 더미와 혼탄 조건을 확인하세요')
    data = await run_in_threadpool(inventory_checked, inventory_snapshot, path(request))
    rows = {row['id']: row for row in data['lots']}
    if any(i not in rows or rows[i]['needs_review'] for i in ids):
        raise HTTPException(422, '더미가 없거나 입하 정보가 변경되어 재확인이 필요합니다')
    lots = []
    for i in ids:
        row = rows[i]
        assay = row['assay'] or {}
        lots.append({'id': str(i), 'available_t': row['remaining_t'],
                     'gcv_arb': assay.get('gcv_arb'), 'tm_ar': assay.get('tm_ar'), 'sulfur_ar': assay.get('sulfur_ar')})
    result = await run_in_threadpool(inventory_checked, recommend_blend, lots, criteria)
    return {**result, 'inventory_revision': data['revision']}


@router.post('/blend/baseline-recommend')
async def blend_baseline_recommend(request: Request):
    value = await json_body(request, ['lot_ids', 'criteria', 'revision'])
    ids, criteria = value['lot_ids'], value['criteria']
    if (not isinstance(ids, list) or not ids or len(ids) > 100 or
        any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids) or
        not isinstance(criteria, dict) or set(criteria) - {'tonnes', 'target_gcv_arb', 'gcv_tolerance', 'max_tm_ar', 'max_sulfur_ar'}):
        raise HTTPException(422, '대상 더미와 혼탄 조건을 확인하세요')
    baseline = await run_in_threadpool(inventory_checked, read_baseline, path(request))
    if value['revision'] != baseline['revision']:
        raise HTTPException(409, '기준재고가 변경되었습니다. 다시 확인하세요.')
    rows = [r for r in baseline['lots'] if r.get('source_id') in ids]
    if len(rows) != len(ids) or len({r.get('source_id') for r in rows}) != len(ids):
        raise HTTPException(422, '기준재고의 더미 식별자를 확인하세요')
    register = await run_in_threadpool(checked, snapshot, path(request))
    lots = []
    for row in rows:
        voyages = [v for v in register['voyages'] if row.get('voyage_number') and v.get('voyage_number') == row['voyage_number']]
        cargo = [c for c in register['cargo'] if len(voyages) == 1 and c.get('voyage_no') == voyages[0]['voyage_no'] and c.get('coal_name') == row['coal_name']]
        assay = register['quality_selection'].get(cargo[0]['cargo_no']) if len(cargo) == 1 else None
        assay = assay or {}
        lots.append({'id': row['source_id'], 'available_t': row['tonnes'], 'gcv_arb': assay.get('gcv_arb'),
                     'tm_ar': assay.get('tm_ar'), 'sulfur_ar': assay.get('sulfur_ar')})
    result = await run_in_threadpool(inventory_checked, recommend_blend, lots, criteria)
    return {**result, 'baseline_revision': baseline['revision'], 'as_of': baseline['as_of'], 'registry_revision': register['revision']}
