import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateForecast } from '../src/domain/demo-forecast/engine.ts';
import { demoForecastInput } from '../src/data/demo-forecast-sample.ts';
import { cargoFromScenario, parseStackingFocus, placementLabel, stackingContext, stackingEligible, stackingFocusValue, type StackingPlacement } from '../src/domain/stacking.ts';

const vessels = simulateForecast(demoForecastInput()).vessels;
const ocean = vessels.find(v => v.name === 'GEN4CAST OCEAN')!;

test('scenario vessel becomes a backend cargo request with remaining tonnes', () => {
  const c = cargoFromScenario(ocean);
  assert.equal(c.source, 'scenario');
  assert.equal(c.grade, '저');
  assert.equal(c.destination_yard, 3);
  assert.equal(c.tonnes, 70000);
  assert.equal(c.berth, ocean.assignedBerth ?? 3);
  assert.equal(cargoFromScenario({ ...ocean, unloaded: 20000 }).tonnes, 50000);
  assert.equal(cargoFromScenario({ ...ocean, assignedYard: 'yard-3' }).destination_yard, null);
  assert.deepEqual(stackingContext(ocean), { vessel: 'GEN4CAST OCEAN', cargo_t: 70000, berth: c.berth, cargo_grade: '저', cargo_cv: 5000, dest_yard: 3 });
});

test('only cargo that has not started unloading is eligible', () => {
  assert.equal(stackingEligible({ ...ocean, state: '체선' }), true);
  assert.equal(stackingEligible({ ...ocean, state: '근거리' }), true);
  assert.equal(stackingEligible({ ...ocean, state: '하역중', unloaded: 0 }), true);
  assert.equal(stackingEligible({ ...ocean, state: '하역중', unloaded: 100 }), false);
  assert.equal(stackingEligible({ ...ocean, state: '원거리' }), false);
  assert.equal(stackingEligible({ ...ocean, state: '완료' }), false);
});

test('yard focus address round-trips and rejects malformed values', () => {
  const pile: StackingPlacement = { yard: 1, target: 'Pile 3', from_m: 130, to_m: 210.5, tonnes: 12000 };
  const shed: StackingPlacement = { yard: 3, target: 'Shed A 3칸', from_m: null, to_m: null, tonnes: 30000 };
  assert.equal(stackingFocusValue(pile), 'P3:130-210.5');
  assert.deepEqual(parseStackingFocus(stackingFocusValue(pile)), { pile: 'P3', from_m: 130, to_m: 210.5 });
  assert.deepEqual(parseStackingFocus(stackingFocusValue(shed)), { cell: 'A3' });
  assert.equal(placementLabel(pile), 'Pile 3 · 130~210.5 m');
  assert.equal(placementLabel(shed), 'Shed A 3칸');
  for (const bad of ['P9:1-2', 'P3:5-1', 'C1', 'A11', 'bad', '', null]) assert.equal(parseStackingFocus(bad), null, String(bad));
});
