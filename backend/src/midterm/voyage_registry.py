"""Shared, manually curated voyage registry. Never posts inventory or AIS observations."""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from midterm.database import DATABASE, connect

KST = timezone(timedelta(hours=9))
MAX_ROWS = 5000


class RegistryError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def field(key, label, kind='text', required=False, **kwargs):
    return dict(key=key, label=label, kind=kind, required=required, **kwargs)


PLANTS = {'dangjin': '당진', 'boryeong': '보령', 'hadong': '하동', 'donghae': '동해·삼척'}
STATUSES = {'planned': '예정', 'underway': '항해', 'arrived': '입항', 'berthed': '접안',
            'unloading': '하역', 'completed': '완료', 'cancelled': '취소'}
SCHEMA = {
    'ships': dict(label='선박', key='ship_code', fields=[
        field('ship_code', '선박 관리ID', 'code', True), field('name', '선박명', required=True),
        field('mmsi', 'MMSI', 'identifier', digits=9), field('imo', 'IMO', 'identifier', digits=7),
        field('operator', '선사'), field('flag', '선박 국적'), field('notes', '비고', 'memo'),
    ]),
    'voyages': dict(label='항차', key='voyage_no', fields=[
        field('voyage_no', '배선 관리ID', 'code', True), field('ship_code', '선박', 'code', reference='ships'),
        field('classification', '자료 구분', 'choice', choices={'actual':'실제', 'simulation':'모의'}),
        field('voyage_number', '항차번호', 'voyage_number'), field('plan_name', '계획명'),
        field('charter_type', '용선구분', 'choice', choices={'long_term':'장기용선', 'spot':'현물용선', 'swap':'스왑'}),
        field('origin_port', '선적항'), field('loading_country', '선적항 국가'), field('destination_port', '하역항'),
        field('yard', '저탄장', 'choice', choices={'1':'1저탄장', '2':'2저탄장', '3':'3저탄장'}),
        field('laycan_start', 'LAYCAN 시작', 'date'), field('laycan_end', 'LAYCAN 종료', 'date'),
        field('laycan_status', 'LAYCAN 상태', 'choice', choices={'negotiating':'협의중', 'confirmed':'확정', 'nominated':'노미완료'}),
        field('laycan_notes', 'LAYCAN 메모', 'memo'),
        field('nomination', 'Nomi 여부', 'choice', choices={'Y':'Y', 'N':'N'}),
        field('nomination_date', 'Nomi 송부일', 'date'),
        field('loading_eta', '선적항 ETA(KST)', 'datetime'), field('loading_etb', '선적항 ETB(KST)', 'datetime'),
        field('loading_etd', '선적항 ETD(KST)', 'datetime'), field('discharge_etd', '하역항 ETD(KST)', 'datetime'),
        field('berth_id', '접안부두', 'choice', choices={'BD-1': '1부두', 'BD-2': '2부두', 'BD-3': '3부두'}),
        field('status', '진행상태', 'choice', True, choices=STATUSES),
        *[field(f'{prefix}_{event}', f'{title} {label}(KST)', 'datetime')
          for prefix, title in [('planned', '예정'), ('actual', '실제')]
          for event, label in [('departure', '출항'), ('arrival', '입항'), ('berth', '접안'), ('unload_end', '하역완료')]],
        field('notes', '비고', 'memo'),
    ]),
    'cargo': dict(label='화물', key='cargo_no', fields=[
        field('cargo_no', '화물 관리ID', 'code', True), field('voyage_no', '배선', 'code', True, reference='voyages'),
        field('destination_plant_id', '목적발전소코드', 'choice', True, choices=PLANTS),
        field('supplier', '공급사'), field('origin_country', '산지국가'), field('coal_name', '탄종', required=True),
        field('contract_no', '계약번호'), field('bl_no', 'B/L번호'),
        field('mine', '광산'), field('receipt_date', '입고 시작일', 'date'), field('receipt_end_date', '입고 종료일', 'date'),
        field('received_t', '입하량(t)', 'number', min=0, max=1000000),
        field('contract_type', '계약구분', 'choice', choices={'tender':'입찰', 'swap':'SWAP', 'other':'기타'}),
        field('incoterms', '계약형태', 'choice', choices={x:x for x in ['FOB','CFR','CIF']}),
        field('contract_date', '계약일', 'date'),
        field('planned_t', '예정물량(t)', 'number', min=0, max=1000000),
        field('bl_t', 'B/L물량(t)', 'number', min=0, max=1000000),
        field('cv', '열량(kcal/kg)', 'number', min=1000, max=10000),
        field('cv_basis', '열량기준', 'choice', choices={x: x for x in ['GAR', 'NAR', 'GAD', 'NAD', 'GDB', 'NDB']}),
        field('moisture_pct', '전수분(%)', 'number', min=0, max=100),
        field('ash_pct', '회분(%)', 'number', min=0, max=100),
        field('sulfur_pct', '황분(%)', 'number', min=0, max=100),
        field('analysis_basis', '회분·황분 분석기준', 'choice', choices={x: x for x in ['AR', 'ADB', 'DB', 'DAF']}),
        field('notes', '비고', 'memo'),
    ]),
}

