type Star = {
  id: number;
  direction: [number, number, number];
  size: number;
  opacity: number;
};
export interface StarView {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  fov: number;
}
const radians = Math.PI / 180;
// Decorative, deterministic directions at infinity, not an astronomical catalog.
let seed = 0x6e6746;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const stars: Star[] = Array.from({ length: 1200 }, (_, id) => {
  const y = 2 * random() - 1;
  const angle = 2 * Math.PI * random();
  const radius = Math.sqrt(1 - y * y);
  return {
    id,
    direction: [radius * Math.cos(angle), y, radius * Math.sin(angle)],
    size: 1 + 0.4 * random(),
    opacity: 0.24 + 0.34 * random(),
  };
});

export function projectStarField(view: StarView) {
  const { width, height, centerX: cx, centerY: cy } = view;
  const focal = height / (2 * Math.tan((view.fov * radians) / 2));
  // Same perspective sphere as MapLibre's pitch/roll-zero globe camera.
  const sphere =
    (512 * 2 ** view.zoom) /
    (2 *
      Math.PI *
      Math.cos(Math.min(Math.abs(view.latitude), 85.0511287798) * radians));
  const radius =
    (focal * sphere) / Math.sqrt(focal * focal + 2 * focal * sphere);
  const points: {
    id: number;
    x: number;
    y: number;
    size: number;
    opacity: number;
  }[] = [];
  if (radius >= Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)))
    return { radius, points };
  const lng = view.longitude * radians,
    lat = view.latitude * radians,
    bearing = view.bearing * radians;
  const sl = Math.sin(lng),
    cl = Math.cos(lng),
    sp = Math.sin(lat),
    cp = Math.cos(lat);
  const sb = Math.sin(bearing),
    cb = Math.cos(bearing);
  for (const star of stars) {
    const [sx, sy, sz] = star.direction;
    const east = sx * cl - sz * sl;
    const north = -sx * sp * sl + sy * cp - sz * sp * cl;
    const depth = -(sx * cp * sl + sy * sp + sz * cp * cl);
    if (depth <= 0) continue;
    const x = cx + (focal * (east * cb - north * sb)) / depth;
    const y = cy - (focal * (east * sb + north * cb)) / depth;
    if (
      x < 0 ||
      x > width ||
      y < 0 ||
      y > height ||
      Math.hypot(x - cx, y - cy) <= radius + 2
    )
      continue;
    points.push({ id: star.id, x, y, size: star.size, opacity: star.opacity });
  }
  return { radius, points };
}
