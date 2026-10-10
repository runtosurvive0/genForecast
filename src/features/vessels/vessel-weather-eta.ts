import type { TrackingVessel } from "../../domain/vessel-workflow.ts";
import type { BasicEta } from "./vessel-basic-eta.ts";
import type { ForecastPoint, VesselForecast } from "./vessel-weather.ts";
import { seaDistance } from "./vessel-navigation.ts";

const HOUR = 3600000;
const radians = (n: number) => (n * Math.PI) / 180;
const wrap = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

export interface WeatherEta {
  state: "ready" | "partial" | "blocked";
  eta: string | null;
  delayH: number | null;
  coveredH: number;
  uncoveredH: number;
  maxSlowdownPct: number;
  reason: string;
  segments: { from: string; to: string; delayH: number; slowdownPct: number }[];
}

// Demonstration assumptions, not fitted coefficients or a ship performance model.
// The factors intentionally remain inspectable in the UI and feature documentation.
function heading(a: ForecastPoint, b: ForecastPoint) {
  const delta = radians(wrap(b.longitude - a.longitude));
  const p = radians(a.latitude),
    q = radians(b.latitude);
  return (
    ((Math.atan2(
      Math.sin(delta) * Math.cos(q),
      Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(delta),
    ) *
      180) /
      Math.PI +
      360) %
    360
  );
}
function burden(p: ForecastPoint, course: number, sensitivity: number) {
  const direction = (from: number) =>
    0.5 + 0.5 * Math.max(0, Math.cos(radians(wrap(from - course))));
  return Math.min(
    0.3,
    sensitivity *
      (Math.max(0, p.waveM! - 1.5) * 0.04 * direction(p.waveFromDeg!) +
        Math.max(0, p.windKn! - 15) * 0.002 * direction(p.windFromDeg!)),
  );
}
function usable(p: ForecastPoint, now: number) {
  // Stronger requirements than the map: old/partial values can be displayed there,
  // but never silently converted into an ETA or zero weather penalty here.
  return (
    [p.waveM, p.windKn, p.windFromDeg, p.waveFromDeg].every(finite) &&
    p.waveM! >= 0 &&
    p.waveM! <= 8 &&
    p.windKn! >= 0 &&
    p.windKn! <= 50 &&
    (p.gustKn === null ||
      (finite(p.gustKn) && p.gustKn >= 0 && p.gustKn <= 65)) &&
    [p.windFromDeg!, p.waveFromDeg!].every((n) => n >= 0 && n <= 360) &&
    (["air", "marine"] as const).every((kind) => {
      const fetched = Date.parse(p[`${kind}FetchedAt`] ?? "");
      const validAt = Date.parse(p[`${kind}ForecastAt`] ?? "");
      return (
        p[`${kind}Status`] === "fresh" &&
        finite(fetched) &&
        now >= fetched &&
        now - fetched < 3 * HOUR &&
        finite(validAt) &&
        Math.abs(validAt - Date.parse(p.passageAt)) <= HOUR / 2
      );
    })
  );
}

/** One-pass sensitivity scenario using forecasts at BASELINE passage times.
 * It does not re-query weather at delayed times or alter a voyage/stock ledger.
 */
