export interface Outage {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  reason: string;
}
export interface Unit {
  id: string;
  name: string;
  capacityMw: number;
  loadPct: number;
  outages: Outage[];
}
export interface Plant {
  id: string;
  name: string;
  region: string;
  inventoryTons: number;
  calorificKcalKg: number;
  efficiency: number;
  lowStockDays: number;
  units: Unit[];
}
export interface Shipment {
  id: string;
  plantId: string;
  vesselName: string;
  origin: string;
  tons: number;
  arrivalAt: string;
  dischargeCompleteAt: string;
  status: "항해 중" | "입항 예정" | "하역 중";
}
export interface Scenario {
  loadChangePct: number;
  arrivalDelayDays: number;
  includeInbound: boolean;
}
export interface DailyForecast {
  date: string;
  stockTons: number;
  productionGwh: number;
  demandGwh: number;
  inboundTons: number;
  fuelUseTons: number;
  requestedFuelTons: number;
}
export interface PlantForecast {
  plantId: string;
  name: string;
  inventoryTons: number;
  availableEnergyGwh: number;
  currentOutputMw: number;
  dailyConsumptionTons: number;
  coverageDays: number | null;
  firstShortageAt: string | null;
  firstLowStockAt: string | null;
  endingStockTons: number;
  productionGwh: number;
  daily: DailyForecast[];
}
export interface Forecast {
  baseTime: string;
  horizonDays: number;
  totalInventoryTons: number;
  availableEnergyGwh: number;
  currentOutputMw: number;
  firstShortageAt: string | null;
  firstLowStockAt: string | null;
  daily: DailyForecast[];
  byPlant: PlantForecast[];
}
export const BASE_TIME = "2026-10-06T09:00:00+09:00";
export const scenarioDefaults: Scenario = {
  loadChangePct: 0,
  arrivalDelayDays: 0,
  includeInbound: true,
};
// Illustrative data only: not an actual plant inventory or maintenance schedule.
export const plants: Plant[] = [
  {
    id: "dangjin",
    name: "당진",
    region: "충남 당진",
    inventoryTons: 180_000,
    calorificKcalKg: 5700,
    efficiency: 0.4,
    lowStockDays: 5,
    units: [
      {
        id: "dj-1",
        name: "당진 1호기",
        capacityMw: 500,
        loadPct: 82,
        outages: [],
      },
      {
        id: "dj-2",
        name: "당진 2호기",
        capacityMw: 500,
        loadPct: 80,
        outages: [
          {
            id: "dj-maint",
            title: "보일러 정기점검",
            startAt: "2026-10-05T09:00:00+09:00",
            endAt: "2026-10-07T18:00:00+09:00",
            reason: "보일러 및 보조설비 점검 · 샘플 계획",
          },
        ],
      },
      {
        id: "dj-9",
        name: "당진 9호기",
        capacityMw: 1000,
        loadPct: 85,
        outages: [],
      },
    ],
  },
  {
    id: "boryeong",
    name: "보령",
    region: "충남 보령",
    inventoryTons: 135_000,
    calorificKcalKg: 5600,
    efficiency: 0.39,
    lowStockDays: 5,
    units: [
      {
        id: "br-3",
        name: "보령 3호기",
        capacityMw: 500,
        loadPct: 82,
        outages: [
          {
            id: "br-maint",
            title: "터빈 예방정비",
            startAt: "2026-10-08T09:00:00+09:00",
            endAt: "2026-10-11T09:00:00+09:00",
            reason: "터빈 진동 점검 및 예방정비 · 샘플 계획",
          },
        ],
      },
      {
        id: "br-9",
        name: "신보령 1호기",
        capacityMw: 1000,
        loadPct: 84,
        outages: [],
      },
    ],
  },
  {
    id: "hadong",
    name: "하동",
    region: "경남 하동",
    inventoryTons: 108_000,
    calorificKcalKg: 5500,
    efficiency: 0.38,
    lowStockDays: 5,
    units: [
      {
        id: "hd-1",
        name: "하동 1호기",
        capacityMw: 500,
        loadPct: 80,
        outages: [
          {
            id: "hd-maint",
            title: "환경설비 점검",
            startAt: "2026-10-10T09:00:00+09:00",
            endAt: "2026-10-12T18:00:00+09:00",
            reason: "탈황·집진설비 점검 · 샘플 계획",
          },
        ],
      },
      {
        id: "hd-2",
        name: "하동 2호기",
        capacityMw: 500,
        loadPct: 82,
        outages: [],
      },
    ],
  },
  {
    id: "donghae",
    name: "동해·삼척",
    region: "강원 동해·삼척",
    inventoryTons: 115_000,
    calorificKcalKg: 5300,
    efficiency: 0.4,
    lowStockDays: 5,
    units: [
      {
        id: "dh-1",
        name: "동해 1호기",
        capacityMw: 200,
        loadPct: 75,
        outages: [],
      },
      {
        id: "sc-1",
        name: "삼척 1호기",
        capacityMw: 1000,
        loadPct: 85,
        outages: [
          {
            id: "sc-maint",
            title: "순환유동층 보일러 점검",
            startAt: "2026-10-14T09:00:00+09:00",
            endAt: "2026-10-17T09:00:00+09:00",
            reason: "연소계통 및 보일러 점검 · 샘플 계획",
          },
        ],
      },
    ],
  },
];
export const shipments: Shipment[] = [
  {
    id: "ship-dj",
    plantId: "dangjin",
    vesselName: "Pacific Horizon",
    origin: "호주 뉴캐슬",
    tons: 80_000,
    arrivalAt: "2026-10-06T06:00:00+09:00",
    dischargeCompleteAt: "2026-10-07T20:00:00+09:00",
    status: "하역 중",
  },
  {
    id: "ship-br",
    plantId: "boryeong",
    vesselName: "Ocean Frontier",
    origin: "인도네시아 칼리만탄",
    tons: 65_000,
    arrivalAt: "2026-10-08T14:00:00+09:00",
    dischargeCompleteAt: "2026-10-10T06:00:00+09:00",
    status: "입항 예정",
  },
  {
    id: "ship-hd",
    plantId: "hadong",
    vesselName: "Southern Star",
    origin: "호주 글래드스톤",
    tons: 55_000,
    arrivalAt: "2026-10-12T08:00:00+09:00",
    dischargeCompleteAt: "2026-10-13T18:00:00+09:00",
    status: "항해 중",
  },
  {
    id: "ship-dh",
    plantId: "donghae",
    vesselName: "Eastern Promise",
    origin: "인도네시아 타라칸",
    tons: 45_000,
    arrivalAt: "2026-10-23T06:00:00+09:00",
    dischargeCompleteAt: "2026-10-24T18:00:00+09:00",
    status: "항해 중",
  },
];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const EPSILON = 1e-8;
const baseMs = Date.parse(BASE_TIME);
const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
};
const timestamp = (value: string): number => {
  const result = Date.parse(value);
  if (!Number.isFinite(result))
    throw new RangeError(`Invalid timestamp: ${value}`);
  return result;
};
const kstIso = (time: number): string =>
  new Date(Math.round(time) + 9 * HOUR_MS).toISOString().slice(0, 19) +
  "+09:00";
