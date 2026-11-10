import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, TriangleAlert } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { Button } from "../../components/ui/button";
import { SUPPLY_GROUPS, type SupplyTarget } from "../../domain/supply";
import type { PlanningSnapshot } from "../../domain/planning";
import { forecastDay } from "./forecast-day";
import { fuelMetrics } from "./fuel-metrics";
import { sourceDescription } from "../../domain/source-description";
import "./forecast-focus.css";

function revealSection(id: string) {
  const section = document.getElementById(id);
  const details = section instanceof HTMLDetailsElement ? section : section?.querySelector('details');
  if (details) details.open = true;
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const format = (value: number | null | undefined) => value == null ? "미확정" : value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
const AXIS = { tickLine: false, axisLine: false, tickMargin: 8 } as const;
/** 날짜 눈금은 고른 간격(최대 약 12개)으로 띄운다. */
const tickEvery = (count: number) => Math.max(0, Math.ceil(count / 12) - 1);
const label = (day: string) => day.slice(5).replace("-", "/");
/** 저탄장 색은 이 화면 전용 포인트색 계열이다(SUPPLY_GROUPS 색은 다른 화면이 쓴다). */
const STOCK_CONFIG: ChartConfig = Object.fromEntries(SUPPLY_GROUPS.map((group, i) => [group.id, { label: group.name, color: `var(--gf-ov-c${i + 1})` }]));
const GEN_CONFIG: ChartConfig = { generation: { label: "발전 계획", color: "var(--gf-ov-c1)" } };
const DASH = [undefined, undefined, "5 3"];

function TipRow({ config, name, value }: { config: ChartConfig; name: string; value: string }) {
  return <span className="gf-ov-tip"><i style={{ background: `var(--color-${name})` }} /><span>{config[name]?.label ?? name}</span><b>{value}</b></span>;
}

export function ForecastFocus({ snapshot, onSupplyTarget, onSimulation, onPurchasing, lead, trail, assistant }: {
  snapshot: PlanningSnapshot;
  onSupplyTarget: (target: SupplyTarget) => void;
  /** 통합 시뮬레이션 화면 자신에서는 넘기지 않는다(자기 화면을 가리키는 링크 방지). */
  onSimulation?: () => void;
  onPurchasing?: () => void;
  lead?: ReactNode;
  trail?: ReactNode;
  /** 오른쪽 열 맨 위(확인할 변화 위)에 둘 도우미 섹션 */
  assistant?: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [snapshot.run_id, snapshot.start, snapshot.horizon_days]);
  const rows = snapshot.inventory.daily.length ? snapshot.inventory.daily : snapshot.daily.map(row => ({ day: row.date, groups: {} as PlanningSnapshot['inventory']['daily'][number]['groups'] }));
  const last = Math.max(rows.length - 1, 0);
  const position = Math.min(index, last);
  const day = rows[position]?.day ?? snapshot.start;
  const daily = forecastDay(snapshot, day);
  const hasStock = rows.some((row) => SUPPLY_GROUPS.some((group) => row.groups[group.id]?.stock != null));
  const hasGeneration = snapshot.daily.some(row => row.generation_mwh != null);
  const issues = snapshot.issues.filter(Boolean);
  const showWarning = snapshot.inventory.plan_stale || snapshot.inventory.groups.some((group) => group.stale);
  const outageCount = fuelMetrics(snapshot).outages;
  const pick = (state: unknown) => {
    const next = Number((state as { activeTooltipIndex?: unknown } | null)?.activeTooltipIndex);
    if (Number.isFinite(next) && next >= 0) setIndex(Math.min(next, last));
  };
  const stockData = rows.map(row => ({ day: label(row.day), ...Object.fromEntries(SUPPLY_GROUPS.map(group => [group.id, row.groups[group.id]?.stock ?? null])) }));
  const genData = snapshot.daily.map(row => ({ day: label(row.date), generation: row.generation_mwh ?? null }));

  return (
    <div className="gf-forecast-focus">
      <div className="gf-forecast-main">
        {lead}
        <section className="gf-forecast-chart" aria-labelledby="gf-forecast-title">
          <header>
            <div><h2 id="gf-forecast-title">{hasStock ? '저탄장 재고 전망' : '일별 발전량 전망'}</h2><p>{hasStock ? '저탄장별 당일 마감 계획 · 음수는 계획상 부족량' : '선택한 발전계획 · 당진 1~10호기 합계'} · 차트를 눌러 날짜 선택</p></div>
            <button type="button" className="gf-forecast-link" onClick={() => onSupplyTarget({ section: "forecast", day })}>수급 원장 <ArrowRight size={15} /></button>
          </header>
          {hasStock ? <ChartContainer config={STOCK_CONFIG} className="gf-ov-chart" aria-label="호기군별 당일 마감 재고 전망 톤">
            <LineChart data={stockData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={pick}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" {...AXIS} interval={tickEvery(stockData.length)} />
              <YAxis {...AXIS} width={44} tickFormatter={(v: number) => `${Math.round(v / 10000)}만`} />
              <ReferenceLine y={0} className="gf-ov-ref-zero" />
              <ReferenceLine x={label(day)} className="gf-ov-ref-day" strokeDasharray="4 4" />
              <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => <TipRow config={STOCK_CONFIG} name={String(name)} value={`${format(Number(v))} t`} />} />} />
              <ChartLegend verticalAlign="top" content={<ChartLegendContent className="gf-ov-legend" />} />
              {SUPPLY_GROUPS.map((group, i) => <Line key={group.id} dataKey={group.id} type="monotone" stroke={`var(--color-${group.id})`} strokeWidth={i === 0 ? 2.25 : 1.75} strokeDasharray={DASH[i]} dot={false} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ChartContainer> : hasGeneration ? <ChartContainer config={GEN_CONFIG} className="gf-ov-chart" aria-label="일별 발전량 전망 MWh">
            <AreaChart data={genData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} onClick={pick}>
              <defs><linearGradient id="gf-ov-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-generation)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--color-generation)" stopOpacity={0.04} /></linearGradient></defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" {...AXIS} interval={tickEvery(genData.length)} />
              <YAxis {...AXIS} width={52} tickFormatter={(v: number) => `${format(v / 1000)}k`} />
              <ReferenceLine x={label(day)} className="gf-ov-ref-day" strokeDasharray="4 4" />
              <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v, name) => <TipRow config={GEN_CONFIG} name={String(name)} value={`${format(Number(v))} MWh`} />} />} />
              <Area dataKey="generation" type="monotone" stroke="var(--color-generation)" strokeWidth={2.25} fill="url(#gf-ov-fill)" connectNulls={false} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer> : <div className="gf-forecast-no-data">조회기간 발전계획이 없습니다.</div>}
          <div className="gf-forecast-date">
            <label htmlFor="gf-forecast-day">날짜 선택 <strong>{day}</strong></label>
            <input id="gf-forecast-day" type="range" min={0} max={last} value={position} disabled={!rows.length} aria-valuetext={day} onChange={(event) => setIndex(Number(event.target.value))} />
          </div>
          <div className="gf-forecast-day-values" aria-live="polite">
            <div><span>당일 마감 재고</span><strong>{format(daily.stock)}{daily.stock != null && " t"}</strong></div>
            <div><span>입하 배분</span><strong>{format(daily.receipts)}{daily.receipts != null && " t"}</strong></div>
            <div><span>예상 사용</span><strong>{format(daily.burn)}{daily.burn != null && " t"}</strong></div>
            <div><span>발전 계획</span><strong>{format(daily.generation)}{daily.generation != null && " MWh"}</strong></div>
          </div>
        </section>
        {trail}
      </div>
      <div className="gf-forecast-side">
      {assistant}
      <aside className="gf-forecast-watch" aria-labelledby="gf-forecast-watch-title">
        <header><h2 id="gf-forecast-watch-title">확인할 변화</h2><span>선택 계획 · {snapshot.horizon_days}일</span></header>
        <div className="gf-forecast-watch-item"><TriangleAlert size={18} aria-hidden="true" /><div><strong>수급 상태 · {({ normal: "정상", caution: "주의", danger: "위험", unknown: "미확정" } as Record<string, string>)[snapshot.inventory.kpis.risk] ?? "미확정"}</strong><p>최소 재고일수 {snapshot.inventory.kpis.min_days == null ? "미확정" : `${snapshot.inventory.kpis.min_days.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일`}</p><button type="button" className="gf-forecast-link" onClick={() => onSupplyTarget({ section: "forecast" })}>재고일수 확인 <ArrowRight size={14} /></button></div></div>
        <div className="gf-forecast-watch-item"><CalendarClock size={18} aria-hidden="true" /><div><strong>계획정지 일정</strong><p>{outageCount ? `조회기간 일정 ${outageCount}건` : "조회기간 등록 일정 없음 · 원천 자료 확인 필요"}</p><button type="button" className="gf-forecast-link" onClick={() => revealSection("gf-forecast-outages")}>호기별 일정 보기 <ArrowRight size={14} /></button></div></div>
        {onSimulation && <div className="gf-forecast-watch-item"><ArrowRight size={18} aria-hidden="true" /><div><strong>대안 비교</strong><p>현재 선택한 저장 계획을 기준으로 검토</p><button type="button" className="gf-forecast-link" onClick={onSimulation}>통합 시뮬레이션 열기 <ArrowRight size={14} /></button></div></div>}
        {(showWarning || issues.length > 0) && <div className="gf-forecast-watch-issues"><strong>자료 확인</strong>{showWarning && <p>계획 또는 기준재고의 갱신 확인이 필요합니다.</p>}{issues.slice(0, 2).map((issue, i) => <p key={i}>{sourceDescription(issue)}</p>)}{issues.length > 2 && <button type="button" className="gf-forecast-link" onClick={() => revealSection("gf-forecast-sources")}>확인사항 전체 보기</button>}</div>}
        <p className="gf-forecast-note">저탄장별 값이 하나라도 없으면 전체 합계는 미확정입니다. 입하 배분은 입항 화물량과 다르며, 예상 사용은 혼합 열량 기준입니다.</p>
        {onPurchasing && <Button className="gf-forecast-purchase" onClick={onPurchasing}>부족 시점·반입 가능 여부 검토 <ArrowRight size={15} /></Button>}
      </aside>
      </div>
    </div>
  );
}
