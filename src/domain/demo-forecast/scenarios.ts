import type { ForecastInput, Strategy } from './engine.ts';

// 계산 조건 변경. 시연 상황과 어시스턴트 해석 결과가 같은 형식을 쓴다.
export type ForecastChange =
  | { kind: 'delay'; vesselId: string; vesselName: string; days: number }
  | { kind: 'outage'; berth: number; from: number; to: number; factor: number; note: string }
  | { kind: 'load'; fromDay: number; toDay: number; pct: number; note: string }
  | { kind: 'strategy'; fromDay: number; toDay: number | null; strategy: Strategy };

export interface DemoScenario { id: string; title: string; summary: string; changes: ForecastChange[] }

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'delay',
    title: '입항 지연',
    summary: '기상 악화로 3저탄장행 GEN4CAST SENTINEL 입항이 5일 늦어집니다.',
    changes: [{ kind: 'delay', vesselId: 'V-260519', vesselName: 'GEN4CAST SENTINEL', days: 5 }],
  },
  {
    id: 'cv-fault',
    title: '반입 CV 고장',
    summary: '2부두 반입 컨베이어가 D+2 20시부터 48시간 멈춥니다.',
    changes: [{ kind: 'outage', berth: 2, from: 2 * 24 + 20, to: 2 * 24 + 68, factor: 0, note: '2부두 반입 CV 고장' }],
  },
  {
    id: 'surge',
    title: '발전량 급증',
    summary: '한파와 태양광 저조로 D+3부터 2주간 석탄 발전량이 12% 늘어납니다.',
    changes: [{ kind: 'load', fromDay: 3, toDay: 16, pct: 12, note: '한파·태양광 저조' }],
  },
  {
    id: 'strategy',
    title: '상탄 전략 변경',
    summary: 'D+7부터 가격 우선(저열량탄 위주)으로 상탄합니다.',
    changes: [{ kind: 'strategy', fromDay: 7, toDay: null, strategy: 'price' }],
  },
];

export function applyChanges(input: ForecastInput, changes: ForecastChange[]): ForecastInput {
  const next: ForecastInput = structuredClone(input);
  for (const c of changes) {
    if (c.kind === 'delay') {
      const v = next.vessels.find(x => x.id === c.vesselId);
      if (v && v.berthedAt === undefined) v.eta += c.days * 24;
    } else if (c.kind === 'outage') {
      next.berthOutages.push({ berth: c.berth, from: c.from, to: c.to, factor: c.factor, note: c.note });
    } else if (c.kind === 'load') {
      next.loadChanges.push({ fromDay: c.fromDay, toDay: c.toDay, pct: c.pct, note: c.note });
    } else if (c.kind === 'strategy') {
      const sorted = [...next.strategy].sort((a, b) => a.fromDay - b.fromDay);
      const before = (day: number) => sorted.filter(p => p.fromDay <= day).at(-1)?.strategy ?? 'calorific';
      const resume = c.toDay !== null ? before(c.toDay + 1) : null;
      next.strategy = sorted.filter(p => p.fromDay < c.fromDay || (c.toDay !== null && p.fromDay > c.toDay));
      next.strategy.push({ fromDay: c.fromDay, strategy: c.strategy });
      if (c.toDay !== null && resume && !next.strategy.some(p => p.fromDay === c.toDay! + 1)) next.strategy.push({ fromDay: c.toDay + 1, strategy: resume });
      next.strategy.sort((a, b) => a.fromDay - b.fromDay);
    }
  }
  return next;
}

export function applyScenario(input: ForecastInput, scenario: DemoScenario): ForecastInput {
  return applyChanges(input, scenario.changes);
}
