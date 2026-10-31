import type { TrackingVessel } from '../../domain/vessel-workflow.ts';

export function vesselSourceLabel(v: TrackingVessel) {
  if (v.source === 'demo') return '합성 표본';
  if (v.source === 'digitraffic') return 'Digitraffic · 핀란드';
  if (!v.ais) return '직접 등록';
  const feed = v.ais.position ? (v.ais.position.feed ?? 'aisstream') : v.ais.metadataFeed;
  if (feed === 'openwaters') {
    const source = v.ais.position?.upstream;
    return `Open Waters${source === 'aishub' ? ' · AISHub' : source && source !== 'other' ? ` · ${source}` : ''}`;
  }
  return 'AISstream';
}
