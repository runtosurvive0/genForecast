import type {
  TrackingVessel,
  TrackingVoyage,
} from "../../domain/vessel-workflow.ts";
import { validPosition, type Coordinate } from "./map-data.ts";
import {
  seaDistance,
  remainingRoute,
  type EstimatedRoute,
  type TrackHistory,
} from "./vessel-navigation.ts";

export interface BasicEta {
  eta: string | null;
  state: "ready" | "pending" | "blocked";
  reason: string;
  distanceNm: number | null;
  speedKn: number | null;
  destinationId: string;
  // A preview does not revise the registered voyage's baseline or unloading ledger.
  deltaH: null;
}

const HOUR = 3600000;
export const usesAutomaticEta = (vessel: TrackingVessel) =>
  vessel.source === "aisstream" ||
  vessel.source === "digitraffic" ||
  Boolean(vessel.ais);
export const remainingDistance = remainingRoute;

// Product preview limits, not navigational safety or AIS validity thresholds.
export const ROUTE_OFFSET_LIMIT_NM = 5;
export const PORT_OFFSET_LIMIT_NM = 20;

export function routeGapReasons(route: EstimatedRoute, current: Coordinate) {
  const reasons: string[] = [];
  if (route.endOffsetNm > PORT_OFFSET_LIMIT_NM)
    reasons.push(
      `목적항 진입 구간 미확인: 항로 끝점 → 목적항 ${route.endOffsetNm.toFixed(1)} nm (보류 기준 ${PORT_OFFSET_LIMIT_NM.toFixed(1)} nm 초과). 상세 항만 진입 경로가 필요합니다.`,
    );
  const offset = remainingDistance(route, current).offsetNm;
  // A sparse starting connection is not evidence that the vessel left a route.
  if (
    route.startOffsetNm <= ROUTE_OFFSET_LIMIT_NM &&
    offset > ROUTE_OFFSET_LIMIT_NM
  )
    reasons.push(
      `현재 항로 이탈: 현재 위치 → 계산된 항로 ${offset.toFixed(1)} nm (보류 기준 ${ROUTE_OFFSET_LIMIT_NM.toFixed(1)} nm 초과). 예상 항로를 재계산한 뒤 확인해 주세요. 실제 운항계획 이탈을 뜻하지 않습니다.`,
    );
  return reasons;
}

export function canReuseVesselRoute(
  route: EstimatedRoute,
  current: Coordinate,
  calculatedAt: number,
  now: number,
) {
  const movement = seaDistance(route.origin, current);
  if (now < calculatedAt || now - calculatedAt >= 6 * HOUR || movement >= 25)
    return false;
  // Repeated polling cannot repair a freshly calculated network coverage gap.
  if (route.startOffsetNm > ROUTE_OFFSET_LIMIT_NM)
    return movement < ROUTE_OFFSET_LIMIT_NM;
  return remainingDistance(route, current).offsetNm <= ROUTE_OFFSET_LIMIT_NM;
}

