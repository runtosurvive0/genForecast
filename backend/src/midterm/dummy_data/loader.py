"""Reversible check/load/unload of the dummy data on a planning DB, with a backup before every write.

check and the previews never touch the target file: they work on a temporary backup copy."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path

from midterm.database import connect
from midterm.stock_baseline import DUMMY_ACTOR, LOT_KEY, dummy_names, read_baseline, save_baseline, unique_lots
from midterm.voyage_registry import (DUMMY_ORIGIN, KST, PURGE_ORDER, SCHEMA, RegistryError, commit, dummy_keys,
                                     purge, snapshot)

from .generate import DEFAULT_SEED, ENTITIES, STOCKED_FROM_STATUS, generate

ACTOR = 'dummy-seed'
BACKUP_FILE = 'planning.sqlite3'
DEFAULT_BACKUP_ROOT = Path('~/.config/genforecast/backups')
# Fields unload never blanks on a kept row, so the row still passes the registry's own checks.
KEEP = {'voyages': {'status'}, 'cargo': {'voyage_no', 'destination_plant_id', 'coal_name', 'bl_t'},
        'assays': {'cargo_no', 'stage'}}
# A basis stays while a value that needs it stays.
BASIS = {'cv_basis': ('cv',), 'analysis_basis': ('ash_pct', 'sulfur_pct', 'volatile_pct', 'fixed_carbon_pct')}
PARENT = {'assays': ('cargo', 'cargo_no'), 'cargo': ('voyages', 'voyage_no')}


def _now() -> datetime:
    return datetime.now(KST)


def _require(path: Path) -> Path:
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f'대상 DB 파일이 없습니다: {path}')
    return path


def _copy(src: Path, dst: Path) -> None:
    """SQLite online backup, reading the source read-only."""
    with sqlite3.connect(f'{src.resolve().as_uri()}?mode=ro', uri=True) as source:
        target = sqlite3.connect(dst)
        try:
            source.backup(target)
        finally:
            target.close()
    source.close()


def backup(path: Path, backup_root: Path | None = None) -> Path:
    """Copy the DB to <root>/dummy-YYYYmmdd-HHMMSS[-n]/planning.sqlite3 (KST) and return the file."""
    path = _require(path)
    root = Path(backup_root or os.environ.get('GENFORECAST_BACKUP_DIR') or DEFAULT_BACKUP_ROOT).expanduser()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = 'dummy-' + _now().strftime('%Y%m%d-%H%M%S')
    folder, n = root / stamp, 1
    while True:
        try:
            folder.mkdir(mode=0o700)
            break
        except FileExistsError:
            n += 1
            folder = root / f'{stamp}-{n}'
    try:
        os.chmod(folder, 0o700)
    except OSError:
        pass
    target = folder / BACKUP_FILE
    _copy(path, target)
    with sqlite3.connect(target) as db:
        ok = db.execute('PRAGMA quick_check').fetchone()[0]
    db.close()
    if ok != 'ok':
        raise RuntimeError(f'백업 검사 실패: {target}')
    return target


def _on_copy(path: Path, action):
    """Run action(copy) on a temporary backup copy so the target file is never written."""
    path = _require(path)
    with tempfile.TemporaryDirectory(prefix='genforecast-dummy-') as folder:
        copy = Path(folder) / BACKUP_FILE
        _copy(path, copy)
        return action(copy)


def _plan(path: Path, seed: int):
    registry = snapshot(path)
    baseline = read_baseline(path)
    return registry, baseline, generate(registry, baseline, seed=seed)


def _summary(stats: dict) -> dict:
    fill = stats['fill']
    return {'create': dict(stats['create']),
            'fill_rows': sum(v['rows'] for v in fill.values()),
            'fill_fields': sum(v['fields'] for v in fill.values()),
            'kept_real_values': stats['kept_real_values'], 'baseline_fill': stats['baseline_fill']}


def check(path: Path, *, seed: int = DEFAULT_SEED) -> dict:
    """What load would do. Reads only."""
    def run(copy):
        registry, baseline, plan = _plan(copy, seed)
        return {**_summary(plan.stats), 'registry_revision': registry['revision'],
                'baseline_revision': baseline['revision'], 'baseline_as_of': baseline['as_of']}
    return {'db': str(Path(path)), **_on_copy(path, run)}


def load(path: Path, *, seed: int = DEFAULT_SEED, backup_root: Path | None = None) -> dict:
    path = _require(path)
    saved = backup(path, backup_root)
    registry, baseline, plan = _plan(path, seed)
    after = commit(plan.changes, registry['revision'], ACTOR, DUMMY_ORIGIN, path)
    baseline_revision = baseline['revision']
    if plan.baseline is not None:
        baseline_revision = save_baseline(plan.baseline, baseline['revision'], ACTOR, path)['revision']
    return {'db': str(path), 'backup': str(saved), **_summary(plan.stats),
            'registry_revision': after['revision'], 'baseline_revision': baseline_revision}


def _edited_elsewhere(path: Path, registry: dict) -> set[tuple[str, str]]:
    """Dummy/mixed rows last written by someone other than the loader in a way the markers do not account for.

    The current app updates data_origin/dummy_fields on every human edit and audits the full row with them, so a
    row whose latest audit entry is by its updated_by and equals the stored row is trusted. A row changed by an
    older app (which keeps the markers and audits without them) or behind the registry's back is not: which of its
    dummy fields a person changed is unknown, so unload keeps the whole row and reports it."""
    candidates = {(entity, row[SCHEMA[entity]['key']]): row for entity in ENTITIES for row in registry[entity]
                  if row.get('data_origin') in ('dummy', 'mixed') and row.get('updated_by') != ACTOR}
    if not candidates:
        return set()
    with connect(path) as db:
        latest = {(r['entity'], r['record_key']): (r['actor'], r['after_json']) for r in db.execute(
            'SELECT entity, record_key, actor, after_json FROM voyage_registry_audit WHERE id IN '
            '(SELECT MAX(id) FROM voyage_registry_audit GROUP BY entity, record_key)')}
    edited = set()
    for (entity, key), row in candidates.items():
        actor, after_json = latest.get((entity, key), (None, None))
        try:
            after = json.loads(after_json) if after_json else None
        except ValueError:
            after = None
        trusted = (isinstance(after, dict) and actor == row.get('updated_by') and 'data_origin' in after
                   and all(after.get(f['key']) == row.get(f['key']) for f in SCHEMA[entity]['fields']))
        if not trusted:
            edited.add((entity, key))
    return edited


def _kept_edited(registry: dict, edited: set) -> list:
    return [{'entity': entity, 'key': row[SCHEMA[entity]['key']], 'fields': sorted(dummy_keys(row, entity))}
            for entity in ENTITIES for row in registry[entity] if (entity, row[SCHEMA[entity]['key']]) in edited]


def _clear_changes(registry: dict, edited: set = frozenset()) -> tuple[dict, list, dict]:
    """Blank the dummy fields of mixed rows; keep required fields and bases still in use."""
    changes, kept, cleared = {e: [] for e in ENTITIES}, [], {'rows': 0, 'fields': 0}
    for entity in ENTITIES:
        key_field = SCHEMA[entity]['key']
        required = KEEP[entity] | {f['key'] for f in SCHEMA[entity]['fields'] if f['required']}
        for row in registry[entity]:
            if row.get('data_origin') != 'mixed' or (entity, row[key_field]) in edited:
                continue
            dummies = dummy_keys(row, entity)
            keep = dummies & required
            for basis, users in BASIS.items():
                if basis in dummies and any(row.get(u) is not None and u not in dummies for u in users):
                    keep.add(basis)
            blank = dummies - keep
            restored = {}
            if (entity == 'voyages' and not row[key_field].startswith('DV-') and 'status' in keep
                    and 'actual_unload_end' in blank):
                # generate() turned an entered 'arrived' into 'completed' because the yard holds the coal.
                keep.discard('status')
                restored = {'status': STOCKED_FROM_STATUS}
            change = {key_field: row[key_field], **{k: None for k in blank}, **restored,
                      'data_origin': 'mixed' if keep else 'entered',
                      'dummy_fields': ','.join(sorted(keep)) or None}
            if keep:
                kept.append({'entity': entity, 'key': row[key_field], 'fields': sorted(keep)})
            if blank or row.get('dummy_fields') != change['dummy_fields']:
                changes[entity].append(change)
                cleared['rows'] += bool(blank)
                cleared['fields'] += len(blank)
    return changes, kept, cleared


def _purge_keys(registry: dict, edited: set = frozenset()) -> tuple[dict, list]:
    """Whole-dummy rows to delete, children first; a parent with a remaining child stays.

    Rows in edited stay too (reported as kept_edited, not here)."""
    keys, kept = {}, []
    remaining_parents: dict[str, set] = {'cargo': set(), 'voyages': set()}
    for entity in PURGE_ORDER:
        key_field = SCHEMA[entity]['key']
        keys[entity] = []
        for row in registry[entity]:
            key = row[key_field]
            dummy = row.get('data_origin') == 'dummy' and (entity, key) not in edited
            if dummy and key not in remaining_parents.get(entity, set()):
                keys[entity].append(key)
                continue
            if dummy:
                kept.append({'entity': entity, 'key': key})
            if entity in PARENT:
                parent, ref = PARENT[entity]
                remaining_parents[parent].add(row[ref])
    return keys, kept


def _purge_dummy(path: Path, keys: dict, registry: dict) -> dict:
    """Defence line: every key must still be a whole-dummy row of this registry revision."""
    rows = {e: {row[SCHEMA[e]['key']]: row for row in registry[e]} for e in PURGE_ORDER}
    edited = _edited_elsewhere(path, registry)
    for entity, entity_keys in keys.items():
        for key in entity_keys:
            row = rows.get(entity, {}).get(key)
            if row is None or row.get('data_origin') != 'dummy':
                raise RegistryError(f"{SCHEMA[entity]['label']} {key}: 더미 행이 아니어서 삭제하지 않습니다.")
            if (entity, key) in edited:
                raise RegistryError(f"{SCHEMA[entity]['label']} {key}: 사람이 고친 더미 행이어서 삭제하지 않습니다.")
    return purge(keys, registry['revision'], ACTOR, DUMMY_ORIGIN, path)


def _dummy_cargo_in_stock(path: Path) -> None:
    """Stop before any write when a whole-dummy cargo is referenced by the real stock inventory."""
    with connect(path) as db:
        tables = {r['name'] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'stock_inventory_lots', 'voyage_registry_cargo'} <= tables:
            return
        found = [r['cargo_no'] for r in db.execute(
            "SELECT DISTINCT l.cargo_no FROM stock_inventory_lots l JOIN voyage_registry_cargo c "
            "ON c.cargo_no=l.cargo_no WHERE c.data_origin='dummy' ORDER BY l.cargo_no")]
    if found:
        raise ValueError('실제 재고(stock_inventory_lots)에 반영된 더미 화물이 있어 회수를 멈춥니다: '
                         f"{', '.join(found)}. 재고 반영을 먼저 정리한 뒤 다시 실행하세요. 원장과 기준재고는 바꾸지 않았습니다.")


def _unique(lots: list[dict], what: str) -> dict:
    by_key, twins = unique_lots(lots)
    if twins:
        raise ValueError(f'{what} 기준재고에 같은 적치 키(source_id·location·coal_name·voyage_number)가 겹칩니다: '
                         f'{sorted(map(str, twins))[:3]}. 대응할 수 없어 회수를 멈춥니다.')
    return by_key


def _latest_payload(db, sql: str, args: tuple):
    row = db.execute(sql + ' ORDER BY revision DESC LIMIT 1', args).fetchone()
    return (json.loads(row['payload']), row['revision'], row['as_of']) if row else (None, None, None)


def _plan_baseline(path: Path) -> tuple[list[dict], int, list]:
    """New revisions without dummy values for every baseline day whose latest revision still has dummy marks.

    A marked field is removed only while it still holds the value of the same lot in the loader's last baseline
    (any day: marks are carried when a person saves the next day). A different value is a person's: it stays,
    loses its mark and is reported in kept_baseline. Removed fields get back the blank of the last baseline a
    person saved before the loader's, of the same day if there is one, else of the loader's day."""
    read_baseline(path)  # creates the baseline tables on an old DB
    with connect(path) as db:
        days = [r['as_of'] for r in db.execute('SELECT DISTINCT as_of FROM yard_baselines ORDER BY as_of')]
        latest = {day: _latest_payload(db, 'SELECT payload, revision, as_of FROM yard_baselines WHERE as_of=?', (day,))
                  for day in days}
        marked = [day for day in days if any(lot.get('dummy_fields') for lot in latest[day][0])]
        if not marked:
            return [], 0, []
        seeded, seed_revision, seed_day = _latest_payload(
            db, 'SELECT payload, revision, as_of FROM yard_baselines WHERE actor=?', (DUMMY_ACTOR,))
        before = {}
        if seed_revision is not None:
            for day in {*marked, seed_day}:
                before[day] = _latest_payload(db, 'SELECT payload, revision, as_of FROM yard_baselines '
                                              'WHERE as_of=? AND revision<? AND actor<>?',
                                              (day, seed_revision, DUMMY_ACTOR))[0]
    seed = _unique(seeded or [], '더미 적재')
    plans, cleared, kept = [], 0, []
    for day in marked:
        lots_now = _unique(latest[day][0], f'{day}')
        previous = _unique(before.get(day) or before.get(seed_day) or [], '더미 적재 전')
        lots = []
        for key, lot in lots_now.items():
            new = {k: v for k, v in lot.items() if k != 'dummy_fields'}
            old, dummy = previous.get(key, {}), seed.get(key)
            human = []
            for name in sorted(dummy_names(lot)):
                if name not in new:
                    continue
                if dummy is None or dummy.get(name) != new[name]:
                    human.append(name)  # not the loader's value: keep it, it is no longer dummy
                    continue
                cleared += 1
                if name in old and old[name] in (None, ''):
                    new[name] = old[name]  # restore the blank exactly as it was entered
                elif old:
                    new.pop(name)
                else:
                    new[name] = None
            if human:
                kept.append({'as_of': day, **dict(zip(LOT_KEY, key)), 'fields': human})
            lots.append(new)
        plans.append({'as_of': day, 'lots': lots})
    return plans, cleared, kept


def _unload(path: Path) -> dict:
    # Check the stock inventory and plan the baseline first so either stops the unload before any write.
    _dummy_cargo_in_stock(path)
    plans, baseline_cleared, kept_baseline = _plan_baseline(path)
    baseline_revision = read_baseline(path)['revision']
    registry = snapshot(path)
    edited = _edited_elsewhere(path, registry)
    kept_edited = _kept_edited(registry, edited)
    changes, kept_required, cleared = _clear_changes(registry, edited)
    if any(changes.values()):
        registry = commit(changes, registry['revision'], ACTOR, DUMMY_ORIGIN, path)
    keys, kept_parents = _purge_keys(registry, edited)
    registry = _purge_dummy(path, keys, registry)
    for value in plans:  # oldest day first, so the latest day stays the latest
        baseline_revision = save_baseline(value, baseline_revision, ACTOR, path)['revision']
    return {'db': str(path), 'purged': {e: len(keys[e]) for e in PURGE_ORDER}, 'cleared': cleared,
            'kept_required': kept_required, 'kept_parents': kept_parents, 'kept_edited': kept_edited,
            'baseline_cleared': baseline_cleared,
            'kept_baseline': kept_baseline, 'baseline_days': [p['as_of'] for p in plans],
            'registry_revision': registry['revision'], 'baseline_revision': baseline_revision}


def unload(path: Path, *, backup_root: Path | None = None) -> dict:
    path = _require(path)
    _dummy_cargo_in_stock(path)  # before the backup too: nothing to back up for a run that cannot proceed
    saved = backup(path, backup_root)
    return {**_unload(path), 'backup': str(saved)}


def preview_unload(path: Path) -> dict:
    """What unload would do, run on a temporary copy."""
    return {**_on_copy(path, _unload), 'db': str(Path(path))}
