import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadPlanningRuns,
  loadPlanningSnapshot,
  initialPlanningQuery,
} from "../src/domain/planning.ts";
import { planningFixture, suppliedPlanningFixture } from "./planning-fixture.ts";
import { fuelMetrics } from "../src/features/plant/fuel-metrics.ts";
import { forecastSummary } from "../src/features/plant/forecast-summary.ts";
import { forecastDay } from "../src/features/plant/forecast-day.ts";
import { sourceDescription } from "../src/domain/source-description.ts";
import { minimumInventoryPoint } from "../src/domain/supply.ts";

test('저장 계획은 오늘을 포함하면 오늘부터 조회하고, 미래·과거 결과는 날짜를 옮기지 않는다', () => {
  const run = { id:'rolling', name:'계획', period:'', start:'2026-11-01', end:'2027-02-06' };
  assert.deepEqual(initialPlanningQuery(run, '2026-11-09'), {runId:'rolling',start:'2026-11-09',horizon:30});
  assert.deepEqual(initialPlanningQuery(run, '2027-01-31'), {runId:'rolling',start:'2027-01-31',horizon:7});
  for (const today of ['2026-10-01','2027-02-01','2027-03-01']) {
    assert.equal(initialPlanningQuery(run, today).start, run.start);
  }
  assert.equal(initialPlanningQuery({...run,start:'2027-01-01'}, '2026-11-09').start, '2027-01-01');
});

test("source labels use operator language without changing ordinary technical words", () => {
  assert.equal(sourceDescription("사진 기반 합성 데이터 · 정합성 확인"), "참고 자료 기반 시연 데이터 · 정합성 확인");
  assert.equal(sourceDescription("더미 AIS · 석탄 더미 2개"), "시연 AIS · 석탄 더미 2개");
  assert.equal(sourceDescription("입력 적합성 점검"), "입력 적합성 점검");
});

test("selected forecast day preserves missing group data instead of summing a partial total", () => {
  const snapshot = suppliedPlanningFixture("전망", "2027-01-01", 7);
  for (const group of Object.values(snapshot.inventory.daily[2].groups)) group.receipts = 0;
  snapshot.inventory.daily[2].groups.g14.receipts = 500;
  const day = forecastDay(snapshot, "2027-01-03");
  assert.equal(day.stock, 284000);
  assert.equal(day.receipts, 500);
  assert.equal(day.burn, 3000);
  assert.equal(day.generation, 24000);
  snapshot.inventory.daily[2].groups.g58.receipts = undefined;
  snapshot.inventory.daily[2].groups.g910.stock = null;
  assert.equal(forecastDay(snapshot, "2027-01-03").receipts, null);
  assert.equal(forecastDay(snapshot, "2027-01-03").stock, null);
  assert.equal(forecastDay(snapshot, "2027-02-01").generation, null);
});

test("forecast summary uses complete selected days and never fills missing yard stock", () => {
  const snapshot = suppliedPlanningFixture("전망", "2027-01-01", 7);
  snapshot.daily.forEach((day, i) => { day.generation_mwh = i * 100; });
  const complete = forecastSummary(snapshot);
  assert.equal(complete.generation, 2100);
  assert.notEqual(complete.minimumStock, null);
  snapshot.daily[0].generation_mwh = null;
  assert.equal(forecastSummary(snapshot).generation, null);
  snapshot.inventory.daily[0].groups.g58.stock = null;
  assert.equal(forecastSummary(snapshot).minimumStock, null);
});

test("snapshot rejects an invalid per-unit daily generation value", async (t) => {
  const body = planningFixture();
  body.daily[0].unit_generation_mwh!["dj-1"] = -1;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
  await assert.rejects(loadPlanningSnapshot("검증 계산", "2027-01-01", 30), /일치하지/);
});

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

test("supply drilldown preserves zero and only locates a complete backend minimum", () => {
  const snapshot = planningFixture();
  snapshot.inventory.daily[5].groups.g58.days = 0;
  assert.equal(minimumInventoryPoint(snapshot), null);
  snapshot.inventory.kpis.min_days = 0;
  assert.deepEqual(minimumInventoryPoint(snapshot), {
    groupId: "g58",
    day: "2027-01-06",
  });
  snapshot.inventory.kpis.min_days = -2;
  snapshot.inventory.daily[8].groups.g910.days = -2;
  assert.deepEqual(minimumInventoryPoint(snapshot), {
    groupId: "g910",
    day: "2027-01-09",
  });
});

