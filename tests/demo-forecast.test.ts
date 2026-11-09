import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateForecast, type ForecastInput } from '../src/domain/demo-forecast/engine.ts';
import { applyScenario, DEMO_SCENARIOS } from '../src/domain/demo-forecast/scenarios.ts';
import { acceptServerChanges, parseInstruction, compareAlternatives } from '../src/domain/demo-forecast/assistant.ts';
import { demoForecastInput as currentForecastInput } from '../src/data/demo-forecast-sample.ts';
import { fromOperations, operationsKey } from '../src/domain/demo-forecast/live.ts';
import { createRequire } from 'node:module';
import { kstDay } from '../src/domain/operations-status.ts';

// 대안의 순위는 요일별 발전량에 따라 달라지므로 손으로 검토한 표본 날짜를 고정한다.
const demoForecastInput = (days = 90, start = '2026-11-06T00:00:00+09:00') => currentForecastInput(days, start);

test('기본 전망은 KST 오늘부터 시작하고 연도 경계를 넘어 90일과 뒤 67일을 계산한다', () => {
  assert.equal(kstDay(new Date('2026-11-08T14:59:59Z')), '2026-11-08');
  assert.equal(kstDay(new Date('2026-11-08T15:00:00Z')), '2026-11-09');
  assert.equal(currentForecastInput().start, `${kstDay(new Date())}T00:00:00+09:00`);
  const input = demoForecastInput(90, '2026-11-09T00:00:00+09:00');
  const result = simulateForecast(input);
  assert.equal(result.daily[0].date, '2026-11-09');
  assert.equal(result.daily.at(-1)!.date, '2027-02-06');
  assert.equal(result.daily.length, 90);
  assert.ok(input.units.every(u => u.dailyMwh.length >= 157));
  // 기간을 바꿔도 같은 시작일의 앞부분 발전계획은 변하지 않는다.
  const short = demoForecastInput(7, input.start);
  assert.deepEqual(short.units.map(u => u.dailyMwh.slice(0, 7)), input.units.map(u => u.dailyMwh.slice(0, 7)));
  const weekend = demoForecastInput(7, '2026-11-07T00:00:00+09:00');
  assert.ok(weekend.units[0].dailyMwh[0] < short.units[0].dailyMwh[0], '요일별 발전량도 실제 전망 시작일을 따른다');
});

test('발전계획 누락·비정상 값은 마지막 값 반복이나 0으로 대체하지 않는다', () => {
  for (const bad of [Array(10).fill(2400), Array(17).fill(NaN), Array(17).fill(-1), new Array(17)]) {
    const input = tiny();
    input.units[0].dailyMwh = bad;
    assert.throws(() => simulateForecast(input), /1호기.*17일/);
  }
  const zero = tiny();
  zero.units[0].dailyMwh = Array(17).fill(0);
  assert.equal(simulateForecast(zero).kpis.generationMwh, 0);
});

// 작은 손 계산용 입력: 저탄장 1곳, 부두 1곳, 호기 1기(하루 2,400MWh, 열소비율 2,500 → 고열량 6,000kcal 기준 하루 1,000t)
function tiny(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    start: '2026-11-06T00:00:00+09:00',
    horizonDays: 10,
    tailDays: 0,
    yards: [{ id: 'Y1', name: '1저탄장', capacity: 50000, stock: { high: { tonnes: 10000, cv: 6000 }, low: { tonnes: 0, cv: 5000 } } }],
    berths: [{ id: 1, name: '1부두', rateTph: 1000, yards: ['Y1'] }],
    units: [{ id: 1, yard: 'Y1', capacityMw: 500, heatRate: 2500, dailyMwh: Array(40).fill(2400) }],
    vessels: [],
    strategy: [{ fromDay: 0, strategy: 'calorific' }],
    berthOutages: [],
    loadChanges: [],
    policy: 'planned',
    shiftHours: 6,
    laytimeTpd: 40000,
    demurrageUsdPerDay: 18000,
    ...over,
  };
}

