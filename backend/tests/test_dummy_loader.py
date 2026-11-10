import json
import re
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from midterm.dummy_data import loader
from midterm.dummy_data.__main__ import main
from midterm.stock_baseline import read_baseline, save_baseline
from midterm.voyage_registry import KST, SCHEMA, RegistryError, commit, snapshot

FIXTURE = Path(__file__).parent / 'fixtures' / 'dummy_registry_snapshot.json'
ENTITIES = ('ships', 'voyages', 'cargo', 'assays')
IGNORED = {'updated_at', 'updated_by', 'data_origin', 'dummy_fields'}


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setenv('GENFORECAST_BACKUP_DIR', str(tmp_path / 'backups'))
    path = tmp_path / 'planning.sqlite3'
    raw = json.loads(FIXTURE.read_text(encoding='utf-8'))
    commit({e: raw['registry'][e] for e in ('ships', 'voyages', 'cargo')}, 0, 'fixture', 'manual', path)
    save_baseline(raw['baseline'], 0, 'fixture', path)
    return path


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(loader, '_now', lambda: datetime(2026, 11, 10, 9, 0, tzinfo=KST))


def _rows(snap):
    return {e: {row[SCHEMA[e]['key']]: {k: v for k, v in row.items() if k not in IGNORED} for row in snap[e]}
            for e in ENTITIES}


def _audit(path, revision):
    with sqlite3.connect(path) as db:
        return db.execute('SELECT actor, origin, after_json FROM voyage_registry_audit WHERE revision=?',
                          (revision,)).fetchall()


def _baseline_revision(path):
    return read_baseline(path)['revision']


def test_check_does_not_write(tmp_db, tmp_path):
    mtime = tmp_db.stat().st_mtime_ns
    size = tmp_db.stat().st_size
    result = loader.check(tmp_db)
    assert tmp_db.stat().st_mtime_ns == mtime and tmp_db.stat().st_size == size
    assert result['future_voyages'] > 30 and result['stale_voyages'] == 0
    assert result['create']['voyages'] == 89 + result['future_voyages']
    assert result['create']['cargo'] == 90 + result['future_voyages']  # + one real voyage without cargo
    assert result['create']['assays'] > 0
    assert result['fill_rows'] > 0 and result['fill_fields'] >= result['fill_rows']
    assert result['kept_real_values'] > 0 and result['baseline_fill'] > 0
    assert result['registry_revision'] == 1 and result['baseline_revision'] == 1
    assert snapshot(tmp_db)['revision'] == 1 and _baseline_revision(tmp_db) == 1
    assert not (tmp_path / 'backups').exists()


def test_missing_db_is_not_created(tmp_path):
    missing = tmp_path / 'nowhere.sqlite3'
    with pytest.raises(FileNotFoundError):
        loader.check(missing)
    with pytest.raises(FileNotFoundError):
        loader.load(missing, backup_root=tmp_path / 'b')
    assert not missing.exists() and not (tmp_path / 'b').exists()


def test_load_fills_blanks_only_and_creates_backup(tmp_db, tmp_path):
    before = snapshot(tmp_db)
    base_before = read_baseline(tmp_db)
    result = loader.load(tmp_db)

    backup = Path(result['backup'])
    assert backup.name == 'planning.sqlite3' and backup.is_file()
    assert backup.parent.parent == tmp_path / 'backups'
    assert re.fullmatch(r'dummy-\d{8}-\d{6}', backup.parent.name)
    assert snapshot(backup)['revision'] == before['revision']  # taken before writing

    after = snapshot(tmp_db)
    assert result['registry_revision'] == after['revision'] == before['revision'] + 1
    old = _rows(before)
    new = _rows(after)
    for entity in ENTITIES:
        for key, row in old[entity].items():
            for field, value in row.items():
                if value is not None and (key, field) != ('V-test-26-3-034', 'status'):  # stocked: arrived -> completed
                    assert new[entity][key][field] == value, (entity, key, field)
    assert new['voyages']['V-test-26-3-034']['status'] == 'completed'
    assert len(new['voyages']) == len(old['voyages']) + 89 + result['future_voyages']
    audit = _audit(tmp_db, after['revision'])
    assert audit and {(a, o) for a, o, _ in audit} == {('dummy-seed', 'dummy-data')}

    base_after = read_baseline(tmp_db)
    assert result['baseline_revision'] == base_after['revision'] == base_before['revision'] + 1
    assert base_after['actor'] == 'dummy-seed' and base_after['as_of'] == base_before['as_of']
    assert all(lot['temperature_c'] is not None and lot['dummy_fields'] for lot in base_after['lots'])
    assert result['create']['voyages'] == 89 + result['future_voyages']


