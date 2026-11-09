import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createPlanningJobStore, parsePlanningJob, planningJobView, type PlanningJob } from './planning-job';

async function fetchPlanningJob(): Promise<PlanningJob | null> {
  // 401/403/네트워크 오류는 "알 수 없음"으로 둔다. 계산 상태를 추정하지 않는다.
  const response = await fetch('/api/job', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;
  return parsePlanningJob(await response.json().catch(() => null));
}

export const planningJobStore = createPlanningJobStore({
  fetchJob: fetchPlanningJob,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
});

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') planningJobStore.resume(); });
}

/** `/api/job` 공유 폴링. 계산 중 약 3초, 그 외 약 20초 간격이며 숨겨진 페이지에서는 미룬다. */
export function usePlanningJob(enabled = true) {
  useEffect(bindVisibility, []);
  const snapshot = useSyncExternalStore(
    useMemo(() => (listener: () => void) => planningJobStore.subscribe(listener, enabled), [enabled]),
    planningJobStore.getSnapshot,
  );
  const seen = Boolean(snapshot.job?.run_id && snapshot.seen.has(snapshot.job.run_id));
  const view = useMemo(() => planningJobView(snapshot.job, seen), [snapshot.job, seen]);
  return { job: snapshot.job, checked: snapshot.checked, view, refresh: planningJobStore.refresh, publish: planningJobStore.publish };
}
