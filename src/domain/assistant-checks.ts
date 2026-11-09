// 화면 쪽 점검 결과 형식·조회 훅·질문 맥락. 읽기 전용이며 ZGX 응답만 보여 준다.
import { useCallback, useEffect, useRef, useState } from 'react';

export type CheckKind = 'missing' | 'stale' | 'dummy' | 'sample';
export type AssistantScreen = 'blend' | 'forecast' | 'simulation' | 'planning_input' | 'scenario';

export interface CheckTarget { label: string; reason: string }
export interface CheckItem {
  id: string;
  kind: CheckKind;
  title: string;
  detail: string;
  count: number;
  targets: CheckTarget[];
  action: { page: string; label: string } | null;
}
export interface LotDetail {
  grade: '고' | '저' | null;
  gcv_arb: number | null;
  sulfur_ar: number | null;
  tm_ar: number | null;
  dummy: boolean;
  reason: string | null;
}
export interface ChecksResult {
  screen: AssistantScreen;
  as_of: string;
  items: CheckItem[];
  errors: string[];
  details?: { lots: Record<string, LotDetail> };
}
export interface AssistantContext {
  screen: AssistantScreen;
  selection?: Record<string, string | number>;
}
export interface ChecksParams { runId?: string; inputId?: number; yard?: 1 | 2 | 3; live?: string[] }
export type ChecksState = 'loading' | 'ready' | 'error' | 'hidden';

export const SCREEN_LABEL: Record<AssistantScreen, string> = {
  blend: '상탄·혼탄',
  forecast: '수급 예측',
  simulation: '통합 시뮬레이션',
  planning_input: '전망 입력·계산',
  scenario: '시나리오 분석',
};

const KIND_ORDER: Record<CheckKind, number> = { missing: 0, stale: 1, dummy: 2, sample: 3 };

// 백엔드 checks.sort_items와 같은 순서. 원본 배열은 바꾸지 않는다.
export function sortChecks(items: CheckItem[]): CheckItem[] {
  return [...items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.count - a.count);
}

export function checksQuery(screen: AssistantScreen, params: ChecksParams): string {
  const q = new URLSearchParams({ screen });
  if (params.runId) q.set('run_id', params.runId);
  if (params.inputId !== undefined) q.set('input_id', String(params.inputId));
  if (params.yard !== undefined) q.set('yard', String(params.yard));
  if (params.live && params.live.length) q.set('live', params.live.join(','));
  return `/api/assistant/checks?${q.toString()}`;
}

export function contextChip(ctx: AssistantContext): string {
  const parts = [SCREEN_LABEL[ctx.screen]];
  const sel = ctx.selection;
  if (sel) {
    if (sel.yard !== undefined && sel.yard !== '') parts.push(`${sel.yard}계통`);
    if (sel.run_id !== undefined && sel.run_id !== '') parts.push('계산 선택됨');
  }
  return parts.join(' · ');
}

// 늦게 도착한 이전 요청의 결과는 버린다.
export function acceptResponse(requestId: number, latestId: number): boolean {
  return requestId === latestId;
}

export function statusAfterError(status: number | undefined): ChecksState {
  return status === 401 || status === 403 ? 'hidden' : 'error';
}

function isResult(v: unknown): v is ChecksResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.screen === 'string' && typeof r.as_of === 'string' && Array.isArray(r.items) && Array.isArray(r.errors);
}

// 진입·params 변경·reload에서만 조회한다. 폴링하지 않는다.
export function useAssistantChecks(screen: AssistantScreen, params: ChecksParams) {
  const [state, setState] = useState<ChecksState>('loading');
  const [result, setResult] = useState<ChecksResult | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const url = checksQuery(screen, params);

  useEffect(() => {
    const requestId = ++latest.current;
    const controller = new AbortController();
    setState('loading');
    setResult(null);
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (!acceptResponse(requestId, latest.current)) return;
        if (!response.ok) { setResult(null); setState(statusAfterError(response.status)); return; }
        if (!isResult(body)) { setResult(null); setState('error'); return; }
        setResult({ ...body, items: sortChecks(body.items) });
        setState('ready');
      } catch {
        if (controller.signal.aborted || !acceptResponse(requestId, latest.current)) return;
        setResult(null);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [url, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { state, result, reload };
}
