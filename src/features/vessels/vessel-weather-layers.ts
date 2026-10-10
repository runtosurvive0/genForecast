import type { FeatureCollection, Polygon, Geometry } from "geojson";
import { validPosition, unwrapRoute } from "./map-data.ts";
import type { ForecastPoint } from "./vessel-weather.ts";

export type WeatherMetric = "wave" | "wind" | "visibility";
export interface CyclonePoint {
  longitude: number;
  latitude: number;
  at: string;
  forecast: boolean;
  radii34Nm: (number | null)[];
}
export interface Cyclone {
  id: string;
  name: string;
  source: string;
  advisoryAt: string;
  reportUrl: string;
  points: CyclonePoint[];
}
export interface CycloneSnapshot {
  status: "ready" | "partial" | "stale" | "unavailable";
  fetchedAt: string | null;
  reason: string;
  storms: Cyclone[];
}
export interface WeatherOverlay {
  points: ForecastPoint[];
  index: number;
  metric: WeatherMetric;
  storms: Cyclone[];
  now: number;
  onSelectPoint: (index: number) => void;
}
const HOUR = 3600000;
const rad = Math.PI / 180;
const date = (s: unknown) =>
  typeof s === "string" && Number.isFinite(Date.parse(s));
export function decodeCyclones(value: unknown): CycloneSnapshot {
  const d = value as CycloneSnapshot;
  if (
    !d ||
    !["ready", "partial", "stale", "unavailable"].includes(d.status) ||
    !(d.fetchedAt === null || date(d.fetchedAt)) ||
    typeof d.reason !== "string" ||
    !Array.isArray(d.storms) ||
    d.storms.length > 16
  )
    throw new Error("태풍 응답 형식 오류");
  for (const s of d.storms) {
    if (
      !s ||
      !date(s.advisoryAt) ||
      typeof s.name !== "string" ||
      typeof s.source !== "string" ||
      typeof s.id !== "string" ||
      !/^https:\/\/www\.gdacs\.org\/report\.aspx\?/.test(s.reportUrl) ||
      !Array.isArray(s.points) ||
      s.points.length > 1000
    )
      throw new Error("태풍 출처·기준시각 오류");
    for (const [i, p] of s.points.entries()) {
      if (
        !validPosition(p) ||
        !date(p.at) ||
        typeof p.forecast !== "boolean" ||
        (i > 0 && Date.parse(p.at) <= Date.parse(s.points[i - 1].at)) ||
        !Array.isArray(p.radii34Nm) ||
        p.radii34Nm.length !== 4 ||
        p.radii34Nm.some(
          (v) =>
            v !== null &&
            (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000),
        )
      )
        throw new Error("태풍 좌표·풍속 반경 오류");
    }
  }
  return d;
}
export function cycloneAt(storm: Cyclone, at: number) {
  const nearest = storm.points.reduce<CyclonePoint | undefined>(
    (a, b) =>
      !a || Math.abs(Date.parse(b.at) - at) < Math.abs(Date.parse(a.at) - at)
        ? b
        : a,
    undefined,
  );
  // Never extrapolate beyond provider coverage or slide an old storm into the present.
  if (
    !nearest ||
    at < Date.parse(storm.points[0].at) ||
    at > Date.parse(storm.points.at(-1)!.at) ||
    Math.abs(Date.parse(nearest.at) - at) > 3 * HOUR
  )
    return undefined;
  return nearest;
}
function distanceNm(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
) {
  const x =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}
