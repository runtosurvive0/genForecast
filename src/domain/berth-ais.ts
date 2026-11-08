import type { TrackingVessel } from "./vessel-workflow.ts";

export type Dock = 1 | 2 | 3;
type Point = readonly [number, number];
// Approximate WGS84 water-side berth axes digitized from the Esri World Imagery
// 4326 export (126.495,37.043,126.535,37.075). The short eastern pier is BD-1.
const faces: Record<Dock, [Point, Point]> = {
  1: [
    [126.50996, 37.06532],
    [126.51272, 37.0644],
  ],
  2: [
    [126.5054, 37.0668],
    [126.50868, 37.06564],
  ],
  3: [
    [126.50212, 37.068],
    [126.5054, 37.0668],
  ],
};
export const docks = [1, 2, 3] as const;
function distance(lon: number, lat: number, [a, b]: [Point, Point]) {
  const east = 111320 * Math.cos((lat * Math.PI) / 180);
  const dx = (b[0] - a[0]) * east,
    dy = (b[1] - a[1]) * 111320;
  const x = (lon - a[0]) * east,
    y = (lat - a[1]) * 111320;
  const t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - t * dx, y - t * dy);
}
export function berthArea(lon: number, lat: number) {
  const ranked = docks
    .map((id) => ({ id, metres: distance(lon, lat, faces[id]) }))
    .sort((a, b) => a.metres - b.metres);
  if (ranked[0].metres > 90) return undefined;
  return ranked[1].metres - ranked[0].metres < 30 ? null : ranked[0].id;
}
export function berthObservation(vessel: TrackingVessel, now: number) {
  const ais = vessel.ais,
    p = ais?.position;
  if (vessel.source !== "aisstream" || !p || !ais) return null;
  const age = now - Date.parse(p.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 3600000) return null;
  const stale = age > 3600000;
  const berth = berthArea(p.longitude, p.latitude);
  if (berth === undefined) return null;
  // Known service craft and passing ships do not represent coal berth occupancy.
  if (ais.shipType !== null && (ais.shipType < 70 || ais.shipType > 79))
    return null;
  if (p.sogKn !== null && p.sogKn > 1) return null;
  const estimated =
    !stale && berth !== null &&
    (p.sogKn !== null || ais.navStatus === 5) &&
    ais.navStatus !== 1 &&
    ais.shipType !== null;
  return { vessel, berth, estimated, stale, observedAt: p.observedAt };
}
export type Observation = NonNullable<ReturnType<typeof berthObservation>>;
export type RegistryRow = Record<string, string | number | null>;
export type BerthRegistry = {
  ships: RegistryRow[];
  voyages: RegistryRow[];
  cargo: RegistryRow[];
};
export function matchCargo(
  vessel: TrackingVessel,
  registry: BerthRegistry | null,
) {
  if (!registry) return null;
  const ships = registry.ships.filter(
    (s) =>
      (s.mmsi && s.mmsi === vessel.mmsi) || (s.imo && s.imo === vessel.imo),
  );
  if (ships.length !== 1) return null;
  const ship = ships[0];
  if (
    (ship.imo && vessel.imo && ship.imo !== vessel.imo) ||
    (ship.mmsi && vessel.mmsi && ship.mmsi !== vessel.mmsi)
  )
    return null;
  const voyages = registry.voyages.filter(
    (v) =>
      v.ship_code === ship.ship_code &&
      v.classification !== "simulation" &&
      !["completed", "cancelled"].includes(String(v.status)) &&
      !v.actual_unload_end &&
      (registry.cargo.some(
        (c) =>
          c.voyage_no === v.voyage_no && c.destination_plant_id === "dangjin",
      ) ||
        /당진|dangjin/i.test(String(v.destination_port))),
  );
  const arrived = voyages.filter(
    (v) =>
      ["arrived", "berthed", "unloading"].includes(String(v.status)) ||
      v.actual_arrival ||
      v.actual_berth,
  );
  // A future charter for this same hull must not be attached to today's call.
  const observedAt = Date.parse(vessel.ais?.position?.observedAt ?? "");
  const relevant = arrived.length
    ? arrived
    : voyages.filter((v) => {
        const eta = Date.parse(
          String(v.planned_arrival ?? v.planned_berth ?? ""),
        );
        return (
          Number.isFinite(eta) && Math.abs(eta - observedAt) <= 72 * 3600000
        );
      });
  if (relevant.length !== 1) return null;
  const voyage = relevant[0];
  return {
    voyage,
    cargo: registry.cargo.filter(
      (c) =>
        c.voyage_no === voyage.voyage_no &&
        c.destination_plant_id === "dangjin",
    ),
  };
}
