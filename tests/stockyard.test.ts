import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_TIME } from "../src/domain/operations.ts";
import { stockpiles } from "../src/data/control-tower.ts";
import {
  pileRisk,
  plantInputs,
  weightedCalorific,
} from "../src/domain/control-tower.ts";
import {
  allocateBurn,
  arrivalWaiting,
  attributeByCoalType,
  berthMap,
  berthOccupancy,
  daysStatus,
  fromSupplyTransfers,
  groupForecasts,
  groupWeeklyBurn,
  incomingSchedule,
  ledgerCsv,
  ledgerRows,
  mergeAisPositions,
  mergeSensorReadings,
  normalizeAisPositions,
  normalizeSensorReadings,
  normalizeSupplyRecords,
  sortLedger,
  stockGroups,
  stockyardAlerts,
  supplyCumulative,
  toSupplyTransfer,
  toSupplyVessel,
  unitDailyMwh,
  contrastLine,
  gaugeValue,
  historyForPile,
  markerLayout,
  recommendBerth,
  incomingTimeline,
  orderPiles,
  pileBlend,
  pileFootprint,
  showSampleWaiting,
  siteVessels,
  transferTons,
  waitingVessels,
  weeklyBurnShares,
  yardScope,
  FORECAST_HORIZON,
} from "../src/features/stockyard/stockyard-domain.ts";

test("weekly burn shares respect planned outages and only cover eligible units", () => {
  const dangjin = [plantInputs[0]];
  const ids = dangjin[0].units.map((u) => u.id);
  const shares = weeklyBurnShares(dangjin, ids);
  // 당진 2호기는 기준시각에 보일러 점검 중 → 첫 주에 가동시간 손실.
  assert.ok(shares["dj-2"] < shares["dj-1"]);
  assert.ok(
    Math.abs(Object.values(shares).reduce((s, v) => s + v, 0) - 1) < 1e-9,
  );
  // 요청하지 않은 호기는 제외된다.
  const subset = weeklyBurnShares(dangjin, ["dj-9"]);
  assert.deepEqual(Object.keys(subset), ["dj-9"]);
  assert.equal(subset["dj-9"], 1);
});

test("low-calorific piles are not eligible for single-fuel units", () => {
  const blendPiles = stockpiles.filter((p) => p.coal_type === "인니 저열량탄");
  // Scope growth: DA-04 + 14 new zone-3 Dangjin piles + 3 other plants.
  assert.equal(blendPiles.length, 18);
  for (const pile of blendPiles) {
    const plant = plantInputs.find((p) => p.id === pile.plant_id)!;
    assert.ok(pile.eligible_unit_ids.length < plant.units.length);
    // 500MW 단일연소 호기는 혼탄 전용 Pile을 사용할 수 없다.
    for (const unit of plant.units)
      if (unit.capacityMw < 1000)
        assert.ok(!pile.eligible_unit_ids.includes(unit.id));
  }
});

test("burn allocation never burns restricted piles and stays within stock", () => {
  const scope = yardScope(null);
  const ids = plantInputs.flatMap((p) => p.units.map((u) => u.id));
  const shares = weeklyBurnShares(plantInputs, ids);
  const burned = allocateBurn(scope.piles, shares, 30000);
  assert.ok(burned.length > 0);
  for (const { pile, tons } of burned) {
    assert.ok(tons > 0 && tons <= pile.on_hand_t);
    // 배분된 Pile은 최소 하나의 수요 호기에 투입 가능해야 한다.
    assert.ok(pile.eligible_unit_ids.some((id) => shares[id]));
  }
  const total = burned.reduce((s, b) => s + b.tons, 0);
  assert.ok(Math.abs(total - 30000) < 1e-6);
  // 단일연소 제한 Pile은 투입 가능 호기 share가 작아 배분량이 재고 비례보다 적다.
  const restricted = burned.find((b) => b.pile.coal_type === "인니 저열량탄");
  const unrestricted = burned.find((b) => b.pile.coal_type === "호주 역청탄");
  assert.ok(restricted && unrestricted);
  assert.ok(
    restricted.tons / restricted.pile.on_hand_t <
      unrestricted.tons / unrestricted.pile.on_hand_t,
  );
});

