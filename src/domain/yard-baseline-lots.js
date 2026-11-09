import {YardData} from '../data/fuel-reference/yard-snapshot.js';
import {StockSnapshot} from '../data/fuel-reference/stock-snapshot.js';

// Only draw heaps for which a Pile interval or a specific cell is known.
export function yardBaselineLots(rows, includeUnplaced = false) {
  return rows.flatMap((row, index) => {
    const pile = /^P([1-8])$/.exec(row.location);
    const cell = /^([AB])(10|[1-9])$/i.exec(row.location);
    if (!pile && !cell) return [];
    const id = row.source_id || `baseline-${row.location}-${index}`;
    const common = {id, coal:row.coal_name, name:row.coal_name, tons:row.tonnes,
      voyage:row.voyage_number || '', grade:row.grade?.startsWith('고') ? '고' : row.grade?.startsWith('저') ? '저' : '',
      days:row.age_days ?? null, age:row.age_days ?? null};
    if (cell) return [{...common, yard:3, shed:cell[1].toUpperCase(), cell:cell[2], pile:null}];
    const n = Number(pile[1]), yard = n <= 4 ? 1 : 2;
    let from = row.start_m, to = row.end_m;
    if (!(Number.isFinite(from) && Number.isFinite(to) && from < to)) {
      const legacy = yard === 1 ? YardData.lots.find(l => l.id === id) : StockSnapshot.lots.find(l => l.id === id);
      if (yard === 1 && legacy && Number.isFinite(legacy.from) && Number.isFinite(legacy.to)) {from=legacy.from;to=legacy.to;}
      else if (yard === 2 && legacy) return [{...common,yard,pile:n,span:legacy.span}];
      else return includeUnplaced ? [{...common,yard,pile:n,unplaced:true}] : [];
    }
    return [{...common,yard,pile:n,from,to,span:[1-to/720,1-from/720],range:[from,to]}];
  });
}
