import type { PlanningSnapshot } from "./planning";

export const SUPPLY_GROUPS = [
  { id: "g14", name: "1~4호기 처", first: 1, last: 4, color: "#248df5" },
  { id: "g58", name: "5~8호기 처", first: 5, last: 8, color: "#eea628" },
  { id: "g910", name: "9~10호기 처", first: 9, last: 10, color: "#30b77b" },
] as const;
export const SUPPLY_RISK_NAMES: Record<string, string> = {
  normal: "정상",
  caution: "주의",
  danger: "위험",
  unknown: "미확정",
};
export type SupplyTarget = {
  section: "inventory" | "forecast" | "unloading" | "arrivals";
  groupId?: string;
  day?: string;
};

/** Locate the backend minimum; incomplete periods must not yield a partial minimum. */
export function minimumInventoryPoint(s: PlanningSnapshot) {
  const minimum = s.inventory.kpis.min_days;
  if (minimum == null) return null;
  for (const row of s.inventory.daily) {
    for (const group of SUPPLY_GROUPS) {
      if (row.groups[group.id]?.days === minimum)
        return { groupId: group.id, day: row.day };
    }
  }
  return null;
}
