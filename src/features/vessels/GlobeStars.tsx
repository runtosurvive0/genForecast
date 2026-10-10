import { useEffect, useRef } from "react";
import type { Map } from "maplibre-gl";
import { projectStarField } from "./globe-stars";

export function GlobeStars({
  map,
  active,
}: {
  map: Map | null;
  active: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!map || !active) return;
    let previous = "";
    function draw() {
      if (!context || !map) return;
      const host = map.getContainer();
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      const center = map.getCenter();
      const screen = map.project(center);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const view = {
        width,
        height,
        centerX: screen.x,
        centerY: screen.y,
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        fov: map.getVerticalFieldOfView(),
      };
      const key = JSON.stringify([view, dpr]);
      if (key === previous) return;
      previous = key;
      const pixelWidth = Math.round(width * dpr),
        pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#c9cbd3";
      for (const star of projectStarField(view).points) {
        context.globalAlpha = star.opacity;
        context.fillRect(
          star.x - star.size / 2,
          star.y - star.size / 2,
          star.size,
          star.size,
        );
      }
      context.globalAlpha = 1;
    }
    // No autonomous animation or map repaint requests: only follow the camera.
    map.on("render", draw);
    draw();
    return () => {
      map.off("render", draw);
    };
  }, [map, active]);
  return (
    <canvas
      ref={ref}
      className="vessel-map-stars"
      hidden={!active}
      aria-hidden="true"
    />
  );
}
