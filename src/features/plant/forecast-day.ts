import type { PlanningSnapshot } from "../../domain/planning";

/** Use only complete group totals; absent daily values remain unknown. */
export function forecastDay(snapshot: PlanningSnapshot, day: string) {
  const row = snapshot.inventory.daily.find((item) => item.day === day);
  const ids = ["g14", "g58", "g910"];
  const total = (field: "stock" | "burn" | "receipts") => {
    const values = ids.map((id) => row?.groups[id]?.[field]);
    return values.every((value) => value != null && Number.isFinite(value))
      ? values.reduce<number>((sum, value) => sum + value!, 0)
      : null;
  };
  const generation = snapshot.daily.find((item) => item.date === day)?.generation_mwh ?? null;
  return { stock: total("stock"), burn: total("burn"), receipts: total("receipts"), generation };
}
