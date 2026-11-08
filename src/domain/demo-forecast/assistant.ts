// 어시스턴트: 자연어 지시를 계산 조건으로 바꾸고(규칙 기반 백업), 배정 대안을 비교한다.
// LLM을 연결해도 계산은 이 엔진이 하고, LLM은 같은 ForecastChange 형식만 만든다.
import { simulateForecast, STRATEGY_LABEL, type BerthPolicy, type ForecastInput, type ForecastResult, type Strategy } from './engine.ts';
import type { ForecastChange } from './scenarios.ts';

export interface ParsedInstruction { changes: ForecastChange[]; explanations: string[]; unparsed: string[] }

const STRATEGY_WORDS: [RegExp, Strategy][] = [
  [/발열량|열량\s*우선|고열량\s*위주/, 'calorific'],
  [/가격|저가|원가|저열량\s*위주/, 'price'],
  [/환경|황분|저황|배출/, 'environment'],
  [/선입선출|오래된\s*탄|FIFO/i, 'fifo'],
];

function period(text: string, horizon: number): { from: number; to: number | null } {
  const until = text.match(/(다음\s*주|이번\s*주)\s*까지/);
  if (until) return { from: 0, to: until[1].startsWith('다음') ? 7 : 3 };
  const fromD = text.match(/D\s*\+\s*(\d+)\s*(일)?\s*부터/i);
  const weeks = text.match(/(\d+)\s*주\s*(간|동안)?/);
  const days = text.match(/(\d+)\s*일\s*(간|동안)/);
  const from = fromD ? Number(fromD[1]) : /내일/.test(text) ? 1 : 0;
  if (weeks) return { from, to: Math.min(horizon, from + Number(weeks[1]) * 7 - 1) };
  if (days) return { from, to: Math.min(horizon, from + Number(days[1]) - 1) };
  return { from, to: null };
}

function hours(text: string): { from: number; to: number } {
  const base = /모레/.test(text) ? 48 : /내일/.test(text) ? 24 : 0;
  const d = text.match(/D\s*\+\s*(\d+)/i);
  const day = d ? Number(d[1]) * 24 : base;
  const dur = text.match(/(\d+)\s*시간/);
  if (/오전/.test(text)) return { from: day + 6, to: day + (dur ? 6 + Number(dur[1]) : 12) };
  if (/오후/.test(text)) return { from: day + 12, to: day + (dur ? 12 + Number(dur[1]) : 18) };
  const at = text.match(/(\d{1,2})\s*시/);
  const start = day + (at ? Number(at[1]) : day === 0 ? 0 : 6);
  return { from: start, to: start + (dur ? Number(dur[1]) : 12) };
}

export function parseInstruction(text: string, input: ForecastInput): ParsedInstruction {
  const changes: ForecastChange[] = [], explanations: string[] = [], unparsed: string[] = [];
  const clauses = text.split(/[,，.。;\n]|그리고|하고\s|또\s/).map(s => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    let hit = false;
    // 1) 설비 정비·고장
    const cv = clause.match(/(\d)\s*부두[^0-9]*?(CV|컨베이어|하역기|CSU)/i);
    if (cv && /정비|고장|정지|멈|점검/.test(clause)) {
      const berth = Number(cv[1]);
      const h = hours(clause);
      const factor = /하역기|CSU/i.test(clause) && /한\s*대|1\s*대|절반/.test(clause) ? 0.5 : 0;
      changes.push({ kind: 'outage', berth, from: h.from, to: h.to, factor, note: `${berth}부두 ${cv[2].toUpperCase()} ${/고장/.test(clause) ? '고장' : '정비'}` });
      explanations.push(`${berth}부두 ${cv[2].toUpperCase()}: D+${Math.floor(h.from / 24)} ${h.from % 24}시부터 ${h.to - h.from}시간 ${factor ? '하역 속도 절반' : '하역 중지'}`);
      hit = true;
    }
    // 2) 입항 지연
    const delay = clause.match(/(\d+)\s*일\s*(지연|늦|연기)/);
    if (delay) {
      const v = input.vessels.find(x => clause.toUpperCase().includes(x.name.toUpperCase()) || clause.toUpperCase().includes(x.name.replace(/^GEN4CAST\s+/i, '').toUpperCase()));
      if (v) {
        changes.push({ kind: 'delay', vesselId: v.id, vesselName: v.name, days: Number(delay[1]) });
        explanations.push(`${v.name}: 입항 ${delay[1]}일 지연`);
        hit = true;
      }
    }
    // 3) 발전량 변화
    const load = clause.match(/(발전량|출력|부하|소비)[^0-9]*?(\d+)\s*%\s*(증가|늘|상승|감소|줄|하락)?/);
    if (load) {
      const pct = Number(load[2]) * (/(감소|줄|하락)/.test(clause) ? -1 : 1);
      const p = period(clause, input.horizonDays);
      const to = p.to ?? Math.min(input.horizonDays, p.from + 6);
      changes.push({ kind: 'load', fromDay: p.from, toDay: to, pct, note: '지시 입력' });
      explanations.push(`D+${p.from}~D+${to} 석탄 발전량 ${pct > 0 ? '+' : ''}${pct}%`);
      hit = true;
    }
    // 4) 상탄 전략
    if (/우선|위주|선입선출|혼탄|상탄/.test(clause)) {
      const s = STRATEGY_WORDS.find(([re]) => re.test(clause));
      if (s) {
        const p = period(clause, input.horizonDays);
        changes.push({ kind: 'strategy', fromDay: p.from, toDay: p.to, strategy: s[1] });
        explanations.push(`${p.to === null ? `D+${p.from}부터` : `D+${p.from}~D+${p.to}`} ${STRATEGY_LABEL[s[1]]}`);
        hit = true;
      }
    }
    if (!hit) unparsed.push(clause);
  }
  return { changes, explanations, unparsed };
}

