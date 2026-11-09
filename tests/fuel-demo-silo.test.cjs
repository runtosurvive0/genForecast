const test = require('node:test');
const assert = require('node:assert/strict');
const {createEngine} = require('../scripts/fuel-demo/demo-engine.cjs');
const {loadCatalog} = require('../scripts/fuel-demo/demo-catalog.cjs');

test('each unit has six silos and a feeder, and reclaim feeds only its selected silo', () => {
  const engine = createEngine(loadCatalog());
  const before = engine.snapshot();
  assert.equal(Object.keys(before.silos).length, 60);
  assert.equal(before.silos['5-1'].tonnes, 500);
  engine.command({op:'feeder',id:'5-1',patch:{status:'running',rate:100}});
  engine.command({op:'work',kind:'reclaim',running:true,lotId:'p6-b',rate:1200,amount:1000,siloId:'5-1'});
  engine.command({op:'play'});
  engine.advance(360);
  const after = engine.snapshot();
  assert.ok(Math.abs(after.silos['5-1'].tonnes - 610) < 1e-7);
  assert.equal(after.silos['5-2'].tonnes, 500);
  assert.ok(Math.abs(after.silos['5-1'].consumed - 10) < 1e-7);
  assert.equal(after.silos['5-1'].speedPercent, 10);
  assert.ok(Math.abs(after.material.outbound - 120) < 1e-7);
});

test('silo cannot overfill or deliver coal it does not contain and pause freezes it', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'feeder',id:'1-1',patch:{status:'running',rate:1000}});
  engine.command({op:'play'}); engine.advance(3600);
  assert.equal(engine.snapshot().silos['1-1'].tonnes, 0);
  assert.equal(engine.snapshot().silos['1-1'].actualRate, 0);
  engine.command({op:'pause'}); engine.advance(3600);
  assert.equal(engine.snapshot().silos['1-1'].tonnes, 0);
});

test('a full target silo stops reclaim flow without losing yard coal', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'work',kind:'reclaim',running:true,lotId:'p6-b',rate:1200,amount:1500,siloId:'5-1'});
  engine.command({op:'play'}); engine.advance(3600);
  const state = engine.snapshot();
  assert.equal(state.silos['5-1'].tonnes, 1000);
  assert.ok(Math.abs(state.material.outbound - 500) < 1e-7);
  assert.equal(state.material.jobs.reclaim.actualRate, 0);
  assert.match(state.material.jobs.reclaim.reason, /만량/);
});

test('feeder scheduling follows simulation time and rejects unreachable destinations', () => {
  const engine = createEngine(loadCatalog());
  assert.throws(() => engine.command({op:'work',kind:'reclaim',running:true,lotId:'p6-b',rate:1200,amount:100,siloId:'1-1'}), /주계통/);
  engine.command({op:'schedule',delay:30,duration:0,action:{op:'feeder',id:'5-1',patch:{status:'running',rate:100}}});
  engine.advance(60);
  assert.equal(engine.snapshot().silos['5-1'].status,'stopped');
  engine.command({op:'play'}); engine.advance(60);
  assert.equal(engine.snapshot().silos['5-1'].status,'running');
  assert.ok(Math.abs(engine.snapshot().silos['5-1'].consumed - 100/120) < 1e-7);
});

test('manual silo capacity and level adjustments are tracked and require pause', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'silo',id:'1-1',patch:{capacity:1500,tonnes:900}});
  assert.equal(engine.snapshot().silos['1-1'].adjusted,400);
  assert.throws(()=>engine.command({op:'silo',id:'1-1',patch:{capacity:800}}), /잔량/);
  engine.command({op:'play'});
  assert.throws(()=>engine.command({op:'silo',id:'1-1',patch:{tonnes:1}}), /일시정지/);
});

test('silo inventory, feeder settings and pending schedule survive checkpoint restore', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'silo',id:'5-1',patch:{capacity:1300,tonnes:800}});
  engine.command({op:'feeder',id:'5-1',patch:{status:'running',rate:120}});
  engine.command({op:'schedule',delay:50,duration:0,action:{op:'feeder',id:'5-1',patch:{status:'stopped'}}});
  engine.command({op:'play'}); engine.advance(20);
  const before = engine.snapshot();
  const restored = createEngine(loadCatalog()); restored.restore(engine.checkpoint());
  const after = restored.snapshot();
  assert.equal(after.playing,false);
  assert.equal(after.silos['5-1'].tonnes,before.silos['5-1'].tonnes);
  assert.equal(after.silos['5-1'].setRate,120);
  assert.equal(after.schedule.filter(item=>item.status==='pending').length,1);
});

test('feeder fault stops simulated discharge and freezes the silo balance', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'feeder',id:'1-1',patch:{status:'running',rate:200}});
  engine.command({op:'play'}); engine.advance(60);
  engine.command({op:'feeder',id:'1-1',patch:{status:'fault'}});
  const stopped=engine.snapshot().silos['1-1'];
  assert.equal(stopped.actualRate,0);
  engine.advance(60);
  assert.equal(engine.snapshot().silos['1-1'].tonnes,stopped.tonnes);
});

test('the operating preset directs reclaim and feeder flow to the same silo', () => {
  const engine = createEngine(loadCatalog());
  engine.command({op:'preset'});
  assert.equal(engine.snapshot().material.jobs.reclaim.siloId,'5-1');
  engine.command({op:'play'}); engine.advance(0.5);
  const silo=engine.snapshot().silos['5-1'];
  assert.ok(silo.received>0 && silo.consumed>0);
});
