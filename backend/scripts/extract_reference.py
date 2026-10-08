"""원천(national-solar-forecast)에서 연간 MILP 기준자료를 한 번 뽑아 `data/` 에 CSV 로 둔다.

만드는 파일 (모두 사람이 고칠 수 있는 CSV):

* data/coal_units.csv   석탄 호기 마스터. 출력범위·증감발률·최소운전/정지·기동비·열소비곡선
* data/heat_price.csv   호기 × 12개월 열량단가(원/Gcal). 기본값은 원천의 최신 달(2026-10) 단가
* data/nuclear_units.csv 원전 호기 마스터. 설비용량과 운전 시 공급가능용량(KPX 공급능력표)
* inputs/nuclear_oh_2027.csv  KPX 2026년 10월 정비계획에서 2027년까지 이어지는 원전 정비

출처:
* 석탄 56기 운전특성: `output/uc-diagnostic-2026-09-30.json` (원천 MILP 가 실제로 받은 입력)
* 당진6·영흥5: 그날 정비 중이라 위 파일에 없다 -- 같은 급 호기(당진5, 영흥6)의 운전특성을 빌리고
  비고에 적는다. 열소비곡선은 원천 DB `coal_cost_source` 의 자기 값을 쓴다.
* 원전: DB `supply_availability` 최신 스냅샷(호기별 설비용량·공급가능용량) + KPX 등록정보

실행: .venv/Scripts/python.exe scripts/extract_reference.py [--source D:/national-solar-forecast]
"""

import argparse
import asyncio
import json
import os
from datetime import timedelta
from pathlib import Path

import asyncpg
import numpy as np

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from midterm.storage import write_table  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NUCLEAR_PLANTS = ("고리", "새울", "신고리", "신월성", "신한울", "월성", "한빛", "한울")
BORROWED = {"당진6": "당진5", "영흥5": "영흥6"}
#: 동해안 송전제약 대상(원천 `transmission_groups` 의 TRANSMISSION 그룹과 같은 8기).
EAST_PLANTS = ("강릉안인", "북평", "삼척그린", "삼척화력")


def plant_of(name: str) -> str:
    return name.rstrip("0123456789") or name


