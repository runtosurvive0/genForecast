import { useState } from "react";
import { TowerChart } from "@/components/TowerChart";
import { Section } from "@/components/tower/primitives";
import { axis } from "@/components/tower/chart-options";
import type { simulate } from "@/domain/operations";
import { number as n } from "@/lib/format";
import { DAYS_STATUS_LABEL, DAYS_THRESHOLDS, type GroupForecast } from "./stockyard-domain";

const label = (date: string) => date.slice(5).replace("-", "/");

/** 재고 전망: 처별(적층) 또는 합계. 처별 표는 재고일수 상태를 함께 보여준다. */
export function YardForecast({
  theme,
  horizon,
  forecast,
  requested,
  groups,
  baseline,
  transfersActive,
  onSelectGroup,
}: {
  theme: string;
  horizon: number;
  forecast: ReturnType<typeof simulate>;
  requested: number[];
  groups: GroupForecast[];
  /** 이탄 전 처별 전망 (비교 점선). */
  baseline: GroupForecast[];
  transfersActive: boolean;
  onSelectGroup: (group: GroupForecast["group"]) => void;
}) {
  const [mode, setMode] = useState<"groups" | "total">(groups.length > 1 ? "groups" : "total");
  const daily = forecast.daily;
  const view = groups.length > 1 ? mode : "total";
  return (
    <Section
      title="재고 전망"
      note={`Pile 합계 기준 · 하역 완료일 재고 반영 · ${horizon}일 · 재고일수 위험 ${DAYS_THRESHOLDS.danger}일 / 주의 ${DAYS_THRESHOLDS.normal}일 미만`}
      action={
        groups.length > 1 ? (
          <div className="stockyard-segment" role="group" aria-label="전망 단위">
            <button aria-pressed={view === "groups"} onClick={() => setMode("groups")}>
              처별
            </button>
            <button aria-pressed={view === "total"} onClick={() => setMode("total")}>
              합계
            </button>
          </div>
        ) : undefined
      }
    >
      {view === "groups" ? (
        <TowerChart
          theme={theme}
          label="처별 일별 재고 전망 (적층)"
          option={{
            tooltip: { trigger: "axis" },
            legend: { bottom: 0, top: "auto" },
            grid: { top: 24, right: 16, bottom: 48, left: 52 },
            xAxis: { type: "category", data: daily.map((d) => label(d.date)) },
            yAxis: axis("t"),
            series: [
              ...groups.map((g) => ({
                name: g.group.label,
                type: "line",
                stack: "stock",
                showSymbol: false,
                lineStyle: { width: 1 },
                areaStyle: { opacity: 0.35 },
                data: g.daily.map((d) => Math.round(d.stockTons)),
              })),
              ...(transfersActive
                ? baseline
                    .filter((g) => g.group.yard)
                    .map((g) => ({
                      name: `${g.group.label} 이탄 전`,
                      type: "line",
                      showSymbol: false,
                      lineStyle: { width: 1, type: "dashed" },
                      data: g.daily.map((d) => Math.round(d.stockTons)),
                    }))
                : []),
            ],
          }}
        />
      ) : (
        <TowerChart
          theme={theme}
          label="저탄장 일별 재고 전망"
          option={{
            tooltip: { trigger: "axis" },
            legend: { bottom: 0, top: "auto" },
            grid: { top: 24, right: 16, bottom: 48, left: 52 },
            xAxis: { type: "category", data: daily.map((d) => label(d.date)) },
            yAxis: axis("t"),
            series: [
              {
                name: "재고",
                type: "line",
                data: daily.map((d) => Math.round(d.stockTons)),
                showSymbol: false,
                lineStyle: { width: 2 },
                areaStyle: { opacity: 0.12 },
              },
              {
                name: "입하",
                type: "bar",
                data: daily.map((d) => Math.round(d.inboundTons)),
                barMaxWidth: 10,
              },
              {
                name: "연료 사용",
                type: "line",
                data: daily.map((d) => Math.round(d.fuelUseTons)),
                showSymbol: false,
                lineStyle: { width: 1, type: "dashed" },
              },
              {
                name: "요청 연료",
                type: "line",
                data: requested.map((v) => Math.round(v)),
                showSymbol: false,
                lineStyle: { width: 1, type: "dotted" },
              },
            ],
          }}
        />
      )}
      <div className="tower-table-wrap">
        <table className="tower-table stockyard-groups">
          <thead>
            <tr>
              {["처 · 발전소", "현재 재고 · t", "재고일수", "기간 최저", "소진 예상", "상태"].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group.id}>
                <td>
                  <button onClick={() => onSelectGroup(g.group)}>{g.group.label}</button>
                </td>
                <td>{n(g.currentTons)}</td>
                <td>{g.currentDays === null ? "-" : `${n(g.currentDays, 1)}일`}</td>
                <td>{g.minDays ? `${n(g.minDays.days, 1)}일 · ${label(g.minDays.date)}` : "-"}</td>
                <td>{g.firstShortageDate ? label(g.firstShortageDate) : "없음"}</td>
                <td>
                  <span className={`days-pill is-${g.status}`}>{DAYS_STATUS_LABEL[g.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tower-footnote">
        처별 사용량 = 발전소 계획 연료 × 소속 호기(1~4 / 5~8 / 9~10호기) 계획 발전량 비중. 처별 부족이 없으면 처
        합계는 발전소 전망과 같습니다.{transfersActive ? " 점선은 이탄 적용 전입니다 (모의)." : ""}
      </p>
    </Section>
  );
}
