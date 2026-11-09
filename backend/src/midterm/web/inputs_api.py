"""React 데이터/관리자의 업로드 입력 경계."""
import hashlib
import json
from zipfile import BadZipFile
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from midterm.milp_store import clean_input, get_input, list_inputs, price_rows, save_input, stored_runs, table_rows
from midterm.outages import parse_outage_rows

router = APIRouter(prefix="/api/planning", tags=["MILP 입력 업로드"])


@router.get("/inputs")
def inputs():
    return list_inputs()


@router.get("/inputs/{input_id}")
def input_detail(input_id: int):
    try:
        return get_input(input_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from None


@router.get("/executions")
def executions():
    return stored_runs()


@router.post("/inputs/upload")
async def upload(scenario: UploadFile = File(...), heat_prices: UploadFile = File(...),
                 nuclear: UploadFile | None = File(default=None), coal: UploadFile | None = File(default=None),
                 input_reference: Annotated[UploadFile | None, File()] = None,
                 calorific: float = Form(default=5500), assumption: bool = Form(default=True)):
    files = []
    async def read(file):
        raw = await file.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("파일당 최대 4MB까지 업로드할 수 있습니다")
        files.append({"name": file.filename[:200], "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        return raw
    try:
        scenario_data = json.loads((await read(scenario)).decode("utf-8-sig"))
        for kind, file in (("nuclear", nuclear), ("coal", coal)):
            if file:
                scenario_data[kind + "_oh"] = [o.as_row() for o in parse_outage_rows(table_rows(await read(file), file.filename))]
        prices = price_rows(table_rows(await read(heat_prices), heat_prices.filename))
        reference = json.loads((await read(input_reference)).decode('utf-8-sig')) if input_reference else None
        payload = clean_input(scenario_data, prices, {"calorific_kcal_kg": calorific,
            "is_assumption": assumption, "source": "데이터/관리자 업로드 기준 발열량"}, files, reference)
        return save_input(payload)
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OSError, BadZipFile) as e:
        raise HTTPException(400, "업로드 입력 확인: " + str(e)) from None


@router.get('/outages')
def outage_schedule():
    from midterm.database import load_settings
    from midterm.fleet import load_coal_units, load_nuclear_units
    from midterm.milp_store import active_input
    from midterm.supply import timestamp
    active = active_input()
    scenario = active['payload']['scenario'] if active else load_settings()['scenario']
    reference = active['payload'].get('input_reference') if active else None
    coal = load_coal_units(rows=reference['coal_units']) if reference else load_coal_units()
    nuclear = load_nuclear_units(rows=reference['nuclear_units']) if reference else load_nuclear_units()
    from midterm.units import canonical_unit_name
    capacities = {canonical_unit_name(u.name): u.installed_mw for u in coal + nuclear}
    rows = []
    for kind in ('coal', 'nuclear'):
        for row in scenario[kind + '_oh']:
            outage = parse_outage_rows([['unit','start','end','note'], [row['unit'],row['start'],row['end'],row.get('note','')]])[0]
            rows.append({**outage.as_row(), 'kind': kind,
                         'start_at': timestamp(outage.start).isoformat(), 'end_at': timestamp(outage.end).isoformat(),
                         'capacity_mw': capacities.get(outage.unit)})
    return {'input_id': active['id'] if active else None, 'name': scenario['name'],
            'default_year': int(scenario['end'][:4]), 'rows': sorted(rows, key=lambda r: (r['start_at'],r['unit'])),
            'source_files': (reference or {}).get('source_files', [])}