const gwhPerTon = (plant: Plant): number => {
  const calorific = finite(plant.calorificKcalKg, "calorificKcalKg");
  const efficiency = finite(plant.efficiency, "efficiency");
  if (calorific <= 0 || efficiency <= 0 || efficiency > 1)
    throw new RangeError(
      "Fuel conversion requires positive calorific value and efficiency in (0, 1]",
    );
  return (calorific * 0.001163 * efficiency) / 1000;
};

/** Electrical energy from existing stock; efficiency is a fraction, e.g. 0.40. */
export function availableEnergyGwh(plant: Plant): number {
  return (
    Math.max(0, finite(plant.inventoryTons, "inventoryTons")) * gwhPerTon(plant)
  );
}

/**
 * Each daily row is a 24-hour window starting at 09:00 KST on its date.
 * Hourly integration is split at discharge/maintenance events to respect exact boundaries.
 * Existing inventory already includes any shipment discharged before BASE_TIME.
 * Shortage means unmet requested generation; maintenance alone is never a shortage.
 */
export function simulate(
  inputPlants: Plant[],
  inputShipments: Shipment[],
  scenario: Scenario,
  horizonDays = 30,
  generationByUnit?: Record<string, number[]>,
): Forecast {
  finite(horizonDays, "horizonDays");
  if (!Number.isInteger(horizonDays) || horizonDays < 0 || horizonDays > 365)
    throw new RangeError("horizonDays must be an integer from 0 to 365");
  const loadMultiplier = Math.max(
    0,
    1 + finite(scenario.loadChangePct, "loadChangePct") / 100,
  );
  const arrivalDelayMs =
    finite(scenario.arrivalDelayDays, "arrivalDelayDays") * DAY_MS;
  const endMs = baseMs + horizonDays * DAY_MS;
  const newDays = (): DailyForecast[] =>
    Array.from({ length: horizonDays }, (_, day) => ({
      date: kstIso(baseMs + day * DAY_MS).slice(0, 10),
      stockTons: 0,
      productionGwh: 0,
      demandGwh: 0,
      inboundTons: 0,
      fuelUseTons: 0,
      requestedFuelTons: 0,
    }));
  const byPlant = inputPlants.map((plant): PlantForecast => {
    const inventoryTons = Math.max(
      0,
      finite(plant.inventoryTons, "inventoryTons"),
    );
    const conversion = gwhPerTon(plant);
    const lowStockDays = Math.max(
      0,
      finite(plant.lowStockDays, "lowStockDays"),
    );
    const units = plant.units.map((unit) => ({
      id: unit.id,
      capacityMw: unit.capacityMw,
      outputMw:
        (Math.max(0, finite(unit.capacityMw, "capacityMw")) *
          Math.min(
            100,
            Math.max(0, finite(unit.loadPct, "loadPct")) * loadMultiplier,
          )) /
        100,
      outages: unit.outages.map((outage) => ({
        start: timestamp(outage.startAt),
        end: timestamp(outage.endAt),
      })),
    }));
    const demandMwAt = (time: number): number =>
      units.reduce(
        (sum, unit) =>
          sum +
          (unit.outages.some(
            (outage) => time >= outage.start && time < outage.end,
          )
            ? 0
            : generationByUnit?.[unit.id]?.[
                  Math.floor((time - baseMs) / DAY_MS)
                ] !== undefined
              ? Math.max(
                  0,
                  Math.min(
                    unit.capacityMw,
                    generationByUnit[unit.id][
                      Math.floor((time - baseMs) / DAY_MS)
                    ] * loadMultiplier,
                  ),
                )
              : unit.outputMw),
        0,
      );
    const deliveries = scenario.includeInbound
      ? inputShipments
          .filter((shipment) => shipment.plantId === plant.id)
          .map((shipment) => ({
            time: timestamp(shipment.dischargeCompleteAt) + arrivalDelayMs,
            tons: Math.max(0, finite(shipment.tons, "shipment.tons")),
          }))
          .filter(
            (delivery) => delivery.time >= baseMs && delivery.time <= endMs,
          )
      : [];
    const boundaries = new Set<number>([baseMs, endMs]);
    for (let hour = 1; hour < horizonDays * 24; hour++)
      boundaries.add(baseMs + hour * HOUR_MS);
    for (const delivery of deliveries) boundaries.add(delivery.time);
    for (const unit of units)
      for (const outage of unit.outages) {
        if (outage.start > baseMs && outage.start < endMs)
          boundaries.add(outage.start);
        if (outage.end > baseMs && outage.end < endMs)
          boundaries.add(outage.end);
      }
    const times = [...boundaries].sort((a, b) => a - b);
    const daily = newDays();
    let stock = inventoryTons;
    let firstShortageAt: string | null = null;
    let firstLowStockAt: string | null = null;
    for (let index = 0; index < times.length - 1; index++) {
      const time = times[index];
      const next = times[index + 1];
      const day = daily[Math.floor((time - baseMs) / DAY_MS)];
      const inboundTons = deliveries
        .filter((delivery) => delivery.time === time)
        .reduce((sum, delivery) => sum + delivery.tons, 0);
      stock += inboundTons;
      const demandMw = demandMwAt(time);
      const tonsPerHour = demandMw / 1000 / conversion;
      const neededTons = (tonsPerHour * (next - time)) / HOUR_MS;
      const consumedTons = Math.min(stock, neededTons);
      const reserveTons = tonsPerHour * 24 * lowStockDays;
      if (tonsPerHour > 0 && firstLowStockAt === null) {
        if (stock <= reserveTons + EPSILON) firstLowStockAt = kstIso(time);
        else if (stock - consumedTons < reserveTons)
          firstLowStockAt = kstIso(
            time + ((stock - reserveTons) / tonsPerHour) * HOUR_MS,
          );
      }
      if (neededTons > stock + EPSILON && firstShortageAt === null)
        firstShortageAt = kstIso(time + (stock / tonsPerHour) * HOUR_MS);
      stock = Math.max(0, stock - consumedTons);
      day.stockTons = stock;
      day.productionGwh += consumedTons * conversion;
      day.demandGwh += (demandMw * (next - time)) / HOUR_MS / 1000;
      day.inboundTons += inboundTons;
      day.fuelUseTons += consumedTons;
      day.requestedFuelTons += neededTons;
    }
    if (daily.length) {
      const finalInbound = deliveries
        .filter((d) => d.time === endMs)
        .reduce((s, d) => s + d.tons, 0);
      stock += finalInbound;
      daily[daily.length - 1].inboundTons += finalInbound;
      daily[daily.length - 1].stockTons = stock;
    }
    const initialDemandMw = demandMwAt(baseMs);
    const dailyConsumptionTons = (initialDemandMw * 24) / 1000 / conversion;
    const initialAvailableTons =
      inventoryTons +
      deliveries
        .filter((delivery) => delivery.time === baseMs)
        .reduce((sum, delivery) => sum + delivery.tons, 0);
    return {
      plantId: plant.id,
      name: plant.name,
      inventoryTons,
      availableEnergyGwh: inventoryTons * conversion,
      currentOutputMw: initialAvailableTons > EPSILON ? initialDemandMw : 0,
      dailyConsumptionTons,
      coverageDays:
        dailyConsumptionTons > 0 ? inventoryTons / dailyConsumptionTons : null,
      firstShortageAt,
      firstLowStockAt,
      endingStockTons: stock,
      productionGwh: daily.reduce((sum, day) => sum + day.productionGwh, 0),
      daily,
    };
  });
  const daily = newDays().map((day, index) => ({
    ...day,
    stockTons: byPlant.reduce(
      (sum, plant) => sum + plant.daily[index].stockTons,
      0,
    ),
    productionGwh: byPlant.reduce(
      (sum, plant) => sum + plant.daily[index].productionGwh,
      0,
    ),
    demandGwh: byPlant.reduce(
      (sum, plant) => sum + plant.daily[index].demandGwh,
      0,
    ),
    inboundTons: byPlant.reduce(
      (sum, plant) => sum + plant.daily[index].inboundTons,
      0,
    ),
    fuelUseTons: byPlant.reduce((s, p) => s + p.daily[index].fuelUseTons, 0),
    requestedFuelTons: byPlant.reduce(
      (s, p) => s + p.daily[index].requestedFuelTons,
      0,
    ),
  }));
  const earliest = (
    key: "firstShortageAt" | "firstLowStockAt",
  ): string | null =>
    byPlant
      .map((plant) => plant[key])
      .filter((date): date is string => date !== null)
      .sort()[0] ?? null;
  return {
    baseTime: BASE_TIME,
    horizonDays,
    totalInventoryTons: byPlant.reduce(
      (sum, plant) => sum + plant.inventoryTons,
      0,
    ),
    availableEnergyGwh: byPlant.reduce(
      (sum, plant) => sum + plant.availableEnergyGwh,
      0,
    ),
    currentOutputMw: byPlant.reduce(
      (sum, plant) => sum + plant.currentOutputMw,
      0,
    ),
    firstShortageAt: earliest("firstShortageAt"),
    firstLowStockAt: earliest("firstLowStockAt"),
    daily,
    byPlant,
  };
}
