import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { Search } from "lucide-react";
import { Section } from "@/components/tower/primitives";
import type { Voyage } from "@/data/control-tower";
import {
  pileRisk,
  weightedCalorific,
  incomingVoyages,
} from "@/domain/control-tower";
import { BASE_TIME, type Plant } from "@/domain/operations";
import { number as n } from "@/lib/format";
import {
  arrivalWaiting,
  attributeByCoalType,
  berthOccupancy,
  contrastLine,
  daysStatus,
  DAYS_STATUS_LABEL,
  fromSupplyTransfers,
  gaugeValue,
  groupForecasts,
  groupWeeklyBurn,
  historyForPile,
  incomingSchedule,
  ledgerRows,
  mergeAisPositions,
  mergeSensorReadings,
  orderPiles,
  pileBlend,
  recommendBerth,
  showSampleWaiting,
  siteVessels,
  stockGroups,
  stockyardAlerts,
  transferTons,
  waitingVessels,
  weeklyBurnShares,
  yardScope,
  FORECAST_HORIZON,
  type SimTransfer,
  type StockyardTarget,
} from "./stockyard-domain";
import { PileButton } from "./PileButton";
import { PileDetail } from "./PileDetail";
import { StockyardSite, type LinkChip } from "./StockyardSite";
import { SitePanel, type PanelTab } from "./SitePanel";
import { StockyardAlerts, StockyardKpis, type KpiItem } from "./StockyardKpis";
import { YardForecast } from "./YardForecast";
import { IncomingTimeline } from "./IncomingTimeline";
import { StockyardAnalysis, type AnalysisTab } from "./StockyardAnalysis";
import { PileLedger } from "./PileLedger";
import {
  IntegrationError,
  correctSupplyUnloading,
  fetchAisPositions,
  fetchSensorReadings,
  fetchSupplyRecords,
  registerSupplyVessel,
  saveSupplyTransfer,
  useLink,
} from "./integrations";
import "./stockyard.css";

const reducedMotion = () =>
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollToRef = (ref: RefObject<HTMLElement | null>) =>
  ref.current?.scrollIntoView({
    behavior: reducedMotion() ? "auto" : "smooth",
    block: "start",
  });

