import { useState } from "react";
import {
  ComposableMap,
  Marker,
  ZoomableGroup,
  useMapContext,
} from "react-simple-maps";
import { MapDrawingOrb } from "./MapDrawingOrb";
import {
  cycloneAt,
  metricText,
  overlayFeatures,
  weatherAttention,
  forecastLabelIndices,
  type WeatherOverlay,
} from "./vessel-weather-layers";
import { date as formatDate } from "@/lib/format";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { MapToolButton } from "./MapToolButton";
import { WorldMap } from "@/components/ui/world-map";
import type { VesselMapProps } from "./VesselMap";
import { OfflineVesselSymbol } from "./OfflineVesselSymbol";
import { courseLabel } from "./vessel-symbol";
import {
  initialView,
  fullWorld,
  samples,
  routesForVessels,
  destinationCoordinates,
} from "./map-data";
export type MapCanvasProps = Pick<
  VesselMapProps,
  | "plants"
  | "onSelect"
  | "theme"
  | "weatherPoints"
  | "navigationRoutes"
  | "weatherOverlay"
  | "weatherToolbar"
  | "weatherBusy"
  | "fleetDiscovery"
> & {
  visible: VesselMapProps["shipments"];
  positions: NonNullable<VesselMapProps["positions"]>;
  selected?: VesselMapProps["shipments"][number];
};
export function OfflineVesselCanvas({
  visible,
  positions,
  selected,
  plants,
  onSelect,
  weatherPoints,
  weatherOverlay,
  weatherToolbar,
  weatherBusy,
  theme,
  navigationRoutes,
}: MapCanvasProps) {
  const [view, setView] = useState(initialView);
  const changeZoom = (factor: number) =>
    setView((current) => ({
      ...current,
      zoom: Math.min(5, Math.max(1, current.zoom * factor)),
    }));
  return (
    <>
      {" "}
      <ComposableMap
        width={960}
        height={480}
        projection="geoEqualEarth"
        projectionConfig={{ rotate: [-150, 0, 0], scale: 168 }}
        className="vessel-map-svg"
        role="group"
        aria-label="선박 위치와 운송 항로 도트 세계지도"
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
            routes={[
              ...routesForVessels(visible, positions, selected?.id),
              ...(navigationRoutes ?? []),
            ]}
          />
          {weatherOverlay && (
            <OfflineWeather overlay={weatherOverlay} zoom={view.zoom} />
          )}
          {weatherPoints?.map((point) => (
            <Marker
              key={point.id}
              coordinates={[point.longitude, point.latitude]}
            >
              <g
                className="vessel-weather-marker"
                transform={`scale(${1 / view.zoom})`}
              >
                <title>{`${point.label} · 파고 ${point.waveM == null ? "자료 없음" : `${point.waveM}m`} · 바람 ${point.windKn == null ? "자료 없음" : `${point.windKn}kn`}`}</title>
                <rect x={-13} y={-10} width={26} height={20} rx={4} />
                <text textAnchor="middle" y={4}>
                  {point.waveM?.toFixed(1) ?? "–"}
                </text>
              </g>
            </Marker>
          ))}
          {visible
            .filter((s) => (!s.source || s.source === "demo") && samples[s.id])
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
            .filter(
              (plant) =>
                destinationCoordinates[plant.id] &&
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
              const position = positions.find(
                (v) => v.vessel_id === shipment.id,
              )!;
              return (
                <Marker
                  key={`vessel-${shipment.id}`}
                  coordinates={[position.longitude, position.latitude]}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={`${shipment.vesselName}, ${shipment.status}, ${shipment.origin}, ${courseLabel(position)}, 상세 보기`}
                  className={`vessel-map-marker ${active ? "is-selected" : ""}`}
                  onClick={() => onSelect(shipment.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(shipment.id);
                    }
                  }}
                >
                  <title>{`${shipment.vesselName} · ${shipment.status} · ${courseLabel(position)} · ${shipment.source && shipment.source !== "demo" ? "AIS 관측 위치" : "샘플 위치"}`}</title>
                  <OfflineVesselSymbol
                    position={position}
                    active={active}
                    name={shipment.vesselName}
                  />
                </Marker>
              );
            })}
        </ZoomableGroup>
      </ComposableMap>
      <MapDrawingOrb busy={!!weatherBusy} theme={theme} />
      <div className="vessel-map-toolbar" role="toolbar" aria-label="지도 도구">
        {weatherToolbar}
        <MapToolButton
          label="지도 확대"
          disabled={view.zoom >= 5}
          onClick={() => changeZoom(1.4)}
        >
          <Plus />
        </MapToolButton>
        <MapToolButton
          label="지도 축소"
          disabled={view.zoom <= 1}
          onClick={() => changeZoom(1 / 1.4)}
        >
          <Minus />
        </MapToolButton>
        <MapToolButton
          label="전체 세계지도 보기"
          onClick={() => setView(fullWorld)}
        >
          <RotateCcw />
        </MapToolButton>
      </div>
    </>
  );
}

