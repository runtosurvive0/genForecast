// 운영 현황판 계산: 운전 데모의 현재 출력·저탄 재고, 저장 계획의 오늘 순수요, 항차 원장의 입항 예정.
// 값이 없으면 null(미확정)로 두고 계획값이나 합성값으로 채우지 않는다.
import type { FuelDemoCatalog, FuelDemoSnapshot } from "./fuel-demo/types";
import type { PlanningRun } from "./planning";
import type { BerthRegistry } from "./berth-ais";

export type UnitStatus = "running" | "stopped" | "fault" | "unknown";
export interface UnitOutput { unit: number; mw: number | null; maxMW: number | null; status: UnitStatus }

const UNITS = Array.from({ length: 10 }, (_, i) => i + 1);

export function unitOutputs(snapshot: Pick<FuelDemoSnapshot, "units">, catalog: Pick<FuelDemoCatalog, "units"> | null) {
  const rows: UnitOutput[] = UNITS.map((unit) => {
    const live = snapshot.units[String(unit)];
    const maxMW = catalog?.units.find((u) => u.id === unit)?.maxMW ?? null;
    if (!live || !Number.isFinite(live.mw)) return { unit, mw: null, maxMW, status: "unknown" };
    return { unit, mw: live.mw, maxMW, status: live.status };
  });
  const totalMW = rows.every((row) => row.mw !== null) ? rows.reduce((sum, row) => sum + (row.mw ?? 0), 0) : null;
  return { rows, totalMW, running: rows.filter((row) => row.status === "running").length };
}

const GRADE: Record<string, "high" | "low"> = { 고열량: "high", 저열량: "low" };

export function yardStock(snapshot: Pick<FuelDemoSnapshot, "material">) {
  const yards = [1, 2, 3].map((yard) => ({ yard, high: 0, low: 0 }));
  for (const lot of Object.values(snapshot.material.lots)) {
    const grade = GRADE[lot.quality];
    const yard = yards.find((y) => y.yard === lot.yard);
    if (!grade || !yard || !(lot.tons > 0)) continue;
    yard[grade] += lot.tons;
  }
  for (const yard of yards) { yard.high = Math.round(yard.high); yard.low = Math.round(yard.low); }
  const high = yards.reduce((sum, y) => sum + y.high, 0);
  const low = yards.reduce((sum, y) => sum + y.low, 0);
  return { yards, high, low, total: high + low };
}

const KST = 9 * 3600_000;
export const kstDay = (now: Date) => new Date(now.getTime() + KST).toISOString().slice(0, 10);
export const kstHour = (now: Date) => new Date(now.getTime() + KST).getUTCHours();
/** ISO 시각을 KST HH:MM으로. 읽을 수 없으면 "시각 미확인". */
export const kstClock = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + KST).toISOString().slice(11, 16) : "시각 미확인"; };

/** 오늘을 포함한 저장 계획 중 가장 늦게 시작한 계획(최신 조건). */
export function runCovering(runs: PlanningRun[], day: string): PlanningRun | null {
  const covering = runs.filter((run) => run.start <= day && day <= run.end);
  return covering.sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
}

export interface TodayDemand { day: string; net: number[] }

export function parseHourly(body: unknown): TodayDemand {
  const row = body as { day?: unknown; net?: unknown } | null;
  if (!row || typeof row.day !== "string" || !Array.isArray(row.net) || row.net.length !== 24 || !row.net.every((v) => typeof v === "number" && Number.isFinite(v)))
    throw new Error("시간대별 순수요 응답 형식이 맞지 않습니다.");
  return { day: row.day, net: row.net as number[] };
}

export async function loadTodayDemand(runId: string, day: string, signal?: AbortSignal): Promise<TodayDemand> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/hourly?day=${day}`, { signal });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("시간대별 순수요 응답을 읽지 못했습니다."); }
  if (!response.ok) {
    const detail = (body as { detail?: unknown })?.detail;
    throw new Error(typeof detail === "string" ? detail : `순수요 조회 실패 (${response.status})`);
  }
  return parseHourly(body);
}

export interface Arrival { voyage: string; ship: string; status: string; eta: string | null; berth: string | null }

/** 당진행 실제 항차 중 '예정·항해' 상태만 ETA 순으로(ETA 없는 항차는 뒤로). */
export function arrivals(registry: BerthRegistry): Arrival[] {
  const name = (code: unknown) => String(registry.ships.find((s) => s.ship_code === code)?.name ?? code ?? "선박 미확인");
  return registry.voyages
    .filter((v) =>
      v.classification !== "simulation" &&
      ["planned", "underway"].includes(String(v.status)) &&
      (/당진|dangjin/i.test(String(v.destination_port ?? "")) ||
        registry.cargo.some((c) => c.voyage_no === v.voyage_no && c.destination_plant_id === "dangjin")))
    .map((v) => ({
      voyage: String(v.voyage_no),
      ship: name(v.ship_code),
      status: String(v.status),
      eta: typeof v.planned_arrival === "string" && v.planned_arrival ? v.planned_arrival : null,
      berth: typeof v.berth_id === "string" && v.berth_id ? v.berth_id : null,
    }))
    .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));
}
