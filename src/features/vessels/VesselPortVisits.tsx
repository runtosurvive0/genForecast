import { useEffect, useState } from "react";
import { Anchor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { trackingSource } from "./useVesselNavigation";
import { decodePortVisits, type PortVisitHistory } from "./vessel-port-visits";
import "./vessel-port-visits.css";

function portDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

/** Mounted with a vessel key so a late response can never become another ship's history. */
export function VesselPortVisits({
  vessel,
  owner,
  ready,
  theme,
}: {
  vessel: TrackingVessel;
  owner: string;
  ready: boolean;
  theme: "light" | "dark";
}) {
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<PortVisitHistory>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [orb, setOrb] = useState(false);
  const [count, setCount] = useState(5);
  const source = trackingSource(vessel);
  const mmsi = vessel.mmsi;
  const eligible = /^[1-9]\d{8}$/.test(mmsi);
  const shown = data?.days === days && data.mmsi === mmsi ? data : undefined;

  useEffect(() => {
    if (!owner || !ready || !eligible || location.protocol === "file:") return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    setOrb(false);
    const timer = setTimeout(() => setOrb(true), 250);
    void (async () => {
      try {
        const response = await fetch(
          `/api/vessels/port-visits/${owner}/${source}/${mmsi}?days=${days}`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]),
            cache: "no-store",
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "관심 선박의 서버 등록 또는 새 기항 API 적용 여부를 확인해 주세요."
              : "기항 기록 서버 연결을 확인해 주세요.",
          );
        const next = decodePortVisits(await response.json(), mmsi, days);
        if (!abort.signal.aborted) setData(next);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "기항 기록 조회 실패");
      } finally {
        clearTimeout(timer);
        if (!abort.signal.aborted) {
          setBusy(false);
          setOrb(false);
        }
      }
    })();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [owner, ready, eligible, source, mmsi, days, revision]);

  return (
    <section className="vessel-port-visits" aria-label="과거 기항 기록">
      <header className="vessel-port-visits-header">
        <div>
          <h3>
            <Anchor size={15} aria-hidden="true" /> 기항 기록
          </h3>
          <p>GFW 추정 · 석탄 선적항·확정 출발항과 다를 수 있습니다.</p>
        </div>
        <div className="vessel-port-visits-actions">
          <select
            aria-label="기항 기록 조회 기간"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setCount(5);
            }}
          >
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !ready || !eligible}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={14} />
            기항 기록 확인
          </Button>
        </div>
      </header>
      {orb && (
        <ProcessingOrb
          theme={theme}
          state="searching"
          label="기항 기록 조회 중"
        />
      )}
      {!eligible && (
        <p role="status">유효한 MMSI를 등록하면 조회할 수 있습니다.</p>
      )}
      {eligible && (!ready || !owner) && (
        <p role="status">관심 선박의 서버 등록을 기다리는 중입니다.</p>
      )}
      {location.protocol === "file:" && (
        <p role="status">
          기항 기록은 서버에 연결된 웹앱에서 조회할 수 있습니다.
        </p>
      )}
      {(error || shown?.message) && (
        <p role="status" className="vessel-port-visits-notice">
          {error || shown?.message}
          {error && !!shown?.visits.length
            ? " 이전 조회 기록을 표시합니다."
            : ""}
        </p>
      )}
      {shown && !!shown.visits.length && (
        <>
          <ol className="vessel-port-visits-list">
            {shown.visits.slice(0, count).map((visit) => (
              <li key={visit.id}>
                <div className="vessel-port-visits-port">
                  <strong>{visit.portName}</strong>
                  <span>{visit.country || "국가 미제공"}</span>
                </div>
                <div>
                  <span>추정 입항</span>
                  <time dateTime={visit.arrivalAt}>
                    {portDate(visit.arrivalAt)}
                  </time>
                </div>
                <div>
                  <span>추정 출항</span>
                  {visit.departureAt ? (
                    <time dateTime={visit.departureAt}>
                      {portDate(visit.departureAt)}
                    </time>
                  ) : (
                    <span className="vessel-port-visits-unknown">
                      출항 미확인
                    </span>
                  )}
                </div>
                <span className="vessel-port-visits-confidence">
                  신뢰도{" "}
                  {visit.confidence === 4
                    ? "높음"
                    : visit.confidence === 3
                      ? "보통"
                      : visit.confidence === 2
                        ? "낮음"
                        : "미제공"}
                </span>
              </li>
            ))}
          </ol>
          {shown.visits.length > count && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCount((n) => n + 5)}
            >
              기항 기록 더 보기 ({shown.visits.length - count}건)
            </Button>
          )}
        </>
      )}
      <footer>
        <p>
          <a
            href="https://globalfishingwatch.org/"
            target="_blank"
            rel="noreferrer"
          >
            Global Fishing Watch
          </a>{" "}
          ·{" "}
          <a
            href="https://creativecommons.org/licenses/by-nc/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-NC 4.0
          </a>{" "}
          · 약 72시간 반영 지연 · 시각 KST
        </p>
        {shown?.fetchedAt && (
          <p>
            조회 시각 {portDate(shown.fetchedAt)} ·{" "}
            {shown.matchBasis === "mmsi_imo"
              ? "MMSI·IMO 대조"
              : shown.matchBasis === "mmsi"
                ? "MMSI 대조 · IMO 교차 확인 안 됨"
                : "식별 미확정"}
            {shown.status === "stale" || error ? " · 이전 조회 자료" : ""}
          </p>
        )}
        <details>
          <summary>기록 해석과 조회 기준</summary>
          <p>
            입출항 시각과 신뢰도는 GFW가 AIS로 추정한 기항 이벤트입니다. 출항
            미확인은 현재 정박 중이라는 뜻이 아니며, 가장 최근 기록도 현재
            항차의 출발항을 보장하지 않습니다. 수신 범위·처리 지연으로 기록이
            빠질 수 있습니다.
          </p>
          <p>
            조회 결과는 서버에서 1시간 공유합니다. 과거 항적 좌표를 불러오거나
            항차·화물·ETA를 변경하지 않습니다. 이벤트를 항만명·시각·신뢰도로
            요약했습니다.
          </p>
          {shown && (
            <p>
              요청 범위 {shown.windowStart} ~ {shown.windowEnd} (UTC, 종료일
              제외) · 이 범위는 데이터 완전성을 보장하지 않습니다.
            </p>
          )}
          {!!shown?.datasets.length && (
            <p>데이터셋: {shown.datasets.join(", ")}</p>
          )}
        </details>
      </footer>
    </section>
  );
}
