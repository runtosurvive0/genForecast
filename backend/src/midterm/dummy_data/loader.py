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
from midterm.stock_baseline import read_baseline, save_baseline
from midterm.voyage_registry import (DUMMY_ORIGIN, KST, PURGE_ORDER, SCHEMA, RegistryError, commit, dummy_keys,
                                     purge, snapshot)

from .generate import DEFAULT_SEED, ENTITIES, generate

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


def _clear_changes(registry: dict) -> tuple[dict, list, dict]:
    """Blank the dummy fields of mixed rows; keep required fields and bases still in use."""
    changes, kept, cleared = {e: [] for e in ENTITIES}, [], {'rows': 0, 'fields': 0}
    for entity in ENTITIES:
        key_field = SCHEMA[entity]['key']
        required = KEEP[entity] | {f['key'] for f in SCHEMA[entity]['fields'] if f['required']}
        for row in registry[entity]:
            if row.get('data_origin') != 'mixed':
                continue
            dummies = dummy_keys(row, entity)
            keep = dummies & required
            for basis, users in BASIS.items():
                if basis in dummies and any(row.get(u) is not None and u not in dummies for u in users):
                    keep.add(basis)
            blank = dummies - keep
            change = {key_field: row[key_field], **{k: None for k in blank},
                      'data_origin': 'mixed' if keep else 'entered',
                      'dummy_fields': ','.join(sorted(keep)) or None}
            if keep:
                kept.append({'entity': entity, 'key': row[key_field], 'fields': sorted(keep)})
            if blank or row.get('dummy_fields') != change['dummy_fields']:
                changes[entity].append(change)
                cleared['rows'] += bool(blank)
                cleared['fields'] += len(blank)
    return changes, kept, cleared


def _purge_keys(registry: dict) -> tuple[dict, list]:
    """Whole-dummy rows to delete, children first; a parent with a remaining child stays."""
    keys, kept = {}, []
    remaining_parents: dict[str, set] = {'cargo': set(), 'voyages': set()}
    for entity in PURGE_ORDER:
        key_field = SCHEMA[entity]['key']
        keys[entity] = []
        for row in registry[entity]:
            key = row[key_field]
            if row.get('data_origin') == 'dummy' and key not in remaining_parents.get(entity, set()):
                keys[entity].append(key)
                continue
            if row.get('data_origin') == 'dummy':
                kept.append({'entity': entity, 'key': key})
            if entity in PARENT:
                parent, ref = PARENT[entity]
                remaining_parents[parent].add(row[ref])
    return keys, kept


def _purge_dummy(path: Path, keys: dict, registry: dict) -> dict:
    """Defence line: every key must still be a whole-dummy row of this registry revision."""
    rows = {e: {row[SCHEMA[e]['key']]: row for row in registry[e]} for e in PURGE_ORDER}
    for entity, entity_keys in keys.items():
        for key in entity_keys:
            row = rows.get(entity, {}).get(key)
            if row is None or row.get('data_origin') != 'dummy':
                raise RegistryError(f"{SCHEMA[entity]['label']} {key}: 더미 행이 아니어서 삭제하지 않습니다.")
    return purge(keys, registry['revision'], ACTOR, DUMMY_ORIGIN, path)


def _previous_lots(path: Path, as_of: str, revision: int) -> list[dict]:
    """Lots of the latest same-day baseline saved before the given revision by someone other than the loader."""
    with connect(path) as db:
        row = db.execute("SELECT payload FROM yard_baselines WHERE as_of=? AND revision<? AND actor<>? "
                         "ORDER BY revision DESC LIMIT 1", (as_of, revision, ACTOR)).fetchone()
    return json.loads(row['payload']) if row else []


def _lot_id(lot: dict) -> tuple:
    return tuple(lot.get(k) for k in ('source_id', 'location', 'coal_name', 'voyage_number'))


def _clear_baseline(path: Path) -> tuple[dict | None, int, int]:
    current = read_baseline(path)
    if not current['lots'] or not any(lot.get('dummy_fields') for lot in current['lots']):
        return None, 0, current['revision']
    with connect(path) as db:
        latest = db.execute('SELECT revision FROM yard_baselines WHERE as_of=? ORDER BY revision DESC LIMIT 1',
                            (current['as_of'],)).fetchone()['revision']
    previous = {_lot_id(lot): lot for lot in _previous_lots(path, current['as_of'], latest)}
    lots, cleared = [], 0
    for lot in current['lots']:
        names = {k.strip() for k in str(lot.get('dummy_fields') or '').split(',') if k.strip()}
        new = {k: v for k, v in lot.items() if k != 'dummy_fields'}
        old = previous.get(_lot_id(lot), {})
        for name in names:
            if name not in new:
                continue
            cleared += 1
            if name in old and old[name] in (None, ''):
                new[name] = old[name]  # restore the blank exactly as it was entered
            elif old:
                new.pop(name)
            else:
                new[name] = None
        lots.append(new)
    return {'as_of': current['as_of'], 'lots': lots}, cleared, current['revision']


def _unload(path: Path) -> dict:
    registry = snapshot(path)
    changes, kept_required, cleared = _clear_changes(registry)
    if any(changes.values()):
        registry = commit(changes, registry['revision'], ACTOR, DUMMY_ORIGIN, path)
    keys, kept_parents = _purge_keys(registry)
    registry = _purge_dummy(path, keys, registry)
    value, baseline_cleared, baseline_revision = _clear_baseline(path)
    if value is not None:
        baseline_revision = save_baseline(value, baseline_revision, ACTOR, path)['revision']
    return {'db': str(path), 'purged': {e: len(keys[e]) for e in PURGE_ORDER}, 'cleared': cleared,
            'kept_required': kept_required, 'kept_parents': kept_parents, 'baseline_cleared': baseline_cleared,
            'registry_revision': registry['revision'], 'baseline_revision': baseline_revision}


def unload(path: Path, *, backup_root: Path | None = None) -> dict:
    path = _require(path)
    saved = backup(path, backup_root)
    return {**_unload(path), 'backup': str(saved)}


def preview_unload(path: Path) -> dict:
    """What unload would do, run on a temporary copy."""
    return {**_on_copy(path, _unload), 'db': str(Path(path))}
