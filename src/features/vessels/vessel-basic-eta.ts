import type {
  TrackingVessel,
  TrackingVoyage,
} from "../../domain/vessel-workflow.ts";
import { validPosition, type Coordinate } from "./map-data.ts";
import {
  seaDistance,
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
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** Project onto the cached polyline, measuring the remaining fraction along it.
 * Longitude differences wrap at the dateline; guide lines never add sea distance.
 */
function remainingDistance(route: EstimatedRoute, current: Coordinate) {
  let total = 0,
    along = 0,
    nearest = Infinity,
    nearestAlong = 0;
  for (let i = 1; i < route.coordinates.length; i++) {
    const a = route.coordinates[i - 1],
      b = route.coordinates[i];
    const length = seaDistance(a, b);
    const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const x = wrap(b[0] - a[0]) * scale,
      y = b[1] - a[1];
    const px = wrap(current[0] - a[0]) * scale,
      py = current[1] - a[1];
    const t =
      x * x + y * y > 0
        ? Math.max(0, Math.min(1, (px * x + py * y) / (x * x + y * y)))
        : 0;
    const projected: Coordinate = [
      wrap(a[0] + wrap(b[0] - a[0]) * t),
      a[1] + y * t,
    ];
    const separation = seaDistance(current, projected);
    if (separation < nearest) {
      nearest = separation;
      nearestAlong = along + length * t;
    }
    along += length;
    total += length;
  }
  const unchanged = seaDistance(current, route.origin) <= 0.1;
  return {
    offsetNm: nearest,
    distanceNm: unchanged
      ? route.distanceNm
      : total > 0
        ? route.distanceNm * Math.max(0, 1 - nearestAlong / total)
        : 0,
  };
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
  if (route.startOffsetNm > 5 || route.endOffsetNm > 20)
    return empty(
      "관측 위치·목적항과 항로망의 차이가 큽니다. 위치와 항로를 확인해 주세요.",
    );
  const remaining = remainingDistance(route, [
    position.longitude,
    position.latitude,
  ]);
  if (remaining.offsetNm > 5)
    return empty(
      "현재 위치가 예상 항로에서 벗어났습니다. 항로·항적 갱신 후 확인해 주세요.",
    );
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
    reason: `마지막 위치 관측 시각 + 예상 잔여거리 ${remaining.distanceNm.toFixed(1)} nm ÷ SOG ${speed.toFixed(1)} kn. 기상 미반영 · 현재 속도 유지 가정. 항로망 끝점 기준이며 위치 연결선·항만 진입·접안 대기는 제외합니다.`,
  };
}
