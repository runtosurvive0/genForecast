"""명시적으로 실행하는 가상 MILP·연료수급 초기자료 등록. 기존 원장은 덮어쓰지 않는다."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone

from midterm.database import DATABASE, connect
from midterm.milp_store import init_store
from midterm.scenario import ROOT
from midterm.supply import init_supply

SEED = ROOT / "seeds" / "fuel-integration-2027.sqlite3"
MARKER = "seed:fuel-integration-2027"
TABLES = ("milp_inputs", "milp_runs", "supply_baselines", "supply_stock_lots",
          "supply_vessels", "supply_unload_points")


def _insert(db, table, row):
    values = {k: v for k, v in row.items() if k != "id"}
    columns = ",".join(values)
    placeholders = ",".join("?" for _ in values)
    return db.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                      tuple(values.values())).lastrowid


def seed_demo(path: Path = DATABASE) -> dict:
    path = Path(path).resolve()
    if path in (SEED.resolve(), (ROOT / "data" / "planning.sqlite3").resolve()):
        raise ValueError("공유 스냅샷 대신 작업 DB 경로를 지정하세요")
    manifest = json.loads((ROOT / "shared-assets.json").read_text(encoding="utf-8"))
    asset = next(item for item in manifest["files"] if item["path"] == SEED.relative_to(ROOT).as_posix())
    content = SEED.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if len(content) != asset["bytes"] or digest != asset["sha256"]:
        raise ValueError("가상 초기 DB 체크섬이 다릅니다. 저장소 원본을 확인하세요")
    with sqlite3.connect(SEED.resolve().as_uri() + "?mode=ro", uri=True) as source:
        source.row_factory = sqlite3.Row
        rows = {table: [dict(r) for r in source.execute(f"SELECT * FROM {table}")]
                for table in TABLES}
    run_id = rows["milp_runs"][0]["run_id"]
    result = {"database": str(path), "run_id": run_id, "classification": "simulation"}
    try:
        with connect(path) as db:
            init_store(db)
            init_supply(db)
            db.execute("BEGIN IMMEDIATE")
            marker = db.execute("SELECT value FROM settings WHERE key=?", (MARKER,)).fetchone()
            if marker:
                if json.loads(marker[0]) != digest:
                    raise ValueError("다른 버전의 초기자료가 등록되어 있습니다. 별도 작업 DB를 사용하세요")
                return {**result, "status": "already_seeded"}
            inputs, baselines, vessels = {}, {}, {}
            for row in rows["milp_inputs"]:
                existing = db.execute("SELECT id FROM milp_inputs WHERE digest=?", (row["digest"],)).fetchone()
                inputs[row["id"]] = existing[0] if existing else _insert(db, "milp_inputs", row)
            for row in rows["milp_runs"]:
                summary = json.loads(row["summary"])
                summary["input_id"] = inputs[row["input_id"]]
                _insert(db, "milp_runs", {**row, "input_id": inputs[row["input_id"]],
                                          "summary": json.dumps(summary, ensure_ascii=False)})
            for row in rows["supply_baselines"]:
                baselines[row["id"]] = _insert(db, "supply_baselines", row)
            for row in rows["supply_stock_lots"]:
                _insert(db, "supply_stock_lots", {**row, "baseline_id": baselines[row["baseline_id"]]})
            for row in rows["supply_vessels"]:
                vessels[row["id"]] = _insert(db, "supply_vessels", row)
            for row in rows["supply_unload_points"]:
                _insert(db, "supply_unload_points", {**row, "vessel_id": vessels[row["vessel_id"]]})
            db.execute("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)",
                       (MARKER, json.dumps(digest), datetime.now(timezone.utc).isoformat()))
    except sqlite3.IntegrityError as error:
        raise ValueError("같은 계산 ID 또는 기준재고 시각이 이미 있습니다. 기존 데이터를 보존하고 등록을 취소했습니다") from error
    return {**result, "status": "seeded", "counts": {table: len(value) for table, value in rows.items()}}
