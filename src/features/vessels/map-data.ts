export type Coordinate = [number, number];
interface VesselSample {
  origin: Coordinate;
  beforePosition: Coordinate[];
  afterPosition: Coordinate[];
}

// Illustrative ocean waypoints, not AIS history or navigational routing.
// The marker and route anchor both come from the current positions input.
export const samples: Record<string, VesselSample> = {
  "ship-dj": {
    origin: [151.78, -32.93],
    beforePosition: [
      [155, -27],
      [156, -15],
      [154, -5],
      [145, 6],
      [135, 16],
      [128, 24],
      [124, 30],
      [124, 35],
    ],
    afterPosition: [],
  },
  "ship-br": {
    origin: [117.2, -0.53],
    beforePosition: [
      [118.5, 1],
      [119.5, 5],
      [119, 10],
      [118, 16],
      [120, 20],
      [122.5, 21.5],
      [123.5, 23.5],
    ],
    afterPosition: [
      [123.8, 29],
      [124, 34],
    ],
  },
  "ship-hd": {
    origin: [151.27, -23.84],
    beforePosition: [
      [155, -17],
      [154, -7],
      [154, -3],
      [147, 0],
      [140, 0],
      [135, 1],
      [132, 2.5],
    ],
    afterPosition: [
      [129, 8],
      [129, 14],
      [130, 23],
      [128, 30],
      [127, 32],
      [128, 34],
    ],
  },
  "ship-dh": {
    origin: [117.57, 3.3],
    beforePosition: [
      [120, 5],
      [121, 7],
    ],
    afterPosition: [
      [121, 11],
      [119, 16],
      [120, 20],
      [122.5, 21.5],
      [125, 25],
      [127, 30],
      [127, 32],
      [129, 34],
      [130, 35.5],
    ],
  },
};
export const destinationCoordinates: Record<string, Coordinate> = {
  dangjin: [126.45, 36.98],
  boryeong: [126.47, 36.4],
  hadong: [127.79, 34.95],
  donghae: [129.15, 37.49],
};
export const initialView = { coordinates: [150, 0] as Coordinate, zoom: 1 };
export const fullWorld = { coordinates: [150, 0] as Coordinate, zoom: 1 };

export function validPosition(p: { latitude: number; longitude: number }) {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}
export function unwrapRoute(coordinates: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (const [lng, lat] of coordinates) {
    const previous = result.at(-1)?.[0] ?? lng;
    result.push([lng + 360 * Math.round((previous - lng) / 360), lat]);
  }
  return result;
}
export function morphProgress(zoom: number, ready: boolean) {
  return ready ? Math.min(1, Math.max(0, (zoom - 4.75) / 1.5)) : 0;
}

export type MapView = "globe" | "mercator";
export const onlineHome: Coordinate = [125, 15];
export function overviewZoom(view: MapView, width: number, height: number) {
  return view === "globe"
    ? Math.log2(Math.max(1, Math.min(width, height)) / 512) + 1.73
    : Math.max(-1, Math.min(1.4, Math.log2(Math.max(1, width) / 512)));
}

export function routesForVessels(
  vessels: { id: string; plantId: string; source?: string }[],
  positions: { vessel_id: string; longitude: number; latitude: number }[],
  selectedId?: string,
): { id: string; selected: boolean; coordinates: Coordinate[] }[] {
  return vessels.flatMap((vessel) => {
    if (vessel.source && vessel.source !== "demo") return [];
    const sample = samples[vessel.id];
    const destination = destinationCoordinates[vessel.plantId];
    const position = positions.find(
      (p) => p.vessel_id === vessel.id && validPosition(p),
    );
    if (!sample || !destination || !position) return [];
    const coordinates: Coordinate[] = [
      sample.origin,
      ...sample.beforePosition,
      [position.longitude, position.latitude],
      ...sample.afterPosition,
      destination,
    ];
    return [
      {
        id: vessel.id,
        selected: vessel.id === selectedId,
        // An arrived vessel may already be exactly at the final port.
        coordinates: coordinates.filter(
          (p, i) =>
            !i ||
            p[0] !== coordinates[i - 1][0] ||
            p[1] !== coordinates[i - 1][1],
        ),
      },
    ];
  });
}
