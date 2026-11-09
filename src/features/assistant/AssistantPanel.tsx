import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  askAssistant, formatAsOf, SOURCE_LABEL,
  type AssistantAnswer, type AssistantFact, type AssistantTurn,
} from '@/domain/assistant';
import './assistant.css';

const MAX_LENGTH = 1000;
const HISTORY_MESSAGES = 20; // 최근 10턴 = 20개 메시지

type Message =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; content: string; result: AssistantAnswer };

function factValue(fact: AssistantFact): string {
  return typeof fact.value === 'number' ? fact.value.toLocaleString('ko-KR', { maximumFractionDigits: 20 }) : fact.value;
}

function AnswerDetail({ result }: { result: AssistantAnswer }) {
  return (
    <>
      {result.partial && <p className="gf-asst-partial">일부만 확인됨</p>}
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

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 닫거나 사라지면 진행 중 요청을 멈춘다.
  useEffect(() => {
    if (!open) controllerRef.current?.abort();
  }, [open]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, error]);

  const trimmed = question.trim();
  const canSend = !sending && trimmed.length > 0;

  async function submit() {
    if (!canSend) return;
    const history: AssistantTurn[] = messages.slice(-HISTORY_MESSAGES).map(m => ({ role: m.role, content: m.content }));
    const asked = trimmed;
    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    setError('');
    try {
      const result = await askAssistant(asked, history, controller.signal);
      if (controller.signal.aborted) return;
      setMessages(prev => [
        ...prev,
        { id: nextId.current++, role: 'user', content: asked },
        { id: nextId.current++, role: 'assistant', content: result.answer, result },
      ]);
      setQuestion('');
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(e instanceof Error ? e.message : '질문을 처리하지 못했습니다.');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setSending(false);
    }
  }

  if (!open) return null;
  return (
    <aside className="gf-asst-panel" aria-label="운영 도우미">
      <header className="gf-asst-head">
        <h2>운영 질문</h2>
        <button type="button" className="gf-asst-close" aria-label="패널 닫기" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="gf-asst-log" ref={logRef}>
        {messages.length === 0 && !sending && <p className="gf-asst-empty">재고, 입항 일정, 계획을 질문해 보세요. 답의 숫자에는 기준시각과 출처가 붙습니다.</p>}
        {messages.map(m => m.role === 'user' ? (
          <p key={m.id} className="gf-asst-user">{m.content}</p>
        ) : (
          <div key={m.id} className="gf-asst-answer">
            <AnswerDetail result={m.result} />
            <p className="gf-asst-text">{m.content}</p>
          </div>
        ))}
        {sending && <p className="gf-asst-status" role="status">확인하는 중입니다…</p>}
        {error && <p className="gf-asst-error" role="alert">{error}</p>}
      </div>
      <form className="gf-asst-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <textarea
          ref={textareaRef}
          aria-label="질문"
          rows={3}
          maxLength={MAX_LENGTH}
          value={question}
          placeholder="질문을 입력하세요"
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}
        />
        <div className="gf-asst-actions">
          <span className="gf-asst-count">{MAX_LENGTH - question.length}자 남음</span>
          <button type="submit" className="gf-asst-send" disabled={!canSend}>보내기</button>
        </div>
      </form>
    </aside>
  );
}