test('연소량은 발전량 × 열소비율 ÷ 발열량으로 계산하고 재고일수를 낸다', () => {
  const r = simulateForecast(tiny());
  assert.equal(Math.round(r.daily[0].yards.Y1.burn), 1000);
  assert.equal(Math.round(r.daily[0].yards.Y1.high), 9000);
  assert.equal(Math.round(r.daily[0].yards.Y1.days!), 9);
  assert.equal(r.depletion.high?.day, 9); // 10,000t ÷ 1,000t/일 → 10일째(D+9) 소진
});

test('부두는 한 척씩 받고, 앞 배 하역이 끝나면 6시간 뒤 다음 배가 접안한다', () => {
  const vessels = [
    { id: 'A', name: 'A', origin: '호주 · Newcastle', grade: 'high' as const, cv: 6000, cargo: 24000, eta: 0, berth: 1, yard: 'Y1' },
    { id: 'B', name: 'B', origin: '호주 · Newcastle', grade: 'high' as const, cv: 6000, cargo: 12000, eta: 2, berth: 1, yard: 'Y1' },
  ];
  const r = simulateForecast(tiny({ vessels }));
  const a = r.vessels.find(v => v.id === 'A')!, b = r.vessels.find(v => v.id === 'B')!;
  assert.equal(a.berthedAt, 0);
  assert.equal(a.finishedAt, 24);
  assert.equal(b.berthedAt, 30); // 24h 하역 + 6h 교대
  assert.equal(b.waitHours, 28);
  assert.equal(b.finishedAt, 42);
});

test('저탄장이 차면 하역이 멈추고 체선이 늘어난다', () => {
  const vessels = [{ id: 'A', name: 'A', origin: 'x', grade: 'high' as const, cv: 6000, cargo: 60000, eta: 0, berth: 1, yard: 'Y1' }];
  const r = simulateForecast(tiny({ vessels, yards: [{ id: 'Y1', name: '1저탄장', capacity: 30000, stock: { high: { tonnes: 10000, cv: 6000 }, low: { tonnes: 0, cv: 5000 } } }] }));
  const a = r.vessels[0];
  assert.ok(a.blockedHours > 0);
  assert.ok(a.finishedAt === null || a.finishedAt > 60);
  assert.ok(a.demurrageUsd > 0);
});

test('CV 고장 시간에는 해당 부두 하역이 멈춘다', () => {
  const vessels = [{ id: 'A', name: 'A', origin: 'x', grade: 'high' as const, cv: 6000, cargo: 24000, eta: 0, berth: 1, yard: 'Y1' }];
  const r = simulateForecast(tiny({ vessels, berthOutages: [{ berth: 1, from: 4, to: 16, factor: 0, note: '반입 CV 고장' }] }));
  assert.equal(r.vessels[0].finishedAt, 36);
});

test('전략 비율대로 섞고, 한 탄종이 바닥나면 다른 탄종으로 대체한다', () => {
  const yards = [{ id: 'Y1', name: '1저탄장', capacity: 90000, stock: { high: { tonnes: 2000, cv: 6000 }, low: { tonnes: 20000, cv: 5000 } } }];
  const r = simulateForecast(tiny({ yards, strategy: [{ fromDay: 0, strategy: 'price' }] }));
  const d0 = r.daily[0].yards.Y1;
  assert.ok(d0.burnLow > d0.burnHigh); // 가격 우선 → 저열량 위주
  const dLater = r.daily[8].yards.Y1;
  assert.equal(Math.round(dLater.high), 0);
  assert.ok(r.notes.some(n => n.includes('대체')));
  assert.equal(r.shortageMwh, 0);
});

