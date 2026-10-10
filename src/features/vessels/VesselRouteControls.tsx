import { Button } from "@/components/ui/button";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import type { useVesselRoute } from "./useVesselNavigation";
import { seaDistance } from "./vessel-navigation";

export function VesselRouteControls({
  vessel,
  navigation,
  trackingError,
}: {
  vessel: TrackingVessel;
  navigation: ReturnType<typeof useVesselRoute>;
  trackingError: string;
}) {
  const {
    destinationChoice,
    aisDestination,
    destinationError,
    setDestination,
    hours,
    setHours,
    error,
    refresh,
  } = navigation;
  return (
    <section className="vessel-route-controls" aria-label="실제 선박 항로 설정">
      <div className="vessel-route-fields">
        <label>
          목적항 기준
          <select
            aria-label="예상 항로 목적항"
            value={destinationChoice}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">목적항 선택</option>
            <option value="ais">AIS 목적지 기준</option>
            <option value="dangjin">당진 발전소 항만</option>
            <option value="boryeong">보령 발전소 항만</option>
            <option value="hadong">하동 발전소 항만</option>
            <option value="donghae">동해 발전소 항만</option>
          </select>
        </label>
        <label>
          수집 항적
          <select
            aria-label="수집 항적 기간"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value={24}>최근 24시간</option>
            <option value={168}>최근 7일</option>
            <option value={720}>최근 30일</option>
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={refresh}>
          항로·항적 갱신
        </Button>
      </div>
      <p>
        예상 항로 · 실제 운항계획 아님 · AIS 목적지:{" "}
        {vessel.ais?.destination || "미수신"}
      </p>
      {destinationChoice === "ais" && (
        <p role="status">
          {destinationError ||
            (aisDestination?.status === "resolved"
              ? `${aisDestination.name} · ${aisDestination.country} (${aisDestination.code}) · ${aisDestination.matchedBy === "code" ? "항만 코드" : "항만 이름"} 일치. AIS 입력값 기준이며 확정 목적항·발전소 부두를 뜻하지 않습니다.`
              : !vessel.ais?.destination?.trim()
                ? "AIS 목적지 미수신 · 목적항을 직접 선택하거나 다음 수신을 기다려 주세요."
                : !aisDestination
                  ? "AIS 목적항 확인 중…"
                  : "AIS 목적지를 하나의 항만으로 확인할 수 없습니다. 목적항을 직접 선택해 주세요.")}
        </p>
      )}
      {(error || trackingError) && (
        <p className="vessel-workflow-error" role="status">
          {error || trackingError}
        </p>
      )}
    </section>
  );
}

export function VesselRouteSummary({
  vessel,
  navigation,
  theme,
}: {
  vessel: TrackingVessel;
  navigation: ReturnType<typeof useVesselRoute>;
  theme: "light" | "dark";
}) {
  const { destination, route, history, busy } = navigation;
  return (
    <section className="vessel-route-overview" aria-label="항로 정보">
      <div className="vessel-route-metrics">
        {busy ? (
          <ProcessingOrb
            state="solving"
            label="해상 예상 항로 계산 중"
            theme={theme}
          />
        ) : (
          <p className="vessel-route-summary">
            {!vessel.ais?.position
              ? "위치를 수신하면 예상 항로를 계산합니다."
              : !destination
                ? "목적항을 확인하면 예상 항로를 점선으로 표시합니다."
                : route
                  ? `예상 해상거리 ${Math.round(route.distanceNm).toLocaleString("ko-KR")} nm · searoute 계산`
                  : "예상 항로 대기"}
          </p>
        )}
        <p>
          {history
            ? `수집 기록 ${history.pointCount.toLocaleString("ko-KR")}개${history.truncated ? " · 최근 5,000개만 표시" : ""}`
            : "항적 수신 대기"}{" "}
        </p>
      </div>
      <details className="vessel-route-explanation">
        <summary>항로 정보 · 계산 기준</summary>
        <p>목적항 선택은 예상 항로용이며 항차·화물 계획을 변경하지 않습니다.</p>
        {route && vessel.ais?.position && (
          <p>{`현재 위치 연결 ${seaDistance([vessel.ais.position.longitude, vessel.ais.position.latitude], route.coordinates[0]).toFixed(1)} nm · 목적항 끝점 차이 ${route.endOffsetNm.toFixed(1)} nm`}</p>
        )}
        <p>
          서버가 수집한 기록부터 표시하며, 6시간 이상 관측 공백은 연결하지
          않습니다.
        </p>
        <p>
          점선은 해상 항로망 기반 추정이며 확정 운항계획·정밀 입항 경로가
          아닙니다. 수신 위치가 25 nm 이상 이동하거나 6시간이 지나면 다음
          갱신에서 재계산합니다.
          {navigation.routes.some((r) => r.kind === "connector") &&
            " 가는 점 연결선은 위치 안내용이며 항해 가능한 경로를 뜻하지 않습니다. 표시 해상거리에는 포함하지 않습니다."}
        </p>
      </details>
    </section>
  );
}
