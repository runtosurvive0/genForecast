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

function upgradeStatus(port, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/demo-stream?role=viewer`,
      { origin },
    );
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode);
    });
    ws.on("error", () => {});
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
  });
}
test("DEMO_ALLOWED_ORIGINS adds exact deployment origins while other origins stay forbidden", async (t) => {
  const previous = process.env.DEMO_ALLOWED_ORIGINS;
  process.env.DEMO_ALLOWED_ORIGINS =
    " https://zgx-6660.tailec6d33.ts.net , ,ftp://files.test,not-a-url,https://bad.test/path";
  t.after(() => {
    if (previous === undefined) delete process.env.DEMO_ALLOWED_ORIGINS;
    else process.env.DEMO_ALLOWED_ORIGINS = previous;
  });
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  assert.equal(await upgradeStatus(port, "https://zgx-6660.tailec6d33.ts.net"), 101);
  assert.equal(await upgradeStatus(port, "http://127.0.0.1:5173"), 101);
  for (const origin of [
    "http://zgx-6660.tailec6d33.ts.net",
    "https://zgx-6660.tailec6d33.ts.net.evil.test",
    "ftp://files.test",
    "https://bad.test",
    "https://example.com",
  ])
    assert.equal(await upgradeStatus(port, origin), 403, origin);
});
test("parseAllowedOrigins keeps only well-formed http(s) origins", () => {
  const { parseAllowedOrigins } = require("../scripts/fuel-demo/server.cjs");
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(
    parseAllowedOrigins(
      " https://a.test ,http://b.test:8080,, https://c.test/,https://d.test/x,javascript:alert(1),b.test,https://user@e.test",
    ),
    ["https://a.test", "http://b.test:8080", "https://c.test"],
  );
});

function openStatus(url, options = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode);
    });
    ws.on("error", () => resolve("error"));
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
  });
}
test("a configured controller token is required for controllers but not for viewers", async (t) => {
  const app = createDemoServer({ port: 0, controllerToken: "s3cret-token-value" });
  const { port } = await app.listen();
  t.after(() => app.close());
  const base = `ws://127.0.0.1:${port}/demo-stream`;
  assert.equal(await openStatus(`${base}?role=controller`), 403);
  assert.equal(await openStatus(`${base}?role=controller&token=wrong`), 403);
  assert.equal(await openStatus(`${base}?role=controller&token=s3cret-token-valuX`), 403);
  assert.equal(await openStatus(`${base}?role=controller&token=s3cret-token-value-longer`), 403);
  assert.equal(await openStatus(`${base}?role=controller&token=s3cret-token-value`), 101);
  assert.equal(await openStatus(`${base}?role=viewer`), 101);
});
test("without a controller token the local development controller stays open", async (t) => {
  const previous = process.env.DEMO_CONTROLLER_TOKEN;
  delete process.env.DEMO_CONTROLLER_TOKEN;
  t.after(() => { if (previous !== undefined) process.env.DEMO_CONTROLLER_TOKEN = previous; });
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  assert.equal(await openStatus(`ws://127.0.0.1:${port}/demo-stream?role=controller`), 101);
});
test("DEMO_CONTROLLER_TOKEN from the environment is enforced", async (t) => {
  const previous = process.env.DEMO_CONTROLLER_TOKEN;
  process.env.DEMO_CONTROLLER_TOKEN = "from-env-token";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_CONTROLLER_TOKEN; else process.env.DEMO_CONTROLLER_TOKEN = previous; });
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const base = `ws://127.0.0.1:${port}/demo-stream?role=controller`;
  assert.equal(await openStatus(base), 403);
  assert.equal(await openStatus(`${base}&token=from-env-token`), 101);
});
test("connections without Origin are rejected once deployment origins are configured", async (t) => {
  const previous = process.env.DEMO_ALLOWED_ORIGINS;
  process.env.DEMO_ALLOWED_ORIGINS = "https://zgx-6660.tailec6d33.ts.net";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_ALLOWED_ORIGINS; else process.env.DEMO_ALLOWED_ORIGINS = previous; });
  const app = createDemoServer({ port: 0 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${port}/demo-stream?role=viewer`;
  assert.equal(await openStatus(url), 403);
  assert.equal(await openStatus(url, { origin: "https://zgx-6660.tailec6d33.ts.net" }), 101);
});
test("the number of concurrent connections is capped", async (t) => {
  const app = createDemoServer({ port: 0, maxClients: 2 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const url = `ws://127.0.0.1:${port}/demo-stream?role=viewer`;
  const open = [];
  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
    open.push(ws);
  }
  t.after(() => open.forEach((ws) => ws.terminate()));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await openStatus(url), 503);
  open.pop().close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await openStatus(url), 101);
});
test("viewers cannot crowd out controllers, which have their own small cap", async (t) => {
  const app = createDemoServer({ port: 0, maxClients: 2, maxControllers: 1, controllerToken: "tok" });
  const { port } = await app.listen();
  t.after(() => app.close());
  const base = `ws://127.0.0.1:${port}/demo-stream`;
  const open = [];
  t.after(() => open.forEach((ws) => ws.terminate()));
  const keep = async (url) => {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
    open.push(ws);
  };
  await keep(`${base}?role=viewer`);
  await keep(`${base}?role=viewer`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await openStatus(`${base}?role=viewer`), 503);
  await keep(`${base}?role=controller&token=tok`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await openStatus(`${base}?role=controller&token=tok`), 503);
  assert.equal(await openStatus(`${base}?role=viewer`), 503);
});
test("controllers fail closed when deployment origins are set but no controller token is", async (t) => {
  const previous = process.env.DEMO_ALLOWED_ORIGINS;
  process.env.DEMO_ALLOWED_ORIGINS = "https://zgx-6660.tailec6d33.ts.net";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_ALLOWED_ORIGINS; else process.env.DEMO_ALLOWED_ORIGINS = previous; });
  const origin = { origin: "https://zgx-6660.tailec6d33.ts.net" };
  const open = createDemoServer({ port: 0, controllerToken: "" });
  const { port } = await open.listen();
  t.after(() => open.close());
  const base = `ws://127.0.0.1:${port}/demo-stream`;
  assert.equal(await openStatus(`${base}?role=controller`, origin), 403);
  assert.equal(await openStatus(`${base}?role=controller&token=anything`, origin), 403);
  assert.equal(await openStatus(`${base}?role=viewer`, origin), 101);
  const locked = createDemoServer({ port: 0, controllerToken: "tok" });
  const second = await locked.listen();
  t.after(() => locked.close());
  assert.equal(await openStatus(`ws://127.0.0.1:${second.port}/demo-stream?role=controller&token=tok`, origin), 101);
});
test("controller commands beyond five per second are ignored and a flood closes the connection", async (t) => {
  const app = createDemoServer({ port: 0, interval: 1000 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const c = client(port, "controller");
  t.after(() => c.ws.terminate());
  await c.wait((m) => m.type === "snapshot");
  for (let i = 0; i < 6; i++) c.send(`burst-${i}`, { op: "speed", value: 60 });
  for (let i = 0; i < 5; i++) assert.equal((await c.wait((m) => m.id === `burst-${i}`)).ok, true);
  await assert.rejects(c.wait((m) => m.id === "burst-5"), /timeout/);
  const closed = new Promise((resolve) => c.ws.once("close", (code) => resolve(code)));
  for (let i = 0; i < 100; i++) c.send(`flood-${i}`, { op: "speed", value: 60 });
  assert.equal(await closed, 1008);
});
test("the simulation store keeps only recent rows and the latest checkpoint", () => {
  const { openSimulationStore } = require("../scripts/fuel-demo/simulation-store.cjs");
  const now = Date.now();
  const store = openSimulationStore(":memory:", { maxRows: 5, maxAgeMs: 60_000, pruneEvery: 1 });
  store.record({ source: "demo", n: 0 }, now - 3_600_000);
  for (let i = 1; i <= 12; i++) store.record({ source: "demo", n: i }, now - 12 + i, { n: i });
  assert.equal(store.count(), 5);
  assert.equal(store.latest().state.n, 12);
  const aged = openSimulationStore(":memory:", { maxRows: 100, maxAgeMs: 60_000, pruneEvery: 1 });
  aged.record({ source: "demo", n: 1 }, now - 3_600_000);
  aged.record({ source: "demo", n: 2 }, now - 1_800_000);
  assert.equal(aged.count(), 1, "even an old latest row is kept");
  assert.equal(aged.latest().state.n, 2);
  aged.record({ source: "demo", n: 3 }, now);
  assert.equal(aged.count(), 1);
  store.close();
  aged.close();
});
function fakeSessionBackend(handler) {
  const http = require("node:http");
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie, origin: req.headers.origin });
    const body = handler(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}/api/auth/session`, seen, close: () => new Promise((r) => server.close(r)) })));
}
const DEPLOY_ORIGIN = "https://zgx-6660.tailec6d33.ts.net";
function withDeployOrigin(t) {
  const previous = process.env.DEMO_ALLOWED_ORIGINS;
  process.env.DEMO_ALLOWED_ORIGINS = DEPLOY_ORIGIN;
  t.after(() => { if (previous === undefined) delete process.env.DEMO_ALLOWED_ORIGINS; else process.env.DEMO_ALLOWED_ORIGINS = previous; });
}
const asBrowser = (cookie) => ({ headers: { Origin: DEPLOY_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) } });
test("an approved app login opens the controller without a token", async (t) => {
  withDeployOrigin(t);
  const backend = await fakeSessionBackend((req) =>
    /gf_session=good/.test(req.headers.cookie || "") ? { user: { id: "u1" }, scope: "full" }
      : /gf_session=pending/.test(req.headers.cookie || "") ? { user: { id: "u2" }, scope: "limited" }
      : { user: null, scope: null });
  t.after(() => backend.close());
  const app = createDemoServer({ port: 0, controllerToken: "", sessionUrl: backend.url });
  const { port } = await app.listen();
  t.after(() => app.close());
  const controller = `ws://127.0.0.1:${port}/demo-stream?role=controller`;
  assert.equal(await openStatus(controller, asBrowser("other=1; gf_session=good; gf_csrf=x")), 101);
  assert.equal(await openStatus(controller, asBrowser("gf_session=pending")), 403);
  assert.equal(await openStatus(controller, asBrowser("gf_session=bad")), 403);
  assert.equal(await openStatus(controller, asBrowser(null)), 403);
  assert.equal(await openStatus(`ws://127.0.0.1:${port}/demo-stream?role=viewer`, asBrowser(null)), 101);
  // 세션 쿠키만 넘기고, 백엔드가 허용 주소로 판단하도록 Host는 검증된 Origin에서 만든다.
  const first = backend.seen[0];
  assert.equal(first.cookie, "gf_session=good");
  assert.equal(first.host, "zgx-6660.tailec6d33.ts.net");
  assert.equal(first.origin, undefined);
  assert.equal(backend.seen.length, 3); // 쿠키가 없으면 백엔드에 묻지 않는다.
});
test("controller login check fails closed when the backend is unreachable", async (t) => {
  withDeployOrigin(t);
  const app = createDemoServer({ port: 0, controllerToken: "", sessionUrl: "http://127.0.0.1:9/api/auth/session" });
  const { port } = await app.listen();
  t.after(() => app.close());
  assert.equal(await openStatus(`ws://127.0.0.1:${port}/demo-stream?role=controller`, asBrowser("gf_session=good")), 403);
});
test("the controller token still works as an alternative to app login", async (t) => {
  withDeployOrigin(t);
  const backend = await fakeSessionBackend(() => ({ user: null, scope: null }));
  t.after(() => backend.close());
  const app = createDemoServer({ port: 0, controllerToken: "tok-1", sessionUrl: backend.url });
  const { port } = await app.listen();
  t.after(() => app.close());
  const controller = `ws://127.0.0.1:${port}/demo-stream?role=controller`;
  assert.equal(await openStatus(`${controller}&token=tok-1`, asBrowser(null)), 101);
  assert.equal(await openStatus(controller, asBrowser("gf_session=x")), 403);
});
test("deployment origins default the login check to the local backend session endpoint", () => {
  const { defaultSessionUrl } = require("../scripts/fuel-demo/server.cjs");
  assert.equal(defaultSessionUrl({ DEMO_ALLOWED_ORIGINS: DEPLOY_ORIGIN }), "http://127.0.0.1:8093/api/auth/session");
  assert.equal(defaultSessionUrl({ DEMO_ALLOWED_ORIGINS: DEPLOY_ORIGIN, DEMO_SESSION_URL: "http://127.0.0.1:9000/api/auth/session" }), "http://127.0.0.1:9000/api/auth/session");
  assert.equal(defaultSessionUrl({}), "");
});
