import {
  plantInputs,
  pileRisk,
  voyageTiming,
  weightedCalorific,
  towerSummary,
  fuelFromGeneration,
  freshness,
} from "../../domain/control-tower.ts";
import {
  BASE_TIME,
  scenarioDefaults,
  simulate,
  type Plant,
  type Scenario,
  type Shipment,
} from "../../domain/operations.ts";
import {
  stockpiles,
  voyages,
  type Stockpile,
  type Voyage,
} from "../../data/control-tower.ts";

const DAY = 86400000;
const HOUR = 3600000;
export const FORECAST_HORIZON = 30;
const WEEK_DAYS = 7;

/**
 * Share of the weekly energy demand each unit would serve in the current
 * load sample, respecting planned-outage hours inside the week.
 */
export function weeklyBurnShares(
  plants: Plant[],
  unitIds: string[],
): Record<string, number> {
  const base = Date.parse(BASE_TIME);
  const weekEnd = base + WEEK_DAYS * DAY;
  const shares: Record<string, number> = {};
  for (const plant of plants)
    for (const unit of plant.units)
      if (unitIds.includes(unit.id)) {
        const blockedHours = unit.outages.reduce((blocked, outage) => {
          const start = Math.max(Date.parse(outage.startAt), base);
          const end = Math.min(Date.parse(outage.endAt), weekEnd);
          return blocked + Math.max(0, end - start) / HOUR;
        }, 0);
        const availableHours = WEEK_DAYS * 24 - blockedHours;
        const plannedOutputMw = (unit.capacityMw * unit.loadPct) / 100;
        shares[unit.id] = Math.max(0, plannedOutputMw * availableHours);
      }
  const total = Object.values(shares).reduce((sum, v) => sum + v, 0);
  if (total <= 0) return {};
  for (const id of Object.keys(shares)) shares[id] /= total;
  return shares;
}

export interface YardScope {
  piles: Stockpile[];
  incoming: Voyage[];
  forecast: ReturnType<typeof simulate>;
  /** Plant ids the yard view covers; null means every plant. */
  plantIds: string[] | null;
}

export function yardScope(plantId: string | null): YardScope {
  const plants = plantId
    ? plantInputs.filter((p) => p.id === plantId)
    : plantInputs;
  const piles = stockpiles.filter((p) => !plantId || p.plant_id === plantId);
  const incoming = voyages.filter(
    (v) =>
      v.voyage_status !== "cancelled" &&
      (!plantId || v.destination_plant_id === plantId),
  );
  const cargo: Shipment[] = incoming.map((v) => ({
    id: v.voyage_id,
    plantId: v.destination_plant_id,
    vesselName: v.vessel_name,
    origin: v.origin_port,
    tons: v.cargo_t,
    arrivalAt: voyageTiming(v).eta,
    dischargeCompleteAt: v.forecast_unload_end,
    status: "항해 중",
  }));
  const scenario: Scenario = {
    loadChangePct: 0,
    arrivalDelayDays: 0,
    includeInbound: true,
  };
  return {
    piles,
    incoming,
    forecast: simulate(plants, cargo, scenario, FORECAST_HORIZON),
    plantIds: plantId ? [plantId] : null,
  };
}

export function orderPiles(
  piles: Stockpile[],
  sort: "tons" | "age" | "risk",
  filter: "all" | "낮음" | "관찰" | "높음",
): Stockpile[] {
  const visible =
    filter === "all"
      ? piles
      : piles.filter((pile) => pileRisk(pile).label === filter);
  const key = (pile: Stockpile) => {
    const risk = pileRisk(pile);
    if (sort === "tons") return -pile.on_hand_t;
    if (sort === "age") return -risk.age;
    return -risk.score;
  };
  return [...visible].sort((a, b) => key(a) - key(b));
}

/**
 * Split a weekly burn across eligible piles, weighted by unit share × stock.
 * Piles that hit their stock cap redistribute the remainder to the others,
 * so the returned total equals burnTons as long as eligible stock covers it.
 */
