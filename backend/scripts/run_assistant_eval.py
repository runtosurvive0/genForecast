"""1단계 평가셋 수동 실행기. 실제 LLM을 호출하므로 CI에서 돌리지 않는다(비용).

사용: python scripts/run_assistant_eval.py --db <격리 DB 경로>
운영 DB(backend/data/ 아래)는 거절한다(종료 코드 2). 도구는 읽기 전용이다.
통과 기준: 도구 선택 일치율 90% 이상, 숫자 위반 0, gap 위반 0 -> 종료 코드 0, 아니면 1.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
QUESTIONS = BACKEND / "tests" / "assistant_eval" / "questions.jsonl"
OPERATIONAL_DIR = (BACKEND / "data").resolve()
MIN_TOOL_RATE = 0.9


def load_questions(path: Path = QUESTIONS) -> list[dict]:
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def score(question: dict, result: dict) -> dict:
    ok_names = {c["name"] for c in result.get("tool_calls", []) if c.get("ok")}
    tool_match = all(t in ok_names for t in question["expect_tools"])
    facts = result.get("facts", [])
    violations = 0
    for spec in question.get("numeric", []):
        matched = [f for f in facts if spec["label_contains"] in str(f.get("label", ""))]
        if not matched:
            violations += 1
            continue
        for f in matched:
            value = f.get("value")
            if not isinstance(value, (int, float)) or isinstance(value, bool) \
                    or not spec["min"] <= value <= spec["max"]:
                violations += 1
    if question["expect_gap"]:
        gap_violation = not result.get("gaps")
    else:
        gap_violation = bool(result.get("partial"))
    return {"id": question["id"], "tool_match": tool_match,
            "numeric_violations": violations, "gap_violation": gap_violation}


def _check_db(raw: str) -> Path | None:
    path = Path(raw).resolve()
    if path == OPERATIONAL_DIR or OPERATIONAL_DIR in path.parents:
        print(f"운영 DB 경로는 사용할 수 없습니다: {path}", file=sys.stderr)
        return None
    if not path.is_file():
        print(f"DB 파일이 없습니다: {path}", file=sys.stderr)
        return None
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="운영 도우미 1단계 평가 수동 실행기")
    parser.add_argument("--db", required=True, help="격리된 테스트 DB 경로")
    args = parser.parse_args(argv)
    db = _check_db(args.db)
    if db is None:
        return 2

    sys.path.insert(0, str(BACKEND / "src"))
    from midterm.assistant.llm import default_llm
    from midterm.demo_assistant import AssistantUnavailable

    try:
        llm = default_llm()
    except AssistantUnavailable as exc:
        print(exc)
        return 1

    os.environ["MIDTERM_PLANNING_DB"] = str(db)
    from midterm import database
    from midterm.assistant.agent import ask
    from midterm.assistant.tools import ToolContext
    from midterm.supply import now
    database.DATABASE = db

    rows = []
    for q in load_questions():
        ctx = ToolContext(request=None, now=now(), db_path=db)
        try:
            result = ask(q["question"], [], ctx, llm)
        except Exception as exc:
            print(f"{q['id']}: 실행 실패 {exc}", file=sys.stderr)
            result = {"facts": [], "gaps": [], "partial": True, "tool_calls": []}
        rows.append(score(q, result))

    print(f"{'id':<20}{'도구':>6}{'숫자위반':>10}{'gap위반':>9}")
    for r in rows:
        print(f"{r['id']:<20}{'O' if r['tool_match'] else 'X':>6}{r['numeric_violations']:>10}"
              f"{'X' if r['gap_violation'] else 'O':>9}")
    rate = sum(r["tool_match"] for r in rows) / len(rows)
    numeric = sum(r["numeric_violations"] for r in rows)
    gaps = sum(r["gap_violation"] for r in rows)
    print(f"도구 선택 일치율: {rate:.0%} / 숫자 범위 위반: {numeric} / expect_gap 위반: {gaps}")
    return 0 if rate >= MIN_TOOL_RATE and numeric == 0 and gaps == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
