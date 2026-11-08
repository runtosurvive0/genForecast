import { StockSnapshot } from '../data/fuel-reference/stock-snapshot.js';
import { YardData } from '../data/fuel-reference/yard-snapshot.js';
import { BerthRoutes } from '../data/fuel-reference/berth-routes.js';
import { BerthNetwork } from '../data/fuel-reference/berth-network.js';
import catalog from '../data/fuel-reference/demo-catalog.json' with { type: 'json' };

/** Photo-transcribed reference records; never the operational DB Pile ledger. */
export interface FuelReferenceLot {
  id: string;
  yard: 1 | 2 | 3;
  pile: number | null;
  shed?: string;
  cell?: string;
  coal: string;
  tons: number;
  grade: string;
  voyage: string;
  days: number | null;
  restricted?: boolean;
  unplaced?: boolean;
}

export interface FuelReferenceEquipment {
  id: string;
  code: string;
  name: string;
  kind: string;
  points: number[][];
  berth?: number;
  ends?: string[];
  outbound?: boolean;
}

export const referenceSource = {
  label: '11.04 기준 참고 재고 · 시연',
  asOf: '2026-11-04',
  description: '참고 재고 · 형상과 이격은 추정 · 실제 운전 신호 미연결',
} as const;

const initialLots = new Map(catalog.materialLots.map(lot => [lot.id, lot]));
const initialTons = (id: string) => {
  const lot = initialLots.get(id);
  if (!lot) throw new Error(`Reference lot is missing from the demo catalog: ${id}`);
  return lot.tons;
};

export const referenceLots: FuelReferenceLot[] = [
  ...YardData.lots.filter((lot: { pile: string }) => /^P[1-4]$/.test(lot.pile)).map((lot: { id: string; pile: string; coal: string; quality: string; voyage: string; age: number | null }) => ({
    id: lot.id, yard: 1 as const, pile: Number(lot.pile.slice(1)), coal: lot.coal,
    tons: initialTons(lot.id), grade: lot.quality.startsWith('고') ? '고' : '저',
    voyage: lot.voyage, days: lot.age, restricted: !initialLots.get(lot.id)?.usable,
  })),
  ...StockSnapshot.lots.map((lot: { id: string; yard: string; pile?: number; shed?: string; cell?: number; coal: string; grade: string; voyage: string; days: number | null }) => ({
    id: lot.id, yard: (lot.yard === 'P2' ? 2 : 3) as 2 | 3,
    pile: lot.pile ?? null, ...(lot.shed ? { shed: lot.shed, cell: String(lot.cell) } : {}),
    coal: lot.coal, tons: initialTons(lot.id), grade: lot.grade, voyage: lot.voyage, days: lot.days,
  })),
];

export const referenceYards: { id: 1 | 2 | 3; name: string; kind: string; stockTons: number; operatingCapacityTons: number }[] = [
  { id: 1, name: '1저탄장', kind: '옥외 · Pile 1–4', stockTons: 109911, operatingCapacityTons: 90000 },
  { id: 2, name: '2저탄장', kind: '부분 지붕 · Pile 5–8', stockTons: 106566, operatingCapacityTons: 265800 },
  { id: 3, name: '3저탄장', kind: '옥내 · A / B Shed', stockTons: 146955, operatingCapacityTons: 460000 },
];

export const referenceEquipment = BerthNetwork.equipment as FuelReferenceEquipment[];

/** Only a validated same-ID demo material record can replace reference tonnage. */
export function getReferenceLotTons(lot: FuelReferenceLot, snapshot: unknown | null): number {
  if (!snapshot || typeof snapshot !== 'object') return lot.tons;
  const value = (snapshot as { material?: { lots?: Record<string, { tons?: unknown }> } }).material?.lots?.[lot.id]?.tons;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : lot.tons;
}

export const endpointForLot = (lot: FuelReferenceLot): string => lot.pile === null ? `shed-${lot.shed?.toLowerCase()}` : `pile-${lot.pile}`;
export const canReceive = (berth: number, endpointId: string): boolean => BerthRoutes.canReach(berth, endpointId);
