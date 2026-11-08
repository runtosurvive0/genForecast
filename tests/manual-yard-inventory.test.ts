import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeManualYard } from '../src/domain/manual-yard-inventory.ts';

test('수기 원장은 같은 위치를 합산하고 재확인 재고를 별도로 표시한다', () => {
  const result = summarizeManualYard([
    {location:'P1', remaining_t:100, needs_review:false},
    {location:'P1', remaining_t:30, needs_review:true},
    {location:'P2', remaining_t:0, needs_review:false},
    {location:'A3', remaining_t:90, needs_review:false},
  ], 1);
  assert.deepEqual(result, [
    {location:'P1', tonnes:130, records:2, review:1},
    {location:'P2', tonnes:0, records:1, review:0},
  ]);
});

test('없는 구역을 빈 재고로 추정하지 않고 옥내 셀을 구분한다', () => {
  assert.deepEqual(summarizeManualYard([], 3), []);
  assert.deepEqual(summarizeManualYard([{location:'B10',remaining_t:50,needs_review:false}], 3),
    [{location:'B10',tonnes:50,records:1,review:0}]);
});