export function allocateBurn(
  piles: Stockpile[],
  shares: Record<string, number>,
  burnTons: number,
): { pile: Stockpile; tons: number }[] {
  if (burnTons <= 0) return [];
  let remaining = burnTons;
  let open = piles
    .map((pile) => ({
      pile,
      weight:
        pile.eligible_unit_ids
          .filter((id) => shares[id])
          .reduce((sum, id) => sum + shares[id], 0) * pile.on_hand_t,
    }))
    .filter((entry) => entry.weight > 0);
  const result = new Map<string, number>();
  while (remaining > 0 && open.length) {
    const total = open.reduce((sum, entry) => sum + entry.weight, 0);
    const capped = open.filter(
      (entry) =>
        (result.get(entry.pile.stockpile_id) ?? 0) +
          (remaining * entry.weight) / total >=
        entry.pile.on_hand_t,
    );
    if (!capped.length) {
      for (const entry of open)
        result.set(
          entry.pile.stockpile_id,
          (result.get(entry.pile.stockpile_id) ?? 0) +
            (remaining * entry.weight) / total,
        );
      break;
    }
    for (const entry of capped) {
      remaining -=
        entry.pile.on_hand_t - (result.get(entry.pile.stockpile_id) ?? 0);
      result.set(entry.pile.stockpile_id, entry.pile.on_hand_t);
    }
    const closed = new Set(capped.map((entry) => entry.pile.stockpile_id));
    open = open.filter((entry) => !closed.has(entry.pile.stockpile_id));
  }
  return piles
    .filter((pile) => (result.get(pile.stockpile_id) ?? 0) > 0)
    .map((pile) => ({ pile, tons: result.get(pile.stockpile_id)! }));
}

/** Blend quality before/after a one-week burn, per pile and weighted. */
export function pileBlend(
  piles: Stockpile[],
  burned: { pile: Stockpile; tons: number }[],
) {
  const rows = piles.map((pile) => {
    const use = burned.find((b) => b.pile.stockpile_id === pile.stockpile_id);
    const tons = Math.min(pile.on_hand_t, use?.tons ?? 0);
    return {
      stockpile_id: pile.stockpile_id,
      beforeTons: pile.on_hand_t,
      burnedTons: tons,
      afterTons: pile.on_hand_t - tons,
      cv: pile.calorific_value_kcal_kg,
    };
  });
  return {
    rows,
    burnTotal: rows.reduce((sum, row) => sum + row.burnedTons, 0),
    beforeCv: weightedCalorific(
      rows.map((row) => ({ tons: row.beforeTons, cv: row.cv })),
    ),
    afterCv: weightedCalorific(
      rows.map((row) => ({ tons: row.afterTons, cv: row.cv })),
    ),
  };
}

export function incomingTimeline(voyages: Voyage[], days = FORECAST_HORIZON) {
  const base = Date.parse(BASE_TIME);
  return voyages
    .map((voyage) => ({
      voyage,
      at: Date.parse(voyage.forecast_unload_end),
    }))
    .filter((entry) => entry.at >= base && entry.at <= base + days * DAY)
    .sort((a, b) => a.at - b.at);
}
/** 1:1 부두→발전처 고정 매핑 (SIMULATED). */
export const berthMap: Record<string, string> = {
  "BD-1": "P1",
  "BD-2": "P2",
  "BD-3": "P3",
};

export interface WaitingVesselRow {
  voyage: Voyage;
  waitH: number;
  berthAt: string;
  demurrageUsd: number;
  freshnessLabel: string;
}

/** 대기 발생 선박만 대기시간 순으로 정렬. */
export function waitingVessels(voyages: Voyage[]): WaitingVesselRow[] {
  return voyages
    .filter(
      (v) => v.voyage_status !== "cancelled" && v.expected_port_wait_h > 0,
    )
    .map((voyage) => {
      const timing = voyageTiming(voyage);
      return {
        voyage,
        waitH: voyage.expected_port_wait_h,
        berthAt: timing.berth,
        demurrageUsd: timing.demurrageUsd,
        freshnessLabel: freshness(voyage.received_at),
      };
    })
    .sort((a, b) => b.waitH - a.waitH);
}

