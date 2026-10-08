import { voyages } from "../data/control-tower";
import { freshness } from "../domain/control-tower";
import { useId, useState } from "react";
import { ComposableMap, Marker, ZoomableGroup } from "react-simple-maps";
import { Minus, Plus, RotateCcw, Ship } from "lucide-react";
import type { Plant, Shipment } from "../domain/operations";
import { Button } from "./ui/button";
import { WorldMap } from "./ui/world-map";
import "./vessel-map.css";

type Coordinate = [number, number];
interface VesselSample {
  origin: Coordinate;
  position: Coordinate;
  waypoints: Coordinate[];
}

// Illustrative ocean waypoints and positions, not AIS or navigational routing.
const samples: Record<string, VesselSample> = {
  "ship-dj": {
    origin: [151.78, -32.93],
    position: [126.45, 36.98],
    waypoints: [
      [155, -27],
      [156, -15],
      [154, -5],
      [145, 6],
      [135, 16],
      [128, 24],
      [124, 30],
      [124, 35],
    ],
  },
  "ship-br": {
    origin: [117.2, -0.53],
    position: [125.8, 36.15],
    waypoints: [
      [118.5, 1],
      [119.5, 5],
      [119, 10],
      [118, 16],
      [120, 23],
      [122, 29],
      [124, 34],
    ],
  },
  "ship-hd": {
    origin: [151.27, -23.84],
    position: [154, -7],
    waypoints: [
      [155, -17],
      [154, -7],
      [147, 4],
      [137, 11],
      [130, 23],
      [128, 30],
      [127, 32],
      [128, 34],
    ],
  },
  "ship-dh": {
    origin: [117.57, 3.3],
    position: [128, 16],
    waypoints: [
      [120, 5],
      [124, 7],
      [128, 16],
      [131, 25],
      [130, 32],
    ],
  },
};
const destinationCoordinates: Record<string, Coordinate> = {
  dangjin: [126.45, 36.98],
  boryeong: [126.47, 36.4],
  hadong: [127.79, 34.95],
  donghae: [129.15, 37.49],
};
const initialView = { coordinates: [150, 0] as Coordinate, zoom: 1 };
const fullWorld = { coordinates: [150, 0] as Coordinate, zoom: 1 };
const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateLabel = (value: string) => dateFormat.format(new Date(value));

export interface VesselMapProps {
  shipments: Shipment[];
  positions?: {
    vessel_id: string;
    latitude: number;
    longitude: number;
    received_at: string;
  }[];
  plants: Plant[];
  selectedVesselId: string | null;
  onSelect: (id: string) => void;
  theme: "light" | "dark";
}

