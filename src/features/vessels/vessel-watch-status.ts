import type {
  TrackingVessel,
  TrackingVoyage,
} from "../../domain/vessel-workflow.ts";

/** Filter by the last AIS observation, falling back to an explicitly registered plan. */
export function watchStatus(vessel: TrackingVessel, voyage?: TrackingVoyage) {
  const ais = vessel.source === "demo" ? undefined : vessel.ais;
  if (ais) {
    if (ais.navStatus === 0 || ais.navStatus === 8) return "underway";
    if ([1, 5, 6].includes(ais.navStatus ?? -1)) return "stopped";
    const speed = ais.position?.sogKn;
    if (
      speed != null &&
      Number.isFinite(speed) &&
      speed >= 0.5 &&
      speed < 102.3
    )
      return "underway";
  }
  // No movement observation is not evidence of a future departure.
  return voyage?.state ?? "unknown";
}
