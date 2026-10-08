import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadPlanningRuns,
  loadPlanningSnapshot,
} from "../src/domain/planning.ts";
import { planningFixture } from "./planning-fixture.ts";

test("Python snapshot preserves missing inventory/capacity and encoded run identity", async (t) => {
  let url = "";
  t.mock.method(globalThis, "fetch", async (path: string) => {
    url = path;
    return new Response(JSON.stringify(planningFixture()));
  });
  const snapshot = await loadPlanningSnapshot("검증 계산", "2027-01-01", 30);
  assert.match(url, /%EA%B2%80/);
  assert.equal(snapshot.inventory.kpis.stock, null);
  assert.equal(snapshot.models[0].coal_available_mw, null);
  assert.equal(snapshot.units.length, 10);
  assert.equal(snapshot.daily[0].fuel_tonnes, 9600);
});

test("a stale snapshot from another date/run cannot satisfy the active query", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(planningFixture())),
  );
  await assert.rejects(
    loadPlanningSnapshot("other-run", "2027-01-01", 30),
    /일치하지/,
  );
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-02", 30),
    /일치하지/,
  );
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-01", 90),
    /일치하지/,
  );
});

test("HTTP errors and invalid run catalogs stay errors instead of synthetic fallback", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ detail: "기간 밖" }), { status: 400 }),
  );
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-01", 30),
    /기간 밖/,
  );
  fetch.mock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify([{ id: "x", name: "test", period: "unknown" }]),
      ),
  );
  await assert.rejects(loadPlanningRuns(), /기간 또는 식별자/);
});
