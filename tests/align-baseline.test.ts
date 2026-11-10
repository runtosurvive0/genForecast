import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignDemoToBaseline, yardOfLocation } from '../src/domain/fuel-demo/align-baseline.ts';

const lot = (id: string, yard: number, quality: string, tons: number, baseTons: number) =>
  ({ id, uiId: id, yard, pile: 1, endpoint: '', coal: 'X', quality, tons, usable: true, reclaimRoute: null, poses: {} as never, baseTons, received: 0, reclaimed: 0 });
const snap = () => ({ material: { lots: {
  a: lot('a', 1, '고열량', 900, 1000),   // 상탄 100
  b: lot('b', 1, '고열량', 3000, 3000),
  c: lot('c', 1, '저열량', 2500, 2000),  // 하역 500
}, ships: {}, jobs: { unload: null, reclaim: null }, received: 500, outbound: 100, totalStock: 6400, baselineStock: 6000 } });

test('저탄장·등급별 시작 재고를 기준재고 합계에 맞추고 데모 변화량을 얹는다', () => {
  const out = alignDemoToBaseline(snap(), [
    { location: 'P1', tonnes: 6000, grade: '고열량' }, { location: 'P3', tonnes: 2000, grade: '고열량' },
    { location: 'P2', tonnes: 4000, grade: '저열량' },
  ])!;
  // 고열량 1저탄장 기준 8000을 데모 시작 비율(1000:3000)로 나눔 → 2000, 6000
  assert.equal(out.material.lots.a.tons, 1900);
  assert.equal(out.material.lots.b.tons, 6000);
  assert.equal(out.material.lots.c.tons, 4500);
  assert.equal(out.material.baselineStock, 12000);
  assert.equal(out.material.totalStock, 12400);
});

test('맞출 수 없으면(기준재고 없음·위치 모름·데모에 같은 등급 구역 없음) 데모 값을 그대로 둔다', () => {
  const s = snap();
  assert.equal(alignDemoToBaseline(s, []), s);
  assert.equal(alignDemoToBaseline(s, [{ location: 'X9', tonnes: 1, grade: '고열량' }]), s);
  assert.equal(alignDemoToBaseline(s, [{ location: 'P5', tonnes: 10, grade: '고열량' }]), s);
  assert.equal(alignDemoToBaseline(null, [{ location: 'P1', tonnes: 1 }]), null);
});

test('위치 코드를 저탄장으로 바꾼다', () => {
  assert.deepEqual(['P1', 'P4', 'P5', 'P8', 'A3', 'B10', 'Q1'].map(yardOfLocation), [1, 1, 2, 2, 3, 3, null]);
});
