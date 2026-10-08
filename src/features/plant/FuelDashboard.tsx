import type { ReactNode } from "react";
import { Fuel, CalendarDays } from "lucide-react";
import { TowerChart } from "../../components/TowerChart";
import type { PlanningSnapshot } from "../../domain/planning";
import { fuelMetrics } from "./fuel-metrics";
import { FuelSupplyOverview } from "./FuelSupplyOverview";
import "./fuel-dashboard.css";

const fmt = (value: number | null, digits = 0) =>
  value === null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const axis = (name: string) => ({
  type: "value",
  name,
  min: 0,
  splitLine: { lineStyle: { color: "#88888818" } },
  axisLabel: {
    formatter: (value: number) =>
      Math.abs(value) >= 10000 ? `${fmt(value / 10000, 1)}만` : fmt(value),
  },
});
const tooltip = {
  trigger: "axis",
  confine: true,
  valueFormatter: (value: unknown) =>
    typeof value === "number" ? fmt(value) : "미확정",
};
function Metric({
  label,
  value,
  unit = "t",
  note,
}: {
  label: string;
  value: number | null;
  unit?: string;
  note: string;
}) {
  return (
    <div className="tower-metric" data-fuel-metric={label}>
      <span>{label}</span>
      <strong>
        {fmt(value, unit === "일" ? 1 : 0)}
        {value !== null && <small>{unit}</small>}
      </strong>
      <p>{note}</p>
    </div>
  );
}

