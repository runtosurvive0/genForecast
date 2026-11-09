import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createFuelDemoTransport,
  demoStreamUrl,
} from "../src/domain/fuel-demo/transport.ts";
const require = createRequire(import.meta.url);
const { createDemoServer } = require("../scripts/fuel-demo/server.cjs");
const { WebSocketServer, WebSocket } = require("ws");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error("condition timed out");
    await delay(10);
  }
}
test("stream URL follows the current origin and never chooses a remote API", () => {
  assert.equal(
    demoStreamUrl({ protocol: "http:", host: "localhost:5173" }, "controller"),
    "ws://localhost:5173/demo-stream?role=controller",
  );
  assert.equal(
    demoStreamUrl({ protocol: "https:", host: "example.test" }),
    "wss://example.test/demo-stream?role=viewer",
  );
});
test("transport is inert until started and cleanup permits a StrictMode remount without a second live socket", async (t) => {
  const app = createDemoServer({ port: 0, interval: 25 });
  const { port } = await app.listen();
  t.after(() => app.close());
  const client = createFuelDemoTransport({
    url: () => `ws://127.0.0.1:${port}/demo-stream?role=viewer`,
  });
  t.after(() => client.stop());
  assert.equal(client.getSnapshot().status, "disabled");
  assert.equal(app.wss.clients.size, 0);
  const cleanup = client.start();
  cleanup();
  const cleanupAgain = client.start();
  await until(() => client.getSnapshot().status === "online");
  await until(() => app.wss.clients.size === 1);
  cleanupAgain();
  await until(() => app.wss.clients.size === 0);
  assert.equal(client.getSnapshot().status, "disabled");
  await assert.rejects(client.command({ op: "reset" }));
});
test("two real clients receive commands; restart accepts a new server ID and does not replay commands", async (t) => {
  let app = createDemoServer({ port: 0, interval: 25 });
  const { port } = await app.listen();
  const viewer = createFuelDemoTransport({
    url: () => `ws://127.0.0.1:${port}/demo-stream?role=viewer`,
  });
  const controller = createFuelDemoTransport({
    role: "controller",
    url: () => `ws://127.0.0.1:${port}/demo-stream?role=controller`,
  });
  viewer.start();
  controller.start();
  t.after(async () => {
    viewer.stop();
    controller.stop();
    await app.close();
  });
  await until(
    () =>
      viewer.getSnapshot().status === "online" &&
      controller.getSnapshot().status === "online",
  );
  await controller.command({
    op: "equipment",
    id: "cv54a",
    patch: { status: "running", flow: 1234 },
  });
  await until(
    () => viewer.getSnapshot().snapshot?.equipment.cv54a.flow === 1234,
  );
  await assert.rejects(viewer.command({ op: "reset" }));
  const previousServer = viewer.getSnapshot().serverId;
  await app.close();
  await until(() => controller.getSnapshot().status === "disconnected");
  assert.equal(viewer.getSnapshot().snapshot?.equipment.cv54a.flow, 1234);
  await assert.rejects(controller.command({ op: "reset" }));
  app = createDemoServer({ port, interval: 25 });
  await app.listen();
  await until(
    () =>
      viewer.getSnapshot().status === "online" &&
      viewer.getSnapshot().serverId !== previousServer,
  );
  assert.equal(viewer.getSnapshot().snapshot?.equipment.cv54a.flow, 0);
  assert.equal(app.engine.snapshot().events.length, 0);
});
test("freshness expires after two seconds; duplicate and older snapshots cannot refresh it", async (t) => {
  const app = createDemoServer({ port: 0, interval: 100000 });
  const { port } = await app.listen();
  const client = createFuelDemoTransport({
    url: () => `ws://127.0.0.1:${port}/demo-stream?role=viewer`,
  });
  t.after(async () => {
    client.stop();
    await app.close();
  });
  client.start();
  await until(() => client.getSnapshot().status === "online");
  const state = client.getSnapshot(),
    packet = {
      type: "snapshot",
      serverId: state.serverId,
      seq: 0,
      state: app.engine.snapshot(),
    };
  for (const peer of app.wss.clients) peer.send(JSON.stringify(packet));
  await until(() => client.getSnapshot().status === "stale", 3500);
  assert.equal(client.getSnapshot().receivedAt, state.receivedAt);
  assert.equal(client.getSnapshot().snapshot, state.snapshot);
});
test("disconnect rejects an in-flight command without silently resending it", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  let commands = 0,
    sequence = 0;
  server.on("connection", (peer: any) => {
    peer.send(
      JSON.stringify({
        type: "hello",
        serverId: "test",
        catalog: { materialLots: [], equipment: [], units: [], routes: [] },
      }),
    );
    peer.send(
      JSON.stringify({
        type: "snapshot",
        serverId: "test",
        seq: ++sequence,
        state: {
          source: "demo",
          elapsed: 0,
          playing: false,
          speed: 1,
          baseTime: "2026-11-04T00:00:00.000Z",
          material: {
            lots: {},
            ships: {},
            jobs: { unload: null, reclaim: null },
            received: 0,
            outbound: 0,
            totalStock: 0,
            baselineStock: 0,
          },
          equipment: {},
          units: {},
          schedule: [],
          events: [],
          ramps: 0,
        },
      }),
    );
    peer.on("message", () => {
      commands++;
      peer.close();
    });
  });
  const client = createFuelDemoTransport({
    role: "controller",
    url: () => `ws://127.0.0.1:${port}/demo-stream?role=controller`,
  });
  t.after(async () => {
    client.stop();
    for (const peer of server.clients) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  client.start();
  await until(() => client.getSnapshot().status === "online");
  await assert.rejects(client.command({ op: "preset" }), /연결/);
  await until(() => client.getSnapshot().status === "online");
  assert.equal(commands, 1);
});
