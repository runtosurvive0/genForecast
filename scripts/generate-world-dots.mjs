// Aceternity World Map's dotted-map background, precomputed for offline use.
import DottedMap from "dotted-map";
import { mkdirSync, writeFileSync } from "node:fs";

const region = { lat: { min: -58, max: 82 }, lng: { min: -180, max: 180 } };
const map = new DottedMap({
  height: 100,
  grid: "diagonal",
  region,
  projection: { name: "equirectangular" },
});
const points = map
  .getPoints()
  .map(({ x, y }) => [
    Number((region.lng.min + (x / map.image.width) * 360).toFixed(4)),
    Number((region.lat.max - (y / map.image.height) * 140).toFixed(4)),
  ]);
mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/world-dots.json", JSON.stringify(points));
console.log(
  `Generated ${points.length} land dots; no runtime geography fetch needed.`,
);
