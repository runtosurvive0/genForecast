import test from "node:test";
import assert from "node:assert/strict";
import {
  availableEnergyGwh,
  simulate,
  plants,
  shipments,
  scenarioDefaults,
  BASE_TIME,
} from "../src/domain/operations.ts";
import type { Plant, Shipment } from "../src/domain/operations.ts";

// At 1,000 kcal/kg and 100% efficiency, one tonne yields 1.163 MWh.
// A 1,163 MW unit therefore consumes exactly 1,000 tonnes per hour.
const fixture = (inventoryTons = 100_000): Plant => ({
  id: "test",
  name: "검증 발전소",
  region: "검증",
  inventoryTons,
  calorificKcalKg: 1000,
  efficiency: 1,
  lowStockDays: 1,
  units: [
    { id: "u1", name: "1호기", capacityMw: 1163, loadPct: 100, outages: [] },
  ],
});
const inbound: Shipment = {
  id: "s1",
  plantId: "test",
  vesselName: "검증선",
  origin: "검증항",
  tons: 24_000,
  arrivalAt: "2026-10-06T10:00:00+09:00",
  dischargeCompleteAt: "2026-10-06T20:00:00+09:00",
  status: "입항 예정",
};
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

test("converts tonnes and kcal/kg into electrical GWh, including efficiency", () => {
  const plant = fixture(1000);
  near(availableEnergyGwh(plant), 1.163);
  near(availableEnergyGwh({ ...plant, efficiency: 0.4 }), 0.4652);
});

test("caps actual output at fuel available and never creates negative stock", () => {
  const result = simulate([fixture(12_000)], [], scenarioDefaults, 1);
  near(result.daily[0].productionGwh, 13.956);
  near(result.daily[0].demandGwh, 27.912);
  near(result.daily[0].stockTons, 0);
  assert.equal(result.firstShortageAt, "2026-10-06T21:00:00+09:00");
  assert.equal(result.firstLowStockAt, BASE_TIME);
});

test("zero fuel gives zero current output and an immediate predicted shortage", () => {
  const result = simulate([fixture(0)], [], scenarioDefaults, 1);
  assert.equal(result.currentOutputMw, 0);
  assert.equal(result.firstShortageAt, BASE_TIME);
  near(result.daily[0].productionGwh, 0);
});

test("zero load leaves stock unchanged without inventing shortage dates", () => {
  const result = simulate(
    [fixture(0)],
    [],
    { ...scenarioDefaults, loadChangePct: -100 },
    1,
  );
  assert.equal(result.firstShortageAt, null);
  assert.equal(result.firstLowStockAt, null);
  assert.equal(result.byPlant[0].coverageDays, null);
  near(result.daily[0].productionGwh, 0);
});

test("maintenance is inclusive at start, exclusive at end, and consumes no fuel", () => {
  const plant = fixture();
  plant.units[0].outages = [
    {
      id: "o1",
      title: "계획정지",
      reason: "검증",
      startAt: BASE_TIME,
      endAt: "2026-10-06T15:00:00+09:00",
    },
  ];
  const result = simulate([plant], [], scenarioDefaults, 1);
  assert.equal(result.currentOutputMw, 0);
  near(result.daily[0].productionGwh, 20.934);
  near(result.daily[0].stockTons, 82_000);
  assert.equal(result.firstShortageAt, null);
  plant.units[0].outages[0].endAt = BASE_TIME;
  near(
    simulate([plant], [], scenarioDefaults, 1).daily[0].productionGwh,
    27.912,
  );
});

test("future maintenance starts at its boundary and stops consumption until restart", () => {
  const plant = fixture();
  plant.units[0].outages = [
    {
      id: "o1",
      title: "계획정지",
      reason: "검증",
      startAt: "2026-10-06T15:00:00+09:00",
      endAt: "2026-10-06T21:00:00+09:00",
    },
  ];
  near(simulate([plant], [], scenarioDefaults, 1).daily[0].stockTons, 82_000);
});

test("empty stock during maintenance predicts shortage only when generation restarts", () => {
  const plant = fixture(0);
  plant.units[0].outages = [
    {
      id: "o1",
      title: "계획정지",
      reason: "검증",
      startAt: BASE_TIME,
      endAt: "2026-10-06T15:00:00+09:00",
    },
  ];
  assert.equal(
    simulate([plant], [], scenarioDefaults, 1).firstShortageAt,
    "2026-10-06T15:00:00+09:00",
  );
});

