const test = require("node:test"),
  assert = require("node:assert/strict");
const { createEngine } = require("../scripts/fuel-demo/demo-engine.cjs"),
  { loadCatalog } = require("../scripts/fuel-demo/demo-catalog.cjs");
const make = () => createEngine(loadCatalog());

test('split junction signals isolate faults on the other line', () => {
  const e = make();
  e.command({op:'work',kind:'unload',running:true,berth:2,lotId:'p5-c',rate:3600});
  e.command({op:'equipment',id:'tt5292B',patch:{status:'fault'}});
  e.command({op:'play'}); e.advance(10);
  assert.equal(e.snapshot().material.received,10);
  assert.equal(e.snapshot().equipment.tt5292A.flow,3600);
  assert.equal(e.snapshot().equipment.tt5292B.flow,0);
  e.command({op:'equipment',id:'tt5292A',patch:{status:'fault'}});
  e.advance(10);
  assert.equal(e.snapshot().material.received,10);
  assert.equal(e.snapshot().equipment.tt5292A.flow,0);
  const restored=make(); restored.restore(e.checkpoint());
  assert.equal(restored.snapshot().equipment.tt5292A.status,'fault');
  assert.equal(restored.snapshot().equipment.tt5292B.status,'fault');
});

test('legacy shared tower checkpoints preserve stock without guessing A/B operation', () => {
  const e=make();
  e.command({op:'work',kind:'unload',running:true,berth:2,lotId:'p5-c',rate:3600});
  e.command({op:'play'}); e.advance(10);
  const saved=e.checkpoint();
  for(const parent of ['tt5292','tt5393']) {
    saved.equipment[parent]=saved.equipment[parent+'A'];
    delete saved.equipment[parent+'A']; delete saved.equipment[parent+'B'];
    saved.material.jobs.unload.route=saved.material.jobs.unload.route.map(id=>id===parent+'A'?parent:id);
  }
  saved.schedule.push({id:99,status:'pending',at:11,action:{op:'equipment',id:'tt5292',patch:{status:'running'}}});
  const restored=make();restored.restore(saved);
  const s=restored.snapshot();
  assert.equal(s.material.totalStock,e.snapshot().material.totalStock);
  assert.equal(s.material.received,10);
  assert.equal(s.material.jobs.unload.running,false);
  assert.equal(s.equipment.tt5292A.status,'stopped');
  assert.equal(s.equipment.tt5292B.status,'stopped');
  assert.equal(s.equipment.tt5292,undefined);
  assert.equal(s.schedule.find(x=>x.id===99).status,'cancelled');
  restored.command({op:'play'});restored.advance(10);
  assert.equal(restored.snapshot().material.received,10);
});
test("unloading conserves ship plus physical yard stock and pauses with the clock", () => {
  const e = make();
  e.command({
    op: "work",
    kind: "unload",
    running: true,
    berth: 2,
    lotId: "p5-c",
    rate: 3600,
  });
  e.command({ op: "play" });
  e.advance(100);
  let s = e.snapshot();
  assert.equal(s.material.received, 100);
  assert.equal(s.material.lots["p5-c"].tons, 100);
  assert.equal(s.material.ships[2].remaining, 63300);
  e.command({ op: "pause" });
  e.advance(200);
  assert.equal(e.snapshot().material.received, 100);
});
test("a route fault blocks both material movement and positive conveyor flow", () => {
  const e = make();
  e.command({
    op: "work",
    kind: "unload",
    running: true,
    berth: 2,
    lotId: "p5-c",
    rate: 3600,
  });
  e.command({
    op: "schedule",
    delay: 10,
    duration: 0,
    action: { op: "equipment", id: "cv54a", patch: { status: "fault" } },
  });
  e.command({ op: "play" });
  e.advance(50);
  const s = e.snapshot();
  assert.equal(s.material.received, 10);
  assert.equal(s.equipment.csu51.flow, 0);
  assert.equal(s.equipment.sr51a.flow, 0);
  assert.match(s.material.jobs.unload.reason, /CV-54A/);
  e.command({ op: "equipment", id: "cv54a", patch: { status: "running" } });
  e.advance(10);
  assert.equal(e.snapshot().material.received, 20);
});
test("reclaiming depletes exactly to zero and conserves yard plus outbound mass", () => {
  const e = make(),
    initial = e.snapshot().material.totalStock;
  e.command({
    op: "work",
    kind: "reclaim",
    running: true,
    lotId: "p6-b",
    rate: 3600,
  });
  e.command({ op: "play" });
  e.advance(4000);
  const s = e.snapshot();
  assert.equal(s.material.lots["p6-b"].tons, 0);
  assert.equal(s.material.outbound, 1958);
  assert.equal(s.material.totalStock + s.material.outbound, initial);
  assert.equal(s.equipment.re51a.flow, 0);
  assert.match(s.material.jobs.reclaim.reason, /소진/);
});
test("invalid routes and mixing into occupied lots are rejected atomically", () => {
  const e = make(),
    before = e.snapshot();
  for (const command of [
    {
      op: "work",
      kind: "unload",
      running: true,
      berth: 2,
      lotId: "P3-G0",
      rate: 1200,
    },
    {
      op: "work",
      kind: "unload",
      running: true,
      berth: 2,
      lotId: "p5-b",
      rate: 1200,
    },
    {
      op: "work",
      kind: "unload",
      running: true,
      berth: 3,
      lotId: "p5-c",
      rate: 1200,
    },
  ])
    assert.throws(() => e.command(command));
  assert.deepEqual(e.snapshot(), before);
});
test("the previously restricted half of yard 1 can be used for demo reclaim", () => {
  const e = make();
  e.command({ op: "work", kind: "reclaim", running: true, lotId: "P3-G1", rate: 1200 });
  assert.equal(e.snapshot().material.jobs.reclaim.lotId, "P3-G1");
});
test("ramped flow integrates in simulated seconds and reset restores the photographed baseline", () => {
  const e = make();
  e.command({
    op: "work",
    kind: "unload",
    running: true,
    berth: 2,
    lotId: "p5-c",
    rate: 3600,
  });
  e.command({
    op: "schedule",
    delay: 0,
    duration: 100,
    action: { op: "equipment", id: "cv54a", patch: { flow: 0 } },
  });
  e.command({ op: "play" });
  e.advance(100);
  assert.ok(Math.abs(e.snapshot().material.received - 50) < 1e-7);
  e.command({ op: "reset" });
  const s = e.snapshot();
  assert.equal(s.material.lots["p5-c"].tons, 0);
  assert.equal(s.material.totalStock, 363432);
  assert.equal(s.material.ships[2].remaining, 63400);
});

