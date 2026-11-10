import { useEffect, useRef, useState } from 'react';
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { X } from 'lucide-react';
import {
  askAssistant, formatAsOf, SOURCE_LABEL,
  type AssistantAnswer, type AssistantFact, type AssistantTurn,
} from '@/domain/assistant';
import {
  contextChip, SCREEN_QUESTIONS, useLlmStatus,
  type AssistantContext, type AssistantScreen,
} from '@/domain/assistant-checks';
import './assistant.css';

const MAX_LENGTH = 1000;
const HISTORY_MESSAGES = 20; // 최근 10턴 = 20개 메시지
const LLM_OFF_NOTICE = '도우미가 연결되지 않았습니다 · 관리자에게 오픈AI 설정을 확인해 달라고 요청하세요';
// 화면이 점검 대상이 아닐 때의 공통 예시 질문.
const COMMON_EXAMPLES = ['지금 당진 부두 앞에서 기다리는 배는?', '재고일수가 가장 낮은 저탄장은?', '다음 주 입항 예정 항차를 알려 줘'];

export interface PendingQuestion { question: string; context: AssistantContext }

type Message =
  | { id: number; role: 'user'; content: string; context?: AssistantContext }
  | { id: number; role: 'assistant'; content: string; result: AssistantAnswer };

function factValue(fact: AssistantFact): string {
  return typeof fact.value === 'number' ? fact.value.toLocaleString('ko-KR', { maximumFractionDigits: 20 }) : fact.value;
}

// 명세 4.3 순서: 답 문장 → 근거 표 → 확인 필요 → 제안.
function AnswerDetail({ answer, result }: { answer: string; result: AssistantAnswer }) {
  return (
    <>
      {result.partial && <p className="gf-asst-partial">일부만 확인됨</p>}
      <p className="gf-asst-text">{answer}</p>
      {result.facts.length > 0 && (
        <section className="gf-asst-section">
          <h3>근거</h3>
          <div className="gf-asst-table-wrap">
            <table className="gf-asst-table">
              <thead><tr><th scope="col">항목</th><th scope="col">값</th><th scope="col">단위</th><th scope="col">기준시각 KST</th><th scope="col">출처</th></tr></thead>
              <tbody>
                {result.facts.map((f, i) => (
                  <tr key={`${f.tool_call_id}-${i}`}>
                    <td>{f.label}</td><td>{factValue(f)}</td><td>{f.unit ?? '—'}</td>
                    <td>{formatAsOf(f.as_of)}</td><td>{SOURCE_LABEL[f.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {result.gaps.length > 0 && (
        <section className="gf-asst-section">
          <h3>확인 필요</h3>
          <ul>{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </section>
      )}
      {result.proposals.length > 0 && (
        <section className="gf-asst-section">
          <h3>제안</h3>
          <ul>{result.proposals.map((p, i) => <li key={i}>{p.label}</li>)}</ul>
        </section>
      )}
    </>
  );
}

export function AssistantPanel({ open, onClose, pending = null, onPendingSent, screen }: {
  open: boolean;
  onClose: () => void;
  pending?: PendingQuestion | null;
  onPendingSent?: () => void;
  screen?: AssistantScreen;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const llm = useLlmStatus(open);
  const llmOff = llm === 'off';

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 닫거나 사라지면 진행 중 요청을 멈춘다.
  useEffect(() => {
    if (!open) controllerRef.current?.abort();
  }, [open]);
  useEffect(() => () => controllerRef.current?.abort(), []);
  // 닫을 때 남은 질문을 비워 다음에 열 때 오래된 질문이 나가지 않게 한다.
  useEffect(() => { if (!open && pending) onPendingSent?.(); }, [open, pending, onPendingSent]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, error]);

  const trimmed = question.trim();
  const canSend = !sending && !llmOff && trimmed.length > 0;

  async function submit() {
    if (canSend) await send(trimmed);
  }

  async function send(asked: string, context?: AssistantContext, fromPending = false) {
    const history: AssistantTurn[] = messages.slice(-HISTORY_MESSAGES).map(m => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    setError('');
    try {
      const result = await askAssistant(asked, history, controller.signal, context);
      if (controller.signal.aborted) return;
      setMessages(prev => [
        ...prev,
        { id: nextId.current++, role: 'user', content: asked, context },
        { id: nextId.current++, role: 'assistant', content: result.answer, result },
      ]);
      if (!fromPending) setQuestion(''); // 섹션에서 온 질문은 사용자가 입력칸에 쓰던 글을 건드리지 않는다.
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(e instanceof Error ? e.message : '질문을 처리하지 못했습니다.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setSending(false);
      }
    }
  }

  // 화면의 도우미 섹션에서 온 질문은 연결 상태를 확인한 뒤 바로 보낸다.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!open || !pending || sending || llm === 'loading') return;
    onPendingSent?.();
    if (llm !== 'off') void sendRef.current(pending.question, pending.context, true);
    else setQuestion(pending.question); // 연결 안 됨: 질문을 버리지 않고 입력칸에 남겨 안내와 함께 보여 준다.
  }, [open, pending, sending, llm, onPendingSent]);

  const examples = screen ? SCREEN_QUESTIONS[screen].slice(0, 3).map(q => q.question) : COMMON_EXAMPLES;

  if (!open) return null;
  return (
    <aside className="gf-asst-panel" aria-label="운영 도우미">
      <header className="gf-asst-head">
        <h2>운영 질문</h2>
        <button type="button" className="gf-asst-close" aria-label="패널 닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="gf-asst-log" role="log" ref={logRef}>
        <p className={`gf-asst-conn${llmOff ? ' gf-asst-conn-off' : ''}`} role="status">
          {llm === 'on' ? '연결됨' : llmOff ? LLM_OFF_NOTICE : llm === 'unknown' ? '연결 상태를 확인하지 못했습니다' : '연결 확인 중…'}
        </p>
        {messages.length === 0 && !sending && (
          <>
            <p className="gf-asst-empty">재고, 입항 일정, 계획을 질문해 보세요. 답의 숫자에는 기준시각과 출처가 붙습니다.</p>
            <div className="gf-asst-examples">
              {examples.map(q => (
                <button key={q} type="button" className="gf-asst-example" disabled={llmOff || llm === 'loading'}
                  onClick={() => void send(q, screen ? { screen } : undefined)}>{q}</button>
              ))}
            </div>
          </>
        )}
        {messages.map(m => m.role === 'user' ? (
          <div key={m.id} className="gf-asst-ask">
            {m.context && <span className="gf-asst-chip">{contextChip(m.context)}</span>}
            <p className="gf-asst-user">{m.content}</p>
          </div>
        ) : (
          <div key={m.id} className="gf-asst-answer">
            <AnswerDetail answer={m.content} result={m.result} />
          </div>
        ))}
        {sending && <ProcessingOrb state="solving" label="답을 확인하는 중" className="gf-asst-status" />}
        {error && <p className="gf-asst-error" role="alert">{error}</p>}
      </div>
      <form className="gf-asst-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <textarea
          ref={textareaRef}
          aria-label="질문"
          aria-describedby="gf-asst-count"
          rows={3}
          maxLength={MAX_LENGTH}
          value={question}
          disabled={llmOff}
          placeholder="질문을 입력하세요"
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}
        />
        <div className="gf-asst-actions">
          <span className="gf-asst-count" id="gf-asst-count">{MAX_LENGTH - question.length}자 남음</span>
          <button type="submit" className="gf-asst-send" disabled={!canSend}>보내기</button>
        </div>
      </form>
    </aside>
  );
}
