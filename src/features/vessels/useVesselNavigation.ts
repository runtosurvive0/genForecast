import { useEffect, useMemo, useRef, useState } from "react";
import {
  validateVessel,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { estimateBasicEta } from "./vessel-basic-eta";
import { plantDestinations, useAisDestinations } from "./useAisDestinations";
import {
  decodeHistory,
  decodeRoute,
  navigationJson,
  seaDistance,
  vesselNavigationRoutes,
  type EstimatedRoute,
  type TrackHistory,
} from "./vessel-navigation";

const OWNER_KEY = "genforecast.vessel-tracking-owner.v1";
const DEST_KEY = "genforecast.vessel-route-destinations.v1";
function ownerId() {
  try {
    const old = localStorage.getItem(OWNER_KEY);
    if (old && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(old))
      return old;
    const id = crypto.randomUUID();
    localStorage.setItem(OWNER_KEY, id);
    return id;
  } catch {
    return "";
  }
}
export const trackingSource = (v: TrackingVessel) =>
  v.source === "digitraffic" ? "digitraffic" : "aisstream";

export function useTrackedVessels(
  catalog: TrackingVessel[],
  interests: string[],
) {
  const [owner] = useState(ownerId);
  const [vessels, setVessels] = useState<TrackingVessel[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState("");
  const members = JSON.stringify(
    catalog
      .filter(
        (v) =>
          interests.includes(v.id) &&
          v.source !== "demo" &&
          /^[1-9]\d{8}$/.test(v.mmsi),
      )
      .map((v) => ({ mmsi: v.mmsi, source: trackingSource(v) }))
      .sort((a, b) => a.mmsi.localeCompare(b.mmsi)),
  );
  useEffect(() => {
    if (!owner || location.protocol === "file:") return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let synced = false;
    setReady("");
    async function refresh() {
      try {
        const value = await navigationJson(
          `tracking/${owner}`,
          AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
          synced
            ? undefined
            : {
                method: "PUT",
                body: JSON.stringify({ vessels: JSON.parse(members) }),
              },
        );
        if (!Array.isArray(value.vessels) || value.vessels.length > 200)
          throw new Error("관심 선박 수신 응답을 확인해 주세요.");
        const next = value.vessels.map(validateVessel);
        if (abort.signal.aborted) return;
        setVessels(next);
        setError("");
        setReady(members);
        synced = true;
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "항적 저장 서버 연결 실패");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 10000);
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [owner, members]);
  return {
    owner,
    vessels,
    ready: ready === members,
    error: !owner
      ? "브라우저 저장소를 사용할 수 없어 서버 항적 등록이 중지되었습니다."
      : error,
  };
}

export function useVesselRoute(
  vessel: TrackingVessel | undefined,
  owner: string,
  ready: boolean,
  catalog: TrackingVessel[] = vessel ? [vessel] : [],
) {
  const [preferences, setDestinations] = useState<Record<string, string>>(
    () => {
      try {
        const value = JSON.parse(localStorage.getItem(DEST_KEY) || "{}");
        return value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      } catch {
        return {};
      }
    },
  );
  const [hours, setHours] = useState(24);
  const [revision, setRevision] = useState(0);
  const resolved = useAisDestinations(catalog, preferences, revision);
  const destinations = resolved.destinations;
  const destination = vessel ? destinations[vessel.id] || "" : "";
  const destinationChoice =
    vessel && [...plantDestinations, "ais"].includes(preferences[vessel.id])
      ? preferences[vessel.id]
      : "";
  const aisDestination = vessel
    ? resolved.results[vessel.ais?.destination ?? ""]
    : undefined;
  const [history, setHistory] = useState<{
    key: string;
    value: TrackHistory;
  }>();
  const [route, setRoute] = useState<{
    key: string;
    value: EstimatedRoute;
    at: number;
  }>();
  const [routeError, setRouteError] = useState("");
  const [trackError, setTrackError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const cache = useRef(
    new Map<string, { value: EstimatedRoute; at: number }>(),
  );
  const actual = vessel && vessel.source !== "demo";
  const source = vessel ? trackingSource(vessel) : "aisstream";
  const historyKey = actual ? `${source}/${vessel.mmsi}/${hours}` : "";
  const routeKey = actual && destination ? `${vessel.id}/${destination}` : "";
  const p = actual ? vessel.ais?.position : null;
  useEffect(() => {
    setTrackError("");
    if (
      !historyKey ||
      !ready ||
      !owner ||
      !/^[1-9]\d{8}$/.test(vessel?.mmsi ?? "")
    )
      return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = decodeHistory(
          await navigationJson(
            `tracking/${owner}/${source}/${vessel!.mmsi}?hours=${hours}`,
            AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
          ),
        );
        if (!abort.signal.aborted) {
          setHistory({ key: historyKey, value: data });
          setTrackError("");
        }
      } catch {
        if (!abort.signal.aborted)
          setTrackError("항적 갱신 실패 · 마지막으로 받은 기록을 표시합니다.");
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 10000);
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [historyKey, owner, ready, revision]);
  useEffect(() => {
    setRouteError("");
    setBusy(false);
    if (!routeKey || !p || location.protocol === "file:") return;
    const cached = cache.current.get(routeKey);
    if (
      cached &&
      Date.now() - cached.at < 6 * 3600000 &&
      seaDistance(cached.value.origin, [p.longitude, p.latitude]) < 25
    ) {
      setRoute({ key: routeKey, value: cached.value, at: cached.at });
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => setBusy(true), 250);
    void navigationJson(
      `route?longitude=${p.longitude}&latitude=${p.latitude}&destination=${destination}`,
      AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    )
      .then(decodeRoute)
      .then((value) => {
        if (
          value.destinationId !== destination ||
          seaDistance(value.origin, [p.longitude, p.latitude]) > 0.1
        )
          throw new Error("항로 출발점 또는 목적항 불일치");
        if (abort.signal.aborted) return;
        if (cache.current.size >= 200)
          cache.current.delete(cache.current.keys().next().value!);
        const at = Date.now();
        cache.current.set(routeKey, { value, at });
        setRoute({ key: routeKey, value, at });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setRouteError(
            "예상 항로를 갱신하지 못했습니다. 같은 선박·목적항의 이전 계산이 있으면 유지합니다.",
          );
      })
      .finally(() => {
        clearTimeout(timer);
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [routeKey, p?.longitude, p?.latitude, p?.observedAt, revision]);
  const displayedRoute = route?.key === routeKey && p ? route.value : undefined;
  const displayedHistory =
    history?.key === historyKey ? history.value : undefined;
  const routes = useMemo(
    () =>
      vesselNavigationRoutes(
        vessel?.id ?? "",
        p,
        displayedRoute,
        displayedHistory,
      ),
    [vessel?.id, p, displayedRoute, displayedHistory],
  );
  return {
    destination,
    destinationChoice,
    aisDestination,
    destinationError: resolved.error,
    destinations,
    hours,
    setHours,
    route: displayedRoute,
    history: displayedHistory,
    routes,
    busy,
    getBasicEta: (
      target: TrackingVessel,
      now: number,
      voyageState?: TrackingVoyage["state"],
    ) => {
      const targetDestination = destinations[target.id] || "";
      const key = `${target.id}/${targetDestination}`;
      const entry = route?.key === key ? route : cache.current.get(key);
      const result = estimateBasicEta({
        vessel: target,
        destination: targetDestination,
        route: entry?.value,
        routeCalculatedAt: entry?.at,
        now,
        voyageState,
        history: target.id === vessel?.id ? displayedHistory : undefined,
      });
      if (key === routeKey && routeError) {
        result.reason += ` ${routeError}`;
        if (result.state === "pending") result.state = "blocked";
      }
      return result;
    },
    error: [saveError, routeError, trackError].filter(Boolean).join(" · "),
    refresh: () => {
      cache.current.delete(routeKey);
      setRevision((n) => n + 1);
    },
    setDestination: (value: string) => {
      if (!vessel) return;
      const next = { ...preferences, [vessel.id]: value };
      setDestinations(next);
      try {
        localStorage.setItem(DEST_KEY, JSON.stringify(next));
        setSaveError("");
      } catch {
        setSaveError(
          "목적항을 브라우저에 저장하지 못했습니다. 이번 화면에서만 유지됩니다.",
        );
      }
    },
  };
}
