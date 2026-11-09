// 수급 예측: D+7~90 재고·고갈·접안을 계산하고, 상황 변경과 어시스턴트 지시를 바로 반영한다.
// 어시스턴트는 ZGX의 LLM 해석을 먼저 쓰고, 쓸 수 없으면 규칙 기반 해석으로 대신한다.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, RotateCcw, Sparkles, Check } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { number as n } from "@/lib/format";
import { simulateForecast, kstDate, RISK_DAYS, STRATEGY_LABEL, type ForecastInput, type ForecastResult, type Depletion } from "@/domain/demo-forecast/engine";
import { applyChanges, DEMO_SCENARIOS, type ForecastChange } from "@/domain/demo-forecast/scenarios";
import { acceptServerChanges, compareAlternatives, parseInstruction, type Alternative, type Interpretation } from "@/domain/demo-forecast/assistant";
import { authJson } from "@/lib/auth-client";
import { demoForecastInput } from "@/data/demo-forecast-sample";
import { kstDay } from "@/domain/operations-status";
import { fromOperations, operationsKey } from "@/domain/demo-forecast/live";
import type { FuelDemoSnapshot, FuelDemoStatus } from "@/domain/fuel-demo/types";
import { AssistantSection } from "@/components/assistant-section/AssistantSection";
import { SCREEN_QUESTIONS, type AssistantContext } from "@/domain/assistant-checks";
import "./demo-forecast.css";

const HORIZONS = [7, 30, 60, 90] as const;
const EXAMPLES = [
  "2부두 CV가 내일 오전 정비야",
  "GEN4CAST SENTINEL 5일 지연, 발전량 10% 증가 2주",
  "다음 주까지는 환경 우선으로 혼탄해 줘",
];
/** 포인트색(#2447C5) 계열의 화면 전용 데이터 색. 값은 demo-forecast.css가 라이트·다크별로 정한다. */
const YARD_COLORS = ["var(--dfc-c1)", "var(--dfc-c2)", "var(--dfc-c3)"];
/** 저탄장 선은 색과 함께 선 모양으로도 구분한다. */
const YARD_DASH = [undefined, undefined, "5 3"];
const STOCK_CONFIG = {
  high: { label: "고열량탄", color: "var(--dfc-c1)" },
  low: { label: "저열량탄", color: "var(--dfc-c2)" },
  receipts: { label: "입하", color: "var(--dfc-muted)" },
} satisfies ChartConfig;
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 28 } as const;
const usd = (v: number) => (v >= 1e6 ? `${n(v / 1e6, 2)}백만` : v >= 1e4 ? `${n(v / 1e4, 1)}만` : n(v, 0));
const dayLabel = (d: string) => d.slice(5).replace("-", "/");

function changeText(c: ForecastChange) {
  if (c.kind === "delay") return `${c.vesselName} 입항 ${c.days}일 지연`;
  if (c.kind === "outage") return `${c.note}: D+${Math.floor(c.from / 24)} ${c.from % 24}시부터 ${c.to - c.from}시간${c.factor ? ` 속도 ${Math.round(c.factor * 100)}%` : " 중지"}`;
  if (c.kind === "load") return `D+${c.fromDay}~D+${c.toDay} 석탄 발전량 ${c.pct > 0 ? "+" : ""}${c.pct}%`;
  return `${c.toDay === null ? `D+${c.fromDay}부터` : `D+${c.fromDay}~D+${c.toDay}`} ${STRATEGY_LABEL[c.strategy]}`;
}
function depText(d: Depletion | null, horizon: number) {
  if (!d || d.day >= horizon) return { v: "없음", s: `D+${horizon} 안에 고갈 없음` };
  return { v: `D+${d.day}`, s: d.date };
}