test("fractional streaming ticks finish depletion without a phantom residual heap", () => {
  const e = make();
  e.command({
    op: "work",
    kind: "reclaim",
    running: true,
    lotId: "p6-b",
    rate: 1200,
  });
  e.command({ op: "play" });
  for (let i = 0; i < 10000; i++) e.advance(0.6137);
  const s = e.snapshot();
  assert.equal(s.material.lots["p6-b"].tons, 0);
  assert.equal(s.equipment.re51a.flow, 0);
  assert.ok(Math.abs(s.material.outbound - 1958) < 1e-7);
});

test("switching and stopping work does not leave the old route carrying phantom coal", () => {
  const e = make();
  e.command({
    op: "work",
    kind: "unload",
    running: true,
    berth: 2,
    lotId: "p5-c",
    rate: 1200,
  });
  e.command({
    op: "work",
    kind: "unload",
    running: true,
    berth: 1,
    lotId: "P3-G0",
    rate: 1200,
  });
  let s = e.snapshot();
  assert.equal(s.equipment.csu51.flow, 0);
  assert.equal(s.equipment.csu51.status, "stopped");
  e.command({ op: "work", kind: "unload", running: false });
  s = e.snapshot();
  assert.equal(s.equipment.csu01.flow, 0);
  assert.equal(s.equipment.sr01b.status, "stopped");
});

test("baseline mass comes from the catalog rather than an unrelated display constant", () => {
  const e = createEngine({ equipment: [], units: [], materialLots: [] });
  assert.equal(e.snapshot().material.baselineStock, 0);
  assert.equal(e.snapshot().material.totalStock, 0);
});
