/**
 * Adapted from Aceternity UI World Map by Manu Arora.
 * https://ui.aceternity.com/components/world-map
 * https://ui.aceternity.com/registry/world-map.json
 * Adaptations: precomputed dotted-map land, shared geographic projection with
 * vessel markers, ocean waypoints, theme tokens and reduced-motion support.
 */
import { memo, useId, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useMapContext } from "react-simple-maps";
import landDots from "../../data/world-dots.json";

type Coordinate = [number, number];
export interface WorldMapRoute {
  id: string;
  coordinates: Coordinate[];
  selected: boolean;
}

export const WorldMap = memo(function WorldMap({
  routes,
}: {
  routes: WorldMapRoute[];
}) {
  const { projection, path } = useMapContext();
  const gradientId = `route-${useId().replace(/:/g, "")}`;
  const reduceMotion = useReducedMotion();
  const dots = useMemo(
    () =>
      landDots
        .map((coordinate) => {
          const point = projection(coordinate as Coordinate);
          if (!point) return "";
          const [x, y] = point;
          const r = 1.05;
          return `M${(x - r).toFixed(2)},${y.toFixed(2)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
        })
        .join(""),
    [projection],
  );

  return (
    <g
      className="aceternity-world-map"
      aria-hidden="true"
      data-reduced-motion={Boolean(reduceMotion)}
    >
      <path d={dots} className="vessel-map-dots" />
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
          d={path({ type: "LineString", coordinates: route.coordinates }) ?? ""}
          className={`vessel-map-route ${route.selected ? "is-selected" : ""}`}
          stroke={
            route.selected ? `url(#${gradientId})` : "var(--muted-foreground)"
          }
          fill="none"
          vectorEffect="non-scaling-stroke"
          initial={reduceMotion || !route.selected ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
        />
      ))}
    </g>
  );
});