test("malformed supply groups, dates and vessel records cannot enter either screen", async (t) => {
  let snapshot = planningFixture();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(snapshot)),
  );
  snapshot.inventory.daily[1].day = snapshot.inventory.daily[0].day;
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-01", 30),
    /일치하지/,
  );
  snapshot = planningFixture();
  snapshot.inventory.groups.pop();
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-01", 30),
    /일치하지/,
  );
  snapshot = planningFixture();
  snapshot.vessels = [
    {
      id: 1,
      name: "invalid",
      cargo: 100,
      incoming_cv: 5500,
      arrival_at: "2027-01-02T00:00:00+09:00",
      remaining: 101,
      state: "입항예정",
    },
  ];
  await assert.rejects(
    loadPlanningSnapshot("검증 계산", "2027-01-01", 30),
    /일치하지/,
  );
});

test('계획·입력 목록 이름에 번호와 실행 시각을 붙여 같은 이름도 구분한다', async () => {
  const { planLabel, runTitle } = await import('../src/domain/planning-labels.ts');
  const item = { name: '2026년 11월+90', id: 4, recorded_at: '2026-11-09T18:09:30+00:00', start: '2026-11-10', end: '2027-02-07' };
  assert.equal(planLabel(item), '#4 2026년 11월+90 · 2026-11-10 ~ 2027-02-07 · 11-10 03:09 KST');
  assert.notEqual(planLabel(item), planLabel({ ...item, id: 5, recorded_at: '2026-11-08T18:00:00+00:00' }));
  // 번호·실행 시각이 없으면 붙이지 않는다
  assert.equal(planLabel({ name: '월간 전망', start: '2027-01-01', end: '2027-12-31' }), '월간 전망 · 2027-01-01 ~ 2027-12-31');
  // 날짜만 있는 기록 시각은 시각으로 쓰지 않는다
  assert.equal(planLabel({ name: '기준', id: 1, recorded_at: '2026-11-01', start: 'a', end: 'b' }), '#1 기준 · a ~ b');
  // 계산 실행은 식별자의 시각을 쓴다
  const runs = ['20261109-030000-111111-같은이름', '20261110-031444-322005-같은이름'].map(run_id => planLabel({ name: '같은이름', run_id, start: 'a', end: 'b' }));
  assert.deepEqual(runs, ['같은이름 · a ~ b · 11-09 03:00 KST', '같은이름 · a ~ b · 11-10 03:14 KST']);
});

test('실행 이력 제목은 입력 이름과 실행 시각, 식별자는 보조 글자로 나눈다', async () => {
  const { runTitle } = await import('../src/domain/planning-labels.ts');
  assert.deepEqual(runTitle('20261110-031444-322005-2026년11월90', '2026년 11월+90'), {
    title: '2026년 11월+90 · 11-10 03:14 KST',
    sub: '20261110-031444-322005-2026년11월90',
  });
  assert.deepEqual(runTitle('manual-run', '이름'), { title: '이름', sub: 'manual-run' });
});

test('안내문의 연속 하이픈은 문장 부호로 바꾼다', () => {
  assert.equal(sourceDescription('과대예측했습니다 -- 월별 보정을 검토하세요.'), '과대예측했습니다. 월별 보정을 검토하세요.');
});

test('이미 마침표가 있는 문장 뒤의 하이픈도 마침표가 겹치지 않는다', () => {
  assert.equal(sourceDescription('끝났습니다. -- 다음을 확인하세요.'), '끝났습니다. 다음을 확인하세요.');
});

test('기간이 없는 항목도 undefined 없이 이름을 만든다', async () => {
  const { planLabel } = await import('../src/domain/planning-labels.ts');
  assert.equal(planLabel({ name: '월간', id: 2, start: undefined as unknown as string, end: undefined as unknown as string }), '#2 월간');
});
