import type { ReactNode } from "react";
import {
  Factory,
  Ship,
  Anchor,
  Boxes,
  Flame,
  Zap,
  Sun,
  Fuel,
  CalendarDays,
  CircleHelp,
  CircleCheck,
  TriangleAlert,
  ArrowRight,
} from "lucide-react";
import { TowerChart } from "../../components/TowerChart";
import type { PlanningSnapshot } from "../../domain/planning";

const groups = [
  { id: "g14", name: "1~4호기 처", first: 1, last: 4, color: "#248df5" },
  { id: "g58", name: "5~8호기 처", first: 5, last: 8, color: "#eea628" },
  { id: "g910", name: "9~10호기 처", first: 9, last: 10, color: "#30b77b" },
];
const fmt = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const riskNames: Record<string, string> = {
  normal: "정상",
  caution: "주의",
  danger: "위험",
  unknown: "미확정",
};
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
function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`tower-section fuel-panel ${className}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
function NumberWithUnit({
  value,
  unit = "t",
  digits = 0,
}: {
  value: number | null | undefined;
  unit?: string;
  digits?: number;
}) {
  return (
    <>
      {fmt(value, digits)}
      {value != null && <small> {unit}</small>}
    </>
  );
}
function SupplyKpis({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  const k = s.inventory.kpis;
  const firstFuel = s.daily[0]?.fuel_tonnes;
  const RiskIcon =
    k.risk === "normal"
      ? CircleCheck
      : k.risk === "unknown"
        ? CircleHelp
        : TriangleAlert;
  const cards = [
    {
      title: "총 재고",
      icon: Boxes,
      value: k.stock,
      unit: "t",
      note:
        k.stock === null ? "기준재고 미등록" : "조회 시작시각 · DB 수급 원장",
    },
    {
      title: `최소 재고일수 (${s.horizon_days}일)`,
      icon: CalendarDays,
      value: k.min_days,
      unit: "일",
      note: "처별 전망 중 최소값",
      digits: 1,
    },
    {
      title: "하역 잔량",
      icon: Anchor,
      value: k.unloading_remaining,
      unit: "t",
      note: `조회 시작시각 · ${fmt(k.active_vessels)}척 하역 중`,
    },
    {
      title: `입항 예정 (${s.horizon_days}일)`,
      icon: Ship,
      value: k.arrivals,
      unit: "t",
      note: `DB 등록 선박 ${fmt(k.arrival_count)}척 · 화물량 기준`,
    },
    {
      title: "입항탄 평균 열량",
      icon: Flame,
      value: k.incoming_cv,
      unit: "kcal/kg",
      note: "예정 선박 화물량 가중평균",
    },
    {
      title: "조회 첫날 사용계획",
      icon: Fuel,
      value: firstFuel,
      unit: "t",
      note: `${s.start} · 고정 발열량 환산`,
    },
  ];
  return (
    <div className="fuel-supply-kpis">
      <section className={`fuel-supply-kpi fuel-supply-status risk-${k.risk}`}>
        <span>연료수급 상태</span>
        <div>
          <RiskIcon size={35} aria-hidden="true" />
          <strong>{riskNames[k.risk] ?? "미확정"}</strong>
        </div>
        <p>
          {k.risk === "unknown"
            ? "재고·계획 자료와 최신성 확인 필요"
            : "조회기간의 DB 재고전망 기준"}
        </p>
      </section>
      {cards.map((card) => (
        <section
          className="fuel-supply-kpi"
          key={card.title}
          data-fuel-metric={card.title}
        >
          <span>
            <card.icon size={17} aria-hidden="true" />
            {card.title}
          </span>
          <strong>
            <NumberWithUnit
              value={card.value}
              unit={card.unit}
              digits={card.digits}
            />
          </strong>
          <p>{card.note}</p>
        </section>
      ))}
    </div>
  );
}
function Models({
  snapshot: s,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  const first = s.models[0];
  const gw = (value: number | null | undefined) =>
    value == null ? null : value / 1000;
  const solar = s.models.some((row) => row.solar_mw != null);
  const solarEnergy =
    first?.solar_mwh ?? (first?.solar_mw == null ? null : first.solar_mw * 24);
  const modelCards = [
    {
      name: "수요 LightGBM",
      icon: Zap,
      value: gw(first?.demand_peak_mw),
      unit: "GW",
      label: "일 최대수요",
      note: `일평균 ${fmt(gw(first?.demand_mw), 1)} GW`,
    },
    {
      name: "태양광 패턴 전망",
      icon: Sun,
      value: gw(solarEnergy),
      unit: "GWh",
      label: "일 발전량",
      note: "실적 기상·태양광 패턴 재생",
    },
    {
      name: "석탄 ML",
      icon: Boxes,
      value: gw(first?.coal_ml_mw),
      unit: "GW",
      label: "일평균 필요발전량",
      note: `보정 목표 ${fmt(gw(first?.coal_target_mw), 1)} GW`,
    },
    {
      name: "MILP 발전계획",
      icon: Factory,
      value: s.daily[0]?.fuel_tonnes,
      unit: "t",
      label: "첫날 석탄 예정량",
      note: "10개 호기의 고정 발열량 환산",
    },
  ];
  const plots = [
    series(
      "수요 · 일평균",
      s.models.map((row) => gw(row.demand_mw)),
    ),
    series(
      "태양광 · 일평균",
      s.models.map((row) => gw(row.solar_mw)),
      { yAxisIndex: 1, areaStyle: { opacity: 0.12 } },
    ),
    {
      name: "석탄 ML 필요발전량",
      type: "bar",
      yAxisIndex: 1,
      data: s.models.map((row) => gw(row.coal_ml_mw)),
      itemStyle: { opacity: 0.35 },
      barMaxWidth: 16,
    },
    series(
      "석탄 MILP",
      s.models.map((row) => gw(row.coal_mip_mw)),
      { yAxisIndex: 1, lineStyle: { type: "dashed", width: 2 } },
    ),
    series(
      "석탄 가용용량",
      s.models.map((row) => gw(row.coal_available_mw)),
      { yAxisIndex: 1, lineStyle: { type: "dotted", width: 1.5 } },
    ),
  ].filter((entry) => entry.data.some((value) => value != null));
  return (
    <div className="fuel-model-row">
      <Panel
        title={`전력수요·태양광·석탄발전 전망 (${s.horizon_days}일)`}
        note="전국 시간별 전망의 KST 일평균 · 당진 발전소 계획과 구분"
      >
        <TowerChart
          theme={theme}
          label="전국 수요 태양광 및 석탄 ML MILP 가용용량 전망 GW"
          height={285}
          option={{
            aria: {
              enabled: true,
              label: {
                description:
                  "전국 수요 태양광 및 석탄 ML MILP 가용용량 전망 GW",
              },
            },
            tooltip,
            color: [
              "#248df5",
              "#f4b22a",
              "#7190b9",
              theme === "dark" ? "#b4cfff" : "#183568",
              "#30b77b",
            ],
            legend: {
              top: 0,
              type: "plain",
              textStyle: {
                fontSize: 10,
                color: theme === "dark" ? "#a6bed7" : "#54677b",
              },
            },
            grid: { left: 48, right: 44, top: 62, bottom: 32 },
            xAxis: {
              type: "category",
              data: s.models.map((row) => row.day.slice(5)),
            },
            yAxis: [
              axis("수요 · GW", { min: 0 }),
              axis("발전 · GW", { min: 0, position: "right" }),
            ],
            series: plots,
          }}
        />
        {(!solar || s.models.some((row) => row.coal_available_mw === null)) && (
          <p className="tower-footnote">
            {!solar && "태양광 시계열 미보존 · "}
            {s.models.some((row) => row.coal_available_mw === null) &&
              "가용용량 시계열 미보존 · "}
            미보존 항목은 표시 보류
          </p>
        )}
      </Panel>
      <Panel title="예측·최적화 핵심 지표" note={`${s.start} · 조회 첫날 기준`}>
        <div className="fuel-model-cards">
          {modelCards.map((card) => (
            <div key={card.name}>
              <card.icon size={24} aria-hidden="true" />
              <h3>{card.name}</h3>
              <span>{card.label}</span>
              <strong>
                <NumberWithUnit
                  value={card.value}
                  unit={card.unit}
                  digits={card.unit === "t" ? 0 : 1}
                />
              </strong>
              <p>{card.note}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
function GroupCards({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  return (
    <div className="fuel-groups">
      {groups.map((group) => {
        const g = s.inventory.groups.find((item) => item.id === group.id);
        const units = s.units.filter((unit) => {
          const id = Number(unit.unit_id.replace("dj-", ""));
          return group.first <= id && id <= group.last;
        });
        const firstBurn =
          g?.today_burn ?? s.inventory.daily[0]?.groups[group.id]?.burn;
        return (
          <section className="fuel-group" key={group.id}>
            <header>
              <h2>{group.name}</h2>
              <span className={`fuel-risk risk-${g?.risk ?? "unknown"}`}>
                {riskNames[g?.risk ?? "unknown"] ?? "미확정"}
              </span>
            </header>
            <div className="fuel-group-body">
              <div className="fuel-group-primary">
                <div>
                  <span>기준시각 재고</span>
                  <strong>
                    <NumberWithUnit value={g?.stock} />
                  </strong>
                  <p>
                    {g?.baseline
                      ? `등록 기준 ${fmt(g.baseline.tonnes)} t`
                      : "기준재고 미등록"}
                  </p>
                </div>
                <div>
                  <span>재고일수</span>
                  <strong>
                    <NumberWithUnit value={g?.days} unit="일" digits={1} />
                  </strong>
                  <p>최소 {fmt(g?.min_days, 1)}일</p>
                </div>
                <div>
                  <span>저탄장 평균 열량</span>
                  <strong>
                    <NumberWithUnit value={g?.cv} unit="kcal/kg" />
                  </strong>
                </div>
              </div>
              <div className="fuel-group-secondary">
                <div>
                  <span>첫날 예상 사용량</span>
                  <strong>
                    <NumberWithUnit value={firstBurn} />
                  </strong>
                </div>
                <div>
                  <span>입하 배분 ({s.horizon_days}일)</span>
                  <strong>
                    <NumberWithUnit value={g?.expected_receipts} />
                  </strong>
                </div>
                <div>
                  <span>등록 기준 대비</span>
                  <strong>
                    <NumberWithUnit value={g?.delta} />
                  </strong>
                </div>
              </div>
              <h3>호기별 발전계획 및 연료사용량</h3>
              <div className="tower-table-wrap">
                <table className="tower-table fuel-group-table">
                  <thead>
                    <tr>
                      <th>호기</th>
                      <th>이용률 %</th>
                      <th>평균 출력 MW</th>
                      <th>석탄 t/h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((unit) => (
                      <tr key={unit.unit_id} data-unit-id={unit.unit_id}>
                        <td>{unit.unit_id.replace("dj-", "")}호기</td>
                        <td>
                          {unit.capacity_factor_pct !== null && (
                            <span className="fuel-utilization">
                              <span
                                style={{
                                  width: `${Math.max(0, Math.min(100, unit.capacity_factor_pct))}%`,
                                }}
                              />
                            </span>
                          )}
                          {fmt(unit.capacity_factor_pct, 1)}
                        </td>
                        <td>
                          {fmt(
                            unit.generation_mwh === null
                              ? null
                              : unit.generation_mwh / (24 * s.horizon_days),
                            1,
                          )}
                        </td>
                        <td>
                          {fmt(
                            unit.fuel_tonnes === null
                              ? null
                              : unit.fuel_tonnes / (24 * s.horizon_days),
                            1,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tower-footnote">
                {s.horizon_days}일 평균 · 호기별 t/h는{" "}
                {fmt(s.fuel.calorific_kcal_kg)} kcal/kg 고정 기준. 처별 사용량은
                혼합 열량 기준.
              </p>
              {(g?.stale || s.inventory.plan_stale) && (
                <p className="fuel-stale">자료 갱신 확인 필요</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
function Flow({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  const k = s.inventory.kpis;
  return (
    <Panel
      title={`연료수급 흐름도 (${s.horizon_days}일)`}
      note="DB 등록 입항·하역·배분 → 공통 수급 엔진 재고전망 → MILP 연료계획"
    >
      <div className="fuel-flow">
        <div className="fuel-flow-stage">
          <Ship size={34} aria-hidden="true" />
          <h3>입항 예정</h3>
          <strong>
            <NumberWithUnit value={k.arrivals} />
          </strong>
          <span>등록 선박 {fmt(k.arrival_count)}척</span>
        </div>
        <ArrowRight className="fuel-flow-arrow" aria-hidden="true" />
        <div className="fuel-flow-stage">
          <Anchor size={34} aria-hidden="true" />
          <h3>하역 중</h3>
          <strong>
            <NumberWithUnit value={k.unloading_remaining} />
          </strong>
          <span>조회 시작시각 잔량</span>
        </div>
        <ArrowRight className="fuel-flow-arrow" aria-hidden="true" />
        <div className="fuel-flow-stage">
          <h3>처별 입하 배분</h3>
          {groups.map((group) => (
            <p key={group.id}>
              <i style={{ background: group.color }} />
              <span>{group.name}</span>
              <b>
                {fmt(
                  s.inventory.groups.find((item) => item.id === group.id)
                    ?.expected_receipts,
                )}{" "}
                t
              </b>
            </p>
          ))}
        </div>
        <ArrowRight className="fuel-flow-arrow" aria-hidden="true" />
        <div className="fuel-flow-stage">
          <Boxes size={34} aria-hidden="true" />
          <h3>저탄장 재고</h3>
          <strong>
            <NumberWithUnit value={k.stock} />
          </strong>
          <span>조회 시작시각 · DB 기준</span>
        </div>
        <ArrowRight className="fuel-flow-arrow" aria-hidden="true" />
        <div className="fuel-flow-stage">
          <Factory size={34} aria-hidden="true" />
          <h3>발전기 사용계획</h3>
          <strong>
            <NumberWithUnit value={s.daily[0]?.fuel_tonnes} />
          </strong>
          <span>조회 첫날 · 고정 발열량</span>
        </div>
      </div>
      <p className="tower-footnote">
        입항 화물량과 기간 내 하역 배분량은 다릅니다. 이탄·혼합 열량을 반영하는
        DB 수급 엔진을 사용하며, 흐름도 수치를 단순 가감해 재고를 재계산하지
        않습니다.
      </p>
    </Panel>
  );
}
function Forecasts({
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
    <div className="fuel-forecast-row">
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
      <Panel
        title="호기별 이용률·석탄 사용량"
        note={`${s.horizon_days}일 평균`}
      >
        <TowerChart
          theme={theme}
          label="호기별 기간 이용률 퍼센트와 석탄 시간평균 사용량"
          height={225}
          option={{
            ...common,
            aria: {
              enabled: true,
              label: {
                description: "호기별 기간 이용률 퍼센트와 석탄 시간평균 사용량",
              },
            },
            color: ["#248df5", "#f4b22a"],
            grid: { left: 40, right: 38, top: 40, bottom: 30 },
            xAxis: {
              type: "category",
              data: s.units.map(
                (unit) => unit.unit_id.replace("dj-", "") + "호",
              ),
            },
            yAxis: [
              axis("t/h", { min: 0 }),
              axis("%", { min: 0, max: 100, position: "right" }),
            ],
            series: [
              {
                name: "석탄 · t/h",
                type: "bar",
                data: s.units.map((unit) =>
                  unit.fuel_tonnes === null
                    ? null
                    : unit.fuel_tonnes / (24 * s.horizon_days),
                ),
                barMaxWidth: 18,
                itemStyle: { borderRadius: [3, 3, 0, 0] },
              },
              series(
                "이용률 · %",
                s.units.map((unit) => unit.capacity_factor_pct),
                { yAxisIndex: 1 },
              ),
            ],
          }}
        />
      </Panel>
    </div>
  );
}
export function FuelSupplyOverview({
  snapshot,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  return (
    <>
      <header className="fuel-reference-header">
        <div>
          <span className="fuel-company">
            <Factory size={24} aria-hidden="true" />
            한국동서발전
          </span>
          <h2>
            당진본부 연료수급 종합현황 <small>(POC)</small>
          </h2>
        </div>
        <span>조회 기준 {snapshot.start} 00:00 KST</span>
      </header>
      <SupplyKpis snapshot={snapshot} />
      <Models snapshot={snapshot} theme={theme} />
      <GroupCards snapshot={snapshot} />
      <Flow snapshot={snapshot} />
      <Forecasts snapshot={snapshot} theme={theme} />
    </>
  );
}
