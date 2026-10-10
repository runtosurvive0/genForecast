export interface PortVisit {
  id: string;
  portName: string;
  country: string;
  arrivalAt: string;
  departureAt: string | null;
  confidence: 2 | 3 | 4 | null;
}

export interface PortVisitHistory {
  provider: "gfw";
  mmsi: string;
  days: number;
  status:
    | "ready"
    | "partial"
    | "empty"
    | "stale"
    | "unconfigured"
    | "not_found"
    | "ambiguous"
    | "unauthorized"
    | "forbidden"
    | "rate_limited"
    | "unavailable";
  message: string;
  fetchedAt: string | null;
  windowStart: string;
  windowEnd: string;
  delayHours: number;
  matchBasis: "mmsi" | "mmsi_imo" | null;
  truncated: boolean;
  datasets: string[];
  visits: PortVisit[];
}

const statuses = new Set([
  "ready",
  "partial",
  "empty",
  "stale",
  "unconfigured",
  "not_found",
  "ambiguous",
  "unauthorized",
  "forbidden",
  "rate_limited",
  "unavailable",
]);
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 1000;

export function decodePortVisits(
  value: unknown,
  mmsi: string,
  days: number,
): PortVisitHistory {
  const bad = () => {
    throw new Error("기항 기록 응답을 확인해 주세요.");
  };
  if (!value || typeof value !== "object") return bad();
  const v = value as PortVisitHistory;
  if (
    v.provider !== "gfw" ||
    v.mmsi !== mmsi ||
    v.days !== days ||
    !statuses.has(v.status) ||
    !text(v.message) ||
    (v.fetchedAt !== null && !date(v.fetchedAt)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.windowStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.windowEnd) ||
    v.delayHours !== 72 ||
    ![null, "mmsi", "mmsi_imo"].includes(v.matchBasis) ||
    typeof v.truncated !== "boolean" ||
    !Array.isArray(v.datasets) ||
    !v.datasets.every(text) ||
    !Array.isArray(v.visits) ||
    v.visits.length > 500
  )
    return bad();
  const seen = new Set<string>();
  for (const row of v.visits) {
    if (
      !row ||
      !text(row.id) ||
      !row.id ||
      seen.has(row.id) ||
      !text(row.portName) ||
      !text(row.country) ||
      !date(row.arrivalAt) ||
      (row.departureAt !== null &&
        (!date(row.departureAt) ||
          Date.parse(row.departureAt) < Date.parse(row.arrivalAt))) ||
      ![null, 2, 3, 4].includes(row.confidence)
    )
      return bad();
    seen.add(row.id);
  }
  if (
    v.visits.length &&
    (!v.fetchedAt || !["ready", "partial", "stale"].includes(v.status))
  )
    return bad();
  return v;
}
