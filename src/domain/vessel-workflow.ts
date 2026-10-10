/** Local ETA preview contracts. These never mutate the shared supply ledger. */
export interface TrackingVessel {
  id: string;
  name: string;
  imo: string;
  mmsi: string;
  source: "demo" | "manual" | "aisstream" | "digitraffic";
  ais?: {
    updatedAt: string;
    shipType: number | null;
    navStatus: number | null;
    destination: string;
    position: TrackingVoyage["position"];
  };
  legacyId?: string;
}
export interface TrackingVoyage {
  id: string;
  vesselId: string;
  plantId: string;
  origin: string;
  destination: string;
  state: "planned" | "underway" | "stopped" | "arrived" | "cancelled";
  etd: string | null;
  plannedEta: string | null;
  distanceNm: number | null;
  plannedSpeedKn: number | null;
  position: {
    latitude: number;
    longitude: number;
    observedAt: string;
    sogKn: number | null;
    cogDeg: number | null;
  } | null;
  actualArrivalAt?: string | null;
  portWaitH: number | null;
  unloadH: number | null;
  cargoT: number;
  cv: number;
}
export interface VesselWorkspace {
  version: 1;
  watchlist: string[];
  vessels: TrackingVessel[];
  voyages: TrackingVoyage[];
}
export interface WeatherPoint {
  id: string;
  latitude: number;
  longitude: number;
  at: string;
  waveM: number | null;
  windKn: number | null;
  label: string;
}
const HOUR = 3600000;
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const time = (s: string | null | undefined) =>
  s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
