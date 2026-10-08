"""MILP 배분 백테스트: 실제 전국 석탄량을 목표로 넣으면 당진 몫이 실적과 맞는가.

예측 오차(순수요·석탄곡선)를 빼고 **배분 모델**(호기 마스터·비용·운전제약·발전소 규칙)만 본다.

* 목표: 2026년 실제 시간별 전국 석탄 (data/history_hourly.csv)
* 원전·순수요: 실적 (결과표 참고용, MILP 에는 안 들어감)
* 당진 정비: 호기 실적이 7일 이상 연속 0 인 구간 (data/dangjin_actual_hourly.csv)
* 타 발전소 정비: 로컬 inputs/ranking_oh.json의 월별 정비 가정 → 그 달 전체로 근사
  사내 과거 정비 자료는 코드에 넣지 않는다. 정확한 시작·종료일이 아니라서 가용성은 근사다.

실행: .venv/Scripts/python.exe scripts/backtest_allocation.py [--start 2026-01-01 --end 2026-07-31]
"""

import argparse
import json
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from midterm.annual import WARMUP_DAYS, solve_prepared  # noqa: E402
from midterm.coal_curve import load_coal_curve_model  # noqa: E402
from midterm.fleet import (coal_inputs, hours_of, load_coal_units, load_heat_prices)  # noqa: E402
from midterm.history import complete_days, load_dangjin_actual, load_history  # noqa: E402
from midterm.net_demand import DayForecast, load_net_demand_model  # noqa: E402
from midterm.outages import Outage  # noqa: E402
from midterm.scenario import Scenario  # noqa: E402

RANKING_OH_PATH = Path(__file__).resolve().parents[1] / "inputs" / "ranking_oh.json"
MIN_OH_HOURS = 24 * 7


def dangjin_outages(actual, first: date, last: date) -> list[Outage]:
    hours = [datetime.combine(first, datetime.min.time()) + timedelta(hours=k)
             for k in range(((last - first).days + 1) * 24)]
    units = sorted({u for v in actual.values() for u in v})
    out = []
    for unit in units:
        run = None
        for at in hours + [None]:
            zero = at is not None and actual.get(at, {}).get(unit, 0.0) <= 1.0
            if zero and run is None:
                run = at
            elif not zero and run is not None:
                end = at or hours[-1] + timedelta(hours=1)
                if (end - run).total_seconds() / 3600 >= MIN_OH_HOURS:
                    out.append(Outage(unit, run, end, "실적 0출력 7일+"))
                run = None
    return out


