export type ManualYardLot = { location: string; remaining_t: number; needs_review: boolean };
export type ManualYardSummary = { location: string; tonnes: number; records: number; review: number };

/** Only aggregate explicitly recorded locations; absent locations are unknown. */
export function summarizeManualYard(lots: ManualYardLot[], yard: 1 | 2 | 3): ManualYardSummary[] {
  const grouped = new Map<string, ManualYardSummary>();
  for (const lot of lots) {
    const pile = /^P([1-8])$/.exec(lot.location);
    const shed = /^[AB](?:[1-9]|10)$/.test(lot.location);
    const lotYard = pile ? (Number(pile[1]) <= 4 ? 1 : 2) : shed ? 3 : null;
    if (lotYard !== yard || !Number.isFinite(lot.remaining_t) || lot.remaining_t < 0) continue;
    const row = grouped.get(lot.location) ?? { location: lot.location, tonnes: 0, records: 0, review: 0 };
    row.tonnes += lot.remaining_t;
    row.records += 1;
    row.review += Number(lot.needs_review);
    grouped.set(lot.location, row);
  }
  return [...grouped.values()].sort((a, b) => a.location.localeCompare(b.location, 'en', {numeric:true}));
}
