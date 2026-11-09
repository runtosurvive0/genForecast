"use strict";
const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { createEngine } = require("./demo-engine.cjs");
const { loadCatalog } = require("./demo-catalog.cjs");
const { openSimulationStore } = require("./simulation-store.cjs");
const { resolve } = require("node:path");

const devOrigins = [5173, 5174, 4173, 61577].flatMap((port) =>
  ["127.0.0.1", "localhost"].map((host) => `http://${host}:${port}`),
);

/** Parse DEMO_ALLOWED_ORIGINS (comma separated); malformed or non-http(s) entries are ignored. */
function parseAllowedOrigins(value) {
  const origins = [];
  for (const raw of String(value ?? "").split(",")) {
    const candidate = raw.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(candidate)) continue;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.origin !== candidate) continue;
    if (!origins.includes(candidate)) origins.push(candidate);
  }
  return origins;
}

/** Local simulation; optional telemetry history is stored separately from operational records. */
function createDemoServer({
  port = 61578,
  host = "127.0.0.1",
  interval = 250,
  storePath = null,
} = {}) {
  const catalog = loadCatalog(),
    engine = createEngine(catalog),
    serverId = crypto.randomUUID(),
    store = storePath ? openSimulationStore(storePath) : null,
    allowedOrigins = new Set([
      ...devOrigins,
      ...parseAllowedOrigins(process.env.DEMO_ALLOWED_ORIGINS),
    ]);
  const previous = store?.latest();
  if (previous?.checkpoint) engine.restore(previous.checkpoint);
  if (store) store.record(engine.snapshot(), Date.now(), engine.checkpoint());
  let seq = 0,
    last = performance.now(),
    closing;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ service: "gen4cast-demo", serverId }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 32768,
    perMessageDeflate: false,
  });
  const packet = () => ({
    type: "snapshot",
    serverId,
    seq: ++seq,
    sentAt: Date.now(),
    state: engine.snapshot(),
  });
  const send = (socket, message) => {
    if (
      socket.readyState === WebSocket.OPEN &&
      socket.bufferedAmount < 1024 * 1024
    )
      socket.send(JSON.stringify(message));
  };
  const broadcast = () => {
    const message = packet();
    for (const peer of wss.clients) send(peer, message);
  };
  const update = () => {
    const now = performance.now();
    engine.advance((now - last) / 1000);
    last = now;
  };
  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    const role = url.searchParams.get("role");
    if (
      !["/demo-stream", "/demo"].includes(url.pathname) ||
      !["viewer", "controller"].includes(role) ||
      (req.headers.origin && !allowedOrigins.has(req.headers.origin))
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (peer) => {
      peer.role = role;
      wss.emit("connection", peer);
    });
  });
  wss.on("connection", (peer) => {
    peer.on("error", () => peer.terminate());
    peer.alive = true;
    peer.on("pong", () => {
      peer.alive = true;
    });
    send(peer, { type: "hello", serverId, catalog });
    update();
    send(peer, packet());
    const seen = new Map();
    peer.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
        if (
          !message ||
          message.type !== "command" ||
          typeof message.id !== "string" ||
          !message.id ||
          message.id.length > 100
        )
          throw new Error("명령 형식이 올바르지 않습니다.");
        if (seen.has(message.id)) {
          send(peer, seen.get(message.id));
          return;
        }
        if (peer.role !== "controller")
          throw new Error("조회 연결에서는 조작할 수 없습니다.");
        update();
        engine.command(message.command);
        store?.record(engine.snapshot(), Date.now(), engine.checkpoint());
        broadcast();
        const ack = { type: "ack", id: message.id, ok: true, seq };
        seen.set(message.id, ack);
        if (seen.size > 200) seen.delete(seen.keys().next().value);
        send(peer, ack);
      } catch (error) {
        send(peer, {
          type: "ack",
          id: typeof message?.id === "string" ? message.id : null,
          ok: false,
          error: error.message,
        });
      }
    });
  });
  const ticker = setInterval(() => {
    update();
    broadcast();
  }, interval);
  const storageTicker = store && setInterval(() => {
    const state = engine.snapshot();
    if (state.playing) store.record(state, Date.now(), engine.checkpoint());
  }, 5000);
  const heartbeat = setInterval(() => {
    for (const peer of wss.clients) {
      if (!peer.alive) {
        peer.terminate();
        continue;
      }
      peer.alive = false;
      peer.ping();
    }
  }, 10000);
  function close() {
    if (closing) return closing;
    update();
    store?.record(engine.snapshot(), Date.now(), engine.checkpoint());
    clearInterval(ticker);
    if (storageTicker) clearInterval(storageTicker);
    clearInterval(heartbeat);
    for (const peer of wss.clients) peer.terminate();
    closing = new Promise((resolve) => wss.close(() => server.close(() => { store?.close(); resolve(); })));
    return closing;
  }
  return {
    server,
    engine,
    store,
    wss,
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("error", onError);
          reject(error);
        };
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolve(server.address());
        });
      }),
    close,
  };
}
if (require.main === module) {
  const port = Number(process.env.DEMO_PORT || 61578);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("DEMO_PORT는 1–65535 정수여야 합니다.");
    process.exit(1);
  }
  const app = createDemoServer({ port, storePath: resolve(process.env.SIMULATION_DB_PATH || 'backend/data/operating-simulation.sqlite3') });
  app
    .listen()
    .then((address) =>
      console.log(
        `gen4cast local demo: ws://${address.address}:${address.port}/demo-stream`,
      ),
    )
    .catch(async (error) => {
      console.error(
        error.code === "EADDRINUSE"
          ? `${port} 포트가 이미 사용 중입니다. 기존 데모 상태는 유지됩니다. 다른 DEMO_PORT를 선택하고 Vite 프록시를 맞추세요.`
          : error.message,
      );
      await app.close();
      process.exitCode = 1;
    });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => app.close().then(() => process.exit(0)));
}
module.exports = { createDemoServer, parseAllowedOrigins };