SCHEMA['assays'] = dict(label='성상분석', key='assay_id', fields=[
    field('assay_id', '분석 관리ID', 'code', True), field('cargo_no', '화물', 'code', True, reference='cargo'),
    field('stage', '분석구분', 'choice', True, choices={'loading':'선적', 'unloading':'하역', 'buyer':'바이어 샘플'}),
    field('sample_no', '시료번호'), field('sample_date', '채취일', 'date'), field('analysis_date', '분석일', 'date'),
    field('laboratory', '분석기관'), field('report_no', '성적서번호'),
    field('result_status', '결과상태', 'choice', choices={'draft':'미확정', 'confirmed':'확정'}),
    *[dict(f) for f in SCHEMA['cargo']['fields'] if f['key'] in
      ('cv', 'cv_basis', 'moisture_pct', 'ash_pct', 'sulfur_pct', 'analysis_basis')],
    field('volatile_pct', '휘발분(%)', 'number', min=0, max=100),
    field('fixed_carbon_pct', '고정탄소(%)', 'number', min=0, max=100),
    field('hgi', 'HGI', 'number', min=0, max=200), field('notes', '분석 메모', 'memo')])

for f in SCHEMA['assays']['fields']:
    f['group'] = '분석 정보' if f['key'] in ('assay_id','cargo_no','stage','sample_no','sample_date','analysis_date','laboratory','report_no','result_status','notes') else '기존 성상값'
    if f['key'] == 'hgi':
        f['group'] = '발열량·기본 성상'
SCHEMA['assays']['fields'] += [
    *[field(key, label, 'number', min=0, max=10000, group='발열량·기본 성상') for key,label in
      [('gcv_arb','발열량 ARB(kcal/kg)'),('gcv_adb','발열량 ADB(kcal/kg)'),('gcv_db','발열량 DB(kcal/kg)'),('ncv','NCV(kcal/kg)')]],
    field('ncv_basis','NCV 기준','choice',choices={'unknown':'미확인','AR':'ARB (NAR)','ADB':'ADB','DB':'DB'},group='발열량·기본 성상'),
    *[field(key,label,'number',min=0,max=100,group='발열량·기본 성상') for key,label in [('tm_ar','총수분 AR(%wt)'),('sulfur_ar','유황분 AR(%wt)')]],
    *[field(key,label,'number',min=0,max=99.99 if key=='im_adb' else 100,group='공업분석 · ADB, %wt') for key,label in
      [('im_adb','고유수분 IM'),('vm_adb','휘발분 VM'),('ash_adb','회분 Ash'),('fc_adb','고정탄소 FC')]],
    *[field(key,label,'number',min=0,max=100,group='원소분석 · DB, %wt') for key,label in
      [('c_db','탄소 C'),('h_db','수소 H'),('n_db','질소 N'),('o_db','산소 O'),('s_db','유황 S')]],
    *[field(key,label,'number',min=0,max=100,group='회성분 분석 · %wt') for key,label in
      [('sio2','SiO2'),('al2o3','Al2O3'),('cao','CaO'),('mgo','MgO'),('na2o','Na2O'),('k2o','K2O'),('so3','SO3'),('tio2','TiO2'),('ash_other','기타 회성분')]],
    *[field(key,label,'number',min=0,max=3000,group='연료특성') for key,label in
      [('combustion_start_c','연소시작온도(°C)'),('combustion_end_c','연소종료온도(°C)'),('combustion_peak_c','최대연소온도(°C)')]],
    field('combustion_max_rate','최대연소속도(%/min)','number',min=0,max=10000,group='연료특성'),
    *[field(key,label,'number',min=0,max=3000,group='회융점 · 환원성, °C') for key,label in
      [('fusion_it','IT'),('fusion_st','ST'),('fusion_ht','HT'),('fusion_ft','FT')]],
    field('size_2mm','2mm 이하(%wt)','number',min=0,max=100,group='입도·염소·점결성'),
    field('size_025mm','0.25mm 이하(%wt)','number',min=0,max=100,group='입도·염소·점결성'),
    field('chlorine_db_ppm','염소 DB(ppm)','number',min=0,max=1000000,group='입도·염소·점결성'),
    field('csn','CSN 점결성 지수','number',min=0,max=9,group='입도·염소·점결성'),
]


