import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { TowerChart } from "@/components/TowerChart";
import { Section, Metric } from "@/components/tower/primitives";
import { axis } from "@/components/tower/chart-options";
import {
  pileRisk,
  weightedCalorific,
  incomingVoyages,
} from "@/domain/control-tower";
import { BASE_TIME, type Plant } from "@/domain/operations";
import { number as n, date as fmtDate } from "@/lib/format";
import {
  allocateBurn,
  arrivalWaiting,
  attributeByCoalType,
  berthMap,
  contrastLine,
  gaugeValue,
  historyForPile,
  incomingTimeline,
  orderPiles,
  pileBlend,
  recommendBerth,
  transferTons,
  waitingVessels,
  weeklyBurnShares,
  yardScope,
  FORECAST_HORIZON,
} from "./stockyard-domain";
import { HarborMap } from "./HarborMap";
import "./stockyard.css";

const YARDS = ["P1", "P2", "P3"] as const;
const YARD_NAMES: Record<string, string> = {
  P1: "1발전처",
  P2: "2발전처 · 옥내",
  P3: "3발전처 · 옥내",
};

export function Stockyard({
  plants,
  theme,
}: {
  plants: Plant[];
  theme: string;
}) {
  // 진입 시 항상 당진 (fact-default-dangjin).
  const [plantFilter, setPlantFilter] = useState<string | null>("dangjin");
  const [riskFilter, setRiskFilter] = useState<
    "all" | "낮음" | "관찰" | "높음"
  >("all");
  const [sort, setSort] = useState<"tons" | "age" | "risk">("tons");
  const [selectedShip, setSelectedShip] = useState<string | null>(null);
  const [assignedBerths, setAssignedBerths] = useState<Record<string, string>>(
    {},
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [draftTransfer, setDraftTransfer] = useState({
    tons: 5000,
    from: "P1",
    to: "P3",
  });
  const [appliedTransfer, setAppliedTransfer] = useState<{
    tons: number;
    from: string;
    to: string;
  } | null>(null);

  const scope = useMemo(() => yardScope(plantFilter), [plantFilter]);
  const ordered = useMemo(
    () => orderPiles(scope.piles, sort, riskFilter),
    [scope, sort, riskFilter],
  );
  const active =
    scope.piles.find((p) => p.stockpile_id === selected) ??
    ordered[0] ??
    null;

  const total = scope.piles.reduce((s, p) => s + p.on_hand_t, 0);
  const mix = Object.entries(
    scope.piles.reduce<Record<string, number>>((acc, p) => {
      acc[p.coal_type] = (acc[p.coal_type] ?? 0) + p.on_hand_t;
      return acc;
    }, {}),
  );
  const incoming = incomingVoyages(
    scope.incoming,
    plantFilter ? [plantFilter] : plants.map((p) => p.id),
    FORECAST_HORIZON,
  );
  const incomingTons = incoming.reduce((s, v) => s + v.cargo_t, 0);
  const incomingCv = weightedCalorific(
    incoming.map((v) => ({
      tons: v.cargo_t,
      cv: v.calorific_value_kcal_kg,
    })),
  );
  const daily = scope.forecast.daily;
  const weeklyFuel = daily
    .slice(0, 7)
    .reduce((s, d) => s + d.requestedFuelTons, 0);

  const blendPlants = plantFilter
    ? plants.filter((p) => p.id === plantFilter)
    : plants;
  const shares = useMemo(
    () =>
      weeklyBurnShares(
        blendPlants,
        blendPlants.flatMap((p) => p.units.map((u) => u.id)),
      ),
    [plantFilter],
  );
  const burned = useMemo(
    () => allocateBurn(scope.piles, shares, weeklyFuel),
    [scope, shares, weeklyFuel],
  );
  const blend = useMemo(
    () => pileBlend(scope.piles, burned),
    [scope, burned],
  );
  const blendAfterTotal = blend.rows.reduce((s, r) => s + r.afterTons, 0);
  const timeline = useMemo(
    () => incomingTimeline(scope.incoming),
    [scope],
  );
  const arrived = useMemo(() => arrivalWaiting(scope.incoming), [scope]);
  const waiting = useMemo(() => waitingVessels(arrived), [arrived]);
  const unloading = useMemo(
    () =>
      arrived.filter(
        (v) => Date.parse(v.forecast_unload_end) >= Date.parse(BASE_TIME),
      ),
    [arrived],
  );
  const recommendFor = (voyageId: string) => {
    const voyage = arrived.find((v) => v.voyage_id === voyageId)!;
    return recommendBerth(
      voyage,
      waiting.map((r) => r.voyage),
    );
  };
  const attributions = useMemo(
    () => attributeByCoalType(scope.piles, scope.incoming),
    [scope],
  );
  const gauge = useMemo(() => gaugeValue(blendPlants), [plantFilter]);
  const contrast = useMemo(
    () => contrastLine(scope.forecast),
    [scope],
  );
  const transferCapacity = useMemo(
    () =>
      scope.incoming.reduce((max, v) => Math.max(max, v.transfer_capacity_t), 0),
    [scope],
  );
  const transfer = appliedTransfer
    ? transferTons(appliedTransfer.tons, transferCapacity)
    : null;

  const eligibleNames = (pile: (typeof scope.piles)[number]) =>
    plants
      .flatMap((p) => p.units)
      .filter((u) => pile.eligible_unit_ids.includes(u.id))
      .map((u) => u.name)
      .join(", ");

  const renderPileButton = (
    pile: (typeof scope.piles)[number],
    unitCount: number,
  ) => {
    const risk = pileRisk(pile);
    const isEligibleRestricted = pile.eligible_unit_ids.length < unitCount;
    return (
      <button
        key={pile.stockpile_id}
        onClick={() => setSelected(pile.stockpile_id)}
        aria-pressed={active?.stockpile_id === pile.stockpile_id}
        className={`yard-pile risk-${
          risk.label === "높음"
            ? "high"
            : risk.label === "관찰"
              ? "medium"
              : "low"
        }`}
        style={{ flexGrow: pile.on_hand_t, flexBasis: 0 }}
        title={
          isEligibleRestricted ? "일부 호기 전용 (혼탄 제한)" : undefined
        }
      >
        <strong>{pile.stockpile_id}</strong>
        <span>{n(pile.on_hand_t)} t</span>
        <small>
          {risk.age}일 · {risk.label}
          {isEligibleRestricted ? " · 혼탄" : ""}
          {pile.indoor ? " · 옥내" : ""}
        </small>
      </button>
    );
  };

  const dangjinPiles = scope.piles.filter((p) => p.plant_id === "dangjin");
  const showYardSections = dangjinPiles.length > 0;

  return (
    <div className="tower-page stockyard-page">
      <div className="stockyard-toolbar" role="group" aria-label="저탄장 범위">
        <div className="stockyard-plants" role="group" aria-label="발전소 선택">
          <button
            aria-pressed={plantFilter === null}
            onClick={() => {
              setPlantFilter(null);
              setSelected(null);
            }}
          >
            전체
          </button>
          {plants.map((p) => (
            <button
              key={p.id}
              aria-pressed={plantFilter === p.id}
              onClick={() => {
                setPlantFilter(p.id);
                setSelected(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="stockyard-controls">
          <label>
            위험도
            <select
              aria-label="위험도 필터"
              value={riskFilter}
              onChange={(e) =>
                setRiskFilter(e.target.value as typeof riskFilter)
              }
            >
              <option value="all">전체</option>
              <option value="낮음">낮음</option>
              <option value="관찰">관찰</option>
              <option value="높음">높음</option>
            </select>
          </label>
          <label>
            정렬
            <select
              aria-label="Pile 정렬"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="tons">재고량</option>
              <option value="age">적치일수</option>
              <option value="risk">위험도</option>
            </select>
          </label>
        </div>
      </div>

      <div className="tower-kpis tower-kpis-six">
        <Metric label="총 저탄량" value={n(total)} unit="t" />
        <Metric label="운영 Pile" value={scope.piles.length} unit="개" />
        <Metric
          label="가중평균 열량"
          value={n(
            weightedCalorific(
              scope.piles.map((p) => ({
                tons: p.on_hand_t,
                cv: p.calorific_value_kcal_kg,
              })),
            ) ?? 0,
          )}
          unit="kcal/kg"
        />
        <Metric
          label={`입하 예정 (${FORECAST_HORIZON}일)`}
          value={n(incomingTons)}
          unit="t"
          note={`${incoming.length}척 · 가중 ${incomingCv ? n(incomingCv) : "-"} kcal/kg`}
        />
        <Metric
          label="최장 적치"
          value={Math.max(0, ...scope.piles.map((p) => pileRisk(p).age))}
          unit="일"
        />
        <Metric
          label="고위험 Pile"
          value={scope.piles.filter((p) => pileRisk(p).score >= 70).length}
          unit="개"
          note="모의 위험도 · SIMULATED"
        />
      </div>

      <Section
        title="당진 앞바다 · 접안 현황"
        note="바다·대기선·하역선·부두 그림 + 옆 테이블(대기목록·부두점유) · 그림과 테이블 선택 동기화"
        action={<span className="tower-tag">SIMULATED</span>}
      >
        <div className="yard-flow">
          {[
            "연료부두",
            "접안 대기",
            "하역",
            "발전처 저탄장",
            "처 간 이탄",
            "발전호기",
          ].map((x, i) => (
            <span key={x}>
              {x}
              {i < 5 && <ArrowRight size={14} />}
            </span>
          ))}
        </div>
        <div className="harbor-grid">
          <HarborMap
            waiting={waiting.map((r) => r.voyage)}
            unloading={unloading}
            assignedBerths={assignedBerths}
            selectedId={selectedShip}
            onSelect={setSelectedShip}
            theme={theme === "dark" ? "dark" : "light"}
          />
          <div className="harbor-tables">
            <div className="tower-table-wrap">
              <table className="tower-table stockyard-waiting">
                <thead>
                  <tr>
                    {[
                      "선박",
                      "부두",
                      "대기 · h",
                      "접안 예정",
                      "체선료 · $",
                      "Freshness",
                      "접안 지정",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waiting.map(
                    ({ voyage, waitH, berthAt, demurrageUsd, freshnessLabel }) => {
                      const rec = recommendFor(voyage.voyage_id);
                      const assigned =
                        assignedBerths[voyage.voyage_id] ?? rec.berth_id;
                      return (
                        <tr
                          key={voyage.voyage_id}
                          aria-selected={selectedShip === voyage.voyage_id}
                          onClick={() => setSelectedShip(voyage.voyage_id)}
                          className={
                            selectedShip === voyage.voyage_id
                              ? "is-selected"
                              : undefined
                          }
                        >
                          <td>
                            {voyage.vessel_name} · {n(voyage.cargo_t)} t
                          </td>
                          <td>
                            {voyage.berth_id ?? "-"} →{" "}
                            {voyage.berth_id
                              ? (YARD_NAMES[berthMap[voyage.berth_id]] ??
                                berthMap[voyage.berth_id])
                              : "-"}
                          </td>
                          <td>{waitH}</td>
                          <td>{fmtDate(berthAt, true)}</td>
                          <td>{n(demurrageUsd)}</td>
                          <td>
                            <span className="tower-tag">{freshnessLabel}</span>
                          </td>
                          <td>
                            <span className="tower-tag">추천 {rec.berth_id}</span>
                            <small>{rec.reason}</small>
                            <div className="harbor-assign">
                              <select
                                aria-label={`${voyage.vessel_name} 접안 부두`}
                                value={assigned}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  setAssignedBerths((prev) => ({
                                    ...prev,
                                    [voyage.voyage_id]: e.target.value,
                                  }))
                                }
                              >
                                {["BD-1", "BD-2", "BD-3"].map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                    {b === rec.berth_id ? " (추천)" : ""}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssignedBerths((prev) => ({
                                    ...prev,
                                    [voyage.voyage_id]: assigned,
                                  }));
                                  setSelectedShip(voyage.voyage_id);
                                }}
                              >
                                접안 지정
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )}
                  {!waiting.length && (
                    <tr>
                      <td colSpan={7}>접안 대기 선박이 없습니다</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="tower-table-wrap">
              <table className="tower-table stockyard-berths">
                <thead>
                  <tr>
                    {["부두", "상태", "선박 · ETA"].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {["BD-1", "BD-2", "BD-3"].map((berth) => {
                    const entry = Object.entries(assignedBerths).find(
                      ([, b]) => b === berth,
                    );
                    const vessel = entry
                      ? arrived.find((v) => v.voyage_id === entry[0])
                      : unloading.find((v) => v.berth_id === berth);
                    return (
                      <tr key={berth}>
                        <td>
                          {berth} → {YARD_NAMES[berthMap[berth]]}
                        </td>
                        <td>{vessel ? "접안중" : "빈 부두"}</td>
                        <td>
                          {vessel
                            ? `${vessel.vessel_name} · ${fmtDate(vessel.ais_eta, true)}`
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <p className="tower-footnote">
          대기·접안·체선료는 voyageTiming 계산이며 SIMULATED입니다. ETA 도달
          판정은 실제 현시각 기준, 연동 범위는 당진행입니다.
        </p>
      </Section>

      <div className="tower-two">
        <Section
          title="상탄 현황"
          note="현재 출력의 t/h 환산치 · 발전운영 탭과 같은 원천"
          action={<span className="tower-tag">SIMULATED</span>}
        >
          <div className="stockyard-gauge">
            <strong>{n(gauge, 1)} t/h</strong>
            <span>상탄 중 (모의 게이지, 운영 지시 아님)</span>
          </div>
        </Section>
        <Section
          title="처 간 이탄"
          note="가용용량은 표본 임의값 · 이송량은 수기 입력 · 초과 입력은 경고만 표시"
          action={<span className="tower-tag">SIMULATED</span>}
        >
          <div className="stockyard-transfer">
            <label>
              이송량 · t
              <input
                aria-label="이송량 입력"
                type="number"
                min={0}
                value={draftTransfer.tons}
                onChange={(e) =>
                  setDraftTransfer((d) => ({
                    ...d,
                    tons: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              출발
              <select
                aria-label="출발 발전처"
                value={draftTransfer.from}
                onChange={(e) =>
                  setDraftTransfer((d) => ({ ...d, from: e.target.value }))
                }
              >
                {YARDS.map((y) => (
                  <option key={y} value={y}>
                    {YARD_NAMES[y]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              도착
              <select
                aria-label="도착 발전처"
                value={draftTransfer.to}
                onChange={(e) =>
                  setDraftTransfer((d) => ({ ...d, to: e.target.value }))
                }
              >
                {YARDS.map((y) => (
                  <option key={y} value={y}>
                    {YARD_NAMES[y]}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setAppliedTransfer({ ...draftTransfer })}>
              이탄 적용
            </button>
          </div>
          {transfer && (
            <p className="stockyard-transfer-result">
              적용 이송 {draftTransfer.from} → {draftTransfer.to} ·{" "}
              {n(transfer.tons)} t (가용 {n(transfer.capacity)} t)
              {transfer.overCapacity && (
                <strong> · 가용 초과, 경고 (차단하지 않음)</strong>
              )}
            </p>
          )}
        </Section>
      </div>

      {showYardSections && (
        <Section
          title="발전처별 저탄장"
          note="1:1 부두 매핑 · 2·3발전처 옥내 · 2x2 탄종 구역×5개 · Pile별 30일 하역 이력(역순)"
          action={<span className="tower-tag">SIMULATED</span>}
        >
          <div className="yard-map">
            {YARDS.map((yard) => {
              const yardPiles = dangjinPiles.filter(
                (p) => p.plant_yard === yard,
              );
              if (!yardPiles.length) return null;
              return (
                <div key={yard} className="yard-plant">
                  <span>{YARD_NAMES[yard]}</span>
                  <div className="zone-grid">
                    {[0, 1, 2, 3].map((zone) => {
                      const group = orderPiles(
                        yardPiles.filter((p) => p.zone === zone),
                        sort,
                        riskFilter,
                      );
                      if (!group.length) return null;
                      return (
                        <div key={zone} className="zone-group">
                          <span>
                            {zone + 1}구역 · {group[0].coal_type}
                          </span>
                          <div className="yard-piles">
                            {group.map((pile) =>
                              renderPileButton(
                                pile,
                                blendPlants[0]?.units.length ?? 0,
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {blendPlants
            .filter((p) => p.id !== "dangjin")
            .map((p) => {
              const plantPiles = orderPiles(
                scope.piles.filter((x) => x.plant_id === p.id),
                sort,
                riskFilter,
              );
              if (!plantPiles.length) return null;
              return (
                <div key={p.id} className="yard-plant">
                  <span>{p.name}</span>
                  <div className="yard-piles">
                    {plantPiles.map((pile) =>
                      renderPileButton(pile, p.units.length),
                    )}
                  </div>
                </div>
              );
            })}
          <div className="stockyard-history">
            {orderPiles(dangjinPiles, sort, riskFilter).map((pile) => {
              const entries = historyForPile(pile, attributions);
              if (!entries.length) return null;
              return (
                <div key={pile.stockpile_id} className="stockyard-history-pile">
                  <strong>
                    {pile.stockpile_id} · {pile.plant_yard} 하역 이력
                  </strong>
                  <ul>
                    {entries.map((e) => (
                      <li key={`${pile.stockpile_id}-${e.voyage_id}`}>
                        {fmtDate(e.unloaded_at, true)} · {e.vessel_name} ·{" "}
                        {n(e.tons)} t · {e.coal_type} ·{" "}
                        {n(e.calorific_value_kcal_kg)} kcal/kg · 수분{" "}
                        {e.moisture_pct}% · 회분 {e.ash_pct}% · 황분{" "}
                        {e.sulfur_pct}%
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {!showYardSections && (
        <Section
          title="저탄장 배치"
          note="면적은 재고량 비례 · Pile을 선택하면 탄질과 투입 가능 호기를 확인할 수 있습니다"
          action={<span className="tower-tag">SIMULATED RISK</span>}
        >
          <div className="yard-map">
            {blendPlants.map((p) => {
              const plantPiles = orderPiles(
                scope.piles.filter((x) => x.plant_id === p.id),
                sort,
                riskFilter,
              );
              if (!plantPiles.length) return null;
              return (
                <div key={p.id} className="yard-plant">
                  <span>{p.name}</span>
                  <div className="yard-piles">
                    {plantPiles.map((pile) =>
                      renderPileButton(pile, p.units.length),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="tower-footnote">
            위험도는 적치기간과 탄종으로 계산한 모의 점수입니다. 온도·CO
            센서 데이터는 연결되지 않았습니다.
          </p>
        </Section>
      )}

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
              ["부두 / 발전처", `${active.berth_id ?? "-"} / ${active.plant_yard ?? "-"}${active.indoor ? " · 옥내" : ""}`],
              ["투입 가능 호기", eligibleNames(active) || "없음"],
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
        <Section
          title="재고 전망"
          note={`Pile 합계 기준 · 하역 완료 시점에 재고 반영 · ${FORECAST_HORIZON}일 · 대비선=요청 연료`}
        >
          <TowerChart
            theme={theme}
            label="저탄장 일별 재고 전망"
            option={{
              tooltip: { trigger: "axis" },
              legend: { bottom: 0, top: "auto" },
              grid: { top: 30, right: 16, bottom: 44, left: 48 },
              xAxis: {
                type: "category",
                data: daily.map((d) => d.date.slice(5).replace("-", "/")),
              },
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
                  data: contrast.map((c) => Math.round(c.requested)),
                  showSymbol: false,
                  lineStyle: { width: 1, type: "dotted" },
                },
              ],
            }}
          />
        </Section>
        <Section
          title="입하 예정"
          note="취소 항차 제외 · 하역 완료 시각 순 · 재고 반영은 하역 완료일"
        >
          <div className="tower-table-wrap">
            <table className="tower-table stockyard-incoming">
              <thead>
                <tr>
                  {["하역 완료", "선박", "물량 · t", "탄종 · 열량"].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeline.map(({ voyage, at }) => (
                  <tr key={voyage.voyage_id}>
                    <td>{fmtDate(new Date(at).toISOString(), true)}</td>
                    <td>{voyage.vessel_name}</td>
                    <td>{n(voyage.cargo_t)}</td>
                    <td>
                      {voyage.coal_type} · {n(voyage.calorific_value_kcal_kg)}
                    </td>
                  </tr>
                ))}
                {!timeline.length && (
                  <tr>
                    <td colSpan={4}>기간 내 입하 예정이 없습니다</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section
        title="주간 소진 · 혼탄 시뮬레이션"
        note="현재 부하 표본의 7일 소비량을 투입 가능 호기 기준으로 Pile에 배분한 결과 · 운영 지시가 아닙니다"
        action={<span className="tower-tag">SIMULATED</span>}
      >
        <div className="stockyard-blend-summary">
          <span>
            주간 소비 <strong>{n(blend.burnTotal)} t</strong>
          </span>
          <span>
            소진 전 가중열량{" "}
            <strong>{blend.beforeCv ? n(blend.beforeCv) : "-"} kcal/kg</strong>
          </span>
          <span>
            소진 후 가중열량{" "}
            <strong>{blend.afterCv ? n(blend.afterCv) : "-"} kcal/kg</strong>
          </span>
        </div>
        <div className="tower-table-wrap">
          <table className="tower-table stockyard-blend">
            <thead>
              <tr>
                {[
                  "Pile",
                  "탄종",
                  "현재 · t",
                  "소진 · t",
                  "잔량 · t",
                  "잔량 비중",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blend.rows.map((row) => (
                <tr key={row.stockpile_id}>
                  <td>
                    <button onClick={() => setSelected(row.stockpile_id)}>
                      {row.stockpile_id}
                    </button>
                  </td>
                  <td>
                    {
                      scope.piles.find(
                        (p) => p.stockpile_id === row.stockpile_id,
                      )?.coal_type
                    }
                  </td>
                  <td>{n(row.beforeTons)}</td>
                  <td>{row.burnedTons ? n(row.burnedTons) : "-"}</td>
                  <td>{n(row.afterTons)}</td>
                  <td>
                    {blendAfterTotal > 0
                      ? n((row.afterTons / blendAfterTotal) * 100, 1) + " %"
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

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
                  data: scope.piles.map((p) => ({
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
          <table className="tower-table stockyard-ledger">
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
              {ordered.map((p) => (
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
