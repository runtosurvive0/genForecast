import { voyages } from "../data/control-tower.ts";
import { freshness } from "./control-tower.ts";
export interface VesselPosition {
  vessel_id: string;
  mmsi: string;
  received_at: string;
  latitude: number;
  longitude: number;
  sog_kn: number | null;
  cog_deg: number | null;
  source: "dummy" | "aisstream";
  freshness: ReturnType<typeof freshness>;
}
export interface AisProvider {
  positions(): Promise<VesselPosition[]>;
}
export class DummyAisProvider implements AisProvider {
  async positions(): Promise<VesselPosition[]> {
    return voyages.map((v) => ({
      vessel_id: v.voyage_id,
      mmsi: v.mmsi,
      received_at: v.received_at,
      latitude: v.latitude,
      longitude: v.longitude,
      sog_kn: v.sog_kn,
      cog_deg: v.cog_deg,
      source: "dummy",
      freshness: freshness(v.received_at),
    }));
  }
}
/** Server-side ingestion decoder. Never embed AISstream credentials in a browser. */
export function decodeAisstreamPosition(
  payload: unknown,
  receivedAt: string,
): VesselPosition | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Number.isFinite(Date.parse(receivedAt))
  )
    return null;
  const data = payload as Record<string, any>;
  if (data.MessageType !== "PositionReport") return null;
  const report = data.Message?.PositionReport,
    meta = data.MetaData;
  if (!report || report.Valid === false || !meta) return null;
  const lat = report.Latitude ?? meta.Latitude,
    lng = report.Longitude ?? meta.Longitude,
    mmsi = String(meta.MMSI ?? report.UserID ?? "");
  if (
    !/^\d{9}$/.test(mmsi) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return {
    vessel_id: mmsi,
    mmsi,
    received_at: receivedAt,
    latitude: lat,
    longitude: lng,
    sog_kn:
      Number.isFinite(report.Sog) && report.Sog >= 0 && report.Sog < 102.3
        ? report.Sog
        : null,
    cog_deg:
      Number.isFinite(report.Cog) && report.Cog >= 0 && report.Cog < 360
        ? report.Cog
        : null,
    source: "aisstream",
    freshness: freshness(receivedAt),
  };
}
/** Accepts normalized records from an application's own server; not an AISstream socket. */
export class AisstreamProxyAdapter implements AisProvider {
  private readPositions: () => Promise<Omit<VesselPosition, "freshness">[]>;
  constructor(
    readPositions: () => Promise<Omit<VesselPosition, "freshness">[]>,
  ) {
    this.readPositions = readPositions;
  }
  async positions(): Promise<VesselPosition[]> {
    return (await this.readPositions()).map((p) => ({
      ...p,
      freshness: freshness(p.received_at),
    }));
  }
}
