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

const KINDS: readonly string[] = ['missing', 'stale', 'dummy', 'sample'];

function isItem(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const i = v as Record<string, unknown>;
  return typeof i.kind === 'string' && KINDS.includes(i.kind) && Array.isArray(i.targets);
}

export function isChecksResult(v: unknown): v is ChecksResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.screen === 'string' && typeof r.as_of === 'string'
    && Array.isArray(r.items) && r.items.every(isItem) && Array.isArray(r.errors);
}

// 같은 조회를 다시 점검하는 동안에는 이전 목록을 유지한다. 조회(화면·인자)가 바뀌면 비운다.
export function resultWhileLoading<T>(prev: T | null, prevUrl: string, nextUrl: string): T | null {
  return prevUrl === nextUrl ? prev : null;
}

// 화면별 질문 버튼·도우미 창 예시 질문(앞 3개).
const asks = (...qs: string[]) => qs.map((q) => ({ label: q, question: q }));
export const SCREEN_QUESTIONS: Record<AssistantScreen, { label: string; question: string }[]> = {
  blend: asks('지금 저열량탄 재고가 많은 저탄장은?', '성분이 빠진 원탄 목록을 정리해 줘', '선택한 원탄의 발열량과 황분은?'),
  forecast: asks('재고일수가 가장 먼저 떨어지는 저탄장은?', '입항이 이틀 늦으면 재고는 어떻게 돼?', '지금 기다리는 배는?'),
  simulation: asks('이 계획에서 재고가 가장 낮은 날은?', '확인할 경고를 쉬운 말로 정리해 줘', '이 계획의 호기별 연료 사용량은?'),
  planning_input: asks('이 입력에서 빠진 값이 뭐야?', '추정 단가를 쓰는 달은?', '마지막 계산 결과를 요약해 줘'),
  scenario: asks('부하를 10% 늘리면 재고가 언제 부족해?', '입항이 3일 늦으면 어떻게 돼?', '가장 먼저 부족해지는 발전본부는?'),
};

// 진입·params 변경·reload에서만 조회한다. 폴링하지 않는다.
export function useAssistantChecks(screen: AssistantScreen, params: ChecksParams) {
  const [state, setState] = useState<ChecksState>('loading');
  // 결과에 조회 주소를 함께 저장해, 조회가 바뀌면 이전 조회의 목록을 보여 주지 않는다.
  const [held, setHeld] = useState<{ url: string; result: ChecksResult } | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const url = checksQuery(screen, params);

  useEffect(() => {
    const requestId = ++latest.current;
    const controller = new AbortController();
    setState('loading');
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted || !acceptResponse(requestId, latest.current)) return;
        if (!response.ok) { setHeld(null); setState(statusAfterError(response.status)); return; }
        if (!isChecksResult(body)) { setHeld(null); setState('error'); return; }
        setHeld({ url, result: { ...body, items: sortChecks(body.items) } });
        setState('ready');
      } catch {
        if (controller.signal.aborted || !acceptResponse(requestId, latest.current)) return;
        setHeld(null);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [url, tick]);

  const result = resultWhileLoading(held?.result ?? null, held?.url ?? '', url);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { state, result, reload };
}

export type LlmStatus = 'loading' | 'on' | 'off' | 'unknown';

// 오픈AI 연결 여부. active일 때마다 한 번 확인한다. 확인 실패는 'unknown'(끄지 않는다).
export function useLlmStatus(active: boolean): LlmStatus {
  const [status, setStatus] = useState<LlmStatus>('loading');
  useEffect(() => {
    if (!active) { setStatus('loading'); return; }
    const controller = new AbortController();
    setStatus('loading');
    (async () => {
      try {
        const response = await fetch('/api/assistant/status', { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        const llm = typeof body === 'object' && body !== null ? (body as { llm?: unknown }).llm : undefined;
        setStatus(response.ok && typeof llm === 'boolean' ? (llm ? 'on' : 'off') : 'unknown');
      } catch {
        if (!controller.signal.aborted) setStatus('unknown');
      }
    })();
    return () => controller.abort();
  }, [active]);
  return status;
}