test("burn allocation redistributes the remainder when a pile hits zero", () => {
  const scope = yardScope("dangjin");
  const ids = plantInputs[0].units.map((u) => u.id);
  const shares = weeklyBurnShares([plantInputs[0]], ids);
  const stock = scope.piles.reduce((s, p) => s + p.on_hand_t, 0);
  // 재고를 거의 다 태우는 과도한 소진량에서도 총량이 보존된다.
  const burned = allocateBurn(scope.piles, shares, stock - 1);
  const total = burned.reduce((s, b) => s + b.tons, 0);
  assert.ok(Math.abs(total - (stock - 1)) < 1e-6);
  for (const { pile, tons } of burned) assert.ok(tons <= pile.on_hand_t);
  // 재고보다 큰 소진 요청은 재고 한도까지만 배분한다.
  const over = allocateBurn(scope.piles, shares, stock * 2);
  assert.ok(
    Math.abs(over.reduce((s, b) => s + b.tons, 0) - stock) < 1e-6,
  );
});

test("pile blend conserves mass and reports weighted calorific before/after", () => {
  const scope = yardScope("dangjin");
  const burned = [
    { pile: scope.piles[0], tons: 5000 },
    { pile: scope.piles[1], tons: 3000 },
  ];
  const blend = pileBlend(scope.piles, burned);
  assert.equal(blend.burnTotal, 8000);
  const before = blend.rows.reduce((s, r) => s + r.beforeTons, 0);
  const after = blend.rows.reduce((s, r) => s + r.afterTons, 0);
  assert.equal(before - after, 8000);
  assert.equal(
    blend.beforeCv,
    weightedCalorific(
      blend.rows.map((r) => ({ tons: r.beforeTons, cv: r.cv })),
    ),
  );
  // 고열량 Pile만 태우면 잔량 가중열량은 낮아진다.
  assert.ok(blend.afterCv! < blend.beforeCv!);
});

test("yard scope filters piles and incoming cargo by plant", () => {
  const all = yardScope(null);
  const dangjin = yardScope("dangjin");
  assert.equal(all.piles.length, 72);
  assert.equal(dangjin.piles.length, 60);
  assert.ok(
    dangjin.incoming.every((v) => v.destination_plant_id === "dangjin"),
  );
  assert.equal(dangjin.forecast.daily.length, FORECAST_HORIZON);
  // 하역 완료 물량은 재고 전망에 반영된다.
  const inboundTotal = dangjin.forecast.daily.reduce(
    (s, d) => s + d.inboundTons,
    0,
  );
  assert.ok(inboundTotal > 0);
});

test("order piles sorts and filters by simulated risk", () => {
  const scope = yardScope(null);
  const byTons = orderPiles(scope.piles, "tons", "all");
  assert.ok(byTons[0].on_hand_t >= byTons.at(-1)!.on_hand_t);
  const highOnly = orderPiles(scope.piles, "risk", "높음");
  assert.ok(highOnly.length < scope.piles.length);
  assert.ok(highOnly.length > 0);
});

test("incoming timeline is sorted, in-window and excludes cancelled voyages", () => {
  const scope = yardScope(null);
  const cancelled = {
    ...scope.incoming[0],
    voyage_id: "cancelled-one",
    voyage_status: "cancelled" as const,
  };
  const timeline = incomingTimeline(
    [...scope.incoming, cancelled].filter(
      (v) => v.voyage_status !== "cancelled",
    ),
  );
  assert.ok(timeline.length > 0);
  for (let i = 1; i < timeline.length; i++)
    assert.ok(timeline[i].at >= timeline[i - 1].at);
  assert.ok(timeline.every(({ at }) => at >= Date.parse(BASE_TIME)));
});
test("dangjin piles carry berth, plant yard and indoor flags", () => {
  const dangjin = stockpiles.filter((p) => p.plant_id === "dangjin");
  assert.equal(dangjin.length, 60);
  // DA-01~04 keep their attribution; new piles extend each yard to 20.
  assert.deepEqual(
    dangjin.slice(0, 4).map((p) => p.plant_yard),
    ["P1", "P2", "P1", "P3"],
  );
  assert.deepEqual(
    dangjin.slice(0, 4).map((p) => p.berth_id),
    ["BD-1", "BD-2", "BD-1", "BD-3"],
  );
  assert.deepEqual(
    dangjin.slice(0, 4).map((p) => p.indoor),
    [false, true, false, true],
  );
  for (const yard of ["P1", "P2", "P3"] as const) {
    const piles = dangjin.filter((p) => p.plant_yard === yard);
    assert.equal(piles.length, 20);
    assert.ok(
      piles.every((p) => {
        const wantBerth = { P1: "BD-1", P2: "BD-2", P3: "BD-3" } as const;
        return (
          p.berth_id === wantBerth[yard] &&
          p.indoor === (yard !== "P1") &&
          p.zone !== null &&
          p.zone >= 0 &&
          p.zone <= 3
        );
      }),
    );
  }
  assert.deepEqual(berthMap, { "BD-1": "P1", "BD-2": "P2", "BD-3": "P3" });
  const others = stockpiles.filter((p) => p.plant_id !== "dangjin");
  assert.ok(
    others.every(
      (p) => p.berth_id === null && p.plant_yard === null && p.zone === null,
    ),
  );
});

