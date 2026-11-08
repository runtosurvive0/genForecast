import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingChips, waitingQuestion, type WaitingCandidate } from '../src/domain/waiting-candidates.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const base: WaitingCandidate = {
  mmsi: '440123456', name: 'SAM WOO 47', shipType: 70, navStatus: 1, sogKn: 0.1, destination: 'KRTJI',
  position: { latitude: 37.0, longitude: 126.47, observedAt: new Date(NOW - 90 * 60000).toISOString() },
  dwellHours: 14.3, distanceKm: 6.2, stale: false, reasons: [],
};

test('질문 문장은 거리·머문 시간을 넣고 석탄이라는 말을 쓰지 않는다', () => {
  const text = waitingQuestion(base);
  assert.equal(text, 'SAM WOO 47이 당진 부두에서 6.2km 떨어진 바다에서 14시간째 멈춰 있습니다. 부두 대기(체선) 중인 배가 맞나요?');
  assert.ok(!/석탄/.test(text));
  assert.match(waitingQuestion({ ...base, name: 'MMSI 440123456', distanceKm: 3, dwellHours: 2.04 }), /^MMSI 440123456이 당진 부두에서 3\.0km 떨어진 바다에서 2시간째/);
});

test('근거 칩은 빈 값을 미기재·미상으로 쓰고 속력이 없으면 생략한다', () => {
  const recent = { ...base, sogKn: null, destination: null, shipType: null,
    position: { ...base.position, observedAt: new Date(NOW - 12 * 60000).toISOString() } };
  assert.deepEqual(waitingChips(recent, NOW), ['묘박', '목적지 미기재', '선종 미상', '관측 12분 전']);
  assert.deepEqual(waitingChips(base, NOW), ['묘박', '0.1노트', '목적지 KRTJI', '화물선', '관측 1시간 전']);
  assert.deepEqual(waitingChips({ ...base, navStatus: 0, shipType: 75 }, NOW).slice(0, 1), ['0.1노트']);
});
