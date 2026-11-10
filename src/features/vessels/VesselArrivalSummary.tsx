import { ChevronRight, Info } from "lucide-react";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { Metric } from "@/components/tower/primitives";
import { Button } from "@/components/ui/button";
import { freshness } from "@/domain/control-tower";
import {
  estimateArrival,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { number as n } from "@/lib/format";
import type { BasicEta } from "./vessel-basic-eta";
import type { WeatherEta } from "./vessel-weather-eta";
import type { ForecastState } from "./vessel-weather";
import { etaDate } from "./VesselEtaDetail";
import { vesselSourceLabel } from "./vessel-source";
import type { BerthRegistry, Observation } from "@/domain/berth-ais";
import { berthDisplay } from "./vessel-berth-display";

export function VesselArrivalSummary({
  vessel,
  voyage,
  now,
  basic,
  weather,
  forecast,
  unverifiedConnection,
  onShowBasis,
  berthObservation,
  registry,
  observationLoading = false,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  now: number;
  basic?: BasicEta;
  weather?: WeatherEta;
  forecast?: ForecastState;
  unverifiedConnection?: boolean;
  onShowBasis: () => void;
  berthObservation?: Observation;
  registry?: BerthRegistry | null;
  observationLoading?: boolean;
}) {
  const berth = berthDisplay(vessel, berthObservation, registry ?? null, now);
  const registered = voyage ? estimateArrival(voyage) : undefined;
  const baseline = basic ? basic.eta : registered?.eta;
  const eta = weather?.eta ?? baseline;
  const loadingArrival = observationLoading && !berth && !eta;
  const position = vessel.ais?.position ?? voyage?.position;
  const distance = basic ? basic.distanceNm : voyage?.distanceNm;
  const speed = position?.sogKn;
  const validSpeed =
    speed != null && Number.isFinite(speed) && speed >= 0 && speed < 102.3;
  const source =
    vessel.source === "demo"
      ? "시연 자료 · 실제 운영 정보 아님"
      : vessel.source === "digitraffic"
        ? "Digitraffic · 핀란드"
        : vessel.ais
          ? vesselSourceLabel(vessel)
          : "직접 등록 · 관측 미연결";
  const method = weather?.eta
    ? `${weather.state === "partial" ? "부분 " : ""}기상 보정 · 시연 모델`
    : basic
      ? "기본 ETA · 기상 미반영"
      : registered?.method === "actual"
        ? "등록 입항 시각"
        : "등록 가정 전망";
  const reason = berth
    ? berth.observation.stale
      ? "부두 인근의 마지막 위치입니다. 현재 접안 여부와 실제 시각은 확인이 필요합니다."
      : berth.observation.estimated
        ? "AIS 위치와 저속을 기준으로 접안을 추정합니다."
        : "부두 인근에서 관측됐으나 접안 여부는 확인이 필요합니다."
    : !position
    ? "실시간 위치 미수신 · 위치를 수신하면 지도에 표시합니다."
    : basic && basic.state !== "ready"
      ? basic.reason
      : !basic && freshness(position.observedAt, now) === "STALE"
        ? "오래된 관측 기준입니다. 현재 일정은 선사·대리점 확인이 필요합니다."
        : forecast?.status === "error"
          ? forecast.data
            ? "기상 갱신 실패 · 이전 예보 사용. 설정에서 다시 갱신할 수 있습니다."
            : "기상 조회 실패 · 기본 ETA를 표시합니다. 설정에서 다시 갱신할 수 있습니다."
          : weather
            ? weather.reason
            : (registered?.reason ??
              "항차 연결에서 목적항과 일정 가정을 등록해 주세요.");

  return (
    <section
      className="vessel-arrival-panel"
      aria-label="선택 선박 도착 전망"
      data-vessel-id={vessel.id}
    >
      <h2 className="sr-only">도착 전망</h2>
      <div className="vessel-arrival-metrics">
        <Metric
          label={loadingArrival ? "도착 상태 확인 중" : berth ? `${berth.actualLabel ?? "부두 인근 상태"} · KST` : "입항 전망 · KST"}
          value={
            <span className="vessel-eta-primary">
              {loadingArrival ? <ProcessingOrb state="searching" label="정보 불러오는 중" hideLabel className="gf-voyage-skeleton" /> : berth ? berth.actual ? etaDate(berth.actual) : berth.observation.stale ? "마지막 위치 · 확인 필요" : berth.observation.estimated ? "AIS 접안 추정" : "접안 판별 대기" : eta
                ? etaDate(eta)
                : basic?.state === "blocked"
                  ? "ETA 계산 보류"
                  : "ETA 계산 전"}
            </span>
          }
          note={loadingArrival ? "AIS 정보를 불러오고 있습니다." : berth ? berth.actual ? "공용 항차 원장에 등록된 시각" : "실제 입항·접안 시각 미확인" : method}
        />
        <div className="vessel-eta-baseline">
          <Metric
            label={berth ? "마지막 AIS 관측 · KST" : basic ? "기상으로 추가되는 시간" : "등록 계획 대비"}
            value={
              <span className="vessel-weather-eta-delay">
                {loadingArrival ? <ProcessingOrb state="searching" label="정보 불러오는 중" hideLabel className="gf-voyage-skeleton" /> : berth ? etaDate(berth.observation.observedAt) : basic
                  ? weather?.delayH == null
                    ? "미확정"
                    : `+${n(weather.delayH, 1)}`
                  : registered?.deltaH == null
                    ? "미확정"
                    : `${registered.deltaH > 0 ? "+" : ""}${n(registered.deltaH, 1)}`}
              </span>
            }
            unit={
              !loadingArrival && !berth && (basic ? weather?.delayH : registered?.deltaH) != null
                ? "h"
                : undefined
            }
            note={
              loadingArrival ? "정보 확인 중" : berth ? "관측 시각 · 도착 시각 아님" : weather?.eta
                ? `기본 ETA ${etaDate(baseline)}`
                : basic
                  ? "사용 가능한 예보 구간 기준"
                  : "기상 미반영 · 등록 항차 기준"
            }
          />
        </div>
        <div className="vessel-arrival-facts">
          <Metric
            label="관측 속도"
            value={validSpeed ? `${n(speed, 1)} ` : loadingArrival ? <ProcessingOrb state="searching" label="정보 불러오는 중" hideLabel className="gf-voyage-skeleton" /> : "미수신"}
            unit={validSpeed ? "kn" : undefined}
            note={`${basic ? "예상" : "등록"} 잔여거리 ${distance == null ? "미확정" : `${n(distance)} nm`}`}
          />
        </div>
      </div>
      <div
        className="vessel-arrival-insight"
        role="status"
        data-warning={
          basic?.state === "blocked" ||
          weather?.state === "partial" ||
          forecast?.status === "error" ||
          unverifiedConnection ||
          undefined
        }
      >
        <Info size={14} aria-hidden="true" />
        <p>
          {loadingArrival ? "AIS 정보를 확인하고 있습니다." : reason}
          {basic?.state === "ready" &&
            unverifiedConnection &&
            " 출발 연결 구간은 직선 거리 가정이며 실제 항해 경로는 미확인입니다."}
        </p>
        <Button variant="ghost" size="xs" onClick={onShowBasis}>
          계산 근거
          <ChevronRight size={13} />
        </Button>
      </div>
      <div className="vessel-arrival-source">
        <span>{source}</span>
        {position && !berth && (
          <span>마지막 관측 {etaDate(position.observedAt)} KST</span>
        )}
      </div>
    </section>
  );
}