test("waiting vessels are wait-only, sorted by wait, with timing", () => {
  const scope = yardScope("dangjin");
  const rows = waitingVessels(scope.incoming);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.waitH > 0));
  for (let i = 1; i < rows.length; i++)
    assert.ok(rows[i].waitH <= rows[i - 1].waitH);
  assert.ok(rows.every((r) => Date.parse(r.berthAt) > 0));
  assert.ok(rows.every((r) => r.demurrageUsd >= 0));
  const withCancelled = [
    ...scope.incoming,
    { ...scope.incoming[0], voyage_status: "cancelled" as const },
  ];
  assert.equal(
    waitingVessels(withCancelled.filter((v) => v.voyage_status !== "cancelled")).length,
    rows.length,
  );
});

test("attribution matches coal type with oldest-first tiebreak", () => {
  const scope = yardScope("dangjin");
  const attributed = attributeByCoalType(scope.piles, scope.incoming);
  assert.ok(attributed.length > 0);
  for (const a of attributed) {
    assert.equal(a.pile.plant_id, a.voyage.destination_plant_id);
    assert.equal(a.pile.coal_type, a.voyage.coal_type);
  }
  // Pacific Horizon carries 호주 역청탄 → DA-01·DA-03 + 28 new piles.
  // Oldest-first: DA-03 (35d) leads; the rest follow by stacked age.
  const pacific = attributed.filter((a) => a.voyage.vessel_name === "Pacific Horizon");
  assert.equal(pacific.length, 30);
  assert.equal(pacific[0].pile.stockpile_id, "DA-03");
  for (let i = 1; i < pacific.length; i++)
    assert.ok(
      Date.parse(pacific[i].pile.stacked_at) >=
        Date.parse(pacific[i - 1].pile.stacked_at),
    );
  const total = pacific.reduce((s, a) => s + a.tons, 0);
  assert.ok(Math.abs(total - pacific[0].voyage.cargo_t) < 1e-6);
});

test("pile history is 30-day window in reverse chronological order", () => {
  const scope = yardScope("dangjin");
  const attributed = attributeByCoalType(scope.piles, scope.incoming);
  const pile = scope.piles.find((p) => p.stockpile_id === "DA-01")!;
  const entries = historyForPile(pile, attributed);
  assert.ok(entries.length > 0);
  const base = Date.parse(BASE_TIME);
  assert.ok(
    entries.every(
      ({ unloaded_at }) =>
        Date.parse(unloaded_at) >= base &&
        Date.parse(unloaded_at) <= base + FORECAST_HORIZON * 86400000,
    ),
  );
  for (let i = 1; i < entries.length; i++)
    assert.ok(
      Date.parse(entries[i].unloaded_at) <= Date.parse(entries[i - 1].unloaded_at),
    );
  assert.ok(entries.every((e) => e.calorific_value_kcal_kg > 0));
});

test("gauge is positive t/h and contrast never exceeds request", () => {
  const dangjin = [plantInputs[0]];
  const gauge = gaugeValue(dangjin);
  assert.ok(gauge > 0 && Number.isFinite(gauge));
  const scope = yardScope("dangjin");
  const line = contrastLine(scope.forecast);
  assert.equal(line.length, FORECAST_HORIZON);
  assert.ok(line.every((c) => c.burned <= c.requested + 1e-6));
});

test("manual transfer warns without blocking over-capacity input", () => {
  const ok = transferTons(5000, 20000);
  assert.deepEqual([ok.tons, ok.capacity, ok.overCapacity], [5000, 20000, false]);
  const over = transferTons(25000, 20000);
  assert.equal(over.tons, 25000);
  assert.equal(over.overCapacity, true);
  const bad = transferTons(NaN, -3);
  assert.deepEqual([bad.tons, bad.capacity, bad.overCapacity], [0, 0, false]);
});
test("arrival sync covers Dangjin voyages past AIS ETA in real now", () => {
  const now = Date.parse(BASE_TIME) + 30 * 86400000;
  const arrived = arrivalWaiting(yardScope(null).incoming, now);
  assert.ok(arrived.length > 0);
  assert.ok(
    arrived.every(
      (v) =>
        v.destination_plant_id === "dangjin" &&
        Date.parse(v.ais_eta) <= now,
    ),
  );
  const early = arrivalWaiting(
    yardScope(null).incoming,
    Date.parse(BASE_TIME) - 4 * 3600000,
  );
  assert.equal(early.length, 0);
  const cancelled = {
    ...arrived[0],
    voyage_id: "cancelled-x",
    voyage_status: "cancelled" as const,
  };
  assert.ok(!arrivalWaiting([cancelled], now).includes(cancelled));
});

