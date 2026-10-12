import { useState } from "react";
import { TowerChart } from "@/components/TowerChart";
import { Section } from "@/components/tower/primitives";
import { axis } from "@/components/tower/chart-options";
import type { simulate } from "@/domain/operations";
import { number as n } from "@/lib/format";
import { YARD_GROUP_IDS, DAYS_THRESHOLDS, type GroupForecast } from "./stockyard-domain";
import type { PlanningSnapshot } from "@/domain/planning";
import { inventoryStatusLabel, sumKnownInventory, type InventoryGroup } from "./supply-view";

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
  planning,
  db = false,
}: {
  theme: string;
  horizon: number;
  forecast: ReturnType<typeof simulate>;
  requested: number[];
  groups: InventoryGroup[];
  /** 이탄 전 처별 전망 (비교 점선). */
  baseline: GroupForecast[];
  transfersActive: boolean;
  onSelectGroup: (group: GroupForecast["group"]) => void;
  planning?: PlanningSnapshot | null;
  db?: boolean;
}) {
  const [mode, setMode] = useState<"groups" | "total">(groups.length > 1 ? "groups" : "total");
  const daily = db ? (groups[0]?.daily.map((row, i) => ({ date: row.date,
    stockTons: sumKnownInventory(groups.map((g) => g.daily[i]?.stockTons)),
    inboundTons: sumKnownInventory(planning?.inventory.daily[i] ? groups.map((g) =>
      g.group.plantId === "dangjin" ? planning.inventory.daily[i].groups[YARD_GROUP_IDS[g.group.yard as keyof typeof YARD_GROUP_IDS]]?.receipts : null) : []),
    fuelUseTons: sumKnownInventory(planning?.inventory.daily[i] ? groups.map((g) =>
      g.group.plantId === "dangjin" ? planning.inventory.daily[i].groups[YARD_GROUP_IDS[g.group.yard as keyof typeof YARD_GROUP_IDS]]?.burn : null) : []),
  })) ?? []) : forecast.daily;
  const round = (value: number | null | undefined) => value == null ? null : Math.round(value);
  const view = groups.length > 1 ? mode : "total";
  return (
    <Section
      title="재고 전망"
      note={db ? `DB 수급 원장 기준 · ${horizon}일 · 재고일수 위험 ${n(planning?.inventory.thresholds?.danger_days)}일 / 주의 ${n(planning?.inventory.thresholds?.normal_days)}일 미만` : `Pile 합계 기준 · 하역 완료일 재고 반영 · ${horizon}일 · 재고일수 위험 ${DAYS_THRESHOLDS.danger}일 / 주의 ${DAYS_THRESHOLDS.normal}일 미만`}
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
                data: g.daily.map((d) => round(d.stockTons)),
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
                data: daily.map((d) => round(d.stockTons)),
                showSymbol: false,
                lineStyle: { width: 2 },
                areaStyle: { opacity: 0.12 },
              },
              {
                name: "입하",
                type: "bar",
                data: daily.map((d) => round(d.inboundTons)),
                barMaxWidth: 10,
              },
              {
                name: "연료 사용",
                type: "line",
                data: daily.map((d) => round(d.fuelUseTons)),
                showSymbol: false,
                lineStyle: { width: 1, type: "dashed" },
              },
              {
                name: "요청 연료",
                type: "line",
                data: db ? planning?.daily.map((d) => round(d.fuel_tonnes)) ?? [] : requested.map((v) => Math.round(v)),
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
                <td>{g.firstShortageDate ? label(g.firstShortageDate) : g.source === "db" && (!g.daily.length || g.daily.some((d) => d.stockTons === null)) ? "미확정" : "없음"}</td>
                <td>
                  <span className={`days-pill is-${g.status}`}>{inventoryStatusLabel(g)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tower-footnote">
        {db ? "DB 혼합 발열량·하역·이탄을 반영한 수급전망 · KST 00~24시. 요청 연료는 고정 발열량 구매계획이며, 일별 입하는 처별 하역 반영량입니다." : <>처별 사용량 = 발전소 계획 연료 × 소속 호기(1~4 / 5~8 / 9~10호기) 계획 발전량 비중. 처별 부족이 없으면 처
        합계는 발전소 전망과 같습니다.{transfersActive ? " 점선은 이탄 적용 전입니다 (모의)." : ""}</>}
      </p>
    </Section>
  );
}
