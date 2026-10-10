import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDiscoveredVessels, fetchVesselCatalog } from "../src/features/vessels/vessel-discovery.ts";

test("discovery accepts 20000 vessels and rejects an over-capacity response", async () => {
  const original = globalThis.fetch;
  const at = "2026-10-10T00:00:00Z";
  let count = 20000;
  globalThis.fetch = async () => new Response(JSON.stringify({
    provider: "aisstream", status: "receiving", coverage: "global", fetchedAt: at, capacity: 20000,
    vessels: Array.from({ length: count }, (_, i) => ({
      id: `ais-${440000000 + i}`, name: `TEST ${i}`, mmsi: String(440000000 + i), imo: "", source: "aisstream",
      ais: { updatedAt: at, destination: "DANGJIN", shipType: 70, navStatus: 0, position: null },
    })),
  }));
  try {
    const snapshot = await fetchVesselCatalog();
    assert.equal(snapshot.vessels.length, 20000);
    assert.equal(snapshot.vessels[19999].mmsi, "440019999");
    count = 20001;
    await assert.rejects(fetchVesselCatalog);
  } finally {
    globalThis.fetch = original;
  }
});

test("discovery rejects invalid retained candidate provenance and oversized candidate lists", async () => {
  const original = globalThis.fetch;
  const at = "2026-10-10T00:00:00Z";
  const vessel = { id: "ais-440123456", name: "TEST", mmsi: "440123456", imo: "", source: "aisstream",
    ais: { updatedAt: at, destination: "DANGJIN", shipType: 70, navStatus: 0, position: null } };
  const entry = { vessel, portCode: "KRTJI", portName: "당진", matchedBy: "name", destinationObservedAt: at };
  let entries: unknown[] = [entry];
  globalThis.fetch = async () => new Response(JSON.stringify({ provider: "aisstream", status: "receiving", coverage: "global", fetchedAt: at, lastReceivedAt: at, capacity: 4000, vessels: [], koreaCandidates: { capacity: 1000, retentionHours: 72, entries } }));
  try {
    const snapshot = await fetchVesselCatalog();
    assert.equal(snapshot.koreaCandidates?.entries[0].vessel.mmsi, "440123456");
    entries = [{ ...entry, vessel: { ...vessel, source: "digitraffic" } }];
    await assert.rejects(fetchVesselCatalog);
    entries = Array.from({ length: 1001 }, () => entry);
    await assert.rejects(fetchVesselCatalog);
    entries = [{ ...entry, destinationObservedAt: "invalid" }];
    await assert.rejects(fetchVesselCatalog);
  } finally {
    globalThis.fetch = original;
  }
});
import {
  estimateArrival,
  parseWorkspace,
  registerVessel,
  mergeWorkspace,
  type TrackingVoyage,
  type VesselWorkspace,
} from "../src/domain/vessel-workflow.ts";

const etaVoyage: TrackingVoyage = {
  id: "voy-1",
  vesselId: "v-1",
  plantId: "dangjin",
  origin: "Newcastle",
  destination: "당진 연료부두",
  state: "underway",
  etd: null,
  plannedEta: "2026-10-10T00:00:00Z",
  distanceNm: 120,
  plannedSpeedKn: 12,
  position: {
    latitude: 35,
    longitude: 125,
    observedAt: "2026-10-09T00:00:00Z",
    sogKn: 10,
    cogDeg: 20,
  },
  portWaitH: 4,
  unloadH: 24,
  cargoT: 80000,
  cv: 5500,
};
const emptyWorkspace: VesselWorkspace = {
  version: 1,
  watchlist: [],
  vessels: [],
  voyages: [],
};

test("AIS destination filtering is independent of current location and ship name", () => {
  const base = {
    id: "overseas",
    name: "AUSTRALIA CARGO",
    imo: "",
    mmsi: "440123451",
    source: "aisstream" as const,
    ais: {
      updatedAt: "2026-10-09T00:00:00Z",
      shipType: 70,
      navStatus: 0,
      destination: "DANGJIN",
      position: {
        latitude: -33,
        longitude: 152,
        observedAt: "2026-10-09T00:00:00Z",
        sogKn: 10,
        cogDeg: 0,
      },
    },
  };
  const local = {
    ...base,
    id: "local",
    name: "DANGJIN STAR",
    ais: {
      ...base.ais,
      destination: "SINGAPORE",
      position: { ...base.ais.position, latitude: 35, longitude: 126 },
    },
  };
  const unknown = {
    ...base,
    id: "unknown",
    ais: { ...base.ais, destination: "" },
  };
  const filter = (options: {
    destination?: string;
    destinationStatus?: string;
  }) =>
    filterDiscoveredVessels(
      [base, local, unknown],
      "",
      "all",
      "all",
      "all",
      "name",
      Date.now(),
      options,
    ).map((v) => v.id);
  assert.deepEqual(filter({ destination: "dangjin" }), ["overseas"]);
  assert.deepEqual(filter({ destinationStatus: "missing" }), ["unknown"]);
  assert.equal(filter({ destinationStatus: "received" }).length, 2);
});

