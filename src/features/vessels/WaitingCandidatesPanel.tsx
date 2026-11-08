import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TrackingVessel } from '@/domain/vessel-workflow';
import { waitingChips, waitingQuestion, type WaitingCandidate, type WaitingFeed } from '@/domain/waiting-candidates';
import { answerWaiting, fetchWaiting, WAITING_CONFLICT } from '@/domain/waiting-api';
import { fleetDetail } from './fleet-map';
import './waiting-candidates.css';

const REFRESH_MS = 60_000;
const VISIBLE = 5;
const STALE_MS = 3600_000;
const SAVE_FAILED = '관심 선박에 추가했지만 확인 기록은 저장하지 못했습니다';

export function kstTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

type ItemState = { busy?: boolean; error?: string; retryAnswer?: boolean };

/** ZGX가 규칙으로 찾은 부두 대기 후보를 묻고, 확인하면 관심 선박에 추가한다. */
export function WaitingCandidatesPanel({ watchlistMmsi, onAdd, onShowOnMap, onConfirmed }: {
  watchlistMmsi: Set<string>;
  onAdd: (vessel: TrackingVessel) => void;
  onShowOnMap: (candidate: WaitingCandidate) => void;
  onConfirmed: (confirmed: Record<string, string>) => void;
}) {
  const [feed, setFeed] = useState<WaitingFeed | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [expanded, setExpanded] = useState(false);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(new Set<string>());
  const abort = useRef<AbortController | null>(null);
  const confirmedRef = useRef(onConfirmed);
  confirmedRef.current = onConfirmed;

  const refresh = useCallback(async () => {
    abort.current?.abort();
    const own = new AbortController();
    abort.current = own;
    try {
      const next = await fetchWaiting(AbortSignal.any([own.signal, AbortSignal.timeout(15000)]));
      if (own.signal.aborted) return;
      setFeed(next);
      setLoadError(false);
      // 답보다 먼저 계산된 목록이 늦게 도착할 수 있으므로, 답한 배는 서버 목록에서 빠질 때까지 숨긴다.
      setAnswered((current) => new Set([...current].filter((m) => next.candidates.some((c) => c.mmsi === m))));
      setNow(Date.now());
      confirmedRef.current(next.confirmed);
    } catch {
      if (own.signal.aborted) return;
      // ZGX 실패를 로컬·합성 후보로 대신하지 않는다.
      setFeed(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      abort.current?.abort();
    };
  }, [refresh]);

  const patch = (mmsi: string, value: ItemState) => setItems((current) => ({ ...current, [mmsi]: value }));

  async function sendAnswer(c: WaitingCandidate, answer: 'yes' | 'no') {
    try {
      const { answeredAt } = await answerWaiting(c.mmsi, answer);
      setAnswered((current) => new Set(current).add(c.mmsi));
      patch(c.mmsi, {});
      if (answer === 'yes') {
        setFeed((current) => {
          if (!current) return current;
          const confirmed = { ...current.confirmed, [c.mmsi]: answeredAt };
          confirmedRef.current(confirmed);
          return { ...current, confirmed };
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message === WAITING_CONFLICT) {
        // "네"였다면 이미 추가한 관심 선박은 그대로 둔다.
        patch(c.mmsi, {});
        setNotice('후보 상태가 바뀌었습니다. 목록을 새로 고칩니다');
        void refresh();
        return;
      }
      patch(c.mmsi, answer === 'yes' ? { error: SAVE_FAILED, retryAnswer: true } : { error: '답을 저장하지 못했습니다' });
    }
  }

  async function run(c: WaitingCandidate, task: () => Promise<void>) {
    if (busy.current.has(c.mmsi)) return;
    busy.current.add(c.mmsi);
    setNotice('');
    setItems((current) => ({ ...current, [c.mmsi]: { ...current[c.mmsi], busy: true, error: undefined } }));
    try {
      await task();
    } finally {
      busy.current.delete(c.mmsi);
      setItems((current) => ({ ...current, [c.mmsi]: { ...current[c.mmsi], busy: false } }));
    }
  }

  const confirmYes = (c: WaitingCandidate) =>
    run(c, async () => {
      try {
        onAdd(await fleetDetail(c.mmsi, AbortSignal.timeout(15000)));
      } catch (error) {
        // 관심 추가가 실패하면 답은 저장하지 않는다.
        patch(c.mmsi, { error: error instanceof Error ? error.message : '관심 선박에 추가하지 못했습니다' });
        return;
      }
      await sendAnswer(c, 'yes');
    });
  const retryAnswer = (c: WaitingCandidate) => run(c, () => sendAnswer(c, 'yes'));
  const answerNo = (c: WaitingCandidate) => run(c, () => sendAnswer(c, 'no'));

  const list = (feed?.candidates ?? []).filter((c) => {
    const state = items[c.mmsi];
    return !answered.has(c.mmsi) && (state?.retryAnswer || state?.busy || !watchlistMmsi.has(c.mmsi));
  });
  const shown = expanded ? list : list.slice(0, VISIBLE);
  const lastReceived = feed?.lastReceivedAt ?? null;
  const delayed = lastReceived !== null && now - Date.parse(lastReceived) > STALE_MS;

  return (
    <section className="vw-wait" aria-label="확인할 배">
      <header className="vw-wait-head">
        <h3>확인할 배</h3>
        <span className="vw-wait-note">AI 확인 요청 · 부두 반경 {feed?.radiusKm ?? 15}km</span>
        <Button variant="ghost" size="icon-sm" className="vw-wait-refresh" aria-label="목록 새로 고침" onClick={() => void refresh()}>
          <RefreshCw size={13} />
        </Button>
      </header>
      {notice && <p className="vw-wait-line" role="status">{notice}</p>}
      {loadError && (
        <p className="vw-wait-line vw-wait-failed" role="status">
          체선 후보를 불러오지 못했습니다
          <Button variant="outline" size="sm" onClick={() => void refresh()}>다시 시도</Button>
        </p>
      )}
      {delayed && lastReceived && <p className="vw-wait-line vw-wait-delayed">AIS 수신 지연 · 마지막 갱신 {kstTime(lastReceived)}</p>}
      {feed && !list.length && <p className="vw-wait-line">확인할 배 없음 · 갱신 {kstTime(feed.updatedAt)}</p>}
      {shown.length > 0 && (
        <ul className="vw-wait-list">
          {shown.map((c) => {
            const state = items[c.mmsi] ?? {};
            return (
              <li key={c.mmsi} className="vw-wait-item" data-stale={c.stale || undefined}>
                <p className="vw-wait-question">{waitingQuestion(c)}</p>
                <ul className="vw-wait-chips" aria-label="판단 근거">
                  {waitingChips(c, now).map((chip) => <li key={chip} className="vw-wait-chip">{chip}</li>)}
                </ul>
                {state.error && (
                  <p className="vw-wait-error" role="alert">
                    {state.error}
                    {state.retryAnswer && (
                      <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void retryAnswer(c)}>다시 시도</Button>
                    )}
                  </p>
                )}
                {!state.retryAnswer && (
                  <div className="vw-wait-actions">
                    <Button size="sm" disabled={state.busy} onClick={() => void confirmYes(c)}>네, 관심 선박에 추가</Button>
                    <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void answerNo(c)}>아니요</Button>
                    <Button size="sm" variant="ghost" onClick={() => onShowOnMap(c)}>지도에서 보기</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {list.length > VISIBLE && (
        <Button variant="ghost" size="sm" className="vw-wait-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `더 보기 (${list.length - VISIBLE}척)`}
        </Button>
      )}
    </section>
  );
}
