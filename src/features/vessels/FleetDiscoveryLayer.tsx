import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Map as VesselMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import type { TrackingVessel } from '@/domain/vessel-workflow';
import { Button } from '@/components/ui/button';
import { ProcessingOrb } from '@/components/ProcessingOrb';
import { X, Ship } from 'lucide-react';
import { MapToolButton } from './MapToolButton';
import { date } from '@/lib/format';
import { shipTypeLabel, navStatusLabel } from './vessel-discovery';
import { decodeFleet, fleetBounds, fleetDetail, fleetJson, type FleetSnapshot } from './fleet-map';
import './fleet-discovery.css';

export interface FleetDiscoveryOptions {
  interests: string[];
  onAdd: (vessel: TrackingVessel) => void;
}
const SOURCE = 'vessel-fleet-discovery';
const LAYERS = ['vessel-fleet-clusters', 'vessel-fleet-counts', 'vessel-fleet-points', 'vessel-fleet-headings'];
const EMPTY: FleetSnapshot = { type: 'FeatureCollection', features: [], visibleCount: 0, fetchedAt: '', lastReceivedAt: null };

export function FleetDiscoveryLayer({ map, revision, theme, options, statusTarget, toolsTarget }: {
  map: VesselMap; revision: number; theme: 'light' | 'dark'; options: FleetDiscoveryOptions; statusTarget?: HTMLElement | null; toolsTarget?: HTMLElement | null;
}) {
  const [enabled, setEnabled] = useState(true);
  const [data, setData] = useState<FleetSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [vessel, setVessel] = useState<TrackingVessel | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const [clusterNotice, setClusterNotice] = useState('');
  const latest = useRef({ options, data }); latest.current = { options, data };
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) { setData(EMPTY); setSelected(null); return; }
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    let abort: AbortController | undefined;
    async function read() {
      abort?.abort(); abort = new AbortController(); const own = abort;
      const id = ++generation.current;
      const b = map.getBounds();
      const query = fleetBounds(b.getWest(), b.getEast(), b.getSouth(), b.getNorth(), map.getZoom());
      setBusy(true);
      try {
        const next = decodeFleet(await fleetJson('?' + query, AbortSignal.any([own.signal, AbortSignal.timeout(15000)])));
        if (!disposed && !own.signal.aborted && id === generation.current) { setData(next); setError(''); }
      } catch (e) {
        if (!disposed && !own.signal.aborted && id === generation.current)
          setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : '지도 선박 조회 지연 · 이전 표시는 유지합니다.');
      } finally { if (!disposed && id === generation.current) setBusy(false); }
    }
    function schedule() { clearTimeout(timer); abort?.abort(); timer = setTimeout(read, 300); }
    map.on('moveend', schedule);
    map.on('projectiontransition', schedule);
    void read();
    const poll = setInterval(() => { if (!document.hidden && !map.isMoving()) void read(); }, 30000);
    return () => { disposed = true; abort?.abort(); clearTimeout(timer); clearInterval(poll);
      map.off('moveend', schedule); map.off('projectiontransition', schedule); };
  }, [map, enabled, retry]);

  useEffect(() => {
    if (!map.getSource('vessel-routes')) return;
    const dark = theme === 'dark';
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
      // One GPU source, not tens of thousands of HTML markers.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(25, 27);
      ctx.lineTo(16, 22); ctx.lineTo(7, 27); ctx.closePath(); ctx.fill();
      if (!map.hasImage('vessel-fleet-arrow')) map.addImage('vessel-fleet-arrow', ctx.getImageData(0, 0, 32, 32), { sdf: true });
      map.addLayer({ id: LAYERS[0], type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'cluster'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 12, 100, 18, 1000, 24],
          'circle-color': dark ? '#30343e' : '#e0e4ed', 'circle-opacity': ['case', ['get', 'fresh'], 1, .4],
          'circle-stroke-opacity': ['case', ['get', 'fresh'], 1, .4],
          'circle-stroke-color': dark ? '#8991a4' : '#6c7486', 'circle-stroke-width': 1 } });
      if (map.getStyle().glyphs) map.addLayer({ id: LAYERS[1], type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], 'cluster'],
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': dark ? '#e5e7ee' : '#30343e', 'text-opacity': ['case', ['get', 'fresh'], 1, .5] } });
      map.addLayer({ id: LAYERS[2], type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'vessel'],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3, 5, 4, 9, 5],
          'circle-color': dark ? '#aeb7c8' : '#505e75', 'circle-opacity': ['case', ['get', 'fresh'], .85, .35],
          'circle-stroke-width': 1, 'circle-stroke-color': dark ? '#18191c' : '#ffffff' } });
      map.addLayer({ id: LAYERS[3], type: 'symbol', source: SOURCE, minzoom: 5,
        filter: ['all', ['==', ['get', 'kind'], 'vessel'], ['!=', ['get', 'course'], null]],
        layout: { 'icon-image': 'vessel-fleet-arrow', 'icon-size': .55, 'icon-rotate': ['get', 'course'],
          'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-color': dark ? '#bac3d6' : '#43526d', 'icon-opacity': ['case', ['get', 'fresh'], 1, .4] } });
    }
    // Vector tiles coerce string feature IDs to numbers. Preserve the server key
    // as a property so a cluster click cannot resolve to a different feature.
    const features = enabled ? data.features.map((f, index) => ({ ...f, id: index,
      properties: { ...f.properties, fleetKey: String(f.id) },
    })).filter(f => f.properties.kind !== 'vessel' || !options.interests.includes(f.properties.mmsi!)) : [];
    (map.getSource(SOURCE) as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [map, revision, data, enabled, theme, options.interests]);

  function choose(index: number) {
    const f = latest.current.data.features[index]; if (!f) return;
    setClusterNotice('');
    if (f.properties.kind === 'cluster') {
      if (map.getZoom() >= 17.99) setClusterNotice('최대 확대에서도 선박이 밀집해 있습니다. 관심 선박 구성 → 실제 AIS 검색에서 선박명·MMSI로 조회해 주세요.');
      else map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: Math.min(18, map.getZoom() + 2), duration: 350 });
    } else setSelected(f.properties.mmsi!);
  }
  const chooseRef = useRef(choose); chooseRef.current = choose;
  useEffect(() => {
    if (!enabled) return;
    function click(e: MapMouseEvent) {
      const layers = LAYERS.filter(id => map.getLayer(id)); if (!layers.length) return;
      const f = map.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers })[0];
      if (!f) return;
      const index = latest.current.data.features.findIndex(x => String(x.id) === f.properties.fleetKey);
      chooseRef.current(index);
    }
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map, enabled]);

  useEffect(() => {
    setVessel(null); setDetailError('');
    if (!selected) return;
    const abort = new AbortController(); setDetailBusy(true);
    void fleetDetail(selected, AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]))
      .then(v => { if (!abort.signal.aborted) setVessel(v); })
      .catch(e => { if (!abort.signal.aborted) setDetailError(e instanceof Error ? e.message : '선박 정보 조회 실패'); })
      .finally(() => { if (!abort.signal.aborted) setDetailBusy(false); });
    detailHeading.current?.focus({ preventScroll: true });
    return () => abort.abort();
  }, [selected]);

  const p = vessel?.ais?.position;
  return <>
    {toolsTarget && createPortal(<MapToolButton label="전체 수신 선박" aria-pressed={enabled} onClick={() => setEnabled(v => !v)}><Ship /></MapToolButton>, toolsTarget)}
    {enabled && statusTarget && createPortal(<div className="vessel-fleet-status-line">
      <span className="vessel-fleet-count" role="status">{busy ? '선박 조회 중' : `화면 범위 ${data.visibleCount.toLocaleString('ko-KR')}척`}</span>
      <span className="vessel-fleet-freshness">마지막 관측 위치 · 흐린 표식: 1시간 이상 경과 · 서버 수신 {data.lastReceivedAt ? `${date(data.lastReceivedAt, true)} KST` : '시각 미확인'}</span>
    </div>, statusTarget)}
    {enabled && error && <div className="vessel-fleet-error" role="status">{error} <button onClick={() => setRetry(v => v + 1)}>다시 시도</button></div>}
    {enabled && !error && clusterNotice && <div className="vessel-fleet-error" role="status">{clusterNotice} <button onClick={() => setClusterNotice('')}>닫기</button></div>}
    {enabled && selected && <section className="vessel-fleet-detail" aria-label="지도 선박 정보" onKeyDown={e => { if (e.key === 'Escape') setSelected(null); }}>
      <Button className="vessel-fleet-close" size="icon-sm" variant="ghost" aria-label="지도 선박 정보 닫기" onClick={() => setSelected(null)}><X size={14} /></Button>
      <h4 tabIndex={-1} ref={detailHeading}>{vessel?.name ?? '선박 정보'}</h4>
      {detailBusy && <ProcessingOrb state="connecting" label="선박 정보 조회 중" theme={theme} />}
      {detailError && <p role="status">{detailError}</p>}
      {vessel && <><p>MMSI {vessel.mmsi}{vessel.imo ? ` · IMO ${vessel.imo}` : ''}</p>
        <dl><dt>선종 · 상태</dt><dd>{shipTypeLabel(vessel.ais?.shipType)} · {navStatusLabel(vessel.ais?.navStatus)}</dd>
          <dt>속도 · 방향</dt><dd>{p?.sogKn == null ? '속도 미수신' : `${p.sogKn.toFixed(1)} kn`} · {p?.cogDeg == null ? '방향 미수신' : `${p.cogDeg.toFixed(0)}°`}</dd>
          <dt>AIS 목적지</dt><dd>{vessel.ais?.destination || '미수신'}</dd>
          <dt>마지막 위치 관측</dt><dd>{p ? `${date(p.observedAt, true)} KST` : '위치 미수신'}</dd></dl>
        <p>마지막 AIS 관측 위치입니다. 흐린 표식은 1시간 이상 지난 관측입니다.</p>
        <Button size="sm" disabled={options.interests.includes(vessel.mmsi)} onClick={() => {
          try { options.onAdd(vessel); } catch (e) { setDetailError(e instanceof Error ? e.message : '관심 등록 실패'); }
        }}>{options.interests.includes(vessel.mmsi) ? '관심 등록됨' : '관심 선박에 추가'}</Button></>}
    </section>}
  </>;
}
