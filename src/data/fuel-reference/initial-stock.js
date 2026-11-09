import catalog from './demo-catalog.json' with {type:'json'};

// The simulator and the scene share one initial mass catalog. Photo files only
// supply the immutable location/quality labels, never a second live stock engine.
const byId = new Map(catalog.materialLots.map(lot => [lot.id, lot]));
export function initialReferenceTons(id) {
  const lot = byId.get(id);
  if (!lot) throw new Error(`Missing reference material: ${id}`);
  return lot.tons;
}
