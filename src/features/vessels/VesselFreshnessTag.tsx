import { freshness } from "@/domain/control-tower";

export function VesselFreshnessTag({
  observedAt,
  now,
  synthetic = false,
}: {
  observedAt?: string;
  now: number;
  /** 시연용 합성 선박: 관측 최신성(LIVE 등)을 보이지 않는다. */
  synthetic?: boolean;
}) {
  if (synthetic) return <span className="tower-tag vessel-freshness-tag" title="합성 위치 · 실제 관측 아님">모의 위치</span>;
  const state = observedAt ? freshness(observedAt, now) : "미수신";
  return (
    <span
      className="tower-tag vessel-freshness-tag"
      title={state === "LIVE" ? "최근 10분 이내 위치 관측" : undefined}
    >
      {state === "LIVE" && (
        <span className="vessel-live-light" aria-hidden="true" />
      )}
      {state}
    </span>
  );
}
