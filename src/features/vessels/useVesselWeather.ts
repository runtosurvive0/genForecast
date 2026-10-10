import { useEffect, useRef, useState } from "react";
import type { TrackingVessel, TrackingVoyage } from "@/domain/vessel-workflow";
import { navigationJson } from "./vessel-navigation";
import {
  decodeForecast,
  forecastKey,
  forecastUsable,
  weatherBlock,
  type ForecastState,
} from "./vessel-weather";

export function useVesselWeather(
  catalog: TrackingVessel[],
  interests: string[],
  destinations: Record<string, string>,
  owner: string,
  ready: boolean,
  voyages: TrackingVoyage[],
) {
  const [results, setResults] = useState<Record<string, ForecastState>>({});
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const targets = catalog.filter(
    (v) =>
      interests.includes(v.id) &&
      ["aisstream", "digitraffic"].includes(v.source) &&
      !weatherBlock(
        v,
        destinations[v.id] ?? "",
        voyages.find((x) => x.vesselId === v.id)?.state,
      ),
  );
  const current = useRef({ targets, destinations });
  current.current = { targets, destinations };
  const signature = targets
    .map((v) => forecastKey(v, destinations[v.id]))
    .sort()
    .join("|");
  useEffect(() => {
    if (!owner || !ready || !signature || location.protocol === "file:") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const keys = new Set(signature.split("|"));
    setResults((old) =>
      Object.fromEntries(Object.entries(old).filter(([key]) => keys.has(key))),
    );
    async function cycle() {
      for (const v of current.current.targets) {
        if (controller.signal.aborted) return;
        const destination = current.current.destinations[v.id];
        const key = forecastKey(v, destination);
        if (!keys.has(key)) continue;
        const orb = setTimeout(() => {
          if (!controller.signal.aborted) setBusy(true);
        }, 250);
        setResults((old) => ({
          ...old,
          [key]: {
            ...old[key],
            status: "loading",
            reason: "관심 선박의 항로 예보를 조회하고 있습니다.",
          },
        }));
        try {
          const data = decodeForecast(
            await navigationJson(
              `weather/${owner}/${v.source}/${v.mmsi}?destination=${encodeURIComponent(destination)}`,
              AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
            ),
            v,
            destination,
          );
          if (!controller.signal.aborted)
            setResults((old) => ({
              ...old,
              [key]: { status: data.status, reason: data.reason, data },
            }));
        } catch {
          if (!controller.signal.aborted)
            setResults((old) => ({
              ...old,
              [key]: {
                status: "error",
                reason:
                  "기상 조회 실패 · 서버 연결을 확인해 주세요. 이전 자료가 있으면 조회 시각과 함께 표시합니다.",
                data:
                  old[key]?.data && forecastUsable(old[key].data!)
                    ? old[key].data
                    : undefined,
              },
            }));
        } finally {
          clearTimeout(orb);
          if (!controller.signal.aborted) setBusy(false);
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(cycle, 5 * 60000);
    }
    void cycle();
    return () => {
      controller.abort();
      clearTimeout(timer);
      setBusy(false);
    };
  }, [owner, ready, signature, revision]);
  return {
    busy,
    refresh: () => setRevision((n) => n + 1),
    get: (v: TrackingVessel): ForecastState => {
      const destination = destinations[v.id] ?? "";
      const reason = weatherBlock(
        v,
        destination,
        voyages.find((x) => x.vesselId === v.id)?.state,
      );
      if (reason) return { status: "blocked", reason };
      const previous = results[forecastKey(v, destination)];
      if (previous?.data && !forecastUsable(previous.data))
        return {
          status: previous.status === "loading" ? "loading" : "unavailable",
          reason:
            "예보 원자료 조회 후 6시간이 지나 표시를 중단했습니다. 기상을 갱신해 주세요.",
        };
      return (
        previous ?? {
          status: "waiting",
          reason: "관심 선박의 기상 조회를 기다리고 있습니다.",
        }
      );
    },
  };
}
