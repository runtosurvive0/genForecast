import { freshness } from "@/domain/control-tower";

export function VesselFreshnessTag({
  observedAt,
  now,
}: {
  observedAt?: string;
  now: number;
}) {
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
