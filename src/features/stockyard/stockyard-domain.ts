import {
  plantInputs,
  pileRisk,
  voyageTiming,
  weightedCalorific,
} from "../../domain/control-tower.ts";
import {
  BASE_TIME,
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
