import { useEffect, useState } from 'react';
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import {
  checksQuery, useAssistantChecks, useLlmStatus,
  type AssistantContext, type AssistantScreen, type CheckItem, type CheckKind, type ChecksResult,
} from '@/domain/assistant-checks';
import { formatAsOf } from '@/domain/assistant';
import { sourceDescription } from '@/domain/source-description';
import './assistant-section.css';

const KIND_LABEL: Record<CheckKind, string> = { missing: '빠짐', stale: '오래됨', dummy: '더미', sample: '표본' };
const LLM_OFF = '도우미가 연결되지 않았습니다';

function storageKey(screen: AssistantScreen) { return `gf-as-open:${screen}`; }

function readOpen(screen: AssistantScreen): boolean | null {
  try {
    const v = localStorage.getItem(storageKey(screen));
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

function checkedAtLabel(asOf: string): string {
  const t = formatAsOf(asOf);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t) ? `점검 ${t.slice(-5)}` : '점검 시각 미확인';
}

function Item({ item, onNavigate }: { item: CheckItem; onNavigate: (page: string) => void }) {
  const [showTargets, setShowTargets] = useState(false);
  return (
    <li className="gf-as-item">
      <div className="gf-as-item-head">
        <span className={`gf-as-kind gf-as-kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        <strong className="gf-as-item-title">{sourceDescription(item.title)}</strong>
        {item.count > 0 && <span className="gf-as-count">{item.count}건</span>}
      </div>
      {item.detail && <p className="gf-as-detail">{sourceDescription(item.detail)}</p>}
      <div className="gf-as-item-actions">
        {item.targets.length > 0 && (
          <button type="button" className="gf-as-link" aria-expanded={showTargets} onClick={() => setShowTargets(v => !v)}>
            {showTargets ? '대상 접기' : '대상 보기'}
          </button>
        )}
        {item.action && (
          <button type="button" className="gf-as-link" onClick={() => onNavigate(item.action!.page)}>{item.action.label}</button>
        )}
      </div>
      {showTargets && (
        <ul className="gf-as-targets">
          {item.count > item.targets.length && <li className="gf-as-truncated">{item.count}건 중 {item.targets.length}건 표시</li>}
          {item.targets.map((t, i) => <li key={`${t.label}-${i}`}><span>{t.label}</span> <span className="gf-as-reason">{t.reason}</span></li>)}
        </ul>
      )}
    </li>
  );
}

export function AssistantSection({ screen, params, context, questions, onAsk, onNavigate, onResult }: {
  screen: AssistantScreen;
  params: Parameters<typeof checksQuery>[1];
  context: AssistantContext;
  questions: { label: string; question: string }[];
  onAsk: (question: string, context: AssistantContext) => void;
  onNavigate: (page: string) => void;
  onResult?: (result: ChecksResult | null) => void;
}) {
  const { state, result, reload } = useAssistantChecks(screen, params);
  const llm = useLlmStatus(state !== 'hidden');
  useEffect(() => { onResult?.(result); }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const [userOpen, setUserOpen] = useState<boolean | null>(() => readOpen(screen));
  if (state === 'hidden') return null;

  const hasMissing = !!result?.items.some(i => i.kind === 'missing');
  const open = userOpen ?? (hasMissing || state === 'error');
  const toggle = () => {
    const next = !open;
    setUserOpen(next);
    try { localStorage.setItem(storageKey(screen), next ? '1' : '0'); } catch { /* 저장 실패는 무시 */ }
  };
  const llmOff = llm === 'off';
  const bodyId = `gf-as-body-${screen}`;

  return (
    <section className="gf-as" aria-label="도우미">
      <header className="gf-as-head">
        <button type="button" className="gf-as-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={toggle}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="gf-as-title">도우미</span>
        </button>
        {state === 'ready' && result && <span className="gf-as-time">{checkedAtLabel(result.as_of)}</span>}
        <button type="button" className="gf-as-refresh" onClick={reload} disabled={state === 'loading'}>
          <RefreshCw size={13} aria-hidden="true" />다시 점검
        </button>
      </header>
      {open && (
        <div className="gf-as-body" id={bodyId}>
          {state === 'loading' && !result && <ProcessingOrb state="searching" label="점검하는 중" className="gf-as-note" />}
          {state === 'error' && (
            <p className="gf-as-note gf-as-error" role="alert">
              점검을 불러오지 못했습니다 <button type="button" className="gf-as-link" onClick={reload}>다시 시도</button>
            </p>
          )}
          {state !== 'error' && result && result.items.length === 0 && result.errors.length === 0 && (
            <p className="gf-as-note">확인할 빈 자료가 없습니다</p>
          )}
          {state !== 'error' && result && result.items.length > 0 && (
            <ul className="gf-as-list">
              {result.items.map(item => <Item key={item.id} item={item} onNavigate={onNavigate} />)}
            </ul>
          )}
          {state !== 'error' && result && result.errors.length > 0 && (
            <ul className="gf-as-errors">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          {llmOff && <p className="gf-as-note">{LLM_OFF}</p>}
          {questions.length > 0 && (
            <div className="gf-as-questions">
              {questions.map(q => (
                <button key={q.label} type="button" className="gf-as-question" disabled={llmOff}
                  onClick={() => onAsk(q.question, context)}>{q.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
