const test = require("node:test"),
  assert = require("node:assert/strict"),
  { WebSocket } = require("ws"),
  { createDemoServer } = require("../scripts/fuel-demo/server.cjs");
function client(port, role) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/demo?role=${role}`),
    queue = [],
    waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    queue.push(m);
    for (const w of [...waiters])
      if (w.p(m)) {
        clearTimeout(w.t);
        waiters.splice(waiters.indexOf(w), 1);
        w.r(m);
      }
  });
  const wait = (p) => {
    const found = queue.find(p);
    if (found) return Promise.resolve(found);
    return new Promise((r, j) => {
      const w = {
        p,
        r,
        t: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          j(Error("message timeout"));
        }, 3000),
      };
      waiters.push(w);
    });
  };
  return {
    ws,
    wait,
    send: (id, command) =>
      ws.send(JSON.stringify({ type: "command", id, command })),
  };
}
test('controller changes are written to the separate simulation store', async t => {
  const app = createDemoServer({port:0, interval:25, storePath:':memory:'});
  const {port} = await app.listen();
  t.after(() => app.close());
  const c = client(port, 'controller');
  t.after(() => c.ws.terminate());
  await c.wait(m => m.type === 'snapshot');
  c.send('store-flow', {op:'equipment', id:'cv54a', patch:{status:'running',flow:1234}});
  assert.equal((await c.wait(m => m.id === 'store-flow')).ok, true);
  assert.equal(app.store.latest().state.equipment.cv54a.flow, 1234);
});
test('restart restores the last simulation settings and schedule but remains paused', async t => {
  const {mkdtempSync, rmSync} = require('node:fs');
  const {tmpdir} = require('node:os');
  const {join} = require('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gf-restart-'));
  const db = join(dir, 'sim.sqlite3');
  const first = createDemoServer({port:0, interval:25, storePath:db});
  let second;
  t.after(async () => { await first.close(); if (second) await second.close(); rmSync(dir, {recursive:true,force:true}); });
  const {port} = await first.listen();
  const c = client(port, 'controller');
  await c.wait(m => m.type === 'snapshot');
  c.send('flow', {op:'equipment',id:'cv54a',patch:{status:'running',flow:1234}});
  assert.equal((await c.wait(m => m.id === 'flow')).ok, true);
  c.send('schedule', {op:'schedule',delay:3600,duration:0,action:{op:'unit',id:7,patch:{mw:321}}});
  assert.equal((await c.wait(m => m.id === 'schedule')).ok, true);
  c.send('work', {op:'work',kind:'unload',running:true,berth:2,lotId:'p5-c',rate:1200});
  assert.equal((await c.wait(m => m.id === 'work')).ok, true);
  c.send('speed', {op:'speed',value:3600});
  assert.equal((await c.wait(m => m.id === 'speed')).ok, true);
  c.send('play', {op:'play'});
  assert.equal((await c.wait(m => m.id === 'play')).ok, true);
  first.engine.advance(0.01);
  const accumulated = first.engine.snapshot().material.received;
  assert.ok(accumulated > 0);
  c.ws.terminate(); await first.close();
  second = createDemoServer({port:0,interval:25,storePath:db});
  await second.listen();
  const restored = second.engine.snapshot();
  assert.equal(restored.equipment.cv54a.setFlow, 1200);
  assert.equal(restored.playing, false);
  assert.equal(restored.schedule.filter(item => item.status === 'pending').length, 1);
  assert.ok(restored.material.received >= accumulated);
  second.engine.advance(10);
  assert.equal(second.engine.snapshot().material.received, restored.material.received);
});
test("two real WebSocket clients share authoritative state, enforce viewer role and reconnect", async (t) => {
  const app = createDemoServer({ port: 0, interval: 25 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const c = client(port, "controller"),
    v = client(port, "viewer");
  await Promise.all([
    c.wait((m) => m.type === "snapshot"),
    v.wait((m) => m.type === "snapshot"),
  ]);
  c.send("flow", {
    op: "equipment",
    id: "cv54a",
    patch: { status: "running", flow: 1234 },
  });
  assert.equal(
    (await c.wait((m) => m.type === "ack" && m.id === "flow")).ok,
    true,
  );
  await v.wait(
    (m) => m.type === "snapshot" && m.state.equipment.cv54a.flow === 1234,
  );
  v.send("read-only", { op: "reset" });
  assert.equal((await v.wait((m) => m.id === "read-only")).ok, false);
  assert.equal(app.engine.snapshot().equipment.cv54a.flow, 1234);
  c.send("bad", {
    op: "equipment",
    id: "cv54a",
    patch: { status: "fault", flow: -1 },
  });
  assert.equal((await c.wait((m) => m.id === "bad")).ok, false);
  assert.equal(app.engine.snapshot().equipment.cv54a.status, "running");
  c.ws.send("bad json");
  await c.wait((m) => m.type === "ack" && m.id === null && !m.ok);
  const cmd = {
    op: "schedule",
    delay: 0.05,
    duration: 0,
    action: { op: "unit", id: 7, patch: { mw: 321 } },
  };
  c.send("once", cmd);
  await c.wait((m) => m.id === "once" && m.ok);
  c.send("once", cmd);
  c.send("play", { op: "play" });
  await c.wait((m) => m.id === "play" && m.ok);
  c.ws.close();
  await v.wait((m) => m.type === "snapshot" && m.state.units[7].mw === 321);
  assert.equal(app.engine.snapshot().schedule.length, 1);
  const reconnect = client(port, "viewer");
  const snapshot = await reconnect.wait((m) => m.type === "snapshot");
  assert.equal(snapshot.state.units[7].mw, 321);
  assert.equal(snapshot.state.equipment.cv54a.flow, 1234);
  reconnect.ws.close();
  v.ws.close();
});
test("browser origins outside the local prototype are rejected", async (t) => {
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/demo?role=controller`, {
      origin: "https://example.com",
    });
    ws.on("unexpected-response", (_req, res) => {
      assert.equal(res.statusCode, 403);
      res.resume();
      ws.terminate();
      resolve();
    });
    ws.on("error", () => {});
    ws.on("open", () => reject(Error("foreign origin accepted")));
  });
});
test("oversized frames close only that connection and the server stays usable", async (t) => {
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const bad = client(port, "controller");
  bad.ws.on("error", () => {});
  await bad.wait((m) => m.type === "snapshot");
  const closed = new Promise((resolve) => bad.ws.once("close", resolve));
  bad.ws.send("x".repeat(32769));
  await closed;
  const good = client(port, "viewer");
  assert.equal(
    (await good.wait((m) => m.type === "snapshot")).state.source,
    "demo",
  );
  good.ws.close();
});

test("same-origin Vite and preview sockets can control the local demo-stream endpoint", async (t) => {
  const app = createDemoServer({ port: 0, interval: 25 });
  const { port } = await app.listen();
  t.after(() => app.close());
  for (const origin of [
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:4173",
    "http://localhost:61577",
  ]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/demo-stream?role=controller`,
        { origin },
      );
      ws.on("message", (raw) => {
        const message = JSON.parse(raw);
        if (message.type === "snapshot") {
          ws.close();
          resolve();
        }
      });
      ws.on("error", reject);
    });
  }
});
test("a superficially local prefix does not bypass the exact browser-origin allowlist", async (t) => {
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  for (const origin of [
    "http://localhost:5173.evil.test",
    "https://localhost:5173",
    "http://127.0.0.1:60000",
  ]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/demo-stream?role=controller`,
        { origin },
      );
      ws.on("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 403);
        res.resume();
        ws.terminate();
        resolve();
      });
      ws.on("error", () => {});
      ws.on("open", () => reject(Error("foreign origin accepted")));
    });
  }
});
