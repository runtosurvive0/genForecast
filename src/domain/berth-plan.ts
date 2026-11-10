// 접안 추천 API(ZGX) 결과 타입·파서·표시 도우미. 호출은 berth-plan-api.ts에 둔다.

export interface BerthAssignment {
  voyage_no: string; voyage_number: string | null; vessel_name: string | null;
  yard: string | null; berth_id: string | null;
  /** 고정(이미 접안한) 행은 null */
  eta: string | null;
  berth_at: string | null; unload_end: string | null;
  tonnes: number; demurrage_hours: number | null; demurrage_usd: number | null;
  reasons: string[]; changed: boolean; fixed: boolean;
}
export interface BerthKpis {
  demurrage_hours: number; demurrage_usd: number; min_days: number | null;
  caution_days: number | null; danger_days: number | null; demurrage_usd_delta?: number;
}
export type BerthStatus = 'optimal' | 'time_limit' | 'infeasible';
export interface BerthOption {
  id: string; rank: number; label: string; merged: string[];
  status: BerthStatus; gap_pct: number | null; message?: string | null;
  /** 해가 없는 안은 null */
  kpis: BerthKpis | null; warnings: string[]; assignments: BerthAssignment[];
}
export interface BerthGap { kind: string; voyage_no: string | null; message: string }
export interface BerthPlanResult {
  as_of: string; horizon_days: number; source: Record<string, string>;
  assumptions: string[]; gaps: BerthGap[]; message?: string | null;
  current: { label: string; kpis: BerthKpis; assignments: BerthAssignment[] } | null;
  options: BerthOption[];
}

const BAD_FORMAT = '접안 추천 응답 형식이 올바르지 않습니다';
const STATUSES: readonly string[] = ['optimal', 'time_limit', 'infeasible'];

type Obj = Record<string, unknown>;
const bad = (): never => { throw new Error(BAD_FORMAT); };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): boolean => v === null || v === undefined || isStr(v);
const numOrNull = (v: unknown): boolean => v === null || v === undefined || isNum(v);
const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function checkKpis(v: unknown): void {
  if (!isObj(v) || !isNum(v.demurrage_hours) || !isNum(v.demurrage_usd)
    || !numOrNull(v.min_days) || !numOrNull(v.caution_days) || !numOrNull(v.danger_days)
    || !(v.demurrage_usd_delta === undefined || isNum(v.demurrage_usd_delta))) bad();
}

function checkAssignments(v: unknown): void {
  if (!Array.isArray(v)) bad();
  for (const a of v as unknown[]) {
    if (!isObj(a) || !isStr(a.voyage_no) || !isNum(a.tonnes) || !strArray(a.reasons)
      || typeof a.changed !== 'boolean' || typeof a.fixed !== 'boolean'
      || !strOrNull(a.voyage_number) || !strOrNull(a.vessel_name) || !strOrNull(a.yard)
      || !strOrNull(a.berth_id) || !strOrNull(a.eta) || !strOrNull(a.berth_at) || !strOrNull(a.unload_end)
      || !numOrNull(a.demurrage_hours) || !numOrNull(a.demurrage_usd)) bad();
  }
}

/** 형식이 다르면 Error('접안 추천 응답 형식이 올바르지 않습니다'). */
export function parseBerthPlan(raw: unknown): BerthPlanResult {
  if (!isObj(raw) || !isStr(raw.as_of) || !isNum(raw.horizon_days) || !isObj(raw.source)
    || !strArray(raw.assumptions) || !Array.isArray(raw.gaps) || !strOrNull(raw.message)
    || !Array.isArray(raw.options)) bad();
  const r = raw as Obj;
  for (const g of r.gaps as unknown[]) {
    if (!isObj(g) || !isStr(g.kind) || !strOrNull(g.voyage_no) || !isStr(g.message)) bad();
  }
  if (r.current !== null && r.current !== undefined) {
    const c = r.current;
    if (!isObj(c) || !isStr(c.label)) bad();
    checkKpis((c as Obj).kpis);
    checkAssignments((c as Obj).assignments);
  }
  for (const o of r.options as unknown[]) {
    if (!isObj(o) || !isStr(o.id) || !isNum(o.rank) || !isStr(o.label) || !strArray(o.merged)
      || !isStr(o.status) || !STATUSES.includes(o.status) || !numOrNull(o.gap_pct)
      || !strOrNull(o.message) || !strArray(o.warnings)) bad();
    const opt = o as Obj;
    if (opt.kpis !== null) checkKpis(opt.kpis);
    checkAssignments(opt.assignments);
  }
  return { ...r, current: r.current ?? null } as unknown as BerthPlanResult;
}

/** 백엔드 reasons 코드를 화면 문구로 바꾼다. 모르는 코드는 그대로 돌려준다. */
export function reasonLabel(code: string): string {
  if (code === 'berth_busy') return '부두 모두 사용 중';
  if (code === 'outage') return '정비';
  if (code.startsWith('stock_priority:')) return `재고 우선(${code.slice('stock_priority:'.length)} 먼저)`;
  return code;
}

/** rank 1 안의 id, 없으면 null. */
export function defaultOptionId(r: BerthPlanResult): string | null {
  return r.options.find(o => o.rank === 1)?.id ?? null;
}