def normalize_voyage_number(value):
    if value is None or not str(value).strip():
        return None
    parts = str(value).strip().split('-')
    if len(parts) == 2:
        parts.insert(0, str(datetime.now(KST).year % 100))
    if len(parts) != 3 or not all(p.isascii() and p.isdigit() for p in parts):
        raise ValueError('항차번호는 26-1-019 또는 1-19 형식으로 입력하세요.')
    year, berth, serial = map(int, parts)
    if year >= 2000:
        year -= 2000
    if not 0 <= year <= 99 or berth not in (1, 2, 3) or not 1 <= serial <= 999:
        raise ValueError('연도·부두(1~3)·일련번호(1~999)를 확인하세요.')
    return f'{year:02}-{berth}-{serial:03}'


def quality_selection(assays, cargo):
    selected = {}
    for item in cargo:
        candidates = [a for a in assays if a['cargo_no'] == item['cargo_no']
                      and a['stage'] in ('unloading', 'loading') and a.get('result_status') == 'confirmed']
        candidates.sort(key=lambda a: (a['stage'] == 'unloading', a.get('analysis_date') or '',
                                      a.get('sample_date') or '', a.get('updated_at') or '', a['assay_id']), reverse=True)
        chosen = candidates[0] if candidates else None
        im, ash = (chosen.get('im_adb'), chosen.get('ash_adb')) if chosen else (None, None)
        selected[item['cargo_no']] = None if not chosen else {**chosen,
            'derived_ash_db': ash * 100 / (100-im) if ash is not None and im is not None and im < 100 else None,
            'ncv_usable': chosen.get('ncv') is not None and chosen.get('ncv_basis') in ('AR','ADB','DB'),
            'missing': [k for k in ('gcv_arb','tm_ar','sulfur_ar','im_adb','ash_adb','vm_adb','fc_adb','hgi') if chosen.get(k) is None]}
    return selected


