"""계산 입력에 고정해 보관하는 호기 제원·연월 단가와 회귀 추정 이력."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import date, timedelta
from pathlib import Path
from statistics import linear_regression, mean

from midterm.fleet import load_coal_units, load_nuclear_units
from midterm.scenario import ROOT, Scenario, default_scenario
from midterm.units import canonical_unit_name


def number(value):
    result = float(str(value).replace(',', '').strip())
    if not math.isfinite(result):
        raise ValueError('숫자는 유한한 값이어야 합니다')
    return result


def rows_from_file(path):
    from midterm.milp_store import table_rows
    rows = table_rows(Path(path).read_bytes(), str(path))
    if not rows:
        raise ValueError(f'빈 입력 파일: {Path(path).name}')
    header = [str(v or '').strip() for v in rows[0]]
    return [{key: value for key, value in zip(header, row) if key} for row in rows[1:]
            if row and any(str(v or '').strip() for v in row)]


def normalize_master(rows, kind):
    result = []
    numeric = (['installed_mw', 'min_mw', 'max_mw', 'ramp_up_mw_min', 'ramp_down_mw_min',
                'min_up_h', 'min_down_h', 'startup_cost_won', 'heat_a2', 'heat_a1', 'heat_a0']
               if kind == 'coal' else ['installed_mw', 'available_mw'])
    for source in rows:
        row = {k: str(v if v is not None else '').strip() for k, v in source.items()}
        row['unit'] = canonical_unit_name(row.get('unit', ''))
        for key in numeric:
            row[key] = number(source[key])
        if kind == 'nuclear' and row.get('active') not in ('0', '1', 'true', 'True', 'false', 'False', 'Y', 'N'):
            raise ValueError(f"{row['unit']}: active는 0/1 또는 true/false입니다")
        result.append(row)
    if not result or any(not r['unit'] for r in result) or len({r['unit'] for r in result}) != len(result):
        raise ValueError(f'{kind}: 비어 있거나 중복된 호기 이름입니다')
    return result


def regress_prices(history, targets):
    """목표월 이전 실적만 사용하는 호기별 선형 OLS. 마지막 2개월은 검증용으로 따로 평가."""
    first_target = min(targets)
    estimates, models = {}, {}
    for source in history:
        unit = canonical_unit_name(source['unit'])
        if unit in estimates:
            raise ValueError(f'단가 이력 중복 호기: {unit}')
        months = sorted(k for k in source if len(k) == 7 and k[4] == '-' and k < first_target)
        if len(months) < 6:
            raise ValueError(f'{unit}: 회귀 추정에는 최소 6개월의 과거 단가가 필요합니다')
        x = [date.fromisoformat(m + '-01').year * 12 + int(m[5:]) for m in months]
        if x != list(range(x[0], x[-1] + 1)):
            raise ValueError(f'{unit}: 단가 이력 월 누락')
        x = [v - x[0] for v in x]
        y = [number(source[m]) for m in months]
        if min(y) <= 0:
            raise ValueError(f'{unit}: 과거 단가는 양수여야 합니다')
        slope, intercept = linear_regression(x, y)
        check_slope, check_intercept = linear_regression(x[:-2], y[:-2])
        errors = [check_slope * a + check_intercept - b for a, b in zip(x[-2:], y[-2:])]
        origin = date.fromisoformat(months[0] + '-01')
        result = {}
        for month in targets:
            at = date.fromisoformat(month + '-01')
            index = (at.year - origin.year) * 12 + at.month - origin.month
            price = round(intercept + slope * index, 2)
            if not math.isfinite(price) or price <= 0:
                raise ValueError(f'{unit} {month}: 회귀 단가가 양수가 아닙니다')
            result[month] = price
        estimates[unit] = result
        models[unit] = {'method': 'linear_ols', 'classification': 'estimated',
            'trained_from': months[0], 'trained_through': months[-1], 'samples': len(y),
            'month_origin': months[0], 'intercept': intercept, 'slope_per_month': slope,
            'history': dict(zip(months, y)), 'predictions': result,
            'holdout_months': months[-2:], 'holdout_training_through': months[-3],
            'holdout_rmse': math.sqrt(mean(e * e for e in errors)),
            'holdout_mape_pct': mean(abs(e) / v for e, v in zip(errors, y[-2:])) * 100}
    return estimates, models


def validate_reference(reference, scenario):
    from midterm.annual import WARMUP_DAYS
    if not isinstance(reference, dict):
        raise ValueError('제원·연월 단가 입력은 JSON 객체여야 합니다')
    coal_rows = normalize_master(reference['coal_units'], 'coal')
    nuclear_rows = normalize_master(reference['nuclear_units'], 'nuclear')
    coal = load_coal_units(rows=coal_rows)
    nuclear = load_nuclear_units(rows=nuclear_rows)
    if not {canonical_unit_name(u.name) for u in load_coal_units()} <= {u.name for u in coal}:
        raise ValueError('석탄 제원에 필수 호기가 누락됐습니다')
    if not {canonical_unit_name(u.name) for u in load_nuclear_units()} <= {u.name for u in nuclear}:
        raise ValueError('원전 제원에 필수 호기가 누락됐습니다')
    for u in coal:
        if (u.installed_mw <= 0 or not 0 < u.min_mw <= u.max_mw or min(u.ramp_up, u.ramp_down) <= 0
                or min(u.min_up_h, u.min_down_h, u.startup_cost_won) < 0):
            raise ValueError(f'{u.name}: 용량·램프·기동정지 제원을 확인하세요')
        a, b, c = u.heat
        points = [u.min_mw, u.max_mw]
        if a and u.min_mw <= -b / (2 * a) <= u.max_mw:
            points.append(-b / (2 * a))
        if any(a * p * p + b * p + c <= 0 for p in points):
            raise ValueError(f'{u.name}: 운전 범위의 열량곡선은 양수여야 합니다')
    if any(u.installed_mw <= 0 or u.available_mw <= 0 for u in nuclear):
        raise ValueError('원전 설비·가용 용량은 양수여야 합니다')
    first = scenario.start - timedelta(days=WARMUP_DAYS)
    months = {d.strftime('%Y-%m') for d in [first + timedelta(days=i)
              for i in range((scenario.end - first).days + 1)]}
    prices = reference['heat_prices_by_month']
    for u in coal:
        if not months <= set(prices.get(u.name, {})):
            raise ValueError(f'{u.name}: 예열을 포함한 연월 단가가 누락됐습니다: {sorted(months - set(prices.get(u.name, {})))}')
        if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in prices[u.name].values()):
            raise ValueError(f'{u.name}: 연월 단가는 양수인 유한한 값이어야 합니다')
    reference['coal_units'], reference['nuclear_units'] = coal_rows, nuclear_rows


def import_inputs(args):
    from midterm.database import DATABASE, _put, connect, save_settings
    from midterm.milp_store import clean_input, price_rows, save_input, table_rows
    from midterm.outages import load_outages
    files = [Path(getattr(args, key)) for key in ('coal_units', 'nuclear_units', 'heat_prices', 'coal_oh', 'nuclear_oh', 'price_history')]
    manifest = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
    coal, nuclear = normalize_master(rows_from_file(args.coal_units), 'coal'), normalize_master(rows_from_file(args.nuclear_units), 'nuclear')
    overrides = []
    for value in args.activate_nuclear_unit:
        name, start = value.split('=', 1)
        name = canonical_unit_name(name)
        date.fromisoformat(start)
        rows = [r for r in nuclear if r['unit'] == name]
        if len(rows) != 1:
            raise ValueError(f'가동 개시 대상 원전 미등록: {name}')
        rows[0]['active_from'] = start
        overrides.append({'unit': name, 'active_from': start, 'source': 'user_instruction'})
    history = rows_from_file(args.price_history)
    estimates, models = regress_prices(history, [f'{args.price_year - 1}-11', f'{args.price_year - 1}-12'])
    prices = price_rows(table_rows(Path(args.heat_prices).read_bytes(), args.heat_prices))
    prices = {canonical_unit_name(k): v for k, v in prices.items()}
    dated = {}
    for row in history:
        name = canonical_unit_name(row['unit'])
        dated[name] = {k: number(v) for k, v in row.items() if len(k) == 7 and k[4] == '-'}
        dated[name].update(estimates[name])
    for name, values in prices.items():
        dated.setdefault(name, {}).update({f'{args.price_year}-{i+1:02d}': v for i, v in enumerate(values)})
    reference = {'coal_units': coal, 'nuclear_units': nuclear, 'heat_prices_by_month': dated,
                 'price_regression': models, 'overrides': overrides, 'source_files': manifest}
    scenario = default_scenario()
    scenario.name = args.name
    if args.start:
        scenario.start = date.fromisoformat(args.start)
        scenario.end = scenario.start + timedelta(days=89)
    if args.end:
        scenario.end = date.fromisoformat(args.end)
    scenario.coal_oh, scenario.nuclear_oh = load_outages(Path(args.coal_oh)), load_outages(Path(args.nuclear_oh))
    payload = clean_input(scenario.to_json(), prices, {'calorific_kcal_kg': 5500, 'is_assumption': True,
        'source': '연료 구매계획의 임시 기준값 · 재고 전망은 저탄장 DB 탄질 사용'}, manifest, reference)
    path = Path(args.database) if args.database else DATABASE
    # 입력·제원을 먼저 검증한 뒤 저장한다. 같은 자료 재등록은 기존 입력 ID를 돌려준다.
    saved = save_input(payload, path)
    save_settings(scenario, payload['fuel'], path)
    with connect(path) as db:
        _put(db, 'active_milp_input_id', saved['id'])
    return {'input_id': saved['id'], 'database': str(path), 'start': scenario.start.isoformat(), 'end': scenario.end.isoformat(),
            'coal_units': len(coal), 'nuclear_units': len(nuclear), 'coal_outages': len(scenario.coal_oh),
            'nuclear_outages': len(scenario.nuclear_oh), 'estimated_unit_months': sum(len(v) for v in estimates.values()),
            'holdout_mape_pct_mean': mean(v['holdout_mape_pct'] for v in models.values())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('coal-units', 'nuclear-units', 'heat-prices', 'coal-oh', 'nuclear-oh'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--price-history', default=str(ROOT / 'data/heat_price_history_2026.csv.json'))
    parser.add_argument('--price-year', type=int, default=2027)
    parser.add_argument('--database')
    parser.add_argument('--name', default='오늘부터90일·CSV연계')
    parser.add_argument('--start')
    parser.add_argument('--end')
    parser.add_argument('--activate-nuclear-unit', action='append', default=[])
    print(json.dumps(import_inputs(parser.parse_args()), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
