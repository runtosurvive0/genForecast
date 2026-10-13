import type { PlanningSnapshot } from "../../domain/planning.ts";
import {
  DAYS_STATUS_LABEL,
  BERTHS,
  YARD_GROUP_IDS,
  YARD_UNIT_RANGES,
  type GroupForecast,
  type StockGroup,
  type TimelineRow,
  type SiteVessel,
} from "./stockyard-domain.ts";

/** Existing yard UI reads backend inventory without allocating it to sample Piles. */
export type InventoryGroup = Pick<
  GroupForecast,
  "group" | "currentDays" | "minDays" | "firstShortageDate" | "status"
> & {
  currentTons: number | null;
  daily: { date: string; stockTons: number | null; days: number | null }[];
  source?: "db";
  cv?: number | null;
};
const statuses: Record<string, GroupForecast["status"]> = {
  normal: "ok",
  caution: "warn",
  danger: "danger",
  unknown: "unknown",
};
export const inventoryStatus = (risk: string) => statuses[risk] ?? "unknown";
export const inventoryStatusLabel = (g: InventoryGroup) =>
  g.source === "db" && g.status === "unknown"
    ? "미확정"
    : DAYS_STATUS_LABEL[g.status];

export const sumKnownInventory = (values: (number | null | undefined)[]) =>
  values.length && values.every((v) => v != null)
    ? values.reduce<number>((sum, v) => sum + v!, 0)
    : null;

export interface YardFeed {
  yard: string;
  generationMwh: number | null;
  tonnesPerDay: number | null;
  tonnesPerHour: number | null;
}

/** 같은 MILP 날짜의 발전량·DB 혼합 열량 연소량. t/h는 일평균이며 순간값이 아니다. */
export function supplyFeeds(snapshot: PlanningSnapshot | null): YardFeed[] {
  const day = snapshot?.daily.find((d) => d.date === snapshot.start);
  const inventory = snapshot?.inventory.daily.find((d) => d.day === snapshot.start);
  return Object.entries(YARD_GROUP_IDS).map(([yard, groupId]) => {
    const [first, last] = YARD_UNIT_RANGES[yard];
    const generationMwh = sumKnownInventory(Array.from({ length: last - first + 1 }, (_, i) =>
      day?.unit_generation_mwh?.[`dj-${first + i}`]));
    const tonnesPerDay = inventory?.groups[groupId]?.burn ?? null;
    return { yard, generationMwh, tonnesPerDay, tonnesPerHour: tonnesPerDay === null ? null : tonnesPerDay / 24 };
  });
}

export interface YardUnload {
  berth: string;
  rateTpd: number | null;
  receipts: number | null;
}

/** 7,000 t/일은 기본 하역율이며 당일 재고 반영량은 Cargo·접안시간·중단을 반영한 DB 값. */
export function supplyUnloads(snapshot: PlanningSnapshot | null): YardUnload[] {
  const missingBerth = snapshot?.vessels.some((v) => !v.berth_id && (v.state === "하역중" || (v.today_receipts ?? 0) !== 0));
  return BERTHS.map((berth) => {
    const vessels = missingBerth ? undefined : snapshot?.vessels.filter((v) => v.berth_id === berth);
    return { berth,
      rateTpd: !vessels ? null : vessels.length ? sumKnownInventory(vessels.map((v) => v.unloading_rate_tpd)) : 0,
      receipts: !vessels ? null : vessels.length ? sumKnownInventory(vessels.map((v) => v.today_receipts)) : 0 };
  });
}

