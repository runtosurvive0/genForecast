"""순수요 모델 백테스트: 기준일까지로 학습하고 그다음 1년을 평년기상으로 예측해 실적과 비교한다.

비교 기준선은 '전년 동요일'(364일 전 같은 시각의 순수요) -- 연간 계획에서 흔히 쓰는 방법이다.
석탄 목표도 같이 본다: 예측 순수요 + **실제** 원전으로 기존 석탄곡선 모델을 돌려 실제 석탄과
비교한다(원전 입력 오차를 빼고 순수요 오차가 석탄으로 얼마나 번지는지 본다). 단, 저장된 석탄
모델은 2026-01~09 실적으로 학습되어 이 구간과 겹친다 -- 석탄 쪽 수치는 표본 내 성능이다.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

import numpy as np

from midterm.coal_curve import load_coal_curve_model, predict_coal_curve
from midterm.history import HourRecord, complete_days
from midterm.net_demand import forecast_net_demand, train_net_demand_model


def _mape(actual, predicted) -> float:
    a, p = np.asarray(actual, float), np.asarray(predicted, float)
    return float(np.mean(np.abs(p - a) / np.abs(a)) * 100)


def _bias(actual, predicted) -> float:
    a, p = np.asarray(actual, float), np.asarray(predicted, float)
    return float((p.sum() - a.sum()) / a.sum() * 100)


def run_backtest(records: list[HourRecord], cutoff: date, *, days: int = 365) -> dict:
    model = train_net_demand_model(records, through=cutoff)
    actual = complete_days(records)
    targets = [cutoff + timedelta(days=i) for i in range(1, days + 1)
               if cutoff + timedelta(days=i) in actual]
    forecast = {f.day: f for f in forecast_net_demand(model, targets)}
    coal_model = load_coal_curve_model()

    hourly = defaultdict(list)
    by_day, by_month = {}, defaultdict(lambda: defaultdict(list))
    for day in targets:
        hours = actual[day]
        net_a = [hours[h].net_demand_mw for h in range(24)]
        base_day = day - timedelta(days=364)
        base = ([actual[base_day][h].net_demand_mw for h in range(24)]
                if base_day in actual else None)
        f = forecast[day]
        coal_p = predict_coal_curve(coal_model, day=day, demand_mw=f.demand_mw,
                                    solar_mw=f.solar_mw,
                                    nuclear_mw=[hours[h].nuclear_mw for h in range(24)])
        coal_a = [hours[h].coal_mw for h in range(24)]
        hourly["net_a"] += net_a
        hourly["net_p"] += f.net_mw
        if base:
            hourly["base_a"] += net_a
            hourly["base_p"] += base
        by_day[day] = dict(net_a=np.mean(net_a), net_p=np.mean(f.net_mw),
                           base_p=np.mean(base) if base else None,
                           coal_a=np.mean(coal_a), coal_p=np.mean(coal_p),
                           demand_a=np.mean([hours[h].demand_mw for h in range(24)]),
                           demand_p=np.mean(f.demand_mw),
                           solar_a=np.mean([hours[h].solar_mw for h in range(24)]),
                           solar_p=np.mean(f.solar_mw))
        for key, value in by_day[day].items():
            if value is not None:
                by_month[day.strftime("%Y-%m")][key].append(value)

    months = {m: {k: float(np.mean(v)) for k, v in values.items()} for m, values in by_month.items()}
    days_with_base = [d for d in by_day if by_day[d]["base_p"] is not None]
    month_keys = sorted(months)
    summary = {
        "cutoff": cutoff.isoformat(), "days": len(targets),
        "model": {"trained_from": model.trained_from.isoformat(),
                  "level_factor": model.level_factor,
                  "demand_growth": model.demand_growth, "solar_growth": model.solar_growth},
        "net_hourly_mape": _mape(hourly["net_a"], hourly["net_p"]),
        "net_daily_mape": _mape([by_day[d]["net_a"] for d in by_day],
                                [by_day[d]["net_p"] for d in by_day]),
        "net_monthly_mape": _mape([months[m]["net_a"] for m in month_keys],
                                  [months[m]["net_p"] for m in month_keys]),
        "net_bias_pct": _bias(hourly["net_a"], hourly["net_p"]),
        "baseline_hourly_mape": _mape(hourly["base_a"], hourly["base_p"]),
        "baseline_daily_mape": _mape([by_day[d]["net_a"] for d in days_with_base],
                                     [by_day[d]["base_p"] for d in days_with_base]),
        "baseline_monthly_mape": _mape([months[m]["net_a"] for m in month_keys],
                                       [months[m]["base_p"] for m in month_keys]),
        "coal_daily_mape": _mape([by_day[d]["coal_a"] for d in by_day],
                                 [by_day[d]["coal_p"] for d in by_day]),
        "coal_monthly_mape": _mape([months[m]["coal_a"] for m in month_keys],
                                   [months[m]["coal_p"] for m in month_keys]),
        "coal_bias_pct": _bias([by_day[d]["coal_a"] for d in by_day],
                               [by_day[d]["coal_p"] for d in by_day]),
        "months": months,
    }
    return summary


def format_backtest(result: dict) -> str:
    lines = [
        f"백테스트: {result['cutoff']} 까지 학습 → 다음 {result['days']}일 평년기상 예측",
        f"  모델 수준계수 {result['model']['level_factor']:.4f} · 수요증가율 "
        f"{result['model']['demand_growth']*100:+.2f}%/년 · 태양광증가율 "
        f"{result['model']['solar_growth']*100:+.1f}%/년",
        "  지표          시간MAPE  일평균MAPE  월평균MAPE  편향",
        f"  순수요(모델)   {result['net_hourly_mape']:6.2f}%   {result['net_daily_mape']:6.2f}%"
        f"    {result['net_monthly_mape']:6.2f}%  {result['net_bias_pct']:+.2f}%",
        f"  전년동요일     {result['baseline_hourly_mape']:6.2f}%   "
        f"{result['baseline_daily_mape']:6.2f}%    {result['baseline_monthly_mape']:6.2f}%",
        f"  석탄목표*      {'':6s}    {result['coal_daily_mape']:6.2f}%    "
        f"{result['coal_monthly_mape']:6.2f}%  {result['coal_bias_pct']:+.2f}%",
        "  (*예측 순수요 + 실제 원전 → 기존 석탄곡선 모델. 석탄 모델 학습기간과 겹침)",
        "  월      순수요실적  순수요예측   오차   총수요예측오차 태양광예측오차  석탄실적 석탄예측",
    ]
    for month, v in sorted(result["months"].items()):
        lines.append(
            f"  {month}  {v['net_a']:9,.0f}  {v['net_p']:9,.0f}  {(v['net_p']/v['net_a']-1)*100:+5.1f}%"
            f"      {(v['demand_p']/v['demand_a']-1)*100:+5.1f}%        "
            f"{(v['solar_p']/v['solar_a']-1)*100:+6.1f}%   {v['coal_a']:7,.0f} {v['coal_p']:7,.0f}")
    return "\n".join(lines)