test('재고가 모두 떨어지면 공급 부족 발전량을 기록한다', () => {
  const r = simulateForecast(tiny({ yards: [{ id: 'Y1', name: '1저탄장', capacity: 90000, stock: { high: { tonnes: 2000, cv: 6000 }, low: { tonnes: 0, cv: 5000 } } }] }));
  assert.ok(r.shortageMwh > 0);
  assert.equal(r.depletion.all?.day, 1);
});

test('시연 표본: 기준 계획은 계약 선박 기간에 공급 부족이 없고, 계약 뒤 고갈 시점을 알려 주며, 4개 상황은 결과를 바꾼다', () => {
  const base = simulateForecast(demoForecastInput());
  assert.equal(base.daily.length, 90);
  const inContract = base.daily.slice(0, base.kpis.contractEndDay).reduce((s, d) => s + d.shortageMwh, 0);
  assert.equal(inContract, 0);
  assert.ok(base.kpis.risk !== 'danger');
  assert.ok(base.depletion.all && base.depletion.all.day >= base.kpis.contractEndDay && base.depletion.all.day < 90);
  assert.ok(base.vessels.some(v => v.state === '하역중'));
  assert.ok(base.vessels.some(v => v.state === '원거리'));
  assert.equal(DEMO_SCENARIOS.length, 4);
  for (const s of DEMO_SCENARIOS) {
    const r = simulateForecast(applyScenario(demoForecastInput(), s));
    const changed = r.kpis.minDays !== base.kpis.minDays || r.kpis.demurrageUsd !== base.kpis.demurrageUsd || r.kpis.burnTotal !== base.kpis.burnTotal || r.depletion.high?.day !== base.depletion.high?.day || r.depletion.low?.day !== base.depletion.low?.day;
    assert.ok(changed, s.id);
  }
});

test('자연어 지시를 계산 조건으로 바꾼다', () => {
  const p = parseInstruction('다음 주까지는 환경 우선으로 혼탄해 줘, 2부두 CV는 내일 오전 정비야', demoForecastInput());
  assert.deepEqual(p.changes.map(c => c.kind).sort(), ['outage', 'strategy']);
  const s = p.changes.find(c => c.kind === 'strategy')!;
  assert.equal(s.kind === 'strategy' && s.strategy, 'environment');
  const o = p.changes.find(c => c.kind === 'outage')!;
  assert.ok(o.kind === 'outage' && o.berth === 2 && o.from === 24 + 6 && o.to === 24 + 12);
  const q = parseInstruction('GEN4CAST DAWN 3일 지연, 발전량 15% 증가 2주', demoForecastInput());
  assert.deepEqual(q.changes.map(c => c.kind).sort(), ['delay', 'load']);
  assert.equal(parseInstruction('안녕', demoForecastInput()).changes.length, 0);
});

test('대안 비교는 배정 방식별로 다시 계산해 순위를 매긴다', () => {
  const input = applyScenario(demoForecastInput(), DEMO_SCENARIOS.find(s => s.id === 'cv-fault')!);
  const alts = compareAlternatives(input);
  assert.ok(alts.length >= 2);
  assert.deepEqual(alts.map(a => a.rank), alts.map((_, i) => i + 1));
  assert.ok(alts.every((a, i) => Number.isFinite(a.score) && (i === 0 || alts[i - 1].score <= a.score)));
  // CV가 멈춘 부두를 피하는 안이 계획 유지보다 낫다.
  assert.equal(alts[0].policy, 'auto');
  assert.ok((alts[0].result.kpis.minDays ?? 0) > (alts.find(a => a.id === 'planned')!.result.kpis.minDays ?? 0));
});

test('입항 지연 상황에서는 여유 저탄장의 이적안을 제안한다', () => {
  const input = applyScenario(demoForecastInput(), DEMO_SCENARIOS.find(s => s.id === 'delay')!);
  const alts = compareAlternatives(input);
  const tr = alts.find(a => a.transferTonnes > 0);
  assert.ok(tr, '이적안 없음');
  assert.equal(alts[0], tr);
  assert.ok((tr.result.kpis.minDays ?? 0) > (alts.find(a => a.id === 'planned')!.result.kpis.minDays ?? 0));
});

