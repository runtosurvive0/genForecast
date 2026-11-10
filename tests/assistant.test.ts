import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { askAssistant, formatAsOf, parseAnswer, SOURCE_LABEL } from '../src/domain/assistant.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ok = {
  answer: 'a',
  facts: [{ label: 'x', value: 1, unit: 't', as_of: '2026-11-08T21:00:00Z', source: 'actual', tool_call_id: 'c1' }],
  proposals: [], gaps: [], partial: false, tool_calls: [],
};

test('parseAnswer는 형식이 맞는 응답만 받는다', () => {
  assert.equal(parseAnswer(ok).facts[0].source, 'actual');
  assert.throws(() => parseAnswer({ ...ok, gaps: undefined }), /형식/);
  assert.throws(() => parseAnswer({ ...ok, facts: [{ ...ok.facts[0], source: 'guess' }] }), /형식/);
});

test('parseAnswer는 value·unit·proposals·tool_calls 모양도 검사한다', () => {
  assert.equal(parseAnswer({ ...ok, facts: [{ ...ok.facts[0], value: '정상', unit: null }] }).facts[0].unit, null);
  assert.throws(() => parseAnswer({ ...ok, facts: [{ ...ok.facts[0], value: true }] }), /형식/);
  assert.throws(() => parseAnswer({ ...ok, facts: [{ ...ok.facts[0], unit: 3 }] }), /형식/);
  assert.throws(() => parseAnswer({ ...ok, proposals: [{ label: 'a' }] }), /형식/);
  assert.throws(() => parseAnswer({ ...ok, tool_calls: [{ id: 'c1', name: 'n', arguments: {} }] }), /형식/);
  assert.equal(parseAnswer({ ...ok, proposals: [{ label: 'a', action: 'b' }], tool_calls: [{ id: 'c1', name: 'n', arguments: {}, ok: true }] }).tool_calls.length, 1);
  assert.throws(() => parseAnswer(null), /도우미 응답 형식이 맞지 않습니다\./);
});

test('formatAsOf는 KST로 바꾼다', () => {
  assert.equal(formatAsOf('2026-11-08T21:30:00Z'), '2026-11-09 06:30');
  assert.equal(formatAsOf('2026-11-09T06:30:00+09:00'), '2026-11-09 06:30');
  assert.equal(formatAsOf('x'), '시각 미확인');
});

test('SOURCE_LABEL', () => {
  assert.equal(SOURCE_LABEL.simulation, '가정 계산');
});

test('askAssistant는 429·503 메시지를 그대로 던진다', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '한도' }), { status: 429 });
  await assert.rejects(askAssistant('q', []), /잠시 후 다시 질문해 주세요/);
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: '도우미가 설정되지 않았습니다' }), { status: 503 });
  await assert.rejects(askAssistant('q', []), /도우미가 설정되지 않았습니다/);
});

test('askAssistant는 detail이 없으면 상태 코드를 알린다', async () => {
  globalThis.fetch = async () => new Response('oops', { status: 500 });
  await assert.rejects(askAssistant('q', []), /도우미 응답 실패 \(500\)/);
});

test('askAssistant는 성공 응답을 검증하고 본문을 전송한다', async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return new Response(JSON.stringify(ok), { status: 200 }); };
  const result = await askAssistant('질문', [{ role: 'user', content: '이전' }]);
  assert.equal(result.answer, 'a');
  assert.equal(seen!.url, '/api/assistant/ask');
  assert.equal(seen!.init!.method, 'POST');
  assert.deepEqual(JSON.parse(String(seen!.init!.body)), { question: '질문', history: [{ role: 'user', content: '이전' }] });
  globalThis.fetch = async () => new Response(JSON.stringify({ ...ok, gaps: 1 }), { status: 200 });
  await assert.rejects(askAssistant('q', []), /도우미 응답 형식이 맞지 않습니다\./);
});

const hang = () => {
  globalThis.fetch = (_url, init) => new Promise((_, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
  });
};

test('호출자 signal이 있어도 타임아웃이 걸리고 한국어 메시지로 나온다', async () => {
  hang();
  const caller = new AbortController();
  await assert.rejects(askAssistant('q', [], caller.signal, undefined, 20), /응답이 늦어 질문을 멈췄습니다/);
});

test('사용자 취소는 AbortError로 그대로 전파된다', async () => {
  hang();
  const caller = new AbortController();
  const pending = askAssistant('q', [], caller.signal, undefined, 5000);
  caller.abort();
  await assert.rejects(pending, (e: Error) => e.name === 'AbortError');
});

test('askAssistant는 context가 없으면 본문에 context 키를 넣지 않는다', async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init!.body)); return new Response(JSON.stringify(ok), { status: 200 }); };
  await askAssistant('q', []);
  assert.equal('context' in body, false);
});

test('askAssistant는 context가 있으면 그대로 넣는다', async () => {
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init!.body)); return new Response(JSON.stringify(ok), { status: 200 }); };
  const context = { screen: 'blend' as const, selection: { yard: 1, lot: 'Pile 3' } };
  await askAssistant('q', [], undefined, context);
  assert.deepEqual(body.context, context);
});
