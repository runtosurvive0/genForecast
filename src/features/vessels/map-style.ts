import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import { unwrapRoute, type Coordinate, type MapView } from "./map-data";

import { dotColor, dotRadius, DOT_TILE_PROTOCOL } from "./map-dot-detail";

export const STYLE_URL = "https://tiles.openfreemap.org/styles/";
export const MAX_ZOOM = 18;
export const ATTRIBUTION =
  'Powered by <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>';

export async function loadVesselStyle(
  dark: boolean,
  signal: AbortSignal,
  view: MapView = "globe",
): Promise<StyleSpecification> {
  const response = await fetch(STYLE_URL + (dark ? "dark" : "positron"), {
    signal,
  });
  if (!response.ok) throw new Error("Map style unavailable");
  const style: StyleSpecification = await response.json();
  // Resolve TileJSON to retain all data credits without duplicating the optional provider brand.
  await Promise.all(
    Object.values(style.sources).map(async (source) => {
      if (source.type !== "vector" || !source.url) return;
      const response = await fetch(source.url, { signal });
      if (!response.ok) throw new Error("Map source unavailable");
      const data = await response.json();
      source.tiles = data.tiles;
      source.minzoom = data.minzoom;
      source.maxzoom = data.maxzoom;
      source.attribution = String(data.attribution ?? "")
        .replace(/<a\b[^>]*>OpenFreeMap<\/a>\s*/gi, "")
        .replace(/Data from\s*/g, "")
        .replace(/>OpenStreetMap<\/a>/g, ">© OpenStreetMap</a>");
      delete source.url;
    }),
  );
  return vesselStyle(style, dark, view);
}
export const palette = (dark: boolean) =>
  dark
    ? {
        ocean: "#19191c",
        land: "#303035",
        dot: dotColor(true),
        route: "#aaa3ff",
      }
    : {
        ocean: "#f8f8f7",
        land: "#dededc",
        dot: dotColor(false),
        route: "#625bc4",
      };

const progress: ExpressionSpecification = [
  "coalesce",
  ["global-state", "morph"],
  0,
];

const dotsReady: ExpressionSpecification = [
  "coalesce",
  ["global-state", "dotsReady"],
  0,
];
const landBackdrop: ExpressionSpecification = [
  "coalesce",
  ["global-state", "landBackdrop"],
  0,
];

const radius: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  -2,
  dotRadius(-2),
  -1,
  dotRadius(-1),
  0,
  dotRadius(0),
  1,
  dotRadius(1),
  6.25,
  dotRadius(6.25),
];

function fadeOpacity(value: unknown): unknown {
  // A zoom expression must stay at the top level; multiply only its outputs.
  if (
    Array.isArray(value) &&
    value[0] === "interpolate" &&
    Array.isArray(value[2]) &&
    value[2][0] === "zoom"
  ) {
    return value.map((part, i) =>
      i >= 4 && i % 2 === 0 ? ["*", progress, part] : part,
    );
  }
  if (
    Array.isArray(value) &&
    value[0] === "step" &&
    Array.isArray(value[1]) &&
    value[1][0] === "zoom"
  ) {
    return value.map((part, i) =>
      i >= 2 && i % 2 === 0 ? ["*", progress, part] : part,
    );
  }
  return ["*", progress, value ?? 1];
}

