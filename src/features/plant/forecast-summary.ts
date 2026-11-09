import type { PlanningSnapshot } from "../../domain/planning";
import { fuelMetrics } from "./fuel-metrics.ts";

/** Totals are only meaningful when every day and every stock group is present. */
export function forecastSummary(snapshot: PlanningSnapshot) {
  const dates = Array.from({ length: snapshot.horizon_days }, (_, index) =>
    new Date(Date.parse(snapshot.start + "T00:00:00Z") + index * 86400000)
      .toISOString().slice(0, 10),
  );
  const generationComplete = dates.length > 0 && snapshot.daily.length === dates.length &&
    snapshot.daily.every((day, index) => day.date === dates[index] && day.generation_mwh != null && Number.isFinite(day.generation_mwh));
  const generation = generationComplete
    ? snapshot.daily.reduce((sum, day) => sum + day.generation_mwh!, 0)
    : null;
  const groups = ["g14", "g58", "g910"];
  const stockComplete = dates.length > 0 && snapshot.inventory.daily.length === dates.length &&
    snapshot.inventory.daily.every((day, index) => day.day === dates[index] &&
      groups.every((id) => day.groups[id]?.stock != null && Number.isFinite(day.groups[id].stock)));
  const minimumStock = stockComplete
    ? snapshot.inventory.daily.reduce<{ day: string; tonnes: number } | null>((lowest, day) => {
        const tonnes = groups.reduce((sum, id) => sum + day.groups[id].stock!, 0);
        return !lowest || tonnes < lowest.tonnes ? { day: day.day, tonnes } : lowest;
      }, null)
    : null;
  return { generation, fuel: fuelMetrics(snapshot).total, minimumStock };
}
