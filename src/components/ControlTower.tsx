import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  FlaskConical,
  RefreshCw,
} from "lucide-react";
import { Button } from "./ui/button";
import { TowerChart } from "./TowerChart";
import { VesselMap } from "./VesselMap";
import { ProcessingOrb } from "./ProcessingOrb";
import { stockpiles, voyages } from "../data/control-tower";
import {
  freshness,
  inventoryStatus,
  pileRisk,
  voyageTiming,
  weightedCalorific,
  type TowerSummary,
} from "../domain/control-tower";
import { fitModels, type ModelRuns } from "../domain/models";
import { apiContract } from "../domain/contracts";
import {
  BASE_TIME,
  shipments,
  type Plant,
  type Scenario,
} from "../domain/operations";
import { number as n, date as fmtDate } from "../lib/format";
import "./control-tower.css";

function Section({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="tower-section">
      <header>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="tower-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {note && <p>{note}</p>}
    </div>
  );
}
const axis = (name: string) => ({
  type: "value",
  name,
  nameTextStyle: { fontSize: 10 },
  splitLine: { lineStyle: { color: "#88888818" } },
  axisLabel: {
    formatter: (v: number) =>
      Math.abs(v) >= 1000 ? `${n(v / 1000, 0)}k` : n(v, 0),
  },
});
const line = (name: string, data: (number | null)[], extra = {}) => ({
  name,
  type: "line",
  data,
  showSymbol: false,
  lineStyle: { width: 2 },
  ...extra,
});
const labelDay = (value: string) => value.slice(5).replace("-", "/");

