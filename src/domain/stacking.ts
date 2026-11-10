// 하역 대기 화물 적치 추천: 백엔드 결과 타입, 시나리오 선박 변환, 저탄장 이동 주소.
// 계산은 백엔드(midterm.stacking) 한 곳에서만 한다. 여기서는 모양만 맞춘다.
import type { VesselResult } from './demo-forecast/engine.ts';

export type StackingGrade = '고' | '저';
export interface CargoRequest {
  source: 'scenario' | 'registry';
  ref: string;
  vessel_name: string;
  voyage_number?: string | null;
  coal_name: string | null;
  grade: StackingGrade | null;
  cv: number | null;
  tonnes: number;
  berth: number;
  destination_yard: number | null;
}
export interface StackingPlacement { yard: number; target: string; from_m: number | null; to_m: number | null; tonnes: number }
export interface StackingOption { rank: number; placements: StackingPlacement[]; reasons: string[]; warnings: string[]; assumptions: string[] }
export interface StackingResult {
  as_of: string | null;
  cargo: CargoRequest | null;
  options: StackingOption[];
  no_fit: { message: string; largest: StackingPlacement | null } | null;
  gaps: string[];
  blocked: string | null;
}
export interface WaitingVoyage { voyage_no: string; vessel_name: string; cargo: CargoRequest | null; blocked: string | null }
export type StackingFocus = { pile: string; from_m: number; to_m: number } | { cell: string };

const PILE_COUNT = 8;
const SHED_CELLS = 10;
const SHED_NAMES = ['A', 'B'];

function yardNumber(id: string | null | undefined): number | null {
  const m = /^Y([1-3])$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

/** 시나리오 선박을 백엔드 공통 화물 형식으로 바꾼다. 남은 물량만 보낸다. */
export function cargoFromScenario(v: VesselResult): CargoRequest {
  return {
    source: 'scenario',
    ref: v.id,
    vessel_name: v.name,
    coal_name: null,
    grade: v.grade === 'high' ? '고' : '저',
    cv: v.cv,
    tonnes: Math.max(0, v.cargo - (v.unloaded ?? 0)),
    berth: v.assignedBerth ?? v.berth ?? 0,
    destination_yard: yardNumber(v.assignedYard),
  };
}

/** 아직 하역을 시작하지 않은 배만 적치 추천 대상이다. */
export function stackingEligible(v: VesselResult): boolean {
  if (v.state === '체선' || v.state === '근거리') return true;
  return v.state === '하역중' && (v.unloaded ?? 0) === 0;
}

/** 저탄장 화면으로 넘길 주소 값. Pile은 "P3:130-210.5", Shed 칸은 "A3". */
export function stackingFocusValue(p: StackingPlacement): string {
  const pile = /^Pile (\d+)$/.exec(p.target);
  if (pile && p.from_m != null && p.to_m != null) return `P${pile[1]}:${p.from_m}-${p.to_m}`;
  const shed = /^Shed ([A-Z]) (\d+)칸$/.exec(p.target);
  return shed ? `${shed[1]}${shed[2]}` : '';
}

export function parseStackingFocus(value: string | null | undefined): StackingFocus | null {
  if (!value) return null;
  const pile = /^P(\d+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value);
  if (pile) {
    const n = Number(pile[1]), from_m = Number(pile[2]), to_m = Number(pile[3]);
    return n >= 1 && n <= PILE_COUNT && from_m < to_m ? { pile: `P${n}`, from_m, to_m } : null;
  }
  const cell = /^([A-Z])(\d+)$/.exec(value);
  if (cell && SHED_NAMES.includes(cell[1]) && Number(cell[2]) >= 1 && Number(cell[2]) <= SHED_CELLS) return { cell: value };
  return null;
}

/** 운영 도우미에 넘기는 선택 맥락(백엔드 CONTEXT_KEYS와 같은 이름). */
export function stackingContext(v: VesselResult): Record<string, string | number> {
  const c = cargoFromScenario(v);
  const out: Record<string, string | number> = { vessel: c.vessel_name, cargo_t: c.tonnes, berth: c.berth };
  if (c.grade) out.cargo_grade = c.grade;
  if (c.cv != null) out.cargo_cv = c.cv;
  if (c.destination_yard != null) out.dest_yard = c.destination_yard;
  return out;
}

/** 자리 문구: "Pile 3 · 130~210.5 m" 또는 "Shed A 3칸". */
export function placementLabel(p: StackingPlacement): string {
  return p.from_m != null && p.to_m != null ? `${p.target} · ${p.from_m}~${p.to_m} m` : p.target;
}