def ranking_outages(first: date, last: date, path: Path | None = None) -> list[Outage]:
    path = path or RANKING_OH_PATH
    if not path.exists():
        raise FileNotFoundError("월별 정비 가정을 로컬 inputs/ranking_oh.json에 복원하세요")
    ranking = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(ranking, dict) or any(
        not str(m).isdigit() or not 1 <= int(m) <= 12 or not isinstance(units, list)
        or any(not isinstance(u, str) or not u.strip() for u in units) for m, units in ranking.items()
    ):
        raise ValueError("월별 정비 가정은 {월(1~12): 호기명 배열} 형식이어야 합니다")
    out = []
    for month_text, units in ranking.items():
        month = int(month_text)
        start = date(first.year, month, 1)
        end = date(first.year + (month == 12), month % 12 + 1, 1)
        if end <= first or start > last:
            continue
        for unit in units:
            if unit.startswith("당진"):
                continue  # 당진은 실적에서 직접 본다
            out.append(Outage(unit, datetime.combine(start, datetime.min.time()),
                              datetime.combine(end, datetime.min.time()), "순위표 OH(월 전체 근사)"))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2026-01-01")
    parser.add_argument("--end", default="2026-07-31")
    parser.add_argument("--quality", default="fast")
    parser.add_argument("--workers", type=int, default=None)
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    first, last = date.fromisoformat(args.start), date.fromisoformat(args.end)
    history = complete_days(load_history())
    actual = load_dangjin_actual()
    warm = first - timedelta(days=WARMUP_DAYS)
    days = [warm + timedelta(days=i) for i in range((last - warm).days + 1)]
    missing = [d for d in days if d not in history]
    if missing:
        raise SystemExit(f"실적 없는 날: {missing[:5]}")
    outages = dangjin_outages(actual, first, last) + ranking_outages(first, last)
    scenario = Scenario(name=f"배분백테스트 {first}~{last}", start=first, end=last,
                        quality=args.quality, workers=args.workers, coal_oh=outages)
    hours = hours_of(days)
    target = np.asarray([history[d][h].coal_mw for d in days for h in range(24)])
    inputs = coal_inputs(load_coal_units(), load_heat_prices(), outages, hours)
    forecast = [DayForecast(d, [history[d][h].demand_mw for h in range(24)],
                            [history[d][h].solar_mw for h in range(24)],
                            [history[d][h].temp_c or 0.0 for h in range(24)]) for d in days]
    nuclear = np.asarray([history[d][h].nuclear_mw for d in days for h in range(24)])
    prep = dict(all_days=days, hours=hours, forecast=forecast, nuclear=nuclear, running={},
                raw=target, target=np.minimum(target, inputs.available_max), available=inputs.available_max,
                inputs=inputs, net_model=load_net_demand_model(), coal_model=load_coal_curve_model(),
                warnings=[])
    print(f"정비 {len(outages)}건 (당진 실적추정 {sum(o.note.startswith('실적') for o in outages)}건)")
    for o in outages:
        print(f"  {o.unit:6s} {o.start:%m-%d %H}시 ~ {o.end:%m-%d %H}시  {o.note}")
    began = time.perf_counter()
    last_print = [0.0]

    def progress(event):
        if event.get("windows_total") and time.perf_counter() - last_print[0] > 20:
            last_print[0] = time.perf_counter()
            print(f"  MILP {event.get('windows_done', 0)}/{event['windows_total']}", flush=True)

    result = solve_prepared(prep, scenario, progress, began)
    names = result.names
    dj = [j for j, n in enumerate(names) if n.startswith("당진")]
    by_month = defaultdict(lambda: defaultdict(float))
    for k, at in enumerate(hours_of(result.days)):
        m = at.strftime("%Y-%m")
        row = actual.get(at, {})
        by_month[m]["hours"] += 1
        by_month[m]["model"] += float(result.output[k, dj].sum())
        by_month[m]["actual"] += sum(row.values())
        by_month[m]["coal"] += float(result.coal_target[k])
        by_month[m]["online_model"] += float(result.online[k, dj].sum())
        by_month[m]["online_actual"] += sum(1 for v in row.values() if v > 1.0)
        for j in dj:
            by_month[m]["u_model_" + names[j]] += float(result.output[k, j])
            by_month[m]["u_actual_" + names[j]] += row.get(names[j], 0.0)
    print(f"\n풀이 {result.elapsed_seconds:,.0f}초 · 창 상태 "
          f"{ {s: result.window_status.count(s) for s in set(result.window_status)} }")
    print("월       전국석탄MW  당진실적MW  당진모델MW   오차   당진몫(실적/모델)  운전대수(실적/모델)")
    errors = []
    for m, v in sorted(by_month.items()):
        h = v["hours"]
        a, p = v["actual"] / h, v["model"] / h
        errors.append((p - a) / a)
        print(f"{m}  {v['coal']/h:10,.0f}  {a:10,.0f}  {p:10,.0f}  {(p/a-1)*100:+6.1f}%   "
              f"{a/(v['coal']/h)*100:5.1f}% / {p/(v['coal']/h)*100:5.1f}%      "
              f"{v['online_actual']/h:4.1f} / {v['online_model']/h:4.1f}")
    print(f"월 MAPE {np.mean(np.abs(errors))*100:.1f}% · 편향 {np.mean(errors)*100:+.1f}%")
    total = defaultdict(lambda: [0.0, 0.0])
    for v in by_month.values():
        for j in dj:
            total[names[j]][0] += v["u_actual_" + names[j]]
            total[names[j]][1] += v["u_model_" + names[j]]
    hours_total = sum(v["hours"] for v in by_month.values())
    print("호기별 평균출력 실적/모델(MW): " + " · ".join(
        f"{n} {a/hours_total:,.0f}/{p/hours_total:,.0f}"
        for n, (a, p) in sorted(total.items(), key=lambda kv: int(kv[0][2:]))))


if __name__ == "__main__":
    main()
