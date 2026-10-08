import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadPlanningRuns,
  loadPlanningSnapshot,
} from "../src/domain/planning.ts";
import { planningFixture } from "./planning-fixture.ts";
import { fuelMetrics } from "../src/features/plant/fuel-metrics.ts";

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

test("fuel indicators use the selected days and preserve a measured zero", () => {
  const snapshot = planningFixture("연료 검증", "2027-01-01", 7);
  snapshot.daily.forEach((day, i) => {
    day.fuel_tonnes = i * 100;
  });
  const metrics = fuelMetrics(snapshot);
  assert.equal(metrics.total, 2100);
  assert.equal(metrics.average, 300);
  assert.equal(metrics.peak?.date, "2027-01-07");
  assert.equal(metrics.peak?.fuel_tonnes, 600);
  snapshot.daily.forEach((day) => {
    day.fuel_tonnes = 0;
  });
  assert.equal(fuelMetrics(snapshot).total, 0);
  assert.equal(fuelMetrics(snapshot).average, 0);
  assert.equal(fuelMetrics(snapshot).peak?.fuel_tonnes, 0);
});

test("a missing day or duplicate date cannot appear as a complete fuel plan", () => {
  const snapshot = planningFixture();
  snapshot.daily[5].fuel_tonnes = null;
  assert.equal(fuelMetrics(snapshot).total, null);
  assert.equal(fuelMetrics(snapshot).average, null);
  assert.equal(fuelMetrics(snapshot).peak, null);
  assert.equal(fuelMetrics(snapshot).completeDays, 29);
  snapshot.daily[5].fuel_tonnes = 9600;
  snapshot.daily[5].date = snapshot.daily[4].date;
  assert.equal(fuelMetrics(snapshot).total, null);
});

test("outage count intersects the selected KST interval, with exclusive end time", () => {
  const snapshot = planningFixture("정지 검증", "2027-02-01", 7);
  snapshot.outages = [
    {
      unit_id: "dj-1",
      name: "당진1호기",
      start_at: "2027-01-31T00:00:00+09:00",
      end_at: "2027-02-01T00:00:00+09:00",
      note: "시작 전 종료",
    },
    {
      unit_id: "dj-2",
      name: "당진2호기",
      start_at: "2027-02-07T23:00:00+09:00",
      end_at: "2027-02-08T00:00:00+09:00",
      note: "마지막 시간 포함",
    },
    {
      unit_id: "dj-3",
      name: "당진3호기",
      start_at: "2027-02-08T00:00:00+09:00",
      end_at: "2027-02-09T00:00:00+09:00",
      note: "조회기간 이후",
    },
  ];
  assert.equal(fuelMetrics(snapshot).outages, 1);
});