test('서버(LLM) 해석 결과는 아는 선박·부두·형식만 받아들인다', () => {
  const input = demoForecastInput();
  const v = input.vessels.find(x => x.berthedAt === undefined)!;
  const p = acceptServerChanges({
    changes: [
      { kind: 'delay', vesselId: v.id, vesselName: '바뀐 이름', days: 2 },
      { kind: 'outage', berth: 2, from: 30, to: 36, factor: 0, note: '2부두 CV 정비' },
      { kind: 'delay', vesselId: 'V-없음', days: 3 },
      { kind: 'outage', berth: 7, from: 0, to: 5 },
      { kind: 'strategy', fromDay: 0, toDay: null, strategy: 'unknown' },
      { kind: 'load', fromDay: 3, toDay: 1, pct: 10 },
    ],
    explanations: ['지연', '정비', 'a', 'b', 'c', 'd'],
    unparsed: ['기타'],
  }, input);
  assert.deepEqual(p.changes.map(c => c.kind), ['delay', 'outage']);
  assert.equal(p.changes[0].kind === 'delay' && p.changes[0].vesselName, v.name);
  assert.deepEqual(p.explanations, ['지연', '정비']);
  assert.equal(p.unparsed.length, 5);
  assert.deepEqual(acceptServerChanges(null, input).changes, []);
});

test('운전 상태 연결: 하역·상탄으로 바뀐 재고와 선박 잔량, 정지 호기를 예측 시작값에 넣는다', () => {
  const require = createRequire(import.meta.url);
  const { createEngine } = require('../scripts/fuel-demo/demo-engine.cjs');
  const { loadCatalog } = require('../scripts/fuel-demo/demo-catalog.cjs');
  const engine = createEngine(loadCatalog());
  const base = demoForecastInput(30);
  const before = fromOperations(base, engine.snapshot());
  // 처음 상태는 기준 표본과 같다(같은 카탈로그 재고, 같은 선박 진행률).
  assert.deepEqual(before.input.yards.map(y => y.stock), base.yards.map(y => y.stock));
  assert.equal(before.input.vessels.find(v => v.id === 'V-26041')!.unloaded, 75000 - 43800);

  engine.command({ op: 'preset' });
  engine.command({ op: 'play' });
  engine.advance(600); // 60배속 10시간: 2부두 2,000t 하역, 상탄 진행
  engine.command({ op: 'unit', id: 3, patch: { status: 'stopped' } });
  const snap = engine.snapshot();
  const live = fromOperations(base, snap);
  const total = live.input.yards.reduce((s, y) => s + y.stock.high.tonnes + y.stock.low.tonnes, 0);
  assert.ok(Math.abs(total - snap.material.totalStock) < 10, '저탄장 합계는 운전 상태 총재고와 같다');
  assert.equal(live.input.vessels.find(v => v.id === 'V-26042')!.unloaded, 82000 - snap.material.ships['2'].remaining);
  assert.equal(live.input.units.find(u => u.id === 3)!.dailyMwh[0], 0);
  assert.deepEqual(live.input.units.find(u => u.id === 3)!.dailyMwh.slice(1, 5), base.units[2].dailyMwh.slice(1, 5));
  assert.notEqual(operationsKey(snap), operationsKey(createEngine(loadCatalog()).snapshot()));
  // 이미 하역한 물량은 다시 들어오지 않는다: 남은 하역량이 줄어든 만큼 이후 입하 합계도 줄어든다.
  const receipts = (r: ReturnType<typeof simulateForecast>) => r.daily.reduce((s, d) => s + Object.values(d.yards).reduce((a, y) => a + y.receipts, 0), 0);
  assert.ok(receipts(simulateForecast(live.input)) < receipts(simulateForecast(before.input)));
});
