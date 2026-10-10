import { useMapContext, useZoomPanContext } from "react-simple-maps";
import {
  DECK_PATH,
  HULL_PATH,
  projectedCourse,
  type MapPosition,
} from "./vessel-symbol";

export function OfflineVesselSymbol({
  position,
  active,
  name,
}: {
  position: MapPosition;
  active: boolean;
  name: string;
}) {
  const { projection } = useMapContext();
  const { k } = useZoomPanContext();
  const angle = projectedCourse(position, projection);
  return (
    <g transform={`scale(${1 / k})`}>
      <rect
        className="vessel-glyph-hit"
        x={-16}
        y={-18}
        width={32}
        height={36}
        rx={5}
      />
      <g
        className="vessel-glyph"
        data-direction={angle === null ? "unknown" : "known"}
        data-screen-angle={angle ?? ""}
      >
        <g
          className="vessel-glyph-rotation"
          transform={`rotate(${angle ?? 0})`}
        >
          <path
            className="vessel-glyph-outline"
            d={HULL_PATH}
            transform="scale(1.35 1.22)"
          />
          <path className="vessel-glyph-hull" d={HULL_PATH} />
          <path className="vessel-glyph-deck" d={DECK_PATH} />
        </g>
        <g className="vessel-glyph-unknown">
          <circle className="vessel-glyph-outline" r={10} />
          <circle className="vessel-glyph-dot" r={6} />
          <circle r={1.6} fill="currentColor" />
        </g>
      </g>
      {active && (
        <text x={23} y={4} className="vessel-map-marker-label">
          {name}
        </text>
      )}
    </g>
  );
}
