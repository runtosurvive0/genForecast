// 시연용 일·시간 단위 수급 예측 엔진. 입력은 모두 가상 표본이며 실제 운영 정보가 아니다.
// 흐름: 입항 → 부두 대기열 → 하역(부두 속도 × CV 가용률, 저탄장 여유) → 탄종별 재고 → 호기 연소.

export type Grade = 'high' | 'low';
export type Strategy = 'calorific' | 'price' | 'environment' | 'fifo';
export type BerthPolicy = 'planned' | 'auto';

export interface YardInput {
  id: string;
  name: string;
  capacity: number;
  stock: Record<Grade, { tonnes: number; cv: number }>;
}
export interface BerthInput { id: number; name: string; rateTph: number; yards: string[] }
export interface UnitInput { id: number; yard: string; capacityMw: number; heatRate: number; dailyMwh: number[] }
export interface VesselInput {
  id: string;
  name: string;
  origin: string;
  grade: Grade;
  cv: number;
  cargo: number;
  /** 기준시각부터의 시간(h). 음수면 이미 입항. */
  eta: number;
  berth?: number | null;
  yard: string;
  /** 이미 접안해 하역 중인 배: 접안 시각과 하역량 */
  berthedAt?: number;
  unloaded?: number;
}
export interface BerthOutage { berth: number; from: number; to: number; factor: number; note: string }
export interface LoadChange { fromDay: number; toDay: number; pct: number; note?: string }
export interface StrategyPeriod { fromDay: number; strategy: Strategy }
/** 저탄장 간 이적(구내 운반). 시작 시각부터 시간당 rateTph로 옮긴다. */
export interface YardTransfer { fromYard: string; toYard: string; tonnes: number; hour: number; rateTph: number }

export interface ForecastInput {
  start: string;
  horizonDays: number;
  /** 고갈 시점을 찾기 위해 화면 기간 뒤로 더 계산하는 일수 */
  tailDays: number;
  yards: YardInput[];
  berths: BerthInput[];
  units: UnitInput[];
  vessels: VesselInput[];
  strategy: StrategyPeriod[];
  berthOutages: BerthOutage[];
  loadChanges: LoadChange[];
  transfers?: YardTransfer[];
  policy: BerthPolicy;
  shiftHours: number;
  laytimeTpd: number;
  demurrageUsdPerDay: number;
}

export type VesselState = '원거리' | '근거리' | '체선' | '하역중' | '완료';
export interface VesselResult extends Omit<VesselInput, 'berthedAt'> {
  assignedBerth: number | null;
  assignedYard: string;
  berthedAt: number | null;
  finishedAt: number | null;
  waitHours: number;
  blockedHours: number;
  demurrageHours: number;
  demurrageUsd: number;
  state: VesselState;
  plannedYard: string;
  movedYard: boolean;
}
export interface YardDay {
  high: number; low: number; total: number; cvHigh: number; cvLow: number;
  burn: number; burnHigh: number; burnLow: number; receipts: number; days: number | null;
}
export interface DayResult { day: number; date: string; yards: Record<string, YardDay>; generationMwh: number; shortageMwh: number; queue: number }
export interface Depletion { day: number; date: string; hour: number; withinHorizon: boolean }
export interface ForecastResult {
  input: ForecastInput;
  daily: DayResult[];
  vessels: VesselResult[];
  depletion: { high: Depletion | null; low: Depletion | null; all: Depletion | null; yards: Record<string, { high: Depletion | null; low: Depletion | null }> };
  shortageMwh: number;
  notes: string[];
  kpis: {
    contractEndDay: number; minDays: number | null; minDaysDate: string | null; risk: 'normal' | 'caution' | 'danger';
    demurrageUsd: number; demurrageDays: number; waitingVessels: number; burnTotal: number; receiptsTotal: number; generationMwh: number;
  };
}

