import {
  BASE_TIME,
  plants,
  simulate,
  type Plant,
  type Scenario,
  type Forecast,
} from "./operations.ts";
import {
  stockpiles,
  voyages,
  type Stockpile,
  type Voyage,
} from "../data/control-tower.ts";
import { fitModels, type ModelRuns } from "./models.ts";
const DAY = 86400000,
  HOUR = 3600000,
  base = Date.parse(BASE_TIME);
export function weightedCalorific(rows: { tons: number; cv: number }[]) {
  const tons = rows.reduce((s, r) => s + r.tons, 0);
  return tons > 0 ? rows.reduce((s, r) => s + r.tons * r.cv, 0) / tons : null;
}
export const plantInputs: Plant[] = plants.map((p) => {
  const piles = stockpiles.filter((x) => x.plant_id === p.id);
  return {
    ...p,
    lowStockDays: 20,
    inventoryTons: piles.reduce((s, x) => s + x.on_hand_t, 0),
    calorificKcalKg:
      weightedCalorific(
        piles.map((x) => ({
          tons: x.on_hand_t,
          cv: x.calorific_value_kcal_kg,
        })),
      ) ?? p.calorificKcalKg,
  };
});
export function incomingVoyages(
  rows: Voyage[],
  plantIds: string[],
  days: number,
  delayDays = 0,
) {
  return rows.filter(
    (v) =>
      v.voyage_status !== "cancelled" &&
      plantIds.includes(v.destination_plant_id) &&
      Date.parse(v.forecast_unload_end) + delayDays * DAY >= base &&
      Date.parse(v.forecast_unload_end) + delayDays * DAY <= base + days * DAY,
  );
}
export function fuelFromGeneration(
  generationMwh: number,
  heatRate: number,
  hhv: number,
) {
  if (
    ![generationMwh, heatRate, hhv].every(Number.isFinite) ||
    generationMwh < 0 ||
    heatRate <= 0 ||
    hhv <= 0
  )
    throw new RangeError("Invalid generation / heat rate / HHV");
  return (generationMwh * heatRate) / hhv;
}
export const inventoryStatus = (days: number | null) =>
  days === null
    ? "소비 없음"
    : days >= 30
      ? "안정"
      : days >= 20
        ? "주의"
        : "위험";
