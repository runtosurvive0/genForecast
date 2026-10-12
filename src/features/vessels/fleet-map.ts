import { validateVessel } from '../../domain/vessel-workflow.ts';
import type { FeatureCollection, Point } from 'geojson';

export type FleetProperties = { kind: 'vessel' | 'cluster'; count: number; fresh: boolean;
  mmsi?: string; name?: string; course?: number | null; cellDegrees?: number };
export type FleetSnapshot = FeatureCollection<Point, FleetProperties> & {
  visibleCount: number; fetchedAt: string; lastReceivedAt: string | null;
};
export function fleetBounds(west: number, east: number, south: number, north: number, zoom: number) {
  const wrap = (n: number) => ((n + 180) % 360 + 360) % 360 - 180;
  return new URLSearchParams({ west: String(east - west >= 359.9 ? -180 : wrap(west)),
    east: String(east - west >= 359.9 ? 180 : wrap(east)), south: String(Math.max(-85, south)),
    north: String(Math.min(85, north)), zoom: String(Math.max(-2, Math.min(18, zoom))) });
}
export function decodeFleet(data: FleetSnapshot): FleetSnapshot {
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 1200 ||
    !Number.isInteger(data.visibleCount) || data.visibleCount < 0 || data.visibleCount > 41000 ||
    !Number.isFinite(Date.parse(data.fetchedAt))) throw Error('지도 선박 응답 형식을 확인해 주세요.');
  let total = 0;
  for (const f of data.features) {
    const p = f.properties, c = f.geometry?.coordinates;
    if (f.type !== 'Feature' || f.geometry?.type !== 'Point' || c?.length !== 2 ||
      !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 85 || !p ||
      typeof p.fresh !== 'boolean' || !Number.isInteger(p.count) || p.count < 1 ||
      (p.kind === 'vessel' ? p.count !== 1 || !/^[1-9][0-9]{8}$/.test(p.mmsi ?? '') || typeof p.name !== 'string' ||
        (p.course != null && (!Number.isFinite(p.course) || p.course < 0 || p.course >= 360)) :
        p.kind !== 'cluster' || !Number.isFinite(p.cellDegrees) || p.cellDegrees! <= 0))
      throw Error('지도 선박 좌표·식별자가 올바르지 않습니다.');
    total += p.count;
  }
  if (total !== data.visibleCount) throw Error('지도 선박 집계가 일치하지 않습니다.');
  return data;
}
export async function fleetJson(path: string, signal: AbortSignal) {
  const r = await fetch(`/api/vessels/map${path}`, { signal, cache: 'no-store' });
  if (!r.ok) throw Error(r.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' :
    r.status === 404 ? '선박 정보가 없거나 HP 지도 API 업데이트가 필요합니다.' : `지도 선박 조회 실패 (${r.status}) · 다시 시도해 주세요.`);
  return r.json();
}
export async function fleetDetail(mmsi: string, signal: AbortSignal) {
  const v = validateVessel(await fleetJson('/' + mmsi, signal));
  if (v.source !== 'aisstream' || v.mmsi !== mmsi) throw Error('선택한 선박과 응답이 다릅니다.');
  return v;
}