export function estimateArrival(v: TrackingVoyage) {
  let reason = "항로 거리와 속도가 필요합니다.";
  let etaMs: number | null = null;
  let method: "observed" | "planned" | "actual" | "unknown" = "unknown";
  const validDistance = finite(v.distanceNm) && v.distanceNm >= 0;
  if (v.state === "cancelled") reason = "취소된 항차입니다.";
  else if (v.state === "arrived") {
    etaMs = time(v.actualArrivalAt);
    method = etaMs === null ? "unknown" : "actual";
    reason =
      etaMs === null
        ? "실제 입항 시각을 확인해 주세요."
        : "등록된 실제 입항 시각입니다.";
  } else if (v.state === "stopped")
    reason = "정지·묘박 중입니다. 재출발 시각이 필요합니다.";
  else {
    const planned = v.state === "planned";
    const anchor = time(planned ? v.etd : v.position?.observedAt);
    const speed = planned ? v.plannedSpeedKn : v.position?.sogKn;
    if (anchor === null)
      reason = planned
        ? "예정 출항 시각이 필요합니다."
        : "유효한 위치 관측이 없습니다.";
    else if (!finite(speed) || speed <= 0 || speed >= 102.3)
      reason = "유효한 항해 속도 또는 재출발 계획이 필요합니다.";
    else if (validDistance) {
      etaMs = anchor + (v.distanceNm! / speed) * HOUR;
      if (!Number.isFinite(etaMs) || Math.abs(etaMs) > 8.64e15) etaMs = null;
      else {
        method = planned ? "planned" : "observed";
        reason = planned
          ? "등록 ETD와 계획 속도·잔여거리로 계산했습니다."
          : "마지막 관측 시각과 단일 SOG·잔여거리로 계산했습니다. 최근 속도 추세는 미수집입니다.";
      }
    }
  }
  const iso = (n: number | null) =>
    n === null || !Number.isFinite(n) || Math.abs(n) > 8.64e15
      ? null
      : new Date(n).toISOString();
  const berthMs =
    etaMs !== null &&
    finite(v.portWaitH) &&
    v.portWaitH >= 0 &&
    v.portWaitH <= 8760
      ? etaMs + v.portWaitH * HOUR
      : null;
  const unloadMs =
    berthMs !== null && finite(v.unloadH) && v.unloadH >= 0 && v.unloadH <= 8760
      ? berthMs + v.unloadH * HOUR
      : null;
  const baseline = time(v.plannedEta);
  return {
    eta: iso(etaMs),
    berth: iso(berthMs),
    unload: iso(unloadMs),
    method,
    reason,
    deltaH:
      etaMs !== null && baseline !== null ? (etaMs - baseline) / HOUR : null,
  };
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function text(value: unknown, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("비어 있거나 너무 긴 문자 필드가 있습니다.");
  return value.trim();
}
function nullableNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value === null) return null;
  if (!finite(value) || value < min || value > max)
    throw new Error("숫자 범위를 확인해 주세요.");
  return value;
}
function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    time(value) === null ||
    Date.parse(value) < Date.parse("1900-01-01T00:00:00Z") ||
    Date.parse(value) > Date.parse("2100-12-31T23:59:59Z")
  )
    throw new Error("시간대를 포함한 1900~2100년 사이의 날짜가 필요합니다.");
  return new Date(value).toISOString();
}
export function validateVessel(value: unknown): TrackingVessel {
  if (!record(value)) throw new Error("선박 형식이 올바르지 않습니다.");
  const imo =
    typeof value.imo === "string" ? value.imo.trim().toUpperCase() : "";
  const mmsi = typeof value.mmsi === "string" ? value.mmsi.trim() : "";
  if (
    (!imo && !mmsi) ||
    (imo && !/^(\d{7}|DEMO-\d+)$/.test(imo)) ||
    (mmsi && !/^\d{9}$/.test(mmsi))
  )
    throw new Error("IMO 7자리 또는 MMSI 9자리를 입력해 주세요.");
  if (
    !["manual", "demo", "aisstream", "digitraffic"].includes(
      String(value.source),
    )
  )
    throw new Error("선박 출처가 올바르지 않습니다.");
  let ais: TrackingVessel["ais"];
  if (value.ais !== undefined) {
    if (
      !["aisstream", "digitraffic"].includes(String(value.source)) ||
      !record(value.ais)
    )
      throw new Error("AIS 출처를 확인해 주세요.");
    const a = value.ais;
    const updatedAt = nullableDate(a.updatedAt);
    if (!updatedAt) throw new Error("AIS 수신 시각이 필요합니다.");
    let position: TrackingVoyage["position"] = null;
    if (a.position !== null) {
      if (!record(a.position)) throw new Error("AIS 위치가 올바르지 않습니다.");
      const p = a.position;
      const latitude = nullableNumber(p.latitude, -90, 90);
      const longitude = nullableNumber(p.longitude, -180, 180);
      const observedAt = nullableDate(p.observedAt);
      if (latitude === null || longitude === null || !observedAt)
        throw new Error("AIS 관측 위치와 시각이 필요합니다.");
      position = {
        latitude,
        longitude,
        observedAt,
        sogKn: nullableNumber(p.sogKn, 0, 102.2),
        cogDeg: nullableNumber(p.cogDeg, 0, 359.9),
      };
    }
    ais = {
      updatedAt,
      position,
      shipType: nullableNumber(a.shipType, 1, 99),
      navStatus: nullableNumber(a.navStatus, 0, 14),
      destination:
        typeof a.destination === "string"
          ? a.destination.trim().slice(0, 100)
          : "",
    };
  }
  if (
    ["aisstream", "digitraffic"].includes(String(value.source)) &&
    (!/^\d{9}$/.test(mmsi) || !ais || imo.startsWith("DEMO"))
  )
    throw new Error("AIS 선박의 식별자와 관측 정보가 필요합니다.");
  return {
    id: text(value.id),
    name: text(value.name, 100),
    imo,
    mmsi,
    source: value.source as TrackingVessel["source"],
    ...(ais ? { ais } : {}),
    ...(typeof value.legacyId === "string"
      ? { legacyId: text(value.legacyId) }
      : {}),
  };
}
export function validateVoyage(value: unknown): TrackingVoyage {
  if (!record(value)) throw new Error("항차 형식이 올바르지 않습니다.");
  if (
    !["planned", "underway", "stopped", "arrived", "cancelled"].includes(
      String(value.state),
    )
  )
    throw new Error("항차 상태가 올바르지 않습니다.");
  if (
    !["dangjin", "boryeong", "hadong", "donghae"].includes(
      String(value.plantId),
    )
  )
    throw new Error("목적 발전소를 확인해 주세요.");
  let position: TrackingVoyage["position"] = null;
  if (value.position !== null) {
    if (!record(value.position))
      throw new Error("위치 형식이 올바르지 않습니다.");
    const p = value.position;
    const latitude = nullableNumber(p.latitude, -90, 90),
      longitude = nullableNumber(p.longitude, -180, 180),
      observedAt = nullableDate(p.observedAt);
    if (latitude === null || longitude === null || observedAt === null)
      throw new Error("관측 위치와 시각이 필요합니다.");
    position = {
      latitude,
      longitude,
      observedAt,
      sogKn: nullableNumber(p.sogKn, 0, 102.2),
      cogDeg: nullableNumber(p.cogDeg, 0, 360),
    };
  }
  const cargoT = nullableNumber(value.cargoT, 0, 1000000),
    cv = nullableNumber(value.cv, 1, 15000);
  if (cargoT === null || cv === null)
    throw new Error("화물량과 열량이 필요합니다.");
  return {
    id: text(value.id),
    vesselId: text(value.vesselId),
    plantId: text(value.plantId),
    origin: text(value.origin),
    destination: text(value.destination),
    state: value.state as TrackingVoyage["state"],
    etd: nullableDate(value.etd),
    plannedEta: nullableDate(value.plannedEta),
    distanceNm: nullableNumber(value.distanceNm, 0, 30000),
    plannedSpeedKn: nullableNumber(value.plannedSpeedKn, 0.1, 50),
    position,
    actualArrivalAt: nullableDate(value.actualArrivalAt),
    portWaitH: nullableNumber(value.portWaitH, 0, 8760),
    unloadH: nullableNumber(value.unloadH, 0, 8760),
    cargoT,
    cv,
  };
}
export function parseWorkspace(raw: string): VesselWorkspace {
  if (raw.length > 1000000) throw new Error("파일은 1MB 이하여야 합니다.");
  const v: unknown = JSON.parse(raw);
  if (
    !record(v) ||
    v.version !== 1 ||
    !Array.isArray(v.watchlist) ||
    !Array.isArray(v.vessels) ||
    !Array.isArray(v.voyages) ||
    [v.watchlist, v.vessels, v.voyages].some((a) => a.length > 200)
  )
    throw new Error("지원하지 않는 관심 목록 형식입니다. 최대 200척입니다.");
  const result: VesselWorkspace = {
    version: 1,
    watchlist: [...new Set(v.watchlist.map((id) => text(id)))],
    vessels: v.vessels.map((value) => {
      const { legacyId: _untrustedAlias, ...vessel } = validateVessel(value);
      return vessel;
    }),
    voyages: v.voyages.map(validateVoyage),
  };
  if (
    new Set(result.vessels.map((s) => s.id)).size !== result.vessels.length ||
    new Set(result.voyages.map((s) => s.vesselId)).size !==
      result.voyages.length
  )
    throw new Error("중복된 선박/활성 항차가 있습니다.");
  return result;
}
function identity(vessel: TrackingVessel, registry: TrackingVessel[]) {
  const matches = registry.filter(
    (v) =>
      v.id === vessel.id ||
      (v.imo && v.imo === vessel.imo) ||
      (v.mmsi && v.mmsi === vessel.mmsi),
  );
  if (
    matches.length > 1 ||
    matches.some((v) => v.imo && vessel.imo && v.imo !== vessel.imo)
  )
    throw new Error("선박 식별자가 서로 충돌합니다. IMO/MMSI를 확인해 주세요.");
  return matches[0];
}
function canonicalRegistry(
  registry: TrackingVessel[],
  stored: TrackingVessel[],
) {
  return [
    ...registry.filter((r) => !stored.some((v) => v.id === r.id)),
    ...stored,
  ];
}
function rememberIdentity(
  stored: TrackingVessel[],
  input: TrackingVessel,
  known?: TrackingVessel,
) {
  const { legacyId: _untrustedAlias, ...vessel } = input;
  if (!known) return [...stored, vessel];
  const enriched = {
    ...known,
    imo: known.imo || vessel.imo,
    mmsi: known.mmsi || vessel.mmsi,
    ...((vessel.source === "aisstream" || vessel.source === "digitraffic") &&
    known.source !== "demo" &&
    vessel.ais &&
    (!known.ais ||
      Date.parse(vessel.ais.updatedAt) >= Date.parse(known.ais.updatedAt))
      ? { source: vessel.source, ais: vessel.ais, name: vessel.name }
      : {}),
  };
  if (
    enriched.imo === known.imo &&
    enriched.mmsi === known.mmsi &&
    enriched.ais === known.ais
  )
    return stored;
  return [...stored.filter((v) => v.id !== known.id), enriched];
}
export function registerVessel(
  workspace: VesselWorkspace,
  input: TrackingVessel,
  registry: TrackingVessel[],
): VesselWorkspace {
  const vessel = validateVessel(input);
  const known = identity(
    vessel,
    canonicalRegistry(registry, workspace.vessels),
  );
  const id = known?.id ?? vessel.id;
  if (!workspace.watchlist.includes(id) && workspace.watchlist.length >= 200)
    throw new Error("관심 선박은 최대 200척입니다.");
  return {
    ...workspace,
    watchlist: [...new Set([...workspace.watchlist, id])],
    vessels: rememberIdentity(workspace.vessels, vessel, known),
  };
}
export function mergeWorkspace(
  current: VesselWorkspace,
  incoming: VesselWorkspace,
  registry: TrackingVessel[],
): VesselWorkspace {
  let next = {
    ...current,
    vessels: [...current.vessels],
    watchlist: [...current.watchlist],
    voyages: [...current.voyages],
  };
  const mapping = new Map<string, string>();
  for (const vessel of incoming.vessels) {
    const known = identity(vessel, canonicalRegistry(registry, next.vessels));
    mapping.set(vessel.id, known?.id ?? vessel.id);
    next.vessels = rememberIdentity(next.vessels, vessel, known);
  }
  const validIds = new Set([...registry, ...next.vessels].map((v) => v.id));
  for (const original of incoming.watchlist) {
    const id = mapping.get(original) ?? original;
    if (!validIds.has(id))
      throw new Error("선박 정보가 없는 관심 항목이 있습니다.");
    if (!next.watchlist.includes(id)) next.watchlist.push(id);
  }
  for (const voyage of incoming.voyages) {
    const vesselId = mapping.get(voyage.vesselId) ?? voyage.vesselId;
    if (!validIds.has(vesselId))
      throw new Error("선박 정보가 없는 항차입니다.");
    if (!next.voyages.some((v) => v.vesselId === vesselId))
      next.voyages.push({ ...voyage, vesselId });
  }
  if (
    next.watchlist.length > 200 ||
    next.vessels.length > 200 ||
    next.voyages.length > 200
  )
    throw new Error("최대 200척을 초과합니다.");
  return next;
}