test("AIS discovery filters actual observations and keeps unknown speed last", () => {
  const now = Date.parse("2026-10-09T01:00:00Z");
  const base = {
    id: "a",
    name: "ALPHA",
    imo: "",
    mmsi: "440123456",
    source: "aisstream" as const,
    ais: {
      updatedAt: "2026-10-09T01:00:00Z",
      shipType: 70,
      navStatus: 0,
      destination: "DANGJIN",
      position: {
        latitude: 35,
        longitude: 125,
        observedAt: "2026-10-09T00:55:00Z",
        sogKn: 9,
        cogDeg: 90,
      },
    },
  };
  const metadataOnly = {
    ...base,
    id: "b",
    name: "BETA",
    mmsi: "440123457",
    ais: { ...base.ais, position: null },
  };
  const stale = {
    ...base,
    id: "c",
    name: "GAMMA",
    mmsi: "440123458",
    ais: {
      ...base.ais,
      position: {
        ...base.ais.position,
        observedAt: "2026-10-08T00:00:00Z",
        sogKn: 15,
      },
    },
  };
  const rows = [metadataOnly, base, stale];
  assert.deepEqual(
    filterDiscoveredVessels(
      rows,
      "dangjin",
      "7",
      "underway",
      "10",
      "recent",
      now,
    ).map((v) => v.id),
    ["a"],
  );
  assert.deepEqual(
    filterDiscoveredVessels(rows, "", "all", "all", "all", "speed", now).map(
      (v) => v.id,
    ),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    rows.map((v) => v.id),
    ["b", "a", "c"],
  );
  assert.equal(
    filterDiscoveredVessels(rows, "", "8", "all", "all", "name", now).length,
    0,
  );
});

test("AIS search registration retains provenance and observations without inventing a voyage", () => {
  const vessel = {
    id: "ais-440123456",
    name: "TEST CARGO",
    imo: "1234567",
    mmsi: "440123456",
    source: "aisstream" as const,
    ais: {
      updatedAt: "2026-10-09T00:00:00Z",
      shipType: 70,
      navStatus: 0,
      destination: "DANGJIN",
      position: {
        latitude: 35,
        longitude: 125,
        observedAt: "2026-10-09T00:00:00Z",
        sogKn: 11,
        cogDeg: 90,
      },
    },
  };
  const workspace = registerVessel(emptyWorkspace, vessel, []);
  const restored = parseWorkspace(JSON.stringify(workspace));
  assert.equal(restored.vessels[0].source, "aisstream");
  assert.equal(restored.vessels[0].ais?.position?.sogKn, 11);
  assert.equal(restored.voyages.length, 0);
  assert.throws(() =>
    parseWorkspace(
      JSON.stringify({
        ...workspace,
        vessels: [
          {
            ...vessel,
            ais: {
              ...vessel.ais,
              position: { ...vessel.ais.position, latitude: 91 },
            },
          },
        ],
      }),
    ),
  );
  const updated = registerVessel(
    restored,
    {
      ...vessel,
      ais: {
        ...vessel.ais,
        updatedAt: "2026-10-09T00:10:00Z",
        position: {
          ...vessel.ais.position,
          observedAt: "2026-10-09T00:10:00Z",
          sogKn: 12,
        },
      },
    },
    [],
  );
  assert.equal(updated.watchlist.length, 1);
  assert.equal(updated.vessels[0].ais?.position?.sogKn, 12);
});

test("untrusted workspace records cannot claim a demo map identity", () => {
  const parsed = parseWorkspace(
    JSON.stringify({
      ...emptyWorkspace,
      vessels: [
        {
          id: "other",
          name: "Other Vessel",
          imo: "7654321",
          mmsi: "",
          source: "manual",
          legacyId: "ship-br",
        },
      ],
    }),
  );
  assert.equal(parsed.vessels[0].legacyId, undefined);
});
test("identifier bridges enrich canonical records across imports and registration", () => {
  const a = {
    id: "a",
    name: "A",
    imo: "",
    mmsi: "440123456",
    source: "manual" as const,
  };
  const b = { ...a, id: "b", imo: "1234567" };
  const c = { ...a, id: "c", imo: "1234567", mmsi: "" };
  const current = { ...emptyWorkspace, vessels: [a], watchlist: ["a"] };
  const imported = mergeWorkspace(
    current,
    { ...emptyWorkspace, vessels: [b, c], watchlist: ["b", "c"] },
    [],
  );
  assert.deepEqual(imported.watchlist, ["a"]);
  assert.equal(imported.vessels.length, 1);
  assert.equal(imported.vessels[0].imo, "1234567");
  const registered = registerVessel(registerVessel(current, b, []), c, []);
  assert.deepEqual(registered.watchlist, ["a"]);
  assert.equal(registered.vessels[0].imo, "1234567");
});
test("date boundaries cannot persist a render-crashing ETA", () => {
  const extreme = {
    ...etaVoyage,
    state: "arrived" as const,
    actualArrivalAt: "+275760-09-13T00:00:00.000Z",
    portWaitH: 1,
  };
  assert.doesNotThrow(() => estimateArrival(extreme));
  assert.throws(() =>
    parseWorkspace(JSON.stringify({ ...emptyWorkspace, voyages: [extreme] })),
  );
});

