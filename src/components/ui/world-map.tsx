/**
 * Adapted from Aceternity UI World Map by Manu Arora.
 * https://ui.aceternity.com/components/world-map
 * https://ui.aceternity.com/registry/world-map.json
 * Adaptations: precomputed dotted-map land, shared geographic projection with
 * vessel markers, ocean waypoints, theme tokens and reduced-motion support.
 */
import { memo, useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useMapContext, useZoomPanContext } from "react-simple-maps";
import landDots from "../../data/world-dots.json";
import mediumLandDots from "../../data/world-dots-medium.json";
import detailedLandDots from "../../data/world-dots-detailed.json";

type Coordinate = [number, number];
export interface WorldMapRoute {
  id: string;
  coordinates: Coordinate[];
  selected: boolean;
  kind?: "sample" | "estimated" | "observed" | "connector";
}

export const WorldMap = memo(function WorldMap({
  routes,
}: {
  routes: WorldMapRoute[];
}) {
  const { projection, path } = useMapContext();
  const { k: zoom } = useZoomPanContext();
  const resolution =
    zoom >= 3.2 ? detailedLandDots : zoom >= 1.8 ? mediumLandDots : landDots;
  const gradientId = `route-${useId().replace(/:/g, "")}`;
  const reduceMotion = useReducedMotion();
  const dots = useMemo(
    () =>
      resolution
        .map((coordinate) => {
          const point = projection(coordinate as Coordinate);
          if (!point) return "";
          const [x, y] = point;
          // Round, zero-length strokes render circles without scaling their size.
          return `M${x.toFixed(2)},${y.toFixed(2)}h0`;
        })
        .join(""),
    [projection, resolution],
  );

  return (
    <g
      className="aceternity-world-map"
      aria-hidden="true"
      data-reduced-motion={Boolean(reduceMotion)}
    >
      <path
        d={dots}
        className="vessel-map-dots"
        stroke="var(--map-dot)"
        strokeWidth={2.1}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.4" />
          <stop offset="35%" stopColor="var(--primary)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--primary)" />
        </linearGradient>
      </defs>
      {routes.map((route) => (
        <motion.path
          key={`${route.id}-${route.selected}`}
          data-route-kind={route.kind ?? "sample"}
          strokeDasharray={
            route.kind === "connector"
              ? "1 4"
              : route.kind === "estimated"
                ? "5 5"
                : undefined
          }
          d={path({ type: "LineString", coordinates: route.coordinates }) ?? ""}
          className={`vessel-map-route ${route.selected ? "is-selected" : ""}`}
          stroke={
            route.selected ? `url(#${gradientId})` : "var(--muted-foreground)"
          }
          fill="none"
          vectorEffect="non-scaling-stroke"
          initial={
            reduceMotion || !route.selected || route.kind
              ? false
              : { pathLength: 0 }
          }
          animate={route.kind ? undefined : { pathLength: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
        />
      ))}
    </g>
  );
});
