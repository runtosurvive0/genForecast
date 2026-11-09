"""A lossless XLSX exchange contract, not a spreadsheet execution engine."""
import io
import hashlib
import zipfile
from datetime import datetime
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from midterm.voyage_registry import KST, MAX_ROWS, SCHEMA, RegistryError

MAX_FILE = 4 * 1024 * 1024
FORMAT = 'gen4cast-voyage-v1'
# Columns added after earlier workbooks were exported; files without them keep stored values.
COMPATIBLE_MISSING = {'voyages': {'자료 구분', '허용정박시간(h)', '체선료(USD/일)'}, 'assays': {'Fe2O3'}}
BUSINESS_COMPATIBLE_MISSING = {'배선등록': {'자료 구분', '허용정박시간(h)', '체선료(USD/일)'}, '성상분석': {'Fe2O3 (%wt)'}}


def exchange_fields(fields):
    """System markers (dummy-data origin) are never exported to or read from Excel."""
    return [f for f in fields if not f.get('system')]


def workbook_bytes(data, template=False, business=False):
    if business:
        return business_workbook(data, template)
    book = Workbook()
    book.remove(book.active)
    for entity, spec in SCHEMA.items():
        sheet = book.create_sheet(spec['label'])
        fields = exchange_fields(spec['fields'])
        sheet.append([f['label'] for f in fields])
        for row in ([] if template else data[entity]):
            values = []
            for f in fields:
                value = row[f['key']]
                if f['kind'] == 'datetime' and value:
                    value = datetime.fromisoformat(value).astimezone(KST).replace(tzinfo=None)
                values.append(value)
            sheet.append(values)
            for cell in sheet[sheet.max_row]:
                if isinstance(cell.value, str):
                    cell.data_type = 's'  # Literal =/@/+/- text must never become a formula.
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        for i, f in enumerate(fields, 1):
            col = sheet.cell(1, i).column_letter
            sheet.column_dimensions[col].width = 26 if f['kind'] in ('datetime', 'memo') else 21
            header = sheet.cell(1, i)
            header.fill = PatternFill('solid', fgColor='2447C5')
            header.font = Font(name='맑은 고딕', color='FFFFFF', bold=True)
            header.alignment = Alignment(vertical='center')
            format_code = 'yyyy-mm-dd hh:mm' if f['kind'] == 'datetime' else '#,##0.###' if f['kind'] == 'number' else '@'
            sheet.column_dimensions[col].number_format = format_code
            for row_index in range(2, max(sheet.max_row + 1, 102)):
                sheet.cell(row_index, i).number_format = format_code
            if f.get('choices'):
                validation = DataValidation(type='list', formula1='"' + ','.join(f['choices']) + '"', allow_blank=not f['required'])
                validation.errorTitle = '코드 확인'; validation.error = '코드표의 값을 선택하세요.'
                validation.showErrorMessage = True
                sheet.add_data_validation(validation)
                validation.add(f'{col}2:{col}{MAX_ROWS+1}')
        sheet.row_dimensions[1].height = 28
    guide = book.create_sheet('작성안내')
    for row in [
        ['gen4cast 항차 DB · 작성안내'],
        ['선박 → 항차 → 화물', '코드로 연결합니다. 같은 선박의 여러 항차, 같은 항차의 여러 화물을 지원합니다.'],
        ['시간', '모든 날짜는 KST. YYYY-MM-DD HH:mm 또는 Excel 날짜 셀. 날짜만 입력하면 00:00입니다.'],
        ['수정', '기존 코드는 수정, 새 코드는 추가. 코드 자체 변경은 지원하지 않습니다. 파일에 없는 행은 유지합니다.'],
        ['빈 셀', '선택 항목의 빈 셀은 기존 값을 비웁니다. 업로드 검토에서 변경 전/후를 확인하세요. 0은 0입니다.'],
        ['필수 열', '모든 헤더를 유지하세요. 열 순서는 자유입니다. 필수 값과 선택 값은 아래 표를 참고하세요.'],
        ['물량', '예정물량 또는 B/L물량 중 하나 이상 입력. B/L물량은 선적 서류 값이며 하역 입고량이 아닙니다.'],
        ['분석', '열량에는 GAR/NAR 등의 기준을, 회분·황분에는 분석기준을 지정. 전수분은 입수 기준(AR)입니다. 임의 환산하지 않습니다.'],
        ['원장 연계', '수기/엑셀 자료입니다. AIS 실측이나 저탄 재고를 자동 변경하지 않습니다.'],
        ['보안·용량', 'XLSX 4MB, 총 5,000행. 수식·매크로는 허용하지 않습니다.'],
        [], ['시트', '헤더', '필수 값', '형식 / 허용 코드'],
    ]:
        guide.append(row)
    for spec in SCHEMA.values():
        for f in exchange_fields(spec['fields']):
            guide.append([spec['label'], f['label'], '필수' if f['required'] else '선택',
                          ', '.join(f.get('choices', {})) or f['kind']])
    for col, width in [('A', 23), ('B', 100), ('C', 14), ('D', 70)]:
        guide.column_dimensions[col].width = width
    codes = book.create_sheet('코드표')
    codes.append(['시트', '헤더', '입력 코드', '설명'])
    for spec in SCHEMA.values():
        for f in exchange_fields(spec['fields']):
            for code, label in f.get('choices', {}).items():
                codes.append([spec['label'], f['label'], code, label])
    for col in 'ABCD':
        codes.column_dimensions[col].width = 25
    meta = book.create_sheet('_원장정보')
    meta.append([FORMAT, None if template else data['revision']])
    meta.sheet_state = 'hidden'
    output = io.BytesIO(); book.save(output)
    return output.getvalue()


