import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningJobStore, formatDuration, formatRemaining, nextPollDelay, parsePlanningJob, planningJobView, topBarLabel, type PlanningJob } from '../src/domain/planning-job.ts';

test('경과 시간은 시·분·초를 한국어로 쓰고 잘못된 값은 비운다', () => {
  assert.equal(formatDuration(750), '12분 30초');
  assert.equal(formatDuration(45.8), '45초');
  assert.equal(formatDuration(0), '0초');
  assert.equal(formatDuration(600), '10분');
  assert.equal(formatDuration(3900), '1시간 5분');
  assert.equal(formatDuration(7200), '2시간');
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(Number.NaN), '');
  assert.equal(formatDuration(undefined), '');
});

test('남은 시간은 서버 예상값이 있을 때만 분 단위로 올려 쓴다', () => {
  assert.equal(formatRemaining(450), '약 8분 남음');
  assert.equal(formatRemaining(480), '약 8분 남음');
  assert.equal(formatRemaining(20), '약 1분 남음');
  assert.equal(formatRemaining(0), '약 1분 남음');
  assert.equal(formatRemaining(3600), '약 1시간 남음');
  assert.equal(formatRemaining(4500), '약 1시간 15분 남음');
  assert.equal(formatRemaining(undefined), '남은 시간 계산 중');
  assert.equal(formatRemaining(Number.POSITIVE_INFINITY), '남은 시간 계산 중');
  assert.equal(formatRemaining(-5), '남은 시간 계산 중');
});

test('서버 응답 형식이 아니면 계산 상태를 만들지 않는다', () => {
  assert.equal(parsePlanningJob(null), null);
  assert.equal(parsePlanningJob({}), null);
  assert.equal(parsePlanningJob({state:'queued'}), null);
  assert.equal(parsePlanningJob({detail:'Not authenticated'}), null);
  assert.deepEqual(parsePlanningJob({state:'running',windows_done:2,windows_total:5,elapsed:30,eta_seconds:45,run_id:'r1',message:'창 계산',stage:'solve',extra:1}),
    {state:'running',windows_done:2,windows_total:5,elapsed:30,eta_seconds:45,run_id:'r1',message:'창 계산',stage:'solve'});
  assert.deepEqual(parsePlanningJob({state:'running',windows_done:'2',windows_total:null}), {state:'running'});
});

test('준비 단계는 진행률 없이 준비 문구를 쓴다', () => {
  const job: PlanningJob = {state:'running',run_id:'r1',message:'순수요·원전·석탄목표 계산',windows_done:0,elapsed:12};
  const view = planningJobView(job, false);
  assert.equal(view.phase, 'preparing');
  assert.equal(view.percent, null);
  assert.equal(view.detail, '계산 자료를 준비하고 있습니다');
  assert.equal(view.elapsed, '12초');
  assert.equal(view.remaining, '남은 시간 계산 중');
  assert.equal(view.message, '순수요·원전·석탄목표 계산');
  assert.equal(topBarLabel(view), '전망 계산 준비 중');
});

test('진행 단계는 구간 수와 서버 시간으로 진행률을 계산한다', () => {
  const view = planningJobView({state:'running',run_id:'r1',message:'창별 최적화',windows_done:5,windows_total:12,elapsed:750,eta_seconds:450}, false);
  assert.equal(view.phase, 'running');
  assert.equal(view.percent, 41);
  assert.equal(view.detail, '5 / 12 구간 완료');
  assert.equal(view.elapsed, '12분 30초');
  assert.equal(view.remaining, '약 8분 남음');
  assert.equal(topBarLabel(view), '전망 계산 중 41%');
  const noEta = planningJobView({state:'running',windows_done:0,windows_total:12}, false);
  assert.equal(noEta.percent, 0);
  assert.equal(noEta.remaining, '남은 시간 계산 중');
  assert.equal(noEta.message, '전망 계산 중');
  assert.equal(planningJobView({state:'running',windows_done:20,windows_total:12}, false).percent, 100);
});

test('완료·실패는 이 화면에서 진행을 본 계산일 때만 알린다', () => {
  assert.equal(planningJobView({state:'done',run_id:'r1'}, true).phase, 'done');
  assert.equal(planningJobView({state:'done',run_id:'r1'}, false).phase, 'idle');
  const failed = planningJobView({state:'error',run_id:'r1',error:'solver timeout'}, true);
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, 'solver timeout');
  assert.equal(planningJobView({state:'error',error:'x'}, false).phase, 'idle');
  assert.equal(planningJobView(null, true).phase, 'unknown');
  assert.equal(planningJobView({state:'idle'}, false).phase, 'idle');
  for (const v of [planningJobView({state:'done'}, true), planningJobView(null, false), planningJobView({state:'idle'}, false)]) assert.equal(topBarLabel(v), null);
});

