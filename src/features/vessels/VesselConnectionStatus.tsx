import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { date } from "@/lib/format";
import { discoveryStatus, type DiscoverySnapshot } from "./vessel-discovery";

// Stream activity only: independent of an individual vessel's AIS freshness.
const STREAM_DELAY_MS = 60_000;
const compactLabels: Record<string, string> = {
  snapshot: "공개 AIS 조회 완료",
  cached_error: "공개 AIS 갱신 실패 · 이전 결과",
  unavailable: "공개 AIS 응답 실패",
  reconnecting: "AISstream 재연결 대기",
  provider_error: "AISstream 구독 오류",
};

export function VesselConnectionStatus({
  snapshot,
  loading,
  error,
  theme,
}: {
  snapshot: DiscoverySnapshot | null;
  loading: boolean;
  error: string;
  theme: "light" | "dark";
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const received = Date.parse(snapshot?.lastReceivedAt ?? "");
  const validReceived = Number.isFinite(received);
  const receiving =
    snapshot?.provider === "aisstream" && snapshot.status === "receiving";
  const recent =
    validReceived &&
    now - received <= STREAM_DELAY_MS &&
    received <= now + 5000;
  const connecting =
    snapshot?.provider === "aisstream" &&
    ["connecting", "waiting", "reconnecting"].includes(snapshot.status);
  const active =
    !error &&
    ((receiving && recent) ||
      connecting ||
      (loading && (!snapshot || snapshot.provider === "digitraffic")));
  const label = error
    ? "수신 상태 확인 실패"
    : receiving
      ? recent
        ? "AIS 메시지 수신 중"
        : "AIS 메시지 수신 지연"
      : loading && (!snapshot || snapshot.provider === "digitraffic")
        ? "선박 목록 불러오는 중"
        : snapshot
          ? (compactLabels[snapshot.status] ??
            discoveryStatus[snapshot.status] ??
            "수신 상태 확인 필요")
          : "수신 목록 확인 중";
  return (
    <div className="vessel-connection-status">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        title={
          snapshot && !error && !receiving
            ? discoveryStatus[snapshot.status]
            : undefined
        }
      >
        {active ? (
          <ThinkingOrb
            size={20}
            state={connecting ? "connecting" : "listening"}
            speed={0.65}
            theme={theme}
            aria-hidden="true"
          />
        ) : (
          <span className="vessel-connection-idle" aria-hidden="true" />
        )}
        <span>{label}</span>
      </div>
      {validReceived && (
        <span className="vessel-connection-timestamp">
          마지막 메시지 {date(snapshot!.lastReceivedAt!, true)} KST
        </span>
      )}
    </div>
  );
}