async def fetch_db():
    dsn = os.environ.get("MIDTERM_SOURCE_DSN")
    if not dsn:
        raise ValueError("기준자료 DB 연결정보를 MIDTERM_SOURCE_DSN 환경변수로 지정하세요")
    connection = await asyncpg.connect(dsn)
    try:
        curve = await connection.fetchval(
            "select parsed_rows from coal_cost_source where kind='curve' and units_confirmed "
            "order by month desc, imported_at desc limit 1")
        price_rows = await connection.fetch(
            "select distinct on (month) month, parsed_rows from coal_cost_source "
            "where kind='heat_price' and units_confirmed order by month, imported_at desc")
        latest = await connection.fetchval("select max(reference_date) from supply_availability")
        availability = await connection.fetch(
            "select unit_name, installed_mw, today_mw, note from supply_availability "
            "where reference_date=$1 order by unit_name", latest)
        peaks = await connection.fetch(
            "select unit_name, max(today_mw) from supply_availability group by unit_name")
        nuclear_oh = await connection.fetch(
            """select distinct on (unit_name) unit_name, (starts_at at time zone 'Asia/Seoul')::date,
                 (ends_at at time zone 'Asia/Seoul')::date, source_filename
               from maintenance_plan_entry where fuel='원자력' and ends_at >= '2027-01-01'
               order by unit_name, fetched_at desc""")
    finally:
        await connection.close()
    load = lambda value: json.loads(value) if isinstance(value, str) else value  # noqa: E731
    return (load(curve), {r[0]: load(r[1]) for r in price_rows}, latest, availability,
            dict((r[0], r[1]) for r in peaks), nuclear_oh)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="D:/national-solar-forecast")
    source = Path(parser.parse_args().source)

    diagnostic = json.loads((source / "output/uc-diagnostic-2026-09-30.json")
                            .read_text(encoding="utf-8"))
    names = diagnostic["metadata"]["names"]
    _, minimum, maximum, ramp, _, _, _, uptime, downtime = diagnostic["args"]
    kwargs = diagnostic["kwargs"]
    minimum, maximum, ramp = (np.asarray(a, float) for a in (minimum, maximum, ramp))
    ramp_down = np.asarray(kwargs["ramp_down"], float)
    startup = np.asarray(kwargs["startup_cost"], float)
    registry = json.loads((source / "var/market/getGenerator.json").read_text(encoding="utf-8"))
    registry = registry["resultData"] if isinstance(registry, dict) else registry

    curve, prices, latest, availability, peaks, nuclear_oh = asyncio.run(fetch_db())
    latest_month = max(prices)

    units = {}
    for j, name in enumerate(names):
        units[name] = dict(
            min_mw=float(minimum[:, j].max()), max_mw=float(maximum[:, j].max()),
            ramp_up=float(ramp[0, j]), ramp_down=float(ramp_down[0, j]),
            min_up_h=float(uptime[j]), min_down_h=float(downtime[j]),
            startup_cost_won=float(startup[j]), note="원천 MILP 입력(2026-09-30)")
    for name, donor in BORROWED.items():
        units[name] = dict(units[donor], note=f"{name} 정비중이라 원천 입력에 없음 · 운전특성은 {donor} 차용")

    rows = []
    for name in sorted(units, key=lambda n: (plant_of(n), int(n[len(plant_of(n)):] or 0))):
        spec = units[name]
        values = curve[name]["values"]
        rows.append({
            "unit": name, "plant": plant_of(name),
            "installed_mw": values.get("설비용량(MW)", ""),
            "min_mw": round(spec["min_mw"], 1), "max_mw": round(spec["max_mw"], 1),
            "ramp_up_mw_min": spec["ramp_up"], "ramp_down_mw_min": spec["ramp_down"],
            "min_up_h": spec["min_up_h"], "min_down_h": spec["min_down_h"],
            "startup_cost_won": round(spec["startup_cost_won"]),
            "heat_a2": values["비용2차"], "heat_a1": values["비용1차"], "heat_a0": values["비용상수"],
            "east_coast": int(plant_of(name) in EAST_PLANTS),
            "retire_on": "", "note": spec["note"],
        })
    write_table(ROOT / "data/coal_units.csv", list(rows[0]), rows)

    month_price = prices[latest_month]
    months = [f"{m}월" for m in range(1, 13)]
    write_table(ROOT / "data/heat_price.csv", ["unit"] + months, [
        {"unit": row["unit"], **{m: month_price[row["unit"]]["values"]["열량단가(원/Gcal)"] for m in months}}
        for row in rows])
    history_months = sorted(prices)
    write_table(ROOT / "data/heat_price_history_2026.csv", ["unit"] + history_months, [
        {"unit": row["unit"], **{m: prices[m].get(row["unit"], {}).get("values", {}).get("열량단가(원/Gcal)", "")
                                 for m in history_months}} for row in rows])

    nuclear = []
    by_name = {r["genNm"]: r for r in registry if str(r.get("fuelCd")) == "01"}
    seen = set()
    for unit, installed, today, note in availability:
        if not unit.startswith(NUCLEAR_PLANTS):
            continue
        seen.add(unit)
        running = peaks.get(unit) or 0.0
        estimated = running <= 0
        if estimated:
            # 스냅샷 기간 내내 정지였던 호기: 같은 용량급의 공급가능/설비 비율 중앙값을 쓴다.
            ratios = [peaks[u] / i for u, i, *_ in availability
                      if u.startswith(NUCLEAR_PLANTS) and i == installed and (peaks.get(u) or 0) > 0]
            running = installed * (float(np.median(ratios)) if ratios else 1.04)
        nuclear.append({"unit": unit, "installed_mw": installed, "available_mw": round(running, 1),
                        "active": 1,
                        "note": ("공급가능용량 추정(스냅샷 중 정지)" if estimated else
                                 f"KPX 공급능력표 최대값 {latest:%Y-%m-%d} 까지")})
    for name, entry in by_name.items():
        if name not in seen and float(entry["fcllCpct"]) >= 100 and entry.get("tdClCd") == "01":
            nuclear.append({"unit": name, "installed_mw": float(entry["fcllCpct"]),
                            "available_mw": float(entry["mgc"]) or float(entry["fcllCpct"]),
                            "active": 0,
                            "note": "등록정보에만 있음(공급능력표 없음) · 상업운전 시 active=1"})
    write_table(ROOT / "data/nuclear_units.csv", ["unit", "installed_mw", "available_mw", "active", "note"],
                nuclear)

    # KPX 정비계획의 종료시각은 그다음 날 0시다(공급능력표 메모 '~27/4/12' 가 계획 종료
    # 2027-04-13 00:00 으로 저장된다). 여기 입력은 시작·종료 모두 포함하는 날짜이므로 하루 뺀다.
    write_table(ROOT / "inputs/nuclear_oh_2027.csv", ["unit", "start", "end", "note"], [
        {"unit": unit, "start": start.isoformat(), "end": (end - timedelta(days=1)).isoformat(),
         "note": f"KPX {filename}"} for unit, start, end, filename in nuclear_oh])
    if not (ROOT / "inputs/coal_oh_2027.csv").exists():
        write_table(ROOT / "inputs/coal_oh_2027.csv", ["unit", "start", "end", "note"], [])

    print(f"석탄 {len(rows)}기, 열량단가 {latest_month} 기준, 원전 {len(nuclear)}기, "
          f"2027 원전정비 {len(nuclear_oh)}건")


if __name__ == "__main__":
    main()
