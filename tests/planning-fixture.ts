import type { PlanningSnapshot } from "../src/domain/planning.ts";

export function planningFixture(
  runId = "검증 계산",
  start = "2027-01-01",
  horizon = 30,
): PlanningSnapshot {
  const day = (i: number) =>
    new Date(Date.parse(start + "T00:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10);
  return {
    schema_version: 1,
    plant_id: "dangjin",
    run_id: runId,
    name: runId,
    classification: "functional_demo",
    classification_note: "합성 API 검증 자료",
    generated_at: "2026-10-08T10:00:00+09:00",
    run_start: "2027-01-01",
    run_end: "2027-12-31",
    start,
    end: day(horizon - 1),
    horizon_days: horizon,
    timezone: "Asia/Seoul",
    fuel: { calorific_kcal_kg: 5500, is_assumption: true, source: "임시 가정" },
    fuel_method: "검증용 고정 기준 발열량",
    units: Array.from({ length: 10 }, (_, i) => ({
      unit_id: `dj-${i + 1}`,
      name: `당진${i + 1}호기`,
      capacity_mw: 500,
      generation_mwh: 2400 * horizon,
      capacity_factor_pct: 20,
      online_hours: 24 * horizon,
      fuel_tonnes: 960 * horizon,
    })),
    daily: Array.from({ length: horizon }, (_, i) => ({
      date: day(i),
      generation_mwh: 24000,
      unit_generation_mwh: Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`dj-${j + 1}`, 2400])),
      fuel_tonnes: 9600,
    })),
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2027-${String(i + 1).padStart(2, "0")}`,
      expected_days: 31,
      complete_days: i ? 0 : 31,
      fuel_tonnes: i ? null : 297600,
    })),
    outages: [
      {
        unit_id: "dj-2",
        name: "당진2호기",
        start_at: "2027-01-02T00:00:00+09:00",
        end_at: "2027-01-04T00:00:00+09:00",
        note: "검증 정비",
      },
    ],
    models: Array.from({ length: horizon }, (_, i) => ({
      day: day(i),
      demand_mw: 80000,
      demand_peak_mw: 90000,
      coal_ml_mw: 20000,
      coal_target_mw: 19000,
      coal_available_mw: null,
      coal_mip_mw: 19000,
    })),
    model_info: { source: "synthetic fixture" },
    inventory: {
      groups: [
        {
          id: "g14",
          name: "1~4호기 처",
          stock: null,
          cv: null,
          days: null,
          min_days: null,
          risk: "unknown",
          stale: false,
          baseline: null,
          expected_receipts: 0,
        },
        ...["g58", "g910"].map((id) => ({
          id,
          name: id === "g58" ? "5~8호기 처" : "9~10호기 처",
          stock: null,
          cv: null,
          days: null,
          min_days: null,
          risk: "unknown",
          stale: false,
          baseline: null,
          expected_receipts: 0,
        })),
      ],
      daily: Array.from({ length: horizon }, (_, i) => ({
        day: day(i),
        groups: {
          g14: { stock: null, days: null, burn: 960 },
          g58: { stock: null, days: null, burn: null },
          g910: { stock: null, days: null, burn: null },
        },
      })),
      kpis: {
        stock: null,
        min_days: null,
        risk: "unknown",
        days: null,
        unloading_remaining: 0,
        active_vessels: 0,
        arrivals: 0,
        arrival_count: 0,
        incoming_cv: null,
      },
      thresholds: { danger_days: 7, normal_days: 15 },
      plan_stale: false,
    },
    vessels: [],
    issues: ["기준재고 미등록", "가용용량 시계열 미보존"],
  };
}

export function suppliedPlanningFixture(
  runId = "연계 계획",
  start = "2027-01-01",
  horizon = 30,
) {
  const s = planningFixture(runId, start, horizon);
  const stocks = [130000, 90000, 70000];
  s.inventory.groups.forEach((g, i) =>
    Object.assign(g, {
      stock: stocks[i],
      cv: 5800 + i * 100,
      days: [25, 18, 20][i],
      min_days: [16, 5, 17][i],
      risk: i === 1 ? "danger" : "normal",
      baseline: { at: `${start}T00:00:00+09:00`, tonnes: stocks[i] },
      expected_receipts: [25000, 10000, 0][i],
    }),
  );
  s.inventory.daily.forEach((row, d) =>
    s.inventory.groups.forEach((g, i) => {
      row.groups[g.id] = {
        stock: stocks[i] - d * 1000,
        days:
          [16, 5, 17][i] +
          Math.abs(d - (i === 1 ? Math.floor(horizon / 2) : horizon - 1)),
        burn: 1000,
      };
    }),
  );
  const at = (offset: number) =>
    new Date(
      Date.parse(`${start}T00:00:00+09:00`) + offset * 86400000,
    ).toISOString();
  s.inventory.kpis = {
    stock: 290000,
    days: 18,
    min_days: 5,
    risk: "danger",
    unloading_remaining: 25000,
    active_vessels: 1,
    arrivals: 60000,
    arrival_count: 1,
    incoming_cv: 6100,
  };
  s.vessels = [
    {
      id: 1,
      name: "DB 하역선",
      cargo: 50000,
      incoming_cv: 5800,
      arrival_at: at(-1),
      remaining: 25000,
      state: "하역중",
    },
    {
      id: 2,
      name: "DB 입항선",
      cargo: 60000,
      incoming_cv: 6100,
      arrival_at: at(2),
      remaining: 60000,
      state: "입항예정",
    },
    {
      id: 3,
      name: "DB 중단선",
      cargo: 20000,
      incoming_cv: 5800,
      arrival_at: at(-2),
      remaining: 5000,
      state: "하역중단",
    },
  ];
  return s;
}
