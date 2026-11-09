// 시연용 가상 표본. 실제 운영·계약 정보가 아니다.
// 시작 재고는 현재 모드(모의 운전 카탈로그)의 저탄장별 고·저열량 재고와 같다.
// 선박 앞 5척은 접안·하역 화면의 예시 항차와 같고, 이후 계약 선박은 가상이다. 산지명은 실제, 성상은 가상.
import catalog from './fuel-reference/demo-catalog.json' with { type: 'json' };
import type { ForecastInput, Grade, VesselInput } from '../domain/demo-forecast/engine.ts';

export const DEMO_FORECAST_START = '2026-11-06T00:00:00+09:00';

const YARDS = [
  { id: 'Y1', name: '1저탄장', yard: 1, capacity: 220000, units: [1, 2, 3, 4] },
  { id: 'Y2', name: '2저탄장', yard: 2, capacity: 220000, units: [5, 6, 7, 8] },
  { id: 'Y3', name: '3저탄장', yard: 3, capacity: 260000, units: [9, 10] },
];
const CV: Record<Grade, number> = { high: 6050, low: 4950 };

function yardStock(yard: number) {
  const lots = (catalog as { materialLots: { yard: number; quality: string; tons: number }[] }).materialLots.filter(l => l.yard === yard);
  const sum = (q: string) => lots.filter(l => l.quality === q).reduce((s, l) => s + l.tons, 0);
  return { high: { tonnes: sum('고열량'), cv: CV.high }, low: { tonnes: sum('저열량'), cv: CV.low } };
}

// 결정적 의사난수(같은 입력이면 같은 표본)
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 호기별 일 발전량 계획(MWh). 겨울 수요 + 주말 감소 + 맑은 날 태양광 감발을 반영한 가상 급전 계획 */
export function demoDispatch(days: number) {
  const rand = rng(20261106);
  const caps = [500, 500, 500, 500, 500, 500, 500, 500, 1020, 1020];
  const base = [0.8, 0.79, 0.82, 0.78, 0.81, 0.8, 0.77, 0.8, 0.86, 0.85];
  const outages = [{ unit: 4, from: 20, to: 33 }, { unit: 9, from: 52, to: 55 }];
  const start = Date.parse(DEMO_FORECAST_START);
  return caps.map((cap, u) => Array.from({ length: days }, (_, d) => {
    const dow = new Date(start + d * 86400000 + 9 * 3600000).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.9 : 1;
    const winter = 1 + 0.06 * Math.sin(Math.PI * Math.min(1, d / 75)); // 12~1월 수요 증가
    const sunny = rand() < 0.45 ? 0.94 : 1; // 맑은 날 낮 시간 감발
    const out = outages.some(o => o.unit === u + 1 && d >= o.from && d <= o.to);
    return out ? 0 : Math.round(cap * 24 * Math.min(0.95, base[u] * weekend * winter * sunny * (1 + (rand() - 0.5) * 0.04)));
  }));
}

const ORIGINS: { origin: string; grade: Grade; cv: number }[] = [
  { origin: '호주 · Newcastle', grade: 'high', cv: 6150 },
  { origin: '인도네시아 · Taboneo', grade: 'low', cv: 4900 },
  { origin: '호주 · Gladstone', grade: 'high', cv: 6050 },
  { origin: '인도네시아 · Muara Jawa', grade: 'low', cv: 5000 },
  { origin: '캐나다 · Roberts Bank', grade: 'high', cv: 6200 },
  { origin: '인도네시아 · Balikpapan', grade: 'low', cv: 4950 },
  { origin: '호주 · Hay Point', grade: 'high', cv: 6100 },
  { origin: '남아공 · Richards Bay', grade: 'high', cv: 5950 },
  { origin: '인도네시아 · Samarinda', grade: 'low', cv: 5050 },
];
const NAMES = ['MERIDIAN', 'AURORA', 'SUMMIT', 'HARBOR', 'NOVA', 'ZENITH', 'CORAL', 'VALOR', 'TERRA', 'ORION', 'BOREAL', 'CREST', 'EMBER', 'HALCYON', 'LEGACY', 'MONARCH', 'NAVIGATOR', 'QUEST', 'RADIANT', 'SENTINEL', 'TRIDENT', 'UNITY', 'VANTAGE'];

