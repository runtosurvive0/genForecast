import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultOptionId, parseBerthPlan, reasonLabel } from '../src/domain/berth-plan.ts';

// 구현된 백엔드(POST /api/berth-plan/recommend)가 실제로 돌려준 응답 형태.
const FIXTURE = {
  as_of: '2026-11-10T00:00:00+09:00',
  horizon_days: 3,
  source: { berths: 'dummy', voyages: 'registry', stock: 'supply_ledger' },
  assumptions: ['부두 능력: 시연용 가정값', 'ETA 기산 가정', '벌점 단가 20,000 USD/그룹·일(가정값)'],
  gaps: [{ kind: 'x', voyage_no: null, message: 'm' }],
  berths: [{ id: 'X', yards: ['1', '5'] }],
  outages: [{ berth: 'X', start: '2026-11-10T05:00:00+09:00', end: '2026-11-10T09:00:00+09:00' }],
  message: null,
  current: {
    label: '현재 계획',
    kpis: { demurrage_hours: 0.0, demurrage_usd: 0.0, min_days: 10.0, caution_days: 3, danger_days: 0 },
    assignments: [
      { voyage_no: 'p', voyage_number: 'V-P', vessel_name: '선박 p', yard: '1', berth_id: null, eta: '2026-11-10T00:00:00+09:00', berth_at: null, unload_end: null, tonnes: 12000.0, demurrage_hours: null, demurrage_usd: null, reasons: [], changed: false, fixed: false },
      { voyage_no: 'q', voyage_number: 'V-Q', vessel_name: '선박 q', yard: '5', berth_id: null, eta: '2026-11-10T01:00:00+09:00', berth_at: null, unload_end: null, tonnes: 12000.0, demurrage_hours: null, demurrage_usd: null, reasons: [], changed: false, fixed: false },
    ],
  },
  options: [
    {
      id: 'B', rank: 1, label: 'B·C 같음', merged: ['B', 'C'], status: 'optimal', gap_pct: 0.0, message: null,
      kpis: { demurrage_hours: 13.0, demurrage_usd: 26000.0, min_days: 1210.0, caution_days: 0, danger_days: 0, demurrage_usd_delta: 26000.0 },
      warnings: [],
      assignments: [
        { voyage_no: 'q', voyage_number: 'V-Q', vessel_name: '선박 q', yard: '5', berth_id: 'X', eta: '2026-11-10T01:00:00+09:00', berth_at: '2026-11-10T01:00:00+09:00', unload_end: '2026-11-10T13:00:00+09:00', tonnes: 12000.0, demurrage_hours: 0.0, demurrage_usd: 0.0, reasons: [], changed: true, fixed: false },
        { voyage_no: 'p', voyage_number: 'V-P', vessel_name: '선박 p', yard: '1', berth_id: 'X', eta: '2026-11-10T00:00:00+09:00', berth_at: '2026-11-10T13:00:00+09:00', unload_end: '2026-11-11T01:00:00+09:00', tonnes: 12000.0, demurrage_hours: 13.0, demurrage_usd: 26000.0, reasons: ['stock_priority:V-Q'], changed: true, fixed: false },
      ],
    },
    {
      id: 'A', rank: 2, label: 'A. 체선 최소', merged: ['A'], status: 'optimal', gap_pct: 0.0, message: null,
      kpis: { demurrage_hours: 11.0, demurrage_usd: 11000.0, min_days: 10.0, caution_days: 1, danger_days: 0, demurrage_usd_delta: 11000.0 },
      warnings: [],
      assignments: [
        { voyage_no: 'p', voyage_number: 'V-P', vessel_name: '선박 p', yard: '1', berth_id: 'X', eta: '2026-11-10T00:00:00+09:00', berth_at: '2026-11-10T00:00:00+09:00', unload_end: '2026-11-10T12:00:00+09:00', tonnes: 12000.0, demurrage_hours: 0.0, demurrage_usd: 0.0, reasons: [], changed: true, fixed: false },
        { voyage_no: 'q', voyage_number: 'V-Q', vessel_name: '선박 q', yard: '5', berth_id: 'X', eta: '2026-11-10T01:00:00+09:00', berth_at: '2026-11-10T12:00:00+09:00', unload_end: '2026-11-11T00:00:00+09:00', tonnes: 12000.0, demurrage_hours: 11.0, demurrage_usd: 11000.0, reasons: ['berth_busy'], changed: true, fixed: false },
      ],
    },
  ],
};
const clone = () => JSON.parse(JSON.stringify(FIXTURE));
const BAD = '접안 추천 응답 형식이 올바르지 않습니다';

test('정상 응답은 파싱된다', () => {
  const r = parseBerthPlan(clone());
  assert.equal(r.options.length, 2);
  assert.equal(r.options[0].kpis?.demurrage_usd, 26000);
  assert.equal(r.current?.assignments.length, 2);
});

