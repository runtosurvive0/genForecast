import { voyages } from "@/data/control-tower";
import { freshness } from "@/domain/control-tower";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { WeatherOverlay } from "./vessel-weather-layers";
import type { WeatherPoint } from "@/domain/vessel-workflow";
import { Ship } from "lucide-react";
import type { Plant } from "@/domain/operations";
import { Button } from "@/components/ui/button";
import { OfflineVesselCanvas } from "./OfflineVesselCanvas";
import { OnlineVesselCanvas } from "./OnlineVesselCanvas";
import { validPosition } from "./map-data";
import type { MapVessel, NavigationRoute } from "./vessel-navigation";
import type { MapPosition } from "./vessel-symbol";
import "./vessel-map.css";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateLabel = (value: string) => dateFormat.format(new Date(value));
const samplePositions = voyages.map((v) => ({
  vessel_id: v.voyage_id,
  latitude: v.latitude,
  longitude: v.longitude,
  received_at: v.received_at,
  cogDeg: v.cog_deg,
  sogKn: v.sog_kn,
}));

export interface VesselMapProps {
  shipments: MapVessel[];
  navigationRoutes?: NavigationRoute[];
  positions?: MapPosition[];
  plants: Plant[];
  selectedVesselId: string | null;
  onSelect: (id: string) => void;
  theme: "light" | "dark";
  weatherPoints?: WeatherPoint[];
  weatherOverlay?: WeatherOverlay;
  weatherBusy?: boolean;
  weatherToolbar?: ReactNode;
  weatherTimeline?: ReactNode;
  showVesselPanel?: boolean;
  embedded?: boolean;
  selectionNotice?: string;
}