export interface Attribution {
  voyage: Voyage;
  pile: Stockpile;
  tons: number;
}

/**
 * 하역분을 탄종 일치 Pile에 귀속. 동탄종 다수 Pile은
 * 적치일 오래된 순 타이브레이크 후 재고 비례 배분.
 */
export function attributeByCoalType(
  piles: Stockpile[],
  voyages: Voyage[],
): Attribution[] {
  const out: Attribution[] = [];
  for (const voyage of voyages) {
    if (voyage.voyage_status === "cancelled") continue;
    const matched = piles
      .filter(
        (p) =>
          p.plant_id === voyage.destination_plant_id &&
          p.coal_type === voyage.coal_type,
      )
      .sort((a, b) => Date.parse(a.stacked_at) - Date.parse(b.stacked_at));
    const total = matched.reduce((s, p) => s + p.on_hand_t, 0);
    if (!total) continue;
    for (const pile of matched)
      out.push({
        voyage,
        pile,
        tons: (voyage.cargo_t * pile.on_hand_t) / total,
      });
  }
  return out;
}

export interface HistoryEntry {
  voyage_id: string;
  vessel_name: string;
  unloaded_at: string;
  tons: number;
  coal_type: string;
  calorific_value_kcal_kg: number;
  moisture_pct: number;
  ash_pct: number;
  sulfur_pct: number;
}

/** Pile별 30일 하역 이력, 하역일 역순. */
export function historyForPile(
  pile: Stockpile,
  attributions: Attribution[],
  days = FORECAST_HORIZON,
): HistoryEntry[] {
  const base = Date.parse(BASE_TIME);
  return attributions
    .filter((a) => a.pile.stockpile_id === pile.stockpile_id)
    .map((a) => ({
      voyage_id: a.voyage.voyage_id,
      vessel_name: a.voyage.vessel_name,
      unloaded_at: a.voyage.forecast_unload_end,
      tons: a.tons,
      coal_type: a.voyage.coal_type,
      calorific_value_kcal_kg: a.voyage.calorific_value_kcal_kg,
      moisture_pct: a.voyage.moisture_pct,
      ash_pct: a.voyage.ash_pct,
      sulfur_pct: a.voyage.sulfur_pct,
    }))
    .filter(
      ({ unloaded_at }) =>
        Date.parse(unloaded_at) >= base &&
        Date.parse(unloaded_at) <= base + days * DAY,
    )
    .sort((a, b) => Date.parse(b.unloaded_at) - Date.parse(a.unloaded_at));
}

/** 실시간 상탄 게이지: 현재 출력의 t/h 환산치 (SIMULATED). */
export function gaugeValue(plants: Plant[]): number {
  const summary = towerSummary(plants, scenarioDefaults, 1);
  return plants.reduce((sum, plant) => {
    const outputMw = summary.units
      .filter((u) => u.plantId === plant.id)
      .reduce((s, u) => s + u.currentGenerationMw, 0);
    return (
      sum +
      fuelFromGeneration(
        outputMw,
        1 / (0.001163 * plant.efficiency),
        plant.calorificKcalKg,
      )
    );
  }, 0);
}

/** 전망 차트 대비선: 요청 연료 vs 실제 소진. */
export function contrastLine(forecast: ReturnType<typeof simulate>) {
  return forecast.daily.map((d) => ({
    date: d.date,
    requested: d.requestedFuelTons,
    burned: d.fuelUseTons,
  }));
}

export interface TransferResult {
  tons: number;
  capacity: number;
  overCapacity: boolean;
}

/** 수기 이탄 입력: 초과 차단 없이 경고 플래그만 반환. */
export function transferTons(inputTons: number, capacityTons: number) {
  const tons =
    Number.isFinite(inputTons) && inputTons > 0 ? inputTons : 0;
  const capacity =
    Number.isFinite(capacityTons) && capacityTons > 0 ? capacityTons : 0;
  const result: TransferResult = {
    tons,
    capacity,
    overCapacity: tons > capacity,
  };
  return result;
}
