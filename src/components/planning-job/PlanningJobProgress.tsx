import type { ReactNode } from 'react';
import { InlineOrb } from '@/components/ProcessingOrb';
import { topBarLabel, type PlanningJobView } from '@/domain/planning-job';
import './planning-job.css';

/** 실행 버튼 바로 아래에 두는 계산 진행 표시. 값은 모두 `/api/job` 응답에서 온다. */
export function PlanningJobProgress({ view, resultAction, compact = false }: { view: PlanningJobView; resultAction?: ReactNode; compact?: boolean }) {
  if (view.phase === 'preparing' || view.phase === 'running') {
    if (compact) return <p className="gf-job-progress-line">{view.message} · {view.detail}{view.percent !== null ? ` (${view.percent}%)` : ''}</p>;
    return <section className="gf-job-progress" aria-label="전망 계산 진행" aria-live="polite">
      <div className="gf-job-progress-head"><strong>{view.message}</strong>{view.percent !== null && <b>{view.percent}%</b>}</div>
      {view.total ? <progress aria-label="계산 진행률" value={view.done} max={view.total} /> : <progress aria-label="계산 진행률" />}
      <p className="gf-job-progress-detail">{view.detail}</p>
      <dl className="gf-job-progress-times">
        {view.elapsed && <div><dt>경과</dt><dd>{view.elapsed}</dd></div>}
        <div><dt>남은 시간</dt><dd>{view.remaining}</dd></div>
      </dl>
    </section>;
  }
  // 짧은 표시는 진행 중에만 쓴다. 완료·실패는 실행 버튼 아래 한 곳에서만 알린다.
  if (compact) return null;
  if (view.phase === 'done') return <section className="gf-job-progress gf-job-progress-done" aria-label="전망 계산 진행" aria-live="polite">
    <div className="gf-job-progress-head"><strong>계산 완료</strong>{view.elapsed && <span>소요 {view.elapsed}</span>}</div>
    {resultAction}
  </section>;
  if (view.phase === 'error') return <section className="gf-job-progress gf-job-progress-error" aria-label="전망 계산 진행">
    <p role="alert">계산 실패: {view.error}</p>
  </section>;
  return null;
}

/** 상단바의 작은 진행 표시. 계산 중일 때만 보인다. */
export function PlanningJobIndicator({ view, onOpen }: { view: PlanningJobView; onOpen: () => void }) {
  const label = topBarLabel(view);
  if (!label) return null;
  return <span className="gf-job-indicator-slot"><button type="button" className="gf-job-indicator" aria-label={`${label} · 전망 입력·계산 화면 열기`} title={view.detail} onClick={onOpen}>
    <InlineOrb state="solving" className="gf-job-indicator-icon" />
    <span className="gf-job-indicator-text">{label}</span>
    <span className="gf-job-indicator-short" aria-hidden="true">{view.percent !== null ? `${view.percent}%` : '준비'}</span>
  </button></span>;
}
