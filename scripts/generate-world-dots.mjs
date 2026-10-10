// Aceternity World Map's dotted-map background, precomputed for offline use.
import DottedMap, { getMapJSON } from "dotted-map";
import { mkdirSync, writeFileSync } from "node:fs";

const region = { lat: { min: -58, max: 82 }, lng: { min: -180, max: 180 } };
mkdirSync("src/data", { recursive: true });
// Separate resolutions keep the overview sparse and reveal land detail on zoom.
if (!process.argv.includes("--flat-only"))
  for (const [height, suffix] of [
    [100, ""],
    [180, "-medium"],
    [320, "-detailed"],
  ]) {
    const map = new DottedMap({
      height,
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
    writeFileSync(`src/data/world-dots${suffix}.json`, JSON.stringify(points));
    console.log(
      `Generated ${points.length} land dots (${height}); no runtime geography fetch needed.`,
    );
  }

// dotted-map uses ellipsoidal WGS84 Mercator; invert its actual projected grid.
// Using latitude-linear rows in Web Mercator stretches the northern row gaps.
function fromMercator(x, y) {
  const a = 6378137;
  const eccentricity = Math.sqrt(0.0066943799901413165);
  const t = Math.exp(-y / a);
  let latitude = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 12; i++) {
    const eSin = eccentricity * Math.sin(latitude);
    latitude =
      Math.PI / 2 -
      2 * Math.atan(t * Math.pow((1 - eSin) / (1 + eSin), eccentricity / 2));
  }
  return [
    Number((((x / a) * 180) / Math.PI).toFixed(4)),
    Number(((latitude * 180) / Math.PI).toFixed(4)),
  ];
}
for (const [width, suffix] of [
  [260, ""],
  [460, "-medium"],
  [820, "-detailed"],
]) {
  const data = JSON.parse(
    getMapJSON({
      width,
      grid: "diagonal",
      region: { lat: { min: -58, max: 85.05 }, lng: { min: -180, max: 180 } },
      projection: { name: "mercator" },
    }),
  );
  const points = Object.values(data.points).map(({ x, y }) =>
    fromMercator(
      data.X_MIN + (x / data.width) * data.X_RANGE,
      data.Y_MAX - (y / data.height) * data.Y_RANGE,
    ),
  );
  writeFileSync(
    "src/data/world-dots-flat" + suffix + ".json",
    JSON.stringify(points),
  );
  console.log(
    "Generated " + points.length + " flat-map dots (width " + width + ").",
  );
}