export function estimateWeatherEta({
  vessel,
  basic,
  forecast,
  now,
  sensitivity = 1,
}: {
  vessel: TrackingVessel;
  basic?: BasicEta;
  forecast?: VesselForecast;
  now: number;
  sensitivity?: number;
}): WeatherEta {
  const blocked = (reason: string): WeatherEta => ({
    state: "blocked",
    eta: null,
    delayH: null,
    coveredH: 0,
    uncoveredH: 0,
    maxSlowdownPct: 0,
    reason,
    segments: [],
  });
  if (!basic?.eta || basic.state !== "ready")
    return blocked("기본 ETA가 계산된 후 기상 보정을 적용합니다.");
  if (!finite(sensitivity) || sensitivity < 0 || sensitivity > 1.5)
    return blocked("감속 민감도는 0~1.5배 범위로 설정해 주세요.");
  if (!forecast || !["ready", "partial"].includes(forecast.status))
    return blocked("사용 가능한 항로 예보를 기다리고 있습니다.");
  if (
    forecast.source !== vessel.source ||
    forecast.mmsi !== vessel.mmsi ||
    forecast.destinationId !== basic.destinationId
  )
    return blocked("선박 또는 목적항이 달라 기상 보정을 보류합니다.");
  const p = vessel.ais?.position;
  if (!finite(forecast.speedKn) || forecast.speedKn < .5 || forecast.speedKn > 60)
    return blocked("예보 계산 기준 속도가 없습니다. 서버 업데이트 후 기상을 갱신해 주세요.");
  if (!finite(p?.sogKn) || Math.abs(p.sogKn - forecast.speedKn) > Math.max(.1, forecast.speedKn * .02))
    return blocked("예보 계산 이후 선박 속도가 달라졌습니다. 기상 갱신 후 새 통과 시각으로 보정합니다.");
  const observed = Date.parse(p?.observedAt ?? ""),
    forecastObserved = Date.parse(forecast.observedAt ?? "");
  const fetched = Date.parse(forecast.fetchedAt),
    arrival = Date.parse(basic.eta);
  if (
    !p ||
    ![now, observed, forecastObserved, fetched, arrival].every(finite) ||
    now < observed ||
    now - observed > HOUR ||
    now < forecastObserved ||
    now - forecastObserved > 15 * 60000 ||
    Math.abs(observed - forecastObserved) > 15 * 60000 ||
    now < fetched ||
    now - fetched >= 3 * HOUR ||
    arrival <= now
  )
    return blocked(
      "AIS와 기상 기준시각을 확인해 주세요. 통과 예보는 15분 이내 자료로 갱신해야 합니다.",
    );
  const points = forecast.points;
  if (
    points.length < 2 ||
    points.length > 12 ||
    points.some(
      (point, i) =>
        ![point.longitude, point.latitude, Date.parse(point.passageAt)].every(
          finite,
        ) ||
        Math.abs(point.latitude) > 85 ||
        Math.abs(point.longitude) > 180 ||
        (i > 0 &&
          Date.parse(point.passageAt) <= Date.parse(points[i - 1].passageAt)),
    ) ||
    Math.abs(Date.parse(points[0].passageAt) - forecastObserved) > 1000 ||
    Date.parse(points.at(-1)!.passageAt) - forecastObserved > 72 * HOUR + 1000
  )
    return blocked("항로 예보의 좌표·통과 시각 순서가 유효하지 않습니다.");
  if (
    seaDistance(
      [p.longitude, p.latitude],
      [points[0].longitude, points[0].latitude],
    ) > 5
  )
    return blocked(
      "예보 출발점과 현재 선박 위치가 달라 기상 갱신이 필요합니다.",
    );
  if (!usable(points[0], now))
    return blocked(
      "현재 지점의 신선한 파고·바람·방향 예보가 없거나 시연 모델 범위 밖입니다.",
    );
  const firstCourse =
    finite(p.cogDeg) && p.cogDeg >= 0 && p.cogDeg < 360
      ? p.cogDeg
      : heading(points[0], points[1]);
  const currentBurden = burden(points[0], firstCourse, sensitivity);
  let coveredH = 0,
    delayH = 0,
    maxSlowdownPct = 0;
  const segments: WeatherEta["segments"] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const from = Math.max(now, Date.parse(a.passageAt)),
      to = Math.min(arrival, Date.parse(b.passageAt));
    if (
      to <= from ||
      !usable(a, now) ||
      !usable(b, now) ||
      seaDistance([a.longitude, a.latitude], [b.longitude, b.latitude]) < 0.001
    )
      continue;
    const course = heading(a, b);
    const segmentBurden =
      (burden(a, course, sensitivity) + burden(b, course, sensitivity)) / 2;
    // Current SOG already includes today's conditions. Only extra burden causes delay.
    const reduction = Math.max(
      0,
      (segmentBurden - currentBurden) / (1 - currentBurden),
    );
    const hours = (to - from) / HOUR;
    const extra = (hours * reduction) / (1 - reduction);
    coveredH += hours;
    delayH += extra;
    maxSlowdownPct = Math.max(maxSlowdownPct, reduction * 100);
    segments.push({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      delayH: extra,
      slowdownPct: reduction * 100,
    });
  }
  if (!coveredH)
    return blocked(
      "보정 가능한 예보 구간이 없습니다. 누락·오래된 자료 또는 시연 모델 범위를 확인해 주세요.",
    );
  const uncoveredH = Math.max(0, (arrival - now) / HOUR - coveredH);
  const partial = uncoveredH > 1 / 3600;
  const eta = arrival + delayH * HOUR;
  if (!finite(eta) || Math.abs(eta) > 8.64e15)
    return blocked("보정 도착 시각을 계산할 수 없습니다.");
  return {
    state: partial ? "partial" : "ready",
    eta: new Date(Math.round(eta)).toISOString(),
    delayH,
    coveredH,
    uncoveredH,
    maxSlowdownPct,
    segments,
    reason: partial
      ? "일부 구간만 보정했습니다. 예보 누락·범위 밖 구간은 기본 SOG 유지로 남아 있으며 지연이 더 생길 수 있습니다."
      : delayH > 0.001
        ? "현재 지점보다 커지는 파고·바람 부담을 구간별 추가 감속으로 반영했습니다."
        : "이 가정에서는 현재 지점 대비 추가 기상 지연이 계산되지 않았습니다. 안전한 항해를 뜻하지 않습니다.",
  };
}
