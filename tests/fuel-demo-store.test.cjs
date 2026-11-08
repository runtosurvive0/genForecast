const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { openSimulationStore } = require('../scripts/fuel-demo/simulation-store.cjs');

test('simulation history persists separately and retains equipment and unit readings', t => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-sim-'));
  const path = join(dir, 'simulation.sqlite3');
  let db = openSimulationStore(path);
  assert.equal(db.latest(), null);
  db.record({source:'demo', equipment:{cv01:{status:'running',flow:500}}, units:{'1':{mw:300}}}, 100);
  db.close();
  db = openSimulationStore(path);
  t.after(() => { db.close(); rmSync(dir, {recursive:true, force:true}); });
  assert.equal(db.latest().at, 100);
  assert.equal(db.latest().state.equipment.cv01.flow, 500);
  assert.equal(db.latest().state.units['1'].mw, 300);
  assert.throws(() => db.record({source:'actual'}, 101), /모의/);
});
