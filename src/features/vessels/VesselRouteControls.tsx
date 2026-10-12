import { ProcessingOrb } from "@/components/ProcessingOrb";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import type { useVesselRoute } from "./useVesselNavigation";
import {
  remainingDistance,
  routeGapReasons,
  ROUTE_OFFSET_LIMIT_NM,
  PORT_OFFSET_LIMIT_NM,
} from "./vessel-basic-eta";

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
    error,
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
            <option value="donghae">동해 발전소 항만</option>
            {["boryeong", "hadong"].includes(destinationChoice) && (
              <option value={destinationChoice} disabled>
                {destinationChoice === "boryeong" ? "보령" : "하동"} · 이전 선택
              </option>
            )}
          </select>
        </label>
      </div>
      {destinationChoice === "ais" && (
        <p role="status">
          {destinationError ||
            (aisDestination?.status === "resolved"
              ? `${aisDestination.name} (${aisDestination.code}) · AIS 입력 기준 · 예상 항로`
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
  const position = vessel.ais?.position;
  const current: [number, number] | undefined = position
    ? [position.longitude, position.latitude]
    : undefined;
  const gaps = route && current ? routeGapReasons(route, current) : [];
  const remaining =
    route && current
      ? remainingDistance(
          route,
          current,
          position?.sogKn != null && position.sogKn >= 0.5
            ? position.cogDeg
            : null,
        )
      : null;
  return (
    <section className="vessel-route-overview" aria-label="항로 정보">
      <div className="vessel-route-metrics">
        {busy ? (
          <ProcessingOrb
            state="solving"
            label="해상 예상 항로 계산 중"
            theme={theme}
          />
        ) : !route ? (
          <p>
            {!vessel.ais?.position
              ? "위치를 수신하면 예상 항로를 계산합니다."
              : !destination
                ? "목적항을 확인하면 예상 항로를 점선으로 표시합니다."
                : "예상 항로 대기"}
          </p>
        ) : null}
        <p>
          {history
            ? `수집 기록 ${history.pointCount.toLocaleString("ko-KR")}개${history.truncated ? " · 최근 5,000개만 표시" : ""}`
            : "항적 수신 대기"}{" "}
        </p>
      </div>
      {route && current && route.startOffsetNm > ROUTE_OFFSET_LIMIT_NM && (
        <p role="status">
          출발 연결 {remaining?.connectionNm.toFixed(1)} nm · 직선 거리와 현재
          속도를 가정해 ETA에 포함합니다. 실제 연결 항로는 미확인입니다.
        </p>
      )}
      {gaps.length > 0 && (
        <div
          className="vessel-route-gap-notice"
          role="status"
          aria-label="항로 연결 확인"
        >
          {gaps.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <details className="vessel-route-explanation">
        <summary>항로 정보 · 계산 기준</summary>
        {route && (
          <p className="vessel-route-summary">
            예상 해상거리 {Math.round(route.distanceNm).toLocaleString("ko-KR")}{" "}
            nm · searoute 계산
          </p>
        )}
        <p>
          AIS 목적지는 선박 입력값으로 해석한 항만이며 확정 목적항·발전소 부두를
          뜻하지 않습니다. 예상 항로는 실제 운항계획이 아닙니다.
        </p>
        <p>목적항 선택은 예상 항로용이며 항차·화물 계획을 변경하지 않습니다.</p>
        {route && current && (
          <>
            <p>{`계산 당시 출발 연결 ${route.startOffsetNm.toFixed(1)} nm (거리만으로 보류하지 않음) · 목적항 진입 공백 ${route.endOffsetNm.toFixed(1)} nm / 기준 ${PORT_OFFSET_LIMIT_NM.toFixed(1)} nm`}</p>
            <p>{`현재 위치 → 항로 최단 거리 ${remaining?.offsetNm.toFixed(1)} nm / 기준 ${ROUTE_OFFSET_LIMIT_NM.toFixed(1)} nm · 남은 항로 연결 ${remaining?.connectionNm.toFixed(1)} nm`}</p>
            <p>
              현재 위치와 진행 방향으로 지나온 지점을 제외합니다. 통과 시각은
              최신 위치·속도를 반영해 30초마다 갱신하며, 기상 예보는 서버 캐시를
              재사용합니다.
            </p>
            <p>
              출발 연결은 참고용 추정으로 포함합니다. 목적항 진입 공백·갱신이
              필요한 이전 항로는 계산을 보류합니다. 앱의 계산 기준이며 공식 항해
              기준·육지 충돌 판정이 아닙니다.
            </p>
          </>
        )}
        <p>
          서버가 수집한 기록부터 표시하며, 6시간 이상 관측 공백은 연결하지
          않습니다.
        </p>
        <p>
          점선은 해상 항로망 기반 추정이며 확정 운항계획·정밀 입항 경로가
          아닙니다. 현재 위치가 계산된 항로에서 5 nm 넘게 벗어나거나, 계산
          위치에서 25 nm 이상 이동하거나, 6시간이 지나면 다음 관측 갱신에서
          재계산합니다. 출발 연결 공백이 큰 새 항로는 반복 요청하지 않고 5 nm
          이동·6시간 경과 또는 수동 갱신 시 다시 확인합니다.
          {navigation.routes.some((r) => r.kind === "connector") &&
            " 가는 점 연결선은 위치 안내용이며 항해 가능한 경로를 뜻하지 않습니다. 항로망 해상거리와 구분하고 ETA에는 연결 거리 가정을 더합니다."}
        </p>
      </details>
    </section>
  );
}
