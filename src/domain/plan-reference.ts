// 가상 표본 화면(수급 예측)에서 저장 계획(통합 시뮬레이션)의 최저 재고일수를 참고값으로 보여 주기 위한 요약.
// 두 화면은 같은 공식(재고 ÷ 다음 7일 계획 소비 평균)을 쓰지만 입력 자료가 다르다.
import type { PlanningRun, PlanningSnapshot } from './planning.ts';

export type PlanReference =
  | { status: 'loading' }
  | { status: 'missing'; reason: string }
  | { status: 'ready'; minDays: number | null; start: string; horizon: number; runName: string };

export function planReference(p: {
  runs: PlanningRun[];
  current: PlanningSnapshot | null;
  listLoading: boolean;
  loading: boolean;
  failed: string;
}): PlanReference {
  if (p.current) {
    const run = p.runs.find(r => r.id === p.current!.run_id);
    return {
      status: 'ready',
      minDays: p.current.inventory.kpis.min_days,
      start: p.current.start,
      horizon: p.current.horizon_days,
      runName: run?.name || p.current.run_id,
    };
  }
  if (p.failed) return { status: 'missing', reason: p.failed };
  if (p.listLoading || p.loading) return { status: 'loading' };
  return { status: 'missing', reason: p.runs.length ? '저장 계획 결과를 불러오지 못했습니다.' : '저장된 계획이 없습니다.' };
}
