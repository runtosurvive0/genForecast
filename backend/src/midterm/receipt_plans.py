"""Shared receipt review plans; never posts movements or changes inventory."""
import json
import math
import re
from datetime import date, datetime, timezone
from uuid import uuid4

from midterm.database import connect

FIELDS = {'name', 'runId', 'forecastStart', 'forecastHorizon', 'groupId', 'arrival', 'quantity', 'capacity', 'leadDays', 'storageDays',
          'berth', 'endpoint', 'pileCapacity', 'projectedStock', 'useStart', 'dailyUse'}
NUMBERS = {'quantity', 'capacity', 'leadDays', 'storageDays', 'pileCapacity', 'projectedStock', 'dailyUse'}


class PlanConflict(Exception):
    pass


def _init(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS receipt_review_plans(
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        updated_at TEXT NOT NULL, actor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipt_review_plan_audit(
        id INTEGER PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
        actor TEXT NOT NULL, updated_at TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL);
    ''')


def _clean(plan):
    if not isinstance(plan, dict) or set(plan) != FIELDS or any(not isinstance(v, str) or len(v) > 120 for v in plan.values()):
        raise ValueError('계획 입력을 확인하세요')
    value = {key: item.strip() for key, item in plan.items()}
    if not value['name'] or not value['runId'] or value['groupId'] not in ('g14', 'g58', 'g910') or value['forecastHorizon'] not in ('7', '30', '60', '90'):
        raise ValueError('계획명과 발전처를 확인하세요')
    if value['berth'] not in ('', '1', '2', '3') or value['endpoint'] not in ('', *(f'pile-{n}' for n in range(1, 9)), 'shed-a', 'shed-b'):
        raise ValueError('부두와 구역을 확인하세요')
    if not value['forecastStart']:
        raise ValueError('전망 기준일을 확인하세요')
    for key in ('arrival', 'useStart', 'forecastStart'):
        if value[key]:
            try:
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value[key]): raise ValueError()
                date.fromisoformat(value[key])
            except ValueError:
                raise ValueError('날짜를 확인하세요') from None
    for key in NUMBERS:
        if value[key]:
            try:
                n = float(value[key])
                if not math.isfinite(n) or n < 0 or n > 1e12: raise ValueError()
                if key in ('capacity', 'pileCapacity') and n == 0: raise ValueError()
                if key in ('leadDays', 'storageDays') and (n != int(n) or n > 3650): raise ValueError()
            except ValueError:
                raise ValueError('물량과 일수를 확인하세요') from None
    return value


def _row(row):
    return {'id': row['id'], 'revision': row['revision'], 'plan': json.loads(row['payload']),
            'updated_at': row['updated_at'], 'actor': row['actor']}


def list_plans(path):
    with connect(path) as db:
        _init(db)
        return {'plans': [_row(row) for row in db.execute('SELECT * FROM receipt_review_plans ORDER BY updated_at DESC, id')]}


def save_plan(plan_id, revision, plan, actor, path):
    clean = _clean(plan)
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError('계획 버전을 확인하세요')
    if plan_id is not None and (not isinstance(plan_id, str) or not re.fullmatch(r'[0-9a-f]{32}', plan_id)):
        raise ValueError('계획 식별자를 확인하세요')
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT * FROM receipt_review_plans WHERE id=?', (plan_id,)).fetchone() if plan_id else None
        if (plan_id and (not old or old['revision'] != revision)) or (plan_id is None and revision != 0):
            raise PlanConflict('다른 사용자가 계획을 변경했습니다. 다시 불러와 확인하세요.')
        plan_id = plan_id or uuid4().hex
        next_rev = revision + 1
        timestamp = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(clean, ensure_ascii=False)
        db.execute('INSERT OR REPLACE INTO receipt_review_plans VALUES(?,?,?,?,?)', (plan_id, next_rev, payload, timestamp, actor))
        db.execute('INSERT INTO receipt_review_plan_audit(plan_id,revision,actor,updated_at,before_json,after_json) VALUES(?,?,?,?,?,?)',
                   (plan_id, next_rev, actor, timestamp, old['payload'] if old else None, payload))
        return _row(db.execute('SELECT * FROM receipt_review_plans WHERE id=?', (plan_id,)).fetchone())
