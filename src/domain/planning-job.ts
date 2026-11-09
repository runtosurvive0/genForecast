/** MILP 계산 작업 상태(`GET /api/job`)의 해석과 공유 폴링 저장소. 진행률은 서버 값으로만 계산한다. */
export type PlanningJobState = 'idle' | 'running' | 'done' | 'error';
export interface PlanningJob {
  state: PlanningJobState;
  run_id?: string;
  stage?: string;
  message?: string;
  windows_done?: number;
  windows_total?: number;
  elapsed?: number;
  eta_seconds?: number;
  error?: string;
}
export type PlanningJobPhase = 'unknown' | 'idle' | 'preparing' | 'running' | 'done' | 'error';
export interface PlanningJobView {
  phase: PlanningJobPhase;
  runId?: string;
  message: string;
  percent: number | null;
  done: number;
  total: number | null;
  detail: string;
  elapsed: string;
  remaining: string;
  error: string;
}

const STATES: readonly string[] = ['idle', 'running', 'done', 'error'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function formatDuration(seconds: number | undefined): string {
  if (!finite(seconds) || seconds < 0) return '';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  if (h) return m ? `${h}시간 ${m}분` : `${h}시간`;
  if (m) return s ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}

export function formatRemaining(seconds: number | undefined): string {
  if (!finite(seconds) || seconds < 0) return '남은 시간 계산 중';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h) return m ? `약 ${h}시간 ${m}분 남음` : `약 ${h}시간 남음`;
  return `약 ${m}분 남음`;
}

export function parsePlanningJob(value: unknown): PlanningJob | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.state !== 'string' || !STATES.includes(raw.state)) return null;
  const job: PlanningJob = { state: raw.state as PlanningJobState };
  for (const key of ['run_id', 'stage', 'message', 'error'] as const) if (typeof raw[key] === 'string') job[key] = raw[key] as string;
  for (const key of ['windows_done', 'windows_total', 'elapsed', 'eta_seconds'] as const) if (finite(raw[key])) job[key] = raw[key] as number;
  return job;
}

/** `seen`: 이 브라우저에서 해당 계산이 진행 중인 것을 확인했는지. 완료·실패는 그때만 알린다. */
export function planningJobView(job: PlanningJob | null, seen: boolean): PlanningJobView {
  const base = { runId: job?.run_id, message: job?.message || '전망 계산 중', percent: null, done: 0, total: null, detail: '', elapsed: formatDuration(job?.elapsed), remaining: '', error: '' };
  if (!job) return { ...base, phase: 'unknown' };
  if (job.state === 'running') {
    const total = job.windows_total && job.windows_total > 0 ? job.windows_total : null;
    const done = Math.max(0, job.windows_done ?? 0);
    if (!total) return { ...base, phase: 'preparing', detail: '계산 자료를 준비하고 있습니다', remaining: formatRemaining(undefined) };
    const percent = Math.min(100, Math.floor((done / total) * 100));
    return { ...base, phase: 'running', percent, done, total, detail: `${done} / ${total} 구간 완료`, remaining: formatRemaining(job.eta_seconds) };
  }
  if (seen && job.state === 'done') return { ...base, phase: 'done', message: '계산 완료' };
  if (seen && job.state === 'error') return { ...base, phase: 'error', message: '계산 실패', error: job.error || '원인을 확인하지 못했습니다.' };
  return { ...base, phase: 'idle' };
}

export function topBarLabel(view: PlanningJobView): string | null {
  if (view.phase === 'preparing') return '전망 계산 준비 중';
  if (view.phase === 'running') return `전망 계산 중 ${view.percent}%`;
  return null;
}

export const RUNNING_POLL_MS = 3000;
export const IDLE_POLL_MS = 20000;
export const nextPollDelay = (job: PlanningJob | null) => (job?.state === 'running' ? RUNNING_POLL_MS : IDLE_POLL_MS);

export interface PlanningJobSnapshot { job: PlanningJob | null; checked: boolean; seen: ReadonlySet<string> }
export interface PlanningJobStoreOptions {
  fetchJob: () => Promise<PlanningJob | null>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
}

/** 여러 화면이 하나의 폴링을 공유한다. 활성 구독자가 있을 때만 확인하며, 실패는 job=null(알 수 없음)로 둔다. */
export function createPlanningJobStore(options: PlanningJobStoreOptions) {
  let snapshot: PlanningJobSnapshot = { job: null, checked: false, seen: new Set() };
  const listeners = new Set<() => void>();
  let active = 0, timer: unknown, sequence = 0;
  const emit = () => listeners.forEach(listener => listener());
  function apply(job: PlanningJob | null) {
    let seen = snapshot.seen;
    if (job?.state === 'running' && job.run_id && !seen.has(job.run_id)) seen = new Set([...seen, job.run_id]);
    snapshot = { job, checked: true, seen };
    emit();
  }
  function schedule() {
    if (timer !== undefined) options.clearTimer(timer);
    timer = undefined;
    if (active > 0) timer = options.setTimer(() => { timer = undefined; void poll(); }, nextPollDelay(snapshot.job));
  }
  async function poll() {
    if (active > 0 && options.isHidden()) { schedule(); return snapshot.job; }
    return refresh();
  }
  async function refresh() {
    const ticket = ++sequence;
    let job: PlanningJob | null = null;
    try { job = await options.fetchJob(); } catch { job = null; }
    if (ticket === sequence) { apply(job); schedule(); }
    return ticket === sequence ? job : snapshot.job;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void, enabled: boolean) {
      listeners.add(listener);
      if (enabled && ++active === 1) void poll();
      return () => {
        listeners.delete(listener);
        if (enabled && --active === 0) { if (timer !== undefined) options.clearTimer(timer); timer = undefined; }
      };
    },
    refresh,
    /** 다른 화면이 직접 받은 `/api/job` 응답을 공유한다. */
    publish(job: PlanningJob | null) { sequence++; apply(job); schedule(); },
    /** 페이지가 다시 보일 때 즉시 확인한다. */
    resume() { if (active > 0) void refresh(); },
  };
}
