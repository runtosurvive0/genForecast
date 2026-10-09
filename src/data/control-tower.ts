import { BASE_TIME, plants, shipments } from "../domain/operations.ts";

/** Public-page POC contracts. Every record below is synthetic. */
export interface Stockpile {
  stockpile_id: string;
  plant_id: string;
  coal_type: string;
  on_hand_t: number;
  calorific_value_kcal_kg: number;
  moisture_pct: number;
  ash_pct: number;
  sulfur_pct: number;
  stacked_at: string;
  temperature_c: number | null;
  co_ppm: number | null;
  eligible_unit_ids: string[];
}
export interface Voyage {
  voyage_id: string;
  vessel_name: string;
  mmsi: string;
  imo: string;
  destination_plant_id: string;
  origin_port: string;
  destination_port: string;
  latitude: number;
  longitude: number;
  sog_kn: number;
  cog_deg: number;
  received_at: string;
  ais_eta: string;
  forecast_unload_end: string;
  remaining_distance_nm: number;
  cargo_t: number;
  coal_type: string;
  calorific_value_kcal_kg: number;
  moisture_pct: number;
  ash_pct: number;
  sulfur_pct: number;
  weather_delay_h: number;
  route_delay_h: number;
  expected_port_wait_h: number;
  allowed_laytime_h: number;
  demurrage_usd_per_day: number;
  voyage_status: "active" | "cancelled";
}
const day = 86400000;
export const stockpiles: Stockpile[] = plants.flatMap((p, pi) =>
  [0.4, 0.3, 0.2, 0.1].map((weight, i) => ({
    stockpile_id: `${p.id.toUpperCase().slice(0, 2)}-${String(i + 1).padStart(2, "0")}`,
    plant_id: p.id,
    coal_type: ["호주 역청탄", "인니 아역청탄", "호주 역청탄", "인니 저열량탄"][
      i
    ],
    on_hand_t: p.inventoryTons * weight,
    calorific_value_kcal_kg: p.calorificKcalKg + [300, -100, -250, -400][i],
    moisture_pct: [8.2, 18.4, 10.1, 24.2][i],
    ash_pct: [12.1, 5.5, 11.4, 4.2][i],
    sulfur_pct: [0.42, 0.21, 0.38, 0.18][i],
    stacked_at: new Date(
      Date.parse(BASE_TIME) - [7, 18, 35, 65][i] * day - pi * day,
    ).toISOString(),
    temperature_c: null,
    co_ppm: null,
    // Single-fuel boilers cannot take the low-calorific blending pile.
    eligible_unit_ids:
      i === 3
        ? p.units
            .filter((u) => u.capacityMw >= 1000)
            .map((u) => u.id)
        : p.units.map((u) => u.id),
  })),
);
const positions = [
  [36.99, 126.35],
  [25.4, 123.8],
  [4.8, 130.2],
  [8.9, 122.7],
];
export const voyages: Voyage[] = shipments.map((s, i) => ({
  voyage_id: s.id,
  vessel_name: s.vesselName,
  mmsi: `99900000${i + 1}`,
  imo: `DEMO-${i + 1}`,
  destination_plant_id: s.plantId,
  origin_port: s.origin,
  destination_port: plants[i].name + " 연료부두",
  latitude: positions[i][0],
  longitude: positions[i][1],
  sog_kn: [0, 11.8, 12.4, 10.9][i],
  cog_deg: [0, 18, 338, 21][i],
  received_at: new Date(
    Date.parse(BASE_TIME) - [4, 35, 180, 480][i] * 60000,
  ).toISOString(),
  ais_eta: new Date(
    Date.parse(s.arrivalAt) - [0, 4, 8, 12][i] * 3600000,
  ).toISOString(),
  forecast_unload_end: s.dischargeCompleteAt,
  remaining_distance_nm: [0, 560, 1980, 2700][i],
  cargo_t: s.tons,
  coal_type: i % 2 ? "인니 아역청탄" : "호주 역청탄",
  calorific_value_kcal_kg: [5900, 5400, 5800, 5200][i],
  moisture_pct: [8.5, 19.2, 9.1, 22.4][i],
  ash_pct: [11.2, 5.4, 10.8, 4.8][i],
  sulfur_pct: [0.4, 0.2, 0.35, 0.18][i],
  weather_delay_h: [0, 3, 6, 8][i],
  route_delay_h: [0, 1, 2, 4][i],
  expected_port_wait_h: [4, 8, 6, 12][i],
  allowed_laytime_h: 24,
  demurrage_usd_per_day: 18000,
  voyage_status: "active",
}));
