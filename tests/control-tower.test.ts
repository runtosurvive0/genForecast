import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_TIME, scenarioDefaults } from "../src/domain/operations.ts";
import { stockpiles, voyages } from "../src/data/control-tower.ts";
import {
  plantInputs,
  weightedCalorific,
  incomingVoyages,
  fuelFromGeneration,
  inventoryStatus,
  freshness,
  pileRisk,
  voyageTiming,
  towerSummary,
} from "../src/domain/control-tower.ts";
import { fitModels, errorMetrics } from "../src/domain/models.ts";
import { decodeAisstreamPosition } from "../src/domain/ais.ts";

test("current output is a fixed observed value across model retraining and scenario changes", () => {
  const a = towerSummary([plantInputs[0]], scenarioDefaults, 30, fitModels(30));
  const b = towerSummary(
    [plantInputs[0]],
    { ...scenarioDefaults, loadChangePct: 15 },
    30,
    fitModels(300),
  );
  assert.equal(a.forecast.currentOutputMw, 1260);
  assert.equal(b.forecast.currentOutputMw, 1260);
  assert.equal(
    a.forecast.byPlant[0].currentOutputMw,
    a.units.reduce((s, u) => s + u.currentGenerationMw, 0),
  );
  assert.equal(a.forecast.byPlant[0].coverageDays, a.coverageDays);
  assert.notEqual(a.dailyFuel, b.dailyFuel);
});

test("pile totals and weighted quality are the plant inventory source", () => {
  for (const plant of plantInputs) {
    const piles = stockpiles.filter((p) => p.plant_id === plant.id);
    assert.equal(
      piles.reduce((s, p) => s + p.on_hand_t, 0),
      plant.inventoryTons,
    );
    assert.equal(
      weightedCalorific(
        piles.map((p) => ({
          tons: p.on_hand_t,
          cv: p.calorific_value_kcal_kg,
        })),
      ),
      plant.calorificKcalKg,
    );
  }
  assert.equal(
    plantInputs.reduce((s, p) => s + p.inventoryTons, 0),
    538000,
  );
  assert.equal(
    weightedCalorific([
      { tons: 100, cv: 5000 },
      { tons: 300, cv: 6000 },
    ]),
    5750,
  );
  assert.equal(weightedCalorific([]), null);
});

