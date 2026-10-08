/** Stored Python MILP snapshot. Missing measurements and forecasts remain null. */
export interface PlanningRun {
  id: string;
  name: string;
  period: string;
  start: string;
  end: string;
}
export interface PlanningSnapshot {
  schema_version: 1;
  plant_id: "dangjin";
  run_id: string;
  name: string;
  classification: string;
  classification_note: string;
  generated_at: string;
  run_start: string;
  run_end: string;
  start: string;
  end: string;
  horizon_days: number;
  timezone: "Asia/Seoul";
  fuel: { calorific_kcal_kg: number; is_assumption: boolean; source: string };
  fuel_method: string;
  units: {
    unit_id: string;
    name: string;
    capacity_mw: number;
    generation_mwh: number | null;
    capacity_factor_pct: number | null;
    online_hours: number | null;
    fuel_tonnes: number | null;
  }[];
  daily: {
    date: string;
    generation_mwh: number | null;
    fuel_tonnes: number | null;
  }[];
  monthly: {
    month: string;
    expected_days: number;
    complete_days: number;
    fuel_tonnes: number | null;
  }[];
  outages: {
    unit_id: string;
    name: string;
    start_at: string;
    end_at: string;
    note: string;
  }[];
  models: {
    day: string;
    demand_mw: number;
    demand_peak_mw: number;
    coal_ml_mw: number | null;
    coal_target_mw: number | null;
    coal_available_mw: number | null;
    coal_mip_mw: number | null;
  }[];
  model_info: Record<string, unknown>;
  inventory: {
    groups: {
      id: string;
      name: string;
      stock: number | null;
      cv: number | null;
      days: number | null;
      min_days: number | null;
      risk: string;
      stale: boolean;
      baseline: unknown;
      expected_receipts: number;
    }[];
    daily: {
      day: string;
      groups: Record<
        string,
        { stock: number | null; days: number | null; burn: number | null }
      >;
    }[];
    kpis: { stock: number | null; min_days: number | null; risk: string };
    plan_stale: boolean;
  };
  vessels: {
    id: number;
    name: string;
    cargo: number;
    incoming_cv: number;
    arrival_at: string;
    remaining: number;
    state: string;
  }[];
  issues: string[];
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "API 응답을 읽지 못했습니다. Python 서버 연결을 확인하세요.",
    );
  }
  if (!response.ok) {
    const detail = (body as { detail?: unknown })?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `API 조회 실패 (${response.status})`,
    );
  }
  return body;
}

export async function loadPlanningRuns(
  signal?: AbortSignal,
): Promise<PlanningRun[]> {
  const body = await readJson("/api/runs", signal);
  if (!Array.isArray(body))
    throw new Error("계산 목록의 데이터 형식이 맞지 않습니다.");
  return body.map((row) => {
    const period =
      typeof row?.period === "string" ? row.period.split(" ~ ") : [];
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      period.length !== 2 ||
      period.some((s: string) => !/^\d{4}-\d{2}-\d{2}$/.test(s))
    )
      throw new Error("계산 목록의 기간 또는 식별자를 확인하세요.");
    return {
      id: row.id,
      name: row.name,
      period: row.period,
      start: period[0],
      end: period[1],
    };
  });
}

export async function loadPlanningSnapshot(
  runId: string,
  start: string,
  horizon: number,
  signal?: AbortSignal,
): Promise<PlanningSnapshot> {
  const query = new URLSearchParams({ start, horizon: String(horizon) });
  const body = (await readJson(
    `/api/planning/runs/${encodeURIComponent(runId)}/snapshot?${query}`,
    signal,
  )) as PlanningSnapshot;
  const amount = (value: unknown) =>
    value === null || (typeof value === "number" && Number.isFinite(value));
  if (
    !body ||
    body.schema_version !== 1 ||
    body.plant_id !== "dangjin" ||
    body.run_id !== runId ||
    body.start !== start ||
    body.horizon_days !== horizon ||
    body.end !== addDays(start, horizon - 1) ||
    body.timezone !== "Asia/Seoul" ||
    !Array.isArray(body.units) ||
    body.units.length !== 10 ||
    new Set(body.units.map((u) => u.unit_id)).size !== 10 ||
    body.units.some(
      (u) =>
        !/^dj-([1-9]|10)$/.test(u.unit_id) ||
        !Number.isFinite(u.capacity_mw) ||
        u.capacity_mw <= 0 ||
        !amount(u.generation_mwh) ||
        !amount(u.fuel_tonnes) ||
        !amount(u.capacity_factor_pct),
    ) ||
    !Array.isArray(body.daily) ||
    body.daily.length !== horizon ||
    body.daily.some(
      (d, i) =>
        d.date !== addDays(start, i) ||
        !amount(d.generation_mwh) ||
        !amount(d.fuel_tonnes),
    ) ||
    !Array.isArray(body.models) ||
    !Array.isArray(body.monthly) ||
    !Array.isArray(body.outages) ||
    !Array.isArray(body.issues) ||
    !Array.isArray(body.inventory?.groups) ||
    !Array.isArray(body.inventory?.daily) ||
    !body.inventory?.kpis ||
    !body.model_info ||
    typeof body.model_info !== "object" ||
    !Number.isFinite(body.fuel?.calorific_kcal_kg) ||
    typeof body.generated_at !== "string" ||
    typeof body.classification_note !== "string"
  )
    throw new Error("요청한 계산·기간과 API 결과가 일치하지 않습니다.");
  return body;
}