def test_second_load_is_noop(tmp_db):
    loader.load(tmp_db)
    registry, baseline = snapshot(tmp_db)['revision'], _baseline_revision(tmp_db)
    again = loader.load(tmp_db)
    assert snapshot(tmp_db)['revision'] == registry and _baseline_revision(tmp_db) == baseline
    assert again['create'] == {'voyages': 0, 'cargo': 0, 'assays': 0}
    assert again['fill_fields'] == 0 and again['baseline_fill'] == 0


def test_backup_same_second_gets_suffix(tmp_db, tmp_path, monkeypatch):
    fixed = datetime(2026, 11, 10, 9, 30, 15, tzinfo=KST)
    monkeypatch.setattr(loader, '_now', lambda: fixed)
    first = loader.backup(tmp_db, tmp_path / 'bk')
    second = loader.backup(tmp_db, tmp_path / 'bk')
    assert first.parent.name == 'dummy-20261110-093015'
    assert second.parent.name == 'dummy-20261110-093015-2'
    with sqlite3.connect(second) as db:
        assert db.execute('PRAGMA quick_check').fetchone()[0] == 'ok'


def test_unload_restores_original_snapshot(tmp_db):
    before = snapshot(tmp_db)
    base_before = read_baseline(tmp_db)
    future = loader.load(tmp_db)['future_voyages']
    loaded = snapshot(tmp_db)['revision']
    result = loader.unload(tmp_db)

    after = snapshot(tmp_db)
    assert _rows(after) == _rows(before)
    assert all(row['data_origin'] == 'entered' and row['dummy_fields'] is None
               for e in ('voyages', 'cargo', 'assays') for row in after[e])
    assert after['revision'] == result['registry_revision'] == loaded + 2  # clear commit + purge
    assert result['kept_required'] == [] and result['kept_parents'] == []
    assert result['purged']['voyages'] == 89 + future and result['cleared']['rows'] > 0
    audit = _audit(tmp_db, after['revision'])
    assert audit and all(o == 'dummy-data' and j == 'null' for _, o, j in audit)
    base_after = read_baseline(tmp_db)
    assert base_after['lots'] == base_before['lots']
    assert base_after['actor'] == 'dummy-seed'
    assert Path(result['backup']).is_file()

    registry, baseline = after['revision'], base_after['revision']
    again = loader.unload(tmp_db)
    assert snapshot(tmp_db)['revision'] == registry and _baseline_revision(tmp_db) == baseline
    assert again['purged'] == {'assays': 0, 'cargo': 0, 'voyages': 0} and again['cleared']['rows'] == 0


def test_unload_keeps_human_edits(tmp_db):
    loader.load(tmp_db)
    loaded = snapshot(tmp_db)
    real_cargo = next(c for c in loaded['cargo'] if c['data_origin'] == 'mixed'
                      and 'cv' in c['dummy_fields'].split(',') and not c['cargo_no'].startswith('DC-'))
    commit({'cargo': [{'cargo_no': real_cargo['cargo_no'], 'cv': 5555}],
            'voyages': [{'voyage_no': 'DV-26-1-002', 'notes': '사람 메모'}]},
           loaded['revision'], 'tester', 'manual', tmp_db)
    result = loader.unload(tmp_db)

    after = snapshot(tmp_db)
    cargo = {c['cargo_no']: c for c in after['cargo']}
    voyages = {v['voyage_no']: v for v in after['voyages']}
    edited = cargo[real_cargo['cargo_no']]
    assert edited['cv'] == 5555
    assert edited['cv_basis'] == real_cargo['cv_basis']  # needed by the kept cv
    assert edited['moisture_pct'] is None  # other dummy fields cleared
    kept = voyages['DV-26-1-002']
    assert kept['notes'] == '사람 메모' and kept['status'] == 'completed'
    assert kept['berth_id'] is None and kept['actual_arrival'] is None
    assert kept['data_origin'] == 'mixed' and kept['dummy_fields'] == 'status'
    assert 'DV-26-1-003' not in voyages and 'DC-26-1-002' not in cargo
    assert not any(a['assay_id'].startswith('DA-') for a in after['assays'])
    assert {'entity': 'voyages', 'key': 'DV-26-1-002', 'fields': ['status']} in result['kept_required']
    assert {'entity': 'cargo', 'key': real_cargo['cargo_no'], 'fields': ['cv_basis']} in result['kept_required']