/** 원장에 연결된 표본 하역선은 DB 조회일의 상태·접안·완료시각을 따른다. */
export function supplySiteVessels(snapshot: PlanningSnapshot | null, samples: SiteVessel[]): SiteVessel[] {
  if (snapshot?.inventory_mode) {
    return snapshot.vessels.filter(v => (v.state !== "완료" || v.berth_occupied) && v.state !== "입항예정").map(v => ({
      dbVesselId: v.id, state: v.state === "하역중" || v.state === "하역중단" || v.berth_occupied ? "unloading" : "waiting",
      ledgerState: v.state === "완료" && v.berth_occupied ? "하역 완료 · 이안 대기" : v.state, berth_id: v.berth_id ?? "", assigned: !!v.berth_id,
      waitH: v.wait_hours ?? null, berthAt: v.berth_at ?? null, demurrageUsd: null,
      freshnessLabel: v.classification === "simulation" ? "가상 하역 계획 · AIS와 구분" : "DB 하역 계획 · AIS와 구분",
      voyage: { voyage_id: `supply:${v.id}`, vessel_name: v.name, ais_eta: v.arrival_at,
        forecast_unload_end: v.unload_end ?? "", cargo_t: v.cargo,
        coal_type: v.coal_grade === "high" ? "고열량" : v.coal_grade === "low" ? "저열량" : v.coal_grade === "blend" ? "혼합탄" : "탄종 미확정",
        calorific_value_kcal_kg: v.incoming_cv, berth_id: v.berth_id ?? null }
    }));
  }
  return samples.flatMap((sample) => {
    const vessel = snapshot?.vessels.find((v) => v.name === sample.voyage.vessel_name && v.run_id === snapshot.run_id)
      ?? snapshot?.vessels.find((v) => v.name === sample.voyage.vessel_name && !v.run_id && v.state !== "완료");
    if (!vessel) return [sample];
    if (vessel.state === "완료" || vessel.state === "입항예정") return [];
    return [{ ...sample,
      state: vessel.state === "하역중" || vessel.state === "하역중단" ? "unloading" as const : "waiting" as const,
      ledgerState: vessel.state,
      berth_id: sample.assigned ? sample.berth_id : vessel.berth_id ?? sample.berth_id,
      berthAt: vessel.berth_at ?? "", waitH: vessel.wait_hours ?? 0,
      freshnessLabel: vessel.classification === "simulation" ? "가상 하역 계획" : "DB 하역 계획",
      voyage: { ...sample.voyage, cargo_t: vessel.cargo, calorific_value_kcal_kg: vessel.incoming_cv,
        ais_eta: vessel.arrival_at, forecast_unload_end: vessel.unload_end ?? "" } }];
  });
}

export function supplyTimeline(
  snapshot: PlanningSnapshot | null,
): TimelineRow[] {
  if (!snapshot) return [];
  const end = Date.parse(`${snapshot.end}T00:00:00+09:00`) + 86400000;
  const base = Date.parse(`${snapshot.start}T00:00:00+09:00`);
  const pos = (at: string) => Math.min(1, Math.max(0, (Date.parse(at) - base) / (end - base)));
  return snapshot.vessels
    .filter((v) => v.remaining > 0 && Date.parse(v.arrival_at) < end)
    .sort((a, b) => Date.parse(a.arrival_at) - Date.parse(b.arrival_at))
    .map((v) => ({
      voyage: {
        voyage_id: `supply:${v.id}`,
        vessel_name: v.name,
        cargo_t: v.cargo,
        coal_type: v.coal_grade === "high" ? "고열량탄" : v.coal_grade === "low" ? "저열량탄" : v.coal_grade === "blend" ? "혼합탄" : "탄종 미연계",
        calorific_value_kcal_kg: v.incoming_cv,
      },
      eta: v.arrival_at,
      berthAt: v.berth_at ?? null,
      unloadEnd: v.unload_end ?? null,
      wait: v.berth_at && Date.parse(v.berth_at) > Date.parse(v.arrival_at) ? [pos(v.arrival_at), pos(v.berth_at)] : null,
      unload: v.berth_at && v.unload_end ? [pos(v.berth_at), pos(v.unload_end)] : null,
      reflect: v.unload_end && Date.parse(v.unload_end) <= end ? pos(v.unload_end) : null,
    }));
}

export function supplyInventory(
  snapshot: PlanningSnapshot | null,
  groups: StockGroup[],
): InventoryGroup[] {
  return groups.map((group) => {
    const id = YARD_GROUP_IDS[group.yard as keyof typeof YARD_GROUP_IDS];
    const g = snapshot?.inventory.groups.find(
      (g) => group.plantId === "dangjin" && g.id === id,
    );
    const daily =
      snapshot?.inventory.daily.map((row) => ({
        date: row.day,
        stockTons: row.groups[id]?.stock ?? null,
        days: row.groups[id]?.days ?? null,
      })) ?? [];
    const minimum =
      g?.min_days == null
        ? undefined
        : daily.find((row) => row.days === g.min_days);
    return {
      group,
      source: "db",
      cv: g?.cv ?? null,
      currentTons: g?.stock ?? null,
      currentDays: g?.days ?? null,
      minDays:
        minimum && g?.min_days != null
          ? { days: g.min_days, date: minimum.date }
          : null,
      firstShortageDate:
        daily.find((row) => row.stockTons !== null && row.stockTons < 0)
          ?.date ?? null,
      status: inventoryStatus(g?.risk ?? "unknown"),
      daily,
    };
  });
}
