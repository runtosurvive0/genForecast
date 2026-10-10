import {
  validateVessel,
  type TrackingVessel,
} from "../../domain/vessel-workflow.ts";

export const DISCOVERY_CAPACITY = 20_000;

export interface DiscoverySnapshot {
  provider: "aisstream" | "digitraffic";
  status: string;
  coverage: string;
  lastReceivedAt: string | null;
  fetchedAt: string;
  capacity: number;
  vessels: TrackingVessel[];
  koreaCandidates?: {
    capacity: number;
    retentionHours: number;
    entries: KoreaCandidate[];
  };
}
export interface KoreaCandidate {
  vessel: TrackingVessel;
  portCode: string;
  portName: string;
  matchedBy: "code" | "name";
  destinationObservedAt: string;
}
export const discoveryStatus: Record<string, string> = {
  snapshot: "공개 AIS 조회 완료 · 서버에서 60초간 캐시",
  cached_error: "공개 API 갱신 실패 · 이전 조회 결과",
  unavailable: "공개 API 응답 실패 · 잠시 후 다시 시도해 주세요",
  not_configured: "서버 API 키 설정 필요",
  configuration_error: "서버 수신 영역 설정 확인 필요",
  idle: "수신 준비",
  connecting: "AISstream 연결 중",
  waiting: "연결됨 · 첫 선박 메시지 대기",
  receiving: "AIS 메시지 수신 중",
  reconnecting: "재연결 대기 · 마지막 수신 목록 유지",
  provider_error: "AISstream 구독 오류 · 서버 키와 연결 한도를 확인해 주세요",
};
export const shipTypeLabel = (type: number | null | undefined) =>
  type == null
    ? "선종 미수신"
    : type >= 70 && type <= 79
      ? "화물선"
      : type >= 80 && type <= 89
        ? "탱커"
        : type >= 60 && type <= 69
          ? "여객선"
          : type === 30
            ? "어선"
            : `기타 (${type})`;
export const navStatusLabel = (status: number | null | undefined) =>
  status === 0 || status === 8
    ? "항해 중"
    : status === 1
      ? "묘박"
      : status === 5
        ? "계류"
        : status == null
          ? "상태 미수신"
          : `기타 (${status})`;

export async function fetchVesselCatalog(
  signal?: AbortSignal,
  provider: DiscoverySnapshot["provider"] = "aisstream",
): Promise<DiscoverySnapshot> {
  const response = await fetch(`/api/vessels/catalog?provider=${provider}`, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `선박 서버 응답 오류 (${response.status}) · Python 서버 실행 상태를 확인해 주세요.`,
    );
  const data = await response.json();
  if (
    data?.provider !== provider ||
    !Array.isArray(data.vessels) ||
    data.vessels.length > DISCOVERY_CAPACITY ||
    typeof data.coverage !== "string" ||
    !Object.hasOwn(discoveryStatus, data.status) ||
    !Number.isFinite(Date.parse(data.fetchedAt))
  )
    throw new Error("선박 서버 응답 형식이 올바르지 않습니다.");
  const vessels = data.vessels.map(validateVessel);
  if (vessels.some((v: TrackingVessel) => v.source !== provider))
    throw new Error("선박 제공처와 출처가 일치하지 않습니다.");
  let koreaCandidates: DiscoverySnapshot["koreaCandidates"];
  const candidates = data.koreaCandidates;
  if (candidates !== undefined) {
    if (
      provider !== "aisstream" ||
      !candidates ||
      !Array.isArray(candidates.entries) ||
      candidates.entries.length > 1000 ||
      candidates.capacity !== 1000 ||
      candidates.retentionHours !== 72
    )
      throw new Error("한국행 후보 목록 형식이 올바르지 않습니다.");
    const seen = new Set<string>();
    const entries: KoreaCandidate[] = candidates.entries.map(
      (entry: KoreaCandidate) => {
        if (
          !entry ||
          !/^KR[A-Z0-9]{3}$/.test(entry.portCode) ||
          typeof entry.portName !== "string" ||
          !entry.portName.trim() ||
          entry.portName.length > 60 ||
          !["code", "name"].includes(entry.matchedBy) ||
          !Number.isFinite(Date.parse(entry.destinationObservedAt))
        )
          throw new Error("한국행 후보 판별 정보가 올바르지 않습니다.");
        const vessel = validateVessel(entry.vessel);
        if (
          vessel.source !== provider ||
          !vessel.ais?.destination ||
          seen.has(vessel.mmsi)
        )
          throw new Error(
            "한국행 후보의 출처 또는 식별자가 올바르지 않습니다.",
          );
        seen.add(vessel.mmsi);
        return {
          vessel,
          portCode: entry.portCode,
          portName: entry.portName,
          matchedBy: entry.matchedBy,
          destinationObservedAt: entry.destinationObservedAt,
        };
      },
    );
    koreaCandidates = {
      capacity: candidates.capacity,
      retentionHours: candidates.retentionHours,
      entries,
    };
  }
  return { ...data, vessels, koreaCandidates };
}

export function filterDiscoveredVessels(
  vessels: TrackingVessel[],
  query: string,
  shipType: string,
  navStatus: string,
  age: string,
  sort: string,
  now = Date.now(),
  options: { destination?: string; destinationStatus?: string } = {},
) {
  const q = query.trim().toLocaleLowerCase();
  const destinationQuery = (options.destination ?? "")
    .trim()
    .toLocaleLowerCase();
  return vessels
    .filter((v) => {
      const a = v.ais,
        p = a?.position;
      const destination = a?.destination?.trim().toLocaleLowerCase() ?? "";
      if (options.destinationStatus === "missing" && destination) return false;
      if (options.destinationStatus === "received" && !destination)
        return false;
      if (destinationQuery && !destination.includes(destinationQuery))
        return false;
      if (
        q &&
        ![v.name, v.imo, v.mmsi, a?.destination ?? ""].some((x) =>
          x.toLocaleLowerCase().includes(q),
        )
      )
        return false;
      if (
        shipType !== "all" &&
        (a?.shipType == null ||
          Math.floor(a.shipType / 10) !== Number(shipType))
      )
        return false;
      if (
        navStatus !== "all" &&
        (navStatus === "underway"
          ? ![0, 8].includes(a?.navStatus ?? -1)
          : a?.navStatus !== Number(navStatus))
      )
        return false;
      if (
        age !== "all" &&
        (!p ||
          now - Date.parse(p.observedAt) > Number(age) * 60000 ||
          Date.parse(p.observedAt) > now)
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const tie = () =>
        a.name.localeCompare(b.name) || a.mmsi.localeCompare(b.mmsi);
      if (sort === "name") return tie();
      if (sort === "speed")
        return (
          (b.ais?.position?.sogKn ?? -1) - (a.ais?.position?.sogKn ?? -1) ||
          tie()
        );
      return (
        Date.parse(
          b.ais?.position?.observedAt ?? b.ais?.updatedAt ?? "1970-01-01",
        ) -
          Date.parse(
            a.ais?.position?.observedAt ?? a.ais?.updatedAt ?? "1970-01-01",
          ) || tie()
      );
    });
}