export function freshness(receivedAt: string, now = Date.now()) {
  const minutes = (now - Date.parse(receivedAt)) / 60000;
  return !Number.isFinite(minutes) || minutes < 0
    ? "STALE"
    : minutes <= 10
      ? "LIVE"
      : minutes <= 60
        ? "RECENT"
        : minutes <= 360
          ? "ESTIMATED"
          : "STALE";
}
export function pileRisk(pile: Stockpile) {
  const age = Math.max(
    0,
    Math.floor((base - Date.parse(pile.stacked_at)) / DAY),
  );
  const score = Math.min(
    100,
    Math.round(age * 1.1 + (pile.coal_type.includes("인니") ? 15 : 5)),
  );
  return {
    age,
    score,
    source: "SIMULATED" as const,
    label: score >= 70 ? "높음" : score >= 40 ? "관찰" : "낮음",
  };
}
export function voyageTiming(v: Voyage, scenarioDelayDays = 0) {
  const eta =
    Date.parse(v.ais_eta) +
    (v.weather_delay_h + v.route_delay_h + scenarioDelayDays * 24) * HOUR;
  return {
    eta: new Date(eta).toISOString(),
    berth: new Date(eta + v.expected_port_wait_h * HOUR).toISOString(),
    unload: new Date(
      Date.parse(v.forecast_unload_end) + scenarioDelayDays * DAY,
    ).toISOString(),
    demurrageUsd:
      (Math.max(0, v.expected_port_wait_h - v.allowed_laytime_h) / 24) *
      v.demurrage_usd_per_day,
  };
}
export const defaultModels = fitModels();
export function generationProfile(inputPlants: Plant[], models: ModelRuns) {
  return Object.fromEntries(
    inputPlants.flatMap((p) =>
      p.units.map((u) => [
        u.id,
        models.demand.predictions.map((d, i) =>
          Math.min(
            u.capacityMw,
            ((u.capacityMw * u.loadPct) / 100) *
              (d / models.demand.reference) *
              (models.capacity.predictions[i] / models.capacity.reference),
          ),
        ),
      ]),
    ),
  );
}
export function towerSummary(
  inputPlants: Plant[],
  scenario: Scenario,
  days: number,
  models = defaultModels,
) {
  const profile = generationProfile(inputPlants, models);
  const cargo = voyages
    .filter((v) => v.voyage_status !== "cancelled")
    .map((v) => ({
      id: v.voyage_id,
      plantId: v.destination_plant_id,
      vesselName: v.vessel_name,
      origin: v.origin_port,
      tons: v.cargo_t,
      arrivalAt: voyageTiming(v).eta,
      dischargeCompleteAt: v.forecast_unload_end,
      status: "항해 중" as const,
    }));
  const extended = simulate(inputPlants, cargo, scenario, days + 7, profile);
  const visibleForecast = simulate(inputPlants, cargo, scenario, days, profile);
  // Daily windows start at 09:00 KST; coverage uses the FOLLOWING seven demand days.
  const extendedDaily = extended.daily.map((original, i) => {
    const d = visibleForecast.daily[i] ?? original;
    const forward = extended.daily.slice(i + 1, i + 8);
    const use = forward.reduce((s, x) => s + x.requestedFuelTons, 0) / 7;
    return {
      date: d.date,
      stock: d.stockTons,
      inbound: d.inboundTons,
      fuel: d.fuelUseTons,
      requestedFuel: d.requestedFuelTons,
      inventoryDays: forward.length === 7 && use > 0 ? d.stockTons / use : null,
    };
  });
  const cutoff = base + days * DAY;
  const trimTime = (time: string | null) =>
    time && Date.parse(time) < cutoff ? time : null;
  const forecast: Forecast = {
    ...visibleForecast,
    horizonDays: days,
    daily: visibleForecast.daily,
    firstShortageAt: trimTime(extended.firstShortageAt),
    firstLowStockAt: trimTime(extended.firstLowStockAt),
    byPlant: visibleForecast.byPlant.map((p) => ({
      ...p,
      daily: p.daily.slice(0, days),
      endingStockTons: p.daily[days - 1]?.stockTons ?? p.inventoryTons,
      productionGwh: p.daily
        .slice(0, days)
        .reduce((s, d) => s + d.productionGwh, 0),
      firstShortageAt: trimTime(p.firstShortageAt),
      firstLowStockAt: trimTime(p.firstLowStockAt),
    })),
  };
  const incoming = scenario.includeInbound
    ? incomingVoyages(
        voyages,
        inputPlants.map((p) => p.id),
        days,
        scenario.arrivalDelayDays,
      )
    : [];
  const units = inputPlants.flatMap((p) =>
    p.units.map((u) => {
      const stopped = (time: number) =>
        u.outages.some(
          (o) => time >= Date.parse(o.startAt) && time < Date.parse(o.endAt),
        );
      let energy = 0,
        availableHours = 0;
      for (let h = 0; h < 168; h++)
        if (!stopped(base + h * HOUR)) {
          availableHours++;
          energy += Math.min(
            u.capacityMw,
            profile[u.id][Math.floor(h / 24)] *
              (1 + scenario.loadChangePct / 100),
          );
        }
      return {
        id: u.id,
        name: u.name,
        plantId: p.id,
        capacity: u.capacityMw,
        currentUtilization: stopped(base) ? 0 : u.loadPct,
        futureUtilization: availableHours
          ? Math.max(0, (energy / (u.capacityMw * availableHours)) * 100)
          : 0,
        availableHours,
        forecastGenerationMwh: energy,
        currentGenerationMw: stopped(base)
          ? 0
          : (u.capacityMw * u.loadPct) / 100,
        forecastFuelTons: fuelFromGeneration(
          energy,
          1 / (0.001163 * p.efficiency),
          p.calorificKcalKg,
        ),
      };
    }),
  );
  const currentStock = inputPlants.reduce((s, p) => s + p.inventoryTons, 0);
  // Observed output is independent of future model/scenario assumptions.
  forecast.currentOutputMw = units.reduce(
    (sum, unit) => sum + unit.currentGenerationMw,
    0,
  );
  for (const plant of forecast.byPlant) {
    plant.currentOutputMw = units
      .filter((unit) => unit.plantId === plant.plantId)
      .reduce((sum, unit) => sum + unit.currentGenerationMw, 0);
    plant.dailyConsumptionTons = plant.daily[0]?.requestedFuelTons ?? 0;
    plant.coverageDays =
      plant.dailyConsumptionTons > 0
        ? plant.inventoryTons / plant.dailyConsumptionTons
        : null;
  }
  const dailyFuel = extendedDaily[0]?.requestedFuel ?? 0;
  const daily = extendedDaily.slice(0, days);
  const minimum = daily
    .filter((d) => d.inventoryDays !== null)
    .reduce<(typeof daily)[number] | null>(
      (min, d) => (!min || d.inventoryDays! < min.inventoryDays! ? d : min),
      null,
    );
  return {
    forecast,
    daily,
    extendedDaily,
    units,
    currentStock,
    dailyFuel,
    coverageDays: dailyFuel > 0 ? currentStock / dailyFuel : null,
    incomingTons: incoming.reduce((s, v) => s + v.cargo_t, 0),
    incomingCv: weightedCalorific(
      incoming.map((v) => ({ tons: v.cargo_t, cv: v.calorific_value_kcal_kg })),
    ),
    currentCv: weightedCalorific(
      inputPlants.map((p) => ({
        tons: p.inventoryTons,
        cv: p.calorificKcalKg,
      })),
    ),
    currentUtilization: units.length
      ? units.reduce((s, u) => s + u.currentUtilization, 0) / units.length
      : 0,
    futureUtilization: units.length
      ? units.reduce((s, u) => s + u.futureUtilization, 0) / units.length
      : 0,
    minimum,
  };
}
export type TowerSummary = ReturnType<typeof towerSummary>;