def test_unload_keeps_dummy_parent_of_edited_child(tmp_db):
    loader.load(tmp_db)
    loaded = snapshot(tmp_db)
    commit({'cargo': [{'cargo_no': 'DC-26-1-003', 'notes': '확인함'}]}, loaded['revision'], 'tester', 'manual', tmp_db)
    result = loader.unload(tmp_db)

    after = snapshot(tmp_db)
    cargo = {c['cargo_no']: c for c in after['cargo']}
    voyages = {v['voyage_no']: v for v in after['voyages']}
    child = cargo['DC-26-1-003']
    assert child['notes'] == '확인함' and child['voyage_no'] == 'DV-26-1-003'
    assert child['coal_name'] and child['bl_t'] and child['cv'] is None
    assert voyages['DV-26-1-003']['data_origin'] == 'dummy'
    assert {'entity': 'voyages', 'key': 'DV-26-1-003'} in result['kept_parents']
    assert 'DV-26-1-004' not in voyages
    assert not any(a['cargo_no'] == 'DC-26-1-003' for a in after['assays'])


def test_purge_guard_rejects_non_dummy_keys(tmp_db):
    loader.load(tmp_db)
    snap = snapshot(tmp_db)
    with pytest.raises(RegistryError):
        loader._purge_dummy(tmp_db, {'voyages': ['V-test-26-1-038']}, snap)
    with pytest.raises(RegistryError):  # a real row whose dummy fields are mixed is never deleted
        loader._purge_dummy(tmp_db, {'cargo': ['C-test-26-1-038']}, snap)
    assert snapshot(tmp_db)['revision'] == snap['revision']


def _old_code_edit(path, entity, key, field, value, audit=False):
    """Mimic an edit by the app before the dummy markers: values and updated_by change, markers stay."""
    spec = SCHEMA[entity]
    with sqlite3.connect(path) as db:
        db.execute(f"UPDATE voyage_registry_{entity} SET {field}=?, updated_by='old-user' WHERE {spec['key']}=?",
                   (value, key))
        if audit:  # the old app audits without the marker fields
            db.row_factory = sqlite3.Row
            row = dict(db.execute(f"SELECT * FROM voyage_registry_{entity} WHERE {spec['key']}=?", (key,)).fetchone())
            after = {k: v for k, v in row.items()
                     if k not in ('data_origin', 'dummy_fields', 'updated_at', 'updated_by')}
            db.execute('INSERT INTO voyage_registry_audit(revision,entity,record_key,actor,origin,at,before_json,after_json) '
                       'VALUES(?,?,?,?,?,?,?,?)', (99, entity, key, 'old-user', 'manual', '2026-11-10T00:00:00+09:00',
                                                   None, json.dumps(after, ensure_ascii=False)))
    db.close()


