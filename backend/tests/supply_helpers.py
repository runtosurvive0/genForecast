"""공급 API 테스트 공용 준비 헬퍼."""
from datetime import datetime, timedelta

from midterm.supply import now


def seed_baselines_and_plan(client) -> tuple[datetime, str]:
    """그룹별 기준재고 100,000 t·5,500 kcal/kg와 15일 계획을 등록하고 (기준시각, plan_key)를 돌려준다."""
    at = now().replace(minute=0, second=0, microsecond=0)
    for g in ('g14', 'g58', 'g910'):
        result = client.post('/api/supply/baselines', json={'group_id': g, 'at': at.isoformat(),
            'tonnes': 100000, 'cv': 5500, 'moisture': 10, 'ash': 10, 'sulfur': .5})
        assert result.status_code == 200
    start = at.replace(hour=0)
    rows = [{'at': (start + timedelta(hours=h)).isoformat(), 'unit': f'당진{i}', 'mw': 300 if i < 9 else 600, 'online': True}
            for h in range(15 * 24) for i in range(1, 11)]
    batch = client.post('/api/supply/plans', json={'source': 'API', 'source_name': '테스트 계획',
                       'as_of': at.isoformat(), 'rows': rows})
    assert batch.status_code == 200
    return at, f'db:{batch.json()["id"]}'
