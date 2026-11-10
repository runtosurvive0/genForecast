import type { LotDetail } from './assistant-checks';

// 백엔드 checks.py와 같은 규칙: 톤수 > 0 행을 순서대로 보며 키는 source_id(없으면 "위치 · 탄종 · 항차"),
// 같은 키가 다시 나오면 " (2)", " (3)" … 접미. 톤수 0 이하 행은 undefined.
export function lotDetailKeys(rows: { source_id?: string | null; location: string; coal_name: string; voyage_number?: string | null; tonnes: number }[]): (string | undefined)[] {
  const seen = new Set<string>();
  return rows.map(row => {
    if (!(row.tonnes > 0)) return undefined;
    const base = row.source_id || `${row.location} · ${row.coal_name} · ${row.voyage_number || '항차 미확인'}`;
    let key = base, n = 1;
    while (seen.has(key)) { n += 1; key = `${base} (${n})`; }
    seen.add(key);
    return key;
  });
}

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
