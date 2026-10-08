import { useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VesselMap } from "@/features/vessels/VesselMap";
import { voyages } from "@/data/control-tower";
import { freshness, voyageTiming } from "@/domain/control-tower";
import { BASE_TIME, shipments, type Plant, type Scenario } from "@/domain/operations";
import { number as n, date as fmtDate } from "@/lib/format";
import { Section } from "@/components/tower/primitives";
import "./vessels.css";

export function VesselTracking({
  plants,
  theme,
  scenario,
  selectedId,
  onSelect,
  onPlant,
}: {
  plants: Plant[];
  theme: "light" | "dark";
  scenario: Scenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlant: (id: string) => void;
}) {
  const scoped = voyages.filter((v) =>
    plants.some((p) => p.id === v.destination_plant_id),
  );
  const selected = scoped.find((v) => v.voyage_id === selectedId) ?? scoped[0];
  const [now, setNow] = useState(Date.now());
  const activeShipments = shipments
    .filter((v) => plants.some((p) => p.id === v.plantId))
    .map((s) => {
      const v = voyages.find((v) => v.voyage_id === s.id)!;
      const timing = voyageTiming(v, scenario.arrivalDelayDays);
      return {
        ...s,
        arrivalAt: timing.eta,
        dischargeCompleteAt: timing.unload,
      };
    });
  const timing = selected
    ? voyageTiming(selected, scenario.arrivalDelayDays)
    : null;
  return (
    <div className="tower-page">
      <div className="tower-context">
        <span>
          더미 AIS · 수신시각 {fmtDate(BASE_TIME, true)} 전후의 고정 표본
        </span>
        <Button variant="outline" size="sm" onClick={() => setNow(Date.now())}>
          <RefreshCw size={13} />
          최신성 재평가
        </Button>
      </div>
      <VesselMap
        shipments={activeShipments}
        plants={plants}
        selectedVesselId={selected?.voyage_id ?? null}
        onSelect={onSelect}
        theme={theme}
      />
      <div className="tower-footnote">
        실시간 연결 없음 · 최신성은 현재 시각과 비교합니다. 지도 좌표는 마지막
        더미 수신 위치이며 추정 이동을 표시하지 않습니다.
      </div>
      <div className="vessel-cargo-list">
        {scoped.map((v) => (
          <button
            key={v.voyage_id}
            className={`shipment-card ${selected?.voyage_id === v.voyage_id ? "selected" : ""}`}
            aria-pressed={selected?.voyage_id === v.voyage_id}
            onClick={() => onSelect(v.voyage_id)}
          >
            <span className="tower-tag">{freshness(v.received_at, now)}</span>
            <strong>{v.vessel_name}</strong>
            <span>
              {v.origin_port} → {v.destination_port}
            </span>
            <b>
              {n(v.cargo_t)} t{" "}
              <small>· {n(v.calorific_value_kcal_kg)} kcal/kg</small>
            </b>
          </button>
        ))}
      </div>
      {selected && timing && (
        <Section
          title={selected.vessel_name + " · 항차 상세"}
          note="식별자·좌표·탄질·비용은 모두 시연용 데이터"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPlant(selected.destination_plant_id)}
            >
              발전 영향 보기
              <ArrowRight size={14} />
            </Button>
          }
        >
          <dl className="tower-details">
            {[
              ["MMSI / IMO", selected.mmsi + " / " + selected.imo],
              [
                "좌표",
                selected.latitude.toFixed(3) +
                  "°, " +
                  selected.longitude.toFixed(3) +
                  "°",
              ],
              [
                "SOG / COG",
                selected.sog_kn + " kn / " + selected.cog_deg + "°",
              ],
              [
                "최종 수신",
                fmtDate(selected.received_at, true) +
                  " · " +
                  freshness(selected.received_at, now),
              ],
              ["잔여 항로", n(selected.remaining_distance_nm) + " nm"],
              ["목적지", selected.destination_port],
              ["AIS ETA", fmtDate(selected.ais_eta, true)],
              ["보정 ETA · AIS 기준", fmtDate(timing.eta, true)],
              ["예상 접안", fmtDate(timing.berth, true)],
              ["하역 완료 / 재고 반영", fmtDate(timing.unload, true)],
              [
                "기상 / 항로 지연",
                selected.weather_delay_h +
                  " h / " +
                  selected.route_delay_h +
                  " h",
              ],
              [
                "항만 대기 / 추가 시나리오",
                selected.expected_port_wait_h +
                  " h / " +
                  scenario.arrivalDelayDays +
                  "일",
              ],
              [
                "탄종 / 화물량",
                selected.coal_type + " / " + n(selected.cargo_t) + " t",
              ],
              ["열량", n(selected.calorific_value_kcal_kg) + " kcal/kg"],
              [
                "수분 / 회분 / 황분",
                selected.moisture_pct +
                  " / " +
                  selected.ash_pct +
                  " / " +
                  selected.sulfur_pct +
                  " %",
              ],
              ["예상 체선료", n(timing.demurrageUsd) + " USD"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="tower-footnote">
            ETA는 AIS 예정시각에 기상·항로 지연을 더한 모의값입니다. 잔여거리와
            SOG로 항로 도착시각을 다시 예측하는 기능은 미구현입니다. 체선료는
            max(항만 대기 − 허용시간 {selected.allowed_laytime_h}h, 0) × 일 요율
            / 24의 단순 모의값입니다. 계약 정산액이 아닙니다. 입하 제외
            시나리오는 재고 계산에만 적용됩니다.
          </p>
        </Section>
      )}
    </div>
  );
}