export function estimateBasicEta({
  vessel,
  destination,
  route,
  now,
  routeCalculatedAt,
  history,
  voyageState,
}: {
  vessel: TrackingVessel;
  destination: string;
  route?: EstimatedRoute;
  now: number;
  routeCalculatedAt?: number;
  history?: TrackHistory;
  voyageState?: TrackingVoyage["state"];
}): BasicEta {
  const empty = (
    reason: string,
    state: BasicEta["state"] = "blocked",
  ): BasicEta => ({
    eta: null,
    state,
    reason,
    distanceNm: null,
    speedKn: null,
    destinationId: destination,
    deltaH: null,
  });
  if (!destination)
    return empty(
      "지도 위에서 목적항을 선택하면 기본 ETA를 계산합니다.",
      "pending",
    );
  if (voyageState && voyageState !== "underway") {
    return empty(
      voyageState === "planned"
        ? "출항 예정 항차입니다. 등록 ETD·계획 속도에 따른 일정은 아래 항차 계획에서 확인해 주세요."
        : voyageState === "arrived"
          ? "입항 확인된 항차입니다. 등록 입항 시각은 아래 항차 계획에서 확인해 주세요."
          : voyageState === "cancelled"
            ? "취소된 항차입니다. 새 항차를 확인해 주세요."
            : "정지·묘박 항차입니다. 재출발을 확인한 뒤 계산합니다.",
    );
  }
  const position = vessel.ais?.position;
  if (!position) return empty("실제 AIS 위치·속도 수신이 필요합니다.");
  const observed = Date.parse(position.observedAt);
  if (
    !validPosition(position) ||
    !Number.isFinite(observed) ||
    !Number.isFinite(now) ||
    observed > now
  )
    return empty(
      "위치 또는 관측 시각을 확인해 주세요. 유효하지 않은 관측은 계산에서 제외합니다.",
    );
  if (now - observed > HOUR)
    return empty(
      "위치 관측이 1시간보다 오래되었습니다. 최신 AIS 수신 후 계산합니다.",
    );
  if ([1, 5, 6].includes(vessel.ais?.navStatus ?? -1))
    return empty(
      "정박·묘박 또는 좌초 상태입니다. 항해 재개를 확인한 뒤 계산합니다.",
    );
  const speed = position.sogKn;
  if (speed == null || !Number.isFinite(speed))
    return empty("항해 속도(SOG)를 수신하면 계산합니다.");
  if (speed < 0.5)
    return empty("정지 또는 저속 관측입니다. 안정적인 항해 속도가 필요합니다.");
  const cargo =
    (vessel.ais?.shipType ?? 0) >= 70 && (vessel.ais?.shipType ?? 0) < 90;
  // Conservative preview policy, not a claim that every higher speed is invalid AIS.
  if (speed > (cargo ? 40 : 60))
    return empty(
      "보고 속도가 자동 계산의 검토 기준을 넘었습니다. AIS 속도를 확인해 주세요.",
    );
  const previous = history?.segments
    .flat()
    .filter((p) => Date.parse(p.observedAt) < observed)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  if (previous) {
    const elapsed = (observed - Date.parse(previous.observedAt)) / HOUR;
    if (
      elapsed <= 6 &&
      seaDistance(
        [previous.longitude, previous.latitude],
        [position.longitude, position.latitude],
      ) >
        1 + elapsed * 60
    )
      return empty(
        "이전 관측과 위치 차이가 큽니다. AIS 위치 확인 후 계산합니다.",
      );
  }
  if (!route || route.destinationId !== destination)
    return empty("선택한 목적항의 예상 항로를 준비하고 있습니다.", "pending");
  if (
    routeCalculatedAt == null ||
    !Number.isFinite(routeCalculatedAt) ||
    now - routeCalculatedAt > 6 * HOUR
  )
    return empty(
      "예상 항로 계산이 오래되었습니다. 항로·항적 갱신 후 계산합니다.",
    );
  if (!Number.isFinite(route.distanceNm) || route.distanceNm < 0)
    return empty("예상 항로 거리를 확인해 주세요.");
  const gapReasons = routeGapReasons(route, [
    position.longitude,
    position.latitude,
  ]);
  if (gapReasons.length) return empty(gapReasons.join(" "));
  const remaining = remainingDistance(route, [
    position.longitude,
    position.latitude,
  ], position.cogDeg);
  const arrival = observed + (remaining.distanceNm / speed) * HOUR;
  if (
    !Number.isFinite(arrival) ||
    Math.abs(arrival) > 8.64e15 ||
    arrival <= now
  )
    return empty(
      "관측 기준 예상 시각이 이미 지났거나 계산할 수 없습니다. 최신 위치·입항 여부를 확인해 주세요.",
    );
  return {
    eta: new Date(Math.round(arrival)).toISOString(),
    state: "ready",
    distanceNm: remaining.distanceNm,
    speedKn: speed,
    destinationId: destination,
    deltaH: null,
    reason: `마지막 위치 관측 시각 + 예상 잔여거리 ${remaining.distanceNm.toFixed(1)} nm ÷ SOG ${speed.toFixed(1)} kn. 기상 미반영 · 현재 속도 유지 가정. ${remaining.connectionNm > 0.1 ? `출발 연결 ${remaining.connectionNm.toFixed(1)} nm는 직선 거리 가정으로 포함한 참고용 ETA입니다. 연결 구간의 실제 항해 경로는 미확인입니다. ` : ""}항로망 끝점 기준이며 항만 진입·접안 대기는 제외합니다.`,
  };
}