def test_unload_keeps_rows_edited_by_old_code(tmp_db):
    loader.load(tmp_db)
    loaded = snapshot(tmp_db)
    real_cargo = next(c for c in loaded['cargo'] if c['data_origin'] == 'mixed'
                      and 'cv' in c['dummy_fields'].split(',') and not c['cargo_no'].startswith('DC-'))
    _old_code_edit(tmp_db, 'voyages', 'DV-26-1-002', 'notes', '이전 앱 메모')
    _old_code_edit(tmp_db, 'cargo', real_cargo['cargo_no'], 'cv', 5555, audit=True)
    result = loader.unload(tmp_db)

    after = snapshot(tmp_db)
    voyages = {v['voyage_no']: v for v in after['voyages']}
    cargo = {c['cargo_no']: c for c in after['cargo']}
    kept_voyage = voyages['DV-26-1-002']  # whole row stays, dummy values included
    assert kept_voyage['notes'] == '이전 앱 메모' and kept_voyage['data_origin'] == 'dummy'
    assert kept_voyage['berth_id'] is not None and kept_voyage['updated_by'] == 'old-user'
    kept_cargo = cargo[real_cargo['cargo_no']]  # no dummy field is blanked: which one the person changed is unknown
    assert kept_cargo['cv'] == 5555 and kept_cargo['data_origin'] == 'mixed'
    assert kept_cargo['dummy_fields'] == real_cargo['dummy_fields']
    assert all(kept_cargo[k] == real_cargo[k] for k in real_cargo['dummy_fields'].split(',') if k != 'cv')
    assert 'DC-26-1-002' not in cargo and 'DV-26-1-003' not in voyages  # untouched dummy rows still go
    edited = {(k['entity'], k['key']) for k in result['kept_edited']}
    assert edited == {('voyages', 'DV-26-1-002'), ('cargo', real_cargo['cargo_no'])}
    assert all(k['fields'] for k in result['kept_edited'])

    with pytest.raises(RegistryError, match='사람'):  # the defence line refuses it too
        loader._purge_dummy(tmp_db, {'voyages': ['DV-26-1-002']}, after)
    again = loader.unload(tmp_db)
    assert snapshot(tmp_db)['revision'] == after['revision']
    assert {(k['entity'], k['key']) for k in again['kept_edited']} == edited


def test_unload_trusts_its_own_cleared_rows(tmp_db):
    loader.load(tmp_db)
    loaded = snapshot(tmp_db)
    commit({'voyages': [{'voyage_no': 'DV-26-1-002', 'notes': '사람 메모'}]}, loaded['revision'], 'tester', 'manual', tmp_db)
    first = loader.unload(tmp_db)
    assert first['kept_edited'] == []
    kept = {v['voyage_no']: v for v in snapshot(tmp_db)['voyages']}['DV-26-1-002']
    assert kept['updated_by'] == 'dummy-seed' and kept['data_origin'] == 'mixed'  # left by unload itself
    again = loader.unload(tmp_db)
    assert again['kept_edited'] == []
    assert {'entity': 'voyages', 'key': 'DV-26-1-002', 'fields': ['status']} in again['kept_required']


def test_unload_stops_before_writing_when_dummy_cargo_is_in_stock(tmp_db):
    from midterm.stock_inventory import inventory_snapshot
    loader.load(tmp_db)
    inventory_snapshot(tmp_db)  # creates the inventory tables
    with sqlite3.connect(tmp_db) as db:
        db.execute("INSERT INTO stock_inventory_lots(cargo_no,location,initial_t,remaining_t,updated_at) "
                   "VALUES('DC-26-1-002','P1',100,100,'2026-11-10T00:00:00+00:00')")
    db.close()
    registry, baseline = snapshot(tmp_db)['revision'], _baseline_revision(tmp_db)
    with pytest.raises(ValueError, match='DC-26-1-002'):
        loader.unload(tmp_db)
    with pytest.raises(ValueError, match='재고'):
        loader.preview_unload(tmp_db)
    assert snapshot(tmp_db)['revision'] == registry and _baseline_revision(tmp_db) == baseline
    assert any(c['cargo_no'] == 'DC-26-1-002' for c in snapshot(tmp_db)['cargo'])


def _json_line(out):
    return json.loads(out.strip().splitlines()[-1])


