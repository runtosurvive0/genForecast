import type { ReactNode } from "react";
import { TowerChart } from "./TowerChart";
import type { PlanningSnapshot } from "../domain/planning";
import { SUPPLY_GROUPS as groups } from "../domain/supply";
import "./supply.css";

const fmt = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const axis = (name: string, extra = {}) => ({
  type: "value",
  name,
  splitLine: { lineStyle: { color: "#88888818" } },
  ...extra,
});
const tooltip = {
  trigger: "axis",
  confine: true,
  valueFormatter: (value: unknown) =>
    typeof value === "number" ? fmt(value, 1) : "미확정",
};
const series = (
  name: string,
  data: (number | null | undefined)[],
  extra = {},
) => ({
  name,
  type: "line",
  showSymbol: false,
  connectNulls: false,
  data: data.map((value) => value ?? null),
  ...extra,
});
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tower-section supply-forecast">
      <header>
        <div>
          <h2>{title}</h2>
        </div>
      </header>
      {children}
    </section>
  );
}
export function SupplyForecasts({
  snapshot: s,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  const has = (field: "stock" | "days") =>
    s.inventory.daily.some((row) =>
      Object.values(row.groups).some((group) => group[field] != null),
    );
  const plot = (field: "stock" | "days") =>
    groups.map((group) =>
      series(
        group.name,
        s.inventory.daily.map((row) => row.groups[group.id]?.[field]),
        { lineStyle: { width: 2 } },
      ),
    );
  const thresholds = s.inventory.thresholds;
  const days = plot("days");
  if (thresholds) {
    days.push(
      series(
        `위험 기준 ${thresholds.danger_days}일`,
        s.inventory.daily.map(() => thresholds.danger_days),
        { lineStyle: { type: "dashed", width: 1, color: "#ed5a69" } },
      ),
    );
    days.push(
      series(
        `안정 기준 ${thresholds.normal_days}일`,
        s.inventory.daily.map(() => thresholds.normal_days),
        { lineStyle: { type: "dashed", width: 1, color: "#30b77b" } },
      ),
    );
  }
  const common = {
    tooltip,
    color: groups.map((group) => group.color),
    legend: {
      top: 0,
      textStyle: {
        fontSize: 9,
        color: theme === "dark" ? "#a6bed7" : "#54677b",
      },
    },
    grid: { left: 45, right: 15, top: 57, bottom: 30 },
    xAxis: {
      type: "category",
      data: s.inventory.daily.map((row) => row.day.slice(5)),
    },
  };
  return (
    <>
      <Panel title={`처별 재고일수 전망 (${s.horizon_days}일)`}>
        {has("days") ? (
          <TowerChart
            theme={theme}
            label="처별 재고일수 전망 일"
            height={225}
            option={{
              ...common,
              aria: {
                enabled: true,
                label: { description: "처별 재고일수 전망 일" },
              },
              yAxis: axis("일"),
              series: days,
            }}
          />
        ) : (
          <div className="midterm-empty">
            재고일수 미확정 · 기준재고와 추가 7일 계획을 확인하세요.
          </div>
        )}
        <p className="tower-footnote">
          일말 재고 ÷ 다음 7일 평균 소비. 계획 누락·소비 0이면 미확정.
        </p>
      </Panel>
      <Panel title={`처별 재고량 전망 (${s.horizon_days}일)`}>
        {has("stock") ? (
          <TowerChart
            theme={theme}
            label="처별 일말 예상 석탄 재고 톤"
            height={225}
            option={{
              ...common,
              aria: {
                enabled: true,
                label: { description: "처별 일말 예상 석탄 재고 톤" },
              },
              yAxis: axis("t", {
                axisLabel: {
                  formatter: (value: number) => `${fmt(value / 10000, 1)}만`,
                },
              }),
              series: plot("stock"),
            }}
          />
        ) : (
          <div className="midterm-empty">
            DB 기준재고 미등록 · 처별 재고전망 표시 보류
          </div>
        )}
        <p className="tower-footnote">
          혼합 발열량 기준 소비 · 음수 재고는 계획상 부족량.
        </p>
      </Panel>
    </>
  );
}
