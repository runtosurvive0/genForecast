"""python -m midterm <명령>

  snapshot     원천 DB 에서 시간별 실적을 data/history_hourly.csv 로 뽑는다
  train        순수요 모델 학습·저장 (models/net-demand.*)
  backtest     순수요 모델 1년 백테스트 (--cutoff 2025-09-30)
  run          연간 실행 → runs/<이름>/ 에 엑셀·JSON (--scenario 파일 또는 옵션)
  serve        입력·실행·결과 화면 (http://127.0.0.1:8090)
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _cmd_run(args) -> None:
    from midterm.annual import run_annual
    from midterm.outages import load_outages
    from midterm.report import format_summary, save_run
    from midterm.scenario import Scenario, default_scenario

    scenario = Scenario.load(Path(args.scenario)) if args.scenario else default_scenario()
    if args.start:
        scenario.start = date.fromisoformat(args.start)
    if args.end:
        scenario.end = date.fromisoformat(args.end)
    if args.nuclear_oh:
        scenario.nuclear_oh = load_outages(Path(args.nuclear_oh))
    if args.coal_oh:
        scenario.coal_oh = load_outages(Path(args.coal_oh))
    if args.weather:
        scenario.weather = args.weather if args.weather == "normal" else int(args.weather)
    if args.quality:
        scenario.quality = args.quality
    if args.workers:
        scenario.workers = args.workers
    if args.name:
        scenario.name = args.name
    last = [0.0]

    def progress(event):
        if event.get("stage") == "solve" and event.get("windows_total"):
            done, total = event.get("windows_done", 0), event["windows_total"]
            now = event.get("elapsed", 0.0)
            if done == total or now - last[0] > 15:
                last[0] = now
                print(f"  MILP {done}/{total} 창 ({now:,.0f}초)", flush=True)
        elif event.get("message"):
            print(f"- {event['message']}", flush=True)

    result = run_annual(scenario, progress)
    folder = ROOT / "runs" / (args.name or datetime.now().strftime("%Y%m%d-%H%M%S"))
    summary = save_run(result, folder)
    print(format_summary(summary))
    print(f"저장: {folder}")


def main(argv: list[str] | None = None) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="midterm")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot")
    snap.add_argument("--dsn", default=None)
    sub.add_parser("train")
    back = sub.add_parser("backtest")
    back.add_argument("--cutoff", default="2025-09-30")
    run = sub.add_parser("run")
    run.add_argument("--scenario")
    run.add_argument("--start")
    run.add_argument("--end")
    run.add_argument("--nuclear-oh")
    run.add_argument("--coal-oh")
    run.add_argument("--weather", help="normal 또는 기준 기상연도(예: 2025)")
    run.add_argument("--quality", choices=["fast", "normal", "precise"])
    run.add_argument("--workers", type=int)
    run.add_argument("--name")
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=8090)
    serve.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)

    if args.command == "snapshot":
        from midterm.history import snapshot
        try:
            print(snapshot(args.dsn))
        except ValueError as error:
            parser.error(str(error))
    elif args.command == "train":
        from midterm.history import load_history
        from midterm.net_demand import save_net_demand_model, train_net_demand_model
        model = train_net_demand_model(load_history())
        stem = save_net_demand_model(model)
        print(f"순수요 모델 저장: {stem} — {model.trained_from} ~ {model.trained_through} "
              f"{model.training_days}일 · 수준계수 {model.level_factor:.4f} · 수요증가율 "
              f"{model.demand_growth*100:+.2f}%/년 · 태양광증가율 {model.solar_growth*100:+.1f}%/년")
    elif args.command == "backtest":
        from midterm.backtest import format_backtest, run_backtest
        from midterm.history import load_history
        print(format_backtest(run_backtest(load_history(), date.fromisoformat(args.cutoff))))
    elif args.command == "run":
        _cmd_run(args)
    elif args.command == "serve":
        import uvicorn
        uvicorn.run("midterm.web.app:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