test("route ETA is anchored to observation; berth and unloading are distinct", () => {
  const estimate = estimateArrival(etaVoyage);
  assert.equal(estimate.eta, "2026-10-09T12:00:00.000Z");
  assert.equal(estimate.berth, "2026-10-09T16:00:00.000Z");
  assert.equal(estimate.unload, "2026-10-10T16:00:00.000Z");
  assert.equal(estimate.deltaH, -12);
  assert.deepEqual(estimateArrival(etaVoyage), estimate);
});
test("planned voyages use ETD and planned speed, never the stationary SOG", () => {
  const result = estimateArrival({
    ...etaVoyage,
    state: "planned",
    etd: "2026-10-11T00:00:00Z",
    position: { ...etaVoyage.position!, sogKn: 0 },
  });
  assert.equal(result.eta, "2026-10-11T10:00:00.000Z");
  assert.equal(result.method, "planned");
});
test("unknown, stopped, cancelled and malformed inputs do not invent arrival times", () => {
  for (const change of [
    { state: "stopped" as const },
    { state: "cancelled" as const },
    { position: null },
    { distanceNm: null },
    { distanceNm: -1 },
    { position: { ...etaVoyage.position!, sogKn: 0 } },
    { position: { ...etaVoyage.position!, sogKn: 102.3 } },
    { position: { ...etaVoyage.position!, observedAt: "bad" } },
  ])
    assert.equal(estimateArrival({ ...etaVoyage, ...change }).eta, null);
  assert.equal(estimateArrival({ ...etaVoyage, portWaitH: null }).berth, null);
  assert.equal(estimateArrival({ ...etaVoyage, unloadH: null }).unload, null);
});
test("workspace import validates nested records and preserves an intentionally empty list", () => {
  assert.deepEqual(
    parseWorkspace(JSON.stringify(emptyWorkspace)),
    emptyWorkspace,
  );
  for (const value of [
    "bad",
    "null",
    JSON.stringify({ ...emptyWorkspace, version: 2 }),
    JSON.stringify({
      ...emptyWorkspace,
      voyages: [{ ...etaVoyage, cargoT: -5 }],
    }),
    JSON.stringify({ ...emptyWorkspace, watchlist: [4] }),
  ]) {
    assert.throws(() => parseWorkspace(value));
  }
});
test("registration matches identifiers without merging unrelated namesakes", () => {
  const known = {
    id: "v-1",
    name: "Same Name",
    imo: "1234567",
    mmsi: "440123456",
    source: "manual" as const,
  };
  const duplicate = registerVessel(
    emptyWorkspace,
    { ...known, id: "another", name: "Renamed" },
    [known],
  );
  assert.deepEqual(duplicate.watchlist, ["v-1"]);
  assert.equal(duplicate.vessels.length, 0);
  const namesake = registerVessel(
    duplicate,
    { ...known, id: "v-2", imo: "7654321", mmsi: "440999999" },
    [known],
  );
  assert.deepEqual(namesake.watchlist, ["v-1", "v-2"]);
  assert.equal(namesake.vessels.length, 1);
});
test("workspace merge remaps imported identities, retains current edits and adds no duplicate interest", () => {
  const known = {
    id: "v-1",
    name: "A",
    imo: "1234567",
    mmsi: "440123456",
    source: "manual" as const,
  };
  const current = {
    ...emptyWorkspace,
    watchlist: ["v-1"],
    voyages: [etaVoyage],
  };
  const incoming = {
    ...emptyWorkspace,
    watchlist: ["other"],
    vessels: [{ ...known, id: "other" }],
    voyages: [
      { ...etaVoyage, id: "another-voy", vesselId: "other", cargoT: 50000 },
    ],
  };
  const result = mergeWorkspace(current, incoming, [known]);
  assert.deepEqual(result.watchlist, ["v-1"]);
  assert.equal(result.voyages[0].cargoT, 80000);
  assert.equal(result.voyages.length, 1);
});
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
