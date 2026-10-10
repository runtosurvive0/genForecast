import type { Coordinate } from "./map-data.ts";

export interface VesselMotion {
  cogDeg?: number | null;
  sogKn?: number | null;
  navStatus?: number | null;
}
export interface MapPosition extends VesselMotion {
  vessel_id: string;
  longitude: number;
  latitude: number;
  received_at: string;
}

export const HULL_PATH = "M0 -13 L6 -4 L6 9 Q0 12 -6 9 L-6 -4 Z";
export const DECK_PATH = "M-2.5 5 L2.5 5";

/** COG is motion over ground, not the ship's true heading. */
export function vesselCourse(p: VesselMotion): number | null {
  const { cogDeg: course, sogKn: speed } = p;
  return typeof course === "number" &&
    Number.isFinite(course) &&
    course >= 0 &&
    course < 360 &&
    typeof speed === "number" &&
    Number.isFinite(speed) &&
    speed >= 0.5 &&
    speed < 102.3 &&
    p.navStatus !== 1 &&
    p.navStatus !== 5
    ? course
    : null;
}

export function courseLabel(p: VesselMotion) {
  const course = vesselCourse(p);
  return course === null
    ? "진행 방향 미표시 · 정지·저속 또는 관측 미확인"
    : `진행 방향 ${course.toFixed(1)}° · COG`;
}

/** Project the local geodesic tangent; simply rotating by COG is wrong on a globe. */
export function projectedCourse(
  p: VesselMotion & { longitude: number; latitude: number },
  project: (coordinate: Coordinate) => Coordinate | null,
): number | null {
  const course = vesselCourse(p);
  if (course === null) return null;
  const rad = Math.PI / 180;
  const lat = p.latitude * rad,
    lon = p.longitude * rad,
    bearing = course * rad;
  const center = project([p.longitude, p.latitude]);
  if (!center?.every(Number.isFinite)) return null;
  const vectors: Coordinate[] = [];
  // At a wrap seam one side jumps across the world; choose the shorter tangent.
  for (const sign of [1, -1]) {
    const step = sign * 0.0001;
    const nextLat = Math.asin(
      Math.max(
        -1,
        Math.min(
          1,
          Math.sin(lat) * Math.cos(step) +
            Math.cos(lat) * Math.sin(step) * Math.cos(bearing),
        ),
      ),
    );
    const nextLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(step) * Math.cos(lat),
        Math.cos(step) - Math.sin(lat) * Math.sin(nextLat),
      );
    const point = project([nextLon / rad, nextLat / rad]);
    if (!point?.every(Number.isFinite)) continue;
    const vector: Coordinate = [
      (point[0] - center[0]) * sign,
      (point[1] - center[1]) * sign,
    ];
    if (Math.hypot(...vector) > 1e-8) vectors.push(vector);
  }
  vectors.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  if (!vectors.length) return null;
  const [dx, dy] = vectors[0];
  return (Math.atan2(dx, -dy) / rad + 360) % 360;
}

/** Static SVG only: no vessel-supplied string is interpolated into markup. */
export function createVesselSymbol() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-18 -18 36 36");
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "36");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("vessel-glyph");
  svg.innerHTML = `<g class="vessel-glyph-rotation"><path class="vessel-glyph-outline" d="${HULL_PATH}" transform="scale(1.35 1.22)"/><path class="vessel-glyph-hull" d="${HULL_PATH}"/><path class="vessel-glyph-deck" d="${DECK_PATH}"/></g><g class="vessel-glyph-unknown"><circle class="vessel-glyph-outline" r="10"/><circle class="vessel-glyph-dot" r="6"/><circle r="1.6" fill="currentColor"/></g>`;
  return {
    svg,
    update(angle: number | null) {
      svg.dataset.direction = angle === null ? "unknown" : "known";
      svg
        .querySelector(".vessel-glyph-rotation")!
        .setAttribute("transform", `rotate(${angle ?? 0})`);
      svg.dataset.screenAngle = angle === null ? "" : String(angle);
    },
  };
}
