import { ArrowRight } from 'lucide-react';
import { ProcessingOrb } from "@/components/ProcessingOrb";
import type { TrackingVessel } from '@/domain/vessel-workflow';
import type { Records, Row } from './VoyageRegistry';

export function sharedVoyages(vessel: TrackingVessel, registry: Records | null): Row[] {
  if (vessel.source === 'demo' || !vessel.mmsi || !registry) return [];
  const ships = registry.ships.filter(ship => ship.mmsi === vessel.mmsi);
  if (ships.length !== 1) return [];
  return registry.voyages.filter(voyage => voyage.ship_code === ships[0].ship_code);
}

export function SharedVoyageSummary({ vessel, registry, status, onOpen }: {
  vessel: TrackingVessel;
  registry: Records | null;
  status: 'loading' | 'ready' | 'error';
  onOpen: (key?: string) => void;
}) {
  const voyages = sharedVoyages(vessel, registry);
  const duplicateShip = vessel.source !== 'demo' && Boolean(vessel.mmsi) && (registry?.ships.filter(ship => ship.mmsi === vessel.mmsi).length ?? 0) > 1;
  return <section className="gf-shared-voyages" aria-label="공용 배선 및 화물">
    <header><h2>공용 배선·화물</h2><button type="button" onClick={() => onOpen()}>원장 열기 <ArrowRight size={14} /></button></header>
    {status === 'loading' ? <p><ProcessingOrb state="searching" label="배선 정보를 불러오는 중" /></p> : status === 'error' ?
      <p role="status">공용 원장에 연결하지 못했습니다. 원장에서 연결 상태를 확인하세요.</p> :
      vessel.source === 'demo' ? <p>시연 선박은 공용 배선과 연결되지 않습니다.</p> :
      duplicateShip ? <p>같은 MMSI의 선박이 여러 건입니다. 원장에서 선박 정보를 확인해 주세요.</p> :
      voyages.length === 0 ? <p>연결된 배선이 없습니다. 배선 원장에서 선박을 연결해 주세요.</p> :
      <ul>{voyages.map(voyage => {
        const cargo = registry!.cargo.filter(row => row.voyage_no === voyage.voyage_no);
        const label = String(voyage.voyage_number || '항차번호 미부여');
        return <li key={String(voyage.voyage_no)}><button type="button" onClick={() => onOpen(String(voyage.voyage_no))}>
          <span><strong>{label}</strong><small>{cargo.length ? cargo.map(row => row.coal_name || '탄종 미등록').join(' · ') : '등록된 화물 없음'}</small></span>
          <span>배선 보기 <ArrowRight size={14} /></span>
        </button></li>;
      })}</ul>}
  </section>;
}
