"""Explicit, audited cargo-to-pile inventory; no inferred sensor readings."""
import json
import math
from datetime import date, datetime, timezone

from midterm.database import connect
from midterm.voyage_registry import KST, init_schema, _snapshot


LOCATIONS = {**{f'P{i}': i // 5 + 1 for i in range(1, 9)},
             **{f'{shed}{i}': 3 for shed in 'AB' for i in range(1, 11)}}


def _init(db):
    init_schema(db)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS stock_inventory_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO stock_inventory_meta VALUES(1,0);
      CREATE TABLE IF NOT EXISTS stock_inventory_lots(
        id INTEGER PRIMARY KEY, cargo_no TEXT NOT NULL REFERENCES voyage_registry_cargo(cargo_no),
        location TEXT NOT NULL, initial_t REAL NOT NULL CHECK(initial_t > 0),
        remaining_t REAL NOT NULL CHECK(remaining_t >= 0), updated_at TEXT NOT NULL,
        receipt_at TEXT, recorded_receipt_end TEXT,
        UNIQUE(cargo_no,location));
      CREATE TABLE IF NOT EXISTS stock_inventory_audit(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, lot_id INTEGER NOT NULL,
        actor TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL, before_t REAL, after_t REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS stock_inventory_reconciliations(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, cargo_no TEXT NOT NULL,
        actor TEXT NOT NULL, actor_name TEXT, reason TEXT NOT NULL, at TEXT NOT NULL,
        before_json TEXT NOT NULL, after_json TEXT NOT NULL);
    ''')
    columns = {row['name'] for row in db.execute('PRAGMA table_info(stock_inventory_lots)')}
    for column in ('receipt_at', 'recorded_receipt_end'):
        if column not in columns:
            db.execute(f'ALTER TABLE stock_inventory_lots ADD COLUMN {column} TEXT')
    if 'active' not in columns:
        db.execute('ALTER TABLE stock_inventory_lots ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
    audit_columns = {row['name'] for row in db.execute('PRAGMA table_info(stock_inventory_reconciliations)')}
    if 'actor_name' not in audit_columns:
        db.execute('ALTER TABLE stock_inventory_reconciliations ADD COLUMN actor_name TEXT')


def _revision(db, expected):
    revision = db.execute('SELECT revision FROM stock_inventory_meta WHERE id=1').fetchone()[0]
    if isinstance(expected, bool) or not isinstance(expected, int) or revision != expected:
        raise ValueError('재고 원장이 변경되었습니다. 다시 불러오세요')
    return revision + 1


DUMMY_CARGO = '더미 화물은 실제 재고에 반영할 수 없습니다'


def _reject_dummy(item):
    """Cargo made whole by the dummy-data loader never becomes real stock (unload could not remove it then)."""
    if item and item['data_origin'] == 'dummy':
        raise ValueError(DUMMY_CARGO)


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('물량은 0 이상의 숫자로 입력하세요')
    return float(value)


def _read(db):
    data = _snapshot(db)
    cargo = {row['cargo_no']: row for row in data['cargo']}
    voyages = {row['voyage_no']: row for row in data['voyages']}
    ships = {row['ship_code']: row for row in data['ships']}
    rows = [dict(row) for row in db.execute('SELECT * FROM stock_inventory_lots WHERE active=1 ORDER BY id')]
    corrections = {row['lot_id']: row['at'] for row in db.execute(
        'SELECT lot_id, MAX(at) AS at FROM stock_inventory_audit WHERE before_t IS NOT NULL GROUP BY lot_id')}
    totals = {}
    for row in rows:
        totals[row['cargo_no']] = totals.get(row['cargo_no'], 0.) + row['initial_t']
    for row in rows:
        item = cargo[row['cargo_no']]
        voyage = voyages[item['voyage_no']]
        ship = ships.get(voyage.get('ship_code')) or {}
        row.update(yard=LOCATIONS[row['location']], coal_name=item['coal_name'],
                   voyage_number=voyage.get('voyage_number'), plan_name=voyage.get('plan_name'),
                   actual_unload_end=voyage.get('actual_unload_end'), mmsi=ship.get('mmsi'), vessel_name=ship.get('name'),
                   balance_updated_at=corrections.get(row['id']),
                   receipt_end_date=item.get('receipt_end_date'), assay=data['quality_selection'].get(row['cargo_no']),
                   needs_review=(item.get('received_t') is None or
                                 abs(totals[row['cargo_no']] - item['received_t']) > 0.001 or
                                 item.get('destination_plant_id') != 'dangjin' or
                                 not row.get('receipt_at') or row.get('receipt_at') != voyage.get('actual_unload_end') or
                                 not row.get('recorded_receipt_end') or row.get('recorded_receipt_end') != item.get('receipt_end_date')))
    revisions = []
    for record in db.execute('SELECT * FROM stock_inventory_reconciliations ORDER BY id DESC'):
        value = dict(record)
        value['before'] = json.loads(value.pop('before_json'))
        value['after'] = json.loads(value.pop('after_json'))
        revisions.append(value)
    return {'revision': db.execute('SELECT revision FROM stock_inventory_meta WHERE id=1').fetchone()[0],
            'lots': rows, 'reconciliations': revisions,
            'audit': [dict(row) for row in db.execute('SELECT * FROM stock_inventory_audit ORDER BY id DESC LIMIT 100')]}


def inventory_snapshot(path):
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN')
        return _read(db)


def assign_receipt(cargo_no, allocations, revision, actor, path):
    if not isinstance(allocations, list) or not allocations:
        raise ValueError('적치 구역과 물량을 입력하세요')
    rows = []
    for row in allocations:
        if not isinstance(row, dict) or row.get('location') not in LOCATIONS:
            raise ValueError('적치 구역을 확인하세요')
        tonnes = _number(row.get('tonnes'))
        if tonnes <= 0 or any(item[0] == row['location'] for item in rows):
            raise ValueError('중복되지 않는 구역과 0보다 큰 적치량을 입력하세요')
        rows.append((row['location'], tonnes))
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN IMMEDIATE')
        next_rev = _revision(db, revision)
        item = db.execute('''SELECT c.*, v.actual_unload_end FROM voyage_registry_cargo c
                             JOIN voyage_registry_voyages v ON c.voyage_no=v.voyage_no WHERE c.cargo_no=?''', (cargo_no,)).fetchone()
        _reject_dummy(item)
        if not item or item['destination_plant_id'] != 'dangjin' or item['received_t'] is None or not item['receipt_end_date'] or not item['actual_unload_end']:
            raise ValueError('당진 화물의 입하량, 입고 종료일과 실제 하역완료 시각이 필요합니다')
        if (datetime.fromisoformat(item['actual_unload_end']).astimezone(timezone.utc) > datetime.now(timezone.utc) or
                date.fromisoformat(item['receipt_end_date']) > datetime.now(KST).date()):
            raise ValueError('미래 입고나 하역완료는 실제 재고로 반영할 수 없습니다')
        if abs(sum(row[1] for row in rows) - item['received_t']) > 0.001:
            raise ValueError('Pile별 적치량 합계가 입하량과 같아야 합니다')
        if db.execute('SELECT 1 FROM stock_inventory_lots WHERE cargo_no=?', (cargo_no,)).fetchone():
            raise ValueError('이미 재고에 반영된 화물입니다')
        stamp = datetime.now(timezone.utc).isoformat()
        for location, amount in rows:
            row = db.execute('''INSERT INTO stock_inventory_lots(cargo_no,location,initial_t,remaining_t,updated_at,receipt_at,recorded_receipt_end)
                                VALUES(?,?,?,?,?,?,?)''',
                             (cargo_no, location, amount, amount, stamp, item['actual_unload_end'], item['receipt_end_date']))
            db.execute('INSERT INTO stock_inventory_audit(revision,lot_id,actor,reason,at,before_t,after_t) VALUES(?,?,?,?,?,?,?)',
                       (next_rev, row.lastrowid, actor, '입하 반영', stamp, None, amount))
        db.execute('UPDATE stock_inventory_meta SET revision=? WHERE id=1', (next_rev,))
        return _read(db)


def correct_balance(lot_id, remaining_t, reason, revision, actor, path):
    value = _number(remaining_t)
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 300:
        raise ValueError('잔량 변경 사유를 입력하세요')
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN IMMEDIATE')
        next_rev = _revision(db, revision)
        row = db.execute('SELECT * FROM stock_inventory_lots WHERE id=? AND active=1', (lot_id,)).fetchone()
        if not row or value > row['initial_t']:
            raise ValueError('더미 또는 잔량을 확인하세요')
        stamp = datetime.now(timezone.utc).isoformat()
        db.execute('UPDATE stock_inventory_lots SET remaining_t=?,updated_at=? WHERE id=?', (value, stamp, lot_id))
        db.execute('INSERT INTO stock_inventory_audit(revision,lot_id,actor,reason,at,before_t,after_t) VALUES(?,?,?,?,?,?,?)',
                   (next_rev, lot_id, actor, reason.strip(), stamp, row['remaining_t'], value))
        db.execute('UPDATE stock_inventory_meta SET revision=? WHERE id=1', (next_rev,))
        return _read(db)


def reconcile_receipt(cargo_no, allocations, reason, revision, registry_revision, actor, path, actor_name=None):
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 300:
        raise ValueError('정정 사유를 입력하세요')
    if not isinstance(allocations, list) or not allocations:
        raise ValueError('정정할 적치 구역과 물량을 입력하세요')
    rows = []
    for entry in allocations:
        if not isinstance(entry, dict) or entry.get('location') not in LOCATIONS:
            raise ValueError('적치 구역을 확인하세요')
        tonnes, remaining = _number(entry.get('tonnes')), _number(entry.get('remaining_t'))
        if tonnes <= 0 or remaining > tonnes or any(x[0] == entry['location'] for x in rows):
            raise ValueError('중복되지 않는 구역과 적치량 이하의 잔량을 입력하세요')
        rows.append((entry['location'], tonnes, remaining))
    with connect(path) as db:
        _init(db)
        db.execute('BEGIN IMMEDIATE')
        next_rev = _revision(db, revision)
        reg_rev = db.execute('SELECT revision FROM voyage_registry_meta WHERE id=1').fetchone()[0]
        if isinstance(registry_revision, bool) or not isinstance(registry_revision, int) or reg_rev != registry_revision:
            raise ValueError('항차 원장이 변경되었습니다. 다시 불러오세요')
        item = db.execute('''SELECT c.*,v.actual_unload_end FROM voyage_registry_cargo c
                             JOIN voyage_registry_voyages v ON c.voyage_no=v.voyage_no WHERE c.cargo_no=?''', (cargo_no,)).fetchone()
        _reject_dummy(item)
        if not item or item['destination_plant_id'] != 'dangjin' or item['received_t'] is None or not item['receipt_end_date'] or not item['actual_unload_end']:
            raise ValueError('당진 화물의 입하량, 입고 종료일과 실제 하역완료 시각이 필요합니다')
        if (datetime.fromisoformat(item['actual_unload_end']).astimezone(timezone.utc) > datetime.now(timezone.utc) or
                date.fromisoformat(item['receipt_end_date']) > datetime.now(KST).date()):
            raise ValueError('미래 입고나 하역완료는 실제 재고로 반영할 수 없습니다')
        if abs(sum(r[1] for r in rows) - item['received_t']) > .001:
            raise ValueError('Pile별 적치량 합계가 입하량과 같아야 합니다')
        before = [r for r in _read(db)['lots'] if r['cargo_no'] == cargo_no]
        if not before:
            raise ValueError('기존 적치 내역이 없습니다')
        stamp = datetime.now(timezone.utc).isoformat()
        db.execute('UPDATE stock_inventory_lots SET active=0 WHERE cargo_no=?', (cargo_no,))
        for location, amount, remaining in rows:
            db.execute('''INSERT INTO stock_inventory_lots(cargo_no,location,initial_t,remaining_t,updated_at,receipt_at,recorded_receipt_end,active)
                          VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(cargo_no,location) DO UPDATE SET
                          initial_t=excluded.initial_t,remaining_t=excluded.remaining_t,updated_at=excluded.updated_at,
                          receipt_at=excluded.receipt_at,recorded_receipt_end=excluded.recorded_receipt_end,active=1''',
                       (cargo_no, location, amount, remaining, stamp, item['actual_unload_end'], item['receipt_end_date']))
        after = [r for r in _read(db)['lots'] if r['cargo_no'] == cargo_no]
        db.execute('''INSERT INTO stock_inventory_reconciliations(revision,cargo_no,actor,actor_name,reason,at,before_json,after_json)
                      VALUES(?,?,?,?,?,?,?,?)''', (next_rev, cargo_no, actor, actor_name, reason.strip(), stamp,
                                                   json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False)))
        db.execute('UPDATE stock_inventory_meta SET revision=? WHERE id=1', (next_rev,))
        return _read(db)