test('고정 행의 eta null, 불가능 안의 kpis null, message null, current null을 허용한다', () => {
  const raw = clone();
  raw.options[0].assignments[0].eta = null;
  raw.options[1].status = 'infeasible';
  raw.options[1].kpis = null;
  raw.options[1].message = '해가 없습니다';
  raw.current = null;
  raw.message = null;
  const r = parseBerthPlan(raw);
  assert.equal(r.options[0].assignments[0].eta, null);
  assert.equal(r.options[1].kpis, null);
  assert.equal(r.current, null);
});

// 백엔드 plan.py는 고정 점유 행에 tonnes·eta·unload_end를 null로 보낸다(고정 행은 물량 원장 밖).
test('고정 점유 행의 tonnes null과 unload_end null을 허용한다', () => {
  const raw = clone();
  raw.options[0].assignments.unshift({ voyage_no: 'f', voyage_number: 'V-F', vessel_name: '선박 f', yard: '1', berth_id: 'X', eta: null, berth_at: '2026-11-10T00:00:00+09:00', unload_end: null, tonnes: null, demurrage_hours: null, demurrage_usd: null, reasons: [], changed: false, fixed: true });
  const r = parseBerthPlan(raw);
  assert.equal(r.options[0].assignments[0].tonnes, null);
  assert.equal(r.options[0].assignments[0].fixed, true);
  const strTonnes = clone(); strTonnes.options[0].assignments[0].tonnes = '1';
  assert.throws(() => parseBerthPlan(strTonnes), { message: BAD });
});

test('부두 목록과 정비 구간을 파싱하고 형식이 다르면 throw한다', () => {
  const r = parseBerthPlan(clone());
  assert.deepEqual(r.berths, [{ id: 'X', yards: ['1', '5'] }]);
  assert.equal(r.outages[0].berth, 'X');
  const noBerths = clone(); delete noBerths.berths;
  assert.throws(() => parseBerthPlan(noBerths), { message: BAD });
  const badYards = clone(); badYards.berths[0].yards = [1];
  assert.throws(() => parseBerthPlan(badYards), { message: BAD });
  const badOutage = clone(); badOutage.outages[0].end = null;
  assert.throws(() => parseBerthPlan(badOutage), { message: BAD });
  const numReason = clone(); numReason.outages[0].reason = 3;
  assert.throws(() => parseBerthPlan(numReason), { message: BAD });
  const noOutages = clone(); noOutages.outages = {};
  assert.throws(() => parseBerthPlan(noOutages), { message: BAD });
});

test('정비 구간 reason은 문자열·null·없음을 허용한다', () => {
  const withReason = clone(); withReason.outages[0].reason = '하역기 정비(예시)';
  assert.equal(parseBerthPlan(withReason).outages[0].reason, '하역기 정비(예시)');
  const nullReason = clone(); nullReason.outages[0].reason = null;
  assert.equal(parseBerthPlan(nullReason).outages[0].reason, null);
  assert.equal(parseBerthPlan(clone()).outages[0].reason ?? null, null);
});

test('형식이 다르면 throw한다', () => {
  const noOptions = clone(); delete noOptions.options;
  assert.throws(() => parseBerthPlan(noOptions), { message: BAD });
  const strUsd = clone(); strUsd.options[0].kpis.demurrage_usd = '26000';
  assert.throws(() => parseBerthPlan(strUsd), { message: BAD });
  const noAssign = clone(); noAssign.options[0].assignments = null;
  assert.throws(() => parseBerthPlan(noAssign), { message: BAD });
  const badStatus = clone(); badStatus.options[0].status = 'weird';
  assert.throws(() => parseBerthPlan(badStatus), { message: BAD });
  assert.throws(() => parseBerthPlan(null), { message: BAD });
  assert.throws(() => parseBerthPlan('x'), { message: BAD });
});

test('reasonLabel', () => {
  assert.equal(reasonLabel('berth_busy'), '부두 모두 사용 중');
  assert.equal(reasonLabel('outage'), '정비');
  assert.equal(reasonLabel('stock_priority:26-2-003'), '재고 우선(26-2-003 먼저)');
  assert.equal(reasonLabel('order:26-2-004'), '다른 배 먼저(26-2-004)');
  assert.equal(reasonLabel('wait'), '부두 사용 불가 시간');
  assert.equal(reasonLabel('unknown_code'), 'unknown_code');
});

test('defaultOptionId는 rank 1 안의 id를 돌려준다', () => {
  const r = parseBerthPlan(clone());
  assert.equal(defaultOptionId(r), 'B');
  assert.equal(defaultOptionId({ ...r, options: [] }), null);
});
