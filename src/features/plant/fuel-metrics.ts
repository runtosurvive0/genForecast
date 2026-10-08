import type { PlanningSnapshot } from "../../domain/planning";

/** A missing day makes the period total, average and maximum unknown. */
export function fuelMetrics(snapshot: PlanningSnapshot) {
  const daily = snapshot.daily;
  const complete =
    snapshot.horizon_days > 0 &&
    daily.length === snapshot.horizon_days &&
    daily.every(
      (day, index) =>
        day.fuel_tonnes !== null &&
        Number.isFinite(day.fuel_tonnes) &&
        day.date ===
          new Date(Date.parse(snapshot.start + "T00:00:00Z") + index * 86400000)
            .toISOString()
            .slice(0, 10),
    );
  const total = complete
    ? daily.reduce((value, day) => value + day.fuel_tonnes!, 0)
    : null;
  const peak = complete
    ? daily.reduce((highest, day) =>
        day.fuel_tonnes! > highest.fuel_tonnes! ? day : highest,
      )
    : null;
  const first = Date.parse(snapshot.start + "T00:00:00+09:00");
  const end = Date.parse(snapshot.end + "T00:00:00+09:00") + 86400000;
  return {
    total,
    average: total === null ? null : total / snapshot.horizon_days,
    peak,
    completeDays: daily.filter((day) => day.fuel_tonnes !== null).length,
    receipts: snapshot.inventory.groups.reduce(
      (value, group) => value + group.expected_receipts,
      0,
    ),
    outages: snapshot.outages.filter(
      (outage) =>
        Date.parse(outage.start_at) < end && Date.parse(outage.end_at) > first,
    ).length,
  };
}
