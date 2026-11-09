"""python -m midterm.dummy_data {check|load|unload} [--db PATH] [--seed N] [--yes]

Prints Korean summary lines, then one JSON line. load/unload write only with --yes."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from midterm.database import DATABASE

from . import loader
from .generate import DEFAULT_SEED


def _counts(c: dict) -> str:
    return f"항차 {c.get('voyages', 0)} · 화물 {c.get('cargo', 0)} · 분석 {c.get('assays', 0)}"


def _load_lines(r: dict, when: str) -> list[str]:
    return [f"새로 만들 행: {_counts(r['create'])}",
            f"실제 행 빈칸 채움: {r['fill_rows']}행 {r['fill_fields']}칸 (이미 입력된 값 {r['kept_real_values']}칸은 그대로)",
            f"기준재고 채울 칸: {r['baseline_fill']}",
            f"{when} 원장 revision {r['registry_revision']} · 기준재고 revision {r['baseline_revision']}"]


def _unload_lines(r: dict, when: str) -> list[str]:
    lines = [f"삭제할 더미 행: {_counts(r['purged'])}",
             f"실제 행에서 비울 더미 칸: {r['cleared']['rows']}행 {r['cleared']['fields']}칸",
             f"기준재고에서 지울 더미 칸: {r['baseline_cleared']} (기준일: {', '.join(r.get('baseline_days') or []) or '없음'})",
             f"{when} 원장 revision {r['registry_revision']} · 기준재고 revision {r['baseline_revision']}"]
    if r['kept_required']:
        lines.append(f"필수 칸이라 남긴 더미 값: {len(r['kept_required'])}행 (사람이 고친 행)")
    if r['kept_parents']:
        lines.append(f"남은 하위 행 때문에 지우지 않은 더미 행: {len(r['kept_parents'])}행")
    if r.get('kept_baseline'):
        lines.append(f"사람이 고친 값이라 남긴 기준재고 적치: {len(r['kept_baseline'])}건")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='python -m midterm.dummy_data', description='더미 석탄·항차 자료 적재/회수')
    parser.add_argument('command', choices=('check', 'load', 'unload'))
    parser.add_argument('--db', type=Path, default=DATABASE, help='대상 DB (기본: MIDTERM_PLANNING_DB)')
    parser.add_argument('--seed', type=int, default=DEFAULT_SEED)
    parser.add_argument('--yes', action='store_true', help='load·unload를 실제로 실행')
    args = parser.parse_args(argv)

    print(f'대상 DB: {args.db}')
    try:
        if args.command == 'check' or args.command == 'load' and not args.yes:
            result = loader.check(args.db, seed=args.seed)
            lines = ['[미리 보기] load가 할 일 (DB는 바꾸지 않음)', *_load_lines(result, '현재')]
        elif args.command == 'unload' and not args.yes:
            result = loader.preview_unload(args.db)
            lines = ['[미리 보기] unload가 할 일 (임시 사본에서 계산, DB는 바꾸지 않음)', *_unload_lines(result, '실행하면')]
        elif args.command == 'load':
            result = loader.load(args.db, seed=args.seed)
            lines = ['load 완료', f"백업: {result['backup']}", *_load_lines(result, '실행 후')]
        else:
            result = loader.unload(args.db)
            lines = ['unload 완료', f"백업: {result['backup']}", *_unload_lines(result, '실행 후')]
    except Exception as exc:  # noqa: BLE001 - report every failure as one line, nonzero exit
        print(f'실패: {exc}')
        print(json.dumps({'error': str(exc), 'db': str(args.db)}, ensure_ascii=False))
        return 1
    print('\n'.join(lines))
    if args.command != 'check' and not args.yes:
        print(f'실행하려면 --yes를 붙이세요: python -m midterm.dummy_data {args.command} --yes')
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