/** 계약 선박: 접안·하역 화면 예시 5척 + 저탄장별 소비량에 맞춘 D+60까지의 가상 계약 선박 */
export function demoVessels(dispatch = demoDispatch(150)): VesselInput[] {
  const head: VesselInput[] = [
    { id: 'V-26041', name: 'GEN4CAST HORIZON', origin: '인도네시아 · Taboneo', grade: 'low', cv: 4900, cargo: 75000, eta: -22, berth: 1, yard: 'Y1', berthedAt: -22, unloaded: 41000 },
    { id: 'V-26042', name: 'GEN4CAST PACIFIC', origin: '호주 · Newcastle', grade: 'high', cv: 6150, cargo: 82000, eta: -19, berth: 2, yard: 'Y2', berthedAt: -19, unloaded: 34000 },
    { id: 'V-26043', name: 'GEN4CAST OCEAN', origin: '인도네시아 · Muara Jawa', grade: 'low', cv: 5000, cargo: 70000, eta: 30, berth: 3, yard: 'Y3' },
    { id: 'V-26044', name: 'GEN4CAST DAWN', origin: '호주 · Gladstone', grade: 'high', cv: 6050, cargo: 78000, eta: 5 * 24 + 14, berth: 1, yard: 'Y1' },
    { id: 'V-26045', name: 'GEN4CAST ATLAS', origin: '인도네시아 · Balikpapan', grade: 'low', cv: 4950, cargo: 68000, eta: 12 * 24 + 8, berth: 2, yard: 'Y2' },
  ];
  const rand = rng(77);
  const rest: VesselInput[] = [];
  let k = 0;
  // 저탄장마다 예상 재고가 약 6일분 아래로 내려가기 전에 다음 배가 들어오도록 계약했다고 가정한다.
  YARDS.forEach((y, yi) => {
    const burn = (d: number) => y.units.reduce((s, u) => s + dispatch[u - 1][d] * (u <= 8 ? 2150 : 1980) / 5600, 0);
    let stock = yardStock(y.yard).high.tonnes + yardStock(y.yard).low.tonnes;
    const arrivals = head.filter(v => v.yard === y.id).map(v => ({ day: Math.max(0, v.eta / 24), q: v.cargo - (v.unloaded ?? 0) }));
    for (let d = 0; d < 60; d++) {
      for (const a of arrivals) if (Math.floor(a.day) === d) stock += a.q;
      stock -= burn(d);
      const soon = arrivals.some(a => a.day > d && a.day <= d + 3);
      if (!soon && stock < burn(d) * 10 && d + 2 < 60) {
        const n = rest.filter(v => v.yard === y.id).length;
        const pool = ORIGINS.filter(x => x.grade === ([0, 2, 3].includes((n + yi) % 5) ? 'high' : 'low'));
        const o = pool[(n + yi) % pool.length];
        const cargo = 70000 + Math.round(rand() * 5) * 5000;
        const day = d + 1.5 + rand();
        arrivals.push({ day, q: cargo });
        rest.push({
          id: `V-2605${String(k).padStart(2, '0')}`,
          name: `GEN4CAST ${NAMES[k % NAMES.length]}${k >= NAMES.length ? " II" : ""}`,
          origin: o.origin, grade: o.grade, cv: o.cv, cargo,
          eta: Math.round(day * 24),
          berth: yi + 1,
          yard: y.id,
        });
        k++;
      }
    }
  });
  return [...head, ...rest].sort((a, b) => a.eta - b.eta);
}

export function demoForecastInput(horizonDays = 90): ForecastInput {
  const tailDays = 60;
  const dispatch = demoDispatch(Math.max(150, horizonDays + tailDays));
  return {
    start: DEMO_FORECAST_START,
    horizonDays,
    tailDays,
    yards: YARDS.map(y => ({ id: y.id, name: y.name, capacity: y.capacity, stock: yardStock(y.yard) })),
    berths: [1, 2, 3].map(id => ({ id, name: `${id}부두`, rateTph: 2000, yards: ['Y1', 'Y2', 'Y3'] })),
    units: dispatch.map((mwh, i) => ({ id: i + 1, yard: YARDS.find(y => y.units.includes(i + 1))!.id, capacityMw: i < 8 ? 500 : 1020, heatRate: i < 8 ? 2150 : 1980, dailyMwh: mwh })),
    vessels: demoVessels(dispatch),
    strategy: [{ fromDay: 0, strategy: 'fifo' }],
    berthOutages: [],
    loadChanges: [],
    policy: 'planned',
    shiftHours: 6,
    laytimeTpd: 40000,
    demurrageUsdPerDay: 18000,
  };
}