export interface Alternative {
  id: string;
  policy: BerthPolicy;
  title: string;
  description: string;
  result: ForecastResult;
  score: number;
  rank: number;
  moved: number;
  transferTonnes: number;
  costUsd: number;
}

const POLICY_TEXT: Record<BerthPolicy, [string, string]> = {
  planned: ['계획 부두 유지', '계약 때 정한 부두·저탄장 그대로 접안합니다.'],
  auto: ['빈 부두 먼저', '먼저 비는 부두(설비 정지 부두 제외)에 바로 접안하고, 계획 저탄장이 차면 여유 있는 곳에 적치합니다.'],
};
/** 가정값: 구내 이적 단가(USD/t)와 이적 속도 */
export const TRANSFER_USD_PER_T = 3;
const TRANSFER_TPH = 1500;

function worstPoint(r: ForecastResult): { day: number; yard: string; days: number } | null {
  let worst: { day: number; yard: string; days: number } | null = null;
  for (const d of r.daily.slice(0, r.kpis.contractEndDay)) for (const [id, y] of Object.entries(d.yards)) if (y.days !== null && y.days < 7 && (!worst || y.days < worst.days)) worst = { day: d.day, yard: id, days: y.days };
  return worst;
}

function evaluate(id: string, policy: BerthPolicy, title: string, description: string, input: ForecastInput): Alternative {
  const result = simulateForecast(input);
  // 판단 기간: 계약 선박 하역이 끝날 때까지(그 뒤 고갈은 추가 구매 문제라 배정 방식과 무관)
  const window = result.daily.slice(0, result.kpis.contractEndDay);
  const shortage = window.reduce((s, d) => s + d.shortageMwh, 0);
  const moved = result.vessels.filter(v => v.movedYard && v.eta < input.horizonDays * 24).length;
  const transferTonnes = (input.transfers ?? []).reduce((s, t) => s + t.tonnes, 0);
  const minDays = result.kpis.minDays ?? 30;
  const costUsd = result.kpis.demurrageUsd + transferTonnes * TRANSFER_USD_PER_T + moved * 30000;
  const score =
    shortage * 1000 +
    Math.max(0, 7 - minDays) * 400000 +
    Math.max(0, 15 - minDays) * 60000 +
    costUsd; // 계획과 다른 저탄장 적치는 이적 가능성 비용(척당 3만 달러, 가정)
  return { id, policy, title, description, result, score, rank: 0, moved, transferTonnes, costUsd };
}

