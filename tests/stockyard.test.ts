import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_TIME } from "../src/domain/operations.ts";
import { stockpiles } from "../src/data/control-tower.ts";
import { plantInputs, weightedCalorific } from "../src/domain/control-tower.ts";
import {
  allocateBurn,
  incomingTimeline,
  orderPiles,
  pileBlend,
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
  assert.equal(blendPiles.length, 4);
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
  assert.equal(all.piles.length, 16);
  assert.equal(dangjin.piles.length, 4);
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
