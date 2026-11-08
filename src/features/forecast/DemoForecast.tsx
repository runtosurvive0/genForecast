// 수급 예측: D+7~90 재고·고갈·접안을 계산하고, 상황 변경과 어시스턴트 지시를 바로 반영한다.
// 어시스턴트는 ZGX의 LLM 해석을 먼저 쓰고, 쓸 수 없으면 규칙 기반 해석으로 대신한다.
import { useMemo, useState } from "react";
import { Bot, RotateCcw, Sparkles, Check } from "lucide-react";
import { TowerChart } from "@/components/TowerChart";
import { Section } from "@/components/tower/primitives";
import { number as n } from "@/lib/format";
import { simulateForecast, kstDate, RISK_DAYS, STRATEGY_LABEL, type ForecastInput, type ForecastResult, type Depletion } from "@/domain/demo-forecast/engine";
import { applyChanges, DEMO_SCENARIOS, type ForecastChange } from "@/domain/demo-forecast/scenarios";
import { acceptServerChanges, compareAlternatives, parseInstruction, type Alternative, type Interpretation } from "@/domain/demo-forecast/assistant";
import { authJson } from "@/lib/auth-client";
import { demoForecastInput, DEMO_FORECAST_START } from "@/data/demo-forecast-sample";
import "./demo-forecast.css";

const HORIZONS = [7, 30, 60, 90] as const;
const EXAMPLES = [
  "2부두 CV가 내일 오전 정비야",
  "GEN4CAST SENTINEL 5일 지연, 발전량 10% 증가 2주",
  "다음 주까지는 환경 우선으로 혼탄해 줘",
];
const YARD_COLORS = ["#2f6fd0", "#2f9b84", "#c0873a"];
const usd = (v: number) => (v >= 1e6 ? `${n(v / 1e6, 2)}백만` : v >= 1e4 ? `${n(v / 1e4, 1)}만` : n(v, 0));
const dayLabel = (d: string) => d.slice(5).replace("-", "/");
const hourLabel = (h: number | null) =>
  h === null ? "-" : `${kstDate(DEMO_FORECAST_START, h).slice(5).replace("-", "/")} ${String(((Math.floor(h) % 24) + 24) % 24).padStart(2, "0")}시`;

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
type YardDayRow = ForecastResult["daily"][number]["yards"][string];
/** 계약 선박 하역이 끝나는 날 세로선: 이후는 추가 구매가 없으면 재고가 줄기만 한다. */
function contractLine(r: ForecastResult) {
  const end = r.daily[r.kpis.contractEndDay];
  return end ? [{ name: "계약 선박 끝", xAxis: dayLabel(end.date), lineStyle: { color: "#7c8594", type: "solid" }, label: { position: "end", fontSize: 10, color: "#7c8594" } }] : [];
}

