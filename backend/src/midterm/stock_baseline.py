"""Dated, manually confirmed yard snapshots, independent of shipment records."""
import json
import math
from datetime import date, datetime, timezone

from midterm.database import connect
from midterm.stock_inventory import LOCATIONS

DUMMY_ACTOR = 'dummy-seed'
LOT_KEY = ('source_id', 'location', 'coal_name', 'voyage_number')


def lot_key(lot):
    return tuple(lot.get(k) for k in LOT_KEY)


def dummy_names(lot):
    return {k.strip() for k in str(lot.get('dummy_fields') or '').split(',') if k.strip()}


def unique_lots(lots):
    """Lots by lot_key, plus the keys that occur more than once (those cannot be matched)."""
    by_key, twins = {}, set()
    for lot in lots:
        key = lot_key(lot)
        if key in by_key:
            twins.add(key)
        by_key[key] = lot
    return {k: v for k, v in by_key.items() if k not in twins}, twins


def _keep_human_edits(db, day, clean):
    """A person may only keep or shrink the dummy marks of the previous baseline, never add to them.

    A marked field whose value changed is a human value and loses its mark. Unmatchable lots lose all marks."""
    row = (db.execute('SELECT payload FROM yard_baselines WHERE as_of=? ORDER BY revision DESC LIMIT 1', (day,)).fetchone()
           or db.execute('SELECT payload FROM yard_baselines ORDER BY revision DESC LIMIT 1').fetchone())
    previous, old_twins = unique_lots(json.loads(row['payload']) if row else [])
    _, new_twins = unique_lots(clean)
    for lot in clean:
        key = lot_key(lot)
        old = previous.get(key) if key not in new_twins | old_twins else None
        names = {n for n in dummy_names(lot) & dummy_names(old or {}) if lot.get(n) == old.get(n)} if old else set()
        if names:
            lot['dummy_fields'] = ','.join(sorted(names))
        else:
            lot.pop('dummy_fields', None)


def _init(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS yard_baseline_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO yard_baseline_meta VALUES(1,0);
      CREATE TABLE IF NOT EXISTS yard_baselines(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL UNIQUE, as_of TEXT NOT NULL,
        actor TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL);
    ''')


def _read(db, as_of=None):
    revision = db.execute('SELECT revision FROM yard_baseline_meta WHERE id=1').fetchone()[0]
    row = db.execute('SELECT * FROM yard_baselines WHERE (? IS NULL OR as_of<=?) ORDER BY as_of DESC, revision DESC LIMIT 1', (as_of, as_of)).fetchone()
    if not row:
        return {'revision': revision, 'as_of': None, 'lots': [], 'total_t': None}
    lots = json.loads(row['payload'])
    return {'revision': revision, 'as_of': row['as_of'], 'recorded_at': row['recorded_at'],
            'actor': row['actor'], 'lots': lots, 'total_t': sum(lot['tonnes'] for lot in lots)}


def read_baseline(path, as_of=None):
    with connect(path) as db:
        _init(db)
        return _read(db, as_of)


def save_baseline(value, revision, actor, path):
    if not isinstance(value, dict) or set(value) != {'as_of', 'lots'}:
        raise ValueError('기준일과 적치 내역을 확인하세요')
    try:
        day = date.fromisoformat(value['as_of'])
    except (ValueError, TypeError):
        raise ValueError('기준일을 확인하세요') from None
    if day > date.today():
        raise ValueError('미래 기준일은 등록할 수 없습니다')
    rows = value['lots']
    if not isinstance(rows, list) or not rows or len(rows) > 1000:
        raise ValueError('적치 내역을 확인하세요')
    allowed = {'source_id', 'location', 'coal_name', 'tonnes', 'voyage_number', 'grade', 'age_days', 'start_m', 'end_m', 'temperature_c', 'dummy_fields'}
    clean = []
    for row in rows:
        if not isinstance(row, dict) or set(row) - allowed or row.get('location') not in LOCATIONS:
            raise ValueError('적치 구역을 확인하세요')
        if not isinstance(row.get('coal_name'), str) or not row['coal_name'].strip() or len(row['coal_name']) > 100:
            raise ValueError('탄종을 확인하세요')
        amount = row.get('tonnes')
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0:
            raise ValueError('재고량을 확인하세요')
        for key in ('age_days', 'start_m', 'end_m'):
            item = row.get(key)
            if item is not None and (isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or item < 0):
                raise ValueError('적치 이력과 위치를 확인하세요')
        temp = row.get('temperature_c')
        if temp is not None and (isinstance(temp, bool) or not isinstance(temp, (int, float)) or not math.isfinite(temp) or not 0 <= temp <= 150):
            raise ValueError('더미 표시와 온도를 확인하세요')
        if row.get('dummy_fields') is not None and (not isinstance(row['dummy_fields'], str) or len(row['dummy_fields']) > 200):
            raise ValueError('더미 표시와 온도를 확인하세요')
        if row.get('start_m') is not None and row.get('end_m') is not None and row['start_m'] > row['end_m']:
            raise ValueError('적치 구간의 시작과 끝을 확인하세요')
        if any(row.get(key) is not None and (not isinstance(row[key], str) or len(row[key]) > 100) for key in ('source_id', 'voyage_number', 'grade')):
            raise ValueError('항차번호와 탄종 구분을 확인하세요')
        clean.append({**row, 'coal_name': row['coal_name'].strip(), 'tonnes': float(amount)})
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN IMMEDIATE')
        current = db.execute('SELECT revision FROM yard_baseline_meta WHERE id=1').fetchone()[0]
        if isinstance(revision, bool) or not isinstance(revision, int) or revision != current:
            raise ValueError('재고 현황이 변경되었습니다. 다시 불러오세요')
        if actor != DUMMY_ACTOR:
            _keep_human_edits(db, day.isoformat(), clean)
        next_rev = current + 1
        db.execute('INSERT INTO yard_baselines(revision,as_of,actor,recorded_at,payload) VALUES(?,?,?,?,?)',
                   (next_rev, day.isoformat(), actor, datetime.now(timezone.utc).isoformat(), json.dumps(clean, ensure_ascii=False)))
        db.execute('UPDATE yard_baseline_meta SET revision=? WHERE id=1', (next_rev,))
        return _read(db)