function OfflineWeather({
  overlay,
  zoom,
}: {
  overlay: WeatherOverlay;
  zoom: number;
}) {
  const { path, projection } = useMapContext();
  const labels = forecastLabelIndices(overlay.points, overlay.index, p => {
    const xy = projection([p.longitude, p.latitude]) ?? [0, 0];
    return [xy[0] * zoom, xy[1] * zoom];
  });
  const passage =
    overlay.points[Math.min(overlay.index, overlay.points.length - 1)];
  return (
    <g>
      {overlayFeatures(overlay)
        .features.filter((f) => f.geometry.type !== "Point")
        .map((f, i) => (
          <path
            key={i}
            d={path(f.geometry) ?? ""}
            fill={f.geometry.type === "Polygon" ? "#dc824d" : "none"}
            fillOpacity={0.18}
            stroke={f.properties?.kind === "forecast-route" ? f.properties.status === "attention" ? "#dca350" : f.properties.status === "normal" ? "#9c95e8" : "#7b818b" : "#c86b34"}
            strokeWidth={f.properties?.kind === "forecast-route" ? 3 : 1.5}
            strokeDasharray={
              f.properties?.kind === "cyclone-track" ? "2 3" : undefined
            }
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {overlay.points.length > 0 && <Marker coordinates={[overlay.points.at(-1)!.longitude, overlay.points.at(-1)!.latitude]}>
        <circle r={5 / zoom} fill="#9c95e8" stroke="#fff" strokeWidth={2 / zoom}><title>예보 조회 구간 끝</title></circle>
      </Marker>}
      {passage && (
        <Marker coordinates={[passage.longitude, passage.latitude]}>
          <circle
            r={12 / zoom}
            fill="none"
            stroke="#8e86d6"
            strokeWidth={2 / zoom}
          />
        </Marker>
      )}
      {overlay.points.map((p, i) => (
        <Marker key={i} coordinates={[p.longitude, p.latitude]}>
          <g
            className={`vessel-weather-marker vessel-weather-value is-${weatherAttention(p, overlay.metric, overlay.now)}`}
            transform={`scale(${1 / zoom}) translate(0 ${labels.has(i) ? -20 : 0})`}
            role="button"
            tabIndex={0}
            aria-label={`통과 ${formatDate(p.passageAt, true)} KST · ${metricText(p, overlay.metric)}`}
            aria-pressed={overlay.index === i}
            onClick={() => overlay.onSelectPoint(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                overlay.onSelectPoint(i);
              }
            }}
          >
            <title>{`파고 ${metricText(p, "wave")} · 바람 ${metricText(p, "wind")} · 시정 ${metricText(p, "visibility")}`}</title>
            {labels.has(i) ? <>
              <rect x={-30} y={-10} width={60} height={20} rx={4} />
              <text textAnchor="middle" y={4}>{metricText(p, overlay.metric)}</text>
            </> : <><circle r={10} fill="transparent" /><circle r={3} fill="currentColor" /></>}
          </g>
        </Marker>
      ))}
      {passage &&
        overlay.storms.map((s) => {
          const p = cycloneAt(s, Date.parse(passage.passageAt));
          return p ? (
            <Marker key={s.id} coordinates={[p.longitude, p.latitude]}>
              <g
                className="vessel-cyclone-marker"
                transform={`scale(${1 / zoom})`}
              >
                <title>{`${s.source} · ${formatDate(p.at, true)} KST`}</title>
                <text textAnchor="middle">◎ {s.name}</text>
              </g>
            </Marker>
          ) : null;
        })}
    </g>
  );
}