function Panel({ title, note, children, className = "" }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`dfc-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {note && <span title={note}>{note}</span>}
      </header>
      {children}
    </section>
  );
}

export function DemoForecast({ theme, snapshot, status, onAsk, onNavigate }: {
  theme: string; snapshot: FuelDemoSnapshot | null; status: FuelDemoStatus;
  onAsk: (question: string, context: AssistantContext) => void; onNavigate: (page: string) => void;
}) {
  const [horizon, setHorizon] = useState<number>(90);
  const [today, setToday] = useState(() => kstDay(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setToday(kstDay(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  const sample = useMemo(() => demoForecastInput(horizon, `${today}T00:00:00+09:00`), [horizon, today]);
  const [useLive, setUseLive] = useState(true);
  const liveReady = !!snapshot && (status === "online" || status === "stale");
  const live = useLive && liveReady;
  const liveKey = snapshot ? operationsKey(snapshot) : "";
  // 운전 상태는 0.25초마다 들어오므로, 재고·잔량·출력이 의미 있게 바뀔 때만 시작값을 다시 만든다.
  const start = useMemo(
    () => (live && snapshot ? fromOperations(sample, snapshot) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, liveKey, sample],
  );
  const startInput = () => start?.input ?? sample;
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [extra, setExtra] = useState<ForecastChange[]>([]);
  const [adopted, setAdopted] = useState<Alternative | null>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Interpretation | null>(null);
  const [thinking, setThinking] = useState(false);
  const [alts, setAlts] = useState<Alternative[] | null>(null);
  const [busy, setBusy] = useState(false);

  const scenarioChanges = (ids: string[]) => DEMO_SCENARIOS.filter(s => ids.includes(s.id)).flatMap(s => s.changes);
  const changes = useMemo(() => [...scenarioChanges(scenarioIds), ...extra], [scenarioIds, extra]);
  const input = useMemo<ForecastInput>(() => {
    const next = applyChanges(startInput(), changes);
    return adopted ? { ...next, policy: adopted.policy, transfers: adopted.result.input.transfers } : next;
  }, [start, sample, changes, adopted]);
  const result = useMemo(() => simulateForecast(input), [input]);
  const base = useMemo(() => simulateForecast(startInput()), [sample, start]);
  const hourLabel = (h: number | null) => h === null ? "-" : `${kstDate(input.start, h).slice(5).replace("-", "/")} ${String(((Math.floor(h) % 24) + 24) % 24).padStart(2, "0")}시`;

  function resetDecisions() {
    setAdopted(null);
    setAlts(null);
  }
  function toggleScenario(id: string) {
    setScenarioIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
    resetDecisions();
  }
  function resetAll() {
    setScenarioIds([]);
    setExtra([]);
    setParsed(null);
    setText("");
    resetDecisions();
  }
  function runCompare(nextChanges = changes) {
    setBusy(true);
    setAdopted(null);
    setTimeout(() => {
      try {
        setAlts(compareAlternatives(applyChanges(startInput(), nextChanges)));
      } finally {
        setBusy(false);
      }
    }, 30);
  }
  async function interpret(value = text) {
    if (!value.trim() || thinking) return;
    const base = startInput();
    const rule = (reason: string): Interpretation => ({ ...parseInstruction(value, base), source: "rule", fallbackReason: reason });
    if (location.protocol === "file:") return setParsed(rule("오프라인 파일에서는 서버 해석을 쓰지 않습니다."));
    setThinking(true);
    try {
      const body = {
        text: value,
        horizon_days: horizon,
        berths: base.berths.map(b => b.id),
        vessels: base.vessels.filter(v => v.eta < horizon * 24).map(v => ({ id: v.id, name: v.name, eta_hour: v.eta })),
      };
      const res = await authJson<{ changes: unknown[]; explanations: string[]; unparsed: string[]; reply: string }>("/api/demo-forecast/interpret", { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      setParsed({ ...acceptServerChanges(res, base), source: "llm", reply: res.reply });
    } catch (e) {
      setParsed(rule(e instanceof Error ? e.message : "서버 해석을 쓰지 못했습니다."));
    } finally {
      setThinking(false);
    }
  }
  function applyParsed() {
    if (!parsed?.changes.length) return;
    const next = [...extra, ...parsed.changes];
    setExtra(next);
    runCompare([...scenarioChanges(scenarioIds), ...next]);
    setParsed(null);
    setText("");
  }

  const k = result.kpis;
  const demVessels = result.vessels.filter(v => v.eta < horizon * 24 && v.demurrageHours > 0).length;
  const riskLabel = k.risk === "danger" ? "위험" : k.risk === "caution" ? "주의" : "안정";
  const dAll = depText(result.depletion.all, horizon);

  const yardKeys = result.input.yards.map((y, i) => ({ key: `y${i + 1}`, id: y.id, name: y.name }));
  const yardConfig = Object.fromEntries(yardKeys.map((y, i) => [y.key, { label: y.name, color: YARD_COLORS[i] }])) satisfies ChartConfig;
  const daysData = useMemo(
    () => result.daily.map(d => ({ day: dayLabel(d.date), ...Object.fromEntries(yardKeys.map(y => [y.key, d.yards[y.id].days === null ? null : Math.round(d.yards[y.id].days! * 10) / 10])) })),
    [result],
  );
  const stockData = useMemo(() => result.daily.map(d => {
    const ys = Object.values(d.yards);
    return { day: dayLabel(d.date), high: Math.round(ys.reduce((s, y) => s + y.high, 0)), low: Math.round(ys.reduce((s, y) => s + y.low, 0)), receipts: Math.round(ys.reduce((s, y) => s + y.receipts, 0)) };
  }), [result]);
  const contractDay = result.daily[k.contractEndDay] ? dayLabel(result.daily[k.contractEndDay].date) : null;
  // 탄종별 고갈일을 차트 세로선으로 표시한다. 같은 날이면 한 줄로 합친다.
  const gradeDepletion = Object.values(
    ([["고열량", result.depletion.high], ["저열량", result.depletion.low]] as const)
      .filter(([, d]) => d && d.day < horizon && result.daily[d.day])
      .reduce<Record<number, { key: number; names: string[]; day: string }>>((acc, [name, d]) => {
        (acc[d!.day] ??= { key: d!.day, names: [], day: dayLabel(result.daily[d!.day].date) }).names.push(name);
        return acc;
      }, {}),
  ).map(g => ({ key: g.key, day: g.day, label: `${g.names.length > 1 ? "고·저열량" : g.names[0]} 고갈 D+${g.key}` }));

  const H = horizon * 24;
  const step = horizon > 30 ? 10 : horizon > 7 ? 5 : 1;
  const ticks = Array.from({ length: Math.floor(horizon / step) + 1 }, (_, i) => i * step);
  const shown = result.vessels.filter(v => v.eta < H && (v.finishedAt === null || v.finishedAt > -24)).sort((a, b) => a.eta - b.eta);
  const pct = (h: number) => `${(h / H) * 100}%`;

  return (
    <div className="dfc-page">
      <header className="dfc-heading">
        <div>
          <h1>수급 예측</h1>
          <p>계약 선박의 접안·하역과 호기별 발전 계획으로 저탄장 재고를 시간 단위로 계산합니다.</p>
        </div>
        <Button variant="outline" size="sm" className="dfc-reset" onClick={resetAll} disabled={!changes.length && !adopted && !parsed}>
          <RotateCcw />
          기준 계획으로
        </Button>
      </header>

      <section className="dfc-controls" aria-label="조회 조건">
        <div className="dfc-control-row">
          <div className="dfc-field">
            <span>예측 기간</span>
            <div className="horizon-control" role="group" aria-label="예측 기간">
              {HORIZONS.map(h => (
                <button key={h} aria-pressed={horizon === h} className={horizon === h ? "selected" : ""} onClick={() => { setHorizon(h); resetDecisions(); }}>
                  {h}일
                </button>
              ))}
            </div>
          </div>
          <div className="dfc-field">
            <span>시작값</span>
            <div className="horizon-control" role="group" aria-label="시작값">
              <button aria-pressed={live} className={live ? "selected" : ""} disabled={!liveReady} title={liveReady ? undefined : "운전 데모가 연결되지 않았습니다"} onClick={() => { setUseLive(true); resetDecisions(); }}>
                현재 운전 상태
              </button>
              <button aria-pressed={!live} className={!live ? "selected" : ""} onClick={() => { setUseLive(false); resetDecisions(); }}>
                기준 표본
              </button>
            </div>
          </div>
          <div className="dfc-field">
            <span>상황 가정</span>
            <div className="dfc-scen" role="group" aria-label="상황 가정">
              {DEMO_SCENARIOS.map(s => (
                <button key={s.id} aria-pressed={scenarioIds.includes(s.id)} title={s.summary} onClick={() => toggleScenario(s.id)}>
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="dfc-strip">
          <span className="dfc-basis">기준시각 {input.start.slice(0, 10)} 00:00 · {horizon}일 <b>KST</b></span>
          <span className="dfc-origin" aria-label="시작값 출처">
            {start
              ? `시작값 현재 운전 상태 · 재고 ${n(start.summary.stockTonnes / 10000, 1)}만 t · 하역 잔량 ${n(start.summary.shipsRemaining / 10000, 1)}만 t · 가동 ${start.summary.runningUnits}기${status === "stale" ? " · 수신 지연" : ""}`
              : liveReady ? "시작값 기준 표본" : "시작값 기준 표본 · 운전 데모 미연결"}
          </span>
          {changes.length > 0 || adopted ? (
            <ul className="dfc-changes" aria-label="반영한 조건">
              {changes.map((c, i) => <li key={i}>{changeText(c)}</li>)}
              {adopted && <li className="dfc-adopted">적용한 대안: {adopted.title}</li>}
            </ul>
          ) : (
            <span>기준 계획 · 변경한 조건 없음</span>
          )}
        </div>
      </section>

      <div className="dfc-grid">
        <div className="dfc-main">
          <div className="dfc-kpis">
            <div className={`dfc-kpi dfc-${k.risk}`}>
              <span>최저 재고일수</span>
              <strong>{k.minDays === null ? "-" : n(k.minDays, 1)}<small>일 · {riskLabel}</small></strong>
              <p>{k.minDaysDate ?? "-"} · 기준 계획 {n(base.kpis.minDays ?? 0, 1)}일</p>
            </div>
            <div className="dfc-kpi">
              <span>전체 고갈 시점</span>
              <strong>{dAll.v}</strong>
              <p>{dAll.s} · 계약 선박 하역 D+{k.contractEndDay}까지 반영</p>
            </div>
            <div className="dfc-kpi">
              <span>체선 예상</span>
              <strong>{n(k.demurrageDays, 1)}<small>일 · {demVessels}척</small></strong>
              <p>체선료 약 {usd(k.demurrageUsd)} 달러 (일 1.8만 달러 가정)</p>
            </div>
          </div>

          <div className="dfc-charts">
            <Panel title="저탄장별 재고일수" note="재고 ÷ 다음 7일 계획 소비량 · 7일 미만 위험, 15일 미만 주의">
              <ChartContainer config={yardConfig} className="dfc-chart" aria-label="저탄장별 재고일수 전망">
                <LineChart data={daysData} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" {...AXIS} />
                  <YAxis {...AXIS} width={30} domain={[0, (max: number) => Math.max(20, Math.ceil(max))]} />
                  <ReferenceLine y={RISK_DAYS.danger} className="dfc-ref-danger" strokeDasharray="4 4" label={{ value: `위험 ${RISK_DAYS.danger}일`, position: "insideTopRight", className: "dfc-ref-label" }} />
                  <ReferenceLine y={RISK_DAYS.normal} className="dfc-ref-caution" strokeDasharray="4 4" label={{ value: `주의 ${RISK_DAYS.normal}일`, position: "insideTopRight", className: "dfc-ref-label" }} />
                  {contractDay && <ReferenceLine x={contractDay} className="dfc-ref-contract" label={{ value: "계약 선박 끝", position: "top", className: "dfc-ref-label" }} />}
                  <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => tipRow(yardConfig, String(name), `${n(Number(v), 1)}일`)} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  {yardKeys.map((y, i) => (
                    <Line key={y.key} dataKey={y.key} type="monotone" stroke={`var(--color-${y.key})`} strokeWidth={i === 0 ? 2.25 : 1.75} strokeDasharray={YARD_DASH[i]} dot={false} connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ChartContainer>
              <p className="dfc-foot">세로선 뒤는 계약 선박이 없어 추가 구매가 필요한 구간입니다.</p>
            </Panel>
            <Panel title="고·저열량탄 재고와 입하" note="전체 저탄장 합계 · 하역한 물량만 재고에 반영">
              <ChartContainer config={STOCK_CONFIG} className="dfc-chart" aria-label="탄종별 재고 전망">
                <ComposedChart data={stockData} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dfc-fill-high" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-high)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--color-high)" stopOpacity={0.08} /></linearGradient>
                    <linearGradient id="dfc-fill-low" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-low)" stopOpacity={0.5} /><stop offset="100%" stopColor="var(--color-low)" stopOpacity={0.1} /></linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" {...AXIS} />
                  <YAxis {...AXIS} width={38} tickFormatter={(v: number) => `${n(v / 1000, 0)}k`} />
                  {contractDay && <ReferenceLine x={contractDay} className="dfc-ref-contract" label={{ value: "계약 선박 끝", position: "top", className: "dfc-ref-label" }} />}
                  {gradeDepletion.map((g, row) => <ReferenceLine key={g.key} x={g.day} className="dfc-ref-danger" strokeDasharray="4 4" label={(props: { viewBox?: { x?: number; y?: number } }) => { const x = props.viewBox?.x ?? 0; const early = x < 130; /* 앞쪽 날짜면 선 오른쪽에 둬 Y축 쪽으로 잘리지 않게 한다 */ return <text className="dfc-ref-label" x={early ? x + 4 : x - 4} y={(props.viewBox?.y ?? 0) + 12 + row * 13} textAnchor={early ? "start" : "end"}>{g.label}</text>; }} />)}
                  <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => tipRow(STOCK_CONFIG, String(name), `${n(Number(v), 0)} t`)} />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="receipts" fill="var(--color-receipts)" barSize={4} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Area dataKey="high" type="monotone" stackId="s" stroke="var(--color-high)" strokeWidth={1.75} fill="url(#dfc-fill-high)" isAnimationActive={false} />
                  <Area dataKey="low" type="monotone" stackId="s" stroke="var(--color-low)" strokeWidth={1.75} fill="url(#dfc-fill-low)" isAnimationActive={false} />
                </ComposedChart>
              </ChartContainer>
            </Panel>
          </div>

          <section className="dfc-panel dfc-plan">
            <Tabs defaultValue="berth">
              <header>
                <TabsList variant="line" aria-label="접안·선박 보기">
                  <TabsTrigger value="berth">접안 계획</TabsTrigger>
                  <TabsTrigger value="vessels">선박 목록</TabsTrigger>
                </TabsList>
                <span>연속 접안 · 교대 {input.shiftHours}시간 · 계산값 · 회색 대기, 빨간 테두리 체선, 빗금 설비 정지</span>
              </header>
              <TabsContent value="berth">
                <div className="dfc-gantt">
                  <div className="dfc-axis">
                    {ticks.map(d => <span key={d} style={{ left: pct(d * 24) }}>D+{d}</span>)}
                  </div>
                  {input.berths.map(b => (
                    <div key={b.id} className="dfc-row">
                      <label>{b.name}</label>
                      <div className="dfc-track">
                        {input.berthOutages
                          .filter(o => o.berth === b.id && o.from < H)
                          .map((o, i) => <i key={i} className="dfc-out" title={o.note} style={{ left: pct(Math.max(0, o.from)), width: pct(Math.min(H, o.to) - Math.max(0, o.from)) }} />)}
                        {result.vessels
                          .filter(v => v.assignedBerth === b.id && v.berthedAt !== null && v.berthedAt < H)
                          .map(v => {
                            const s = Math.max(0, v.berthedAt!);
                            const e = Math.min(H, v.finishedAt ?? H);
                            const ws = Math.max(0, v.eta);
                            return (
                              <span key={v.id}>
                                {v.waitHours > 0 && ws < s && <i className="dfc-wait" style={{ left: pct(ws), width: pct(s - ws) }} />}
                                <i
                                  className={`dfc-bar dfc-${v.grade}${v.demurrageHours > 0 ? " dfc-dem" : ""}`}
                                  title={`${v.name} · ${v.origin} · ${n(v.cargo, 0)}t → ${v.assignedYard}`}
                                  style={{ left: pct(s), width: `max(3px, ${((e - s) / H) * 100}%)` }}
                                >
                                  {horizon <= 30 ? v.name.replace("GEN4CAST ", "") : ""}
                                </i>
                              </span>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                  <ul className="dfc-gantt-key" aria-label="접안 계획 범례">
                    <li><i className="dfc-bar dfc-high" />고열량탄</li>
                    <li><i className="dfc-bar dfc-low" />저열량탄</li>
                    <li><i className="dfc-wait" />대기</li>
                    <li><i className="dfc-out" />설비 정지</li>
                  </ul>
                </div>
              </TabsContent>
              <TabsContent value="vessels">
                <div className="dfc-table-wrap" tabIndex={0} role="region" aria-label="선박별 예측 표">
                  <table className="dfc-table">
                    <thead>
                      <tr><th>선박</th><th className="dfc-num">물량(t)</th><th>ETA → 접안</th><th>하역 완료</th><th>부두 · 저탄장</th><th className="dfc-num">대기 · 체선료</th><th>상태</th></tr>
                    </thead>
                    <tbody>
                      {shown.map(v => (
                        <tr key={v.id} className={v.demurrageHours > 0 ? "dfc-row-dem" : ""}>
                          <td><strong>{v.name.replace("GEN4CAST ", "")}</strong><small>{v.origin} · {v.grade === "high" ? "고열량" : "저열량"} {v.cv}</small></td>
                          <td className="dfc-num">{n(v.cargo, 0)}</td>
                          <td>{hourLabel(v.eta)} → {hourLabel(v.berthedAt)}</td>
                          <td>{hourLabel(v.finishedAt)}</td>
                          <td>{v.assignedBerth ? `${v.assignedBerth}부두` : "-"} · {v.assignedYard}{v.movedYard && <em className="dfc-moved"> 변경</em>}</td>
                          <td className="dfc-num">{v.waitHours > 0 ? `${n(v.waitHours, 0)}h` : "-"} · {v.demurrageUsd > 0 ? `${n(v.demurrageUsd, 0)}$` : "-"}</td>
                          <td><span className={`dfc-state dfc-s-${v.state}`}>{v.state}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <div className="dfc-side">
        <AssistantSection screen="forecast" params={{ live: status === "online" || status === "stale" ? ["stock", "ships", "units"] : [] }}
          context={{ screen: "forecast" }} questions={SCREEN_QUESTIONS.forecast} onAsk={onAsk} onNavigate={onNavigate} />
        <aside className="dfc-panel dfc-assist" aria-label="조건 해석">
          <header><h2><Bot size={15} />조건 해석</h2><span>{parsed?.source === "llm" ? "LLM 해석" : "LLM · 규칙 해석"}</span></header>
          <div className="dfc-assist-body">
            <p className="dfc-note">말로 조건을 바꾸면 LLM이 계산 조건으로 해석하고, 화면의 계산 엔진이 다시 계산해 접안·적치 대안을 비교합니다. LLM을 쓸 수 없으면 규칙 기반 해석으로 대신합니다.</p>
            <textarea
              value={text}
              rows={3}
              aria-label="지시 입력"
              placeholder="예: 2부두 CV가 내일 오전 정비야"
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  interpret();
                }
              }}
            />
            <div className="dfc-examples">
              {EXAMPLES.map(x => (
                <button key={x} onClick={() => { setText(x); interpret(x); }}>{x}</button>
              ))}
            </div>
            <div className="dfc-actions">
              <Button size="sm" onClick={() => interpret()} disabled={!text.trim() || thinking}><Sparkles />{thinking ? "해석 중…" : "해석"}</Button>
              <Button size="sm" variant="outline" onClick={() => runCompare()} disabled={busy}>현재 조건 대안 비교</Button>
            </div>
            {parsed && (
              <div className="dfc-parsed">
                <p className="dfc-source">{parsed.source === "llm" ? "LLM 해석" : "규칙 해석"}{parsed.fallbackReason && <span> · {parsed.fallbackReason}</span>}</p>
                {parsed.reply && <p>{parsed.reply}</p>}
                {parsed.explanations.length ? (
                  <ul>{parsed.explanations.map((e, i) => <li key={i}>{e}</li>)}</ul>
                ) : (
                  <p>이해한 조건이 없습니다. 부두·선박명·발전량·혼탄 전략을 넣어 다시 말해 주세요.</p>
                )}
                {parsed.unparsed.length > 0 && <p className="dfc-warn">해석하지 못한 부분: {parsed.unparsed.join(", ")}</p>}
                {parsed.changes.length > 0 && (
                  <Button size="sm" className="dfc-primary" onClick={applyParsed}><Check />이 조건으로 다시 계산</Button>
                )}
              </div>
            )}
            {busy && <p className="dfc-note">대안을 계산하고 있습니다…</p>}
            {alts && !busy && (
              <div className="dfc-alts">
                <h3>대안 비교 <small>계약 선박 기간 기준</small></h3>
                {alts.map(a => (
                  <div key={a.id} className={`dfc-alt${a.rank === 1 ? " dfc-best" : ""}${adopted?.id === a.id ? " dfc-on" : ""}`}>
                    <div className="dfc-alt-h"><b>{a.rank}</b><span>{a.title}</span>{a.rank === 1 && <em>추천</em>}</div>
                    <p>{a.description}</p>
                    <dl>
                      <div><dt>최저 재고</dt><dd>{n(a.result.kpis.minDays ?? 0, 1)}일</dd></div>
                      <div><dt>체선료</dt><dd>{usd(a.result.kpis.demurrageUsd)}$</dd></div>
                      <div><dt>이적</dt><dd>{a.transferTonnes ? `${n(a.transferTonnes / 10000, 0)}만 t` : "-"}</dd></div>
                    </dl>
                    <Button size="xs" variant={adopted?.id === a.id ? "default" : "outline"} onClick={() => setAdopted(adopted?.id === a.id ? null : a)}>{adopted?.id === a.id ? "적용 취소" : "이 안으로 보기"}</Button>
                  </div>
                ))}
                <p className="dfc-note">결정은 담당자가 합니다. 이적 단가 3달러/t, 체선료 일 1.8만 달러는 가정값입니다.</p>
              </div>
            )}
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}

/** 툴팁 한 줄: 계열 이름과 단위 붙은 값. 색 표시는 ChartTooltipContent가 그린다. */
function tipRow(config: ChartConfig, key: string, value: string) {
  return (
    <span className="dfc-tip">
      <i style={{ background: `var(--color-${key})` }} />
      <span>{config[key]?.label ?? key}</span>
      <b>{value}</b>
    </span>
  );
}
