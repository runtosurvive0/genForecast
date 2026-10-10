import { useEffect, useRef, useState } from "react";
import {
  Map,
  Marker,
  AttributionControl,
  ScaleControl,
  setWorkerUrl,
  setWorkerCount,
  addProtocol,
  type GeoJSONSource,
} from "maplibre-gl";
import workerCode from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import "maplibre-gl/dist/maplibre-gl.css";
import { Globe2, Map as MapIcon, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobeStars } from "./GlobeStars";
import { MapDrawingOrb } from "./MapDrawingOrb";
import {
  cycloneAt,
  metricText,
  overlayFeatures,
  weatherAttention,
} from "./vessel-weather-layers";
import { date as formatDate } from "@/lib/format";
import type { MapCanvasProps } from "./OfflineVesselCanvas";
import {
  courseLabel,
  createVesselSymbol,
  projectedCourse,
} from "./vessel-symbol";
import {
  destinationCoordinates,
  routesForVessels,
  morphProgress,
  overviewZoom,
  onlineHome,
  type MapView,
} from "./map-data";
import {
  ATTRIBUTION,
  MAX_ZOOM,
  routeFeatures,
  loadVesselStyle,
} from "./map-style";

import {
  landBackdropProgress,
  dotTile,
  DOT_TILE_PROTOCOL,
} from "./map-dot-detail";

// Keep the worker in the bundle: the standalone HTML must not need a sibling JS file.
let workerUrl: string | undefined;
function prepareWorker() {
  addProtocol(DOT_TILE_PROTOCOL, async ({ url }, abort) => {
    abort.signal.throwIfAborted();
    const zoom = Number(new URL(url).hostname);
    return { data: dotTile(zoom) };
  });
  workerUrl ??= URL.createObjectURL(
    new Blob([workerCode], { type: "text/javascript" }),
  );
  setWorkerUrl(workerUrl);
  setWorkerCount(2);
}

