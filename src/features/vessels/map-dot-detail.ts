import {
  GeoJSONWrapper,
  fromVectorTileJs,
  type Feature,
} from "@maplibre/vt-pbf";
import { morphProgress } from "./map-data.ts";

const smoothstep = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

export function landBackdropProgress(zoom: number, ready: boolean) {
  if (!ready) return 0;
  return Math.max(
    0.55 + 0.1 * smoothstep((zoom - 1.5) / 2),
    morphProgress(zoom, true),
  );
}

export const dotColor = (dark: boolean) => (dark ? "#62626b" : "#a9a9b2");

// One continuous radius curve for overview and detail, including fractional zoom.
export function dotRadius(zoom: number) {
  if (zoom < 0) {
    const lower = Math.floor(zoom);
    return 0.8 * 2 ** lower * (1 + zoom - lower);
  }
  if (zoom < 1) return 0.8 + 0.62 * zoom;
  return 1.05 + 0.37 * Math.min(6.25, Math.max(0, zoom));
}

export const DOT_TILE_PROTOCOL = "vessel-dots";
const extent = 4096;
const tileCache = new Map<number, Uint8Array>();

export function dotTileFeatures(zoom: number): Feature[] {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 6)
    throw new Error("Invalid dot zoom");
  // A 256-column world grid makes coastlines readable even in the home view.
  // Through z2 only tile partitioning changes; above z2 we insert new points.
  const cells = 64 * 2 ** Math.max(0, 2 - zoom);
  const features: Feature[] = [];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // Every parent point is present in its children at exactly the same location.
      // Only the newly inserted points fade in as the zoom increases.
      let birthZoom = zoom;
      let px = x,
        py = y;
      while (birthZoom > 2 && px % 2 === 0 && py % 2 === 0) {
        birthZoom--;
        px /= 2;
        py /= 2;
      }
      features.push({
        type: 1,
        tags: { birthZoom: birthZoom <= 2 ? 0 : birthZoom },
        geometry: [[(x * extent) / cells, (y * extent) / cells]],
      });
    }
  }
  return features;
}

export function dotTile(zoom: number): ArrayBuffer {
  let tile = tileCache.get(zoom);
  if (!tile) {
    const layer = new GeoJSONWrapper(dotTileFeatures(zoom), {
      extent,
      version: 2,
    });
    layer.name = "dots";
    tile = fromVectorTileJs({ layers: { dots: layer } });
    tileCache.set(zoom, tile);
  }
  // Protocol responses are transferred to the worker; never detach the cached template.
  // Up to zoom 6, x/y share a template because the 64-cell grid is divisible by 2^zoom.
  return tile.slice().buffer as ArrayBuffer;
}
