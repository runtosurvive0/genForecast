// 수급 예측의 시작값을 운전 데모의 현재 상태로 바꾼다.
// 저탄장 재고(하역·상탄 반영), 하역 중인 선박의 남은 물량, 호기의 현재 출력만 가져오고
// 이후 계획(입항 예정 선박·발전 계획)은 기준 표본을 그대로 쓴다.
import type { ForecastInput, Grade } from './engine.ts';

/** 운전 데모 상태 중 예측에 필요한 부분 */
export interface OperationsState {
  elapsed: number;
  material: {
    lots: Record<string, { yard: number; quality: string; tons: number }>;
    ships: Record<string, { total: number; remaining: number }>;
  };
  units: Record<string, { status: string; mw: number }>;
}

/** 운전 데모 부두 번호 → 예측 표본에서 같은 배(같은 부두·같은 적재량) */
const SHIP_BY_BERTH: Record<string, string> = { '1': 'V-26041', '2': 'V-26042' };
const YARD_BY_NO: Record<number, string> = { 1: 'Y1', 2: 'Y2', 3: 'Y3' };
const GRADE_BY_QUALITY: Record<string, Grade> = { 고열량: 'high', 저열량: 'low' };

export interface LiveSummary {
  stockTonnes: number;
  shipsRemaining: number;
  runningUnits: number;
  elapsedHours: number;
}

export function fromOperations(base: ForecastInput, state: OperationsState): { input: ForecastInput; summary: LiveSummary } {
  const stock: Record<string, Record<Grade, number>> = {};
  for (const lot of Object.values(state.material.lots)) {
    const yard = YARD_BY_NO[lot.yard];
    const grade = GRADE_BY_QUALITY[lot.quality];
    if (!yard || !grade || !(lot.tons > 0)) continue;
    stock[yard] ??= { high: 0, low: 0 };
    stock[yard][grade] += lot.tons;
  }
  const yards = base.yards.map(y => ({
    ...y,
    stock: {
      high: { ...y.stock.high, tonnes: Math.round(stock[y.id]?.high ?? 0) },
      low: { ...y.stock.low, tonnes: Math.round(stock[y.id]?.low ?? 0) },
    },
  }));

  let shipsRemaining = 0;
  const vessels = base.vessels.map(v => {
    const berth = Object.keys(SHIP_BY_BERTH).find(b => SHIP_BY_BERTH[b] === v.id);
    const ship = berth ? state.material.ships[berth] : undefined;
    if (!ship || ship.total !== v.cargo) return v;
    shipsRemaining += ship.remaining;
    return { ...v, unloaded: Math.min(v.cargo, Math.max(0, ship.total - ship.remaining)) };
  });

  let runningUnits = 0;
  const units = base.units.map(u => {
    const live = state.units[String(u.id)];
    if (!live) return u;
    const mw = live.status === 'running' ? Math.max(0, Math.min(u.capacityMw * 1.2, live.mw)) : 0;
    if (mw > 0) runningUnits++;
    return { ...u, dailyMwh: [Math.round(mw * 24), ...u.dailyMwh.slice(1)] };
  });

  const stockTonnes = yards.reduce((s, y) => s + y.stock.high.tonnes + y.stock.low.tonnes, 0);
  return {
    input: { ...base, yards, vessels, units },
    summary: { stockTonnes, shipsRemaining, runningUnits, elapsedHours: state.elapsed / 3600 },
  };
}

/** 화면 갱신(0.25초)마다 다시 계산하지 않도록, 의미 있는 변화가 있을 때만 바뀌는 키 */
export function operationsKey(state: OperationsState): string {
  const lots = Object.values(state.material.lots).map(l => Math.round(l.tons / 500)).join(',');
  const ships = Object.values(state.material.ships).map(s => Math.round(s.remaining / 500)).join(',');
  const units = Object.values(state.units).map(u => (u.status === 'running' ? Math.round(u.mw / 10) : -1)).join(',');
  return `${lots}|${ships}|${units}`;
}