def parse_workbook(raw):
    if len(raw) > MAX_FILE:
        raise RegistryError('엑셀은 4MB 이하로 업로드하세요.', 413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if len(archive.infolist()) > 100 or sum(f.file_size for f in archive.infolist()) > 25 * 1024 * 1024:
                raise RegistryError('압축 해제 크기가 너무 큰 엑셀입니다.', 413)
            if any('vbaproject' in f.filename.lower() for f in archive.infolist()):
                raise RegistryError('매크로가 없는 XLSX 파일을 사용하세요.')
        book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
    except RegistryError:
        raise
    except Exception:
        raise RegistryError('정상적인 XLSX 통합문서를 업로드하세요.') from None
    try:
        result, count, revision = {}, 0, None
        if '배선등록' in book.sheetnames:
            return parse_business(book, hashlib.sha256(raw).hexdigest())
        if '_원장정보' in book.sheetnames:
            meta = book['_원장정보']
            if meta['A1'].value != FORMAT:
                raise RegistryError('지원하지 않는 엑셀 템플릿 버전입니다.')
            revision = meta['B1'].value
            if revision is not None and (type(revision) is not int or revision < 0):
                raise RegistryError('엑셀 원장 버전을 확인하세요.')
        for entity, spec in SCHEMA.items():
            if spec['label'] not in book.sheetnames:
                if entity == 'assays':
                    continue  # The original v1 workbook predates the analysis register.
                raise RegistryError(f"{spec['label']} 시트가 없습니다. 템플릿을 사용하세요.")
            sheet = book[spec['label']]
            exchanged = exchange_fields(spec['fields'])
            if sheet.max_column > len(exchanged) or sheet.max_row > MAX_ROWS + 1:
                raise RegistryError(f"{spec['label']} 시트의 행/열 한도를 초과했습니다.")
            fields = {f['label']: f for f in exchanged}
            headings = [c.value.strip() if isinstance(c.value, str) else c.value for c in next(sheet.iter_rows(max_row=1))]
            aliases = {'ships':{'선박코드':'선박 관리ID','선적국':'선박 국적'},
                       'voyages':{'항차번호':'배선 관리ID','선박코드':'선박','출항항':'선적항','주 도착항':'하역항'},
                       'cargo':{'화물번호':'화물 관리ID','항차번호':'배선'}}
            # Detect old headers by their old primary-key label, so new 항차번호 remains unambiguous.
            legacy = {'ships':'선박코드','voyages':'선박코드','cargo':'화물번호'}.get(entity) in headings
            if legacy:
                headings = [aliases.get(entity, {}).get(h,h) for h in headings]
            required = {f['label'] for f in exchanged if f['required']}
            compatible_missing = COMPATIBLE_MISSING.get(entity, set())
            if len(set(headings)) != len(headings) or not set(headings) <= set(fields) or not required <= set(headings) or (not legacy and set(fields) - set(headings) - compatible_missing):
                raise RegistryError(f"{spec['label']} 시트 헤더를 확인하세요. 필요 헤더: {', '.join(fields)}")
            rows = []
            for row_number, cells in enumerate(sheet.iter_rows(min_row=2), 2):
                if all(c.value is None for c in cells):
                    continue
                row = {}
                for heading, cell in zip(headings, cells):
                    if cell.data_type in ('f', 'e'):
                        raise RegistryError(f"{spec['label']} {row_number}행 · {heading}: 수식·오류 셀 대신 값을 입력하세요.")
                    row[fields[heading]['key']] = cell.value
                # Preserve Excel row positions for meaningful validation errors.
                while len(rows) < row_number - 2:
                    rows.append(None)
                rows.append(row)
                count += 1
                if count > MAX_ROWS:
                    raise RegistryError(f'입력은 총 {MAX_ROWS:,}행 이하로 제한합니다.')
            result[entity] = rows
        return result, revision
    except RegistryError:
        raise
    except Exception:
        raise RegistryError('시트 내용을 읽을 수 없습니다. 정상적인 XLSX 파일인지 확인하세요.') from None
    finally:
        book.close()


def business_columns():
    from midterm.voyage_business import business_fields
    return [dict(key='voyage_no', label='배선 관리ID', kind='text', required=False),
            dict(key='ship_code', label='선박 관리ID', kind='text', required=False),
            dict(key='cargo_no', label='화물 관리ID', kind='text', required=False),
            dict(key='batch_group', label='배선 묶음', kind='text', required=False),
            dict(key='cargo_index', label='화물순번', kind='number', required=False),
            *[f for f in exchange_fields(business_fields()) if f['key'] != 'plan_name']]


def assay_columns():
    return [dict(key='voyage_number', label='항차번호', kind='text', required=False),
            dict(key='batch_group', label='배선 묶음', kind='text', required=False),
            dict(key='cargo_index', label='화물순번', kind='number', required=False),
            *[{**f, 'label':f["label"] + (' (ADB, %wt)' if f.get('group')=='공업분석 · ADB, %wt' else ' (DB, %wt)' if f.get('group')=='원소분석 · DB, %wt' else ' (%wt)' if f.get('group')=='회성분 분석 · %wt' else ' (환원성, °C)' if f.get('group')=='회융점 · 환원성, °C' else '')} for f in exchange_fields(SCHEMA['assays']['fields'])]]


def business_workbook(data, template):
    from midterm.voyage_business import business_fields
    book = Workbook(); book.remove(book.active)
    ships = {r['ship_code']:r for r in data['ships']}
    voyages = {r['voyage_no']:r for r in data['voyages']}
    rows, cargo_refs = [], {}
    for voyage in data['voyages']:
        cargo = [c for c in data['cargo'] if c['voyage_no'] == voyage['voyage_no']]
        for index, item in enumerate(cargo or [{}], 1):
            source = {'voyages':voyage, 'ships':ships.get(voyage['ship_code'], {}), 'cargo':item}
            row = {f['key']:source[f['entity']].get(f['source']) for f in business_fields()}
            row.update(voyage_no=voyage['voyage_no'], ship_code=voyage['ship_code'], cargo_no=item.get('cargo_no'), cargo_index=index if item else None)
            rows.append(row)
            if item:
                cargo_refs[item['cargo_no']] = dict(voyage_number=voyage.get('voyage_number'), plan_name=voyage.get('plan_name'), cargo_index=index)
    assays = [{**cargo_refs.get(a['cargo_no'], {}), **a} for a in data['assays']]
    definitions = [('배선등록', business_columns(), rows), ('성상분석', assay_columns(), assays), ('선박관리', SCHEMA['ships']['fields'], [s for s in data['ships'] if not any(v['ship_code']==s['ship_code'] for v in data['voyages'])])]
    for title, fields, records in definitions:
        sheet = book.create_sheet(title)
        sheet.append([f['label'] for f in fields])
        for record in ([] if template else records):
            sheet.append([record.get(f['key']) for f in fields])
            for cell in sheet[sheet.max_row]:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
        sheet.freeze_panes = 'F2' if title == '배선등록' else 'D2'
        sheet.auto_filter.ref = sheet.dimensions
        sheet.row_dimensions[1].height = 32
        for i, f in enumerate(fields, 1):
            col = sheet.cell(1, i).column_letter
            sheet.column_dimensions[col].width = 25 if f['kind'] in ('datetime','memo') else 20
            sheet.column_dimensions[col].hidden = f['key'] in ('voyage_no','ship_code','cargo_no','assay_id')
            sheet.cell(1, i).fill = PatternFill('solid', fgColor='2447C5')
            sheet.cell(1, i).font = Font(name='맑은 고딕', bold=True, color='FFFFFF')
            fmt = '#,##0.###' if f['kind']=='number' else '@'
            sheet.column_dimensions[col].number_format = fmt
            for n in range(2, max(102, sheet.max_row + 1)):
                sheet.cell(n, i).number_format = fmt
            if f.get('choices'):
                dv = DataValidation(type='list', formula1='"' + ','.join(f['choices'].values()) + '"', allow_blank=True)
                dv.showErrorMessage = True; dv.error = '목록에서 선택하세요.'
                sheet.add_data_validation(dv); dv.add(f'{col}2:{col}{MAX_ROWS+1}')
                for row_index in range(2, sheet.max_row + 1):
                    cell = sheet.cell(row_index, i)
                    if cell.value in f['choices']:
                        cell.value = f['choices'][cell.value]
    guide = book.create_sheet('작성안내')
    for row in [
        ['gen4cast 배선·화물 일괄등록'],
        ['배선등록', '화물 한 건이 한 행입니다. 같은 배선은 배선 묶음에 같은 값을 입력하고 화물순번을 1, 2, 3으로 구분하세요. 선박·일정도 동일하게 반복합니다.'],
        ['선박관리', '배선에 아직 연결되지 않은 선박을 보관하는 시트입니다. 새 배선의 선박은 배선등록 시트에서 함께 입력하세요.'],
        ['번호 미정', '선박·항차번호 없이 등록할 수 있습니다. 여러 화물이나 성상분석을 같은 배선에 연결할 때만 배선 묶음을 입력하세요.'],
        ['배선 묶음', '이 값은 같은 파일 안에서만 연결에 사용합니다. 기존 배선을 수정할 때는 전체 내보내기 파일의 숨겨진 관리ID를 사용하세요.'],
        ['항차번호', '26-1-019 = 연도·부두·입항 순번. 1-19는 입력 시점의 KST 연도로 보완합니다.'],
        ['수정', '기존 자료는 전체 내보내기 파일을 수정하세요. 숨겨진 관리ID를 보존해야 번호 부여 후에도 같은 배선·화물로 연결됩니다.'],
        ['성상분석', '분석 한 건이 한 행입니다. 같은 파일의 배선 묶음 또는 항차번호와 화물순번으로 연결합니다. 기존 화물 분석 추가는 내보낸 파일의 화물 관리ID를 사용하세요.'],
        ['대표 성상', '미확정 결과를 제외하고 하역 분석 우선, 없으면 선적 분석. 같은 구분은 분석일·채취일·수정시각 순으로 선택합니다. 바이어 샘플은 비교용입니다.'],
        ['성상 이력', '재분석은 시료번호 또는 성적서번호로 구분하세요. 기존 분석 수정은 내보낸 분석 관리ID를 유지합니다.'],
        ['입고일자', '석탄이 들어온 날짜입니다. 선박 입항·접안일과 구분하며 입력만으로 재고를 가산하지 않습니다.'],
        ['시간·단위', '일시는 KST, 날짜는 YYYY-MM-DD, 물량 t, 발열량 kcal/kg, 총수분·회분·황분 %. 미확인은 빈칸, 확정된 0은 0.'],
        ['성상 기준', '발열량 ARB·ADB·DB·NCV는 별도 값입니다. NCV 기준 미확인은 계산 제외. 누락값을 다른 분석에서 채우지 않습니다.'],
        ['Ash DB', '계산값 = Ash ADB × 100 ÷ (100 − IM ADB). 원소분석 회분은 입력값을 덮어쓰지 않고 별도 계산합니다.'],
        ['추가 분석', '연료특성 °C·%/min, 회융점 환원성 °C, 입도 %wt, 염소 DB ppm, CSN. 미측정 항목은 비워 두세요.'],
        ['반영', '빈 선택값은 기존 값을 비웁니다. 빠진 행은 삭제하지 않습니다. 검토 후 전체 반영됩니다.'],
        ['용량', 'XLSX 4MB, 총 5,000행. 수식·매크로는 허용하지 않습니다.'],
    ]: guide.append(row)
    guide.column_dimensions['A'].width = 24; guide.column_dimensions['B'].width = 115
    codes = book.create_sheet('항목안내'); codes.append(['시트','입력 항목','형식','선택값'])
    for title, fields, _ in definitions:
        for f in fields:
            codes.append([title, f['label'], f['kind'], ', '.join(f.get('choices', {}).values())])
    for col in 'ABCD': codes.column_dimensions[col].width = 30
    meta = book.create_sheet('_원장정보'); meta.append(['gen4cast-voyage-v2', None if template else data['revision']]); meta.sheet_state = 'hidden'
    output = io.BytesIO(); book.save(output); return output.getvalue()


def parse_business(book, file_digest):
    revision = None
    if '_원장정보' in book:
        if book['_원장정보']['A1'].value != 'gen4cast-voyage-v2':
            raise RegistryError('지원하지 않는 엑셀 템플릿 버전입니다.')
        revision = book['_원장정보']['B1'].value
        if revision is not None and (type(revision) is not int or revision < 0):
            raise RegistryError('엑셀 원장 버전을 확인하세요.')
    output, count = {}, 0
    legacy_entries = False
    for title, key, fields in [('배선등록','entries',business_columns()), ('성상분석','assay_entries',assay_columns()), ('선박관리','ships',SCHEMA['ships']['fields'])]:
        if title not in book:
            if title == '선박관리':
                continue
            raise RegistryError(f'{title} 시트가 없습니다. 새 양식을 사용하세요.')
        sheet = book[title]
        if sheet.max_row > MAX_ROWS+1 or sheet.max_column > len(fields):
            raise RegistryError(f'{title} 시트의 행/열 한도를 초과했습니다.')
        mapping = {f['label']:f for f in fields}
        headers = [c.value for c in next(sheet.iter_rows(max_row=1))]
        for label in BUSINESS_COMPATIBLE_MISSING.get(title, set()) - set(headers):
            mapping.pop(label, None)
        if title in ('배선등록', '성상분석') and '계획명' in headers and '배선 묶음' not in headers:
            mapping.pop('배선 묶음')
            mapping['계획명'] = dict(key='plan_name', label='계획명', kind='text', required=False)
            if title == '배선등록':
                legacy_entries = True
        if len(set(headers)) != len(headers) or set(headers) != set(mapping):
            raise RegistryError(f'{title} 시트 헤더를 확인하세요. 양식의 열을 유지하세요.')
        output[key] = []
        for line, cells in enumerate(sheet.iter_rows(min_row=2), 2):
            if all(c.value is None for c in cells):
                output[key].append(None); continue
            row = {}
            for label, cell in zip(headers, cells):
                if cell.data_type in ('f','e'):
                    raise RegistryError(f'{title} {line}행 · {label}: 수식·오류 셀 대신 값을 입력하세요.')
                f, value = mapping[label], cell.value
                if f.get('choices') and value in f['choices'].values():
                    value = next(k for k,v in f['choices'].items() if v == value)
                row[f['key']] = value
            output[key].append(row); count += 1
            if count > MAX_ROWS:
                raise RegistryError(f'입력은 총 {MAX_ROWS:,}행 이하로 제한합니다.')
    if legacy_entries:
        for index, row in enumerate(output.get('assay_entries', []), 2):
            if row and row.pop('batch_group', None):
                raise RegistryError(f'성상분석 {index}행: 이전 배선등록 양식에는 계획명 또는 항차번호를 사용하세요.')
    else:
        from midterm.voyage_business import stable_id
        groups = {}
        for index, row in enumerate(output.get('entries', []), 2):
            if row is None:
                continue
            group = str(row.pop('batch_group', '') or '').strip()
            number = str(row.get('voyage_number') or '').strip()
            existing_id = row.get('voyage_no')
            generated = existing_id or (None if number else stable_id('V', f'excel/{file_digest}/{group or f"row-{index}"}'))
            if generated:
                row['voyage_no'] = generated
            if group:
                identity = (generated, number)
                if group in groups and groups[group] != identity:
                    raise RegistryError(f'배선등록 {index}행: 같은 배선 묶음의 항차번호 또는 관리ID가 다릅니다.')
                groups[group] = identity
        for index, row in enumerate(output.get('assay_entries', []), 2):
            if row is None:
                continue
            group = str(row.pop('batch_group', '') or '').strip()
            if not group:
                continue
            if group not in groups:
                raise RegistryError(f'성상분석 {index}행: 배선 묶음에 해당하는 배선등록 행이 없습니다.')
            voyage_id, number = groups[group]
            if row.get('voyage_number') and str(row['voyage_number']).strip() != number:
                raise RegistryError(f'성상분석 {index}행: 배선 묶음과 항차번호가 일치하지 않습니다.')
            if not row.get('cargo_no') and voyage_id:
                cargo_index = str(row.get('cargo_index') or '1')
                if not cargo_index.isdigit() or not 1 <= int(cargo_index) <= 999:
                    raise RegistryError(f'성상분석 {index}행: 화물순번은 1~999 정수입니다.')
                row['cargo_no'] = stable_id('C', f'{voyage_id}/{int(cargo_index)}')
            elif not row.get('cargo_no') and number:
                row['voyage_number'] = number
    return output, revision
