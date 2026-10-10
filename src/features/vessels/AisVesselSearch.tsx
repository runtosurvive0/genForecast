import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Search, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VesselConnectionStatus } from "./VesselConnectionStatus";
import type { TrackingVessel } from "@/domain/vessel-workflow";
import { date } from "@/lib/format";
import {
  DISCOVERY_CAPACITY,
  fetchVesselCatalog,
  filterDiscoveredVessels,
  navStatusLabel,
  shipTypeLabel,
  type DiscoverySnapshot,
} from "./vessel-discovery";

export function AisVesselSearch({
  catalog,
  interests,
  onAdd,
  theme,
  statusHost,
}: {
  catalog: TrackingVessel[];
  interests: string[];
  onAdd: (v: TrackingVessel) => void;
  theme: "light" | "dark";
  statusHost: HTMLDivElement | null;
}) {
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null);
  const [provider, setProvider] =
    useState<DiscoverySnapshot["provider"]>("aisstream");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [orb, setOrb] = useState(false);
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationStatus, setDestinationStatus] = useState("all");
  const [scope, setScope] = useState("korea");
  const [shipType, setShipType] = useState("all");
  const [navStatus, setNavStatus] = useState("all");
  const [age, setAge] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setTimeout>;
    async function read() {
      if (disposed) return;
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      setLoading(true);
      try {
        const next = await fetchVesselCatalog(controller.signal, provider);
        if (disposed) return;
        setSnapshot(next);
        setError("");
        if (
          !["not_configured", "configuration_error", "provider_error"].includes(
            next.status,
          )
        )
          poll = setTimeout(read, provider === "digitraffic" ? 60000 : 10000);
      } catch {
        if (!disposed)
          setError(
            "선박 목록을 받지 못했습니다. Python 서버와 네트워크를 확인한 뒤 다시 시도해 주세요.",
          );
      } finally {
        clearTimeout(timeout);
        if (!disposed) setLoading(false);
      }
    }
    void read();
    return () => {
      disposed = true;
      clearTimeout(poll);
      request.current?.abort();
    };
  }, [refresh, provider]);
  useEffect(() => {
    if (!loading) {
      setOrb(false);
      return;
    }
    const timer = setTimeout(() => setOrb(true), 250);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(
    () => setPage(0),
    [
      query,
      shipType,
      navStatus,
      age,
      sort,
      destination,
      destinationStatus,
      scope,
    ],
  );
  const supportsCandidates = !!snapshot?.koreaCandidates;
  const activeScope = scope === "korea" && !supportsCandidates ? "all" : scope;
  const candidates = useMemo(
    () =>
      new Map(
        (snapshot?.koreaCandidates?.entries ?? []).map((entry) => [
          entry.vessel.mmsi,
          entry,
        ]),
      ),
    [snapshot],
  );
  const allVessels = useMemo(() => {
    const merged = new Map(
      [...candidates].map(([mmsi, entry]) => [mmsi, entry.vessel]),
    );
    for (const vessel of snapshot?.vessels ?? [])
      merged.set(vessel.mmsi, vessel);
    return [...merged.values()];
  }, [snapshot, candidates]);
  const matches = useMemo(
    () =>
      filterDiscoveredVessels(
        activeScope === "korea"
          ? allVessels.filter((v) => candidates.has(v.mmsi))
          : allVessels,
        query,
        shipType,
        navStatus,
        age,
        sort,
        Date.now(),
        {
          destination,
          destinationStatus:
            activeScope === "missing" ? "missing" : destinationStatus,
        },
      ),
    [
      allVessels,
      candidates,
      activeScope,
      query,
      shipType,
      navStatus,
      age,
      sort,
      destination,
      destinationStatus,
    ],
  );
  const lastPage = Math.max(0, Math.ceil(matches.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const registered = (v: TrackingVessel) =>
    catalog.some(
      (c) =>
        interests.includes(c.id) &&
        (c.id === v.id ||
          (v.imo && v.imo === c.imo) ||
          (v.mmsi && v.mmsi === c.mmsi)),
    );
  return (
    <div className="vessel-discovery">
      {statusHost && createPortal(
        <VesselConnectionStatus snapshot={snapshot} loading={orb} error={error} theme={theme} />,
        statusHost,
      )}
      <div className="vessel-discovery-source">
        <div>
          <strong>
            <Radio size={13} />
            <select
              aria-label="AIS 데이터 제공처"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as DiscoverySnapshot["provider"]);
                setSnapshot(null);
                setError("");
                setPage(0);
                setScope(e.target.value === "aisstream" ? "korea" : "all");
                setDestinationStatus("all");
                setDestination("");
              }}
            >
              <option value="aisstream">AISstream</option>
              <option value="digitraffic">Digitraffic · 핀란드 공개 AIS</option>
            </select>
          </strong>
          <span>
            {snapshot?.coverage ??
              (provider === "aisstream"
                ? "서버 수신 범위 확인 중"
                : "핀란드 해역 · 키 없이 실제 목록 조회")}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={13} />
          목록 새로고침
        </Button>
      </div>
      {provider === "digitraffic" && (
        <p className="tower-footnote">
          출처:{" "}
          <a
            href="https://www.digitraffic.fi/en/marine-traffic/"
            target="_blank"
            rel="noreferrer"
          >
            Fintraffic / Digitraffic
          </a>{" "}
          ·{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>{" "}
          · 원본 AIS를 식별자로 결합하고 단위·시각을 정규화했습니다.
          정확성·가용성은 보장되지 않습니다.
        </p>
      )}
      {error && (
        <p role="alert" className="vessel-workflow-error">
          {error} 기존 결과는 유지됩니다.
        </p>
      )}
      {snapshot?.status === "not_configured" && (
        <div className="vessel-discovery-setup">
          <strong>실제 선박을 받으려면 서버 연결이 필요합니다.</strong>
          <p>
            <a href="https://aisstream.io/" target="_blank" rel="noreferrer">
              AISstream에서 키 발급
            </a>{" "}
            후 서버의 <code>AISSTREAM_API_KEY</code>를 설정하고 다시 시작해
            주세요. 키는 이 창에 입력하지 않습니다.
          </p>
        </div>
      )}
      <div
        className="vessel-discovery-scopes"
        role="group"
        aria-label="AIS 검색 범위"
      >
        {(
          [
            [
              "korea",
              `한국행 후보${supportsCandidates ? ` ${candidates.size}` : ""}`,
            ],
            ["all", "전체"],
            ["missing", "목적지 미확인"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            aria-pressed={activeScope === value}
            disabled={value === "korea" && !supportsCandidates}
            onClick={() => {
              setScope(value);
              setDestinationStatus("all");
              setDestination("");
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <label className="vessel-workflow-search">
        <Search size={15} />
        <input
          aria-label="실제 선박 검색"
          placeholder="선박명, IMO, MMSI 또는 AIS 목적지"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="vessel-discovery-destination">
        <label>
          목적지 검색 · AIS 입력값
          <input
            aria-label="AIS 목적지 필터"
            value={destination}
            disabled={
              destinationStatus === "missing" || activeScope === "missing"
            }
            placeholder="예: DANGJIN, BORYEONG, BUSAN 또는 항만 코드"
            onChange={(e) => setDestination(e.target.value)}
          />
        </label>
        {!supportsCandidates && (
          <label>
            목적지 정보
            <select
              aria-label="목적지 수신 상태"
              value={destinationStatus}
              onChange={(e) => {
                setDestinationStatus(e.target.value);
                setScope("all");
                if (e.target.value === "missing") setDestination("");
              }}
            >
              <option value="all">전체</option>
              <option value="received">목적지 수신</option>
              <option value="missing">목적지 미수신</option>
            </select>
          </label>
        )}
      </div>
      <p className="tower-footnote">
        {supportsCandidates
          ? "한국행 후보는 AIS 목적지의 항만 코드·이름으로 분류한 추정입니다. 현재 위치·국적·선박명은 판별에 쓰지 않으며, 확정 목적항과 석탄 운송 여부는 직접 확인해 주세요. 목적지 미확인은 입력값이 없는 선박입니다."
          : "현재 위치와 목적지는 별개입니다. 목적지 입력값만 검색하며 선박명·국적·좌표로 한국행을 추정하지 않습니다. 미수신은 행선지 미확정이며, 입력값도 변경·오기가 있을 수 있습니다."}
      </p>
      <div className="vessel-discovery-filters">
        <label>
          선종
          <select
            aria-label="선종 필터"
            value={shipType}
            onChange={(e) => setShipType(e.target.value)}
          >
            <option value="all">모든 선종</option>
            <option value="7">화물선</option>
            <option value="8">탱커</option>
            <option value="6">여객선</option>
          </select>
        </label>
        <label>
          운항 상태
          <select
            aria-label="AIS 운항 상태"
            value={navStatus}
            onChange={(e) => setNavStatus(e.target.value)}
          >
            <option value="all">모든 상태</option>
            <option value="underway">항해 중</option>
            <option value="1">묘박</option>
            <option value="5">계류</option>
          </select>
        </label>
        <label>
          위치 관측
          <select
            aria-label="위치 관측 필터"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          >
            <option value="all">모든 시각</option>
            <option value="10">10분 이내</option>
            <option value="60">1시간 이내</option>
            <option value="360">6시간 이내</option>
          </select>
        </label>
        <label>
          정렬
          <select
            aria-label="선박 정렬"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">최근 관측순</option>
            <option value="name">이름순</option>
            <option value="speed">속도 높은 순</option>
          </select>
        </label>
      </div>
      <p className="vessel-discovery-count">
        검색 결과 <strong>{matches.length}척</strong> · 수신 목록{" "}
        {allVessels.length}척
        {supportsCandidates &&
          ` · 일반 ${snapshot?.vessels.length ?? 0}척 + 별도 후보 ${candidates.size}척 (중복 제외)`}
      </p>
      <div className="vessel-discovery-table-wrap">
        <table
          className="vessel-discovery-table"
          aria-label="실제 AIS 선박 검색 결과"
        >
          <thead>
            <tr>
              <th>선박 / 식별자</th>
              <th>선종 / 운항</th>
              <th>속도 / 관측 시각 · KST</th>
              <th>관심 등록</th>
            </tr>
          </thead>
          <tbody>
            {matches
              .slice(currentPage * 20, (currentPage + 1) * 20)
              .map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{v.name}</strong>
                    <span>
                      IMO {v.imo || "미수신"} · MMSI {v.mmsi}
                    </span>
                    <small>AIS 목적지 {v.ais?.destination || "미수신"}</small>
                    {candidates.has(v.mmsi) && (
                      <small className="vessel-discovery-candidate">
                        한국행 후보 · {candidates.get(v.mmsi)!.portName} ·{" "}
                        {candidates.get(v.mmsi)!.matchedBy === "code"
                          ? "목적지 코드 일치"
                          : "목적지 이름 일치"}
                        <span>
                          목적지 수신{" "}
                          {date(
                            candidates.get(v.mmsi)!.destinationObservedAt,
                            true,
                          )}{" "}
                          KST
                        </span>
                      </small>
                    )}
                  </td>
                  <td>
                    {shipTypeLabel(v.ais?.shipType)}
                    <span>{navStatusLabel(v.ais?.navStatus)}</span>
                  </td>
                  <td>
                    {v.ais?.position?.sogKn == null
                      ? "속도 미수신"
                      : `${v.ais.position.sogKn.toFixed(1)} kn`}
                    <span>
                      {v.ais?.position
                        ? date(v.ais.position.observedAt, true)
                        : "위치 미수신"}
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={registered(v)}
                      aria-label={`${v.name} 관심 등록`}
                      onClick={() => onAdd(v)}
                    >
                      {registered(v) ? "등록됨" : "추가"}
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!matches.length && (
          <p className="vessel-workflow-empty">
            {activeScope === "korea" && candidates.size === 0
              ? "한국행 후보가 아직 없습니다. AIS 목적지 메시지가 수신되면 분류됩니다. 전체 목록에서 직접 검색할 수도 있습니다."
              : allVessels.length
                ? "조건에 맞는 선박이 없습니다. 검색어나 필터를 바꿔 주세요."
                : "아직 수신된 선박이 없습니다. 수신 영역 밖이거나 메시지를 보내지 않는 선박은 검색되지 않을 수 있습니다."}
          </p>
        )}
      </div>
      {lastPage > 0 && (
        <div className="vessel-discovery-pagination">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            이전
          </Button>
          <span>
            {currentPage + 1} / {lastPage + 1}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            다음
          </Button>
        </div>
      )}
      <p className="tower-footnote">
        서버가 수신한 최근 최대 {DISCOVERY_CAPACITY.toLocaleString("ko-KR")}척
        {supportsCandidates ? "과 별도 한국행 후보 최대 1,000척" : ""}에서
        검색합니다.
        {supportsCandidates &&
          " 후보는 목적지 수신 후 72시간 보존하며, 목적지 변경·만료·한도 초과 시 제외됩니다. 서버 재시작 시 다시 수집합니다."}{" "}
        전 세계 선박 전체 목록은 아닙니다. 화물선 분류만으로 석탄 운반 여부는
        확인할 수 없습니다. 관심 등록 시 마지막 관측을 저장하며, 항차·확정
        목적항은 별도로 연결합니다.
      </p>
    </div>
  );
}
