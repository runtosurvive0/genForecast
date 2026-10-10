import { useEffect, useState } from "react";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { navigationJson } from "./vessel-navigation";

export const plantDestinations = ["dangjin", "boryeong", "hadong", "donghae"];
interface Resolution {
  raw: string;
  status: "resolved" | "missing" | "ambiguous" | "unresolved";
  destinationId?: string;
  name?: string;
  country?: string;
  code?: string;
  matchedBy?: "code" | "name";
}

/** Match by the current raw text so a new AIS destination cannot reuse an old port. */
export function useAisDestinations(
  vessels: TrackingVessel[],
  preferences: Record<string, string>,
  revision: number,
) {
  const [results, setResults] = useState<Record<string, Resolution>>({});
  const [error, setError] = useState("");
  const signature = JSON.stringify(
    [
      ...new Set(
        vessels
          .filter((v) => preferences[v.id] === "ais" && v.source !== "demo")
          .map((v) => v.ais?.destination ?? ""),
      ),
    ]
      .sort()
      .slice(0, 200),
  );
  useEffect(() => {
    const values: string[] = JSON.parse(signature);
    setError("");
    if (!values.length) return;
    const abort = new AbortController();
    void navigationJson(
      "destinations/resolve",
      AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      {
        method: "POST",
        body: JSON.stringify({ destinations: values }),
      },
    )
      .then((data) => {
        if (
          !Array.isArray(data.destinations) ||
          data.destinations.length !== values.length
        )
          throw new Error("Invalid destinations");
        const next: Record<string, Resolution> = {};
        data.destinations.forEach((r: Resolution, index: number) => {
          if (
            !r ||
            r.raw !== values[index] ||
            !["resolved", "missing", "unresolved", "ambiguous"].includes(
              r.status,
            ) ||
            (r.status === "resolved" &&
              (!/^port:[A-Z]{2}[A-Z0-9]{3}$/.test(r.destinationId ?? "") ||
                r.destinationId !== `port:${r.code}` ||
                typeof r.name !== "string" ||
                typeof r.country !== "string" ||
                !["code", "name"].includes(r.matchedBy ?? "")))
          )
            throw new Error("Invalid destination");
          next[r.raw] = r;
        });
        if (!abort.signal.aborted) setResults(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setResults({});
          setError(
            "AIS 목적항 확인 실패 · 서버 연결을 확인한 뒤 항로·항적 갱신을 눌러 주세요.",
          );
        }
      });
    return () => abort.abort();
  }, [signature, revision]);
  const destinations: Record<string, string> = {};
  for (const vessel of vessels) {
    const choice = preferences[vessel.id];
    const match = results[vessel.ais?.destination ?? ""];
    destinations[vessel.id] = plantDestinations.includes(choice)
      ? choice
      : choice === "ais" && match?.status === "resolved"
        ? match.destinationId!
        : "";
  }
  return { destinations, results, error };
}