export function vesselStyle(
  source: StyleSpecification,
  dark: boolean,
  view: MapView = "globe",
): StyleSpecification {
  const style = structuredClone(source);
  const colors = palette(dark);
  // Camera-driven blending is already continuous; no extra time-based paint lag.
  style.transition = { duration: 0, delay: 0 };
  style.projection = { type: view };
  style.sky = {
    "sky-color": dark ? "#0c0c10" : "#e9e9ee",
    "horizon-color": dark ? "#555563" : "#c3c3cd",
    "fog-color": colors.ocean,
    "sky-horizon-blend": 0.15,
    "horizon-fog-blend": 0.2,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.3, 3, 0],
  };
  // Keep the supplied source attribution, glyphs and sprite URLs intact.
  // A zoom-driven global value also lets us hold the dots while tiles load.
  for (const layer of style.layers) {
    const paint = (layer.paint ??= {}) as Record<string, unknown>;
    if (layer.type === "background") {
      paint["background-color"] = [
        "interpolate",
        ["linear"],
        landBackdrop,
        0,
        colors.ocean,
        1,
        colors.land,
      ];
    } else if (layer.type === "fill" && layer["source-layer"] === "water") {
      paint["fill-color"] = colors.ocean;
      paint["fill-opacity"] = 1;
    } else {
      // Preserve provider expressions (including zoom) by gating visibility at the layer level.
      layer.minzoom = Math.max(
        layer.minzoom ?? 0,
        layer.type === "symbol" ? 6 : 4,
      );
      if (dark && layer.type === "symbol") {
        paint["text-color"] = "#b0b0b6";
        paint["text-halo-color"] = "#252528";
      }
      const opacityKeys =
        layer.type === "symbol"
          ? ["text-opacity", "icon-opacity"]
          : [`${layer.type}-opacity`];
      for (const key of opacityKeys) paint[key] = fadeOpacity(paint[key]);
    }
  }
  const firstGeography = style.layers.findIndex(
    (layer) => layer.type !== "background",
  );
  const dotsIndex = firstGeography < 0 ? style.layers.length : firstGeography;
  // Locally generated, cached vector tiles keep detail bounded to the visible viewport.
  // Water above the dots clips them to the current provider coastline, including islands.
  style.sources["vessel-dot-detail"] = {
    type: "vector",
    tiles: [DOT_TILE_PROTOCOL + "://{z}/{x}/{y}"],
    minzoom: 0,
    maxzoom: 6,
  };
  style.layers.splice(dotsIndex, 0, {
    id: "vessel-dot-detail",
    source: "vessel-dot-detail",
    "source-layer": "dots",
    type: "circle",
    maxzoom: 6.25,
    paint: {
      "circle-color": colors.dot,
      "circle-radius": radius,
      "circle-opacity": [
        "*",
        dark ? 0.75 : 0.85,
        dotsReady,
        ["-", 1, progress],
        [
          "case",
          ["==", ["get", "birthZoom"], 0],
          1,
          [
            "interpolate",
            ["linear"],
            [
              "-",
              ["coalesce", ["global-state", "mapZoom"], 0],
              ["get", "birthZoom"],
            ],
            0,
            0,
            0.7,
            1,
          ],
        ],
      ],
      "circle-pitch-alignment": "map",
    },
  });
  style.sources["vessel-routes"] = {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  };
  style.layers.push({
    id: "vessel-routes",
    source: "vessel-routes",
    type: "line",
    filter: [
      "all",
      ["!=", ["get", "kind"], "estimated"],
      ["!=", ["get", "kind"], "connector"],
    ],
    paint: {
      "line-color": colors.route,
      "line-width": ["case", ["get", "selected"], 1.8, 1],
      "line-opacity": ["case", ["get", "selected"], 1, 0.3],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  style.layers.push({
    id: "vessel-estimated-routes",
    source: "vessel-routes",
    type: "line",
    filter: ["==", ["get", "kind"], "estimated"],
    paint: {
      "line-color": colors.route,
      "line-width": 1.8,
      "line-opacity": 0.85,
      "line-dasharray": [3, 3],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  style.layers.push({
    id: "vessel-route-connections",
    source: "vessel-routes",
    type: "line",
    filter: ["==", ["get", "kind"], "connector"],
    paint: {
      "line-color": colors.route,
      "line-width": 1.2,
      "line-opacity": 0.65,
      "line-dasharray": [1, 3],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  return style;
}

export function routeFeatures(
  routes: {
    id: string;
    selected: boolean;
    coordinates: Coordinate[];
    kind?: string;
  }[],
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature",
      properties: {
        id: route.id,
        selected: route.selected,
        kind: route.kind ?? "sample",
      },
      geometry: {
        type: "LineString",
        coordinates: unwrapRoute(route.coordinates),
      },
    })),
  };
}
