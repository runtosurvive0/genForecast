import type { Stockpile } from "../../data/control-tower.ts";

/**
 * 당진 저탄장 구성도 (저탄장 구조 자료 기준).
 * 1저탄장(옥외) Pile 1~4, 2저탄장(옥내) Pile 5~8, 3저탄장(옥내) A·B Shed 각 10 Cell.
 * Pile = 석탄 더미 5개 묶음. 더미 이름은 화면 표시용이며 stockpile_id는 그대로 쓴다.
 */
export const YARD_TITLES: Record<string, string> = {
  P1: "1저탄장",
  P2: "2저탄장",
  P3: "3저탄장",
};

/** 예비 Cell (자료의 노란 표시). */
export const RESERVE_CELLS: ReadonlySet<string> = new Set(["A-10", "B-1"]);

export interface PileGroup {
  /** "pile-1" … "pile-8", "shed-A", "shed-B". */
  id: string;
  yard: "P1" | "P2" | "P3";
  /** "Pile 1" 또는 "A Shed". */
  label: string;
  /** Pile 번호 1~8. Shed는 null. */
  pileNo: number | null;
  /** 화면 고정 순서 (재고·위험도 정렬과 무관). */
  heaps: Stockpile[];
  /** heaps와 같은 순서의 더미 이름: P1-01 … 또는 Cell 이름 A-10 … A-1. */
  names: string[];
}

const idNumber = (pile: Stockpile) =>
  Number(pile.stockpile_id.match(/(\d+)$/)?.[1] ?? 0);
const byId = (a: Stockpile, b: Stockpile) =>
  idNumber(a) - idNumber(b) || a.stockpile_id.localeCompare(b.stockpile_id);

/** 처·구역 표본을 Pile·Shed 묶음으로 바꾼다. 각 묶음 안은 원본 ID 순으로 고정한다. */
export function siteGroups(piles: Stockpile[]): PileGroup[] {
  const groups: PileGroup[] = [];
  for (const yard of ["P1", "P2"] as const)
    for (let zone = 0; zone < 4; zone++) {
      const heaps = piles
        .filter((p) => p.plant_yard === yard && p.zone === zone)
        .sort(byId);
      if (!heaps.length) continue;
      const no = (yard === "P1" ? 1 : 5) + zone;
      groups.push({
        id: `pile-${no}`,
        yard,
        label: `Pile ${no}`,
        pileNo: no,
        heaps,
        names: heaps.map((_, k) => `P${no}-${String(k + 1).padStart(2, "0")}`),
      });
    }
  // 3저탄장: 구역 1·2 → A Shed, 구역 3·4 → B Shed. 자료 배치대로 왼쪽부터 10 → 1.
  const third = piles
    .filter((p) => p.plant_yard === "P3")
    .sort((a, b) => (a.zone ?? 0) - (b.zone ?? 0) || byId(a, b));
  (["A", "B"] as const).forEach((shed, k) => {
    const heaps = k === 0 ? third.slice(0, 10) : third.slice(10);
    if (!heaps.length) return;
    groups.push({
      id: `shed-${shed}`,
      yard: "P3",
      label: `${shed} Shed`,
      pileNo: null,
      heaps,
      names: heaps.map((p, i) => (i < 10 ? `${shed}-${10 - i}` : p.stockpile_id)),
    });
  });
  return groups;
}

/** stockpile_id → 화면 더미 이름. */
export function heapNames(groups: PileGroup[]): Record<string, string> {
  return Object.fromEntries(
    groups.flatMap((g) => g.heaps.map((p, i) => [p.stockpile_id, g.names[i]])),
  );
}

export interface UnloadLine {
  id: string;
  label: string;
  berths: string[];
  /** 부두별 하역기 대수와 대당 최대 하역 (t/h). */
  unloaders: { berth: string; count: number; tph: number }[];
  /** 저탄 라인 수. */
  lines: number;
  /** 동시 가동 가능한 하역기 수. */
  maxRunning: number;
  /** 라인당 저탄 능력 (t/h, 범위). 하역기보다 작아 병목이다. */
  stackTph: readonly [number, number];
  /** 하역 불가 Pile 번호. */
  blockedPiles: number[];
}

/** 부두 → 저탄 라인 (저탄장 구조 자료 기준, 설비 능력 가정). */
export const UNLOAD_LINES: UnloadLine[] = [
  {
    id: "berth-1",
    label: "1부두",
    berths: ["BD-1"],
    unloaders: [{ berth: "BD-1", count: 2, tph: 1500 }],
    lines: 2,
    maxRunning: 2,
    stackTph: [1000, 1200],
    blockedPiles: [7, 8],
  },
  {
    id: "berth-23",
    label: "2·3부두",
    berths: ["BD-2", "BD-3"],
    unloaders: [
      { berth: "BD-2", count: 2, tph: 1500 },
      { berth: "BD-3", count: 2, tph: 2000 },
    ],
    lines: 3,
    maxRunning: 3,
    stackTph: [1000, 1200],
    blockedPiles: [3, 4],
  },
];

/** 저탄 최대 공급 (t/h): 동시 가동 라인 × min(라인 저탄 상한, 하역기 능력). */
export function lineMaxTph(line: UnloadLine): number {
  const unloader = Math.min(...line.unloaders.map((u) => u.tph));
  return Math.min(line.lines, line.maxRunning) * Math.min(line.stackTph[1], unloader);
}

export const canUnload = (line: UnloadLine, group: PileGroup) =>
  group.pileNo === null || !line.blockedPiles.includes(group.pileNo);