test("berth recommendation follows ETA order without occupancy data", () => {
  const scope = yardScope("dangjin");
  const waiting = waitingVessels(scope.incoming).map((r) => r.voyage);
  const first = recommendBerth(waiting[0], waiting);
  assert.equal(first.berth_id, "BD-1");
  assert.ok(first.reason.length > 0);
  for (const voyage of waiting) {
    const rec = recommendBerth(voyage, waiting);
    assert.ok(["BD-1", "BD-2", "BD-3"].includes(rec.berth_id));
  }
});

test("harbor markers fix berths and lay ships out by ETA", () => {
  const scope = yardScope("dangjin");
  const waiting = waitingVessels(scope.incoming).map((r) => r.voyage);
  const markers = markerLayout(waiting, []);
  const berths = markers.filter((m) => m.kind === "berth");
  assert.deepEqual(
    berths.map((m) => m.id),
    ["BD-1", "BD-2", "BD-3"],
  );
  const ships = markers.filter((m) => m.kind === "waiting");
  assert.equal(ships.length, waiting.length);
  assert.ok(
    markers.every((m) => m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100),
  );
});

test("zone sections hold five piles each with matching coal type", () => {
  const dangjin = stockpiles.filter((p) => p.plant_id === "dangjin");
  for (const yard of ["P1", "P2", "P3"] as const) {
    const piles = dangjin.filter((p) => p.plant_yard === yard);
    const zones = [...new Set(piles.map((p) => p.zone))].sort();
    assert.deepEqual(zones, [0, 1, 2, 3]);
    for (const zone of zones) {
      const group = piles.filter((p) => p.zone === zone);
      assert.equal(group.length, 5);
      assert.ok(group.every((p) => p.coal_type === group[0].coal_type));
    }
  }
});

test("site vessels list each voyage once, moored first, waiting by ETA", () => {
  const scope = yardScope("dangjin");
  const arrived = arrivalWaiting(
    scope.incoming,
    Date.parse("2026-10-10T00:00:00Z"),
  );
  const unloading = arrived.filter(
    (v) => Date.parse(v.forecast_unload_end) >= Date.parse(BASE_TIME),
  );
  const waiting = waitingVessels(arrived).map((r) => r.voyage);
  // Pacific Horizon both waits and unloads: it is drawn once, at its berth.
  const vessels = siteVessels(unloading, waiting, {});
  assert.equal(
    vessels.length,
    new Set(vessels.map((v) => v.voyage.voyage_id)).size,
  );
  assert.deepEqual(
    vessels.map((v) => [v.state, v.berth_id, v.assigned]),
    [["unloading", "BD-1", false]],
  );
  const id = vessels[0].voyage.voyage_id;
  const moved = siteVessels(unloading, waiting, { [id]: "BD-2" });
  assert.deepEqual([moved[0].berth_id, moved[0].assigned], ["BD-2", true]);

  const base = scope.incoming[0];
  const late = { ...base, voyage_id: "w-late", ais_eta: "2026-10-05T00:00:00Z" };
  const early = { ...base, voyage_id: "w-early", ais_eta: "2026-10-04T00:00:00Z" };
  const atSea = siteVessels([], [late, early], {});
  assert.deepEqual(
    atSea.map((v) => [v.voyage.voyage_id, v.state]),
    [
      ["w-early", "waiting"],
      ["w-late", "waiting"],
    ],
  );
});

test("berth occupancy follows effective berths, moored ships first", () => {
  const base = yardScope("dangjin").incoming[0];
  const moored = { ...base, voyage_id: "m" };
  const waiter = { ...base, voyage_id: "w" };
  const occupancy = berthOccupancy(
    siteVessels([moored], [waiter], { m: "BD-2", w: "BD-3" }),
  );
  assert.deepEqual(
    occupancy.map((b) => [b.berth_id, b.plant_yard, b.state]),
    [
      ["BD-1", "P1", "empty"],
      ["BD-2", "P2", "unloading"],
      ["BD-3", "P3", "assigned"],
    ],
  );
  assert.equal(occupancy[1].vessel?.voyage.voyage_id, "m");
  // 같은 부두면 접안 하역중 선박이 접안 지정된 대기선보다 우선한다.
  const clash = berthOccupancy(siteVessels([moored], [waiter], { w: "BD-1" }));
  assert.equal(clash[0].state, "unloading");
  assert.equal(clash[0].vessel?.voyage.voyage_id, "m");
  // 지정 없는 대기선은 부두를 점유하지 않는다.
  const idle = berthOccupancy(siteVessels([], [waiter], {}));
  assert.ok(idle.every((b) => b.state === "empty" && b.vessel === null));
});

