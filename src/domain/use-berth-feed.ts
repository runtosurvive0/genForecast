import { useEffect, useState } from "react";
import { decodeFleet, fleetBounds, fleetDetail, fleetJson } from "./fleet-map";
import {
  berthArea,
  berthObservation,
  type Observation,
  type BerthRegistry,
} from "./berth-ais";
import { authJson } from "../lib/auth-client";

export interface BerthFeed {
  status: "loading" | "ready" | "partial" | "error";
  rows: Observation[];
  checked: string | null;
  registry: BerthRegistry | null;
}
const initial: BerthFeed = {
  status: "loading",
  rows: [],
  checked: null,
  registry: null,
};
const query = fleetBounds(126.5, 126.515, 37.062, 37.07, 16);
export function useBerthFeed(enabled: boolean, withCargo: boolean) {
  const [feed, setFeed] = useState(initial);
  useEffect(() => {
    setFeed(initial);
    if (!enabled) return;
    if (location.protocol === "file:") {
      setFeed({ ...initial, status: "error" });
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(15000),
      ]);
      try {
        const snapshot = decodeFleet(await fleetJson("?" + query, signal));
        if (snapshot.features.some((f) => f.properties.kind === "cluster"))
          throw Error("선박 개별 위치 미확인");
        const candidates = snapshot.features.filter(
          (f) =>
            berthArea(f.geometry.coordinates[0], f.geometry.coordinates[1]) !==
              undefined,
        );
        const results = await Promise.allSettled(
          candidates.map((f) => fleetDetail(f.properties.mmsi!, signal)),
        );
        const vessels = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const status = vessels.length === results.length ? "ready" : "partial";
        const now = Date.parse(snapshot.fetchedAt);
        const rows = vessels
          .map((v) => berthObservation(v, now))
          .filter((r): r is Observation => r !== null);
        if (abort.signal.aborted) return;
        setFeed((previous) => ({
          status,
          rows,
          checked: snapshot.fetchedAt,
          registry: withCargo ? previous.registry : null,
        }));
        if (rows.length && withCargo) {
          const registry = await authJson<BerthRegistry>(
            "/api/voyage-registry/records",
            { signal },
          ).catch(() => null);
          if (!abort.signal.aborted)
            setFeed({
              status,
              rows,
              checked: snapshot.fetchedAt,
              registry:
                registry &&
                [registry.ships, registry.voyages, registry.cargo].every(
                  Array.isArray,
                )
                  ? registry
                  : null,
            });
        }
      } catch {
        if (!abort.signal.aborted) setFeed({ ...initial, status: "error" });
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 30000);
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [enabled, withCargo]);
  return feed;
}
