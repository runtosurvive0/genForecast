import importlib.util
import json
import os
from pathlib import Path

import pytest

from midterm.assistant.tools import TOOLS

BACKEND = Path(__file__).resolve().parents[1]
QUESTIONS = BACKEND / "tests" / "assistant_eval" / "questions.jsonl"
RUNNER = BACKEND / "scripts" / "run_assistant_eval.py"


def _runner():
    spec = importlib.util.spec_from_file_location("run_assistant_eval", RUNNER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _rows():
    return [json.loads(line) for line in QUESTIONS.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_question_set_format():
    rows = _rows()
    assert len(rows) == 12
    assert len({r["id"] for r in rows}) == 12
    for r in rows:
        assert set(r) == {"id", "question", "expect_tools", "expect_gap", "numeric"}
        assert isinstance(r["id"], str) and isinstance(r["question"], str) and r["question"]
        assert isinstance(r["expect_gap"], bool)
        assert all(t in TOOLS for t in r["expect_tools"])
        for n in r["numeric"]:
            assert set(n) == {"label_contains", "min", "max"}
            assert n["min"] <= n["max"]


def test_load_questions_matches_file():
    assert _runner().load_questions(QUESTIONS) == _rows()


def _result(tools=(), facts=(), gaps=(), partial=False):
    return {"facts": list(facts), "gaps": list(gaps), "partial": partial,
            "tool_calls": [{"id": str(i), "name": n, "arguments": {}, "ok": ok} for i, (n, ok) in enumerate(tools)]}


def test_score_tool_match_requires_successful_calls():
    q = {"id": "a", "question": "q", "expect_tools": ["stock_snapshot"], "expect_gap": False, "numeric": []}
    mod = _runner()
    assert mod.score(q, _result(tools=[("stock_snapshot", True)]))["tool_match"] is True
    assert mod.score(q, _result(tools=[("stock_snapshot", False)]))["tool_match"] is False
    assert mod.score(q, _result())["tool_match"] is False


def test_score_numeric_violations():
    q = {"id": "a", "question": "q", "expect_tools": [], "expect_gap": False,
         "numeric": [{"label_contains": "재고", "min": 0, "max": 100}]}
    mod = _runner()
    assert mod.score(q, _result(facts=[{"label": "재고", "value": 5}]))["numeric_violations"] == 0
    assert mod.score(q, _result(facts=[{"label": "재고", "value": -1}]))["numeric_violations"] == 1
    assert mod.score(q, _result(facts=[{"label": "기타", "value": 5}]))["numeric_violations"] == 1


def test_score_gap_violations():
    mod = _runner()
    base = {"id": "a", "question": "q", "expect_tools": [], "numeric": []}
    assert mod.score({**base, "expect_gap": True}, _result())["gap_violation"] is True
    assert mod.score({**base, "expect_gap": True}, _result(gaps=["x"]))["gap_violation"] is False
    assert mod.score({**base, "expect_gap": False}, _result(partial=True))["gap_violation"] is True
    assert mod.score({**base, "expect_gap": False}, _result())["gap_violation"] is False


@pytest.fixture
def ops_dir(tmp_path, monkeypatch):
    mod = _runner()
    d = tmp_path / "data"
    d.mkdir()
    (d / "planning.sqlite3").write_bytes(b"")
    monkeypatch.setattr(mod, "OPERATIONAL_DIR", d.resolve())
    return mod, d


def test_main_refuses_operational_db(ops_dir, capsys):
    mod, d = ops_dir
    assert mod.main(["--db", str(d / "planning.sqlite3")]) == 2
    err = capsys.readouterr().err
    assert "운영 DB" in err and "파일이 없습니다" not in err


def test_main_refuses_operational_db_via_dotdot(ops_dir, capsys):
    mod, d = ops_dir
    assert mod.main(["--db", str(d / "sub" / ".." / "planning.sqlite3")]) == 2
    assert "운영 DB" in capsys.readouterr().err


@pytest.mark.skipif(os.name != "nt", reason="대소문자 무시는 Windows에서만 의미가 있다")
def test_main_refuses_operational_db_with_swapped_case(ops_dir, capsys):
    mod, d = ops_dir
    assert mod.main(["--db", str(d).upper() + "\PLANNING.SQLITE3"]) == 2
    assert "운영 DB" in capsys.readouterr().err


def test_main_refuses_missing_db(tmp_path, capsys):
    assert _runner().main(["--db", str(tmp_path / "none.sqlite3")]) == 2
    err = capsys.readouterr().err
    assert "파일이 없습니다" in err and "운영 DB" not in err


def test_main_unavailable_llm_exits_1(tmp_path, monkeypatch):
    db = tmp_path / "t.sqlite3"
    db.write_bytes(b"")
    monkeypatch.delenv("GENFORECAST_ASSISTANT_LLM", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert _runner().main(["--db", str(db)]) == 1