export function FuelDashboard({
  snapshot: s,
  theme,
  children,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
  children: ReactNode;
}) {
  const metrics = fuelMetrics(s);
  const selectedMonth = (month: string) =>
    s.start.slice(0, 7) <= month && month <= s.end.slice(0, 7);

  return (
    <>
      <FuelSupplyOverview snapshot={s} theme={theme} />
      <div className="fuel-basis">
        <div>
          <Fuel size={17} aria-hidden="true" />
          <strong>연료 대시보드</strong>
          <span>당진 1~10호기 · 석탄 사용계획</span>
        </div>
        <div>
          <span className="fuel-assumption">
            {fmt(s.fuel.calorific_kcal_kg)} kcal/kg ·{" "}
            {s.fuel.is_assumption ? "임시 가정" : "등록 기준"}
          </span>
          <span>실적 미연계</span>
        </div>
      </div>
      <div className="tower-kpis midterm-kpis fuel-kpis">
        <Metric
          label="기간 석탄 사용 예정량"
          value={metrics.total}
          note={`${s.horizon_days}일 합계 · ${metrics.completeDays}/${s.horizon_days}일 계획 확보`}
        />
        <Metric
          label="일평균 사용 예정량"
          value={metrics.average}
          unit="t/일"
          note="기간 예정량 ÷ 조회 일수"
        />
        <Metric
          label="최대 일 사용 예정량"
          value={metrics.peak?.fuel_tonnes ?? null}
          note={
            metrics.peak
              ? `${metrics.peak.date} · 조회기간 기준`
              : "일별 계획 누락 · 최대값 판단 보류"
          }
        />
      </div>
      <div className="fuel-chart-layout">
        <section className="tower-section fuel-daily">
          <header>
            <div>
              <h2>일별 석탄 사용계획</h2>
              <p>
                {s.start} ~ {s.end} · KST 00~24시 · MILP 발전계획의 톤 환산
              </p>
            </div>
            <span className="fuel-period-chip">{s.horizon_days}일</span>
          </header>
          {s.daily.some((day) => day.fuel_tonnes !== null) ? (
            <TowerChart
              theme={theme}
              label="당진 일별 석탄 사용 예정량 톤 및 발전량 MWh"
              height={285}
              option={{
                aria: {
                  enabled: true,
                  description:
                    "당진 일별 석탄 사용 예정량 톤 및 발전량 MWh. 누락 날짜는 미확정이며 아래 일별 수치에서 확인할 수 있습니다.",
                },
                tooltip,
                color: ["#49a28f", "#85919e"],
                grid: { left: 56, right: 63, top: 46, bottom: 32 },
                xAxis: {
                  type: "category",
                  data: s.daily.map((day) => day.date.slice(5)),
                },
                yAxis: [
                  axis("석탄 · t"),
                  { ...axis("발전 · MWh"), position: "right" },
                ],
                series: [
                  {
                    name: "석탄 사용 예정량",
                    type: "bar",
                    data: s.daily.map((day) => day.fuel_tonnes),
                    barMaxWidth: 22,
                    itemStyle: { borderRadius: [3, 3, 0, 0] },
                  },
                  {
                    name: "계획 발전량",
                    type: "line",
                    yAxisIndex: 1,
                    showSymbol: false,
                    connectNulls: false,
                    data: s.daily.map((day) => day.generation_mwh),
                    lineStyle: { width: 1.5, type: "dashed" },
                  },
                ],
              }}
            />
          ) : (
            <div className="midterm-empty">
              일별 연료계획 미확정 · 시간별 발전계획을 확인하세요.
            </div>
          )}
          <details className="fuel-records">
            <summary>일별 계획 수치 보기</summary>
            <div className="tower-table-wrap">
              <table className="tower-table">
                <thead>
                  <tr>
                    <th>날짜 · KST</th>
                    <th>석탄 예정량 t</th>
                    <th>계획 발전량 MWh</th>
                  </tr>
                </thead>
                <tbody>
                  {s.daily.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{fmt(day.fuel_tonnes)}</td>
                      <td>{fmt(day.generation_mwh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="tower-section fuel-monthly">
          <header>
            <div>
              <h2>월별 석탄 사용 예정량</h2>
              <p>
                전체 계산기간 {s.run_start} ~ {s.run_end} · 조회기간과 겹치는
                월을 강조
              </p>
            </div>
            <CalendarDays size={17} aria-hidden="true" />
          </header>
          {s.monthly.some((month) => month.fuel_tonnes !== null) ? (
            <TowerChart
              theme={theme}
              label="당진 월별 석탄 사용 예정량 톤"
              height={285}
              option={{
                color: ["#85919e"],
                aria: {
                  enabled: true,
                  description:
                    "당진 월별 석탄 사용 예정량 톤. 전체 계산기간의 월 합계이며 아래 월별 수치에서 확인할 수 있습니다.",
                },
                tooltip,
                grid: { left: 56, right: 20, top: 38, bottom: 32 },
                xAxis: {
                  type: "category",
                  data: s.monthly.map((month) => month.month.slice(2)),
                },
                yAxis: axis("t"),
                series: [
                  {
                    name: "월별 사용 예정량",
                    type: "bar",
                    barMaxWidth: 45,
                    data: s.monthly.map((month) => ({
                      value: month.fuel_tonnes,
                      itemStyle: {
                        color: selectedMonth(month.month)
                          ? "#49a28f"
                          : "#85919e",
                        borderRadius: [4, 4, 0, 0],
                      },
                    })),
                  },
                ],
              }}
            />
          ) : (
            <div className="midterm-empty">
              온전한 월별 연료계획이 없습니다.
            </div>
          )}
          <p className="tower-footnote">
            월 전체 시간계획이 확보된 경우에만 합계를 표시합니다. 조회 일수
            변경은 월 전체 예정량을 바꾸지 않습니다.
          </p>
          <details className="fuel-records">
            <summary>월별 예정량·계획 확보일수 보기</summary>
            <div className="tower-table-wrap">
              <table className="tower-table">
                <thead>
                  <tr>
                    <th>월</th>
                    <th>석탄 예정량 t</th>
                    <th>계획 확보일수</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {s.monthly.map((month) => (
                    <tr
                      key={month.month}
                      className={
                        selectedMonth(month.month) ? "fuel-selected-month" : ""
                      }
                    >
                      <td>{month.month}</td>
                      <td>{fmt(month.fuel_tonnes)}</td>
                      <td>
                        {month.complete_days}/{month.expected_days}일
                      </td>
                      <td>
                        {month.fuel_tonnes === null
                          ? "계획 불완전"
                          : "월 계획 확보"}
                        {selectedMonth(month.month) && " · 조회기간 포함"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
      {children}
    </>
  );
}
