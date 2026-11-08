"""Business-entry projection onto the shared register's stable internal keys."""
from uuid import NAMESPACE_URL, uuid5
from midterm.voyage_registry import SCHEMA, RegistryError, normalize_voyage_number


def stable_id(kind, value):
    return f'{kind}-{uuid5(NAMESPACE_URL, "gen4cast/" + kind + "/" + value).hex}'


def business_fields():
    fields = []
    for entity in ('voyages', 'ships', 'cargo'):
        for f in SCHEMA[entity]['fields']:
            if f['key'] in ('ship_code', 'voyage_no', 'cargo_no'):
                continue
            key = f['key'] if f['key'] != 'notes' else f'{entity}_notes'
            fields.append({**f, 'key': key, 'entity': entity, 'source': f['key'],
                           'label': f['label'] if f['key'] != 'notes' else {'voyages':'배선 메모','ships':'선박 메모','cargo':'화물 메모'}[entity]})
    return fields


def clean_row(row, entity):
    return {f['key']: row.get(f['key']) for f in SCHEMA[entity]['fields']}


def expand_entries(changes, current):
    if set(changes) - {'entries', 'assays', 'assay_entries', 'ships'} or not isinstance(changes['entries'], list):
        raise RegistryError('배선 입력 구조를 확인하세요.')
    output = {e: {} for e in SCHEMA}
    existing = {e: {r[SCHEMA[e]['key']]: clean_row(r, e) for r in current[e]} for e in SCHEMA}
    fields = business_fields()
    allowed = {f['key'] for f in fields} | {'voyage_no','cargo_no','ship_code','cargo_index'}
    def put(entity, row, line):
        key = row[SCHEMA[entity]['key']]
        old = output[entity].get(key)
        if old is not None and old != row:
            raise RegistryError(f'배선등록 {line}행: 같은 배선·선박의 반복 정보가 다릅니다. 동일하게 입력하세요.')
        output[entity][key] = row

    for line, raw in enumerate(changes['entries'], 2):
        if raw is None:
            continue
        if not isinstance(raw, dict) or set(raw) - allowed:
            raise RegistryError(f'배선등록 {line}행: 지원하지 않는 열입니다.')
        try:
            number = normalize_voyage_number(raw.get('voyage_number'))
        except ValueError as exc:
            raise RegistryError(f'배선등록 {line}행: {exc}') from None
        name = str(raw.get('plan_name') or '').strip()
        if not name and not number and not raw.get('voyage_no'):
            raise RegistryError(f'배선등록 {line}행: 항차번호 미정이면 계획명을 입력하세요.')
        candidates = [v for v in current['voyages'] if (number and v.get('voyage_number') == number)
                      or (not number and name and v.get('plan_name') == name and not v.get('voyage_number'))]
        if len(candidates) > 1 and not raw.get('voyage_no'):
            raise RegistryError(f'배선등록 {line}행: 같은 계획명이 여러 건입니다. 원장을 내보낸 뒤 수정하세요.')
        vid = raw.get('voyage_no') or (candidates[0]['voyage_no'] if candidates else stable_id('V', number or name))
        voyage = {'status': 'planned', **existing['voyages'].get(vid, {}), 'voyage_no': vid}
        for f in fields:
            if f['entity'] == 'voyages' and f['key'] in raw:
                voyage[f['source']] = raw[f['key']]
        voyage['voyage_number'] = number
        voyage['status'] = voyage.get('status') or 'planned'
        ship_name = str(raw.get('name') or '').strip()
        sid = raw.get('ship_code')
        if ship_name or sid or raw.get('imo') or raw.get('mmsi'):
            identifiers = {k: str(raw.get(k) or '').strip() for k in ('imo','mmsi')}
            ships = list({**existing['ships'], **output['ships']}.values())
            matches = [s for s in ships if any(v and str(s.get(k) or '') == v for k,v in identifiers.items())]
            if not matches and not any(identifiers.values()):
                matches = [s for s in ships if str(s.get('name') or '').casefold() == ship_name.casefold()]
            if len(matches) > 1:
                raise RegistryError(f'배선등록 {line}행: 선박 식별자가 서로 다른 선박을 가리키거나 이름이 중복됩니다.')
            if sid and matches and sid != matches[0]['ship_code']:
                raise RegistryError(f'배선등록 {line}행: 선박 관리ID와 IMO/MMSI가 일치하지 않습니다.')
            sid = sid or (matches[0]['ship_code'] if matches else stable_id('S', identifiers['imo'] or identifiers['mmsi'] or ship_name.casefold()))
            ship = {**existing['ships'].get(sid, output['ships'].get(sid, {})), 'ship_code': sid}
            for f in fields:
                if f['entity'] == 'ships' and f['key'] in raw:
                    ship[f['source']] = raw[f['key']]
            put('ships', clean_row(ship, 'ships'), line)
        voyage['ship_code'] = sid or None
        put('voyages', clean_row(voyage, 'voyages'), line)
        cargo_present = any(raw.get(k) not in (None, '') for k in ('cargo_no','coal_name','planned_t','bl_t','supplier'))
        if not cargo_present:
            continue
        index = str(raw.get('cargo_index') or '1')
        if not index.isdigit() or not 1 <= int(index) <= 999:
            raise RegistryError(f'배선등록 {line}행: 화물순번은 1~999 정수입니다.')
        cid = raw.get('cargo_no') or stable_id('C', f'{vid}/{int(index)}')
        cargo = {**existing['cargo'].get(cid, {}), 'cargo_no': cid, 'voyage_no': vid}
        for f in fields:
            if f['entity'] == 'cargo' and f['key'] in raw:
                cargo[f['source']] = raw[f['key']]
        if cid in output['cargo']:
            raise RegistryError(f'배선등록 {line}행: 같은 화물순번이 중복됩니다.')
        put('cargo', clean_row(cargo, 'cargo'), line)

    for row in changes.get('ships', []):
        if row:
            put('ships', clean_row(row, 'ships'), '선박관리')
    for row in changes.get('assays', []):
        if row:
            put('assays', row, '성상분석')
    for line, raw in enumerate(changes.get('assay_entries', []), 2):
        if raw is None:
            continue
        row = dict(raw)
        # Export supplies stable cargo keys; a new workbook can use plan/number and cargo index.
        if not row.get('cargo_no'):
            try:
                number = normalize_voyage_number(row.get('voyage_number'))
            except ValueError as exc:
                raise RegistryError(f'성상분석 {line}행: {exc}') from None
            voyages = list({**existing['voyages'], **output['voyages']}.values())
            matches = [v for v in voyages if (number and v.get('voyage_number') == number) or
                       (not number and row.get('plan_name') and v.get('plan_name') == row['plan_name'])]
            if len(matches) != 1:
                raise RegistryError(f'성상분석 {line}행: 배선을 찾을 수 없거나 여러 건입니다. 계획명 또는 항차번호를 확인하세요.')
            index = str(row.get('cargo_index') or '1')
            if not index.isdigit() or not 1 <= int(index) <= 999:
                raise RegistryError(f'성상분석 {line}행: 화물순번은 1~999 정수입니다.')
            row['cargo_no'] = stable_id('C', f"{matches[0]['voyage_no']}/{int(index)}")
        row['assay_id'] = row.get('assay_id') or stable_id('A', '/'.join(str(row.get(k) or '') for k in
            ('cargo_no','stage','sample_no','analysis_date','report_no')))
        for key in ('voyage_number','plan_name','cargo_index'):
            row.pop(key, None)
        put('assays', row, line)
    return {e: list(rows.values()) for e, rows in output.items()}
