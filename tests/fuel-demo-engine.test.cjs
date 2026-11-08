const test = require("node:test"),
  assert = require("node:assert/strict");
const { createEngine } = require("../scripts/fuel-demo/demo-engine.cjs");
const catalog = {
  equipment: [
    { id: "cv54a", code: "CV-54A", kind: "belt", group: "2저탄장" },
    { id: "sr51a", code: "S/R-51A", kind: "stacker", group: "2저탄장" },
  ],
  units: [{ id: 7, maxMW: 600, mw: 480 }],
};
const make = () => createEngine(catalog);
test("commands validate atomically and stopped/fault equipment has zero effective flow", () => {
  const e = make();
  e.command({
    op: "equipment",
    id: "cv54a",
    patch: { status: "running", flow: 1200 },
  });
  assert.equal(e.snapshot().equipment.cv54a.flow, 1200);
  e.command({ op: "equipment", id: "cv54a", patch: { status: "fault" } });
  assert.equal(e.snapshot().equipment.cv54a.flow, 0);
  const before = e.snapshot();
  for (const patch of [
    { flow: -1 },
    { flow: Infinity },
    { status: "bad" },
    { extra: 1 },
    { position: 80 },
  ])
    assert.throws(() => e.command({ op: "equipment", id: "cv54a", patch }));
  assert.deepEqual(e.snapshot().equipment, before.equipment);
  assert.throws(() => e.command({ op: "unit", id: 7, patch: { mw: 601 } }));
  assert.throws(() =>
    e.command({ op: "equipment", id: "missing", patch: { status: "running" } }),
  );
});
test("server clock pauses, accelerates and hits scheduled ramps exactly", () => {
  const e = make();
  e.command({
    op: "schedule",
    delay: 10,
    duration: 20,
    action: { op: "unit", id: 7, patch: { mw: 500 } },
  });
  e.advance(30);
  assert.equal(e.snapshot().elapsed, 0);
  e.command({ op: "play" });
  e.advance(20);
  assert.equal(e.snapshot().units[7].mw, 490);
  e.advance(10);
  assert.equal(e.snapshot().units[7].mw, 500);
  e.command({ op: "speed", value: 60 });
  e.advance(1);
  assert.equal(e.snapshot().elapsed, 90);
  e.command({ op: "pause" });
  e.advance(100);
  assert.equal(e.snapshot().elapsed, 90);
});
test("events sharing a time execute once, manual override cancels only the active ramp", () => {
  const e = make();
  e.command({
    op: "schedule",
    delay: 0,
    duration: 20,
    action: { op: "equipment", id: "sr51a", patch: { position: 80 } },
  });
  e.command({
    op: "schedule",
    delay: 5,
    duration: 0,
    action: {
      op: "equipment",
      id: "cv54a",
      patch: { status: "running", flow: 100 },
    },
  });
  e.command({ op: "play" });
  e.advance(10);
  e.command({ op: "equipment", id: "sr51a", patch: { position: 15 } });
  e.advance(30);
  assert.equal(e.snapshot().equipment.sr51a.position, 15);
  assert.equal(
    e.snapshot().schedule.filter((x) => x.status === "done").length,
    2,
  );
  assert.equal(e.snapshot().equipment.cv54a.flow, 100);
  assert.throws(() =>
    e.command({
      op: "schedule",
      delay: -1,
      action: { op: "unit", id: 7, patch: { mw: 10 } },
    }),
  );
  e.command({ op: "reset" });
  assert.equal(e.snapshot().elapsed, 0);
  assert.equal(e.snapshot().playing, false);
  assert.equal(e.snapshot().schedule.length, 0);
});