test("credits inbound only at discharge completion, never at arrival", () => {
  const afterHorizon = {
    ...inbound,
    dischargeCompleteAt: "2026-10-07T09:00:01+09:00",
  };
  const result = simulate(
    [fixture(12_000)],
    [afterHorizon],
    scenarioDefaults,
    1,
  );
  near(result.daily[0].inboundTons, 0);
  assert.equal(result.firstShortageAt, "2026-10-06T21:00:00+09:00");
  const completed = simulate([fixture(12_000)], [inbound], scenarioDefaults, 1);
  assert.equal(completed.firstShortageAt, null);
  near(completed.daily[0].inboundTons, 24_000);
  near(completed.daily[0].stockTons, 12_000);
});

test("delaying or excluding inbound exposes a shortage that punctual inbound avoids", () => {
  assert.equal(
    simulate([fixture(12_000)], [inbound], scenarioDefaults, 1).firstShortageAt,
    null,
  );
  for (const scenario of [
    { ...scenarioDefaults, arrivalDelayDays: 1 },
    { ...scenarioDefaults, includeInbound: false },
  ]) {
    assert.equal(
      simulate([fixture(12_000)], [inbound], scenario, 1).firstShortageAt,
      "2026-10-06T21:00:00+09:00",
    );
  }
});

test("inventory belongs to its plant and cannot cover another plant shortage", () => {
  const loaded = { ...fixture(), id: "loaded" };
  const empty = { ...fixture(0), id: "empty" };
  const result = simulate([loaded, empty], [], scenarioDefaults, 1);
  assert.equal(result.byPlant[1].firstShortageAt, BASE_TIME);
  near(result.daily[0].productionGwh, 27.912);
});

test("a shipment resumes generation after exhaustion without erasing the shortage", () => {
  const late = {
    ...inbound,
    tons: 3000,
    dischargeCompleteAt: "2026-10-06T23:00:00+09:00",
  };
  const result = simulate([fixture(12_000)], [late], scenarioDefaults, 1);
  assert.equal(result.firstShortageAt, "2026-10-06T21:00:00+09:00");
  near(result.daily[0].productionGwh, 17.445);
  near(result.daily[0].stockTons, 0);
});

test("sub-hour discharge events apply at their precise completion time", () => {
  const subHour = {
    ...inbound,
    tons: 500,
    dischargeCompleteAt: "2026-10-06T09:30:00+09:00",
  };
  const result = simulate([fixture(500)], [subHour], scenarioDefaults, 1);
  assert.equal(result.firstShortageAt, "2026-10-06T10:00:00+09:00");
  near(result.daily[0].productionGwh, 1.163);
});

test("increased load cannot exceed unit nameplate capacity", () => {
  const result = simulate(
    [fixture()],
    [],
    { ...scenarioDefaults, loadChangePct: 100 },
    1,
  );
  near(result.currentOutputMw, 1163);
  near(result.daily[0].demandGwh, 27.912);
});

test("an empty fleet is finite and reports no shortage", () => {
  const result = simulate([], [], scenarioDefaults, 1);
  assert.equal(result.firstShortageAt, null);
  assert.deepEqual(result.daily, [
    {
      date: "2026-10-06",
      stockTons: 0,
      productionGwh: 0,
      demandGwh: 0,
      inboundTons: 0,
      fuelUseTons: 0,
      requestedFuelTons: 0,
    },
  ]);
});

test("rejects nonfinite scenarios and invalid fuel conversion instead of emitting NaN", () => {
  assert.throws(
    () =>
      simulate(
        [fixture()],
        [],
        { ...scenarioDefaults, arrivalDelayDays: NaN },
        1,
      ),
    RangeError,
  );
  assert.throws(
    () => simulate([fixture()], [], scenarioDefaults, Infinity),
    RangeError,
  );
  assert.throws(
    () => availableEnergyGwh({ ...fixture(), efficiency: 0 }),
    RangeError,
  );
});

test("sample forecasts are deterministic, finite and do not mutate their inputs", () => {
  const before = JSON.stringify({ plants, shipments, scenarioDefaults });
  const first = simulate(plants, shipments, scenarioDefaults, 30);
  assert.deepEqual(first, simulate(plants, shipments, scenarioDefaults, 30));
  assert.equal(JSON.stringify({ plants, shipments, scenarioDefaults }), before);
  assert.equal(first.daily.length, 30);
  const checkFinite = (value: unknown): void => {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
    else if (value && typeof value === "object")
      Object.values(value).forEach(checkFinite);
  };
  checkFinite(first);
  first.daily.forEach((day) => assert.ok(day.stockTons >= 0));
  assert.ok(first.firstShortageAt);
});
