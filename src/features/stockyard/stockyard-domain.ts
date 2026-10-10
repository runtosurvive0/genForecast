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
import type { VesselPosition } from "../../domain/ais.ts";

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
  /** 재고일수용 7일 연장 전망 (같은 엔진, horizon + 7일). */
  extended: ReturnType<typeof simulate>;
  /** Plant ids the yard view covers; null means every plant. */
  plantIds: string[] | null;
  horizon: number;
}

/**
 * 저탄장 계산 범위. `plantId`가 없으면 `scopeIds`(앱 공통 조회 범위) 전체,
 * 그것도 없으면 모든 발전소.
 */
export function yardScope(
  plantId: string | null,
  horizon = FORECAST_HORIZON,
  scopeIds?: string[],
): YardScope {
  const allowed = (id: string) =>
    plantId ? id === plantId : !scopeIds || scopeIds.includes(id);
  const plants = plantInputs.filter((p) => allowed(p.id));
  const piles = stockpiles.filter((p) => allowed(p.plant_id));
  const incoming = voyages.filter(
    (v) => v.voyage_status !== "cancelled" && allowed(v.destination_plant_id),
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
    forecast: simulate(plants, cargo, scenario, horizon),
    extended: simulate(plants, cargo, scenario, horizon + WEEK_DAYS),
    plantIds: plantId ? [plantId] : (scopeIds ?? null),
    horizon,
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

function vesselRow(voyage: Voyage): WaitingVesselRow {
  const timing = voyageTiming(voyage);
  return {
    voyage,
    waitH: voyage.expected_port_wait_h,
    berthAt: timing.berth,
    demurrageUsd: timing.demurrageUsd,
    freshnessLabel: freshness(voyage.received_at),
  };
}

/** 대기 발생 선박만 대기시간 순으로 정렬. */
export function waitingVessels(voyages: Voyage[]): WaitingVesselRow[] {
  return voyages
    .filter(
      (v) => v.voyage_status !== "cancelled" && v.expected_port_wait_h > 0,
    )
    .map(vesselRow)
    .sort((a, b) => b.waitH - a.waitH);
}

export const BERTHS = ["BD-1", "BD-2", "BD-3"] as const;

export interface SiteVessel extends WaitingVesselRow {
  /** 부두 접안 하역중 또는 해상(묘박지) 대기. */
  state: "unloading" | "waiting";
  /** 실효 부두: 접안 지정 > 항차 berth_id > BD-1. */
  berth_id: string;
  /** 사용자가 접안 지정한 부두인지. */
  assigned: boolean;
}

/**
 * 당진 약도 선박 (SIMULATED). 하역중 선박이 먼저 부두에 접안하고,
 * 하역중이 아닌 대기 선박은 ETA 순으로 해상에 둔다. 한 항차는 한 번만 나온다.
 */
export function siteVessels(
  unloading: Voyage[],
  waiting: Voyage[],
  assignedBerths: Record<string, string>,
): SiteVessel[] {
  const place = (voyage: Voyage, state: SiteVessel["state"]): SiteVessel => ({
    ...vesselRow(voyage),
    state,
    berth_id: assignedBerths[voyage.voyage_id] ?? voyage.berth_id ?? "BD-1",
    assigned: voyage.voyage_id in assignedBerths,
  });
  const moored = unloading.map((v) => place(v, "unloading"));
  const atSea = waiting
    .filter((v) => !unloading.some((u) => u.voyage_id === v.voyage_id))
    .sort((a, b) => Date.parse(a.ais_eta) - Date.parse(b.ais_eta))
    .map((v) => place(v, "waiting"));
  return [...moored, ...atSea];
}

/**
 * 저탄장 화면 선박의 AIS 출처. 지금은 `voyages` 표본(더미)만 쓴다.
 * 실시간 AIS 연결 시 서버 프록시가 돌려준 `VesselPosition.source`로 교체한다.
 */
export const STOCKYARD_AIS_SOURCE: VesselPosition["source"] = "dummy";

/**
 * 해상 대기 표현용 ‘예시 대기선’ 표시 여부. 더미 AIS 동안은 항상 보이고,
 * 실시간 AIS가 연결되면 실제 대기선만 남기도록 숨긴다.
 */
export function showSampleWaiting(source: VesselPosition["source"]) {
  return source === "dummy";
}

export interface BerthStatus {
  berth_id: string;
  plant_yard: string;
  /** unloading = 접안 하역중, assigned = 대기선 접안 지정, empty = 빈 부두. */
  state: "unloading" | "assigned" | "empty";
  vessel: SiteVessel | null;
}

/** 부두별 점유: 하역중 선박 우선, 없으면 접안 지정된 대기선. */
export function berthOccupancy(vessels: SiteVessel[]): BerthStatus[] {
  return BERTHS.map((berth_id) => {
    const moored = vessels.find(
      (v) => v.state === "unloading" && v.berth_id === berth_id,
    );
    const planned = vessels.find(
      (v) => v.state === "waiting" && v.assigned && v.berth_id === berth_id,
    );
    const vessel = moored ?? planned ?? null;
    return {
      berth_id,
      plant_yard: berthMap[berth_id],
      state: moored ? "unloading" : planned ? "assigned" : "empty",
      vessel,
    };
  });
}

/**
 * 약도 Pile 표현 크기. 닮은꼴 더미의 길이·높이는 부피(재고)의 세제곱근에
 * 비례하므로 폭(flex-grow)과 높이 비율 모두 세제곱근을 쓴다.
 * 높이는 최대 Pile 대비 0.35~1 범위로 작은 Pile도 보이게 한다.
 */
export function pileFootprint(tons: number, maxTons: number) {
  const t = Math.max(0, tons);
  const ratio = maxTons > 0 ? Math.cbrt(t / maxTons) : 0;
  return {
    grow: Math.cbrt(t),
    height: Math.min(1, Math.max(0.35, ratio)),
  };
}

export interface Attribution {
  voyage: Voyage;
  pile: Stockpile;
  tons: number;
}

/**
 * 하역분을 탄종 일치 Pile에 귀속. 동탄종 다수 Pile은
 * 적치일 오래된 순 타이브레이크 후 재고 비례 배분.
 * `berthOf`를 주면 당진은 실효 부두의 처(berthMap) 안 Pile로 먼저 좁히고,
 * 그 처에 같은 탄종이 없을 때만 발전소 전체로 넓힌다.
 */
export function attributeByCoalType(
  piles: Stockpile[],
  voyages: Voyage[],
  berthOf?: (voyage: Voyage) => string | null,
): Attribution[] {
  const out: Attribution[] = [];
  for (const voyage of voyages) {
    if (voyage.voyage_status === "cancelled") continue;
    let matched = piles
      .filter(
        (p) =>
          p.plant_id === voyage.destination_plant_id &&
          p.coal_type === voyage.coal_type,
      )
      .sort((a, b) => Date.parse(a.stacked_at) - Date.parse(b.stacked_at));
    const yard = berthOf ? berthMap[berthOf(voyage) ?? ""] : undefined;
    if (yard) {
      const inYard = matched.filter((p) => p.plant_yard === yard);
      if (inYard.length) matched = inYard;
    }
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
export interface BerthRecommendation {
  berth_id: string;
  reason: string;
}

/**
 * ETA순 부두 추천 (점유 데이터 없이 SIMULATED).
 * 대기선박을 ETA 빠른 순으로 BD-1부터 채운다고 가정하고
 * 지정 항차보다 먼저 끝나는 하역이 있는 부두 중 가장 빠른 곳을 추천.
 */
export function recommendBerth(
  voyage: Voyage,
  waiting: Voyage[],
  berths = ["BD-1", "BD-2", "BD-3"],
): BerthRecommendation {
  const ordered = [...waiting].sort(
    (a, b) => Date.parse(a.ais_eta) - Date.parse(b.ais_eta),
  );
  const rank = ordered.findIndex((v) => v.voyage_id === voyage.voyage_id);
  const berth_id = berths[rank >= 0 ? rank % berths.length : 0];
  return {
    berth_id,
    reason:
      rank <= 0
        ? "ETA가 가장 빨라 첫 번째 빈 부두에 접안"
        : `앞선 대기 ${rank}척 이후 ${berth_id} 접안 가능`,
  };
}

/** AIS ETA 도달(실제 현시각 기준) 당진행 항차를 대기 상태로. */
export function arrivalWaiting(voyages: Voyage[], now = Date.now()) {
  return voyages.filter(
    (v) =>
      v.voyage_status !== "cancelled" &&
      v.destination_plant_id === "dangjin" &&
      Date.parse(v.ais_eta) <= now,
  );
}

export interface HarborMarker {
  kind: "berth" | "waiting" | "unloading";
  id: string;
  label: string;
  x: number;
  y: number;
}

/**
 * 당진 앞바다 확대 그림용 마커 배치 (SIMULATED 좌표).
 * 부두 고정, 선박은 ETA 순으로 접근로에 배치.
 */
export function markerLayout(
  waiting: Voyage[],
  unloading: Voyage[],
): HarborMarker[] {
  const berths: HarborMarker[] = ["BD-1", "BD-2", "BD-3"].map((id, i) => ({
    kind: "berth",
    id,
    label: id,
    x: 20 + i * 30,
    y: 78,
  }));
  const byEta = [...waiting].sort(
    (a, b) => Date.parse(a.ais_eta) - Date.parse(b.ais_eta),
  );
  const ships: HarborMarker[] = [
    ...unloading.map((v, i) => ({
      kind: "unloading" as const,
      id: v.voyage_id,
      label: v.vessel_name,
      x: 20 + (i % 3) * 30,
      y: 64,
    })),
    ...byEta.map((v, i) => ({
      kind: "waiting" as const,
      id: v.voyage_id,
      label: v.vessel_name,
      x: 12 + (i % 5) * 16,
      y: 18 + Math.floor(i / 5) * 14,
    })),
  ];
  return [...berths, ...ships];
}

// ── 처(재고 관리 단위) ───────────────────────────────────────────

export const YARD_NAMES: Record<string, string> = {
  P1: "1발전처",
  P2: "2발전처 · 옥내",
  P3: "3발전처 · 옥내",
};
export const yardShortName = (yard: string) =>
  (YARD_NAMES[yard] ?? yard).split(" · ")[0];

/** 처별 소속 호기 번호 (백엔드 supply.py UNITS와 같은 1~4 / 5~8 / 9~10 구분). */
export const YARD_UNIT_RANGES: Record<string, readonly [number, number]> = {
  P1: [1, 4],
  P2: [5, 8],
  P3: [9, 10],
};

/** 화면 처 ID ↔ `/api/supply` 처 ID. */
export const YARD_GROUP_IDS = {
  P1: "g14",
  P2: "g58",
  P3: "g910",
} as const;
export type SupplyGroupId = (typeof YARD_GROUP_IDS)[keyof typeof YARD_GROUP_IDS];

/** 재고일수 상태 기준 (SPEC §13: 20일 미만 위험, 30일 미만 주의). 설정값으로 교체 가능. */
export const DAYS_THRESHOLDS = { danger: 20, normal: 30 } as const;
export type DaysStatus = "danger" | "warn" | "ok" | "unknown";
export function daysStatus(
  days: number | null,
  thresholds: { danger: number; normal: number } = DAYS_THRESHOLDS,
): DaysStatus {
  if (days === null || !Number.isFinite(days)) return "unknown";
  return days < thresholds.danger
    ? "danger"
    : days < thresholds.normal
      ? "warn"
      : "ok";
}
export const DAYS_STATUS_LABEL: Record<DaysStatus, string> = {
  danger: "위험",
  warn: "주의",
  ok: "안정",
  unknown: "소비 없음",
};

const unitNumber = (name: string) => {
  const match = name.match(/(\d+)\s*호기/);
  return match ? Number(match[1]) : null;
};

export interface StockGroup {
  /** `dangjin:P1` 또는 처가 없는 발전소는 `boryeong`. */
  id: string;
  label: string;
  plantId: string;
  yard: string | null;
  unitIds: string[];
  piles: Stockpile[];
}

/** 재고 관리 단위: 당진은 처(P1~P3), 처 정보가 없는 발전소는 발전소 전체. */
export function stockGroups(plants: Plant[], piles: Stockpile[]): StockGroup[] {
  return plants.flatMap((plant): StockGroup[] => {
    const own = piles.filter((p) => p.plant_id === plant.id);
    if (!own.length) return [];
    const yards = [
      ...new Set(own.map((p) => p.plant_yard).filter((y): y is NonNullable<typeof y> => !!y)),
    ].sort();
    if (!yards.length)
      return [
        {
          id: plant.id,
          label: plant.name,
          plantId: plant.id,
          yard: null,
          unitIds: plant.units.map((u) => u.id),
          piles: own,
        },
      ];
    return yards.map((yard) => {
      const [lo, hi] = YARD_UNIT_RANGES[yard] ?? [1, 0];
      return {
        id: `${plant.id}:${yard}`,
        label: yardShortName(yard),
        plantId: plant.id,
        yard,
        unitIds: plant.units
          .filter((u) => {
            const k = unitNumber(u.name);
            return k !== null && k >= lo && k <= hi;
          })
          .map((u) => u.id),
        piles: own.filter((p) => p.plant_yard === yard),
      };
    });
  });
}

/**
 * 호기별 일 계획 발전량(MWh). simulate와 같은 가정: 09:00 기준 일 구간,
 * 출력 = 용량 × 부하율, 계획정지 구간(겹침은 한 번만) 제외.
 */
export function unitDailyMwh(plant: Plant, days: number): Record<string, number[]> {
  const base = Date.parse(BASE_TIME);
  return Object.fromEntries(
    plant.units.map((unit) => {
      const mw =
        (Math.max(0, unit.capacityMw) * Math.min(100, Math.max(0, unit.loadPct))) / 100;
      return [
        unit.id,
        Array.from({ length: days }, (_, d) => {
          const start = base + d * DAY;
          const end = start + DAY;
          const spans = unit.outages
            .map((o) => [Math.max(start, Date.parse(o.startAt)), Math.min(end, Date.parse(o.endAt))])
            .filter(([a, b]) => b > a)
            .sort((a, b) => a[0] - b[0]);
          let blocked = 0;
          let cursor = start;
          for (const [a, b] of spans) {
            const from = Math.max(a, cursor);
            if (b > from) blocked += b - from;
            cursor = Math.max(cursor, b);
          }
          return (mw * (DAY - blocked)) / HOUR;
        }),
      ];
    }),
  );
}

/** 처 간 이탄 (모의 또는 백엔드 저장분). */
export interface SimTransfer {
  id: string;
  /** 처 ID (P1~P3). */
  from: string;
  to: string;
  tons: number;
  /** ISO 8601. 기본 BASE_TIME. */
  at: string;
  note: string;
  /** `/api/supply/transfers` 저장 번호. 없으면 화면 모의. */
  savedId?: number;
}

export interface GroupDay {
  date: string;
  stockTons: number;
  inboundTons: number;
  useTons: number;
  transferTons: number;
  shortTons: number;
  days: number | null;
}

export interface GroupForecast {
  group: StockGroup;
  currentTons: number;
  /** 현재 재고 ÷ 첫날 예상 사용량. 사용량 0이면 null. */
  currentDays: number | null;
  /** 기간 내 일말 재고 ÷ 다음 7일 평균 사용량의 최저. */
  minDays: { days: number; date: string } | null;
  firstShortageDate: string | null;
  status: DaysStatus;
  daily: GroupDay[];
}

/**
 * 처(또는 발전소)별 재고 전망. 발전소 엔진(simulate)의 일별 요청 연료를
 * 소속 호기 계획 발전량 비중으로 나누므로 엔진을 복제하지 않는다.
 * 입하는 하역 완료일에 실효 부두의 처로, 이탄은 해당 일 시작에 반영한다
 * (기준시각 이전 이탄은 이미 Pile 재고에 들어 있으므로 제외).
 * 처별 부족이 없으면 처 합계 = 발전소 전망 재고.
 */
export function groupForecasts(
  groups: StockGroup[],
  scope: Pick<YardScope, "extended" | "incoming" | "horizon">,
  berthOf: (voyage: Voyage) => string | null = (v) => v.berth_id,
  transfers: SimTransfer[] = [],
): GroupForecast[] {
  const base = Date.parse(BASE_TIME);
  const span = scope.horizon + WEEK_DAYS;
  const mwhByPlant = new Map<string, Record<string, number[]>>();
  for (const plantId of new Set(groups.map((g) => g.plantId))) {
    const plant = plantInputs.find((p) => p.id === plantId);
    if (plant) mwhByPlant.set(plantId, unitDailyMwh(plant, span));
  }
  const dayIndex = (at: number) =>
    Math.min(span - 1, Math.max(0, Math.floor((at - base) / DAY)));
  return groups.map((group) => {
    const plantDaily =
      scope.extended.byPlant.find((p) => p.plantId === group.plantId)?.daily ?? [];
    const mwh = mwhByPlant.get(group.plantId) ?? {};
    const use = Array.from({ length: span }, (_, d) => {
      const total = Object.values(mwh).reduce((s, u) => s + (u[d] ?? 0), 0);
      const own = group.unitIds.reduce((s, id) => s + (mwh[id]?.[d] ?? 0), 0);
      return total > 0 ? (plantDaily[d]?.requestedFuelTons ?? 0) * (own / total) : 0;
    });
    const inbound = new Array(span).fill(0);
    for (const voyage of scope.incoming) {
      if (voyage.destination_plant_id !== group.plantId) continue;
      if (group.yard && berthMap[berthOf(voyage) ?? ""] !== group.yard) continue;
      const at = Date.parse(voyage.forecast_unload_end);
      if (at < base || at > base + span * DAY) continue;
      inbound[dayIndex(at)] += voyage.cargo_t;
    }
    const moved = new Array(span).fill(0);
    if (group.yard)
      for (const t of transfers) {
        const tons = Number.isFinite(t.tons) && t.tons > 0 ? t.tons : 0;
        // 기준시각 이전 이탄은 이미 Pile 재고에 반영된 것으로 본다.
        if (!tons || t.from === t.to || Date.parse(t.at) < base) continue;
        const d = dayIndex(Date.parse(t.at));
        if (t.from === group.yard) moved[d] -= tons;
        if (t.to === group.yard) moved[d] += tons;
      }
    const currentTons = group.piles.reduce((s, p) => s + p.on_hand_t, 0);
    let stock = currentTons;
    const rows: GroupDay[] = [];
    for (let d = 0; d < span; d++) {
      stock += inbound[d] + moved[d];
      const available = Math.max(0, stock);
      const consumed = Math.min(available, use[d]);
      stock = available - consumed;
      rows.push({
        date: plantDaily[d]?.date ?? "",
        stockTons: stock,
        inboundTons: inbound[d],
        useTons: use[d],
        transferTons: moved[d],
        shortTons: use[d] - consumed,
        days: null,
      });
    }
    for (let d = 0; d < scope.horizon; d++) {
      const ahead = use.slice(d + 1, d + 1 + WEEK_DAYS);
      const avg = ahead.length === WEEK_DAYS ? ahead.reduce((s, v) => s + v, 0) / WEEK_DAYS : 0;
      rows[d].days = avg > 0 ? rows[d].stockTons / avg : null;
    }
    const daily = rows.slice(0, scope.horizon);
    const currentDays = use[0] > 0 ? currentTons / use[0] : null;
    const minDays = daily.reduce<GroupForecast["minDays"]>(
      (min, row) =>
        row.days !== null && (min === null || row.days < min.days)
          ? { days: row.days, date: row.date }
          : min,
      null,
    );
    const lowest = [currentDays, minDays?.days ?? null]
      .filter((v): v is number => v !== null)
      .reduce<number | null>((m, v) => (m === null || v < m ? v : m), null);
    return {
      group,
      currentTons,
      currentDays,
      minDays,
      firstShortageDate: daily.find((r) => r.shortTons > 1e-6)?.date ?? null,
      status: daysStatus(lowest),
      daily,
    };
  });
}

// ── 입하·하역 타임라인 ────────────────────────────────────────────

export interface TimelineRow {
  voyage: Voyage;
  eta: string;
  berthAt: string;
  unloadEnd: string;
  /** 기간 [기준시각, 기준시각 + horizon] 대비 0~1 위치. */
  wait: [number, number] | null;
  unload: [number, number];
  reflect: number;
}

/** 하역 완료가 기간 안인 항차의 대기·하역 구간 (취소 제외, 하역 완료 순). */
export function incomingSchedule(voyages: Voyage[], horizon = FORECAST_HORIZON): TimelineRow[] {
  const base = Date.parse(BASE_TIME);
  const end = base + horizon * DAY;
  const pos = (at: number) => Math.min(1, Math.max(0, (at - base) / (end - base)));
  return incomingTimeline(voyages, horizon).map(({ voyage, at }) => {
    const timing = voyageTiming(voyage);
    const eta = Date.parse(timing.eta);
    const berth = Math.min(Date.parse(timing.berth), at);
    return {
      voyage,
      eta: timing.eta,
      berthAt: timing.berth,
      unloadEnd: voyage.forecast_unload_end,
      wait: berth > eta && berth > base ? [pos(eta), pos(berth)] : null,
      unload: [pos(berth), pos(at)],
      reflect: pos(at),
    };
  });
}

// ── Pile 원장 ────────────────────────────────────────────────────

export type LedgerKey =
  | "id"
  | "yard"
  | "coal"
  | "tons"
  | "cv"
  | "age"
  | "risk"
  | "burn"
  | "after"
  | "incoming";

export interface LedgerRow {
  pile: Stockpile;
  plantName: string;
  yard: string;
  age: number;
  riskScore: number;
  riskLabel: string;
  burnedTons: number;
  afterTons: number;
  /** 기간 내 하역 예정 귀속량 (기준시각 이후). */
  incomingTons: number;
}

export function ledgerRows(
  piles: Stockpile[],
  plants: { id: string; name: string }[],
  blend: ReturnType<typeof pileBlend>,
  attributions: Attribution[],
  horizon = FORECAST_HORIZON,
): LedgerRow[] {
  const base = Date.parse(BASE_TIME);
  return piles.map((pile) => {
    const risk = pileRisk(pile);
    const row = blend.rows.find((r) => r.stockpile_id === pile.stockpile_id);
    return {
      pile,
      plantName: plants.find((p) => p.id === pile.plant_id)?.name ?? pile.plant_id,
      yard: pile.plant_yard ? yardShortName(pile.plant_yard) : "-",
      age: risk.age,
      riskScore: risk.score,
      riskLabel: risk.label,
      burnedTons: row?.burnedTons ?? 0,
      afterTons: row?.afterTons ?? pile.on_hand_t,
      incomingTons: attributions
        .filter((a) => {
          const at = Date.parse(a.voyage.forecast_unload_end);
          return (
            a.pile.stockpile_id === pile.stockpile_id &&
            at >= base &&
            at <= base + horizon * DAY
          );
        })
        .reduce((s, a) => s + a.tons, 0),
    };
  });
}

export function sortLedger(rows: LedgerRow[], key: LedgerKey, dir: "asc" | "desc") {
  const value = (r: LedgerRow): number | string =>
    key === "id"
      ? r.pile.stockpile_id
      : key === "yard"
        ? `${r.plantName}${r.yard}`
        : key === "coal"
          ? r.pile.coal_type
          : key === "tons"
            ? r.pile.on_hand_t
            : key === "cv"
              ? r.pile.calorific_value_kcal_kg
              : key === "age"
                ? r.age
                : key === "risk"
                  ? r.riskScore
                  : key === "burn"
                    ? r.burnedTons
                    : key === "after"
                      ? r.afterTons
                      : r.incomingTons;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "ko");
    return c !== 0 ? c * sign : a.pile.stockpile_id.localeCompare(b.pile.stockpile_id);
  });
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** 원장 CSV. 첫 줄에 기준시각·데이터 구분을 남긴다. */
export function ledgerCsv(rows: LedgerRow[], source = "SIMULATED") {
  const header = [
    "stockpile_id",
    "plant",
    "yard",
    "coal_type",
    "on_hand_t",
    "calorific_value_kcal_kg",
    "moisture_pct",
    "ash_pct",
    "sulfur_pct",
    "age_days",
    "risk_score",
    "risk_label",
    "weekly_burn_t",
    "after_burn_t",
    "incoming_t",
  ];
  const lines = rows.map((r) =>
    [
      r.pile.stockpile_id,
      r.plantName,
      r.yard,
      r.pile.coal_type,
      Math.round(r.pile.on_hand_t),
      r.pile.calorific_value_kcal_kg,
      r.pile.moisture_pct,
      r.pile.ash_pct,
      r.pile.sulfur_pct,
      r.age,
      r.riskScore,
      r.riskLabel,
      Math.round(r.burnedTons),
      Math.round(r.afterTons),
      Math.round(r.incomingTons),
    ]
      .map(csvCell)
      .join(","),
  );
  return [`# 기준시각 ${BASE_TIME} · ${source}`, header.join(","), ...lines].join("\n");
}

// ── 저탄장 알림 ──────────────────────────────────────────────────

export type StockyardTarget =
  | { kind: "vessel"; id: string }
  | { kind: "yard"; id: string }
  | { kind: "pile"; id: string };

export interface StockyardAlert {
  level: "danger" | "warn" | "info";
  text: string;
  target: StockyardTarget | null;
}

/** 화면 규칙으로 만든 알림 (운영 지시 아님). 위험 → 주의 → 정보 순. */
export function stockyardAlerts({
  forecasts,
  piles,
  vessels,
  transferOver,
}: {
  forecasts: GroupForecast[];
  piles: Stockpile[];
  vessels: SiteVessel[];
  transferOver: boolean;
}): StockyardAlert[] {
  const out: StockyardAlert[] = [];
  const fmtDays = (d: number) => `${Math.round(d * 10) / 10}일`;
  const yardTarget = (g: StockGroup): StockyardTarget | null =>
    g.yard ? { kind: "yard", id: g.yard } : null;
  for (const f of forecasts) {
    if (f.firstShortageDate)
      out.push({
        level: "danger",
        text: `${f.group.label} ${f.firstShortageDate.slice(5).replace("-", "/")} 재고 소진 예상`,
        target: yardTarget(f.group),
      });
    else if (f.status === "danger" || f.status === "warn") {
      const days = Math.min(
        f.currentDays ?? Infinity,
        f.minDays?.days ?? Infinity,
      );
      out.push({
        level: f.status === "danger" ? "danger" : "warn",
        text: `${f.group.label} 재고일수 ${fmtDays(days)} (${DAYS_STATUS_LABEL[f.status]})`,
        target: yardTarget(f.group),
      });
    }
  }
  for (const pile of piles) {
    const risk = pileRisk(pile);
    if (risk.label === "높음")
      out.push({
        level: "warn",
        text: `${pile.stockpile_id} 고위험 ${risk.score}점 · ${risk.age}일 적치`,
        target: { kind: "pile", id: pile.stockpile_id },
      });
  }
  for (const v of vessels) {
    if (v.demurrageUsd > 0)
      out.push({
        level: "warn",
        text: `${v.voyage.vessel_name} 체선료 $${Math.round(v.demurrageUsd).toLocaleString("ko-KR")}`,
        target: { kind: "vessel", id: v.voyage.voyage_id },
      });
    if (v.freshnessLabel === "STALE")
      out.push({
        level: "info",
        text: `${v.voyage.vessel_name} AIS STALE`,
        target: { kind: "vessel", id: v.voyage.voyage_id },
      });
  }
  if (transferOver)
    out.push({ level: "warn", text: "처 간 이탄 가용 초과", target: null });
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ── 외부 연계 매핑 (서버 응답 → 화면 계약) ─────────────────────────

export interface SupplyTransferRecord {
  id: number;
  at: string;
  from_group: string;
  to_group: string;
  tonnes: number;
  note: string;
}

const groupToYard = (group: string) =>
  (Object.entries(YARD_GROUP_IDS).find(([, g]) => g === group)?.[0] ?? null);

/** 화면 이탄 → `POST /api/supply/transfers` 본문. */
export function toSupplyTransfer(t: SimTransfer) {
  const from = YARD_GROUP_IDS[t.from as keyof typeof YARD_GROUP_IDS];
  const to = YARD_GROUP_IDS[t.to as keyof typeof YARD_GROUP_IDS];
  if (!from || !to) throw new RangeError(`처 ID를 확인하세요: ${t.from} → ${t.to}`);
  return { at: t.at, from_group: from, to_group: to, tonnes: t.tons, note: t.note };
}

/** `/api/supply/records`의 이탄 원장 → 화면 이탄. 매핑 없는 처는 제외. */
export function fromSupplyTransfers(rows: SupplyTransferRecord[]): SimTransfer[] {
  return rows.flatMap((r) => {
    const from = groupToYard(r.from_group);
    const to = groupToYard(r.to_group);
    return from && to
      ? [{ id: `db-${r.id}`, from, to, tons: r.tonnes, at: r.at, note: r.note, savedId: r.id }]
      : [];
  });
}

export interface SupplyVesselRecord {
  id: number;
  name: string;
  cargo: number;
  arrival_at: string;
  points: {
    at: string;
    cumulative: number;
    rate: number;
    allocations: Record<string, number>;
  }[];
}

/** 백엔드 하역 원장의 누적 하역량 (supply.py `unloading`과 같은 규칙, 처 배분 제외). */
export function supplyCumulative(vessel: SupplyVesselRecord, at: string) {
  const time = Date.parse(at);
  const points = [...vessel.points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = points.filter((p) => Date.parse(p.at) <= time).at(-1);
  if (!last) return 0;
  const hours = (time - Date.parse(last.at)) / HOUR;
  return Math.min(vessel.cargo, last.cumulative + last.rate * hours);
}

/** 화면 항차 → `POST /api/supply/vessels` 본문. 하역속도는 접안~하역 완료 평균. */
export function toSupplyVessel(voyage: Voyage, berthId: string) {
  const timing = voyageTiming(voyage);
  const start = Date.parse(timing.berth);
  const end = Date.parse(voyage.forecast_unload_end);
  const hours = (end - start) / HOUR;
  const yard = berthMap[berthId];
  return {
    name: voyage.vessel_name,
    cargo: voyage.cargo_t,
    incoming_cv: voyage.calorific_value_kcal_kg,
    arrival_at: timing.eta,
    start_at: timing.berth,
    rate: hours > 0 ? voyage.cargo_t / hours : 0,
    allocations: Object.fromEntries(
      Object.entries(YARD_GROUP_IDS).map(([y, g]) => [g, y === yard ? 1 : 0]),
    ) as Record<SupplyGroupId, number>,
  };
}

/** 센서 측정값 (제안 계약, README §3.6). */
export interface SensorReading {
  stockpile_id: string;
  measured_at: string;
  temperature_c: number | null;
  co_ppm: number | null;
  sensor_id?: string;
  source?: string;
}

/**
 * Pile에 센서 값을 합친다. 같은 Pile의 여러 센서는 최댓값,
 * `staleHours`보다 오래된 측정은 버린다 (최신성 규칙).
 */
export function mergeSensorReadings(
  piles: Stockpile[],
  readings: SensorReading[],
  now = Date.now(),
  staleHours = 6,
) {
  const fresh = readings.filter(
    (r) => now - Date.parse(r.measured_at) <= staleHours * HOUR && Date.parse(r.measured_at) <= now,
  );
  const max = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.max(a, b);
  return piles.map((pile) => {
    const own = fresh.filter((r) => r.stockpile_id === pile.stockpile_id);
    if (!own.length) return pile;
    return {
      ...pile,
      temperature_c: own.reduce<number | null>((m, r) => max(m, r.temperature_c), null),
      co_ppm: own.reduce<number | null>((m, r) => max(m, r.co_ppm), null),
    };
  });
}

/**
 * 실시간 AIS 위치를 항차에 합친다 (MMSI 일치). 하나라도 합쳐지면 화면 출처는 aisstream.
 */
export function mergeAisPositions(
  voyageRows: Voyage[],
  positions: Omit<VesselPosition, "freshness">[],
): { voyages: Voyage[]; source: VesselPosition["source"] } {
  const live = positions.filter((p) => p.source === "aisstream");
  let matched = 0;
  const merged = voyageRows.map((v) => {
    const p = live.find((x) => x.mmsi === v.mmsi);
    if (!p) return v;
    matched++;
    return {
      ...v,
      latitude: p.latitude,
      longitude: p.longitude,
      sog_kn: p.sog_kn ?? v.sog_kn,
      cog_deg: p.cog_deg ?? v.cog_deg,
      received_at: p.received_at,
    };
  });
  return { voyages: merged, source: matched ? "aisstream" : "dummy" };
}

/**
 * 처별 주간 소진: 처 전망의 첫 7일 사용량을 그 처 Pile에만, 그 처 소속 호기
 * 기준으로 배분한다. 재고 전망(groupForecasts)과 같은 사용량을 쓰므로 두 화면이 일치한다.
 */
export function groupWeeklyBurn(
  forecasts: GroupForecast[],
  shares: Record<string, number>,
): { pile: Stockpile; tons: number }[] {
  return forecasts.flatMap((f) => {
    const tons = f.daily.slice(0, WEEK_DAYS).reduce((s, d) => s + d.useTons, 0);
    const units = new Set(f.group.unitIds);
    const scoped = f.group.piles.map((p) => ({
      ...p,
      eligible_unit_ids: p.eligible_unit_ids.filter((id) => units.has(id)),
    }));
    return allocateBurn(scoped, shares, tons).map((b) => ({
      pile: f.group.piles.find((p) => p.stockpile_id === b.pile.stockpile_id)!,
      tons: b.tons,
    }));
  });
}

// ── 연계 응답 검증: 형식이 다른 응답이 와도 화면이 멈추지 않게 유효한 항목만 남긴다 ──

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown) => (isNum(v) ? v : null);
const listOf = (body: unknown, key: string): unknown[] =>
  Array.isArray(body) ? body : isRecord(body) && Array.isArray(body[key]) ? body[key] : [];

/** `/api/supply/records` 응답 → 유효한 이탄·선박 원장만. */
export function normalizeSupplyRecords(body: unknown): {
  transfers: SupplyTransferRecord[];
  vessels: SupplyVesselRecord[];
} {
  const transfers = listOf(body, "transfers").flatMap((r): SupplyTransferRecord[] =>
    isRecord(r) &&
    isNum(r.id) &&
    isTime(r.at) &&
    typeof r.from_group === "string" &&
    typeof r.to_group === "string" &&
    isNum(r.tonnes)
      ? [
          {
            id: r.id,
            at: r.at,
            from_group: r.from_group,
            to_group: r.to_group,
            tonnes: r.tonnes,
            note: typeof r.note === "string" ? r.note : "",
          },
        ]
      : [],
  );
  const vessels = listOf(body, "vessels").flatMap((v): SupplyVesselRecord[] =>
    isRecord(v) && isNum(v.id) && typeof v.name === "string" && isNum(v.cargo)
      ? [
          {
            id: v.id,
            name: v.name,
            cargo: v.cargo,
            arrival_at: isTime(v.arrival_at) ? v.arrival_at : "",
            points: (Array.isArray(v.points) ? v.points : []).flatMap((p) =>
              isRecord(p) && isTime(p.at) && isNum(p.cumulative) && isNum(p.rate)
                ? [
                    {
                      at: p.at,
                      cumulative: p.cumulative,
                      rate: p.rate,
                      allocations: isRecord(p.allocations)
                        ? Object.fromEntries(
                            Object.entries(p.allocations).filter(([, x]) => isNum(x)),
                          ) as Record<string, number>
                        : {},
                    },
                  ]
                : [],
            ),
          },
        ]
      : [],
  );
  return { transfers, vessels };
}

/** AIS 응답 → 유효한 위치만 (9자리 MMSI, 위경도 범위, 수신시각). */
export function normalizeAisPositions(body: unknown): Omit<VesselPosition, "freshness">[] {
  return listOf(body, "positions").flatMap((p): Omit<VesselPosition, "freshness">[] => {
    if (!isRecord(p)) return [];
    const mmsi = String(p.mmsi ?? "");
    if (
      !/^\d{9}$/.test(mmsi) ||
      !isNum(p.latitude) ||
      !isNum(p.longitude) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      !isTime(p.received_at)
    )
      return [];
    return [
      {
        vessel_id: String(p.vessel_id ?? mmsi),
        mmsi,
        received_at: p.received_at,
        latitude: p.latitude,
        longitude: p.longitude,
        sog_kn: numOrNull(p.sog_kn),
        cog_deg: numOrNull(p.cog_deg),
        source: p.source === "aisstream" ? "aisstream" : "dummy",
      },
    ];
  });
}

/** 센서 응답 → 유효한 측정만 (Pile ID, 측정시각, 숫자 또는 null). */
export function normalizeSensorReadings(body: unknown): SensorReading[] {
  return listOf(body, "readings").flatMap((r): SensorReading[] =>
    isRecord(r) && typeof r.stockpile_id === "string" && isTime(r.measured_at)
      ? [
          {
            stockpile_id: r.stockpile_id,
            measured_at: r.measured_at,
            temperature_c: numOrNull(r.temperature_c),
            co_ppm: numOrNull(r.co_ppm),
            sensor_id: typeof r.sensor_id === "string" ? r.sensor_id : undefined,
            source: typeof r.source === "string" ? r.source : undefined,
          },
        ]
      : [],
  );
}