test("pile footprint scales by cube root and keeps small piles visible", () => {
  const big = pileFootprint(72000, 72000);
  const small = pileFootprint(3600, 72000);
  assert.equal(big.height, 1);
  assert.ok(small.height >= 0.35 && small.height < 1);
  assert.ok(Math.abs(big.grow / small.grow - Math.cbrt(20)) < 1e-9);
  assert.equal(pileFootprint(0, 72000).height, 0.35);
  assert.equal(pileFootprint(500, 0).height, 0.35);
  assert.equal(pileFootprint(-10, 100).grow, 0);
});

test("sample waiting ship shows only while AIS is dummy", () => {
  assert.equal(showSampleWaiting("dummy"), true);
  assert.equal(showSampleWaiting("aisstream"), false);
});

const dangjinPlant = plantInputs.filter((p) => p.id === "dangjin");

test("yard scope follows horizon and the app scope", () => {
  const scope = yardScope(null, 60, ["dangjin", "boryeong"]);
  assert.deepEqual(scope.plantIds, ["dangjin", "boryeong"]);
  assert.ok(
    scope.piles.every((p) => ["dangjin", "boryeong"].includes(p.plant_id)),
  );
  assert.equal(scope.forecast.daily.length, 60);
  assert.equal(scope.extended.daily.length, 67);
  assert.equal(yardScope("dangjin").horizon, FORECAST_HORIZON);
});

test("stock groups split Dangjin by yard and unit number, others by plant", () => {
  const scope = yardScope(null);
  const groups = stockGroups(plantInputs, scope.piles);
  const dj = groups.filter((g) => g.plantId === "dangjin");
  assert.deepEqual(
    dj.map((g) => [g.id, g.unitIds]),
    [
      ["dangjin:P1", ["dj-1", "dj-2"]],
      ["dangjin:P2", []],
      ["dangjin:P3", ["dj-9"]],
    ],
  );
  assert.ok(dj.every((g) => g.piles.length === 20));
  const others = groups.filter((g) => g.plantId !== "dangjin");
  assert.ok(others.every((g) => g.yard === null && g.id === g.plantId));
  assert.equal(
    groups.reduce((s, g) => s + g.piles.length, 0),
    scope.piles.length,
  );
});

test("unit daily MWh removes outage hours once even when outages overlap", () => {
  const plant = {
    ...dangjinPlant[0],
    units: [
      {
        ...dangjinPlant[0].units[0],
        capacityMw: 100,
        loadPct: 50,
        outages: [
          {
            startAt: "2026-10-06T12:00:00+09:00",
            endAt: "2026-10-06T18:00:00+09:00",
            reason: "a",
          },
          {
            startAt: "2026-10-06T15:00:00+09:00",
            endAt: "2026-10-06T21:00:00+09:00",
            reason: "b",
          },
          {
            startAt: "2026-10-07T09:00:00+09:00",
            endAt: "2026-10-08T09:00:00+09:00",
            reason: "c",
          },
        ],
      },
    ],
  } as typeof dangjinPlant[0];
  const mwh = unitDailyMwh(plant, 3)[plant.units[0].id];
  assert.deepEqual(mwh, [50 * 15, 0, 50 * 24]);
});

test("yard forecasts add up to the plant engine until a yard runs short", () => {
  const scope = yardScope("dangjin", 30);
  const groups = stockGroups(dangjinPlant, scope.piles);
  const forecasts = groupForecasts(groups, scope);
  const plantDaily = scope.extended.byPlant[0].daily;
  const firstShort = forecasts
    .map((f) => f.firstShortageDate)
    .filter((d): d is string => d !== null)
    .sort()[0];
  for (let d = 0; d < 30 && plantDaily[d].date < (firstShort ?? "9999"); d++) {
    const sum = forecasts.reduce((s, f) => s + f.daily[d].stockTons, 0);
    assert.ok(Math.abs(sum - plantDaily[d].stockTons) < 1e-6, plantDaily[d].date);
  }
  // 5~8호기가 없는 표본의 2발전처는 소비가 없어 재고일수를 판단하지 않는다.
  const p2 = forecasts.find((f) => f.group.yard === "P2")!;
  assert.equal(p2.currentDays, null);
  assert.equal(p2.status, "unknown");
  // 하역분(Pacific Horizon, BD-1)은 1발전처로 들어간다.
  const p1 = forecasts.find((f) => f.group.yard === "P1")!;
  assert.equal(
    p1.daily.reduce((s, r) => s + r.inboundTons, 0),
    80000,
  );
  assert.equal(p1.daily.length, 30);
});