def test_cli_requires_yes(tmp_db, capsys):
    assert main(['load', '--db', str(tmp_db)]) == 0
    out = capsys.readouterr().out
    assert '--yes' in out and str(tmp_db) in out
    assert _json_line(out)['create']['voyages'] == 89 + _json_line(out)['future_voyages']
    assert snapshot(tmp_db)['revision'] == 1 and _baseline_revision(tmp_db) == 1

    assert main(['load', '--db', str(tmp_db), '--yes']) == 0
    loaded = _json_line(capsys.readouterr().out)
    assert loaded['registry_revision'] == 2 and Path(loaded['backup']).is_file()

    assert main(['unload', '--db', str(tmp_db)]) == 0
    out = capsys.readouterr().out
    assert '--yes' in out and _json_line(out)['purged']['voyages'] == 89 + loaded['future_voyages']
    assert snapshot(tmp_db)['revision'] == 2

    assert main(['check', '--db', str(tmp_db)]) == 0
    assert _json_line(capsys.readouterr().out)['create'] == {'voyages': 0, 'cargo': 0, 'assays': 0}


def _put_baseline(path, lots, actor):
    """Store a baseline revision directly, bypassing save_baseline's dummy-mark rules."""
    with sqlite3.connect(path) as db:
        revision = db.execute('SELECT revision FROM yard_baseline_meta WHERE id=1').fetchone()[0] + 1
        as_of = db.execute('SELECT as_of FROM yard_baselines ORDER BY revision DESC LIMIT 1').fetchone()[0]
        db.execute('INSERT INTO yard_baselines(revision,as_of,actor,recorded_at,payload) VALUES(?,?,?,?,?)',
                   (revision, as_of, actor, '2026-11-10T00:00:00+00:00', json.dumps(lots, ensure_ascii=False)))
        db.execute('UPDATE yard_baseline_meta SET revision=? WHERE id=1', (revision,))
    db.close()


def test_unload_keeps_human_baseline_edit_even_if_still_marked(tmp_db):
    original = read_baseline(tmp_db)['lots']
    loader.load(tmp_db)
    lots = read_baseline(tmp_db)['lots']
    assert 'temperature_c' in lots[0]['dummy_fields']
    lots[0]['temperature_c'] = 59.5  # human value, dummy mark left in place on purpose
    _put_baseline(tmp_db, lots, 'tester')
    result = loader.unload(tmp_db)
    got = read_baseline(tmp_db)['lots']
    assert got[0]['temperature_c'] == 59.5
    assert got[0].get('age_days') == original[0].get('age_days')
    assert 'dummy_fields' not in got[0]
    assert got[1:] == original[1:]
    assert result['kept_baseline'] == [{'as_of': '2026-11-08',
                                        'source_id': original[0]['source_id'], 'location': original[0]['location'],
                                        'coal_name': original[0]['coal_name'],
                                        'voyage_number': original[0]['voyage_number'], 'fields': ['temperature_c']}]


def test_unload_keeps_human_baseline_edit_saved_normally(tmp_db):
    original = read_baseline(tmp_db)['lots']
    loader.load(tmp_db)
    current = read_baseline(tmp_db)
    lots = current['lots']
    lots[1]['temperature_c'] = 33.3
    save_baseline({'as_of': current['as_of'], 'lots': lots}, current['revision'], 'operator', tmp_db)
    result = loader.unload(tmp_db)
    got = read_baseline(tmp_db)['lots']
    assert got[1]['temperature_c'] == 33.3 and 'dummy_fields' not in got[1]
    assert got[0] == original[0]
    assert result['kept_baseline'] == []


def test_unload_stops_on_duplicate_lot_keys(tmp_db):
    loader.load(tmp_db)
    lots = read_baseline(tmp_db)['lots']
    _put_baseline(tmp_db, [*lots, dict(lots[0])], 'tester')
    registry, baseline = snapshot(tmp_db)['revision'], _baseline_revision(tmp_db)
    with pytest.raises(ValueError, match='겹'):
        loader.unload(tmp_db)
    assert snapshot(tmp_db)['revision'] == registry and _baseline_revision(tmp_db) == baseline


