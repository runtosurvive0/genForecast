import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptResponse, checksQuery, contextChip, SCREEN_LABEL, sortChecks, statusAfterError,
  type CheckItem,
} from '../src/domain/assistant-checks.ts';

const item = (id: string, kind: CheckItem['kind'], count: number): CheckItem => (
  { id, kind, title: id, detail: '', count, targets: [], action: null }
);

test('sortChecks는 missing, stale, dummy, sample 순이고 같은 종류는 count 큰 순', () => {
  const input = [
    item('s1', 'sample', 9), item('d1', 'dummy', 1), item('m1', 'missing', 2),
    item('t1', 'stale', 1), item('m2', 'missing', 5), item('d2', 'dummy', 4),
  ];
  assert.deepEqual(sortChecks(input).map((i) => i.id), ['m2', 'm1', 't1', 'd2', 'd1', 's1']);
  assert.deepEqual(input.map((i) => i.id), ['s1', 'd1', 'm1', 't1', 'm2', 'd2']);
});

test('checksQuery는 값이 있는 인자만 붙인다', () => {
  assert.equal(checksQuery('forecast', { live: ['stock', 'units'] }), '/api/assistant/checks?screen=forecast&live=stock%2Cunits');
  assert.equal(checksQuery('blend', {}), '/api/assistant/checks?screen=blend');
  assert.equal(checksQuery('blend', { yard: 2 }), '/api/assistant/checks?screen=blend&yard=2');
  assert.equal(
    checksQuery('planning_input', { inputId: 7, runId: 'r 1', live: [] }),
    '/api/assistant/checks?screen=planning_input&run_id=r+1&input_id=7',
  );
});

test('contextChip은 화면 이름과 선택을 한국어로 보여 준다', () => {
  assert.equal(contextChip({ screen: 'blend', selection: { yard: 1 } }), '상탄·혼탄 · 1계통');
  assert.equal(contextChip({ screen: 'simulation', selection: { run_id: 'abc' } }), '통합 시뮬레이션 · 계산 선택됨');
  assert.equal(contextChip({ screen: 'scenario' }), '시나리오 분석');
  assert.equal(SCREEN_LABEL.forecast, '수급 예측');
  assert.equal(SCREEN_LABEL.planning_input, '전망 입력·계산');
});

test('stale response ignored', () => {
  assert.equal(acceptResponse(1, 2), false);
  assert.equal(acceptResponse(2, 2), true);
});

test('401·403은 hidden, 그 밖은 error', () => {
  assert.equal(statusAfterError(401), 'hidden');
  assert.equal(statusAfterError(403), 'hidden');
  assert.equal(statusAfterError(500), 'error');
  assert.equal(statusAfterError(undefined), 'error');
});
