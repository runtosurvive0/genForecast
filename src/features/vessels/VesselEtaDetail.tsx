import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { freshness } from "@/domain/control-tower";
import {
  estimateArrival,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { number as n, date as dateLabel } from "@/lib/format";
import type { BasicEta } from "./vessel-basic-eta";
import { vesselSourceLabel } from "./vessel-source";
import { AisAttribution } from "./AisAttribution";

export const etaDate = (value: string | null | undefined) =>
  value ? dateLabel(value, true) : "미확정";
export const voyageState = {
  planned: "출항 예정",
  underway: "항해 중",
  stopped: "정지·묘박",
  arrived: "입항 확인",
  cancelled: "취소",
};

export function VesselEtaDetail({
  vessel,
  voyage,
  now,
  basicEta,
  onPlant,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  now: number;
  basicEta?: BasicEta;
  onPlant: (id: string) => void;
}) {
  const estimate = voyage ? estimateArrival(voyage) : null;
  const position = vessel.ais?.position ?? voyage?.position;
  return (
    <div className="vessel-eta-detail">
      <p className="vessel-data-context">
        {voyage ? voyageState[voyage.state] : "항차 미연결"} ·{" "}
        {vessel.source === "demo"
          ? "합성 표본 · 실제 운영 정보 아님"
          : vessel.source === "digitraffic"
            ? "Digitraffic · 핀란드"
            : vessel.ais
              ? vesselSourceLabel(vessel)
              : "직접 등록"}
      </p>
      {vesselSourceLabel(vessel).startsWith('Open Waters') && <p className="tower-footnote"><AisAttribution /></p>}
      {vessel.source === "digitraffic" && (
        <p className="tower-footnote">
          출처:{" "}
          <a
            href="https://www.digitraffic.fi/en/marine-traffic/"
            target="_blank"
            rel="noreferrer"
          >
            Fintraffic / Digitraffic
          </a>{" "}
          ·{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>{" "}
          · 원본 AIS 결합·정규화
        </p>
      )}
      <div className="vessel-observation-details">
        <h3 className="sr-only">관측·항차 상세</h3>
        <dl className="tower-details vessel-eta-inputs">
          {vessel.ais && (
            <>
              <div>
                <dt>AIS 목적지 · 선박 입력</dt>
                <dd>{vessel.ais.destination || "미수신"}</dd>
              </div>
              <div>
                <dt>마지막 관측 좌표</dt>
                <dd>
                  {position
                    ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`
                    : "미수신"}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt>MMSI / IMO</dt>
            <dd>
              {vessel.mmsi || "미확인"} / {vessel.imo || "미확인"}
            </dd>
          </div>
          <div>
            <dt>SOG / COG</dt>
            <dd>
              {position?.sogKn == null
                ? "미수신"
                : `${n(position.sogKn, 1)} kn`}{" "}
              / {position?.cogDeg == null ? "미수신" : `${n(position.cogDeg)}°`}
            </dd>
          </div>
          <div>
            <dt>관측 기준시각 · KST</dt>
            <dd>{etaDate(position?.observedAt)}</dd>
          </div>
          <div>
            <dt>위치 최신성</dt>
            <dd>
              {position
                ? `${freshness(position.observedAt, now)} · 마지막 수신 위치`
                : "연결 대기"}
            </dd>
          </div>
          {voyage && (
            <>
              <div>
                <dt>운송 구간</dt>
                <dd>
                  {voyage.origin} → {voyage.destination}
                </dd>
              </div>
              <div>
                <dt>예상 잔여거리</dt>
                <dd>
                  {voyage.distanceNm === null
                    ? "미확정"
                    : `${n(voyage.distanceNm)} nm`}{" "}
                  · 등록 가정
                </dd>
              </div>
              <div>
                <dt>계획 속도</dt>
                <dd>
                  {voyage.plannedSpeedKn === null
                    ? "미확정"
                    : `${n(voyage.plannedSpeedKn, 1)} kn`}
                </dd>
              </div>
              <div>
                <dt>화물 · 열량</dt>
                <dd>
                  {n(voyage.cargoT)} t · {n(voyage.cv)} kcal/kg
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>
      {voyage && (
        <details className="vessel-observation-details">
          <summary>등록 항차 · 접안·하역 일정</summary>
          {basicEta && (
            <p className="tower-footnote">
              아래는 등록 항차의 별도 가정 일정입니다. 위 기본 ETA를
              화물·접안·하역 계획에 자동 반영하지 않습니다.
            </p>
          )}
          <ol className="vessel-eta-milestones" aria-label="입항과 하역 일정">
            {[
              ["출항 계획", voyage.etd, "등록 ETD"],
              ["입항", estimate?.eta, "항구 도착 기준"],
              [
                "접안 전망",
                estimate?.berth,
                voyage.portWaitH === null
                  ? "대기 가정 필요"
                  : `대기 ${voyage.portWaitH}h 가정`,
              ],
              [
                "하역 완료 전망",
                estimate?.unload,
                voyage.unloadH === null
                  ? "작업 가정 필요"
                  : `작업 ${voyage.unloadH}h 가정`,
              ],
            ].map(([label, at, note]) => (
              <li key={label}>
                <span>{label}</span>
                <strong>{etaDate(at)}</strong>
                <small>{note}</small>
              </li>
            ))}
          </ol>
          <p className="tower-footnote">
            이 등록 항차 일정에는 실제 기상 보정을 자동 반영하지 않습니다.
            접안·하역은 별도 가정이며 재고에는 자동 반영되지 않습니다.
          </p>
          {vessel.legacyId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPlant(voyage.plantId)}
            >
              발전 영향 보기
              <ArrowRight size={14} />
            </Button>
          )}
        </details>
      )}
    </div>
  );
}
