import { ArrowRight, BookmarkMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/tower/primitives";
import { freshness } from "@/domain/control-tower";
import {
  estimateArrival,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { number as n, date as dateLabel } from "@/lib/format";
import { VoyageEditor } from "./VoyageEditor";
import type { BasicEta } from "./vessel-basic-eta";
import type { ForecastState } from "./vessel-weather";
import { VesselWeatherEta } from "./VesselWeatherEta";

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
  forecast,
  onRemove,
  onSave,
  onPlant,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  now: number;
  basicEta?: BasicEta;
  forecast?: ForecastState;
  onRemove: () => void;
  onSave: (v: TrackingVoyage) => void;
  onPlant: (id: string) => void;
}) {
  const estimate = voyage ? estimateArrival(voyage) : null;
  const displayedEta = basicEta ? basicEta.eta : estimate?.eta;
  const position = vessel.ais?.position ?? voyage?.position;
  const old = position && freshness(position.observedAt, now) === "STALE";
  return (
    <div className="vessel-eta-detail">
      <Section
        title={`${vessel.name} · 도착 전망`}
        note={
          vessel.source === "demo"
            ? "합성 표본 · KST · 실제 운영 정보 아님"
            : vessel.ais
              ? `${vessel.source === "digitraffic" ? "Digitraffic · 핀란드" : "AISstream"} · 마지막 저장 관측 · KST · 항차 계획은 별도`
              : "직접 등록 · 로컬 계획 · 수집 서비스 미연결"
        }
        action={
          <div className="vessel-workflow-actions">
            <VoyageEditor
              key={vessel.id}
              vessel={vessel}
              voyage={voyage}
              onSave={onSave}
            />
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <BookmarkMinus size={14} />
              관심 해제
            </Button>
          </div>
        }
      >
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
            · 원본 AIS 결합·정규화. 정확성·가용성은 보장되지 않습니다.
          </p>
        )}
        <div className="vessel-eta-analysis">
          <div className="vessel-eta-headline">
            <div>
              <span className="vessel-eta-label">
                {basicEta
                  ? "기본 ETA · 기상 미반영 · KST"
                  : estimate?.method === "actual"
                    ? "등록 입항 시각 · 표본"
                    : "입항 ETA · 가정 전망"}
              </span>
              <strong className="vessel-eta-primary">
                {displayedEta
                  ? etaDate(displayedEta)
                  : basicEta?.state === "blocked"
                    ? "ETA 계산 보류"
                    : "ETA 계산 전"}
              </strong>
              <span className="vessel-eta-delta">
                {basicEta ? (
                  "선택 목적항까지의 항로망 기준 · 입항 참고"
                ) : (
                  <>
                    등록 계획 대비{" "}
                    {estimate?.deltaH == null
                      ? "미확정"
                      : `${estimate.deltaH > 0 ? "+" : ""}${n(estimate.deltaH, 1)} h`}
                  </>
                )}
              </span>
            </div>
            <span className="tower-status">
              {voyage ? voyageState[voyage.state] : "항차 미연결"}
            </span>
          </div>
          <div className="vessel-eta-cause">
            <span className="vessel-eta-label">지연 원인 · 계산 근거</span>
            <p className="vessel-eta-reason">
              {basicEta?.reason ??
                estimate?.reason ??
                "항차 연결이 필요합니다. ‘항차 연결’에서 목적항·거리·속도 가정을 등록해 주세요. 관심 등록만으로 입하 계획이 생성되지는 않습니다."}
            </p>
            <span className="vessel-eta-label">
              {basicEta
                ? "기상 보정은 아래 시연 모델과 비교합니다."
                : "실제 기상 지연은 아직 반영되지 않습니다."}
            </span>
          </div>
        </div>
        {basicEta && (
          <VesselWeatherEta
            key={`${vessel.id}/${basicEta.destinationId}`}
            vessel={vessel}
            basic={basicEta}
            forecast={forecast}
            now={now}
          />
        )}
        {old && !basicEta && (
          <p className="vessel-eta-warning">
            오래된 관측 기준의 계산입니다. 현재 ETA로 사용하기 전에 선사·대리점
            확인이 필요합니다.
          </p>
        )}
        {!position && (
          <p className="vessel-eta-warning">
            실시간 위치 미수신 · 지도에 임의 위치를 표시하지 않습니다.
          </p>
        )}
        <details className="vessel-observation-details">
          <summary>관측·항차 상세</summary>
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
                /{" "}
                {position?.cogDeg == null ? "미수신" : `${n(position.cogDeg)}°`}
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
        </details>
        {voyage && (
          <>
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
              기상 감속·항로 우회는 아직 ETA에 보정하지 않습니다. 접안·하역은
              별도 가정이며 재고에는 자동 반영되지 않습니다.
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
          </>
        )}
      </Section>
    </div>
  );
}