export function nearbyCyclones(
  storms: Cyclone[],
  points: ForecastPoint[],
  now: number,
) {
  return storms.filter(
    (s) =>
      now - Date.parse(s.advisoryAt) >= 0 &&
      now - Date.parse(s.advisoryAt) <= 24 * HOUR &&
      points.some((p) => {
        if (Date.parse(p.passageAt) < now - HOUR) return false;
        const center = cycloneAt(s, Date.parse(p.passageAt));
        // Candidate context only; this radius is not drawn as a danger zone.
        return (
          center &&
          distanceNm(center, p) <=
            Math.max(300, ...center.radii34Nm.map((r) => (r ?? 0) + 100))
        );
      }),
  );
}
export function windFootprints(p: CyclonePoint): Polygon[] {
  const lat = p.latitude * rad,
    lon = p.longitude * rad;
  return p.radii34Nm.flatMap((radius, quadrant) => {
    if (radius === null || radius <= 0) return [];
    const d = radius / 3440.065;
    const coords: [number, number][] = [[p.longitude, p.latitude]];
    for (let step = 0; step <= 18; step++) {
      const angle = (quadrant * 90 + step * 5) * rad;
      const nextLat = Math.asin(
        Math.sin(lat) * Math.cos(d) +
          Math.cos(lat) * Math.sin(d) * Math.cos(angle),
      );
      const nextLon =
        lon +
        Math.atan2(
          Math.sin(angle) * Math.sin(d) * Math.cos(lat),
          Math.cos(d) - Math.sin(lat) * Math.sin(nextLat),
        );
      coords.push([nextLon / rad, nextLat / rad]);
    }
    coords.push([p.longitude, p.latitude]);
    return [{ type: "Polygon", coordinates: [unwrapRoute(coords)] }];
  });
}
export function weatherAttention(
  p: ForecastPoint,
  metric: WeatherMetric,
  now: number,
) {
  const kind = metric === "wave" ? "marine" : "air";
  const at = p[`${kind}ForecastAt`],
    fetched = p[`${kind}FetchedAt`];
  const value = metricValue(p, metric);
  if (
    value == null ||
    p[`${kind}Status`] !== "fresh" ||
    !at ||
    !fetched ||
    now - Date.parse(fetched) < 0 ||
    now - Date.parse(fetched) > 3 * HOUR ||
    Math.abs(Date.parse(at) - Date.parse(p.passageAt)) > HOUR / 2
  )
    return "unknown";
  return (
    metric === "wave"
      ? value >= 3
      : metric === "wind"
        ? value >= 25
        : value < 1000
  )
    ? "attention"
    : "normal";
}
export function metricValue(p: ForecastPoint, metric: WeatherMetric) {
  return metric === "wave"
    ? p.waveM
    : metric === "wind"
      ? p.windKn
      : p.visibilityM;
}
export function metricText(p: ForecastPoint, metric: WeatherMetric) {
  const v = metricValue(p, metric);
  return v == null
    ? "자료 없음"
    : metric === "visibility"
      ? v < 1000
        ? `${Math.round(v)} m`
        : `${(v / 1000).toFixed(1)} km`
      : `${v.toFixed(1)} ${metric === "wave" ? "m" : "kn"}`;
}
export function overlayFeatures(
  overlay: WeatherOverlay,
): FeatureCollection<Geometry> {
  const features: FeatureCollection<Geometry>["features"] = [];
  const passage =
    overlay.points[Math.min(overlay.index, overlay.points.length - 1)];
  if (!passage) return { type: "FeatureCollection", features };
  features.push({
    type: "Feature",
    properties: { kind: "passage" },
    geometry: {
      type: "Point",
      coordinates: [passage.longitude, passage.latitude],
    },
  });
  for (const storm of overlay.storms) {
    const coords = storm.points
      .filter((p) => Date.parse(p.at) >= Date.parse(storm.advisoryAt))
      .map((p) => [p.longitude, p.latitude] as [number, number]);
    if (coords.length > 1)
      features.push({
        type: "Feature",
        properties: { kind: "cyclone-track", name: storm.name },
        geometry: { type: "LineString", coordinates: unwrapRoute(coords) },
      });
    const center = cycloneAt(storm, Date.parse(passage.passageAt));
    if (center)
      for (const geometry of windFootprints(center))
        features.push({
          type: "Feature",
          properties: { kind: "wind34", name: storm.name, at: center.at },
          geometry,
        });
  }
  return { type: "FeatureCollection", features };
}
