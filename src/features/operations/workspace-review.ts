import { BerthRoutes } from '../../data/fuel-reference/berth-routes.js';
import type { FuelDemoCatalog, FuelDemoSnapshot, FuelDemoStatus } from '../../domain/fuel-demo/types.ts';

export function reviewRouteSignals(status: FuelDemoStatus, snapshot: FuelDemoSnapshot | null,
  catalog: FuelDemoCatalog | null, berth: number | null, endpoint: string) {
  const route = catalog?.routes.find(item => item.berth === berth)?.endpoints.find(item => item.id === endpoint);
  if (status !== 'online' || snapshot?.source !== 'demo' || !route?.assets.length)
    return { state: 'unavailable' as const, signals: [] };
  const signals = route.assets.map(id => {
    const equipment = snapshot.equipment[id];
    const known = equipment && ['running', 'stopped', 'fault'].includes(equipment.status);
    return { id, name: catalog?.equipment?.find(item => item.id === id)?.code ?? id,
      status: known ? equipment.status : 'unknown',
      flow: known && Number.isFinite(equipment.flow) && equipment.flow >= 0 ? equipment.flow : null };
  });
  return { state: 'connected' as const, signals, playing: snapshot.playing };
}

/** Display aggregation only; incomplete periods must not appear as complete totals. */
export const completeTotal = (
  values: readonly (number | null)[],
  expected: number,
): number | null =>
  expected > 0 &&
  values.length === expected &&
  values.every((value) => value !== null && Number.isFinite(value))
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
export interface ReviewRow {
  day: string;
  stock: number | null;
  days: number | null;
}
export interface ReceiptAssumptions {
  start: string;
  arrival: string;
  quantity: number | null;
  capacity: number | null;
  leadDays: number | null;
  storageDays: number | null;
}
const dayMillis = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null;
};
const plusDays = (value: number, days: number) =>
  new Date(value + days * 86400000).toISOString().slice(0, 10);

export interface PileReceiptAssumptions {
  berth: number | null;
  endpoint: string;
  arrival: string;
  quantity: number | null;
  capacity: number | null;
  projectedStock: number | null;
  storageDays: number | null;
  useStart: string;
  dailyUse: number | null;
}

/** Compares entered assumptions; route connectivity is not an equipment availability signal. */
export function reviewPileReceipt(input: PileReceiptAssumptions) {
  const knownEndpoint = BerthRoutes.endpoint(input.endpoint);
  const route = !knownEndpoint || ![1, 2, 3].includes(input.berth ?? 0)
    ? 'unknown' : BerthRoutes.canReach(input.berth!, input.endpoint) ? 'reachable' : 'blocked';
  const nonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  const quantity = nonnegative(input.quantity) && input.quantity > 0 ? input.quantity : null;
  const capacity = nonnegative(input.capacity) && input.capacity > 0 ? input.capacity : null;
  const stock = nonnegative(input.projectedStock) ? input.projectedStock : null;
  const headroom = capacity !== null && stock !== null ? Math.max(0, capacity - stock) : null;
  const space = quantity === null || headroom === null ? 'unknown'
    : stock! + quantity <= capacity! ? 'sufficient' : 'insufficient';
  const arrival = dayMillis(input.arrival);
  const useStart = dayMillis(input.useStart);
  const storageDays = input.storageDays !== null && Number.isInteger(input.storageDays) && input.storageDays >= 0 && input.storageDays <= 3650 ? input.storageDays : null;
  const storageEnd = arrival !== null && storageDays !== null ? plusDays(arrival, storageDays) : null;
  const rate = nonnegative(input.dailyUse) ? input.dailyUse : null;
  const days = arrival === null || useStart === null || storageDays === null ? null
    : Math.max(0, Math.floor((arrival + storageDays * 86400000 - Math.max(arrival + 86400000, useStart)) / 86400000) + 1);
  const plannedUse = quantity !== null && rate !== null && days !== null ? Math.min(quantity, rate * days) : null;
  const remaining = quantity !== null && plannedUse !== null ? Math.max(0, quantity - plannedUse) : null;
  const usage = remaining === null ? 'unknown' : remaining <= 1e-8 ? 'complete' : 'insufficient';
  return { route, space, usage, headroom, storageEnd, days, plannedUse, remaining };
}
/** Compares a proposed receipt with unchanged server stock. It does not project or allocate inventory. */
export function reviewReceipt(
  rows: readonly ReviewRow[],
  input: ReceiptAssumptions,
) {
  const start = dayMillis(input.start),
    arrival = dayMillis(input.arrival);
  const nonnegative = (value: number | null) =>
    value === null || (Number.isFinite(value) && value >= 0);
  const wholeDays = (value: number | null) =>
    value === null || (Number.isInteger(value) && value >= 0 && value <= 3650);
  const valid =
    start !== null &&
    arrival !== null &&
    nonnegative(input.quantity) &&
    (input.capacity === null ||
      (Number.isFinite(input.capacity) && input.capacity > 0)) &&
    wholeDays(input.leadDays) &&
    wholeDays(input.storageDays);
  const rawStock = valid
    ? rows.find((row) => row.day === input.arrival)?.stock
    : null;
  const stock =
    typeof rawStock === "number" && Number.isFinite(rawStock) ? rawStock : null;
  const headroom =
    stock !== null && stock >= 0 && input.capacity !== null
      ? input.capacity - stock
      : null;
  const earliestArrival =
    valid && input.leadDays !== null ? plusDays(start!, input.leadDays) : null;
  const storageEnd =
    valid && input.storageDays !== null
      ? plusDays(arrival!, input.storageDays)
      : null;
  const byDay = new Map(rows.map((row) => [row.day, row]));
  let firstAvailable: string | null = null;
  let spaceStatus: 'missing-input' | 'outside-horizon' | 'incomplete' | 'not-found' | 'found' = 'missing-input';
  if (valid && earliestArrival && input.capacity !== null && input.quantity !== null && input.quantity > 0) {
    const dates = rows.map(row => dayMillis(row.day)).filter((day): day is number => day !== null);
    const horizonEnd = dates.length ? Math.max(...dates) : null;
    const first = dayMillis(earliestArrival)!;
    if (horizonEnd === null || first > horizonEnd) spaceStatus = 'outside-horizon';
    else {
      spaceStatus = 'not-found';
      for (let day = first; day <= horizonEnd; day += 86400000) {
        const date = plusDays(day, 0), row = byDay.get(date);
        if (!row || row.stock === null || !Number.isFinite(row.stock) || row.stock < 0) { spaceStatus = 'incomplete'; break; }
        if (input.capacity - row.stock >= input.quantity) { firstAvailable = date; spaceStatus = 'found'; break; }
      }
    }
  }
  const storageWindowCovered =
    storageEnd === null
      ? null
      : Array.from({ length: input.storageDays! + 1 }, (_, index) =>
          byDay.get(plusDays(arrival!, index)),
        ).every(
          (row) =>
            row?.stock !== null &&
            typeof row?.stock === "number" &&
            Number.isFinite(row.stock),
        );
  return {
    valid,
    stock,
    headroom,
    earliestArrival,
    storageEnd,
    storageWindowCovered,
    firstAvailable,
    spaceStatus,
    overCapacity:
      headroom === null || input.quantity === null
        ? null
        : input.quantity > headroom,
    tooEarly: earliestArrival === null ? null : input.arrival < earliestArrival,
    shortage: stock !== null && stock < 0,
  };
}