export function Stockyard({
  plants,
  theme,
  horizon = FORECAST_HORIZON,
}: {
  plants: Plant[];
  theme: string;
  /** 앱 공통 전망 기간 (30/60/90일). */
  horizon?: number;
}) {
  // ── 범위: 앱 공통 조회 범위가 원천, 탭 칩은 그 안의 하위 선택 ──
  const scopeIds = plants.map((p) => p.id);
  const scopeKey = scopeIds.join(",");
  const fallback = scopeIds.includes("dangjin")
    ? "dangjin"
    : scopeIds.length === 1
      ? scopeIds[0]
      : null;
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const plantFilter =
    chosen === undefined || (chosen !== null && !scopeIds.includes(chosen))
      ? fallback
      : chosen;
  const [riskFilter, setRiskFilter] = useState<
    "all" | "낮음" | "관찰" | "높음"
  >("all");
  const [sort, setSort] = useState<"tons" | "age" | "risk">("tons");
  const [query, setQuery] = useState("");
  const [queryMiss, setQueryMiss] = useState(false);

  // ── 선택: 화면 전체가 하나의 선택 상태를 공유 ──
  const [selection, setSelection] = useState<StockyardTarget | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("vessel");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("blend");
  const [ledgerJump, setLedgerJump] = useState(0);
  const [assignedBerths, setAssignedBerths] = useState<Record<string, string>>(
    {},
  );
  const [transfers, setTransfers] = useState<SimTransfer[]>([]);

  const siteRef = useRef<HTMLDivElement>(null);
  const forecastRef = useRef<HTMLDivElement>(null);
  const analysisRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);

  const scope = useMemo(
    () => yardScope(plantFilter, horizon, scopeIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plantFilter, horizon, scopeKey],
  );
  const viewPlants = useMemo(
    () => plants.filter((p) => !plantFilter || p.id === plantFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plantFilter, scopeKey],
  );
  const dangjinPlant = plants.find((p) => p.id === "dangjin");
  const dangjinInView = scope.piles.some((p) => p.plant_id === "dangjin");

  // ── 외부 연계 (실패하면 더미 표본 유지) ──
  const outOfScope = () =>
    Promise.reject(new IntegrationError("당진 범위 아님"));
  const supply = useLink(
    () => (dangjinInView ? fetchSupplyRecords() : outOfScope()),
    [dangjinInView],
  );
  const ais = useLink(
    () => (dangjinInView ? fetchAisPositions("dangjin") : outOfScope()),
    [dangjinInView],
  );
  const sensors = useLink(
    () => fetchSensorReadings(plantFilter ?? undefined),
    [plantFilter],
  );

  const piles = useMemo(
    () => mergeSensorReadings(scope.piles, sensors.data ?? []),
    [scope, sensors.data],
  );
  const live = useMemo(
    () => mergeAisPositions(scope.incoming, ais.data ?? []),
    [scope, ais.data],
  );
  const berthOf = useCallback(
    (v: Voyage) => assignedBerths[v.voyage_id] ?? v.berth_id,
    [assignedBerths],
  );

  // ── 선박·부두 ──
  const arrived = useMemo(() => arrivalWaiting(live.voyages), [live]);
  const waiting = useMemo(() => waitingVessels(arrived), [arrived]);
  const unloading = useMemo(
    () =>
      arrived.filter(
        (v) => Date.parse(v.forecast_unload_end) >= Date.parse(BASE_TIME),
      ),
    [arrived],
  );
  const vessels = useMemo(
    () =>
      siteVessels(
        unloading,
        waiting.map((r) => r.voyage),
        assignedBerths,
      ),
    [unloading, waiting, assignedBerths],
  );
  const berths = useMemo(() => berthOccupancy(vessels), [vessels]);
  const recommendFor = (voyageId: string) =>
    recommendBerth(
      arrived.find((v) => v.voyage_id === voyageId)!,
      waiting.map((r) => r.voyage),
    );
  const attributions = useMemo(
    () => attributeByCoalType(piles, scope.incoming, berthOf),
    [piles, scope, berthOf],
  );

  // ── 처 간 이탄: 화면 모의 + 백엔드 저장분 ──
  const savedTransfers = useMemo(
    () => fromSupplyTransfers(supply.data?.transfers ?? []),
    [supply.data],
  );
  const allTransfers = useMemo(
    () => [
      ...transfers,
      ...savedTransfers.filter(
        (s) => !transfers.some((t) => t.savedId === s.savedId),
      ),
    ],
    [transfers, savedTransfers],
  );
  const transferCapacity = scope.incoming.reduce(
    (m, v) => Math.max(m, v.transfer_capacity_t),
    0,
  );
  const yardDeltas = useMemo(() => {
    const out: Record<string, number> = {};
    const base = Date.parse(BASE_TIME);
    for (const t of allTransfers) {
      if (Date.parse(t.at) < base || t.from === t.to) continue;
      out[t.from] = (out[t.from] ?? 0) - t.tons;
      out[t.to] = (out[t.to] ?? 0) + t.tons;
    }
    return out;
  }, [allTransfers]);

  // ── 재고: 처(당진)·발전소 단위 전망 ──
  const groups = useMemo(
    () => stockGroups(viewPlants, piles),
    [viewPlants, piles],
  );
  const forecasts = useMemo(
    () => groupForecasts(groups, scope, berthOf, allTransfers),
    [groups, scope, berthOf, allTransfers],
  );
  const baseline = useMemo(
    () =>
      allTransfers.length
        ? groupForecasts(groups, scope, berthOf, [])
        : forecasts,
    [groups, scope, berthOf, allTransfers.length, forecasts],
  );
  const yardForecasts = forecasts.filter(
    (f) => f.group.plantId === "dangjin" && f.group.yard,
  );

  // ── 소진·혼탄: 처별 7일 사용량을 처 안 Pile에 배분 ──
  const shares = useMemo(
    () =>
      weeklyBurnShares(
        viewPlants,
        viewPlants.flatMap((p) => p.units.map((u) => u.id)),
      ),
    [viewPlants],
  );
  const burned = useMemo(
    () => groupWeeklyBurn(forecasts, shares),
    [forecasts, shares],
  );
  const blend = useMemo(() => pileBlend(piles, burned), [piles, burned]);

  const dangjinGauge = useMemo(
    () => (dangjinPlant ? gaugeValue([dangjinPlant]) : 0),
    [dangjinPlant],
  );
  const otherPlants = viewPlants.filter((p) => p.id !== "dangjin");
  const otherGauge = useMemo(
    () => gaugeValue(viewPlants.filter((p) => p.id !== "dangjin")),
    [viewPlants],
  );

  // ── 선택 파생값 ──
  const activePile =
    selection?.kind === "pile"
      ? (piles.find((p) => p.stockpile_id === selection.id) ?? null)
      : null;
  const activeVessel =
    (selection?.kind === "vessel" &&
      vessels.find((v) => v.voyage.voyage_id === selection.id)) ||
    vessels[0] ||
    null;
  const activeYard = selection?.kind === "yard" ? selection.id : "P1";
  const unitNames = Object.fromEntries(
    plants.flatMap((p) => p.units.map((u) => [u.id, u.name])),
  );
  const eligibleNames = (pile: (typeof piles)[number]) =>
    plants
      .flatMap((p) => p.units)
      .filter((u) => pile.eligible_unit_ids.includes(u.id))
      .map((u) => u.name)
      .join(", ");

  const focusPile = (id: string) =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `.yard-pile[data-pile-id="${id}"]`,
      );
      el?.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      el?.focus({ preventScroll: true });
    });
  const select = (target: StockyardTarget, reveal = false) => {
    setSelection(target);
    setPanelTab(target.kind);
    if (!reveal) return;
    if (target.kind === "pile") focusPile(target.id);
    else scrollToRef(siteRef);
  };

  const total = piles.reduce((s, p) => s + p.on_hand_t, 0);
  const incoming = incomingVoyages(
    scope.incoming,
    plantFilter ? [plantFilter] : scopeIds,
    horizon,
  );
  const incomingTons = incoming.reduce((s, v) => s + v.cargo_t, 0);
  const incomingCv = weightedCalorific(
    incoming.map((v) => ({ tons: v.cargo_t, cv: v.calorific_value_kcal_kg })),
  );
  const oldest = [...piles].sort((a, b) => pileRisk(b).age - pileRisk(a).age)[0];
  const highCount = piles.filter((p) => pileRisk(p).label === "높음").length;
  const sensed = piles.some((p) => pileRisk(p).source === "SENSOR");
  const lowest = forecasts
    .filter((f) => f.currentDays !== null)
    .sort((a, b) => a.currentDays! - b.currentDays!)[0];
  const transferOver = transfers.some(
    (t) => !t.savedId && transferTons(t.tons, transferCapacity).overCapacity,
  );
  const alerts = useMemo(
    () => stockyardAlerts({ forecasts, piles, vessels, transferOver }),
    [forecasts, piles, vessels, transferOver],
  );

  const kpis: KpiItem[] = [
    {
      label: "총 저탄량",
      value: n(total),
      unit: "t",
      note: `${piles.length}개 Pile 합계`,
      action: "원장으로 이동",
      onClick: () => scrollToRef(ledgerRef),
    },
    {
      label: "최저 재고일수",
      value: lowest ? n(lowest.currentDays!, 1) : "-",
      unit: "일",
      note: lowest
        ? `${lowest.group.label} · ${DAYS_STATUS_LABEL[daysStatus(lowest.currentDays)]}`
        : "소비 계획 없음",
      tone: daysStatus(lowest?.currentDays ?? null),
      action: "해당 처·발전소 보기",
      onClick: () =>
        lowest?.group.yard
          ? select({ kind: "yard", id: lowest.group.yard }, true)
          : scrollToRef(forecastRef),
    },
    {
      label: "운영 Pile",
      value: piles.length,
      unit: "개",
      note: `${groups.length}개 처·발전소`,
      action: "원장으로 이동",
      onClick: () => scrollToRef(ledgerRef),
    },
    {
      label: "가중평균 열량",
      value: n(
        weightedCalorific(
          piles.map((p) => ({ tons: p.on_hand_t, cv: p.calorific_value_kcal_kg })),
        ) ?? 0,
      ),
      unit: "kcal/kg",
      note: "Pile 재고 가중",
      action: "탄종 구성 보기",
      onClick: () => {
        setAnalysisTab("mix");
        scrollToRef(analysisRef);
      },
    },
    {
      label: `입하 예정 (${horizon}일)`,
      value: n(incomingTons),
      unit: "t",
      note: `${incoming.length}척 · 가중 ${incomingCv ? n(incomingCv) : "-"} kcal/kg`,
      action: "입하 타임라인으로 이동",
      onClick: () => scrollToRef(forecastRef),
    },
    {
      label: "최장 적치",
      value: oldest ? pileRisk(oldest).age : 0,
      unit: "일",
      note: oldest?.stockpile_id,
      action: "해당 Pile 선택",
      onClick: () =>
        oldest && select({ kind: "pile", id: oldest.stockpile_id }, true),
    },
    {
      label: "고위험 Pile",
      value: highCount,
      unit: "개",
      note: sensed ? "센서 반영 위험도" : "모의 위험도 · SIMULATED",
      tone: highCount ? "danger" : undefined,
      pressed: riskFilter === "높음",
      action: riskFilter === "높음" ? "고위험만 보기 해제" : "고위험만 보기",
      onClick: () => setRiskFilter((f) => (f === "높음" ? "all" : "높음")),
    },
  ];

  const links: LinkChip[] = [
    {
      label: live.source === "aisstream" ? "AIS 실시간" : "AIS 더미",
      status:
        live.source === "aisstream"
          ? "online"
          : ais.status === "checking"
            ? "checking"
            : "offline",
      detail:
        live.source === "aisstream"
          ? "GET /api/v1/vessels · MMSI 일치 항차에 위치 반영"
          : `GET /api/v1/vessels · ${ais.status === "online" ? "일치 MMSI 없음" : ais.error || "확인 중"} · 더미 표본 사용`,
    },
    {
      label:
        sensors.status === "online"
          ? `센서 ${sensors.data?.length ?? 0}건`
          : "센서 미연결",
      status: sensors.status,
      detail: `GET /api/v1/stockpiles/sensors · ${sensors.status === "online" ? "6시간 이내 측정만 반영" : sensors.error || "확인 중"}`,
    },
    {
      label: supply.status === "online" ? "수급 원장" : "수급 원장 미연결",
      status: supply.status,
      detail: `/api/supply · ${supply.status === "online" ? "이탄·하역 저장 가능" : supply.error || "확인 중"}`,
    },
  ];
  const refreshLinks = () => {
    void supply.refresh();
    void ais.refresh();
    void sensors.refresh();
  };

  const runSearch = () => {
    const q = query.trim().toUpperCase();
    if (!q) return;
    const hit =
      piles.find((p) => p.stockpile_id.toUpperCase() === q) ??
      (/^\d+$/.test(q)
        ? piles.find((p) => p.stockpile_id.endsWith(`-${q.padStart(2, "0")}`))
        : undefined) ??
      piles.find((p) => p.stockpile_id.toUpperCase().includes(q));
    setQueryMiss(!hit);
    if (hit) select({ kind: "pile", id: hit.stockpile_id }, true);
  };

  const dangjinPiles = piles.filter((p) => p.plant_id === "dangjin");
  const otherYards = otherPlants
    .map((p) => ({
      plant: p,
      piles: orderPiles(
        piles.filter((x) => x.plant_id === p.id),
        sort,
        "all",
      ),
    }))
    .filter((x) => x.piles.length);
  const maxPileTons = Math.max(1, ...piles.map((p) => p.on_hand_t));
  const standalonePile = dangjinInView
    ? null
    : (activePile ?? orderPiles(piles, sort, riskFilter)[0] ?? null);
  const rows = useMemo(
    () => ledgerRows(piles, plants, blend, attributions, horizon),
    [piles, plants, blend, attributions, horizon],
  );

  return (
    <div
      className="tower-page stockyard-page"
      onKeyDown={(e) => {
        if (
          e.key === "Escape" &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLSelectElement)
        )
          setSelection(null);
      }}
    >
      <div className="stockyard-toolbar" role="group" aria-label="저탄장 범위">
        {plants.length > 1 ? (
          <div className="stockyard-plants" role="group" aria-label="발전소 선택">
            <button
              aria-pressed={plantFilter === null}
              onClick={() => {
                setChosen(null);
                setSelection(null);
              }}
            >
              전체
            </button>
            {plants.map((p) => (
              <button
                key={p.id}
                aria-pressed={plantFilter === p.id}
                onClick={() => {
                  setChosen(p.id);
                  setSelection(null);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <span className="stockyard-scope-note">
            조회 범위 · {plants[0]?.name ?? "-"}
          </span>
        )}
        <div className="stockyard-controls">
          <label className="stockyard-search">
            <Search size={13} aria-hidden="true" />
            <input
              aria-label="Pile 검색"
              placeholder="Pile 검색 (DA-04)"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setQueryMiss(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
            {queryMiss && <small role="status">없음</small>}
          </label>
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

      <StockyardKpis items={kpis} />
      <StockyardAlerts alerts={alerts} onTarget={(t) => select(t, true)} />

      {dangjinInView && (
        <div ref={siteRef} className="stockyard-anchor">
          <StockyardSite
            piles={dangjinPiles}
            attributions={attributions}
            vessels={vessels}
            berths={berths}
            activeShipId={
              panelTab === "vessel"
                ? (activeVessel?.voyage.voyage_id ?? null)
                : null
            }
            onSelectShip={(id) => select({ kind: "vessel", id })}
            selectedPileId={activePile?.stockpile_id ?? null}
            onSelectPile={(id) => select({ kind: "pile", id })}
            selectedYard={panelTab === "yard" ? activeYard : null}
            onSelectYard={(id) => select({ kind: "yard", id })}
            sort={sort}
            riskFilter={riskFilter}
            unitCount={dangjinPlant?.units.length ?? 0}
            unitLabel={
              dangjinPlant
                ? dangjinPlant.units
                    .map((u) =>
                      u.name.replace(/^당진\s*/, "").replace("호기", ""),
                    )
                    .join("·") + "호기"
                : "발전호기"
            }
            gauge={dangjinGauge}
            yardDeltas={yardDeltas}
            yardForecasts={yardForecasts}
            showSample={showSampleWaiting(live.source)}
            links={links}
            onRefreshLinks={refreshLinks}
            historyDays={horizon}
            panel={
              <SitePanel
                tab={panelTab}
                onTab={setPanelTab}
                vessels={vessels}
                activeVessel={activeVessel}
                onSelectVessel={(id) => select({ kind: "vessel", id })}
                berths={berths}
                recommendFor={recommendFor}
                assignedBerths={assignedBerths}
                onAssign={(voyageId, berthId) => {
                  setAssignedBerths((prev) => ({ ...prev, [voyageId]: berthId }));
                  select({ kind: "vessel", id: voyageId });
                }}
                onUnassign={(voyageId) =>
                  setAssignedBerths((prev) => {
                    const next = { ...prev };
                    delete next[voyageId];
                    return next;
                  })
                }
                supply={supply}
                onRegisterVessel={async (v) => {
                  await registerSupplyVessel(v.voyage, v.berth_id);
                  await supply.refresh();
                }}
                onCorrectUnloading={async (record, cumulative) => {
                  await correctSupplyUnloading(
                    record,
                    new Date().toISOString(),
                    cumulative,
                  );
                  await supply.refresh();
                }}
                yardForecasts={yardForecasts}
                activeYard={activeYard}
                onSelectYard={(id) => select({ kind: "yard", id })}
                transfers={allTransfers}
                transferCapacity={transferCapacity}
                onApplyTransfer={(t) =>
                  setTransfers((prev) => [
                    ...prev,
                    { ...t, id: `sim-${Date.now()}-${prev.length}` },
                  ])
                }
                onUndoTransfer={(id) =>
                  setTransfers((prev) => prev.filter((t) => t.id !== id))
                }
                onSaveTransfer={async (id) => {
                  const t = transfers.find((x) => x.id === id);
                  if (!t) return;
                  const saved = await saveSupplyTransfer(t);
                  setTransfers((prev) =>
                    prev.map((x) =>
                      x.id === id ? { ...x, savedId: saved.id } : x,
                    ),
                  );
                  await supply.refresh();
                }}
                unitNames={unitNames}
                activePile={activePile}
                pileEntries={
                  activePile
                    ? historyForPile(activePile, attributions, horizon)
                    : []
                }
                eligibleNames={activePile ? eligibleNames(activePile) : ""}
                onShowInLedger={() => {
                  setLedgerJump((j) => j + 1);
                  scrollToRef(ledgerRef);
                }}
              />
            }
          />
        </div>
      )}

      {otherYards.length > 0 && (
        <Section
          title={dangjinInView ? "기타 발전소 저탄장" : "저탄장 배치"}
          note="둔덕 크기는 재고량 비례 · Pile에 마우스를 올리면 탄질과 하역 이력, 선택하면 상세"
          action={
            <span className="stockyard-gauge tower-tag">
              상탄 {n(otherGauge, 1)} t/h · SIMULATED
            </span>
          }
        >
          <div className="yard-map">
            {otherYards.map(({ plant, piles: plantPiles }) => (
              <div key={plant.id} className="yard-plant">
                <span>{plant.name}</span>
                <div className="yard-piles">
                  {plantPiles.map((pile) => (
                    <PileButton
                      key={pile.stockpile_id}
                      pile={pile}
                      entries={historyForPile(pile, attributions, horizon)}
                      selected={activePile?.stockpile_id === pile.stockpile_id}
                      restricted={
                        pile.eligible_unit_ids.length < plant.units.length
                      }
                      maxTons={maxPileTons}
                      dimmed={
                        riskFilter !== "all" &&
                        pileRisk(pile).label !== riskFilter
                      }
                      onSelect={() =>
                        select({ kind: "pile", id: pile.stockpile_id })
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="tower-footnote">
            위험도는 적치기간과 탄종(센서가 있으면 온도·CO 포함)으로 계산한
            점수입니다.
          </p>
        </Section>
      )}

      {standalonePile && (
        <Section
          title={`${standalonePile.stockpile_id} · ${standalonePile.coal_type}`}
          note="약도 또는 원장에서 Pile 선택"
        >
          <PileDetail
            pile={standalonePile}
            entries={historyForPile(standalonePile, attributions, horizon)}
            eligibleNames={eligibleNames(standalonePile)}
          />
        </Section>
      )}

      <div className="tower-two stockyard-anchor" ref={forecastRef}>
        <YardForecast
          theme={theme}
          horizon={horizon}
          forecast={scope.forecast}
          requested={contrastLine(scope.forecast).map((c) => c.requested)}
          groups={forecasts}
          baseline={baseline}
          transfersActive={allTransfers.length > 0}
          onSelectGroup={(g) =>
            g.yard
              ? select({ kind: "yard", id: g.yard }, true)
              : setChosen(g.plantId)
          }
        />
        <IncomingTimeline
          rows={incomingSchedule(scope.incoming, horizon)}
          horizon={horizon}
          selectedId={selection?.kind === "vessel" ? selection.id : null}
          onSelect={(id) =>
            vessels.some((v) => v.voyage.voyage_id === id)
              ? select({ kind: "vessel", id }, true)
              : setSelection({ kind: "vessel", id })
          }
        />
      </div>

      <div ref={analysisRef} className="stockyard-anchor">
        <StockyardAnalysis
          theme={theme}
          tab={analysisTab}
          onTab={setAnalysisTab}
          blend={blend}
          groups={groups}
          piles={piles}
          onSelectPile={(id) => select({ kind: "pile", id }, true)}
        />
      </div>

      <div ref={ledgerRef} className="stockyard-anchor">
        <PileLedger
          rows={rows}
          riskFilter={riskFilter}
          selectedId={activePile?.stockpile_id ?? null}
          onSelect={(id) => select({ kind: "pile", id })}
          jump={ledgerJump}
          source={sensed ? "SIMULATED + SENSOR" : "SIMULATED"}
          renderDetail={(row) => (
            <div className="ledger-detail-body">
              <PileDetail
                pile={row.pile}
                entries={historyForPile(row.pile, attributions, horizon)}
                eligibleNames={eligibleNames(row.pile)}
                compact
              />
              <button
                className="site-link-button"
                onClick={() => focusPile(row.pile.stockpile_id)}
              >
                ↑ 약도에서 보기
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
