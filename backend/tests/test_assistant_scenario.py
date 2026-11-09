"""simulate_scenario(가정 계산) 도구 테스트."""
from datetime import timedelta
from pathlib import Path

from midterm.assistant.tools import ToolContext, run_tool
from midterm.supply import now
from supply_helpers import seed_baselines_and_plan, seed_incoming_vessel
from test_supply_api import client  # noqa: F401  (인증된 서버 픽스처 재사용)


def ctx_for(client):  # noqa: F811
    return ToolContext(request=None, now=now(), db_path=Path('unused.sqlite3'))


def test_load_cut_raises_days_and_delay_lowers_stock(client):  # noqa: F811
    at, _ = seed_baselines_and_plan(client)
    vid = seed_incoming_vessel(client, at + timedelta(days=2), group='g58', tonnes=50000)
    cut = run_tool('simulate_scenario', {'changes': [{'kind': 'load', 'fromDay': 0, 'toDay': 6, 'pct': -20}], 'horizon_days': 7}, ctx_for(client))
    assert cut['ok'] and cut['source'] == 'simulation'
    g = {x['id']: x for x in cut['data']['scenario']['groups']}
    b = {x['id']: x for x in cut['data']['baseline']['groups']}
    assert g['g14']['min_days'] > b['g14']['min_days']
    late = run_tool('simulate_scenario', {'changes': [{'kind': 'delay', 'vesselId': str(vid), 'days': 3}], 'horizon_days': 7}, ctx_for(client))
    assert late['data']['diff']['g58']['min_stock_t'] < 0


def test_unsupported_and_invalid_changes(client):  # noqa: F811
    seed_baselines_and_plan(client)
    r = run_tool('simulate_scenario', {'changes': [{'kind': 'outage', 'berth': 1, 'from': 0, 'to': 12, 'factor': 0}], 'horizon_days': 7}, ctx_for(client))
    assert r['ok'] and r['data']['unsupported'] == ['부두 설비 정지는 아직 백엔드 전망에 반영되지 않습니다']
    s = run_tool('simulate_scenario', {'changes': [{'kind': 'strategy', 'name': 'x'}], 'horizon_days': 7}, ctx_for(client))
    assert s['data']['unsupported'] == ['상탄 전략은 아직 백엔드 전망에 반영되지 않습니다']
    assert run_tool('simulate_scenario', {'changes': [{'kind': 'load', 'fromDay': 0, 'toDay': 1, 'pct': 90}], 'horizon_days': 7}, ctx_for(client))['ok'] is False
    assert run_tool('simulate_scenario', {'changes': [{'kind': 'delay', 'vesselId': '없는배', 'days': 1}], 'horizon_days': 7}, ctx_for(client)) == \
        {'ok': False, 'error': '선박을 찾을 수 없습니다: 없는배'}
