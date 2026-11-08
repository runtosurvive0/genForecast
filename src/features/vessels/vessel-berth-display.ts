import type { Observation, BerthRegistry } from "@/domain/berth-ais";
import { matchCargo } from "@/domain/berth-ais";
import type { TrackingVessel } from "@/domain/vessel-workflow";

/** A position observation is not an arrival event. Only a uniquely matched
 * shared voyage can provide a recorded arrival or berthing time. */
export function berthDisplay(vessel: TrackingVessel, observation: Observation | undefined, registry: BerthRegistry | null, now: number) {
  if (!observation || vessel.source === "demo") return undefined;
  const voyage = matchCargo(vessel, registry)?.voyage;
  const candidate = voyage?.actual_berth || voyage?.actual_arrival;
  const timestamp = typeof candidate === "string" ? Date.parse(candidate) : NaN;
  const valid = Number.isFinite(timestamp) && timestamp <= now;
  return {
    observation,
    actual: valid ? String(candidate) : undefined,
    actualLabel: valid ? (voyage?.actual_berth ? "등록 접안" : "등록 입항") : undefined,
  };
}
