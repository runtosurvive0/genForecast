// 운영 도우미 응답 형식·검증·호출(ZGX). 실패를 로컬·합성 답으로 대신하지 않는다.
export type AssistantSource = 'actual' | 'plan' | 'simulation' | 'optimization';

export interface AssistantFact {
  label: string;
  value: number | string;
  unit: string | null;
  as_of: string;
  source: AssistantSource;
  tool_call_id: string;
}
export interface AssistantProposal { label: string; action: string }
export interface AssistantToolCall { id: string; name: string; arguments: Record<string, unknown>; ok: boolean }
export interface AssistantAnswer {
  answer: string;
  facts: AssistantFact[];
  proposals: AssistantProposal[];
  gaps: string[];
  partial: boolean;
  tool_calls: AssistantToolCall[];
}
export interface AssistantTurn { role: 'user' | 'assistant'; content: string }

export const SOURCE_LABEL: Record<AssistantSource, string> = {
  actual: '실측', plan: '계획', simulation: '가정 계산', optimization: '최적화',
};

const FORMAT_ERROR = '도우미 응답 형식이 맞지 않습니다.';
const SOURCES = new Set<string>(Object.keys(SOURCE_LABEL));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function fail(): never { throw new Error(FORMAT_ERROR); }

export function parseAnswer(body: unknown): AssistantAnswer {
  if (!isObject(body)) fail();
  const { answer, facts, proposals, gaps, partial, tool_calls } = body;
  if (!isStr(answer) || typeof partial !== 'boolean') fail();
  if (!Array.isArray(facts) || !Array.isArray(proposals) || !Array.isArray(gaps) || !Array.isArray(tool_calls)) fail();
  for (const f of facts) {
    if (!isObject(f) || !isStr(f.label) || !isStr(f.as_of) || !isStr(f.tool_call_id)) fail();
    if (typeof f.value !== 'number' && !isStr(f.value)) fail();
    if (f.unit !== null && !isStr(f.unit)) fail();
    if (!isStr(f.source) || !SOURCES.has(f.source)) fail();
  }
  for (const p of proposals) if (!isObject(p) || !isStr(p.label) || !isStr(p.action)) fail();
  for (const g of gaps) if (!isStr(g)) fail();
  for (const t of tool_calls) {
    if (!isObject(t) || !isStr(t.id) || !isStr(t.name) || !isObject(t.arguments) || typeof t.ok !== 'boolean') fail();
  }
  return body as unknown as AssistantAnswer;
}

export function formatAsOf(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '시각 미확인';
  const d = new Date(ms + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// 서버 전체 제한(60초)보다 약간 길게 둔다. 호출자 signal이 있어도 이 제한은 함께 적용한다.
const CLIENT_TIMEOUT_MS = 65000;
const TIMEOUT_MESSAGE = '응답이 늦어 질문을 멈췄습니다. 잠시 후 다시 시도해 주세요.';

export async function askAssistant(
  question: string, history: AssistantTurn[], signal?: AbortSignal, timeoutMs: number = CLIENT_TIMEOUT_MS,
): Promise<AssistantAnswer> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    // 로그인 세션·CSRF 헤더는 installAuthenticatedFetch가 감싼 전역 fetch가 붙인다.
    const response = await fetch('/api/assistant/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const value = await response.json().catch((e: unknown) => {
      if (timeout.aborted || signal?.aborted) throw e;
      return null;
    });
    if (response.status === 429) throw new Error('잠시 후 다시 질문해 주세요.');
    if (!response.ok) {
      const detail = isObject(value) && isStr(value.detail) && value.detail ? value.detail : '';
      throw new Error(detail || `도우미 응답 실패 (${response.status})`);
    }
    return parseAnswer(value);
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw error;
  }
}
