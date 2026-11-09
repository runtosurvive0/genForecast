"""Read and check the public-range coal profile table and the assumed berth table."""
from __future__ import annotations

import json
from pathlib import Path

from midterm.voyage_registry import SCHEMA

DATA_DIR = Path(__file__).resolve().parent
PROFILES_PATH = DATA_DIR / 'coal_profiles.json'
BERTHS_PATH = DATA_DIR / 'berths.json'

REGISTRY_COALS = ('AVRA', 'MERCURIA', 'Flame', 'Glencore', 'Glencore(무연탄)', 'Centennial',
                  'KCH(Kaltim)', 'KCH(adaro)', 'KCH(Arutmin)', 'LXI')
CLASSES = ('high_cv', 'low_cv')
CONFIDENCE = ('근거있음', '추정')
FUSION_ORDER = ('fusion_it', 'fusion_st', 'fusion_ht', 'fusion_ft')
REQUIRED_FIELDS = ('gcv_arb', 'tm_ar', 'im_adb', 'vm_adb', 'ash_adb', 'fc_adb', 'sulfur_ar',
                   'c_db', 'h_db', 'n_db', 'o_db', 's_db', 'hgi', 'csn', *FUSION_ORDER, 'chlorine_db_ppm',
                   'sio2', 'al2o3', 'fe2o3', 'cao', 'mgo', 'na2o', 'k2o', 'so3', 'tio2', 'ash_other')


def _registry_bounds() -> dict[str, tuple[float, float]]:
    return {f['key']: (f.get('min', float('-inf')), f.get('max', float('inf')))
            for f in SCHEMA['assays']['fields'] if f['kind'] == 'number'}


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_profiles(data: dict) -> list[str]:
    """Return a list of problems; an empty list means the table can be used."""
    errors: list[str] = []
    bounds = _registry_bounds()
    classes = data.get('classes') or {}
    for name in CLASSES:
        spec = classes.get(name) or {}
        low, high = spec.get('gcv_arb_min'), spec.get('gcv_arb_max')
        if not (_number(low) and _number(high) and low < high):
            errors.append(f'등급 {name}: gcv_arb_min/max가 올바르지 않습니다.')
        if not _number(spec.get('sulfur_ar_max')):
            errors.append(f'등급 {name}: sulfur_ar_max가 없습니다.')
    coals = data.get('coals') or {}
    for name in sorted(set(REGISTRY_COALS) - set(coals)):
        errors.append(f'탄종 누락: {name}')
    for name in sorted(set(coals) - set(REGISTRY_COALS)):
        errors.append(f'원장에 없는 탄종: {name}')
    for name, coal in coals.items():
        where = f'{name}'
        if not isinstance(coal, dict):
            errors.append(f'{where}: 탄종 정보는 객체여야 합니다.')
            continue
        if coal.get('class') not in CLASSES:
            errors.append(f'{where}: class는 high_cv 또는 low_cv여야 합니다.')
        if coal.get('confidence') not in CONFIDENCE:
            errors.append(f'{where}: confidence는 근거있음 또는 추정이어야 합니다.')
        elif coal['confidence'] == '근거있음' and not coal.get('sources'):
            errors.append(f'{where}: 근거있음이면 sources가 필요합니다.')
        if not isinstance(coal.get('anthracite'), bool):
            errors.append(f'{where}: anthracite는 참/거짓이어야 합니다.')
        fields = coal.get('fields')
        if not isinstance(fields, dict):
            errors.append(f'{where}: fields는 객체여야 합니다.')
            continue
        for key in REQUIRED_FIELDS:
            if key not in fields:
                errors.append(f'{where}.{key}: 필수 성상 칸이 없습니다.')
        for key, value in fields.items():
            if key not in bounds:
                errors.append(f'{where}.{key}: 원장 성상 칸이 아닙니다.')
                continue
            if not isinstance(value, dict) or not all(_number(value.get(k)) for k in ('typ', 'min', 'max')):
                errors.append(f'{where}.{key}: typ/min/max 숫자가 필요합니다.')
                continue
            if not value['min'] <= value['typ'] <= value['max']:
                errors.append(f'{where}.{key}: min ≤ typ ≤ max가 아닙니다.')
            low, high = bounds[key]
            if value['min'] < low or value['max'] > high:
                errors.append(f'{where}.{key}: 원장 칸 범위({low}~{high})를 벗어납니다.')
        fusion = [fields[k]['typ'] for k in FUSION_ORDER if _number((fields.get(k) or {}).get('typ'))]
        if len(fusion) == len(FUSION_ORDER) and fusion != sorted(fusion):
            errors.append(f'{where}: 회융점 typ이 IT ≤ ST ≤ HT ≤ FT 순서가 아닙니다.')
        gcv, spec = fields.get('gcv_arb'), classes.get(coal.get('class')) or {}
        if not isinstance(gcv, dict) or not _number(gcv.get('typ')):
            errors.append(f'{where}: gcv_arb가 없습니다.')
        elif _number(spec.get('gcv_arb_min')) and _number(spec.get('gcv_arb_max')):
            for part in ('typ', 'min', 'max'):
                if _number(gcv.get(part)) and not spec['gcv_arb_min'] <= gcv[part] <= spec['gcv_arb_max']:
                    errors.append(f'{where}: gcv_arb {part}가 {coal["class"]} 범위 밖입니다.')
        errors.extend(_sulfur_errors(where, fields, spec))
    return errors


def _typed(fields: dict, key: str) -> dict | None:
    value = fields.get(key)
    return value if isinstance(value, dict) and all(_number(value.get(k)) for k in ('typ', 'min', 'max')) else None


def _sulfur_errors(where: str, fields: dict, spec: dict) -> list[str]:
    errors = []
    s_ar, s_db, tm = _typed(fields, 'sulfur_ar'), _typed(fields, 's_db'), _typed(fields, 'tm_ar')
    if s_ar and _number(spec.get('sulfur_ar_max')) and s_ar['max'] > spec['sulfur_ar_max']:
        errors.append(f'{where}: sulfur_ar max가 등급 황분 상한 {spec["sulfur_ar_max"]}을 넘습니다.')
    if s_ar and s_db and tm and tm['min'] < 100:
        bound = s_ar['max'] * 100 / (100 - tm['min'])
        if s_db['max'] > bound + 1e-9:
            errors.append(f'{where}: s_db max가 sulfur_ar max·tm_ar min으로 환산한 {bound:.2f}를 넘습니다.')
    return errors


def _read(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def load_profiles(path: Path | None = None) -> dict:
    data = _read(path or PROFILES_PATH)
    errors = validate_profiles(data)
    if errors:
        raise ValueError('성상 표 오류: ' + '; '.join(errors))
    return data


def load_berths(path: Path | None = None) -> dict:
    return _read(path or BERTHS_PATH)
