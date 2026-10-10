import type {
  TrackingVessel,
  TrackingVoyage,
} from "../../domain/vessel-workflow.ts";
import { shipments, type Shipment } from "../../domain/operations.ts";
import { validPosition, type Coordinate } from "./map-data.ts";
import type { MapPosition } from "./vessel-symbol.ts";

export interface MapVessel {
  id: string;
  plantId: string;
  vesselName: string;
  origin: string;
  status: string;
  source?: TrackingVessel["source"];
  tons?: number;
  arrivalAt?: string;
  dischargeCompleteAt?: string;
}
export interface NavigationRoute {
  id: string;
  vesselId?: string;
  selected: boolean;
  coordinates: Coordinate[];
  kind?: "sample" | "estimated" | "observed" | "connector";
}
export interface EstimatedRoute {
  kind: "estimated";
  provider: "searoute";
  destinationId: string;
  origin: Coordinate;
  coordinates: Coordinate[];
  distanceNm: number;
  startOffsetNm: number;
  endOffsetNm: number;
}
export interface TrackPoint {
  longitude: number;
  latitude: number;
  observedAt: string;
}
export interface TrackHistory {
  segments: TrackPoint[][];
  pointCount: number;
  truncated: boolean;
}

/** Connection guides never become observed tracks or change route-distance/ETA calculations. */
export function vesselNavigationRoutes(
  id: string,
  current: TrackPoint | null | undefined,
  estimate?: EstimatedRoute,
  history?: TrackHistory,
): NavigationRoute[] {
  const routes: NavigationRoute[] = [];
  if (estimate) {
    routes.push({
      id: `estimate-${id}`,
      vesselId: id,
      kind: "estimated",
      selected: true,
      coordinates: estimate.coordinates,
    });
    if (
      current &&
      seaDistance(
        [current.longitude, current.latitude],
        estimate.coordinates[0],
      ) > 1e-8
    ) {
      routes.push({
        id: `connection-${id}`,
        vesselId: id,
        kind: "connector",
        selected: true,
        coordinates: [
          [current.longitude, current.latitude],
          estimate.coordinates[0],
        ],
      });
    }
  }
  history?.segments.forEach((segment, index) => {
    const points = [...segment];
    const last = points.at(-1);
    if (index === history.segments.length - 1 && last && current) {
      const seconds =
        (Date.parse(current.observedAt) - Date.parse(last.observedAt)) / 1000;
      const distance = seaDistance(
        [last.longitude, last.latitude],
        [current.longitude, current.latitude],
      );
      // Append only an actual newer observation, using the server's gap/jump bounds.
      if (
        seconds > 0 &&
        seconds <= 6 * 3600 &&
        distance <= 1 + (seconds / 3600) * 60
      )
        points.push(current);
    }
    if (points.length >= 2)
      routes.push({
        id: `track-${id}-${index}`,
        vesselId: id,
        kind: "observed",
        selected: true,
        coordinates: points.map((point) => [point.longitude, point.latitude]),
      });
  });
  return routes;
}

export function mapFleet(
  rows: { vessel: TrackingVessel; voyage?: TrackingVoyage }[],
) {
  const items: MapVessel[] = [];
  const positions: MapPosition[] = [];
  for (const { vessel, voyage } of rows) {
    if (vessel.source === "demo") {
      const sample: Shipment | undefined = shipments.find(
        (s) =>
          s.id === vessel.legacyId &&
          s.plantId === voyage?.plantId &&
          s.origin === voyage?.origin,
      );
      if (
        !sample ||
        !voyage?.position ||
        !validPosition(voyage.position) ||
        voyage.state === "planned" ||
        voyage.state === "cancelled"
      )
        continue;
      items.push({ ...sample, source: "demo" });
      positions.push({
        vessel_id: sample.id,
        longitude: voyage.position.longitude,
        latitude: voyage.position.latitude,
        received_at: voyage.position.observedAt,
        cogDeg: voyage.position.cogDeg,
        sogKn: voyage.position.sogKn,
        navStatus:
          voyage.state === "arrived" || voyage.state === "stopped"
            ? 5
            : undefined,
      });
    } else {
      const position = vessel.ais?.position;
      if (
        !position ||
        !validPosition(position) ||
        !Number.isFinite(Date.parse(position.observedAt))
      )
        continue;
      items.push({
        id: vessel.id,
        plantId: voyage?.plantId ?? "",
        vesselName: vessel.name,
        origin: voyage?.origin ?? "출항항 미확인",
        status: "AIS 관측",
        source: vessel.source,
      });
      positions.push({
        vessel_id: vessel.id,
        longitude: position.longitude,
        latitude: position.latitude,
        received_at: position.observedAt,
        cogDeg: position.cogDeg,
        sogKn: position.sogKn,
        navStatus: vessel.ais?.navStatus,
      });
    }
  }
  return { items, positions };
}

const coordinate = (v: unknown): v is Coordinate =>
  Array.isArray(v) &&
  v.length === 2 &&
  validPosition({ longitude: v[0], latitude: v[1] });
export function decodeRoute(value: unknown): EstimatedRoute {
  const v = value as EstimatedRoute;
  if (
    !v ||
    v.kind !== "estimated" ||
    v.provider !== "searoute" ||
    typeof v.destinationId !== "string" ||
    !coordinate(v.origin) ||
    !Array.isArray(v.coordinates) ||
    v.coordinates.length < 2 ||
    v.coordinates.length > 20000 ||
    !v.coordinates.every(coordinate) ||
    ![v.distanceNm, v.startOffsetNm, v.endOffsetNm].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  )
    throw new Error("항로 응답 형식이 올바르지 않습니다.");
  return v;
}
export function decodeHistory(value: unknown): TrackHistory {
  const v = value as TrackHistory;
  if (
    !v ||
    !Array.isArray(v.segments) ||
    !Number.isInteger(v.pointCount) ||
    v.pointCount < 0 ||
    v.pointCount > 5000 ||
    v.segments.flat().length !== v.pointCount ||
    typeof v.truncated !== "boolean" ||
    !v.segments.every(
      (segment) =>
        Array.isArray(segment) &&
        segment.every(
          (p) =>
            p && validPosition(p) && Number.isFinite(Date.parse(p.observedAt)),
        ),
    )
  )
    throw new Error("항적 응답 형식이 올바르지 않습니다.");
  return v;
}
export function seaDistance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export async function navigationJson(
  path: string,
  signal: AbortSignal,
  init?: RequestInit,
) {
  const response = await fetch(`/api/vessels/${path}`, {
    ...init,
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok)
    throw new Error(`선박 항로 서버 연결 확인 필요 (${response.status})`);
  return response.json();
}