@pytest.mark.parametrize('broken', ['raise', 'garbage'])
def test_backup_failure_writes_nothing(tmp_db, monkeypatch, broken):
    loader.load(tmp_db)
    registry, baseline = snapshot(tmp_db)['revision'], _baseline_revision(tmp_db)

    def bad_copy(src, dst):
        if broken == 'raise':
            raise OSError('디스크 가득 참')
        Path(dst).write_bytes(b'not a database file at all' * 10)
    monkeypatch.setattr(loader, '_copy', bad_copy)
    with pytest.raises(Exception):
        loader.unload(tmp_db)
    with pytest.raises(Exception):
        loader.load(tmp_db, seed=7)
    assert snapshot(tmp_db)['revision'] == registry and _baseline_revision(tmp_db) == baseline


def test_unload_rerun_after_purge_conflict_restores(tmp_db, monkeypatch):
    before = snapshot(tmp_db)
    base_before = read_baseline(tmp_db)['lots']
    loader.load(tmp_db)

    def conflict(*args, **kwargs):
        raise RegistryError('다른 변경이 먼저 저장되었습니다.', 409)
    monkeypatch.setattr(loader, 'purge', conflict)
    with pytest.raises(RegistryError):
        loader.unload(tmp_db)
    assert any(v['voyage_no'].startswith('DV-') for v in snapshot(tmp_db)['voyages'])
    monkeypatch.undo()
    loader.unload(tmp_db)
    assert _rows(snapshot(tmp_db)) == _rows(before)
    assert read_baseline(tmp_db)['lots'] == base_before


def test_unload_clears_dummy_values_carried_to_a_later_day(tmp_db):
    original = read_baseline(tmp_db)
    loader.load(tmp_db)
    loaded = read_baseline(tmp_db)
    next_day = (date.fromisoformat(loaded['as_of']) + timedelta(days=1)).isoformat()
    lots = [dict(lot) for lot in loaded['lots']]
    lots[0]['temperature_c'] = 58.0  # one human measurement on the new day
    save_baseline({'as_of': next_day, 'lots': lots}, loaded['revision'], 'operator', tmp_db)
    carried = read_baseline(tmp_db)['lots']
    assert sum(bool(lot.get('dummy_fields')) for lot in carried) == len(carried)

    result = loader.unload(tmp_db)
    assert result['kept_baseline'] == []  # the human value lost its mark when it was saved
    assert result['baseline_cleared'] > 0
    latest = read_baseline(tmp_db)
    assert latest['as_of'] == next_day
    expected = [dict(lot) for lot in original['lots']]
    expected[0]['temperature_c'] = 58.0
    assert latest['lots'] == expected
    assert read_baseline(tmp_db, original['as_of'])['lots'] == original['lots']  # the loaded day is cleaned too
    assert not any(lot.get('dummy_fields') for lot in read_baseline(tmp_db, original['as_of'])['lots'])

    again = loader.unload(tmp_db)
    assert again['baseline_cleared'] == 0 and again['baseline_revision'] == result['baseline_revision']


def test_reload_later_purges_planned_voyages_left_outside_the_new_window(tmp_db, monkeypatch):
    first = loader.load(tmp_db)
    old = {v['voyage_no'] for v in snapshot(tmp_db)['voyages'] if v['status'] in ('planned', 'underway')}
    assert len(old) == first['future_voyages']
    monkeypatch.setattr(loader, '_now', lambda: datetime(2026, 12, 20, 9, 0, tzinfo=KST))
    preview = loader.check(tmp_db)
    second = loader.load(tmp_db)
    assert second['stale_voyages'] == preview['stale_voyages'] > 0
    rows = snapshot(tmp_db)
    future = [v for v in rows['voyages'] if v['status'] in ('planned', 'underway')]
    assert len(future) == second['future_voyages']
    start = datetime(2026, 12, 20, tzinfo=KST)
    assert all(datetime.fromisoformat(v['planned_unload_end']) > start for v in future)
    voyages = {v['voyage_no'] for v in rows['voyages']}
    assert all(c['voyage_no'] in voyages for c in rows['cargo'])
    # 다 지우면 처음과 같아진다.
    loader.unload(tmp_db)
    assert not [v for v in snapshot(tmp_db)['voyages'] if v['data_origin'] == 'dummy']