/** 위험 저탄장을 여유 저탄장의 이적으로 보완하는 안. 이적량·보내는 저탄장을 바꿔 다시 계산해 가장 나은 것을 고른다. */
function transferPlan(base: Alternative, input: ForecastInput): Alternative | null {
  const worst = worstPoint(base.result);
  if (!worst) return null;
  const window = base.result.daily.slice(0, base.result.kpis.contractEndDay);
  const startDay = Math.max(0, window.findIndex(d => (d.yards[worst.yard].days ?? 99) < 9) - 1);
  const name = (id: string) => input.yards.find(y => y.id === id)?.name ?? id;
  let best: Alternative | null = null;
  for (const donor of input.yards.map(y => y.id).filter(id => id !== worst.yard)) {
    for (let tonnes = 10000; tonnes <= 60000; tonnes += 10000) {
      const next: ForecastInput = { ...input, policy: base.policy, transfers: [...(input.transfers ?? []), { fromYard: donor, toYard: worst.yard, tonnes, hour: startDay * 24 + 8, rateTph: TRANSFER_TPH }] };
      const alt = evaluate(`${base.policy}+transfer`, base.policy, `${POLICY_TEXT[base.policy][0]} + 이적`, `${name(donor)}에서 ${name(worst.yard)}으로 D+${startDay} 08시부터 ${(tonnes / 10000).toFixed(0)}만 t 이적합니다(이적 단가 ${TRANSFER_USD_PER_T}달러/t 가정).`, next);
      if (!best || alt.score < best.score) best = alt;
    }
  }
  return best && best.score < base.score ? best : null;
}

/** 같은 조건에서 배정 방식만 바꿔 다시 계산하고, 필요하면 이적안을 더해 순위를 매긴다. 점수가 낮을수록 좋다. */
export function compareAlternatives(input: ForecastInput): Alternative[] {
  const order: BerthPolicy[] = ['planned', 'auto'];
  const alts = order.map(policy => evaluate(policy, policy, POLICY_TEXT[policy][0], POLICY_TEXT[policy][1], { ...input, policy }));
  const best = [...alts].sort((a, b) => a.score - b.score || order.indexOf(a.policy) - order.indexOf(b.policy))[0];
  const extra = transferPlan(best, input);
  if (extra) alts.push(extra);
  const kindOrder = (a: Alternative) => order.indexOf(a.policy) * 10 + a.id.length;
  alts.sort((a, b) => a.score - b.score || kindOrder(a) - kindOrder(b));
  alts.forEach((a, i) => (a.rank = i + 1));
  return alts;
}

/** 해석 결과와 출처(LLM 또는 규칙 백업) */
export interface Interpretation extends ParsedInstruction { source: 'llm' | 'rule'; reply?: string; fallbackReason?: string }

/** 서버(LLM)가 돌려준 조건을 한 번 더 확인한다. 모르는 선박·부두·형식은 버린다. */
export function acceptServerChanges(raw: unknown, input: ForecastInput): ParsedInstruction {
  const body = (raw ?? {}) as { changes?: unknown[]; explanations?: unknown[]; unparsed?: unknown[] };
  const vessels = new Map(input.vessels.map(v => [v.id, v.name]));
  const berths = new Set(input.berths.map(b => b.id));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const changes: ForecastChange[] = [], explanations: string[] = [];
  const unparsed = (body.unparsed ?? []).filter((x): x is string => typeof x === 'string');
  (body.changes ?? []).forEach((c, i) => {
    const x = c as Record<string, unknown>;
    let ok: ForecastChange | null = null;
    if (x.kind === 'delay' && typeof x.vesselId === 'string' && vessels.has(x.vesselId) && num(x.days)) ok = { kind: 'delay', vesselId: x.vesselId, vesselName: vessels.get(x.vesselId)!, days: num(x.days)! };
    else if (x.kind === 'outage' && berths.has(num(x.berth) ?? -1) && num(x.from) !== null && (num(x.to) ?? -1) > num(x.from)!) ok = { kind: 'outage', berth: num(x.berth)!, from: num(x.from)!, to: num(x.to)!, factor: Math.min(0.9, Math.max(0, num(x.factor) ?? 0)), note: String(x.note ?? '설비 정지') };
    else if (x.kind === 'load' && num(x.fromDay) !== null && (num(x.toDay) ?? -1) >= num(x.fromDay)! && num(x.pct)) ok = { kind: 'load', fromDay: num(x.fromDay)!, toDay: num(x.toDay)!, pct: num(x.pct)!, note: String(x.note ?? '지시 입력') };
    else if (x.kind === 'strategy' && typeof x.strategy === 'string' && x.strategy in STRATEGY_LABEL && num(x.fromDay) !== null) ok = { kind: 'strategy', fromDay: num(x.fromDay)!, toDay: num(x.toDay), strategy: x.strategy as Strategy };
    const why = typeof body.explanations?.[i] === 'string' ? (body.explanations[i] as string) : '';
    if (ok) { changes.push(ok); explanations.push(why || x.kind as string); } else unparsed.push(`확인 불가: ${why || String(x.kind)}`);
  });
  return { changes, explanations, unparsed };
}
