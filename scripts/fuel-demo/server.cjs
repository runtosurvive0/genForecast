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

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/** Constant-time token comparison; different lengths are rejected without comparing contents. */
function tokenMatches(expected, given) {
  const a = Buffer.from(String(expected)),
    b = Buffer.from(String(given ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DEFAULT_SESSION_URL = "http://127.0.0.1:8093/api/auth/session";

/** 앱 로그인 확인 주소. 배포 주소(DEMO_ALLOWED_ORIGINS)가 있으면 같은 서버의 백엔드를 기본으로 쓴다. */
function defaultSessionUrl(env = process.env) {
  if (env.DEMO_SESSION_URL) return env.DEMO_SESSION_URL;
  return parseAllowedOrigins(env.DEMO_ALLOWED_ORIGINS).length ? DEFAULT_SESSION_URL : "";
}

/** Cookie 헤더에서 앱 세션 쿠키(gf_session) 하나만 꺼낸다. */
function sessionCookie(header) {
  for (const part of String(header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "gf_session" && rest.length) return rest.join("=");
  }
  return "";
}

/**
 * 백엔드 /api/auth/session으로 관리자 승인을 받은(scope=full) 로그인인지 확인한다.
 * 세션 쿠키만 넘기고, Host는 이미 허용 목록으로 검증한 Origin에서 만든다. 오류·시간 초과는 거부.
 */
function approvedLogin(sessionUrl, cookie, origin, timeoutMs = 3000) {
  return new Promise((done) => {
    let target;
    try {
      target = new URL(sessionUrl);
    } catch {
      done(false);
      return;
    }
    const req = http.request(
      target,
      {
        method: "GET",
        timeout: timeoutMs,
        headers: { Cookie: `gf_session=${cookie}`, Host: new URL(origin).host, Accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536) req.destroy();
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(body);
            done(res.statusCode === 200 && Boolean(value?.user) && value.scope === "full");
          } catch {
            done(false);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => done(false));
    req.end();
  });
}

const reject = (socket, status) => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

/** Local simulation; optional telemetry history is stored separately from operational records. */
function createDemoServer({
  port = 61578,
  host = "127.0.0.1",
  interval = 250,
  storePath = null,
  controllerToken = process.env.DEMO_CONTROLLER_TOKEN || "",
  maxClients = positiveInteger(process.env.DEMO_MAX_CLIENTS, 100),
  maxControllers = positiveInteger(process.env.DEMO_MAX_CONTROLLERS, 5),
  commandsPerSecond = 5,
  sessionUrl = defaultSessionUrl(),
} = {}) {
  const catalog = loadCatalog(),
    engine = createEngine(catalog),
    serverId = crypto.randomUUID(),
    store = storePath ? openSimulationStore(storePath) : null,
    deploymentOrigins = parseAllowedOrigins(process.env.DEMO_ALLOWED_ORIGINS),
    allowedOrigins = new Set([...devOrigins, ...deploymentOrigins]),
    requireOrigin = deploymentOrigins.length > 0;
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
    const origin = req.headers.origin;
    if (
      !["/demo-stream", "/demo"].includes(url.pathname) ||
      !["viewer", "controller"].includes(role) ||
      (origin ? !allowedOrigins.has(origin) : requireOrigin)
    ) {
      reject(socket, "403 Forbidden");
      return;
    }
    if (role === "viewer") {
      admit(req, socket, head, role);
      return;
    }
    // 조작반: 토큰이 맞거나, 관리자 승인을 받은 앱 로그인이면 연다.
    // 둘 다 설정되지 않은 개발 환경(배포 주소 없음)만 그대로 열어 둔다.
    if (controllerToken && tokenMatches(controllerToken, url.searchParams.get("token"))) {
      admit(req, socket, head, role);
      return;
    }
    const cookie = sessionCookie(req.headers.cookie);
    if (sessionUrl && origin && cookie) {
      approvedLogin(sessionUrl, cookie, origin).then((ok) => {
        if (socket.destroyed) return;
        if (ok) admit(req, socket, head, role);
        else reject(socket, "403 Forbidden");
      });
      return;
    }
    if (!controllerToken && !sessionUrl && !requireOrigin) {
      admit(req, socket, head, role);
      return;
    }
    reject(socket, "403 Forbidden");
  });
  const admit = (req, socket, head, role) => {
    // 시청자와 조작반은 상한을 따로 둔다. 시청자가 많아도 조작반 자리는 남는다.
    let sameRole = 0;
    for (const peer of wss.clients) if (peer.role === role) sameRole++;
    if (sameRole >= (role === "controller" ? maxControllers : maxClients)) {
      reject(socket, "503 Service Unavailable");
      return;
    }
    wss.handleUpgrade(req, socket, head, (peer) => {
      peer.role = role;
      wss.emit("connection", peer);
    });
  };
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
    let windowStart = Date.now(),
      rawCount = 0,
      commandCount = 0,
      strikes = 0;
    const rollWindow = () => {
      const now = Date.now();
      if (now - windowStart < 1000) return;
      strikes = commandCount > commandsPerSecond ? strikes : 0;
      windowStart = now;
      rawCount = 0;
      commandCount = 0;
    };
    // Any message: a burst beyond ten times the command rate closes the connection.
    const allowMessage = () => {
      rollWindow();
      rawCount += 1;
      if (rawCount <= commandsPerSecond * 10) return true;
      peer.close(1008, "rate limit");
      return false;
    };
    // State-changing controller commands: extras in a one-second window are ignored;
    // three consecutive over-limit windows close the connection.
    const allowCommand = () => {
      rollWindow();
      commandCount += 1;
      if (commandCount <= commandsPerSecond) return true;
      if (commandCount === commandsPerSecond + 1) strikes += 1;
      if (strikes >= 3) peer.close(1008, "rate limit");
      return false;
    };
    peer.on("message", (raw) => {
      if (!allowMessage()) return;
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
        if (!allowCommand()) return;
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
  const loginUrl = defaultSessionUrl();
  if (loginUrl) console.log(`조작반은 관리자 승인을 받은 앱 로그인으로 엽니다(확인 주소 ${loginUrl}).`);
  if (process.env.DEMO_CONTROLLER_TOKEN) console.log("DEMO_CONTROLLER_TOKEN으로도 조작반을 열 수 있습니다.");
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
module.exports = { createDemoServer, parseAllowedOrigins, defaultSessionUrl };