test('계산 중이면 3초, 아니면 20초 뒤에 다시 확인한다', () => {
  assert.equal(nextPollDelay({state:'running'}), 3000);
  assert.equal(nextPollDelay({state:'idle'}), 20000);
  assert.equal(nextPollDelay(null), 20000);
});

function fakeTimers() {
  let now = 0, id = 0;
  const timers = new Map<number, {at:number; fn:() => void}>();
  return {
    set: (fn: () => void, ms: number) => { timers.set(++id, {at: now + ms, fn}); return id; },
    clear: (handle: unknown) => { timers.delete(handle as number); },
    pending: () => [...timers.values()].map(t => t.at - now).sort((a, b) => a - b),
    async advance(ms: number) { now += ms; for (const [key, t] of [...timers]) if (t.at <= now) { timers.delete(key); t.fn(); } await new Promise(r => setTimeout(r, 0)); },
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('저장소는 응답에 따라 확인 간격을 바꾸고 오류는 알 수 없음으로 둔다', async () => {
  const responses: (PlanningJob | null)[] = [{state:'running',run_id:'r1',windows_done:1,windows_total:4}, null, {state:'done',run_id:'r1'}];
  let calls = 0;
  const timers = fakeTimers();
  const store = createPlanningJobStore({fetchJob: async () => responses[Math.min(calls++, responses.length - 1)], setTimer: timers.set, clearTimer: timers.clear, isHidden: () => false});
  const stop = store.subscribe(() => {}, true);
  await tick();
  assert.equal(store.getSnapshot().job?.state, 'running');
  assert.equal(store.getSnapshot().seen.has('r1'), true);
  assert.deepEqual(timers.pending(), [3000]);
  await timers.advance(3000);
  assert.equal(store.getSnapshot().job, null);
  assert.equal(store.getSnapshot().checked, true);
  assert.deepEqual(timers.pending(), [20000]);
  const job = await store.refresh();
  assert.equal(job?.state, 'done');
  assert.equal(store.getSnapshot().seen.has('r1'), true);
  assert.deepEqual(timers.pending(), [20000]);
  stop();
  assert.deepEqual(timers.pending(), []);
});

test('구독자가 없으면 확인하지 않고, 다른 화면이 받은 상태를 함께 쓴다', async () => {
  let calls = 0;
  const timers = fakeTimers();
  const store = createPlanningJobStore({fetchJob: async () => { calls++; return {state:'idle'}; }, setTimer: timers.set, clearTimer: timers.clear, isHidden: () => false});
  const stop = store.subscribe(() => {}, false);
  await tick();
  assert.equal(calls, 0);
  store.publish({state:'running',run_id:'shared',windows_done:0});
  assert.equal(store.getSnapshot().job?.run_id, 'shared');
  assert.equal(store.getSnapshot().seen.has('shared'), true);
  stop();
});

test('늦게 도착한 이전 응답이 새 응답을 덮어쓰지 않는다', async () => {
  const resolvers: ((job: PlanningJob | null) => void)[] = [];
  const timers = fakeTimers();
  const store = createPlanningJobStore({fetchJob: () => new Promise(r => resolvers.push(r)), setTimer: timers.set, clearTimer: timers.clear, isHidden: () => false});
  const first = store.refresh();
  const second = store.refresh();
  resolvers[1]({state:'running',run_id:'new'});
  await second;
  resolvers[0]({state:'idle'});
  await first;
  assert.equal(store.getSnapshot().job?.state, 'running');
});

test('페이지가 숨겨져 있으면 확인을 미룬다', async () => {
  let calls = 0, hidden = true;
  const timers = fakeTimers();
  const store = createPlanningJobStore({fetchJob: async () => { calls++; return {state:'idle'}; }, setTimer: timers.set, clearTimer: timers.clear, isHidden: () => hidden});
  const stop = store.subscribe(() => {}, true);
  await tick();
  assert.equal(calls, 0);
  hidden = false;
  store.resume();
  await tick();
  assert.equal(calls, 1);
  stop();
});