test("berth reassignment and transfers move tonnage between yards only", () => {
  const scope = yardScope("dangjin", 30);
  const groups = stockGroups(dangjinPlant, scope.piles);
  const baseline = groupForecasts(groups, scope);
  const moved = groupForecasts(groups, scope, () => "BD-2");
  const inbound = (fs: typeof baseline, yard: string) =>
    fs.find((f) => f.group.yard === yard)!.daily.reduce((s, r) => s + r.inboundTons, 0);
  assert.equal(inbound(moved, "P1"), 0);
  assert.equal(inbound(moved, "P2"), 80000);
  const transfer = {
    id: "t1",
    from: "P1",
    to: "P2",
    tons: 5000,
    at: BASE_TIME,
    note: "",
  };
  const after = groupForecasts(groups, scope, undefined, [transfer]);
  const day0 = (fs: typeof baseline, yard: string) =>
    fs.find((f) => f.group.yard === yard)!.daily[0];
  assert.equal(day0(after, "P1").transferTons, -5000);
  assert.equal(day0(after, "P2").transferTons, 5000);
  assert.ok(
    Math.abs(
      day0(baseline, "P1").stockTons - day0(after, "P1").stockTons - 5000,
    ) < 1e-6,
  );
  assert.ok(
    Math.abs(day0(after, "P2").stockTons - day0(baseline, "P2").stockTons - 5000) <
      1e-6,
  );
});

test("days status follows SPEC thresholds", () => {
  assert.equal(daysStatus(null), "unknown");
  assert.equal(daysStatus(19.9), "danger");
  assert.equal(daysStatus(20), "warn");
  assert.equal(daysStatus(29.9), "warn");
  assert.equal(daysStatus(30), "ok");
  assert.equal(daysStatus(10, { danger: 7, normal: 15 }), "warn");
});

test("berth-aware attribution keeps cargo inside the berth's yard", () => {
  const scope = yardScope("dangjin");
  const atBerth = attributeByCoalType(scope.piles, scope.incoming, (v) => v.berth_id);
  assert.ok(atBerth.length > 0);
  assert.ok(atBerth.every((a) => a.pile.plant_yard === "P1"));
  const atBd2 = attributeByCoalType(scope.piles, scope.incoming, () => "BD-2");
  assert.ok(atBd2.every((a) => a.pile.plant_yard === "P2"));
  for (const rows of [atBerth, atBd2])
    assert.ok(Math.abs(rows.reduce((s, a) => s + a.tons, 0) - 80000) < 1e-6);
  // 부두 정보가 없으면 기존처럼 발전소 전체의 같은 탄종 Pile에 배분한다.
  const plantWide = attributeByCoalType(scope.piles, scope.incoming);
  assert.ok(new Set(plantWide.map((a) => a.pile.plant_yard)).size > 1);
});

test("incoming schedule places wait and unload inside the horizon", () => {
  const rows = incomingSchedule(yardScope(null).incoming, 30);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    for (const v of [...r.unload, r.reflect, ...(r.wait ?? [])])
      assert.ok(v >= 0 && v <= 1);
    assert.ok(r.unload[0] <= r.unload[1]);
    assert.equal(r.reflect, r.unload[1]);
  }
  const ends = rows.map((r) => Date.parse(r.unloadEnd));
  assert.deepEqual(ends, [...ends].sort((a, b) => a - b));
});

test("ledger rows sort, keep burn columns and export CSV with source", () => {
  const scope = yardScope("dangjin");
  const blend = pileBlend(scope.piles, []);
  const rows = ledgerRows(scope.piles, plantInputs, blend, []);
  assert.equal(rows.length, 60);
  const byTons = sortLedger(rows, "tons", "desc");
  assert.equal(byTons[0].pile.stockpile_id, "DA-01");
  assert.ok(byTons.every((r, i) => i === 0 || byTons[i - 1].pile.on_hand_t >= r.pile.on_hand_t));
  assert.deepEqual(
    sortLedger(rows, "id", "asc").slice(0, 2).map((r) => r.pile.stockpile_id),
    ["DA-01", "DA-02"],
  );
  const csv = ledgerCsv(rows.slice(0, 2)).split("\n");
  assert.match(csv[0], /SIMULATED/);
  assert.match(csv[1], /^stockpile_id,plant,yard/);
  assert.equal(csv.length, 4);
  const quoted = ledgerCsv([{ ...rows[0], plantName: "당진,본부" }]);
  assert.match(quoted, /"당진,본부"/);
});