export function PlantOverview({
  summary,
  plants,
  models,
  theme,
  onSchedule,
  onScenario,
  onPlant,
}: {
  summary: TowerSummary;
  plants: Plant[];
  models: ModelRuns;
  theme: string;
  onSchedule: () => void;
  onScenario: () => void;
  onPlant: (id: string) => void;
}) {
  const s = summary;
  const outages = plants
    .flatMap((p) =>
      p.units.flatMap((u) => u.outages.map((o) => ({ ...o, unit: u.name }))),
    )
    .filter((o) => Date.parse(o.endAt) > Date.parse(BASE_TIME))
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const next = outages.find(
    (o) => Date.parse(o.startAt) > Date.parse(BASE_TIME),
  );
  const monthly = Object.values(
    s.daily.reduce<
      Record<
        string,
        { month: string; inbound: number; fuel: number; stock: number }
      >
    >((acc, d) => {
      const month = d.date.slice(0, 7);
      const row = acc[month] ?? { month, inbound: 0, fuel: 0, stock: 0 };
      row.inbound += d.inbound;
      row.fuel += d.fuel;
      row.stock = d.stock;
      acc[month] = row;
      return acc;
    }, {}),
  );
  const chart = useMemo(
    () => ({
      xAxis: {
        type: "category",
        data: s.daily.map((d) =>
          labelDay(
            new Date(Date.parse(d.date) + 86400000).toISOString().slice(0, 10),
          ),
        ),
        boundaryGap: false,
      },
      yAxis: [axis("재고 · t"), { ...axis("일별 · t"), position: "right" }],
      series: [
        line(
          "예상 재고",
          s.daily.map((d) => d.stock),
          { areaStyle: { opacity: 0.06 } },
        ),
        {
          name: "입하량",
          type: "bar",
          yAxisIndex: 1,
          data: s.daily.map((d) => d.inbound),
          barMaxWidth: 12,
        },
        line(
          "예상 연료사용",
          s.daily.map((d) => d.requestedFuel),
          { yAxisIndex: 1, lineStyle: { width: 1.5, type: "dashed" } },
        ),
      ],
      grid: { left: 64, right: 60, top: 45, bottom: 32 },
    }),
    [s],
  );
  return (
    <div className="tower-page">
      <div className="tower-context">
        <span>
          <i />
          SYNTHETIC DATA · 기준 {fmtDate(BASE_TIME, true)}
        </span>
        <div>
          <Button variant="outline" size="sm" onClick={onSchedule}>
            <CalendarClock size={14} />
            정지계획
          </Button>
        </div>
      </div>
      <div className="tower-kpis">
        <Metric
          label="현재 재고"
          value={n(s.currentStock)}
          unit="t"
          note="저탄장 Pile 합계"
        />
        <Metric
          label="현재 재고일수"
          value={s.coverageDays === null ? "—" : n(s.coverageDays, 1)}
          unit="일"
          note={inventoryStatus(s.coverageDays) + " · 첫날 예상 사용량 기준"}
        />
        <Metric
          label="기간 내 입하 예정"
          value={n(s.incomingTons)}
          unit="t"
          note="취소 제외 · 하역 완료 기준"
        />
        <Metric
          label="재고 가중평균 열량"
          value={n(s.currentCv ?? 0)}
          unit="kcal/kg"
          note="Pile별 중량 가중"
        />
        <Metric
          label="입하탄 가중평균 열량"
          value={s.incomingCv === null ? "—" : n(s.incomingCv)}
          unit="kcal/kg"
          note="선택 기간 내 화물 기준"
        />
        <Metric
          label="현재 평균 이용률"
          value={n(s.currentUtilization, 1)}
          unit="%"
          note="호기 평균 · 정지 호기 포함"
        />
        <Metric
          label="7일 예상 평균 이용률"
          value={n(s.futureUtilization, 1)}
          unit="%"
          note="가동 가능 시간 기준 · 모델 연계"
        />
        <Metric
          label="일일 예상 연료사용량"
          value={n(s.dailyFuel)}
          unit="t/day"
          note="첫날 계획 발전량 → 연료 환산"
        />
        <Metric
          label="최저 예상 재고일수"
          value={s.minimum ? n(s.minimum.inventoryDays!, 1) : "—"}
          unit="일"
          note={
            s.minimum
              ? `${new Date(Date.parse(s.minimum.date) + 86400000).toISOString().slice(0, 10)} 09:00 · 이후 7일 기준`
              : "소비 계획 없음"
          }
        />
      </div>
      <div className="tower-signal">
        <div>
          <span>현재 재고로 발전 가능</span>
          <strong>
            {n(s.forecast.availableEnergyGwh, 1)} <small>GWh</small>
          </strong>
        </div>
        <div>
          <span>첫 연료 부족 예상</span>
          <strong>
            {s.forecast.firstShortageAt
              ? fmtDate(s.forecast.firstShortageAt, true)
              : "기간 내 없음"}
          </strong>
        </div>
        <div>
          <span>다음 계획정지</span>
          <strong>
            {next
              ? `${next.unit} · ${fmtDate(next.startAt, true)}`
              : "기간 내 없음"}
          </strong>
        </div>
      </div>
      <Section
        title="연료 수급 전망"
        note="가로축: 다음날 09:00 KST 기말 재고 · 입하/사용: 직전 24시간 집계 · 재고 = 전일 재고 + 하역 완료량 − 실제 사용량"
      >
        <TowerChart
          option={chart}
          theme={theme}
          label="선택 기간의 예상 재고, 입하량, 일별 계획 연료사용량"
          height={290}
        />
        <p className="tower-footnote">
          재고가 소진되면 실제 발전과 사용량은 제한됩니다. 점선은 공급 부족과
          무관한 계획 연료수요입니다.
        </p>
      </Section>
      <div className="tower-two">
        <Section
          title="발전소별 재고"
          note="발전소 간 재고를 공유하지 않습니다"
        >
          <div className="tower-table-wrap">
            <table className="tower-table">
              <thead>
                <tr>
                  <th>발전소</th>
                  <th>재고 · t</th>
                  <th>입하 · t</th>
                  <th>재고일수</th>
                </tr>
              </thead>
              <tbody>
                {s.forecast.byPlant.map((p) => {
                  const incoming = s.daily.length
                    ? s.forecast.byPlant
                        .find((x) => x.plantId === p.plantId)!
                        .daily.reduce((a, d) => a + d.inboundTons, 0)
                    : 0;
                  const days = p.daily[0]?.requestedFuelTons
                    ? p.inventoryTons / p.daily[0].requestedFuelTons
                    : null;
                  return (
                    <tr key={p.plantId}>
                      <td>
                        <button onClick={() => onPlant(p.plantId)}>
                          {p.name}
                          <ArrowRight size={12} />
                        </button>
                      </td>
                      <td>{n(p.inventoryTons)}</td>
                      <td>{n(incoming)}</td>
                      <td>
                        <span
                          className={`tower-status ${inventoryStatus(days) === "위험" ? "risk" : ""}`}
                        >
                          {days === null ? "—" : n(days, 1) + "일"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
        <Section
          title="호기별 이용률"
          note="현재 / 향후 7일 · 정비 시간 제외 후 예측 이용률 산정"
        >
          <TowerChart
            theme={theme}
            label="호기별 현재 및 7일 예측 이용률 비교"
            option={{
              grid: { left: 82, right: 28, top: 30, bottom: 25 },
              xAxis: { ...axis("%"), max: 100 },
              yAxis: {
                type: "category",
                data: s.units.map((u) => u.name),
                axisLabel: { fontSize: 10 },
              },
              series: [
                {
                  name: "현재",
                  type: "bar",
                  data: s.units.map((u) => u.currentUtilization),
                  barMaxWidth: 7,
                },
                {
                  name: "7일 예측",
                  type: "bar",
                  data: s.units.map((u) => u.futureUtilization),
                  barMaxWidth: 7,
                },
              ],
            }}
          />
        </Section>
      </div>
      <Section
        title="월별 수급 집계"
        note="선택한 전망 기간에 포함된 일자만 합산 · 월 경계는 일별 구간 시작일 기준"
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>월</th>
                <th>입하량 · t</th>
                <th>실제 사용량 · t</th>
                <th>기간 말 재고 · t</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{n(m.inbound)}</td>
                  <td>{n(m.fuel)}</td>
                  <td>{n(m.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="호기별 발전·연료 계획"
        note="향후 7일 계획값 · 정비 반영 / 연료 부족 전 계획수요"
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>호기</th>
                <th>현재 발전 · MW</th>
                <th>7일 발전 · MWh</th>
                <th>7일 연료수요 · t</th>
                <th>가동 가능 · h</th>
              </tr>
            </thead>
            <tbody>
              {s.units.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{n(u.currentGenerationMw)}</td>
                  <td>{n(u.forecastGenerationMwh)}</td>
                  <td>{n(u.forecastFuelTons)}</td>
                  <td>{u.availableHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="tower-two">
        <ModelCard model={models.demand} theme={theme} />
        <ModelCard model={models.capacity} theme={theme} />
      </div>
    </div>
  );
}

export function Stockyard({
  plants,
  theme,
}: {
  plants: Plant[];
  theme: string;
}) {
  const piles = stockpiles.filter((p) =>
    plants.some((x) => x.id === p.plant_id),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active = piles.find((p) => p.stockpile_id === selected) ?? piles[0];
  const total = piles.reduce((s, p) => s + p.on_hand_t, 0);
  const mix = Object.entries(
    piles.reduce<Record<string, number>>(
      (acc, p) => ({
        ...acc,
        [p.coal_type]: (acc[p.coal_type] ?? 0) + p.on_hand_t,
      }),
      {},
    ),
  );
  return (
    <div className="tower-page">
      <div className="tower-kpis tower-kpis-six">
        <Metric label="총 저탄량" value={n(total)} unit="t" />
        <Metric label="운영 Pile" value={piles.length} unit="개" />
        <Metric
          label="가중평균 열량"
          value={n(
            weightedCalorific(
              piles.map((p) => ({
                tons: p.on_hand_t,
                cv: p.calorific_value_kcal_kg,
              })),
            ) ?? 0,
          )}
          unit="kcal/kg"
        />
        <Metric
          label="최장 적치"
          value={Math.max(...piles.map((p) => pileRisk(p).age))}
          unit="일"
        />
        <Metric
          label="고위험 Pile"
          value={piles.filter((p) => pileRisk(p).score >= 70).length}
          unit="개"
          note="모의 위험도"
        />
        <Metric
          label="탄종 구성"
          value={mix.length}
          unit="종"
          note="재고 중량 기준"
        />
      </div>
      <Section
        title="저탄장 배치"
        note="면적은 재고량 비례 · Pile을 선택하면 탄질과 투입 가능 호기를 확인할 수 있습니다"
        action={<span className="tower-tag">SIMULATED RISK</span>}
      >
        <div className="yard-flow">
          {[
            "연료부두",
            "컨베이어",
            "스태커",
            "저탄 Pile",
            "리클레이머",
            "발전호기",
          ].map((x, i) => (
            <span key={x}>
              {x}
              {i < 5 && <ArrowRight size={14} />}
            </span>
          ))}
        </div>
        <div className="yard-map">
          {plants.map((p) => (
            <div key={p.id} className="yard-plant">
              <span>{p.name}</span>
              <div className="yard-piles">
                {piles
                  .filter((x) => x.plant_id === p.id)
                  .map((pile) => {
                    const risk = pileRisk(pile);
                    return (
                      <button
                        key={pile.stockpile_id}
                        onClick={() => setSelected(pile.stockpile_id)}
                        aria-pressed={
                          active?.stockpile_id === pile.stockpile_id
                        }
                        className={`yard-pile risk-${risk.label === "높음" ? "high" : risk.label === "관찰" ? "medium" : "low"}`}
                        style={{ flexGrow: pile.on_hand_t, flexBasis: 0 }}
                      >
                        <strong>{pile.stockpile_id}</strong>
                        <span>{n(pile.on_hand_t)} t</span>
                        <small>
                          {risk.age}일 · {risk.label}
                        </small>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        <p className="tower-footnote">
          위험도는 적치기간과 탄종으로 계산한 모의 점수입니다. 온도·CO 센서
          데이터는 연결되지 않았습니다.
        </p>
      </Section>
      {active && (
        <Section
          title={`${active.stockpile_id} · ${active.coal_type}`}
          note={`적치일 ${fmtDate(active.stacked_at)} · ${pileRisk(active).age}일 경과`}
        >
          <dl className="tower-details">
            {[
              ["재고", n(active.on_hand_t) + " t"],
              ["발열량", n(active.calorific_value_kcal_kg) + " kcal/kg"],
              ["수분", active.moisture_pct + " %"],
              ["회분", active.ash_pct + " %"],
              ["황분", active.sulfur_pct + " %"],
              ["위험도", pileRisk(active).score + "/100 · SIMULATED"],
              ["온도", "미연결"],
              ["CO", "미연결"],
              [
                "투입 가능 호기",
                plants
                  .flatMap((p) => p.units)
                  .filter((u) => active.eligible_unit_ids.includes(u.id))
                  .map((u) => u.name)
                  .join(", "),
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
      <div className="tower-two">
        <Section title="탄종별 재고 구성">
          <TowerChart
            theme={theme}
            label="탄종별 재고 중량 비율"
            option={{
              tooltip: { trigger: "item", formatter: "{b}: {c} t ({d}%)" },
              legend: { bottom: 0, top: "auto" },
              series: [
                {
                  type: "pie",
                  radius: ["46%", "72%"],
                  center: ["50%", "43%"],
                  label: { show: false },
                  data: mix.map(([name, value]) => ({ name, value })),
                },
              ],
            }}
          />
        </Section>
        <Section
          title="적치기간과 모의 위험도"
          note="점의 크기 = 재고량 · 온도 센서 기반 위험 예측이 아닙니다"
        >
          <TowerChart
            theme={theme}
            label="Pile 적치일수와 위험 점수 산점도"
            option={{
              tooltip: {
                trigger: "item",
                formatter: (p: any) =>
                  `${p.name} · ${p.value[0]}일 · ${p.value[1]}점`,
              },
              xAxis: { ...axis("적치일"), max: 90 },
              yAxis: { ...axis("점수"), max: 100 },
              series: [
                {
                  type: "scatter",
                  data: piles.map((p) => ({
                    name: p.stockpile_id,
                    value: [pileRisk(p).age, pileRisk(p).score, p.on_hand_t],
                  })),
                  symbolSize: (v: number[]) =>
                    Math.max(8, Math.sqrt(v[2]) / 12),
                },
              ],
            }}
          />
        </Section>
      </div>
      <Section title="전체 Pile 원장">
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                {[
                  "Pile / 발전소",
                  "탄종",
                  "재고 · t",
                  "열량 · kcal/kg",
                  "수분 / 회분 / 황분 · %",
                  "적치 · 일",
                  "위험도",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {piles.map((p) => (
                <tr key={p.stockpile_id}>
                  <td>
                    <button onClick={() => setSelected(p.stockpile_id)}>
                      {p.stockpile_id} /{" "}
                      {plants.find((x) => x.id === p.plant_id)?.name}
                    </button>
                  </td>
                  <td>{p.coal_type}</td>
                  <td>{n(p.on_hand_t)}</td>
                  <td>{n(p.calorific_value_kcal_kg)}</td>
                  <td>
                    {p.moisture_pct} / {p.ash_pct} / {p.sulfur_pct}
                  </td>
                  <td>{pileRisk(p).age}</td>
                  <td>
                    {pileRisk(p).label} · {pileRisk(p).score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

export function VesselTracking({
  plants,
  theme,
  scenario,
  selectedId,
  onSelect,
  onPlant,
}: {
  plants: Plant[];
  theme: "light" | "dark";
  scenario: Scenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlant: (id: string) => void;
}) {
  const scoped = voyages.filter((v) =>
    plants.some((p) => p.id === v.destination_plant_id),
  );
  const selected = scoped.find((v) => v.voyage_id === selectedId) ?? scoped[0];
  const [now, setNow] = useState(Date.now());
  const activeShipments = shipments
    .filter((v) => plants.some((p) => p.id === v.plantId))
    .map((s) => {
      const v = voyages.find((v) => v.voyage_id === s.id)!;
      const timing = voyageTiming(v, scenario.arrivalDelayDays);
      return {
        ...s,
        arrivalAt: timing.eta,
        dischargeCompleteAt: timing.unload,
      };
    });
  const timing = selected
    ? voyageTiming(selected, scenario.arrivalDelayDays)
    : null;
  return (
    <div className="tower-page">
      <div className="tower-context">
        <span>
          더미 AIS · 수신시각 {fmtDate(BASE_TIME, true)} 전후의 고정 표본
        </span>
        <Button variant="outline" size="sm" onClick={() => setNow(Date.now())}>
          <RefreshCw size={13} />
          최신성 재평가
        </Button>
      </div>
      <VesselMap
        shipments={activeShipments}
        plants={plants}
        selectedVesselId={selected?.voyage_id ?? null}
        onSelect={onSelect}
        theme={theme}
      />
      <div className="tower-footnote">
        실시간 연결 없음 · 최신성은 현재 시각과 비교합니다. 지도 좌표는 마지막
        더미 수신 위치이며 추정 이동을 표시하지 않습니다.
      </div>
      <div className="vessel-cargo-list">
        {scoped.map((v) => (
          <button
            key={v.voyage_id}
            className={`shipment-card ${selected?.voyage_id === v.voyage_id ? "selected" : ""}`}
            aria-pressed={selected?.voyage_id === v.voyage_id}
            onClick={() => onSelect(v.voyage_id)}
          >
            <span className="tower-tag">{freshness(v.received_at, now)}</span>
            <strong>{v.vessel_name}</strong>
            <span>
              {v.origin_port} → {v.destination_port}
            </span>
            <b>
              {n(v.cargo_t)} t{" "}
              <small>· {n(v.calorific_value_kcal_kg)} kcal/kg</small>
            </b>
          </button>
        ))}
      </div>
      {selected && timing && (
        <Section
          title={selected.vessel_name + " · 항차 상세"}
          note="식별자·좌표·탄질·비용은 모두 시연용 데이터"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPlant(selected.destination_plant_id)}
            >
              발전 영향 보기
              <ArrowRight size={14} />
            </Button>
          }
        >
          <dl className="tower-details">
            {[
              ["MMSI / IMO", selected.mmsi + " / " + selected.imo],
              [
                "좌표",
                selected.latitude.toFixed(3) +
                  "°, " +
                  selected.longitude.toFixed(3) +
                  "°",
              ],
              [
                "SOG / COG",
                selected.sog_kn + " kn / " + selected.cog_deg + "°",
              ],
              [
                "최종 수신",
                fmtDate(selected.received_at, true) +
                  " · " +
                  freshness(selected.received_at, now),
              ],
              ["잔여 항로", n(selected.remaining_distance_nm) + " nm"],
              ["목적지", selected.destination_port],
              ["AIS ETA", fmtDate(selected.ais_eta, true)],
              ["보정 ETA · AIS 기준", fmtDate(timing.eta, true)],
              ["예상 접안", fmtDate(timing.berth, true)],
              ["하역 완료 / 재고 반영", fmtDate(timing.unload, true)],
              [
                "기상 / 항로 지연",
                selected.weather_delay_h +
                  " h / " +
                  selected.route_delay_h +
                  " h",
              ],
              [
                "항만 대기 / 추가 시나리오",
                selected.expected_port_wait_h +
                  " h / " +
                  scenario.arrivalDelayDays +
                  "일",
              ],
              [
                "탄종 / 화물량",
                selected.coal_type + " / " + n(selected.cargo_t) + " t",
              ],
              ["열량", n(selected.calorific_value_kcal_kg) + " kcal/kg"],
              [
                "수분 / 회분 / 황분",
                selected.moisture_pct +
                  " / " +
                  selected.ash_pct +
                  " / " +
                  selected.sulfur_pct +
                  " %",
              ],
              ["예상 체선료", n(timing.demurrageUsd) + " USD"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="tower-footnote">
            ETA는 AIS 예정시각에 기상·항로 지연을 더한 모의값입니다. 잔여거리와
            SOG로 항로 도착시각을 다시 예측하는 기능은 미구현입니다. 체선료는
            max(항만 대기 − 허용시간 {selected.allowed_laytime_h}h, 0) × 일 요율
            / 24의 단순 모의값입니다. 계약 정산액이 아닙니다. 입하 제외
            시나리오는 재고 계산에만 적용됩니다.
          </p>
        </Section>
      )}
    </div>
  );
}

function ModelCard({
  model,
  theme,
}: {
  model: ModelRuns["demand"];
  theme: string;
}) {
  return (
    <Section
      title={model.name + " 모델"}
      note={model.version + " · 합성 데이터 / 선형 회귀"}
      action={<span className="tower-tag">SYNTHETIC</span>}
    >
      <div className="model-metrics">
        <span>
          MAE <b>{n(model.metrics.mae, 1)} MW</b>
        </span>
        <span>
          RMSE <b>{n(model.metrics.rmse, 1)} MW</b>
        </span>
        <span>
          MAPE <b>{n(model.metrics.mape, 2)} %</b>
        </span>
      </div>
      <TowerChart
        theme={theme}
        label={model.name + " 학습 및 검증 손실 곡선"}
        height={170}
        option={{
          xAxis: {
            type: "category",
            data: model.losses.map((x) => x.iteration),
            name: "iteration",
          },
          yAxis: {
            ...axis("정규화 MSE"),
            axisLabel: { formatter: (v: number) => v.toFixed(2) },
          },
          series: [
            line(
              "학습",
              model.losses.map((x) => x.train),
            ),
            line(
              "검증",
              model.losses.map((x) => x.validation),
            ),
          ],
        }}
      />
      <p className="tower-footnote">
        학습 {model.trainStart} ~ {model.trainEnd} (150일)
        <br />
        검증 {model.validationStart} ~ {model.validationEnd} (30일)
      </p>
    </Section>
  );
}
export function ModelsPage({
  models,
  onModels,
  theme,
}: {
  models: ModelRuns;
  onModels: (models: ModelRuns) => void;
  theme: string;
}) {
  const [iterations, setIterations] = useState(120);
  const [busy, setBusy] = useState(false);
  async function train() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    try {
      onModels(fitModels(iterations));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tower-page">
      <Section
        title="예측 실험"
        note="고정 합성 시계열을 사용한 로컬 기준모델 · 실제 계통 예측 성능을 의미하지 않습니다"
      >
        <div className="model-controls">
          <label>
            학습 반복{" "}
            <select
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
            >
              <option value={30}>30회</option>
              <option value={120}>120회</option>
              <option value={300}>300회</option>
            </select>
          </label>
          <Button onClick={train} disabled={busy}>
            <FlaskConical size={15} />
            {busy ? "학습 중" : "재학습 · 전망에 적용"}
          </Button>
          {busy && (
            <ProcessingOrb
              theme={theme as "light" | "dark"}
              state="solving"
              label="학습 및 검증 계산 중…"
            />
          )}
        </div>
        <p className="tower-footnote">
          학습 데이터 150일과 검증 데이터 30일을 분리합니다. 예측 수요·공급용량
          비율을 호기 계획 발전량에 반영하고, 열량·효율을 통해 연료사용과 재고로
          연결합니다. 계획정지와 정격용량 상한도 적용됩니다.
        </p>
      </Section>
      <div className="tower-two">
        <ModelCard model={models.demand} theme={theme} />
        <ModelCard model={models.capacity} theme={theme} />
      </div>
      <ModelCard model={models.peak} theme={theme} />
      <Section
        title="90일 모델 출력"
        note="지역별 실측 모델이 아닌 합성 계통 시계열 · 발전소 선택은 발전량 배분에 적용"
      >
        <TowerChart
          theme={theme}
          label="90일 일평균 수요 및 공급가능 용량 예측 MW"
          height={290}
          option={{
            xAxis: {
              type: "category",
              data: models.demand.predictions
                .slice(0, 90)
                .map((_, i) =>
                  labelDay(
                    new Date(Date.parse(BASE_TIME) + i * 86400000)
                      .toISOString()
                      .slice(0, 10),
                  ),
                ),
            },
            yAxis: axis("MW"),
            series: [
              line("평균 전력수요", models.demand.predictions.slice(0, 90)),
              line("최대 전력수요", models.peak.predictions.slice(0, 90)),
              line("공급가능 용량", models.capacity.predictions.slice(0, 90)),
            ],
          }}
        />
      </Section>
      <p className="tower-footnote">
        현재 모델은 평균·최대 수요와 석탄가용 용량을 예측합니다. 첫 예측일은
        2026-10-06이며 최종 관측일 2026-10-05의 D+1입니다. Python/XGBoost 모델
        서비스 및 MILP 급전 최적화는 후속 연동 범위입니다.
      </p>
    </div>
  );
}

export function DataPage({ plants }: { plants: Plant[] }) {
  const ids = plants.map((p) => p.id);
  const piles = stockpiles.filter((p) => ids.includes(p.plant_id));
  const cargo = voyages.filter((v) => ids.includes(v.destination_plant_id));
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            source: "SYNTHETIC",
            base_time: BASE_TIME,
            plants,
            stockpiles: piles,
            voyages: cargo,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ewp-poc-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="tower-page">
      <Section
        title="데이터 연결 상태"
        note="오프라인 페이지 · 비밀키나 운영 데이터를 포함하지 않습니다"
        action={
          <Button variant="outline" size="sm" onClick={download}>
            더미데이터 내려받기
          </Button>
        }
      >
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>데이터</th>
                <th>현재 공급원</th>
                <th>상태</th>
                <th>후속 연결</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "재고·탄질·Pile",
                  "로컬 더미 " + piles.length + "건",
                  "DEMO",
                  "재고 DB / SQLAlchemy",
                ],
                [
                  "선박·화물",
                  "로컬 더미 " + cargo.length + "건",
                  "DEMO",
                  "AISstream 서버 프록시",
                ],
                ["온도·CO", "없음", "미연결", "저탄장 센서"],
                [
                  "수요·공급 모델",
                  "브라우저 합성데이터 학습",
                  "LOCAL",
                  "FastAPI / Python 모델 서비스",
                ],
                [
                  "발전량 최적화",
                  "호기 부하 × 모델 비율",
                  "BASELINE",
                  "MILP 급전 모델",
                ],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((x, i) => (
                    <td key={i}>{x}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="정합성 점검" note="선택한 발전소 범위에 적용">
        <dl className="tower-details">
          <div>
            <dt>Pile 합계</dt>
            <dd>{n(piles.reduce((s, p) => s + p.on_hand_t, 0))} t</dd>
          </div>
          <div>
            <dt>화물 합계 (전체 항차)</dt>
            <dd>{n(cargo.reduce((s, v) => s + v.cargo_t, 0))} t</dd>
          </div>
          <div>
            <dt>발전소 키</dt>
            <dd>{ids.join(", ")}</dd>
          </div>
          <div>
            <dt>데이터 기준시각</dt>
            <dd>{fmtDate(BASE_TIME, true)}</dd>
          </div>
        </dl>
        <p className="tower-footnote">
          입하 예정 KPI는 선택 기간 안에 하역이 끝나는 화물만 집계합니다. 발전소
          키로 재고·Pile·항차·호기를 연결하며, AIS 최신성은 현재 시각으로
          판정합니다.
        </p>
      </Section>
      <Section
        title="서비스 연동 범위"
        note="현재 페이지는 아래 API 서버를 호출하지 않습니다"
      >
        <p className="tower-prose">
          화면 계산과 외부 데이터 공급원을 분리했습니다. AIS는 서버에서 키를
          보관하고 정규화한 위치 정보를 페이지로 전달하는 구조입니다. 예측
          서비스는 날짜·호기별 발전량을 같은 재고 엔진에 전달할 수 있습니다.
        </p>
        <p className="tower-prose">
          프로덕션 인증·권한, DB 저장, 실시간 수집, 학습 작업 관리 및 실제
          발전소 데이터 검증은 구현되지 않았습니다.
        </p>
        <details className="tower-api">
          <summary>API 계약 보기 · /api/v1 (미연결)</summary>
          {apiContract.map((route) => (
            <code key={route}>{route}</code>
          ))}
        </details>
      </Section>
    </div>
  );
}