export function VesselMap({
  shipments,
  positions = samplePositions,
  plants,
  selectedVesselId,
  onSelect,
  theme,
  weatherPoints,
  weatherOverlay,
  weatherBusy,
  weatherToolbar,
  weatherTimeline,
  showVesselPanel = true,
  embedded = false,
  selectionNotice,
  navigationRoutes,
}: VesselMapProps) {
  const titleId = useId();
  const [failure, setFailure] = useState<string | null>(
    location.protocol === "file:"
      ? "오프라인 기본 지도 · 상세 지도는 온라인에서 제공됩니다."
      : null,
  );
  const [attempt, setAttempt] = useState(0);
  const visible = useMemo(
    () =>
      shipments.filter((shipment) =>
        positions.some((p) => p.vessel_id === shipment.id && validPosition(p)),
      ),
    [shipments, positions],
  );
  // An explicitly selected, unlocated vessel must not highlight a different ship.
  const selected =
    selectedVesselId === null
      ? visible[0]
      : visible.find((shipment) => shipment.id === selectedVesselId);
  const selectedPlant = plants.find((plant) => plant.id === selected?.plantId);

  return (
    <section
      className={`vessel-map${embedded ? " vessel-map-embedded" : ""}`}
      data-map-theme={theme}
      aria-labelledby={titleId}
    >
      <div className={embedded ? "vessel-map-context" : "vessel-map-header"}>
        <div>
          <h3 id={titleId} className={embedded ? "sr-only" : undefined}>
            해상 운송 현황
          </h3>
          {!embedded && <p>공급지에서 국내 발전소까지의 운송 현황</p>}
          {selectionNotice && (
            <p className="vessel-map-selection-note" role="status">
              {selectionNotice}
            </p>
          )}
        </div>
        <span className="vessel-map-sample">
          {visible.some((v) => v.source && v.source !== "demo")
            ? `${visible.some((v) => !v.source || v.source === "demo") ? "AIS 관측 + 샘플 위치" : "실제 AIS 관측"} · 점선은 예상 항로`
            : "샘플 위치 · 예시 항로"}
        </span>
      </div>
      <div className="vessel-map-canvas">
        {failure ? (
          <>
            <OfflineVesselCanvas
              visible={visible}
              positions={positions}
              selected={selected}
              plants={plants}
              onSelect={onSelect}
              theme={theme}
              weatherPoints={weatherPoints}
              weatherOverlay={weatherOverlay}
              weatherBusy={weatherBusy}
              weatherToolbar={weatherToolbar}
              navigationRoutes={navigationRoutes}
            />
            <div className="vessel-map-status" role="status">
              {failure}
              {location.protocol !== "file:" && (
                <button
                  onClick={() => {
                    setAttempt((n) => n + 1);
                    setFailure(null);
                  }}
                >
                  상세 지도 다시 연결
                </button>
              )}
            </div>
          </>
        ) : (
          <OnlineVesselCanvas
            key={attempt}
            visible={visible}
            positions={positions}
            selected={selected}
            plants={plants}
            onSelect={onSelect}
            theme={theme}
            weatherPoints={weatherPoints}
            weatherOverlay={weatherOverlay}
            weatherBusy={weatherBusy}
            weatherToolbar={weatherToolbar}
            navigationRoutes={navigationRoutes}
            onUnavailable={setFailure}
          />
        )}
        <span className="vessel-map-pan-hint">
          드래그하여 이동 · + / − 확대
        </span>
        {!visible.length && (
          <div className="vessel-map-empty">
            현재 범위에 위치가 확인된 선박이 없습니다.
          </div>
        )}
      </div>
      <div className="vessel-map-bottom">
        {weatherTimeline}
        {showVesselPanel && (
          <div className="vessel-map-list-heading">
            운항 선박 <span>{visible.length}척</span>
          </div>
        )}
        <div className="vessel-map-legend">
          <span>
            <i className="legend-vessel" />
            선박
          </span>
          <span>
            <i className="legend-origin" />
            공급지
          </span>
          <span>
            <i className="legend-port" />
            발전소 항만
          </span>
          {visible.some((v) => !v.source || v.source === "demo") && (
            <span>
              <i className="legend-route" />
              예시 항로
            </span>
          )}
          {navigationRoutes?.some((r) => r.kind === "estimated") && (
            <span>
              <i className="legend-route legend-estimated" />
              예상 항로
            </span>
          )}
          {navigationRoutes?.some((r) => r.kind === "observed") && (
            <span>
              <i className="legend-route" />
              수집 항적
            </span>
          )}
          {navigationRoutes?.some((r) => r.kind === "connector") && (
            <span title="현재 위치와 항로망 사이의 안내선이며, 항해 가능 여부를 검증한 항로가 아닙니다.">
              <i className="legend-route legend-connection" />
              위치 연결선 · 항로 아님
            </span>
          )}
        </div>
        {showVesselPanel && (
          <div className="vessel-map-vessels" aria-label="지도에서 선박 선택">
            {visible.map((shipment) => (
              <Button
                key={shipment.id}
                size="xs"
                variant={selected?.id === shipment.id ? "secondary" : "ghost"}
                aria-pressed={selected?.id === shipment.id}
                onClick={() => onSelect(shipment.id)}
              >
                <Ship />
                {shipment.vesselName}
              </Button>
            ))}
          </div>
        )}
        {showVesselPanel && selected && (
          <div className="vessel-map-detail" aria-live="polite">
            <div className="vessel-map-detail-name">
              <strong>{selected.vesselName}</strong>
              <span>
                {selected.status} ·{" "}
                {freshness(
                  positions.find((v) => v.vessel_id === selected.id)
                    ?.received_at ?? "",
                )}
              </span>
            </div>
            <div>
              <span>공급 경로</span>
              <b>
                {selected.origin} → {selectedPlant?.name ?? selected.plantId}
              </b>
            </div>
            <div>
              <span>운송량</span>
              <b>
                {selected.tons == null
                  ? "미등록"
                  : `${selected.tons.toLocaleString("ko-KR")} t`}
              </b>
            </div>
            <div>
              <span>입항 예정 · KST</span>
              <b>
                {selected.arrivalAt ? dateLabel(selected.arrivalAt) : "미확정"}
              </b>
            </div>
            <div>
              <span>하역 완료 · KST</span>
              <b>
                {selected.dischargeCompleteAt
                  ? dateLabel(selected.dischargeCompleteAt)
                  : "미확정"}
              </b>
            </div>
          </div>
        )}
        {showVesselPanel && (
          <p className="vessel-map-credit">
            {failure ? "Aceternity UI · dotted-map · " : ""}AIS 관측·수집 항적과
            예상·예시 항로는 구분하여 표시합니다.
          </p>
        )}
      </div>
    </section>
  );
}