export function DemoForecast({ theme }: { theme: string }) {
  const [horizon, setHorizon] = useState<number>(90);
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
    const next = applyChanges(demoForecastInput(horizon), changes);
    return adopted ? { ...next, policy: adopted.policy, transfers: adopted.result.input.transfers } : next;
  }, [horizon, changes, adopted]);
  const result = useMemo(() => simulateForecast(input), [input]);
  const base = useMemo(() => simulateForecast(demoForecastInput(horizon)), [horizon]);

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
        setAlts(compareAlternatives(applyChanges(demoForecastInput(horizon), nextChanges)));
      } finally {
        setBusy(false);
      }
    }, 30);
  }
  async function interpret(value = text) {
    if (!value.trim() || thinking) return;
    const base = demoForecastInput(horizon);
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
  const dHigh = depText(result.depletion.high, horizon);
  const dLow = depText(result.depletion.low, horizon);

  const daysOption = useMemo(
    () => ({
      tooltip: { trigger: "axis", valueFormatter: (v: number | null) => (v === null ? "-" : `${n(v, 1)}일`) },
      xAxis: { type: "category", data: result.daily.map(d => dayLabel(d.date)) },
      yAxis: { type: "value", name: "재고일수(일)", min: 0, max: (v: { max: number }) => Math.max(20, Math.ceil(v.max)) },
      series: result.input.yards.map((y, i) => ({
        name: y.name,
        type: "line",
        showSymbol: false,
        lineStyle: { width: 2 },
        color: YARD_COLORS[i],
        data: result.daily.map(d => (d.yards[y.id].days === null ? null : Math.round(d.yards[y.id].days! * 10) / 10)),
        ...(i === 0
          ? {
              markLine: {
                symbol: "none",
                silent: true,
                label: { formatter: "{b}", position: "insideEndTop", fontSize: 10 },
                data: [
                  { name: `위험 ${RISK_DAYS.danger}일`, yAxis: RISK_DAYS.danger, lineStyle: { color: "#c0392b", type: "dashed" } },
                  { name: `주의 ${RISK_DAYS.normal}일`, yAxis: RISK_DAYS.normal, lineStyle: { color: "#c0873a", type: "dashed" } },
                  ...contractLine(result),
                ],
              },
            }
          : {}),
      })),
    }),
    [result],
  );
  const stockOption = useMemo(() => {
    const sum = (f: (y: YardDayRow) => number) => result.daily.map(d => Math.round(Object.values(d.yards).reduce((s, y) => s + f(y), 0)));
    return {
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${n(v, 0)} t` },
      xAxis: { type: "category", data: result.daily.map(d => dayLabel(d.date)) },
      yAxis: { type: "value", name: "재고(t)", axisLabel: { formatter: (v: number) => `${n(v / 1000, 0)}k` } },
      series: [
        { name: "고열량탄", type: "line", stack: "s", areaStyle: { opacity: 0.35 }, showSymbol: false, color: "#2f6fd0", data: sum(y => y.high), markLine: { symbol: "none", silent: true, label: { formatter: "{b}", fontSize: 10 }, data: contractLine(result) } },
        { name: "저열량탄", type: "line", stack: "s", areaStyle: { opacity: 0.35 }, showSymbol: false, color: "#c0873a", data: sum(y => y.low) },
        { name: "입하", type: "bar", color: "#85919e", barMaxWidth: 6, data: sum(y => y.receipts) },
      ],
    };
  }, [result]);

  const H = horizon * 24;
  const step = horizon > 30 ? 10 : horizon > 7 ? 5 : 1;
  const ticks = Array.from({ length: Math.floor(horizon / step) + 1 }, (_, i) => i * step);
  const shown = result.vessels.filter(v => v.eta < H && (v.finishedAt === null || v.finishedAt > -24)).sort((a, b) => a.eta - b.eta);
  const pct = (h: number) => `${(h / H) * 100}%`;

  return (
    <div className="tower-page dfc-page">
      <div className="dfc-head">
        <div>
          <h1>수급 예측</h1>
          <p>기준시각 2026-11-06 00시(KST) · 계약 선박의 연속 접안·하역과 호기별 발전 계획으로 저탄장 재고를 시간 단위로 계산합니다.</p>
        </div>
      </div>

      <div className="dfc-controls">
        <div className="dfc-seg" role="group" aria-label="예측 기간">
          {HORIZONS.map(h => (
            <button key={h} aria-pressed={horizon === h} onClick={() => { setHorizon(h); resetDecisions(); }}>
              D+{h}
            </button>
          ))}
        </div>
        <div className="dfc-scen" role="group" aria-label="시연 상황">
          <span>상황</span>
          {DEMO_SCENARIOS.map(s => (
            <button key={s.id} aria-pressed={scenarioIds.includes(s.id)} title={s.summary} onClick={() => toggleScenario(s.id)}>
              {s.title}
            </button>
          ))}
          <button className="dfc-reset" onClick={resetAll}>
            <RotateCcw size={13} />
            기준 계획
          </button>
        </div>
      </div>
      {(changes.length > 0 || adopted) && (
        <ul className="dfc-changes" aria-label="반영한 조건">
          {changes.map((c, i) => <li key={i}>{changeText(c)}</li>)}
          {adopted && <li className="dfc-adopted">적용한 대안: {adopted.title}</li>}
        </ul>
      )}

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
          <span>고열량 / 저열량 고갈</span>
          <strong>{dHigh.v}<small> / </small>{dLow.v}</strong>
          <p>탄종별 재고가 바닥나는 날</p>
        </div>
        <div className="dfc-kpi">
          <span>체선 예상</span>
          <strong>{n(k.demurrageDays, 1)}<small>일 · {demVessels}척</small></strong>
          <p>체선료 약 {usd(k.demurrageUsd)} 달러 (일 1.8만 달러 가정)</p>
        </div>
      </div>

      <div className="dfc-grid">
        <div className="dfc-main">
          <Section title="저탄장별 재고일수" note="재고 ÷ 다음 7일 계획 소비량 · 7일 미만 위험, 15일 미만 주의 · 회색 세로선 뒤는 계약 선박이 없어 추가 구매가 필요한 구간">
            <TowerChart option={daysOption} label="저탄장별 재고일수 전망" theme={theme} height={250} />
          </Section>
          <Section title="고·저열량탄 재고와 입하" note="전체 저탄장 합계 · 하역한 물량만 재고에 반영">
            <TowerChart option={stockOption} label="탄종별 재고 전망" theme={theme} height={220} />
          </Section>
        </div>

        <aside className="dfc-assist" aria-label="AI 어시스턴트">
          <h2><Bot size={16} />AI 어시스턴트</h2>
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
            <button onClick={() => interpret()} disabled={!text.trim() || thinking}><Sparkles size={14} />{thinking ? "해석 중…" : "해석"}</button>
            <button onClick={() => runCompare()} disabled={busy}>현재 조건 대안 비교</button>
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
                <button className="dfc-primary" onClick={applyParsed}><Check size={14} />이 조건으로 다시 계산</button>
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
                  <button onClick={() => setAdopted(adopted?.id === a.id ? null : a)}>{adopted?.id === a.id ? "적용 취소" : "이 안으로 보기"}</button>
                </div>
              ))}
              <p className="dfc-note">결정은 담당자가 합니다. 이적 단가 3달러/t, 체선료 일 1.8만 달러는 가정값입니다.</p>
            </div>
          )}
        </aside>
      </div>

      <Section title="부두별 접안 계획" note={`연속 접안 · 교대 ${input.shiftHours}시간 · 회색은 대기, 빨간 테두리는 체선, 빗금은 설비 정지`}>
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
        </div>
      </Section>

      <Section title="선박별 예측" note="ETA·접안·하역 완료 시각은 계산값">
        <div className="dfc-table-wrap">
          <table className="dfc-table">
            <thead>
              <tr><th>선박</th><th>산지</th><th>탄종</th><th>물량(t)</th><th>ETA</th><th>접안</th><th>하역 완료</th><th>부두</th><th>저탄장</th><th>대기</th><th>체선료($)</th><th>상태</th></tr>
            </thead>
            <tbody>
              {shown.map(v => (
                <tr key={v.id} className={v.demurrageHours > 0 ? "dfc-row-dem" : ""}>
                  <td>{v.name}</td>
                  <td>{v.origin}</td>
                  <td>{v.grade === "high" ? "고열량" : "저열량"} {v.cv}</td>
                  <td>{n(v.cargo, 0)}</td>
                  <td>{hourLabel(v.eta)}</td>
                  <td>{hourLabel(v.berthedAt)}</td>
                  <td>{hourLabel(v.finishedAt)}</td>
                  <td>{v.assignedBerth ?? "-"}</td>
                  <td>{v.assignedYard}{v.movedYard && <em className="dfc-moved"> 변경</em>}</td>
                  <td>{v.waitHours > 0 ? `${n(v.waitHours, 0)}h` : "-"}</td>
                  <td>{v.demurrageUsd > 0 ? n(v.demurrageUsd, 0) : "-"}</td>
                  <td><span className={`dfc-state dfc-s-${v.state}`}>{v.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
