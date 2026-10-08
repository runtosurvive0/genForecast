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
      ],
      daily: Array.from({ length: horizon }, (_, i) => ({
        day: day(i),
        groups: { g14: { stock: null, days: null, burn: 960 } },
      })),
      kpis: { stock: null, min_days: null, risk: "unknown" },
      plan_stale: false,
    },
    vessels: [],
    issues: ["기준재고 미등록", "가용용량 시계열 미보존"],
  };
}
