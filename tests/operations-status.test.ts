import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { arrivals, kstClock, kstDay, kstHour, parseHourly, runCovering, unitOutputs, yardStock } from '../src/domain/operations-status.ts';

const require = createRequire(import.meta.url);
const { createEngine } = require('../scripts/fuel-demo/demo-engine.cjs');
const { loadCatalog } = require('../scripts/fuel-demo/demo-catalog.cjs');

test('호기별 현재 출력은 운전 데모 값과 정격을 쓰고, 값이 하나라도 없으면 합계는 미확정이다', () => {
  const catalog = loadCatalog();
  const snapshot = createEngine(catalog).snapshot();
  const out = unitOutputs(snapshot, catalog);
  assert.equal(out.rows.length, 10);
  assert.deepEqual(out.rows[0], { unit: 1, mw: 460, maxMW: 600, status: 'running' });
  assert.equal(out.rows[9].maxMW, 1100);
  assert.equal(out.totalMW, 4820);
  assert.equal(out.running, 10);
  const partial = { ...snapshot, units: { ...snapshot.units, 3: { ...snapshot.units[3], status: 'stopped', mw: 0 } } };
  delete (partial.units as Record<string, unknown>)['10'];
  const p = unitOutputs(partial, catalog);
  assert.equal(p.rows[2].status, 'stopped');
  assert.equal(p.rows[9].mw, null);
  assert.equal(p.rows[9].status, 'unknown');
  assert.equal(p.totalMW, null);
  assert.equal(p.running, 8);
});

test('저탄 현황은 저탄장 1~3 × 고·저열량탄 톤을 합산한다', () => {
  const snapshot = createEngine(loadCatalog()).snapshot();
  const stock = yardStock(snapshot);
  assert.deepEqual(stock.yards.map(y => y.yard), [1, 2, 3]);
  assert.equal(stock.yards[0].high, 87098);
  assert.equal(stock.yards[0].low, 22813);
  assert.equal(stock.high, 87098 + 51925 + 98516);
  assert.equal(stock.low, 22813 + 54641 + 48439);
  assert.equal(stock.total, stock.high + stock.low);
});

test('KST 날짜·시각과 오늘을 포함한 저장 계획을 고른다', () => {
  const now = new Date('2027-01-04T16:30:00Z'); // KST 2027-01-05 01:30
  assert.equal(kstDay(now), '2027-01-05');
  assert.equal(kstHour(now), 1);
  assert.equal(kstClock('2026-11-08T19:26:00Z'), '04:26');
  assert.equal(kstClock('잘못된 값'), '시각 미확인');
  const runs = [
    { id: 'old', name: 'old', period: '2026-01-01 ~ 2026-12-31', start: '2026-01-01', end: '2026-12-31' },
    { id: 'a', name: 'a', period: '2027-01-01 ~ 2027-06-30', start: '2027-01-01', end: '2027-06-30' },
    { id: 'b', name: 'b', period: '2027-01-03 ~ 2027-03-31', start: '2027-01-03', end: '2027-03-31' },
  ];
  assert.equal(runCovering(runs, '2027-01-05')?.id, 'b');
  assert.equal(runCovering(runs, '2028-01-01'), null);
});

test('시간대별 응답은 24개 숫자 순수요만 받아들인다', () => {
  const net = Array.from({ length: 24 }, (_, h) => 40000 + h * 100);
  assert.deepEqual(parseHourly({ day: '2027-01-05', net }), { day: '2027-01-05', net });
  assert.throws(() => parseHourly({ day: '2027-01-05', net: net.slice(1) }), /형식/);
  assert.throws(() => parseHourly({ day: '2027-01-05', net: [...net.slice(1), 'x'] }), /형식/);
});

test('입항 예정은 당진행 실제 항차 중 예정·항해만 ETA 순으로 고른다', () => {
  const registry = {
    ships: [{ ship_code: 'S1', name: 'ARRIVE ONE' }, { ship_code: 'S2', name: 'ARRIVE TWO' }, { ship_code: 'S3', name: 'DONE' }],
    voyages: [
      { voyage_no: 'V2', ship_code: 'S2', status: 'planned', planned_arrival: '2027-01-09T09:00', destination_port: '당진', classification: 'actual' },
      { voyage_no: 'V1', ship_code: 'S1', status: 'underway', planned_arrival: '2027-01-07T09:00', destination_port: '', classification: 'actual' },
      { voyage_no: 'V3', ship_code: 'S3', status: 'completed', planned_arrival: '2027-01-02T09:00', destination_port: '당진', classification: 'actual' },
      { voyage_no: 'V4', ship_code: 'S1', status: 'planned', planned_arrival: '2027-01-08T09:00', destination_port: '당진', classification: 'simulation' },
      { voyage_no: 'V5', ship_code: 'S2', status: 'planned', planned_arrival: '2027-01-08T09:00', destination_port: '보령', classification: 'actual' },
    ],
    cargo: [{ cargo_no: 'C1', voyage_no: 'V1', destination_plant_id: 'dangjin' }],
  };
  const rows = arrivals(registry);
  assert.deepEqual(rows.map(r => [r.voyage, r.ship, r.status, r.eta]), [
    ['V1', 'ARRIVE ONE', 'underway', '2027-01-07T09:00'],
    ['V2', 'ARRIVE TWO', 'planned', '2027-01-09T09:00'],
  ]);
});