test("AIS decoder rejects unavailable coordinates and never treats missing speed as zero", () => {
  const frame = {
    MessageType: "PositionReport",
    MetaData: { MMSI: 440123456, Latitude: 14.2, Longitude: 124.7 },
    Message: { PositionReport: { Valid: true, Sog: 102.3, Cog: 360 } },
  };
  const decoded = decodeAisstreamPosition(frame, BASE_TIME)!;
  assert.equal(decoded.latitude, 14.2);
  assert.equal(decoded.sog_kn, null);
  assert.equal(decoded.cog_deg, null);
  assert.equal(
    decodeAisstreamPosition(
      { ...frame, MetaData: { ...frame.MetaData, Latitude: 91 } },
      BASE_TIME,
    ),
    null,
  );
  assert.equal(
    decodeAisstreamPosition(
      { MessageType: "SubscriptionConfirmation" },
      BASE_TIME,
    ),
    null,
  );
});
test("discharge exactly at the horizon reconciles incoming KPI and final inventory", () => {
  const input = { ...voyages[0] };
  const old = voyages[0].forecast_unload_end;
  try {
    voyages[0].forecast_unload_end = new Date(
      Date.parse(BASE_TIME) + 30 * 86400000,
    ).toISOString();
    const summary = towerSummary([plantInputs[0]], scenarioDefaults, 30);
    assert.equal(summary.incomingTons, 80000);
    assert.equal(summary.daily.at(-1)!.inbound, 80000);
    assert.equal(
      summary.forecast.daily.reduce((s, d) => s + d.inboundTons, 0),
      80000,
    );
    const previous = summary.daily.at(-2)!.stock;
    assert.ok(
      Math.abs(
        summary.daily.at(-1)!.stock -
          (previous + 80000 - summary.daily.at(-1)!.fuel),
      ) < 1e-6,
    );
  } finally {
    voyages[0].forecast_unload_end = old;
  }
});
test("changing fitted models changes generation and inventory; a 90-day forecast has seven lookahead days", () => {
  const a = towerSummary(plantInputs, scenarioDefaults, 90, fitModels(30));
  const b = towerSummary(plantInputs, scenarioDefaults, 90, fitModels(300));
  assert.notEqual(a.daily[0].fuel, b.daily[0].fuel);
  assert.equal(b.extendedDaily.length, 97);
  assert.ok(b.daily.every((d) => d.inventoryDays !== null));
});
test("incoming cargo includes discharge at horizon, excludes cancellation and late discharge", () => {
  const first = voyages[0];
  const end = new Date(Date.parse(BASE_TIME) + 30 * 86400000).toISOString();
  const inputs = [
    { ...first, forecast_unload_end: end },
    { ...first, voyage_status: "cancelled" as const },
    {
      ...first,
      forecast_unload_end: new Date(Date.parse(end) + 1).toISOString(),
    },
  ];
  assert.equal(
    incomingVoyages(inputs, [first.destination_plant_id], 30, 0).length,
    1,
  );
  assert.equal(
    incomingVoyages(inputs, [first.destination_plant_id], 30, 1).length,
    0,
  );
});
test("SPEC heat-rate conversion and inventory alert boundaries", () => {
  assert.equal(fuelFromGeneration(10000, 2200, 5500), 4000);
  assert.equal(inventoryStatus(30), "안정");
  assert.equal(inventoryStatus(20), "주의");
  assert.equal(inventoryStatus(19.9), "위험");
  assert.equal(inventoryStatus(null), "소비 없음");
  assert.throws(() => fuelFromGeneration(100, 2200, 0));
});
test("AIS freshness handles precise cutoffs, invalid and future timestamps safely", () => {
  const now = Date.parse(BASE_TIME);
  const at = (minutes: number) => new Date(now - minutes * 60000).toISOString();
  assert.equal(freshness(at(10), now), "LIVE");
  assert.equal(freshness(at(10.01), now), "RECENT");
  assert.equal(freshness(at(60), now), "RECENT");
  assert.equal(freshness(at(60.01), now), "ESTIMATED");
  assert.equal(freshness(at(360), now), "ESTIMATED");
  assert.equal(freshness(at(360.01), now), "STALE");
  assert.equal(freshness("invalid", now), "STALE");
  assert.equal(freshness(at(-1), now), "STALE");
});
test("sensor-free pile risk is simulated, bounded and increases with age", () => {
  const pile = stockpiles[0];
  const fresh = pileRisk({ ...pile, stacked_at: BASE_TIME });
  const old = pileRisk({ ...pile, stacked_at: "2026-07-01T09:00:00+09:00" });
  assert.equal(fresh.source, "SIMULATED");
  assert.ok(old.score > fresh.score && old.score <= 100);
  assert.equal(pile.temperature_c, null);
  assert.equal(pile.co_ppm, null);
});
test("ETA adds weather and route once; berth wait and demurrage remain separate", () => {
  const v = {
    ...voyages[2],
    weather_delay_h: 4,
    route_delay_h: 2,
    expected_port_wait_h: 30,
    allowed_laytime_h: 24,
    demurrage_usd_per_day: 12000,
  };
  const timing = voyageTiming(v, 1);
  assert.equal(Date.parse(timing.eta) - Date.parse(v.ais_eta), 30 * 3600000);
  assert.equal(Date.parse(timing.berth) - Date.parse(timing.eta), 30 * 3600000);
  assert.equal(timing.demurrageUsd, 3000);
});
test("model metrics are calculated and synthetic fitting yields finite holdout predictions", () => {
  const metrics = errorMetrics([10, 20], [12, 18]);
  assert.equal(metrics.mae, 2);
  assert.equal(metrics.rmse, 2);
  assert.ok(Math.abs(metrics.mape - 15) < 1e-10);
  const models = fitModels();
  for (const model of [models.demand, models.capacity]) {
    assert.equal(model.predictions.length, 97);
    assert.ok(model.losses.at(-1)!.train < model.losses[0].train);
    assert.ok(model.predictions.every((x) => Number.isFinite(x) && x >= 0));
    assert.ok(model.metrics.rmse >= model.metrics.mae);
  }
});
test("summary scopes cargo and piles, links model generation to fuel and uses forward seven days", () => {
  const models = fitModels();
  const normal = towerSummary([plantInputs[0]], scenarioDefaults, 30, models);
  const changed = towerSummary(
    [plantInputs[0]],
    { ...scenarioDefaults, loadChangePct: 15, arrivalDelayDays: 3 },
    30,
    models,
  );
  assert.equal(normal.currentStock, 180000);
  assert.equal(normal.incomingTons, 80000);
  assert.equal(normal.forecast.daily.length, 30);
  assert.ok(changed.daily[0].requestedFuel > normal.daily[0].requestedFuel);
  assert.ok(changed.daily[0].stock < normal.daily[0].stock);
  const next7 =
    normal.extendedDaily.slice(1, 8).reduce((s, d) => s + d.requestedFuel, 0) /
    7;
  assert.ok(
    Math.abs(normal.daily[0].inventoryDays! - normal.daily[0].stock / next7) <
      1e-8,
  );
  assert.ok(
    normal.units.every(
      (u) => u.futureUtilization >= 0 && u.futureUtilization <= 100,
    ),
  );
  for (let i = 0; i < normal.daily.length; i++) {
    const previous = i ? normal.daily[i - 1].stock : normal.currentStock;
    assert.ok(
      Math.abs(
        normal.daily[i].stock -
          (previous + normal.daily[i].inbound - normal.daily[i].fuel),
      ) < 1e-6,
    );
  }
});