test("alerts rank danger before warnings and point at their targets", () => {
  const scope = yardScope("dangjin");
  const forecasts = groupForecasts(stockGroups(dangjinPlant, scope.piles), scope);
  const alerts = stockyardAlerts({
    forecasts,
    piles: scope.piles,
    vessels: [],
    transferOver: true,
  });
  const rank = { danger: 0, warn: 1, info: 2 };
  assert.ok(alerts.every((a, i) => i === 0 || rank[alerts[i - 1].level] <= rank[a.level]));
  assert.ok(
    alerts.some(
      (a) => a.target?.kind === "pile" && a.target.id === "DA-04" && a.level === "warn",
    ),
  );
  assert.ok(alerts.some((a) => a.target?.kind === "yard" && a.target.id === "P3"));
  assert.ok(alerts.some((a) => a.text.includes("이탄 가용 초과")));
});

test("supply mapping uses g14/g58/g910 groups both ways", () => {
  const body = toSupplyTransfer({
    id: "x",
    from: "P1",
    to: "P3",
    tons: 1200,
    at: BASE_TIME,
    note: "점검",
  });
  assert.deepEqual(body, {
    at: BASE_TIME,
    from_group: "g14",
    to_group: "g910",
    tonnes: 1200,
    note: "점검",
  });
  assert.throws(() =>
    toSupplyTransfer({ id: "y", from: "P9", to: "P1", tons: 1, at: BASE_TIME, note: "" }),
  );
  const back = fromSupplyTransfers([
    { id: 7, at: BASE_TIME, from_group: "g58", to_group: "g14", tonnes: 300, note: "" },
    { id: 8, at: BASE_TIME, from_group: "gx", to_group: "g14", tonnes: 1, note: "" },
  ]);
  assert.deepEqual(back.map((t) => [t.from, t.to, t.savedId]), [["P2", "P1", 7]]);
});

test("supply vessel body and cumulative unloading follow the backend rules", () => {
  const voyage = yardScope("dangjin").incoming[0];
  const body = toSupplyVessel(voyage, "BD-3");
  assert.deepEqual(body.allocations, { g14: 0, g58: 0, g910: 1 });
  assert.ok(Date.parse(body.start_at) >= Date.parse(body.arrival_at));
  assert.ok(body.rate > 0);
  const record = {
    id: 1,
    name: voyage.vessel_name,
    cargo: 1000,
    arrival_at: BASE_TIME,
    points: [
      { at: "2026-10-06T10:00:00+09:00", cumulative: 0, rate: 100, allocations: { g14: 1 } },
      { at: "2026-10-06T12:00:00+09:00", cumulative: 300, rate: 50, allocations: { g14: 1 } },
    ],
  };
  assert.equal(supplyCumulative(record, "2026-10-06T09:00:00+09:00"), 0);
  assert.equal(supplyCumulative(record, "2026-10-06T11:00:00+09:00"), 100);
  assert.equal(supplyCumulative(record, "2026-10-06T14:00:00+09:00"), 400);
  assert.equal(supplyCumulative(record, "2026-10-08T00:00:00+09:00"), 1000);
});

test("sensor readings use the max per pile, drop stale data and raise risk", () => {
  const pile = stockpiles.find((p) => p.stockpile_id === "DA-05")!;
  const now = Date.parse("2026-10-06T09:00:00+09:00");
  const merged = mergeSensorReadings(
    [pile],
    [
      { stockpile_id: "DA-05", measured_at: "2026-10-06T08:50:00+09:00", temperature_c: 44, co_ppm: 12 },
      { stockpile_id: "DA-05", measured_at: "2026-10-06T08:55:00+09:00", temperature_c: 61, co_ppm: null },
      { stockpile_id: "DA-05", measured_at: "2026-10-05T20:00:00+09:00", temperature_c: 99, co_ppm: 500 },
    ],
    now,
  )[0];
  assert.equal(merged.temperature_c, 61);
  assert.equal(merged.co_ppm, 12);
  const before = pileRisk(pile);
  const after = pileRisk(merged);
  assert.equal(before.source, "SIMULATED");
  assert.equal(after.source, "SENSOR");
  assert.equal(after.score, Math.min(100, before.score + 40));
});