def init_schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS voyage_registry_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO voyage_registry_meta VALUES(1,0);
      CREATE TABLE IF NOT EXISTS voyage_registry_audit(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, entity TEXT NOT NULL, record_key TEXT NOT NULL,
        actor TEXT NOT NULL, origin TEXT NOT NULL, at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL);
    ''')
    db.commit()
    db.execute('PRAGMA foreign_keys=OFF')
    db.execute('BEGIN IMMEDIATE')
    for entity, spec in SCHEMA.items():
        columns = []
        for f in spec['fields']:
            sql_type = 'REAL' if f['kind'] == 'number' else 'TEXT'
            suffix = ' PRIMARY KEY' if f['key'] == spec['key'] else (' NOT NULL' if f['required'] else '')
            if f.get('reference'):
                target = SCHEMA[f['reference']]
                suffix += f" REFERENCES voyage_registry_{f['reference']}({target['key']})"
            columns.append(f"{f['key']} {sql_type}{suffix}")
        definition = f"({','.join(columns)}, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)"
        table = f'voyage_registry_{entity}'
        old = {r['name']: r for r in db.execute(f'PRAGMA table_info({table})')}
        if old and (set(f['key'] for f in spec['fields']) - set(old) or
                    entity == 'voyages' and old['ship_code']['notnull']):
            db.execute(f'CREATE TABLE {table}_new {definition}')
            common = ','.join(old)
            db.execute(f'INSERT INTO {table}_new ({common}) SELECT {common} FROM {table}')
            if entity == 'voyages' and 'voyage_number' not in old:
                for row in db.execute(f'SELECT voyage_no FROM {table}_new').fetchall():
                    try:
                        number = normalize_voyage_number(row['voyage_no'])
                    except ValueError:
                        number = None
                    db.execute(f'UPDATE {table}_new SET voyage_number=?, plan_name=? WHERE voyage_no=?',
                               (number, row['voyage_no'], row['voyage_no']))
            db.execute(f'DROP TABLE {table}')
            db.execute(f'ALTER TABLE {table}_new RENAME TO {table}')
        else:
            db.execute(f'CREATE TABLE IF NOT EXISTS {table} {definition}')
        if entity == 'voyages':
            db.execute(f"UPDATE {table} SET classification='actual' WHERE classification IS NULL")
    for key in ('mmsi', 'imo'):
        db.execute(f'CREATE UNIQUE INDEX IF NOT EXISTS voyage_registry_unique_{key} ON voyage_registry_ships({key}) WHERE {key} IS NOT NULL')
    db.commit()
    db.execute('PRAGMA foreign_keys=ON')


def _snapshot(db):
    result = {'revision': db.execute('SELECT revision FROM voyage_registry_meta WHERE id=1').fetchone()[0]}
    for entity, spec in SCHEMA.items():
        result[entity] = [dict(row) for row in db.execute(f"SELECT * FROM voyage_registry_{entity} ORDER BY {spec['key']} COLLATE NOCASE")]
    result['audit'] = [dict(row) for row in db.execute('SELECT id,revision,entity,record_key,actor,origin,at,before_json,after_json FROM voyage_registry_audit ORDER BY id DESC LIMIT 100')]
    result['quality_selection'] = quality_selection(result['assays'], result['cargo'])
    return result


def snapshot(path: Path = DATABASE):
    with connect(path) as db:
        init_schema(db)
        db.execute('BEGIN')
        return _snapshot(db)


def _clean_value(value, f):
    if value is None or isinstance(value, str) and not value.strip():
        if f['required']:
            raise ValueError('필수 값입니다.')
        return None
    if isinstance(value, bool):
        raise ValueError('참/거짓 값 대신 지정된 형식으로 입력하세요.')
    kind = f['kind']
    if kind == 'voyage_number':
        return normalize_voyage_number(value)
    if kind == 'date':
        try:
            result = value.date() if isinstance(value, datetime) else value if isinstance(value, date) else date.fromisoformat(str(value).strip())
            if not 1970 <= result.year <= 2100:
                raise ValueError()
            return result.isoformat()
        except (ValueError, TypeError):
            raise ValueError('YYYY-MM-DD 날짜를 입력하세요.') from None
    if kind == 'number':
        try:
            number = float(str(value).replace(',', '').strip())
        except (TypeError, ValueError):
            raise ValueError('숫자를 입력하세요.') from None
        if not math.isfinite(number) or not f['min'] <= number <= f['max']:
            raise ValueError(f"{f['min']:,}~{f['max']:,} 범위의 숫자를 입력하세요.")
        return number
    if kind == 'datetime':
        try:
            at = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
            if not 1970 <= at.year <= 2100:
                raise ValueError()
            return (at.replace(tzinfo=KST) if at.tzinfo is None else at.astimezone(KST)).isoformat(timespec='seconds')
        except (ValueError, TypeError):
            raise ValueError('YYYY-MM-DD HH:mm 형식의 KST 날짜를 입력하세요.') from None
    if kind == 'identifier' and isinstance(value, (int, float)) and float(value).is_integer():
        value = str(int(value))
    if not isinstance(value, str):
        raise ValueError('텍스트 형식으로 입력하세요.')
    value = value.strip()
    if len(value) > (2000 if kind == 'memo' else 200) or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value):
        raise ValueError('텍스트 길이 또는 제어문자를 확인하세요.')
    if kind == 'code' and not re.fullmatch(r'[A-Za-z0-9가-힣][A-Za-z0-9가-힣._/-]{0,63}', value):
        raise ValueError('64자 이내 영문·숫자·한글·점·밑줄·빗금·하이픈 코드가 필요합니다.')
    if kind == 'identifier' and not re.fullmatch(r'\d{' + str(f['digits']) + '}', value, flags=re.ASCII):
        raise ValueError(f"{f['digits']}자리 숫자를 텍스트로 입력하세요. 앞자리 0을 확인하세요.")
    if kind == 'choice' and value not in f['choices']:
        raise ValueError('코드표의 값으로 입력하세요: ' + ', '.join(f['choices']))
    return value


def _prepare(changes, current):
    if isinstance(changes, dict) and 'entries' in changes:
        from midterm.voyage_business import expand_entries
        changes = expand_entries(changes, current)
    errors, normalized, diffs = [], {}, []
    if not isinstance(changes, dict) or set(changes) - set(SCHEMA):
        raise RegistryError('선박·항차·화물 입력 구조를 확인하세요.')
    if any(not isinstance(v, list) for v in changes.values()) or sum(len(v) for v in changes.values()) > MAX_ROWS:
        raise RegistryError(f'입력은 합계 {MAX_ROWS:,}행 이하로 보내 주세요.')
    merged = {entity: {row[spec['key']]: row for row in current[entity]} for entity, spec in SCHEMA.items()}
    original = {entity: dict(rows) for entity, rows in merged.items()}

    def error(entity, row, column, message):
        errors.append(dict(entity=entity, sheet=SCHEMA[entity]['label'], row=row, column=column, message=message))

    for entity, spec in SCHEMA.items():
        seen, normalized[entity] = set(), []
        allowed = {f['key'] for f in spec['fields']}
        for row_num, raw in enumerate(changes.get(entity, []), 2):
            if raw is None:  # Empty Excel rows retain their worksheet row numbers.
                continue
            if not isinstance(raw, dict) or set(raw) - allowed:
                error(entity, row_num, '', '지원하지 않는 필드 또는 행 형식입니다.'); continue
            row, valid = {}, True
            for f in spec['fields']:
                try:
                    old_row = original[entity].get(raw.get(spec['key']), {})
                    value = raw.get(f['key'], old_row.get(f['key']))
                    if entity == 'voyages' and f['key'] == 'classification' and not value:
                        value = 'actual'
                    row[f['key']] = _clean_value(value, f)
                except ValueError as exc:
                    error(entity, row_num, f['label'], str(exc)); valid = False
            if not valid:
                continue
            key = row[spec['key']]
            if key in seen:
                error(entity, row_num, spec['fields'][0]['label'], '입력 파일 안에 코드가 중복됩니다.'); continue
            seen.add(key)
            normalized[entity].append((row_num, row))
            merged[entity][key] = row

    if sum(len(rows) for rows in merged.values()) > MAX_ROWS:
        error('ships', 1, '', f'공용 원장은 총 {MAX_ROWS:,}행까지 지원합니다.')
    for entity, rows in normalized.items():
        spec = SCHEMA[entity]
        for row_num, row in rows:
            for f in spec['fields']:
                if f.get('reference') and row[f['key']] is not None and row[f['key']] not in merged[f['reference']]:
                    error(entity, row_num, f['label'], f"등록된 {SCHEMA[f['reference']]['label']} 코드를 입력하세요.")
            if entity == 'voyages':
                if row['voyage_number'] and row['berth_id'] and row['voyage_number'].split('-')[1] != row['berth_id'].removeprefix('BD-'):
                    error(entity, row_num, '항차번호', '항차번호의 부두와 선택한 접안부두가 다릅니다.')
                for keys in [('laycan_start','laycan_end'), ('loading_eta','loading_etb','loading_etd')]:
                    dates = [row[k] for k in keys if row[k]]
                    if dates != sorted(dates):
                        error(entity, row_num, '일정', 'LAYCAN 또는 선적항 일정의 시작·종료 순서를 확인하세요.')
                for prefix in ('planned', 'actual'):
                    dates = [row[f'{prefix}_{event}'] for event in ('departure', 'arrival', 'berth', 'unload_end') if row[f'{prefix}_{event}']]
                    if dates != sorted(dates):
                        error(entity, row_num, '일정', '예정·실적 각각 출항→입항→접안→하역완료 시간 순서를 확인하세요.')
            if entity in ('cargo', 'assays'):
                if entity == 'cargo' and row['receipt_date'] and row['receipt_end_date'] and row['receipt_date'] > row['receipt_end_date']:
                    error(entity,row_num,'입고 종료일','입고 종료일은 시작일보다 빠를 수 없습니다.')
                if entity == 'cargo' and row['planned_t'] is None and row['bl_t'] is None:
                    error(entity, row_num, '물량', '예정물량 또는 B/L물량 중 하나 이상 입력하세요.')
                if row['cv'] is not None and not row['cv_basis']:
                    error(entity, row_num, '열량기준', '열량을 입력하면 GAR/NAR 등 기준도 지정하세요.')
                if any(row.get(f) is not None for f in ('ash_pct', 'sulfur_pct','volatile_pct','fixed_carbon_pct')) and not row['analysis_basis']:
                    error(entity, row_num, '회분·황분 분석기준', '회분·황분을 입력하면 분석기준도 지정하세요.')
                if entity == 'assays' and row['sample_date'] and row['analysis_date'] and row['sample_date'] > row['analysis_date']:
                    error(entity, row_num, '분석일', '분석일은 채취일보다 빠를 수 없습니다.')
                if entity == 'assays' and row['size_2mm'] is not None and row['size_025mm'] is not None and row['size_025mm'] > row['size_2mm']:
                    error(entity,row_num,'입도','0.25mm 이하 비율은 2mm 이하 비율보다 클 수 없습니다.')
            before = original[entity].get(row[spec['key']])
            before = {f['key']: before[f['key']] for f in spec['fields']} if before else None
            if before != row:
                diffs.append(dict(entity=entity, sheet=spec['label'], row=row_num, key=row[spec['key']],
                                  action='update' if before else 'create', before=before, after=row))
    numbers = {}
    for row in merged['voyages'].values():
        number = row.get('voyage_number')
        if number and number in numbers:
            error('voyages', 1, '항차번호', '항차번호가 중복됩니다. 다른 배선과 같은 번호를 사용할 수 없습니다.')
        if number:
            numbers[number] = row['voyage_no']
    for field_key in ('mmsi', 'imo'):
        identities = {}
        for row in merged['ships'].values():
            value = row.get(field_key)
            if value and value in identities:
                error('ships', 1, field_key.upper(), f"{identities[value]} · {row['ship_code']}에 동일 식별자가 중복됩니다.")
            identities[value] = row['ship_code']
    return dict(revision=current['revision'], errors=errors[:200], changes=diffs,
                counts={action: sum(d['action'] == action for d in diffs) for action in ('create', 'update')},
                unchanged=sum(len(rows) for rows in normalized.values()) - len(diffs))


def preview(changes, path: Path = DATABASE):
    return _prepare(changes, snapshot(path))


def commit(changes, revision, actor, origin, path: Path = DATABASE):
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise RegistryError('원장 버전을 확인하세요.')
    if origin not in ('manual', 'excel'):
        raise RegistryError('입력 경로를 확인하세요.')
    with connect(path) as db:
        init_schema(db)
        db.execute('BEGIN IMMEDIATE')
        current = _snapshot(db)
        if current['revision'] != revision:
            raise RegistryError('다른 변경이 먼저 저장되었습니다. 최신 원장을 다시 조회하고 검토하세요.', 409)
        result = _prepare(changes, current)
        if result['errors']:
            e = result['errors'][0]
            raise RegistryError(f"{e['sheet']} {e['row']}행 · {e['column']}: {e['message']}")
        if not result['changes']:
            return current
        new_revision = revision + 1
        at = datetime.now(KST).isoformat(timespec='seconds')
        # Final-state validation above guarantees uniqueness. Release identifiers
        # inside this transaction so valid two-ship reassignments can be applied.
        for diff in result['changes']:
            if diff['entity'] == 'ships':
                db.execute('UPDATE voyage_registry_ships SET mmsi=NULL, imo=NULL WHERE ship_code=?', (diff['key'],))
        for diff in result['changes']:
            entity, row = diff['entity'], diff['after']
            key = SCHEMA[entity]['key']
            columns = list(row) + ['updated_at', 'updated_by']
            assignments = ','.join(f'{column}=excluded.{column}' for column in columns if column != key)
            db.execute(f"INSERT INTO voyage_registry_{entity} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)}) ON CONFLICT({key}) DO UPDATE SET {assignments}",
                       [*row.values(), at, actor])
            db.execute('INSERT INTO voyage_registry_audit(revision,entity,record_key,actor,origin,at,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)',
                       (new_revision, entity, diff['key'], actor, origin, at,
                        json.dumps(diff['before'], ensure_ascii=False) if diff['before'] else None, json.dumps(row, ensure_ascii=False)))
        db.execute('UPDATE voyage_registry_meta SET revision=? WHERE id=1', (new_revision,))
        return _snapshot(db)
