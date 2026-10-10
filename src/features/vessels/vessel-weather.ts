import type { TrackingVessel, TrackingVoyage } from "@/domain/vessel-workflow";
import { validPosition } from "./map-data.ts";

export interface ForecastPoint {
  longitude: number;
  latitude: number;
  passageAt: string;
  waveM: number | null;
  windKn: number | null;
  gustKn: number | null;
  windFromDeg: number | null;
  waveFromDeg: number | null;
  wavePeriodS: number | null;
  /** Optional for older servers; metres, zero is valid. */
  visibilityM?: number | null;
  airStatus: "fresh" | "stale" | "missing" | "limited";
  marineStatus: "fresh" | "stale" | "missing" | "limited";
  airFetchedAt: string | null;
  marineFetchedAt: string | null;
  airForecastAt: string | null;
  marineForecastAt: string | null;
  forecastIssuedAt: string | null;
}
export interface VesselForecast {
  source: string;
  mmsi: string;
  destinationId: string;
  status: "ready" | "partial" | "unavailable" | "blocked";
  reason: string;
  observedAt: string | null;
  fetchedAt: string;
  horizonHours: number;
  /** AIS SOG used by the server to assign passage times; absent on older servers. */
  speedKn?: number | null;
  points: ForecastPoint[];
}
export interface ForecastState {
  status: VesselForecast["status"] | "waiting" | "loading" | "error";
  reason: string;
  data?: VesselForecast;
}
export function forecastUsable(data: VesselForecast, now = Date.now()) {
  return [
    data.fetchedAt,
    ...data.points.flatMap((p) => [p.airFetchedAt, p.marineFetchedAt]),
  ]
    .filter((at): at is string => at !== null)
    .every(
      (at) => now - Date.parse(at) >= 0 && now - Date.parse(at) <= 6 * 3600000,
    );
}
export const forecastLabels: Record<ForecastState["status"], string> = {
  ready: "기상 확인",
  partial: "기상 일부 확인",
  unavailable: "기상 자료 없음",
  blocked: "기상 확인 보류",
  waiting: "기상 대기",
  loading: "기상 조회 중",
  error: "기상 조회 실패",
};
export const forecastKey = (v: TrackingVessel, destination: string) =>
  `${v.source}/${v.mmsi}/${destination}`;
export function weatherBlock(
  v: TrackingVessel,
  destination: string,
  state?: TrackingVoyage["state"],
): string {
  if (!destination) return "지도 위에서 확인한 목적항을 지정해 주세요.";
  if (state && state !== "underway")
    return "등록 항차가 항해 중이 아닙니다. 출항·입항 상태를 확인해 주세요.";
  const p = v.ais?.position;
  if (!p || !validPosition(p)) return "실제 AIS 위치 수신이 필요합니다.";
  const age = Date.now() - Date.parse(p.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 3600000)
    return "최근 1시간 이내 AIS 관측이 필요합니다.";
  if (
    p.sogKn == null ||
    !Number.isFinite(p.sogKn) ||
    p.sogKn < 0.5 ||
    [1, 5, 6].includes(v.ais?.navStatus ?? -1)
  )
    return "정박·저속 또는 속도 미수신 상태입니다.";
  return "";
}
export function decodeForecast(
  value: unknown,
  vessel: TrackingVessel,
  destination: string,
): VesselForecast {
  const data = value as VesselForecast;
  const date = (v: unknown) =>
    typeof v === "string" && Number.isFinite(Date.parse(v));
  if (
    !data ||
    data.source !== vessel.source ||
    data.mmsi !== vessel.mmsi ||
    data.destinationId !== destination ||
    !["ready", "partial", "unavailable", "blocked"].includes(data.status) ||
    !date(data.fetchedAt) ||
    !(data.observedAt === null || date(data.observedAt)) ||
    typeof data.reason !== "string" ||
    data.horizonHours !== 72 ||
    (data.speedKn != null &&
      (typeof data.speedKn !== "number" ||
        !Number.isFinite(data.speedKn) ||
        data.speedKn < 0.5 ||
        data.speedKn > 60)) ||
    !Array.isArray(data.points) ||
    data.points.length > 12
  )
    throw new Error("기상 응답의 선박·목적항을 확인해 주세요.");
  for (const p of data.points) {
    if (!validPosition(p) || !date(p.passageAt))
      throw new Error("기상 좌표·시각 형식 오류");
    if (
      p.visibilityM != null &&
      (typeof p.visibilityM !== "number" ||
        !Number.isFinite(p.visibilityM) ||
        p.visibilityM < 0)
    )
      throw new Error("시정 값 형식 오류");
    for (const key of [
      "waveM",
      "windKn",
      "gustKn",
      "windFromDeg",
      "waveFromDeg",
      "wavePeriodS",
    ] as const) {
      const n = p[key];
      if (
        n !== null &&
        (typeof n !== "number" ||
          !Number.isFinite(n) ||
          n < 0 ||
          (key.endsWith("Deg") && n > 360))
      )
        throw new Error("기상 값 형식 오류");
    }
    for (const kind of ["air", "marine"] as const) {
      if (
        !["fresh", "stale", "missing", "limited"].includes(p[`${kind}Status`])
      )
        throw new Error("기상 최신성 형식 오류");
      for (const time of [p[`${kind}FetchedAt`], p[`${kind}ForecastAt`]])
        if (time !== null && !date(time))
          throw new Error("기상 기준시각 형식 오류");
    }
  }
  return data;
}
