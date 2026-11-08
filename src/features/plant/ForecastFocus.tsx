import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, TriangleAlert } from "lucide-react";
import { TowerChart } from "../../components/TowerChart";
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

export function ForecastFocus({ snapshot, theme, onSupplyTarget, onSimulation }: {
  snapshot: PlanningSnapshot;
  theme: string;
  onSupplyTarget: (target: SupplyTarget) => void;
  onSimulation: () => void;
}) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [snapshot.run_id, snapshot.start, snapshot.horizon_days]);
  const rows = snapshot.inventory.daily.length ? snapshot.inventory.daily : snapshot.daily.map(row => ({ day: row.date, groups: {} as PlanningSnapshot['inventory']['daily'][number]['groups'] }));
  const selected = rows[Math.min(index, Math.max(rows.length - 1, 0))];
  const day = selected?.day ?? snapshot.start;
  const daily = forecastDay(snapshot, day);
  const hasStock = rows.some((row) => SUPPLY_GROUPS.some((group) => row.groups[group.id]?.stock != null));
  const issues = snapshot.issues.filter(Boolean);
  const showWarning = snapshot.inventory.plan_stale || snapshot.inventory.groups.some((group) => group.stale);
  const outageCount = fuelMetrics(snapshot).outages;

  return (
    <div className="gf-forecast-focus">
      <section className="gf-forecast-chart" aria-labelledby="gf-forecast-title">
        <header>
          <div><h2 id="gf-forecast-title">{hasStock ? '저탄장 재고 전망' : '일별 발전량 전망'}</h2><p>{hasStock ? '저탄장별 일말 계획 · 음수는 계획상 부족량' : '선택한 발전계획 · 당진 1~10호기 합계'}</p></div>
          <button type="button" className="gf-forecast-link" onClick={() => onSupplyTarget({ section: "forecast", day })}>수급 원장 <ArrowRight size={15} /></button>
        </header>
        {hasStock ? <TowerChart theme={theme} height={225} label="호기군별 일말 재고 전망 톤" option={{
          color: SUPPLY_GROUPS.map((group) => group.color),
          tooltip: { trigger: "axis", confine: true },
          legend: { top: 0, textStyle: { color: theme === "dark" ? "#aaafb9" : "#5a6a80", fontSize: 11 } },
          grid: { left: 60, right: 20, top: 42, bottom: 28 },
          xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => row.day.slice(5)), axisLabel: { color: theme === "dark" ? "#aaafb9" : "#5a6a80" }, axisLine: { lineStyle: { color: theme === "dark" ? "#777d89" : "#9aa8ba" } } },
          yAxis: { type: "value", name: "t", nameTextStyle: { color: theme === "dark" ? "#aaafb9" : "#5a6a80" }, splitLine: { lineStyle: { color: "#88888835" } }, axisLabel: { color: theme === "dark" ? "#aaafb9" : "#5a6a80", formatter: (value: number) => `${Math.round(value / 10000)}만` } },
          series: SUPPLY_GROUPS.map((group, groupIndex) => ({ name: group.name, type: "line", showSymbol: false, connectNulls: false, data: rows.map((row) => row.groups[group.id]?.stock ?? null), lineStyle: { width: 2 }, ...(groupIndex === 0 ? { markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: theme === "dark" ? "#d9e2ff" : "#34465f", type: "dashed", width: 1 }, data: [{ xAxis: day.slice(5) }] } } : {}) })),
        }} /> : snapshot.daily.some(row => row.generation_mwh != null) ? <TowerChart theme={theme} height={225} label="일별 발전량 전망 MWh" option={{
          color: ['#3355d8'], tooltip: { trigger: 'axis', confine: true },
          grid: { left: 65, right: 20, top: 30, bottom: 28 },
          xAxis: { type: 'category', boundaryGap: false, data: snapshot.daily.map(row => row.date.slice(5)) },
          yAxis: { type: 'value', name: 'MWh', splitLine: { lineStyle: { color: '#88888835' } } },
          series: [{ name: '발전 계획', type: 'line', showSymbol: false, connectNulls: false, data: snapshot.daily.map(row => row.generation_mwh ?? null), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 } }],
        }} /> : <div className="gf-forecast-no-data">조회기간 발전계획이 없습니다.</div>}
        <div className="gf-forecast-date">
          <label htmlFor="gf-forecast-day">날짜 선택 <strong>{day}</strong></label>
          <input id="gf-forecast-day" type="range" min={0} max={Math.max(rows.length - 1, 0)} value={Math.min(index, Math.max(rows.length - 1, 0))} disabled={!rows.length} aria-valuetext={day} onChange={(event) => setIndex(Number(event.target.value))} />
          <span>{snapshot.start.slice(5)} <span>{snapshot.end.slice(5)}</span></span>
        </div>
        <div className="gf-forecast-day-values" aria-live="polite">
          <div><span>일말 재고</span><strong>{format(daily.stock)}{daily.stock != null && " t"}</strong></div>
          <div><span>입하 배분</span><strong>{format(daily.receipts)}{daily.receipts != null && " t"}</strong></div>
          <div><span>예상 사용</span><strong>{format(daily.burn)}{daily.burn != null && " t"}</strong></div>
          <div><span>발전 계획</span><strong>{format(daily.generation)}{daily.generation != null && " MWh"}</strong></div>
        </div>
        <p className="gf-forecast-note">저탄장별 값이 하나라도 없으면 전체 합계는 미확정입니다. 입하 배분은 입항 화물량과 다르며, 예상 사용은 혼합 열량 기준입니다.</p>
      </section>
      <aside className="gf-forecast-watch" aria-labelledby="gf-forecast-watch-title">
        <header><h2 id="gf-forecast-watch-title">확인할 변화</h2><span>선택 계획 · {snapshot.horizon_days}일</span></header>
        <div className="gf-forecast-watch-item"><TriangleAlert size={18} aria-hidden="true" /><div><strong>수급 상태 · {({ normal: "정상", caution: "주의", danger: "위험", unknown: "미확정" } as Record<string, string>)[snapshot.inventory.kpis.risk] ?? "미확정"}</strong><p>최소 재고일수 {snapshot.inventory.kpis.min_days == null ? "미확정" : `${snapshot.inventory.kpis.min_days.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}일`}</p><button type="button" className="gf-forecast-link" onClick={() => onSupplyTarget({ section: "forecast" })}>재고일수 확인 <ArrowRight size={14} /></button></div></div>
        <div className="gf-forecast-watch-item"><CalendarClock size={18} aria-hidden="true" /><div><strong>계획정지 일정</strong><p>{outageCount ? `조회기간 일정 ${outageCount}건` : "조회기간 등록 일정 없음 · 원천 자료 확인 필요"}</p><button type="button" className="gf-forecast-link" onClick={() => revealSection("gf-forecast-outages")}>호기별 일정 보기 <ArrowRight size={14} /></button></div></div>
        <div className="gf-forecast-watch-item"><ArrowRight size={18} aria-hidden="true" /><div><strong>대안 비교</strong><p>현재 선택한 저장 계획을 기준으로 검토</p><button type="button" className="gf-forecast-link" onClick={onSimulation}>통합 시뮬레이션 열기 <ArrowRight size={14} /></button></div></div>
        {(showWarning || issues.length > 0) && <div className="gf-forecast-watch-issues"><strong>자료 확인</strong>{showWarning && <p>계획 또는 기준재고의 갱신 확인이 필요합니다.</p>}{issues.slice(0, 2).map((issue, i) => <p key={i}>{sourceDescription(issue)}</p>)}{issues.length > 2 && <button type="button" className="gf-forecast-link" onClick={() => revealSection("gf-forecast-sources")}>확인사항 전체 보기</button>}</div>}
      </aside>
    </div>
  );
}