export function OnlineVesselCanvas(
  props: MapCanvasProps & { onUnavailable: (reason: string) => void },
) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<MapView>("globe");
  const viewRef = useRef<MapView>("globe");
  const [tileFailure, setTileFailure] = useState(false);
  const failedTiles = useRef(false);
  const [zoom, setZoom] = useState(0);
  const [minZoom, setMinZoom] = useState(0);
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(true);
  const [styleLoading, setStyleLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const resetRef = useRef<() => void>(() => {});
  const providerReady = useRef(false);
  const focusedMarker = useRef<string | null>(null);
  const focusedWeather = useRef<string | null>(null);

  useEffect(() => {
    const container = host.current!;
    const abort = new AbortController();
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const timeout = window.setTimeout(() => {
      if (!disposed && !providerReady.current)
        latest.current.onUnavailable(
          "상세 지도 연결 지연 · 기본 지도를 표시합니다.",
        );
    }, 15000);
    async function initialize() {
      try {
        let dark: boolean;
        let style;
        do {
          dark = latest.current.theme === "dark";
          style = await loadVesselStyle(dark, abort.signal, viewRef.current);
        } while (!disposed && dark !== (latest.current.theme === "dark"));
        if (disposed) return;
        prepareWorker();
        const initialZoom = overviewZoom(
          viewRef.current,
          container.clientWidth,
          container.clientHeight,
        );
        const minimum = viewRef.current === "globe" ? -2 : initialZoom;
        const map = new Map({
          container,
          style,
          center: onlineHome,
          zoom: initialZoom,
          minZoom: minimum,
          maxZoom: MAX_ZOOM,
          attributionControl: false,
          renderWorldCopies: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
        });
        mapRef.current = map;
        initialTheme.current = latest.current.theme;
        map.touchZoomRotate.disableRotation();
        map.addControl(
          new AttributionControl({
            compact: false,
            customAttribution: ATTRIBUTION,
          }),
          "top-left",
        );
        const scale = new ScaleControl({ maxWidth: 80, unit: "metric" });
        map.addControl(scale, "bottom-right");
        map.on("projectiontransition", () => scale.setUnit("metric"));
        container
          .querySelector(".maplibregl-ctrl-scale")
          ?.setAttribute("title", "지도 중심 기준 축척");
        map
          .getCanvas()
          .setAttribute(
            "aria-label",
            "전 세계 선박 지도 · 방향키 이동, + 및 - 확대 축소",
          );
        resetRef.current = () =>
          map.jumpTo({
            center: onlineHome,
            zoom: overviewZoom(
              viewRef.current,
              container.clientWidth,
              container.clientHeight,
            ),
            bearing: 0,
            pitch: 0,
          });
        const syncZoom = () => {
          const z = map.getZoom();
          const p = morphProgress(z, providerReady.current);
          // Updating global state schedules another frame, even when unchanged.
          const values = {
            morph: p,
            mapZoom: z,
            dotsReady: providerReady.current ? 1 : 0,
            landBackdrop: landBackdropProgress(z, providerReady.current),
          };
          for (const [key, value] of Object.entries(values)) {
            if (map.getGlobalState()[key] !== value)
              map.setGlobalStateProperty(key, value);
          }
          setZoom(z);
          setProgress(p);
        };
        map.on("zoom", syncZoom);
        map.on("style.load", () => {
          setRevision((v) => v + 1);
          syncZoom();
        });
        const isProvider = (id: string) => !id.startsWith("vessel-");
        // Geography, labels, dots and route sources share one loading indicator.
        // A single source finishing must not hide it while others still render.
        map.on("dataloading", () => setDrawing(true));
        map.on("render", () => {
          if (!map.loaded()) setDrawing(true);
        });
        // Keep already-rendered tiles and the blend during normal tile requests.
        map.on("idle", () => {
          const sources = Object.keys(map.getStyle().sources).filter(
            isProvider,
          );
          if (!sources.every((id) => map.isSourceLoaded(id))) return;
          providerReady.current = true;
          window.clearTimeout(timeout);
          setReady(true);
          setDrawing(false);
          if (!failedTiles.current) setStatus("");
          syncZoom();
        });
        map.on("error", () => {
          setDrawing(false);
          if (!providerReady.current) {
            latest.current.onUnavailable(
              "상세 지도 연결 실패 · 기본 지도를 표시합니다.",
            );
            return;
          }
          failedTiles.current = true;
          setTileFailure(true);
          setStatus(
            "상세 지도 일부를 불러오지 못했습니다. 표시 중인 지도를 유지합니다.",
          );
        });
        map.on("webglcontextlost", () =>
          latest.current.onUnavailable(
            "지도 그래픽 연결 중단 · 기본 지도를 표시합니다.",
          ),
        );
        let previousSize = Math.min(
          container.clientWidth,
          container.clientHeight,
        );
        observer = new ResizeObserver(() => {
          const nextSize = Math.min(
            container.clientWidth,
            container.clientHeight,
          );
          const reframe =
            viewRef.current === "globe" &&
            map.getZoom() < 3 &&
            previousSize > 0 &&
            nextSize > 0 &&
            nextSize !== previousSize;
          const nextZoom = map.getZoom() + Math.log2(nextSize / previousSize);
          map.resize();
          if (reframe) map.jumpTo({ zoom: nextZoom });
          previousSize = nextSize;
          const next =
            viewRef.current === "globe"
              ? -2
              : overviewZoom(
                  "mercator",
                  container.clientWidth,
                  container.clientHeight,
                );
          map.setMinZoom(next);
          setMinZoom(next);
        });
        observer.observe(container);
        setMinZoom(minimum);
        setZoom(initialZoom);
      } catch {
        if (!disposed)
          latest.current.onUnavailable(
            "상세 지도 연결 불가 · 기본 지도를 표시합니다.",
          );
      }
    }
    void initialize();
    return () => {
      disposed = true;
      abort.abort();
      window.clearTimeout(timeout);
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      providerReady.current = false;
    };
  }, []);

  // Fetch a new theme without resetting the camera or the selected shipment.
  const initialTheme = useRef(props.theme);
  useEffect(() => {
    if (initialTheme.current === props.theme) return;
    initialTheme.current = props.theme;
    const abort = new AbortController();
    const map = mapRef.current;
    if (!map) return;
    setStyleLoading(true);
    void (async () => {
      try {
        const style = await loadVesselStyle(
          props.theme === "dark",
          abort.signal,
          viewRef.current,
        );
        if (!abort.signal.aborted) {
          setDrawing(true);
          map.setStyle(style);
        }
      } catch {
        if (!abort.signal.aborted) {
          setDrawing(false);
          setStatus("지도 테마를 불러오지 못했습니다. 기존 지도를 유지합니다.");
        }
      } finally {
        if (!abort.signal.aborted) setStyleLoading(false);
      }
    })();
    return () => abort.abort();
  }, [props.theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("vessel-routes")) return;
    const markers: Marker[] = [];
    const orientations: (() => void)[] = [];
    const routes = [
      ...routesForVessels(props.visible, props.positions, props.selected?.id),
      ...(props.navigationRoutes ?? []),
    ];
    (map.getSource("vessel-routes") as GeoJSONSource).setData(
      routeFeatures(routes),
    );
    for (const s of props.visible) {
      const position = props.positions.find((p) => p.vessel_id === s.id)!;
      const button = document.createElement("button");
      const active = s.id === props.selected?.id;
      button.type = "button";
      button.dataset.vesselId = s.id;
      button.className = `vessel-online-marker vessel-map-marker${active ? " is-selected" : ""}`;
      button.setAttribute(
        "aria-label",
        `${s.vesselName}, ${s.status}, ${s.origin}, ${courseLabel(position)}, 상세 보기`,
      );
      button.setAttribute("aria-pressed", String(active));
      button.title = `${s.vesselName} · ${s.status} · ${courseLabel(position)} · ${s.source && s.source !== "demo" ? "AIS 관측 위치" : "샘플 위치"}`;
      const symbol = createVesselSymbol();
      button.append(symbol.svg);
      orientations.push(() =>
        symbol.update(
          projectedCourse(position, (coordinate) => {
            const point = map.project(coordinate);
            return [point.x, point.y];
          }),
        ),
      );
      if (active) {
        const label = document.createElement("span");
        label.className = "vessel-online-label";
        label.textContent = s.vesselName;
        button.append(label);
      }
      button.addEventListener("click", () => latest.current.onSelect(s.id));
      markers.push(
        new Marker({ element: button, opacityWhenCovered: 0 })
          .setLngLat([position.longitude, position.latitude])
          .addTo(map),
      );
    }
    for (const route of routesForVessels(
      props.visible,
      props.positions,
      props.selected?.id,
    )) {
      const origin = document.createElement("span");
      origin.className = "vessel-online-origin";
      origin.setAttribute("aria-hidden", "true");
      markers.push(
        new Marker({ element: origin, opacityWhenCovered: 0 })
          .setLngLat(route.coordinates[0])
          .addTo(map),
      );
    }
    for (const plant of props.plants.filter(
      (p) =>
        destinationCoordinates[p.id] &&
        props.visible.some((s) => s.plantId === p.id),
    )) {
      const port = document.createElement("span");
      port.className = "vessel-online-port";
      port.setAttribute("aria-hidden", "true");
      markers.push(
        new Marker({ element: port, opacityWhenCovered: 0 })
          .setLngLat(destinationCoordinates[plant.id])
          .addTo(map),
      );
    }
    const updateDirections = () => orientations.forEach((update) => update());
    updateDirections();
    map.on("move", updateDirections);
    map.on("projectiontransition", updateDirections);
    if (focusedMarker.current) {
      markers
        .find(
          (marker) =>
            marker.getElement().dataset.vesselId === focusedMarker.current,
        )
        ?.getElement()
        .focus({ preventScroll: true });
      focusedMarker.current = null;
    }
    return () => {
      map.off("move", updateDirections);
      map.off("projectiontransition", updateDirections);
      focusedMarker.current =
        document.activeElement?.getAttribute("data-vessel-id") ?? null;
      markers.forEach((marker) => marker.remove());
    };
  }, [
    props.visible,
    props.positions,
    props.selected?.id,
    props.plants,
    props.navigationRoutes,
    revision,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = (props.weatherPoints ?? []).map((point) => {
      const element = document.createElement("span");
      element.className = "vessel-weather-marker";
      element.textContent = point.waveM?.toFixed(1) ?? "–";
      element.title = `${point.label} · 파고 ${point.waveM == null ? "자료 없음" : `${point.waveM}m`} · 바람 ${point.windKn == null ? "자료 없음" : `${point.windKn}kn`}`;
      return new Marker({ element, opacityWhenCovered: 0 })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [props.weatherPoints, ready, revision]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("vessel-routes")) return;
    const overlay = props.weatherOverlay;
    if (!map.getSource("vessel-weather-exposure")) {
      map.addSource("vessel-weather-exposure", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "vessel-weather-wind34",
          source: "vessel-weather-exposure",
          type: "fill",
          filter: ["==", ["get", "kind"], "wind34"],
          paint: {
            "fill-color": "#dc824d",
            "fill-opacity": 0.18,
            "fill-outline-color": "#c86b34",
          },
        },
        "vessel-routes",
      );
      map.addLayer({
        id: "vessel-weather-cyclone-track",
        source: "vessel-weather-exposure",
        type: "line",
        filter: ["==", ["get", "kind"], "cyclone-track"],
        paint: {
          "line-color": "#dc824d",
          "line-width": 1.8,
          "line-dasharray": [2, 3],
        },
      });
      map.addLayer({
        id: "vessel-weather-passage",
        source: "vessel-weather-exposure",
        type: "circle",
        filter: ["==", ["get", "kind"], "passage"],
        paint: {
          "circle-radius": 12,
          "circle-color": "#8e86d6",
          "circle-opacity": 0.12,
          "circle-stroke-color": "#8e86d6",
          "circle-stroke-width": 2,
        },
      });
    }
    (map.getSource("vessel-weather-exposure") as GeoJSONSource).setData(
      overlay
        ? overlayFeatures(overlay)
        : { type: "FeatureCollection", features: [] },
    );
    const markers: Marker[] = [];
    overlay?.points.forEach((p, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.weatherPoint = `${props.selected?.id}/${p.longitude}/${p.latitude}/${p.passageAt}`;
      el.className = `vessel-weather-marker vessel-weather-value is-${weatherAttention(p, overlay.metric, overlay.now)}${i === overlay.index ? " is-active" : ""}`;
      el.textContent = metricText(p, overlay.metric);
      el.title = `통과 ${formatDate(p.passageAt, true)} KST · 파고 ${metricText(p, "wave")} · 바람 ${metricText(p, "wind")} · 시정 ${metricText(p, "visibility")}`;
      el.setAttribute("aria-label", el.title);
      el.setAttribute("aria-pressed", String(i === overlay.index));
      el.onclick = () => overlay.onSelectPoint(i);
      markers.push(
        new Marker({
          element: el,
          opacityWhenCovered: 0,
          offset: [0, i === overlay.index ? -40 : -20],
        })
          .setLngLat([p.longitude, p.latitude])
          .addTo(map),
      );
    });
    const passage =
      overlay?.points[Math.min(overlay.index, overlay.points.length - 1)];
    if (passage && overlay)
      for (const storm of overlay.storms) {
        const center = cycloneAt(storm, Date.parse(passage.passageAt));
        if (!center) continue;
        const el = document.createElement("span");
        el.className = "vessel-cyclone-marker";
        el.textContent = `◎ ${storm.name}`;
        el.title = `${center.forecast ? "예보" : "관측"} 중심 ${formatDate(center.at, true)} KST · ${storm.source} / GDACS`;
        el.tabIndex = 0;
        markers.push(
          new Marker({ element: el, opacityWhenCovered: 0, offset: [0, 24] })
            .setLngLat([center.longitude, center.latitude])
            .addTo(map),
        );
      }
    if (focusedWeather.current) {
      markers
        .find(
          (marker) =>
            marker.getElement().dataset.weatherPoint === focusedWeather.current,
        )
        ?.getElement()
        .focus({ preventScroll: true });
      focusedWeather.current = null;
    }
    return () => {
      focusedWeather.current =
        document.activeElement?.getAttribute("data-weather-point") ?? null;
      markers.forEach((marker) => marker.remove());
    };
  }, [props.weatherOverlay, ready, revision]);

  function changeView(next: MapView) {
    const map = mapRef.current;
    if (!map || next === viewRef.current) return;
    const atOverview = map.getZoom() < 3;
    viewRef.current = next;
    setView(next);
    const initial = overviewZoom(
      next,
      host.current!.clientWidth,
      host.current!.clientHeight,
    );
    const minimum = next === "globe" ? -2 : initial;
    map.setMinZoom(minimum);
    setMinZoom(minimum);
    map.setProjection({ type: next });
    if (atOverview) map.jumpTo({ zoom: initial });
  }

  function retryTiles() {
    const map = mapRef.current;
    if (!map) return;
    failedTiles.current = false;
    setTileFailure(false);
    setDrawing(true);
    setStatus("상세 지도 다시 연결 중");
    for (const [id, source] of Object.entries(map.getStyle().sources)) {
      if (source.type === "vector" || source.type === "raster")
        map.refreshTiles(id);
    }
  }

  const isDrawing = (drawing || styleLoading) && !tileFailure;
  return (
    <div
      className="vessel-map-online"
      data-map-ready={ready}
      data-map-view={view}
      data-map-mode={progress >= 1 ? "detail" : progress > 0 ? "morph" : "dots"}
      data-zoom={zoom.toFixed(2)}
      data-weather-polygons={
        props.weatherOverlay
          ? overlayFeatures(props.weatherOverlay).features.filter(
              (f) => f.geometry.type === "Polygon",
            ).length
          : 0
      }
    >
      <div ref={host} className="vessel-map-webgl" />
      <GlobeStars
        map={mapRef.current}
        active={ready && props.theme === "dark" && view === "globe"}
      />
      <MapDrawingOrb
        busy={isDrawing || !!props.weatherBusy}
        theme={props.theme}
      />
      <div className="vessel-map-toolbar" role="toolbar" aria-label="지도 도구">
        {props.weatherToolbar}
        <div className="vessel-map-controls" aria-label="지도 조작">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="지도 확대"
            disabled={!ready || zoom >= MAX_ZOOM}
            onClick={() =>
              mapRef.current?.zoomTo(Math.min(MAX_ZOOM, zoom + 1), {
                duration: 220,
              })
            }
          >
            <Plus />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="지도 축소"
            disabled={!ready || zoom <= minZoom + 0.01}
            onClick={() =>
              mapRef.current?.zoomTo(Math.max(minZoom, zoom - 1), {
                duration: 220,
              })
            }
          >
            <Minus />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="전체 세계지도 보기"
            disabled={!ready}
            onClick={() => resetRef.current()}
          >
            <RotateCcw />
          </Button>
        </div>
        <div
          className="vessel-map-view-switch"
          role="group"
          aria-label="지도 보기 방식"
        >
          <button
            type="button"
            aria-label="지구본 보기"
            aria-pressed={view === "globe"}
            disabled={!ready}
            onClick={() => changeView("globe")}
          >
            <Globe2 size={13} />
            지구본
          </button>
          <button
            type="button"
            aria-label="평면 보기"
            aria-pressed={view === "mercator"}
            disabled={!ready}
            onClick={() => changeView("mercator")}
          >
            <MapIcon size={13} />
            평면
          </button>
        </div>
      </div>
      {status && !isDrawing && (
        <span role="status" className="vessel-map-status">
          {status}
          {tileFailure && (
            <button type="button" onClick={retryTiles}>
              지도 타일 다시 시도
            </button>
          )}
        </span>
      )}
    </div>
  );
}
