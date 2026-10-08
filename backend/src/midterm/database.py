"""웹 계획 입력과 연료 기준을 보관하는 프로젝트 내부 SQLite DB."""

from __future__ import annotations

import json
import math
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from midterm.scenario import ROOT, Scenario, default_scenario

DATABASE = ROOT / "data" / "planning.sqlite3"


@contextmanager
def connect(path: Path = DATABASE):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS planned_outages (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('coal','nuclear')),
                unit TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, note TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fuel_actual_daily (
                day TEXT NOT NULL, unit TEXT NOT NULL, tonnes REAL NOT NULL CHECK(tonnes >= 0),
                source TEXT NOT NULL DEFAULT '', PRIMARY KEY(day, unit)
            );
        """)
        with db:
            yield db
    finally:
        db.close()


def _put(db, key: str, value) -> None:
    db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?, ?)",
               (key, json.dumps(value, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))


def _save_scenario(db, scenario: Scenario) -> None:
    payload = scenario.to_json()
    db.execute("DELETE FROM planned_outages")
    for kind in ("coal", "nuclear"):
        for row in payload.pop(kind + "_oh"):
            db.execute("INSERT INTO planned_outages(kind,unit,start,end,note) VALUES(?,?,?,?,?)",
                       (kind, row["unit"], row["start"], row["end"], row.get("note", "")))
    _put(db, "scenario", payload)


def load_settings(path: Path = DATABASE) -> dict:
    with connect(path) as db:
        if not db.execute("SELECT 1 FROM settings WHERE key='scenario'").fetchone():
            legacy = ROOT / "inputs" / "last_scenario.json"
            _save_scenario(db, Scenario.load(legacy) if legacy.exists() else default_scenario())
            _put(db, "fuel", {"calorific_kcal_kg": 5500, "is_assumption": True,
                              "source": "사용자 지정 임시 가정"})
        settings = {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT * FROM settings")}
        scenario = settings["scenario"]
        for kind in ("coal", "nuclear"):
            scenario[kind + "_oh"] = [dict(r) for r in db.execute(
                "SELECT unit,start,end,note FROM planned_outages WHERE kind=? ORDER BY unit,start", (kind,))]
        return {"scenario": scenario, "fuel": settings["fuel"],
                "updated_at": db.execute("SELECT max(updated_at) FROM settings").fetchone()[0],
                "database": str(path)}


def _clean_fuel(fuel: dict) -> dict:
    value = fuel.get("calorific_kcal_kg")
    if value is not None:
        value = float(value)
        if not math.isfinite(value) or not 1000 <= value <= 10000:
            raise ValueError("기준 발열량은 1,000~10,000 kcal/kg 범위로 입력하세요")
    return {"calorific_kcal_kg": value, "is_assumption": bool(fuel.get("is_assumption")),
            "source": str(fuel.get("source", "사용자 입력"))[:200]}


def save_settings(scenario: Scenario, fuel: dict, path: Path = DATABASE) -> dict:
    clean = _clean_fuel(fuel)
    with connect(path) as db:
        _save_scenario(db, scenario)
        _put(db, "fuel", clean)
    return load_settings(path)


def save_fuel_settings(fuel: dict, path: Path = DATABASE) -> dict:
    current = load_settings(path)
    clean = _clean_fuel({**current["fuel"], **fuel})
    with connect(path) as db:
        _put(db, "fuel", clean)
    return load_settings(path)