export function VesselMap({
  shipments,
  positions = voyages.map((v) => ({
    vessel_id: v.voyage_id,
    latitude: v.latitude,
    longitude: v.longitude,
    received_at: v.received_at,
  })),
  plants,
  selectedVesselId,
  onSelect,
  theme,
}: VesselMapProps) {
  const titleId = useId();
  const [view, setView] = useState(initialView);
  const visible = shipments.filter(
    (shipment) =>
      positions.some(
        (p) =>
          p.vessel_id === shipment.id &&
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude),
      ) && destinationCoordinates[shipment.plantId],
  );
  const selected =
    visible.find((shipment) => shipment.id === selectedVesselId) ?? visible[0];
  const selectedPlant = plants.find((plant) => plant.id === selected?.plantId);
  const changeZoom = (factor: number) =>
    setView((current) => ({
      ...current,
      zoom: Math.min(5, Math.max(1, current.zoom * factor)),
    }));

  return (
    <section
      className="vessel-map"
      data-map-theme={theme}
      aria-labelledby={titleId}
    >
      <div className="vessel-map-header">
        <div>
          <h3 id={titleId}>해상 운송 현황</h3>
          <p>공급지에서 국내 발전소까지의 운송 현황</p>
        </div>
        <span className="vessel-map-sample">샘플 위치 · 예시 항로</span>
      </div>
      <div className="vessel-map-canvas">
        <ComposableMap
          width={960}
          height={480}
          projection="geoEqualEarth"
          projectionConfig={{ rotate: [-150, 0, 0], scale: 168 }}
          className="vessel-map-svg"
          role="group"
          aria-label="샘플 선박 위치와 연료 운송 항로 도트 세계지도"
        >
          <ZoomableGroup
            center={view.coordinates}
            zoom={view.zoom}
            minZoom={1}
            maxZoom={5}
            onMoveEnd={({ coordinates, zoom }) => {
              if (coordinates && zoom) setView({ coordinates, zoom });
            }}
          >
            <WorldMap
              routes={visible
                .filter((s) => samples[s.id])
                .map((shipment) => ({
                  id: shipment.id,
                  selected: selected?.id === shipment.id,
                  coordinates: [
                    samples[shipment.id].origin,
                    ...samples[shipment.id].waypoints,
                    destinationCoordinates[shipment.plantId],
                  ],
                }))}
            />
            {visible
              .filter((s) => samples[s.id])
              .map((shipment) => (
                <Marker
                  key={`origin-${shipment.id}`}
                  coordinates={samples[shipment.id].origin}
                  aria-hidden="true"
                >
                  <circle r={3 / view.zoom} className="vessel-map-origin" />
                </Marker>
              ))}
            {plants
              .filter((plant) =>
                visible.some((shipment) => shipment.plantId === plant.id),
              )
              .map((plant) => (
                <Marker
                  key={plant.id}
                  coordinates={destinationCoordinates[plant.id]}
                  aria-hidden="true"
                >
                  <rect
                    x={-3 / view.zoom}
                    y={-3 / view.zoom}
                    width={6 / view.zoom}
                    height={6 / view.zoom}
                    className="vessel-map-destination"
                  />
                </Marker>
              ))}
            {/* Paint the selected marker last so nearby Korean ports cannot cover it. */}
            {[...visible]
              .sort(
                (a, b) =>
                  Number(a.id === selected?.id) - Number(b.id === selected?.id),
              )
              .map((shipment) => {
                const active = selected?.id === shipment.id;
                return (
                  <Marker
                    key={`vessel-${shipment.id}`}
                    coordinates={(() => {
                      const v = positions.find(
                        (v) => v.vessel_id === shipment.id,
                      )!;
                      return [v.longitude, v.latitude];
                    })()}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    aria-label={`${shipment.vesselName}, ${shipment.status}, ${shipment.origin}, 상세 보기`}
                    className={`vessel-map-marker ${active ? "is-selected" : ""}`}
                    onClick={() => onSelect(shipment.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(shipment.id);
                      }
                    }}
                  >
                    <title>{`${shipment.vesselName} · ${shipment.status} · 샘플 위치`}</title>
                    <g transform={`scale(${1 / view.zoom})`}>
                      <circle
                        r={active ? 17 : 14}
                        className="vessel-map-marker-halo"
                      />
                      <circle r={10} className="vessel-map-marker-body" />
                      <path
                        d="M-5 0 L0 -6 L5 0 L3 5 L-3 5 Z"
                        className="vessel-map-ship"
                      />
                      {active && (
                        <text x={21} y={4} className="vessel-map-marker-label">
                          {shipment.vesselName}
                        </text>
                      )}
                    </g>
                  </Marker>
                );
              })}
          </ZoomableGroup>
        </ComposableMap>
        <div className="vessel-map-controls" aria-label="지도 조작">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="지도 확대"
            disabled={view.zoom >= 5}
            onClick={() => changeZoom(1.4)}
          >
            <Plus />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="지도 축소"
            disabled={view.zoom <= 1}
            onClick={() => changeZoom(1 / 1.4)}
          >
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="전체 세계지도 보기"
            onClick={() => setView(fullWorld)}
          >
            <RotateCcw />
          </Button>
        </div>
        <span className="vessel-map-pan-hint">
          드래그하여 이동 · + / − 확대
        </span>
        {!visible.length && (
          <div className="vessel-map-empty">표시할 선박이 없습니다.</div>
        )}
      </div>
      <div className="vessel-map-bottom">
        <div className="vessel-map-list-heading">
          운항 선박 <span>{visible.length}척</span>
        </div>
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
          <span>
            <i className="legend-route" />
            예시 항로
          </span>
        </div>
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
        {selected && (
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
              <b>{selected.tons.toLocaleString("ko-KR")} t</b>
            </div>
            <div>
              <span>입항 예정 · KST</span>
              <b>{dateLabel(selected.arrivalAt)}</b>
            </div>
            <div>
              <span>하역 완료 · KST</span>
              <b>{dateLabel(selected.dischargeCompleteAt)}</b>
            </div>
          </div>
        )}
        <p className="vessel-map-credit">
          Aceternity UI · dotted-map · 위치·항로는 샘플입니다.
        </p>
      </div>
    </section>
  );
}
