/** Stored Python MILP snapshot. Missing measurements and forecasts remain null. */
export interface PlanningRun {
  id: string;
  name: string;
  period: string;
  start: string;
  end: string;
}
export interface PlanningSnapshot {
  inventory_mode?: InventoryMode;
  estimated_assignments?: { vessel_id: number; berth_id: string; start_at: string; end_at: string; reason: string }[];
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
    unit_generation_mwh?: Record<string, number | null>;
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
    solar_mw?: number | null;
    solar_mwh?: number | null;
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
      baseline: { tonnes: number; at: string } | null;
      delta?: number | null;
      today_burn?: number | null;
      expected_receipts: number;
    }[];
    daily: {
      day: string;
      port_remaining?: number;
      stock_including_port?: number | null;
      groups: Record<
        string,
        { stock: number | null; days: number | null; burn: number | null; receipts?: number }
      >;
    }[];
    kpis: {
      stock: number | null;
      min_days: number | null;
      risk: string;
      days?: number | null;
      unloading_remaining?: number;
      active_vessels?: number;
      arrivals?: number;
      arrival_count?: number;
      incoming_cv?: number | null;
      waiting_cargo?: number | null;
      port_remaining?: number | null;
      stock_including_port?: number | null;
    };
    thresholds?: { danger_days: number; normal_days: number };
    plan_stale: boolean;
    initial_lots?: { group_id: string; grade: "high" | "low"; tonnes: number; cv: number; is_assumption: number }[];
  };
  vessels: {
    id: number;
    name: string;
    cargo: number;
    incoming_cv: number;
    arrival_at: string;
    remaining: number;
    state: string;
    berth_id?: "BD-1" | "BD-2" | "BD-3" | null;
    run_id?: string | null;
    classification?: "planned" | "simulation";
    unloading_rate_tpd?: number;
    today_receipts?: number;
    coal_grade?: "high" | "low" | "blend" | null;
    berth_at?: string | null;
    unload_end?: string | null;
    wait_hours?: number | null;
    demurrage_hours?: number | null;
    port_remaining?: number;
    berth_occupied?: boolean;
  }[];
  issues: string[];
}

export type InventoryMode = "assigned" | "include_waiting";

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

export async function readJson(path: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, signal });
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
  inventoryMode: InventoryMode = "assigned",
): Promise<PlanningSnapshot> {
  const query = new URLSearchParams({ start, horizon: String(horizon) });
  if (inventoryMode !== "assigned") query.set("inventory_mode", inventoryMode);
  const body = (await readJson(
    `/api/planning/runs/${encodeURIComponent(runId)}/snapshot?${query}`,
    signal,
  )) as PlanningSnapshot;
  if (inventoryMode !== "assigned" && body.inventory_mode !== inventoryMode)
    throw new Error("체선 포함 전망을 지원하는 백엔드 버전을 확인하세요.");
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
        !amount(d.fuel_tonnes) ||
        (d.unit_generation_mwh !== undefined &&
          (!d.unit_generation_mwh || Array.isArray(d.unit_generation_mwh) || typeof d.unit_generation_mwh !== "object" ||
            Object.entries(d.unit_generation_mwh).some(([id, value]) =>
              !/^dj-([1-9]|10)$/.test(id) || !amount(value) || (value !== null && value < 0)))),
    ) ||
    !Array.isArray(body.models) ||
    !Array.isArray(body.monthly) ||
    !Array.isArray(body.outages) ||
    !Array.isArray(body.issues) ||
    !Array.isArray(body.inventory?.groups) ||
    body.inventory.groups.length !== 3 ||
    new Set(body.inventory.groups.map((g) => g?.id)).size !== 3 ||
    body.inventory.groups.some(
      (g) =>
        !g ||
        !["g14", "g58", "g910"].includes(g.id) ||
        typeof g.name !== "string" ||
        !amount(g.stock) ||
        !amount(g.cv) ||
        !amount(g.days) ||
        !amount(g.min_days) ||
        !["normal", "caution", "danger", "unknown"].includes(g.risk) ||
        typeof g.stale !== "boolean" ||
        !Number.isFinite(g.expected_receipts),
    ) ||
    !Array.isArray(body.inventory?.daily) ||
    body.inventory.daily.length !== horizon ||
    body.inventory.daily.some(
      (row, i) =>
        !row ||
        row.day !== addDays(start, i) ||
        ["g14", "g58", "g910"].some(
          (id) =>
            !row.groups?.[id] ||
            !amount(row.groups[id].stock) ||
            !amount(row.groups[id].days) ||
            !amount(row.groups[id].burn) ||
            (row.groups[id].receipts !== undefined && !Number.isFinite(row.groups[id].receipts)),
        ),
    ) ||
    !body.inventory?.kpis ||
    !amount(body.inventory.kpis.stock) ||
    !amount(body.inventory.kpis.min_days) ||
    !["normal", "caution", "danger", "unknown"].includes(
      body.inventory.kpis.risk,
    ) ||
    [
      body.inventory.kpis.unloading_remaining,
      body.inventory.kpis.active_vessels,
      body.inventory.kpis.arrivals,
      body.inventory.kpis.arrival_count,
    ].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0)) ||
    (body.inventory.kpis.incoming_cv !== undefined &&
      !amount(body.inventory.kpis.incoming_cv)) ||
    (body.inventory.thresholds !== undefined &&
      (!Number.isFinite(body.inventory.thresholds.danger_days) ||
        body.inventory.thresholds.danger_days < 0 ||
        !Number.isFinite(body.inventory.thresholds.normal_days) ||
        body.inventory.thresholds.normal_days <=
          body.inventory.thresholds.danger_days)) ||
    !Array.isArray(body.vessels) ||
    new Set(body.vessels.map((v) => v?.id)).size !== body.vessels.length ||
    body.vessels.some(
      (v) =>
        !v ||
        !Number.isInteger(v.id) ||
        typeof v.name !== "string" ||
        !Number.isFinite(v.cargo) ||
        v.cargo <= 0 ||
        !Number.isFinite(v.incoming_cv) ||
        typeof v.arrival_at !== "string" ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(v.arrival_at) ||
        !Number.isFinite(Date.parse(v.arrival_at)) ||
        !Number.isFinite(v.remaining) ||
        v.remaining < 0 ||
        v.remaining > v.cargo ||
        (v.berth_id != null && !["BD-1", "BD-2", "BD-3"].includes(v.berth_id)) ||
        (v.run_id != null && v.run_id !== runId) ||
        (v.classification !== undefined && !["planned", "simulation"].includes(v.classification)) ||
        (v.unloading_rate_tpd !== undefined && (!Number.isFinite(v.unloading_rate_tpd) || v.unloading_rate_tpd < 0)) ||
        (v.today_receipts !== undefined && !Number.isFinite(v.today_receipts)) ||
        [v.berth_at, v.unload_end].some((at) => at != null &&
          (typeof at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)))) ||
        [v.wait_hours, v.demurrage_hours, v.port_remaining].some((value) => value != null &&
          (!Number.isFinite(value) || value < 0)) ||
        !["입항예정", "하역대기", "완료", "하역중", "하역중단"].includes(
          v.state,
        ),
    ) ||
    !body.model_info ||
    typeof body.model_info !== "object" ||
    !Number.isFinite(body.fuel?.calorific_kcal_kg) ||
    typeof body.generated_at !== "string" ||
    typeof body.classification_note !== "string"
  )
    throw new Error("요청한 계산·기간과 API 결과가 일치하지 않습니다.");
  return body;
}
