import type { LotDetail } from './assistant-checks';

export interface LotQualityLabel {
  known: boolean;
  grade: '고열량' | '저열량' | null;
  gcv: string | null;
  sulfur: string | null;
  dummy: boolean;
}

// 혼탄 분석 행의 성분 표시. 점검 판정(details.lots)이 없거나 성분 값이 하나도 없으면 "성분 미확인".
export function lotQualityLabel(detail: LotDetail | undefined): LotQualityLabel {
  const gcv = detail?.gcv_arb, sulfur = detail?.sulfur_ar;
  const known = !!detail && (gcv != null || sulfur != null);
  if (!known) return { known: false, grade: null, gcv: null, sulfur: null, dummy: false };
  return {
    known: true,
    grade: detail.grade === '고' ? '고열량' : detail.grade === '저' ? '저열량' : null,
    gcv: gcv == null ? null : `${gcv.toLocaleString('en-US', { maximumFractionDigits: 0 })} kcal/kg`,
    sulfur: sulfur == null ? null : `황분 ${sulfur.toFixed(2)}%`,
    dummy: detail.dummy,
  };
}
