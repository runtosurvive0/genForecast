import type {
  FuelDemoAck,
  FuelDemoCatalog,
  FuelDemoCommand,
  FuelDemoConnectionState,
  FuelDemoRole,
  FuelDemoSnapshot,
} from "./types.ts";

export const disabledDemoState: FuelDemoConnectionState = {
  status: "disabled",
  snapshot: null,
  catalog: null,
  receivedAt: 0,
  serverId: null,
};
export function demoStreamUrl(
  location: Pick<Location, "protocol" | "host">,
  role: FuelDemoRole = "viewer",
  token: string | null = null,
) {
  const auth = role === "controller" && token ? `&token=${encodeURIComponent(token)}` : "";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/demo-stream?role=${role}${auth}`;
}

const TOKEN_KEY = "gf-demo-controller-token";
type TokenStorage = Pick<Storage, "getItem" | "setItem">;

/** Removes `token` from a query string; returns the remaining query (with "?" when non-empty) or null if absent. */
function withoutToken(query: string): { token: string | null; rest: string } {
  const params = new URLSearchParams(query);
  const token = params.get("token");
  params.delete("token");
  const rest = params.toString();
  return { token, rest: rest ? `?${rest}` : "" };
}

/**
 * Controller access token from `#demo-control?token=…` or `?token=…`. A token found in the URL is kept in
 * session storage and `scrubbed` gives the URL suffix (search + hash) without it, so it is not left visible.
 */
export function takeControllerToken(
  location: Pick<Location, "hash" | "search">,
  storage: TokenStorage | null,
): { token: string | null; scrubbed: string | null } {
  const mark = location.hash.indexOf("?");
  const hashPath = mark < 0 ? location.hash : location.hash.slice(0, mark);
  const hashQuery = mark < 0 ? "" : location.hash.slice(mark + 1);
  const fromHash = withoutToken(hashQuery);
  const fromSearch = withoutToken(location.search.replace(/^\?/, ""));
  const found = fromHash.token || fromSearch.token;
  if (found) {
    try {
      storage?.setItem(TOKEN_KEY, found);
    } catch {
      /* storage blocked: keep the token only for this connection */
    }
    return { token: found, scrubbed: `${fromSearch.rest}${hashPath}${fromHash.rest}` };
  }
  let stored: string | null = null;
  try {
    stored = storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    stored = null;
  }
  return { token: stored, scrubbed: null };
}

function browserControllerToken(): string | null {
  let storage: TokenStorage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  const { token, scrubbed } = takeControllerToken(window.location, storage);
  if (scrubbed !== null) {
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${scrubbed}`);
    } catch {
      /* ignore: the URL stays as typed */
    }
  }
  return token;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function isCatalog(value: unknown): value is FuelDemoCatalog {
  return (
    record(value) &&
    ["materialLots", "equipment", "units", "routes"].every((key) =>
      Array.isArray(value[key]),
    )
  );
}
function isSnapshot(value: unknown): value is FuelDemoSnapshot {
  return (
    record(value) &&
    value.source === "demo" &&
    Number.isFinite(value.elapsed) &&
    typeof value.playing === "boolean" &&
    Number.isFinite(value.speed) &&
    typeof value.baseTime === "string" &&
    Number.isFinite(Date.parse(value.baseTime)) &&
    record(value.equipment) &&
    record(value.units) &&
    (value.silos === undefined || (record(value.silos) && Object.values(value.silos).every((s:unknown) => record(s) &&
      ['tonnes','capacity','setRate','actualRate','consumed','received'].every(key => Number.isFinite(s[key]) && s[key] >= 0) &&
      s.tonnes <= s.capacity && ['running','stopped','fault'].includes(s.status)))) &&
    Array.isArray(value.schedule) &&
    Array.isArray(value.events) &&
    record(value.material) &&
    record(value.material.lots) &&
    record(value.material.ships) &&
    record(value.material.jobs) &&
    ["received", "outbound", "totalStock", "baselineStock"].every((key) =>
      Number.isFinite(value.material[key]),
    )
  );
}
/** Owns one optional local connection. It never writes the operational API or queues offline commands. */
export function createFuelDemoTransport(
  options: { role?: FuelDemoRole; url?: () => string } = {},
) {
  const role = options.role ?? "viewer";
  let state = disabledDemoState,
    socket: WebSocket | null = null,
    sequence = -1,
    retry = 0,
    generation = 0,
    active = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let freshnessTimer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const pending = new Map<
    string,
    {
      resolve: (ack: FuelDemoAck) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const publish = (patch: Partial<FuelDemoConnectionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  function rejectPending(message: string) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  }
  function connect(token: number) {
    if (!active || token !== generation) return;
    publish({ status: "connecting" });
    let current: WebSocket;
    try {
      current = new WebSocket(
        options.url?.() ??
          demoStreamUrl(window.location, role, role === "controller" ? browserControllerToken() : null),
      );
    } catch {
      disconnected(token);
      return;
    }
    socket = current;
    const valid = () => active && token === generation && socket === current;
    current.onmessage = (event) => {
      if (!valid()) return;
      let message: any;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!record(message)) return;
      if (
        message.type === "hello" &&
        typeof message.serverId === "string" &&
        isCatalog(message.catalog)
      ) {
        if (state.serverId !== message.serverId) {
          sequence = -1;
          rejectPending(
            "모사 서버가 다시 시작됐습니다. 수신값을 확인한 뒤 다시 적용하세요.",
          );
        }
        publish({ serverId: message.serverId, catalog: message.catalog });
      } else if (
        message.type === "snapshot" &&
        message.serverId === state.serverId &&
        Number.isSafeInteger(message.seq) &&
        message.seq > sequence &&
        isSnapshot(message.state)
      ) {
        sequence = message.seq;
        retry = 0;
        publish({
          status: "online",
          snapshot: message.state,
          receivedAt: Date.now(),
        });
      } else if (message.type === "ack" && typeof message.id === "string") {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.ok === true) request.resolve(message as FuelDemoAck);
        else
          request.reject(
            new Error(
              typeof message.error === "string"
                ? message.error
                : "명령이 적용되지 않았습니다.",
            ),
          );
      }
    };
    current.onclose = () => {
      if (valid()) {
        socket = null;
        disconnected(token);
      }
    };
    current.onerror = () => {
      if (valid()) current.close();
    };
  }
  function disconnected(token: number) {
    if (!active || token !== generation) return;
    publish({ status: "disconnected" });
    rejectPending("연결이 끊겼습니다. 수신값을 확인한 뒤 다시 적용하세요.");
    reconnectTimer = setTimeout(
      () => connect(token),
      Math.min(5000, 500 * 2 ** retry++),
    );
  }
  function stop() {
    active = false;
    generation++;
    clearTimeout(reconnectTimer);
    clearInterval(freshnessTimer);
    const previous = socket;
    socket = null;
    if (previous) {
      previous.onmessage = null;
      previous.onclose = null;
      previous.onerror = null;
      previous.close();
    }
    rejectPending(
      "데모 연결을 종료했습니다. 수신값을 확인한 뒤 다시 적용하세요.",
    );
    sequence = -1;
    retry = 0;
    state = disabledDemoState;
    for (const listener of listeners) listener();
  }
  function start() {
    if (active) stop();
    active = true;
    const token = ++generation;
    connect(token);
    freshnessTimer = setInterval(() => {
      if (
        active &&
        state.status === "online" &&
        Date.now() - state.receivedAt > 2000
      )
        publish({ status: "stale" });
    }, 250);
    return () => {
      if (token === generation) stop();
    };
  }
  function command(command: FuelDemoCommand): Promise<FuelDemoAck> {
    return new Promise((resolve, reject) => {
      if (
        role !== "controller" ||
        state.status !== "online" ||
        socket?.readyState !== WebSocket.OPEN
      ) {
        reject(
          new Error("모사 서버의 제어 연결이 정상일 때 조작할 수 있습니다."),
        );
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "서버 응답을 확인하지 못했습니다. 수신값을 먼저 확인하세요.",
          ),
        );
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type: "command", id, command }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("명령을 전송하지 못했습니다."),
        );
      }
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    command,
  };
}
