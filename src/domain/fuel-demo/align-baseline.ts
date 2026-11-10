// 운전 데모 재고를 저장된 기준재고에 맞춘다.
// 데모 엔진은 고정 사진(2026-11-04)의 구역 배치로 시작하고, 기준재고는 날짜마다 구역 구성이 다르다.
// 화면마다 재고가 달라지지 않게 저탄장·등급(고/저열량)별 시작 재고를 기준재고 합계에 맞추고,
// 데모가 그 뒤에 더하거나 뺀 양(하역·상탄)만 얹는다.
import type { FuelDemoSnapshot } from "./types";

export interface BaselineLotLike { location: string; tonnes: number; grade?: string | null }

export function yardOfLocation(location: string): 1 | 2 | 3 | null {
  const pile = /^P([1-8])$/.exec(location);
  if (pile) return Number(pile[1]) <= 4 ? 1 : 2;
  return /^[AB]\d+$/.test(location) ? 3 : null;
}

/** 기준재고가 없거나 위치를 알 수 없는 원탄이 있으면 데모 값을 그대로 둔다. */
export function alignDemoToBaseline<T extends Pick<FuelDemoSnapshot, "material">>(
  snapshot: T | null,
  lots: BaselineLotLike[] | null | undefined,
): T | null {
  if (!snapshot || !lots?.length) return snapshot;
  const target = new Map<string, number>(); // `${yard}:${grade}` → 기준재고 t
  for (const lot of lots) {
    const yard = yardOfLocation(lot.location);
    if (!yard || !(lot.tonnes >= 0)) return snapshot;
    const key = `${yard}:${lot.grade ?? ""}`;
    target.set(key, (target.get(key) ?? 0) + lot.tonnes);
  }
  const demoBase = new Map<string, number>();
  for (const lot of Object.values(snapshot.material.lots)) {
    const key = `${lot.yard}:${lot.quality}`;
    demoBase.set(key, (demoBase.get(key) ?? 0) + lot.baseTons);
  }
  // 기준재고의 저탄장·등급마다 데모에 같은 저탄장·등급 구역이 있어야 나눠 담을 수 있다.
  for (const [key, tons] of target) if (tons > 0 && !(demoBase.get(key)! > 0)) return snapshot;
  const aligned: FuelDemoSnapshot["material"]["lots"] = {};
  let total = 0, base = 0;
  for (const [id, lot] of Object.entries(snapshot.material.lots)) {
    const key = `${lot.yard}:${lot.quality}`;
    const from = demoBase.get(key) ?? 0;
    const baseTons = from > 0 ? lot.baseTons * ((target.get(key) ?? 0) / from) : 0;
    const tons = Math.max(0, baseTons + (lot.tons - lot.baseTons));
    aligned[id] = { ...lot, baseTons, tons };
    total += tons;
    base += baseTons;
  }
  return { ...snapshot, material: { ...snapshot.material, lots: aligned as T["material"]["lots"], totalStock: total, baselineStock: base } };
}
