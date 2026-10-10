import { voyages } from "./control-tower.ts";
import { BASE_TIME } from "../domain/operations.ts";
import type {
  TrackingVessel,
  TrackingVoyage,
  WeatherPoint,
} from "../domain/vessel-workflow.ts";

/** Entire catalog and forecast below are synthetic, including all identifiers. */
export const vesselCatalog: TrackingVessel[] = [
  ...voyages.map((v) => ({
    id: `vessel-${v.voyage_id}`,
    name: v.vessel_name,
    imo: v.imo,
    mmsi: v.mmsi,
    source: "demo" as const,
    legacyId: v.voyage_id,
  })),
  {
    id: "demo-aurora",
    name: "Aurora Bulk",
    imo: "DEMO-5",
    mmsi: "999000005",
    source: "demo",
  },
  {
    id: "demo-meridian",
    name: "Meridian Coal",
    imo: "DEMO-6",
    mmsi: "999000006",
    source: "demo",
  },
];
export const trackingVoyages: TrackingVoyage[] = [
  ...voyages.map((v, i) => ({
    id: `tracking-${v.voyage_id}`,
    vesselId: `vessel-${v.voyage_id}`,
    plantId: v.destination_plant_id,
    origin: v.origin_port,
    destination: v.destination_port,
    state: i === 0 ? ("arrived" as const) : ("underway" as const),
    etd: null,
    plannedEta: v.ais_eta,
    distanceNm: v.remaining_distance_nm,
    plannedSpeedKn: 12,
    position: {
      latitude: v.latitude,
      longitude: v.longitude,
      observedAt: v.received_at,
      sogKn: v.sog_kn,
      cogDeg: v.cog_deg,
    },
    actualArrivalAt: i === 0 ? v.ais_eta : null,
    portWaitH: v.expected_port_wait_h,
    unloadH: 24,
    cargoT: v.cargo_t,
    cv: v.calorific_value_kcal_kg,
  })),
  {
    id: "tracking-aurora",
    vesselId: "demo-aurora",
    plantId: "dangjin",
    origin: "Newcastle",
    destination: "당진 연료부두",
    state: "planned",
    etd: "2026-10-07T09:00:00+09:00",
    plannedEta: "2026-10-20T09:00:00+09:00",
    distanceNm: 3600,
    plannedSpeedKn: 12,
    position: null,
    portWaitH: 8,
    unloadH: 24,
    cargoT: 75000,
    cv: 5700,
  },
  {
    id: "tracking-meridian",
    vesselId: "demo-meridian",
    plantId: "boryeong",
    origin: "Samarinda",
    destination: "보령 연료부두",
    state: "underway",
    etd: null,
    plannedEta: null,
    distanceNm: null,
    plannedSpeedKn: null,
    position: null,
    portWaitH: null,
    unloadH: null,
    cargoT: 65000,
    cv: 5400,
  },
];
export const initialWatchlist = vesselCatalog.slice(0, 4).map((v) => v.id);
export const sampleWeatherBase = BASE_TIME;
export const sampleWeatherEndH = 48;
const weatherCoordinates: Record<string, [number, number][]> = {
  "ship-br": [
    [123.8, 27],
    [123.8, 29],
    [124, 34],
  ],
  "ship-hd": [
    [129, 8],
    [129, 14],
    [130, 23],
  ],
  "ship-dh": [
    [121, 11],
    [119, 16],
    [120, 20],
  ],
};
// Scenario frames, not observations and not a forecast-provider adapter.
export function sampleWeather(
  legacyId: string | undefined,
  hour: number,
): WeatherPoint[] {
  if (
    !legacyId ||
    !weatherCoordinates[legacyId] ||
    hour < 0 ||
    hour > sampleWeatherEndH
  )
    return [];
  return weatherCoordinates[legacyId].map(([longitude, latitude], i) => ({
    id: `${legacyId}-weather-${i}`,
    longitude,
    latitude,
    at: new Date(Date.parse(BASE_TIME) + hour * 3600000).toISOString(),
    waveM: [1.2, 3.4, 2.1][i] + Math.round(hour / 12) * 0.1,
    windKn: [12, 26, 18][i] + Math.round(hour / 12),
    label: `구간 ${i + 1}`,
  }));
}
