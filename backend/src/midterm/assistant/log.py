"""LLM 운영 도우미 질의 기록. 사용자 id만 남기고 90일이 지난 행은 지운다."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

RETENTION_DAYS = 90
KST = ZoneInfo("Asia/Seoul")


def _connect(db_path: Path) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS assistant_log(id INTEGER PRIMARY KEY, user_id TEXT, at TEXT, "
               "question TEXT, tool_calls_json TEXT, answer_json TEXT)")
    return db


def record(db_path: Path, user_id: str, question: str, tool_calls: list, answer: dict, at: datetime) -> None:
    if at.tzinfo is None:
        raise ValueError("기록 시각에는 시간대가 필요합니다")
    at = at.astimezone(KST)
    cutoff = (at - timedelta(days=RETENTION_DAYS)).isoformat()
    db = _connect(db_path)
    try:
        with db:
            db.execute("DELETE FROM assistant_log WHERE at < ?", (cutoff,))
            db.execute("INSERT INTO assistant_log(user_id, at, question, tool_calls_json, answer_json) VALUES(?,?,?,?,?)",
                       (user_id, at.isoformat(), question,
                        json.dumps(tool_calls, ensure_ascii=False), json.dumps(answer, ensure_ascii=False)))
    finally:
        db.close()


def read(db_path: Path) -> list[dict]:
    db = _connect(db_path)
    try:
        return [dict(r) for r in db.execute("SELECT * FROM assistant_log ORDER BY id")]
    finally:
        db.close()