export const STRATEGY_LABEL: Record<Strategy, string> = { calorific: '발열량 우선', price: '가격 우선', environment: '환경 우선', fifo: '선입선출' };
/** 전략별 고열량탄 투입 비중(질량 기준). 선입선출은 재고 비율을 따른다. */
const HIGH_SHARE: Record<Exclude<Strategy, 'fifo'>, number> = { calorific: 0.75, price: 0.35, environment: 0.6 };
export const RISK_DAYS = { danger: 7, normal: 15 } as const;

const DAY = 24;
const eps = 1e-6;

export function dateAt(start: string, hour: number) {
  return new Date(Date.parse(start) + hour * 3600000);
}
/** KST 날짜 문자열(YYYY-MM-DD) */
export function kstDate(start: string, hour: number) {
  return new Date(dateAt(start, hour).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

function strategyAt(input: ForecastInput, day: number): Strategy {
  let s: Strategy = 'calorific';
  for (const p of [...input.strategy].sort((a, b) => a.fromDay - b.fromDay)) if (p.fromDay <= day) s = p.strategy;
  return s;
}
function loadFactor(input: ForecastInput, day: number) {
  return input.loadChanges.reduce((f, c) => (day >= c.fromDay && day <= c.toDay ? f * (1 + c.pct / 100) : f), 1);
}
function outageFactor(input: ForecastInput, berth: number, hour: number) {
  return input.berthOutages.reduce((f, o) => (o.berth === berth && hour >= o.from && hour < o.to ? Math.min(f, o.factor) : f), 1);
}

export function simulateForecast(input: ForecastInput): ForecastResult {
  const requiredDays = input.horizonDays + input.tailDays + 7;
  for (const u of input.units) {
    if (u.dailyMwh.length < requiredDays ||
        Array.from({ length: requiredDays }, (_, d) => u.dailyMwh[d]).some(v => !Number.isFinite(v) || v < 0)) {
      throw new Error(`${u.id}호기 발전계획은 시작일부터 ${requiredDays}일(전망·고갈 탐색·재고일수 7일)을 빠짐없이 입력해야 합니다.`);
    }
  }
  input = { ...input, transfers: (input.transfers ?? []).map(t => ({ ...t })) };
  const H = (input.horizonDays + input.tailDays) * DAY;
  const notes = new Set<string>();
  const yard = Object.fromEntries(input.yards.map(y => [y.id, { high: { ...y.stock.high }, low: { ...y.stock.low }, capacity: y.capacity }]));
  const total = (id: string) => yard[id].high.tonnes + yard[id].low.tonnes;

  // 선박 상태
  type V = VesselResult & { remaining: number };
  const vessels: V[] = input.vessels.map(v => ({
    ...v,
    plannedYard: v.yard,
    assignedBerth: v.berthedAt !== undefined ? (v.berth ?? null) : null,
    assignedYard: v.yard,
    berthedAt: v.berthedAt ?? null,
    finishedAt: null,
    waitHours: 0, blockedHours: 0, demurrageHours: 0, demurrageUsd: 0,
    state: '원거리', movedYard: false,
    remaining: v.cargo - (v.unloaded ?? 0),
  }));
  const berthFree: Record<number, number> = Object.fromEntries(input.berths.map(b => [b.id, -Infinity]));
  const atBerth: Record<number, V | null> = Object.fromEntries(input.berths.map(b => [b.id, null]));
  for (const v of vessels) if (v.berthedAt !== null && v.assignedBerth !== null) atBerth[v.assignedBerth] = v;

  // 하루 연소 예정량(재고일수용). 발전량 × 열소비율 ÷ 기준 혼탄 발열량.
  const mixCv = (yardId: string) => {
    const st = yard[yardId], t = st.high.tonnes + st.low.tonnes;
    return t > 0 ? (st.high.tonnes * st.high.cv + st.low.tonnes * st.low.cv) / t : (st.high.cv + st.low.cv) / 2;
  };
  const plannedBurn = (yardId: string, day: number) => {
    const cv = mixCv(yardId);
    return input.units.filter(u => u.yard === yardId).reduce((s, u) => s + u.dailyMwh[day] * loadFactor(input, day) * u.heatRate / cv, 0);
  };
  const daysOfStock = (yardId: string, day: number, stock: number) => {
    let b = 0;
    for (let k = 1; k <= 7; k++) b += plannedBurn(yardId, day + k);
    return b > 0 ? stock / (b / 7) : null;
  };

  const chooseYard = (v: V, berth: BerthInput, hour: number): string => {
    if (input.policy === 'planned') return v.yard;
    const candidates = berth.yards.filter(id => yard[id]);
    const room = (id: string) => yard[id].capacity - total(id);
    const day = Math.floor(hour / DAY);
    if (room(v.yard) >= v.remaining * 0.5) return v.yard;
    return candidates.sort((a, b) => room(b) - room(a))[0] ?? v.yard;
  };
  const pickVessel = (berth: BerthInput, hour: number): V | null => {
    const waiting = vessels.filter(v => v.berthedAt === null && v.eta <= hour && v.remaining > eps);
    let pool = waiting.filter(v => (input.policy === 'planned' ? (v.berth ?? berth.id) === berth.id : true));
    if (!pool.length) return null;
    pool = pool.sort((a, b) => a.eta - b.eta);
    return pool[0];
  };

  const daily: DayResult[] = [];
  let dayAcc: Record<string, { burn: number; burnHigh: number; burnLow: number; receipts: number }> = {};
  let genAcc = 0, shortAcc = 0, shortageMwh = 0;
  const resetAcc = () => { dayAcc = Object.fromEntries(input.yards.map(y => [y.id, { burn: 0, burnHigh: 0, burnLow: 0, receipts: 0 }])); genAcc = 0; shortAcc = 0; };
  resetAcc();
  const dep: Record<string, Depletion | null> = {};
  const markDep = (key: string, hour: number) => {
    if (dep[key]) return;
    const day = Math.floor(hour / DAY);
    dep[key] = { day, hour, date: kstDate(input.start, hour), withinHorizon: day < input.horizonDays };
  };

  for (let h = 0; h < H; h++) {
    const day = Math.floor(h / DAY);
    // 1) 접안 배정
    for (const b of input.berths) {
      if (atBerth[b.id] || berthFree[b.id] > h) continue;
      // 계획 고정이 아니면 설비가 멈춘 부두에는 새로 접안시키지 않는다.
      if (input.policy !== 'planned' && outageFactor(input, b.id, h) === 0) continue;
      const v = pickVessel(b, h);
      if (!v) continue;
      v.assignedBerth = b.id;
      v.berthedAt = h;
      const y = chooseYard(v, b, h);
      v.movedYard = y !== v.plannedYard;
      v.assignedYard = y;
      atBerth[b.id] = v;
    }
    // 2) 하역
    for (const b of input.berths) {
      const v = atBerth[b.id];
      if (!v) continue;
      const y = yard[v.assignedYard];
      const rate = b.rateTph * outageFactor(input, b.id, h);
      const room = Math.max(0, y.capacity - (y.high.tonnes + y.low.tonnes));
      const q = Math.min(rate, v.remaining, room);
      if (rate > 0 && q < Math.min(rate, v.remaining) - eps) v.blockedHours += 1;
      if (q > 0) {
        const g = y[v.grade];
        g.cv = (g.tonnes * g.cv + q * v.cv) / (g.tonnes + q);
        g.tonnes += q;
        v.remaining -= q;
        dayAcc[v.assignedYard].receipts += q;
      }
      if (v.remaining <= eps) {
        v.remaining = 0;
        v.finishedAt = h + (q > 0 && rate > 0 ? Math.min(1, q / rate) : 1);
        if (Math.abs(v.finishedAt - Math.round(v.finishedAt)) < 1e-9) v.finishedAt = Math.round(v.finishedAt);
        atBerth[b.id] = null;
        berthFree[b.id] = Math.ceil(v.finishedAt) + input.shiftHours;
      }
    }
    // 2-1) 이적
    for (const t of input.transfers ?? []) {
      if (h < t.hour) continue;
      const done = (t as YardTransfer & { done?: number }).done ?? 0;
      if (done >= t.tonnes - eps) continue;
      const src = yard[t.fromYard], dst = yard[t.toYard];
      const avail = src.high.tonnes + src.low.tonnes;
      const room = dst.capacity - (dst.high.tonnes + dst.low.tonnes);
      const q = Math.min(t.rateTph, t.tonnes - done, avail, room);
      if (q <= 0) continue;
      for (const g of ['high', 'low'] as Grade[]) {
        const part = avail > 0 ? (q * src[g].tonnes) / avail : 0;
        if (part <= 0) continue;
        dst[g].cv = (dst[g].tonnes * dst[g].cv + part * src[g].cv) / (dst[g].tonnes + part);
        dst[g].tonnes += part; src[g].tonnes -= part;
      }
      (t as YardTransfer & { done?: number }).done = done + q;
      dayAcc[t.toYard].receipts += q;
      notes.add(`${input.yards.find(y => y.id === t.fromYard)?.name} → ${input.yards.find(y => y.id === t.toYard)?.name} 이적 ${Math.round(t.tonnes / 1000)}천 t (${kstDate(input.start, t.hour)})`);
    }
    // 3) 연소
    const strategy = strategyAt(input, day);
    const lf = loadFactor(input, day);
    for (const y of input.yards) {
      const st = yard[y.id];
      for (const u of input.units.filter(x => x.yard === y.id)) {
        const mwh = u.dailyMwh[day] * lf / DAY;
        const mwhCapped = Math.min(mwh, u.capacityMw);
        genAcc += mwhCapped;
        let energy = mwhCapped * u.heatRate; // Mcal (MWh × kcal/kWh)
        if (energy <= 0) continue;
        const share = strategy === 'fifo' ? (st.high.tonnes + st.low.tonnes > 0 ? st.high.tonnes / (st.high.tonnes + st.low.tonnes) : 0.5) : HIGH_SHARE[strategy];
        // 질량 비율 share 로 섞었을 때 필요한 양
        const mix = share * st.high.cv + (1 - share) * st.low.cv;
        let tH = Math.min(st.high.tonnes, (energy / mix) * share);
        let tL = Math.min(st.low.tonnes, (energy / mix) * (1 - share));
        energy -= tH * st.high.cv + tL * st.low.cv;
        if (energy > eps) {
          // 부족한 탄종을 다른 탄종으로 대체
          const extraH = Math.min(st.high.tonnes - tH, energy / st.high.cv);
          tH += extraH; energy -= extraH * st.high.cv;
          const extraL = Math.min(st.low.tonnes - tL, Math.max(0, energy) / st.low.cv);
          tL += extraL; energy -= extraL * st.low.cv;
          if (extraH > eps || extraL > eps) notes.add(`${y.name}: ${kstDate(input.start, h)}부터 ${extraH > extraL ? '저열량탄 부족분을 고열량탄으로' : '고열량탄 부족분을 저열량탄으로'} 대체`);
        }
        st.high.tonnes -= tH; st.low.tonnes -= tL;
        if (st.high.tonnes < eps) st.high.tonnes = 0;
        if (st.low.tonnes < eps) st.low.tonnes = 0;
        const acc = dayAcc[y.id];
        acc.burnHigh += tH; acc.burnLow += tL; acc.burn += tH + tL;
        if (energy > 1e-3) {
          const short = energy / u.heatRate;
          shortAcc += short;
          if (day < input.horizonDays) shortageMwh += short;
          notes.add(`${y.name}: ${kstDate(input.start, h)} 연료 부족으로 ${u.id}호기 출력 제한`);
        }
      }
      if (st.high.tonnes <= 0) markDep(`${y.id}.high`, h);
      if (st.low.tonnes <= 0) markDep(`${y.id}.low`, h);
    }
    const sumGrade = (g: Grade) => input.yards.reduce((s, y) => s + yard[y.id][g].tonnes, 0);
    if (sumGrade('high') <= 0) markDep('high', h);
    if (sumGrade('low') <= 0) markDep('low', h);
    if (sumGrade('high') + sumGrade('low') <= 0) markDep('all', h);

    // 5) 하루 마감
    if (h % DAY === DAY - 1) {
      const yards: Record<string, YardDay> = {};
      for (const y of input.yards) {
        const st = yard[y.id], acc = dayAcc[y.id], t = st.high.tonnes + st.low.tonnes;
        yards[y.id] = { high: st.high.tonnes, low: st.low.tonnes, total: t, cvHigh: st.high.cv, cvLow: st.low.cv, ...acc, days: daysOfStock(y.id, day, t) };
      }
      const queue = vessels.filter(v => v.berthedAt === null && v.eta <= h && v.remaining > eps).length;
      daily.push({ day, date: kstDate(input.start, h), yards, generationMwh: genAcc, shortageMwh: shortAcc, queue });
      resetAcc();
    }
  }

  // 체선 계산과 기준시각 상태
  for (const v of vessels) {
    v.waitHours = v.berthedAt !== null ? Math.max(0, v.berthedAt - v.eta) : v.eta < H ? H - v.eta : 0;
    const end = v.finishedAt ?? H;
    const laytime = (v.cargo / input.laytimeTpd) * DAY + DAY;
    const used = v.eta < H ? end - v.eta : 0;
    v.demurrageHours = Math.max(0, used - laytime);
    v.demurrageUsd = (v.demurrageHours / DAY) * input.demurrageUsdPerDay;
    v.state = v.berthedAt !== null && v.berthedAt <= 0 ? (v.finishedAt !== null && v.finishedAt <= 0 ? '완료' : '하역중') : v.eta <= 0 ? '체선' : v.eta <= 72 ? '근거리' : '원거리';
  }

  const visible = daily.slice(0, input.horizonDays);
  // 계약 선박 하역이 끝난 뒤의 고갈은 고갈 시점으로 따로 보이고, 재고일수 최저값은 계약 기간 안에서 본다.
  const lastFinish = Math.max(0, ...vessels.map(v => v.finishedAt ?? 0));
  const contractDays = Math.max(1, Math.min(input.horizonDays, Math.floor(lastFinish / DAY)));
  let minDays: number | null = null, minDaysDate: string | null = null;
  for (const d of visible.slice(0, contractDays)) for (const y of Object.values(d.yards)) if (y.days !== null && (minDays === null || y.days < minDays)) { minDays = y.days; minDaysDate = d.date; }
  const horizonH = input.horizonDays * DAY;
  const inHorizon = vessels.filter(v => v.eta < horizonH);
  const result: ForecastResult = {
    input,
    daily: visible,
    vessels: vessels.map(({ remaining: _r, ...v }) => v),
    depletion: {
      high: dep.high ?? null, low: dep.low ?? null, all: dep.all ?? null,
      yards: Object.fromEntries(input.yards.map(y => [y.id, { high: dep[`${y.id}.high`] ?? null, low: dep[`${y.id}.low`] ?? null }])),
    },
    shortageMwh,
    notes: [...notes],
    kpis: {
      contractEndDay: contractDays, minDays, minDaysDate,
      risk: minDays === null ? 'normal' : minDays < RISK_DAYS.danger ? 'danger' : minDays < RISK_DAYS.normal ? 'caution' : 'normal',
      demurrageUsd: inHorizon.reduce((s, v) => s + v.demurrageUsd, 0),
      demurrageDays: inHorizon.reduce((s, v) => s + v.demurrageHours, 0) / DAY,
      waitingVessels: inHorizon.filter(v => v.waitHours > 0).length,
      burnTotal: visible.reduce((s, d) => s + Object.values(d.yards).reduce((a, y) => a + y.burn, 0), 0),
      receiptsTotal: visible.reduce((s, d) => s + Object.values(d.yards).reduce((a, y) => a + y.receipts, 0), 0),
      generationMwh: visible.reduce((s, d) => s + d.generationMwh, 0),
    },
  };
  return result;
}
