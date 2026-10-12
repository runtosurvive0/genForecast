import { KOREA_NEARBY_BOUNDS } from "./vessel-discovery.ts";
import { destinationCoordinates } from "./map-data.ts";

// Approximate reference points, not port boundaries or coastline distances.
// Selected port points from the existing searoute 1.6.0 catalog (Apache-2.0):
// https://github.com/genthalili/searoute-py (see THIRD_PARTY_NOTICES.md).
// Dangjin/Donghae reuse this app's plant-port points; Jeju is the UNECE
// KRCHA locality point, 3330N 12631E (not a specific berth):
// https://service.unece.org/trade/locode/kr.htm
const references: readonly (readonly [string, number, number])[] = [
  ["인천항", 126.620786, 37.480609],
  ["당진 발전소 항만", ...destinationCoordinates.dangjin],
  ["대산항", 126.352749, 36.991574],
  ["군산항", 126.699829, 35.97745],
  ["목포항", 126.39432, 34.762154],
  ["광양항", 127.592468, 34.945453],
  ["삼천포항", 128.053124, 34.868922],
  ["마산항", 128.572998, 35.199106],
  ["부산항", 129.035797, 35.098203],
  ["울산항", 129.429932, 35.496626],
  ["포항항", 129.37216, 36.033333],
  ["동해 발전소 항만", ...destinationCoordinates.donghae],
  ["속초항", 128.579404, 38.229614],
  ["제주", 126 + 31 / 60, 33.5],
];

export function describeKoreanPosition(
  position: { latitude: number; longitude: number; observedAt: string } | null | undefined,
  now = Date.now(),
) {
  if (!position) return null;
  const { latitude, longitude, observedAt } = position;
  const observed = Date.parse(observedAt);
  const bounds = KOREA_NEARBY_BOUNDS;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      !Number.isFinite(observed) || observed > now ||
      latitude < bounds.south || latitude > bounds.north ||
      longitude < bounds.west || longitude > bounds.east) return null;

  const rad = Math.PI / 180;
  const lat = latitude * rad;
  const nearest = references.map(([name, lon, referenceLat]) => {
    const fromLat = referenceLat * rad;
    const dLon = (longitude - lon) * rad;
    const a = Math.sin((lat - fromLat) / 2) ** 2 +
      Math.cos(fromLat) * Math.cos(lat) * Math.sin(dLon / 2) ** 2;
    const distanceKm = 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    const bearing = (Math.atan2(Math.sin(dLon) * Math.cos(lat),
      Math.cos(fromLat) * Math.sin(lat) - Math.sin(fromLat) * Math.cos(lat) * Math.cos(dLon)) / rad + 360) % 360;
    return { name, distanceKm, bearing };
  }).reduce((best, next) => next.distanceKm < best.distanceKm ? next : best);
  const direction = ["북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽"][Math.round(nearest.bearing / 45) % 8];
  return {
    reference: nearest.name,
    label: nearest.distanceKm < 1
      ? `${nearest.name} 기준점 부근`
      : `${nearest.name} ${direction} 약 ${Math.round(nearest.distanceKm)}km`,
    stale: now - observed > 3600000,
  };
}