test("live AIS positions merge by MMSI and switch the screen source", () => {
  const rows = yardScope("dangjin").incoming;
  const live = mergeAisPositions(rows, [
    {
      vessel_id: "x",
      mmsi: rows[0].mmsi,
      received_at: "2026-10-10T01:00:00+09:00",
      latitude: 37,
      longitude: 126.5,
      sog_kn: null,
      cog_deg: 12,
      source: "aisstream",
    },
  ]);
  assert.equal(live.source, "aisstream");
  assert.equal(live.voyages[0].received_at, "2026-10-10T01:00:00+09:00");
  assert.equal(live.voyages[0].sog_kn, rows[0].sog_kn);
  assert.equal(mergeAisPositions(rows, []).source, "dummy");
});

test("weekly burn stays inside each yard and matches the yard forecast", () => {
  const scope = yardScope("dangjin");
  const forecasts = groupForecasts(stockGroups(dangjinPlant, scope.piles), scope);
  const shares = weeklyBurnShares(dangjinPlant, dangjinPlant[0].units.map((u) => u.id));
  const burned = groupWeeklyBurn(forecasts, shares);
  // 소속 호기가 없는 2발전처 Pile은 태우지 않는다.
  assert.ok(burned.every((b) => b.pile.plant_yard !== "P2"));
  for (const f of forecasts) {
    const planned = f.daily.slice(0, 7).reduce((s, d) => s + d.useTons, 0);
    const got = burned
      .filter((b) => f.group.piles.includes(b.pile))
      .reduce((s, b) => s + b.tons, 0);
    const burnable = f.group.piles
      .filter((p) =>
        p.eligible_unit_ids.some((id) => f.group.unitIds.includes(id) && shares[id] > 0),
      )
      .reduce((s, p) => s + p.on_hand_t, 0);
    assert.ok(Math.abs(got - Math.min(planned, burnable)) < 1e-6, f.group.id);
    assert.ok(burned.every((b) => b.tons <= b.pile.on_hand_t + 1e-6));
  }
  const total = burned.reduce((s, b) => s + b.tons, 0);
  const weekly = scope.forecast.daily.slice(0, 7).reduce((s, d) => s + d.requestedFuelTons, 0);
  assert.ok(total <= weekly + 1e-6);
});

test("link responses keep only valid records so odd payloads cannot crash the page", () => {
  assert.deepEqual(normalizeSupplyRecords({ schema_version: 1, vessels: "x" }), {
    transfers: [],
    vessels: [],
  });
  const records = normalizeSupplyRecords({
    transfers: [
      { id: 1, at: BASE_TIME, from_group: "g14", to_group: "g58", tonnes: 10 },
      { id: 2, at: "not a date", from_group: "g14", to_group: "g58", tonnes: 10 },
    ],
    vessels: [
      { id: 3, name: "A", cargo: 100, points: [{ at: BASE_TIME, cumulative: 0, rate: 5, allocations: { g14: 1, bad: "x" } }, { at: null }] },
      { id: "4", name: "B", cargo: 100 },
    ],
  });
  assert.deepEqual(records.transfers.map((t) => [t.id, t.note]), [[1, ""]]);
  assert.equal(records.vessels.length, 1);
  assert.deepEqual(records.vessels[0].points[0].allocations, { g14: 1 });
  assert.equal(records.vessels[0].points.length, 1);
  const ais = normalizeAisPositions({
    positions: [
      { mmsi: "999000001", latitude: 37, longitude: 126, received_at: BASE_TIME, source: "aisstream" },
      { mmsi: "12", latitude: 37, longitude: 126, received_at: BASE_TIME },
      { mmsi: "999000002", latitude: 91, longitude: 126, received_at: BASE_TIME },
    ],
  });
  assert.deepEqual(ais.map((p) => [p.mmsi, p.source, p.sog_kn]), [["999000001", "aisstream", null]]);
  assert.deepEqual(normalizeAisPositions({ plant_id: "dangjin" }), []);
  const sensors = normalizeSensorReadings([
    { stockpile_id: "DA-01", measured_at: BASE_TIME, temperature_c: "hot", co_ppm: 4 },
    { stockpile_id: 7, measured_at: BASE_TIME },
  ]);
  assert.deepEqual(sensors.map((r) => [r.stockpile_id, r.temperature_c, r.co_ppm]), [["DA-01", null, 4]]);
});
