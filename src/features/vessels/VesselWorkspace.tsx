import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  CloudSun,
  Download,
  MoreHorizontal,
  RefreshCw,
  Upload,
  Ship,
  Search,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { MapToolButton } from "./MapToolButton";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { VesselMap } from "./VesselMap";
import { freshness } from "@/domain/control-tower";
import { shipments, type Plant, type Scenario } from "@/domain/operations";
import {
  estimateArrival,
  mergeWorkspace,
  parseWorkspace,
  registerVessel,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import {
  vesselCatalog,
  trackingVoyages,
  sampleWeather,
} from "@/data/vessel-workflow";
import { VesselSearchDialog } from "./VesselSearchDialog";
import { VesselEtaDetail, voyageState } from "./VesselEtaDetail";
import { VesselArrivalSummary } from "./VesselArrivalSummary";
import { VesselSettings } from "./VesselSettings";
import { VesselDataDetails, type VesselDataTab } from "./VesselDataDetails";
import { VesselWeatherEta } from "./VesselWeatherEta";
import { estimateWeatherEta } from "./vessel-weather-eta";
import { plantDestinations } from "./useAisDestinations";
import { watchStatus } from "./vessel-watch-status";
import { VesselWeatherPanel } from "./VesselWeatherPanel";
import { useVesselWorkspace } from "./useVesselWorkspace";
import { useFuelDemo } from "@/domain/fuel-demo";
import { withDemoWatchlist } from "@/data/demo-fleet";
import { useAccount } from "@/lib/account-context";
import { authJson } from "@/lib/auth-client";
import type { Records } from "./VoyageRegistry";
import "./vessel-workflow.css";
import { fetchVesselCatalog } from "./vessel-discovery";
import { mapFleet } from "./vessel-navigation";
import { useTrackedVessels, useVesselRoute } from "./useVesselNavigation";
import { VesselRouteControls, VesselRouteSummary } from "./VesselRouteControls";
import { ROUTE_OFFSET_LIMIT_NM, usesAutomaticEta } from "./vessel-basic-eta";
import { useVesselWeather } from "./useVesselWeather";
import { VesselForecastPanel } from "./VesselForecastPanel";
import { forecastRange } from "./vessel-weather";
import { useCyclones } from "./useCyclones";
import { nearbyCyclones, type WeatherMetric } from "./vessel-weather-layers";
import { VesselMapWeather } from "./VesselMapWeather";
import { VesselPortVisits } from "./VesselPortVisits";
import { VesselCargoSummary } from "./VesselCargoSummary";
import { SharedVoyageSummary } from "./SharedVoyageSummary";
import { VesselVoyageCard } from "./VesselVoyageCard";
import type { BerthFeed } from "@/domain/use-berth-feed";
import "./vessel-operations.css";
import "./vessel-route-cards.css";
import { VoyageRegistry } from './VoyageRegistry';
import { WaitingCandidatesPanel } from "./WaitingCandidatesPanel";
import type { WaitingCandidate } from "@/domain/waiting-candidates";

export function VesselTracking({
  plants,
  theme,
  scenario,
  selectedId,
  onSelect,
  onPlant,
  pageNavigation,
  berthFeed,
}: {
  plants: Plant[];
  theme: "light" | "dark";
  scenario: Scenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlant: (id: string) => void;
  pageNavigation?: ReactNode;
  berthFeed?: BerthFeed;
}) {
  const { workspace: storedWorkspace, save: saveStored, error, setError } = useVesselWorkspace();
  // 모의 선박은 화면에만 고정하고 계정 관심 목록에는 저장하지 않는다.
  const save = (next: typeof storedWorkspace) =>
    saveStored({ ...next, watchlist: withDemoWatchlist(next.watchlist, false) });
  const demoOn = useFuelDemo().status !== "disabled";
  const workspace = useMemo(
    () => ({ ...storedWorkspace, watchlist: withDemoWatchlist(storedWorkspace.watchlist, demoOn) }),
    [storedWorkspace, demoOn],
  );
  const account = useAccount();
  const [registryOpen, setRegistryOpen] = useState<'voyages' | 'cargo' | null>(null);
  const [registryKey, setRegistryKey] = useState('');
  const [registry, setRegistry] = useState<Records | null>(null);
  const [registryStatus, setRegistryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setRegistryStatus('loading');
    authJson<Records>('/api/voyage-registry/records', { signal: controller.signal })
      .then(value => { setRegistry(value); setRegistryStatus('ready'); })
      .catch(() => { if (!controller.signal.aborted) { setRegistry(null); setRegistryStatus('error'); } });
    return () => controller.abort();
  }, [registryOpen]);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const [, tick] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const [filter, setFilter] = useState("all");
  const [interestQuery, setInterestQuery] = useState("");
  const [listCollapsed, setListCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [weatherOn, setWeatherOn] = useState(false);
  const [weatherHour, setWeatherHour] = useState(0);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [forecastOn, setForecastOn] = useState(false);
  const [forecastIndex, setForecastIndex] = useState(0);
  const [forecastHours, setForecastHours] = useState<72 | 168>(168);
  const [weatherMetric, setWeatherMetric] = useState<WeatherMetric>("wave");
  const [cycloneOn, setCycloneOn] = useState(true);
  const [importing, setImporting] = useState(false);
  const [refreshingAis, setRefreshingAis] = useState(false);
  const [showOrb, setShowOrb] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataTab, setDataTab] = useState<VesselDataTab>("ais");
  const [weatherModel, setWeatherModel] = useState({ key: "", sensitivity: 1 });
  const upload = useRef<HTMLInputElement>(null);
  const watchlistRef = useRef<HTMLDivElement>(null);
  const [draggingVessel, setDraggingVessel] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ id: string; after: boolean } | null>(null);
  const cardPositions = useRef(new Map<string, number>());
  useEffect(() => {
    if (!importing) {
      setShowOrb(false);
      return;
    }
    const timer = setTimeout(() => setShowOrb(true), 250);
    return () => clearTimeout(timer);
  }, [importing]);
  const storedCatalog = useMemo<TrackingVessel[]>(
    () => [
      ...vesselCatalog.map((v) => {
        const stored = workspace.vessels.find((s) => s.id === v.id);
        return {
          ...v,
          imo: stored?.imo || v.imo,
          mmsi: stored?.mmsi || v.mmsi,
        };
      }),
      ...workspace.vessels
        .filter((v) => !vesselCatalog.some((s) => s.id === v.id))
        .map(({ legacyId: _alias, ...v }) => v),
    ],
    [workspace.vessels],
  );
  const tracking = useTrackedVessels(storedCatalog, workspace.watchlist);
  const [waitingConfirmed, setWaitingConfirmed] = useState<Record<string, string>>({});
  const [mapFocus, setMapFocus] = useState<{ mmsi: string; longitude: number; latitude: number; key: number } | null>(null);
  const watchlistMmsi = useMemo(
    () => new Set(workspace.vessels.filter((v) => workspace.watchlist.includes(v.id) && v.source !== "demo" && v.mmsi).map((v) => v.mmsi)),
    [workspace.vessels, workspace.watchlist],
  );
  const catalog = useMemo(
    () =>
      storedCatalog.map((v) => {
        if (v.source === "demo") return v;
        const live = tracking.vessels.find(
          (item) =>
            item.mmsi === v.mmsi &&
            (v.source === "manual" || item.source === v.source),
        );
        if (
          !live ||
          Date.parse(live.ais?.position?.observedAt ?? "1970-01-01") <
            Date.parse(v.ais?.position?.observedAt ?? "1970-01-01")
        )
          return v;
        return { ...v, ...live, id: v.id };
      }),
    [storedCatalog, tracking.vessels],
  );
  const allVoyages = useMemo(
    () => [
      ...workspace.voyages,
      ...trackingVoyages.filter(
        (v) => !workspace.voyages.some((o) => o.vesselId === v.vesselId),
      ),
    ],
    [workspace.voyages],
  );
  const rows = useMemo(
    () =>
      workspace.watchlist.flatMap((id) => {
        const vessel = catalog.find((v) => v.id === id);
        if (!vessel) return [];
        const query = interestQuery.trim().toLocaleLowerCase();
        if (
          query &&
          !`${vessel.name} ${vessel.mmsi} ${vessel.imo}`
            .toLocaleLowerCase()
            .includes(query)
        )
          return [];
        const voyage = allVoyages.find((v) => v.vesselId === id);
        const state = watchStatus(vessel, voyage);
        const attention =
          !voyage ||
          !estimateArrival(voyage).eta ||
          !voyage.position ||
          freshness(voyage.position.observedAt, now) === "STALE";
        if (
          (filter === "attention" && !attention) ||
          (filter === "underway" && state !== "underway") ||
          (filter === "planned" && state !== "planned")
        )
          return [];
        return [{ vessel, voyage }];
      }),
    [workspace.watchlist, catalog, allVoyages, filter, now, interestQuery],
  );
  const selected =
    rows.find(
      (r) => r.vessel.id === selectedId || r.vessel.legacyId === selectedId,
    ) ?? rows[0];
  const displayRows = useMemo(() => {
    if (!draggingVessel || !dragTarget || draggingVessel === dragTarget.id) return rows;
    const moving = rows.find(row => row.vessel.id === draggingVessel);
    const rest = rows.filter(row => row.vessel.id !== draggingVessel);
    const index = rest.findIndex(row => row.vessel.id === dragTarget.id);
    if (!moving || index < 0) return rows;
    rest.splice(index + (dragTarget.after ? 1 : 0), 0, moving);
    return rest;
  }, [rows, draggingVessel, dragTarget]);
  const displayOrder = displayRows.map(row => row.vessel.id).join('|');
  useLayoutEffect(() => {
    const cards = watchlistRef.current?.querySelectorAll<HTMLElement>('.gf-voyage-card-wrap');
    if (!cards) return;
    const previous = cardPositions.current;
    const next = new Map<string, number>();
    for (const card of cards) {
      const id = card.dataset.vesselId;
      if (!id) continue;
      const top = card.getBoundingClientRect().top;
      next.set(id, top);
      const old = previous.get(id);
      if (old !== undefined && Math.abs(old - top) > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        card.getAnimations().forEach(animation => animation.cancel());
        card.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }
    cardPositions.current = next;
  }, [displayOrder]);
  const select = (v: TrackingVessel) => onSelect(v.id);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const list = watchlistRef.current;
      const card = list?.querySelector<HTMLElement>(".gf-voyage-card.selected");
      if (!list || !card) return;
      const frame = list.getBoundingClientRect(), item = card.getBoundingClientRect();
      const available = frame.height - 32;
      const offset = item.height > available || item.top < frame.top + 10
        ? item.top - frame.top - 10
        : Math.max(0, item.bottom - frame.bottom + 20);
      if (offset) list.scrollTo({
        top: list.scrollTop + offset,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [selected?.vessel.id]);
  const navigation = useVesselRoute(
    selected?.vessel,
    tracking.owner,
    tracking.ready,
    catalog.filter((v) => workspace.watchlist.includes(v.id)),
  );
  const forecast = useVesselWeather(
    catalog,
    workspace.watchlist,
    navigation.destinations,
    tracking.owner,
    tracking.ready,
    allVoyages,
  );
  const selectedForecast = selected
    ? forecastRange(forecast.get(selected.vessel), forecastHours)
    : undefined;
  const basicEta =
    selected && usesAutomaticEta(selected.vessel)
      ? navigation.getBasicEta(selected.vessel, now, selected.voyage?.state)
      : undefined;
  const modelKey = `${selected?.vessel.id}/${navigation.destination}`;
  const sensitivity =
    weatherModel.key === modelKey ? weatherModel.sensitivity : 1;
  const setSensitivity = (value: number) =>
    setWeatherModel({ key: modelKey, sensitivity: value });
  const weatherEta =
    selected && basicEta
      ? estimateWeatherEta({
          vessel: selected.vessel,
          basic: basicEta,
          forecast: selectedForecast?.data,
          now,
          sensitivity,
        })
      : undefined;
  useEffect(() => {
    setDataOpen(false);
    setDataTab("ais");
  }, [selected?.vessel.id]);
  useEffect(
    () => setWeatherModel({ key: modelKey, sensitivity: 1 }),
    [modelKey],
  );
  function showData(tab: VesselDataTab) {
    setDataTab(tab);
    setDataOpen(true);
    requestAnimationFrame(() =>
      document
        .querySelector(
          '.vessel-data-details [role="tab"][aria-selected="true"]',
        )
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  const cyclones = useCyclones(
    forecastOn &&
      cycloneOn &&
      selected?.vessel.source !== "demo" &&
      !!selectedForecast?.data?.points.length,
  );
  const relatedStorms = useMemo(() => {
    const data = cyclones.data;
    if (
      !data?.fetchedAt ||
      now - Date.parse(data.fetchedAt) < 0 ||
      now - Date.parse(data.fetchedAt) > 6 * 3600000
    )
      return [];
    return nearbyCyclones(
      data.storms,
      selectedForecast?.data?.points ?? [],
      now,
    );
  }, [cyclones.data, selectedForecast?.data, now]);
  const weatherOverlay = useMemo(
    () =>
      forecastOn && selected?.vessel.source !== "demo"
        ? {
            points: selectedForecast?.data?.points ?? [],
            index: forecastIndex,
            metric: weatherMetric,
            storms: cycloneOn ? relatedStorms : [],
            now,
            route: navigation.route,
            speedKn: selectedForecast?.data?.speedKn,
            course: selected?.vessel.ais?.position?.cogDeg,
            onSelectPoint: setForecastIndex,
          }
        : undefined,
    [
      forecastOn,
      selected?.vessel.source,
      selectedForecast?.data,
      forecastIndex,
      weatherMetric,
      cycloneOn,
      relatedStorms,
      now,
      navigation.route,
      selected?.vessel.ais?.position?.cogDeg,
    ],
  );
  useEffect(
    () => setForecastIndex(0),
    [selected?.vessel.id, navigation.destination, forecastHours],
  );
  const fleet = useMemo(() => mapFleet(rows), [rows]);
  const mapShipments = useMemo(
    () =>
      fleet.items.map((item) => ({
        ...item,
        plantId:
          item.id === selected?.vessel.id && navigation.destination
            ? navigation.destination
            : item.plantId,
      })),
    [fleet.items, selected?.vessel.id, navigation.destination],
  );
  const mapPositions = fleet.positions;
  const canMap = mapShipments.some(
    (item) => item.id === (selected?.vessel.legacyId ?? selected?.vessel.id),
  );
  const selectionNotice =
    selected && !canMap
      ? `${selected.vessel.name} · ${selected.voyage ? voyageState[selected.voyage.state] : "항차 미연결"} · ${
          selected.vessel.ais?.position
            ? "AIS 관측 저장됨 · 항차와 지도 연결은 별도입니다."
            : !selected.voyage?.position
              ? "현재 위치 미수신"
              : selected.voyage.state === "cancelled"
                ? "취소된 항차는 지도에 표시하지 않습니다."
                : "현재 항차에 맞는 지도 연결 정보가 없습니다."
        }${mapShipments.length ? ` · 위치가 확인된 다른 관심 선박 ${mapShipments.length}척을 표시합니다.` : ""}`
      : undefined;
  const weatherPoints = useMemo(
    () =>
      weatherOn &&
      !weatherFailed &&
      canMap &&
      selected?.vessel.source === "demo"
        ? sampleWeather(selected?.vessel.legacyId, weatherHour)
        : [],
    [weatherOn, weatherFailed, canMap, selected?.vessel.legacyId, weatherHour],
  );
  function add(vessel: TrackingVessel) {
    const next = registerVessel(workspace, vessel, vesselCatalog);
    save(next);
    setFilter("all");
    setInterestQuery("");
    const canonical =
      [...next.vessels, ...catalog].find(
        (v) =>
          v.id === vessel.id ||
          (v.imo && v.imo === vessel.imo) ||
          (v.mmsi && v.mmsi === vessel.mmsi),
      ) ?? vessel;
    select(canonical);
    setNotice(
      account
        ? "관심 목록에 추가했습니다. 계정 저장 상태를 확인해 주세요."
        : "관심 목록에 추가했습니다. 이 브라우저에만 저장됩니다.",
    );
  }
  function showOnMap(c: WaitingCandidate) {
    setMapFocus((current) => ({ mmsi: c.mmsi, longitude: c.position.longitude, latitude: c.position.latitude, key: (current?.key ?? 0) + 1 }));
    document.querySelector(".vessel-map-stage")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function removeInterest(id: string) {
    const current = latestWorkspace.current;
    save({
      ...current,
      watchlist: current.watchlist.filter((vesselId) => vesselId !== id),
    });
    setNotice("관심만 해제했습니다. 항차와 화물은 보존됩니다.");
  }
  function reorderInterest(id: string, target: string, after: boolean) {
    const current = latestWorkspace.current;
    const visible = rows.map(row => row.vessel.id).filter(key => current.watchlist.includes(key));
    if (id === target || !visible.includes(id) || !visible.includes(target)) return;
    const nextVisible = visible.filter(key => key !== id);
    nextVisible.splice(nextVisible.indexOf(target) + (after ? 1 : 0), 0, id);
    const visibleSet = new Set(visible);
    let index = 0;
    const watchlist = current.watchlist.map(key => visibleSet.has(key) ? nextVisible[index++] : key);
    const next = { ...current, watchlist };
    latestWorkspace.current = next;
    save(next);
    setNotice('관심 선박 순서를 변경했습니다.');
  }
  function saveVoyage(voyage: TrackingVoyage) {
    save({
      ...workspace,
      voyages: [
        ...workspace.voyages.filter((v) => v.vesselId !== voyage.vesselId),
        voyage,
      ],
    });
    setFilter("all");
    setNotice(
      "항차 가정을 저장했습니다. 팀 입하·재고 원장은 변경되지 않습니다.",
    );
  }
  async function refreshAis() {
    tick((n) => n + 1);
    if (
      !workspace.vessels.some(
        (v) => v.ais && workspace.watchlist.includes(v.id),
      )
    ) {
      setNotice(
        "확인 완료 · 실제 AIS 관심 선박이 없습니다. 표본의 최신성만 재평가했습니다.",
      );
      return;
    }
    setRefreshingAis(true);
    try {
      const providers = (["aisstream", "digitraffic"] as const).filter(
        (provider) =>
          workspace.vessels.some(
            (v) => v.source === provider && workspace.watchlist.includes(v.id),
          ),
      );
      const snapshots = await Promise.all(
        providers.map((provider) =>
          fetchVesselCatalog(AbortSignal.timeout(12000), provider),
        ),
      );
      let next = latestWorkspace.current;
      let matched = 0;
      for (const vessel of snapshots.flatMap((snapshot) => snapshot.vessels)) {
        if (
          ![...vesselCatalog, ...next.vessels].some(
            (v) =>
              next.watchlist.includes(v.id) &&
              v.source !== "demo" &&
              (v.mmsi === vessel.mmsi || (v.imo && v.imo === vessel.imo)),
          )
        )
          continue;
        next = registerVessel(next, vessel, vesselCatalog);
        matched++;
      }
      if (matched) save(next);
      setNotice(
        `AIS 수신 목록과 관심 선박 ${matched}척을 대조했습니다. 수신되지 않은 선박의 이전 관측은 유지합니다. 항차·ETA 가정은 변경하지 않았습니다.`,
      );
    } catch {
      setNotice(
        "AIS 업데이트 실패 · 서버 연결을 확인해 주세요. 저장된 관측은 유지합니다.",
      );
    } finally {
      setRefreshingAis(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      if (file.size > 1000000) throw new Error("파일은 1MB 이하여야 합니다.");
      save(
        mergeWorkspace(
          workspace,
          parseWorkspace(await file.text()),
          vesselCatalog,
        ),
      );
      setNotice("목록을 병합했습니다. 기존 항차 편집값은 유지했습니다.");
    } catch (e) {
      setError(
        `가져오기 실패: ${e instanceof Error ? e.message : "파일을 확인해 주세요."}`,
      );
    } finally {
      setImporting(false);
      if (upload.current) upload.current.value = "";
    }
  }
  function exportFile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ ...workspace, watchlist: withDemoWatchlist(workspace.watchlist, false) }, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "genforecast-vessel-watchlist.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const workspaceNavigation = <div className="gf-voyages-top">
    <div className="gf-voyages-heading"><div><h1>항차·화물</h1><p>선박 위치와 항차·화물 정보를 확인합니다.</p></div><div className="gf-voyages-related">{pageNavigation}</div></div>
    <nav className="gf-voyages-navigation" aria-label="항차·화물 화면">
      <button aria-current={!registryOpen ? 'page' : undefined} onClick={() => { setRegistryOpen(null); setRegistryKey(''); }}>선박 추적</button>
      <button aria-current={registryOpen ? 'page' : undefined} onClick={() => { if (!registryOpen) setRegistryOpen('voyages'); }}>항차·화물 원장</button>
    </nav>
  </div>;
  if (registryOpen) return <VoyageRegistry navigation={workspaceNavigation} initialEntity={registryOpen} initialKey={registryKey} interestVessels={catalog.filter(v => v.source !== 'demo' && workspace.watchlist.includes(v.id))} />;
  return (
    <div className="tower-page vessel-workflow gf-voyages">
      {workspaceNavigation}
      {showOrb && (
        <ProcessingOrb
          theme={theme}
          state="connecting"
          label="관심 목록 파일을 읽는 중"
        />
      )}
      {error && (
        <p role="alert" className="vessel-workflow-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="vessel-workflow-notice">
          {notice}
        </p>
      )}
      <div className="vessel-eta-workspace">
        <aside
          className="vessel-watchlist-panel"
          data-collapsed={listCollapsed}
        >
          <WaitingCandidatesPanel
            watchlistMmsi={watchlistMmsi}
            onAdd={add}
            onShowOnMap={showOnMap}
            onConfirmed={setWaitingConfirmed}
          />
          <header className="vessel-workspace-header" aria-label="관심 선박 관리">
            <div className="vessel-workspace-heading">
              <div className="vessel-workspace-summary">
                <div className="vessel-workspace-title">
                  <h2>관심 선박</h2>
                  <span>
                    {workspace.watchlist.length}척
                    {rows.length !== workspace.watchlist.length &&
                      ` · 현재 범위 ${rows.length}척`}
                    {account?.saving
                      ? " · 저장 중"
                      : account?.error
                        ? " · 미저장 변경 있음"
                        : ""}
                  </span>
                </div>
              </div>
              <div className="vessel-workflow-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshingAis}
                  onClick={() => void refreshAis()}
                >
                  <RefreshCw size={13} />
                  <span className="sr-only">업데이트 확인</span>
                </Button>
                <VesselSearchDialog
                  catalog={catalog}
                  interests={workspace.watchlist}
                  onAdd={add}
                  onRemove={removeInterest}
                  theme={theme}
                />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="관심 목록 더보기"
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content
                    className="vessel-workspace-menu"
                    align="end"
                    sideOffset={6}
                  >
                    <DropdownMenu.Item onSelect={exportFile}>
                      <Download size={14} /> 내보내기
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      disabled={importing}
                      onSelect={() => upload.current?.click()}
                    >
                      <Upload size={14} /> 가져오기
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <input
                  className="sr-only"
                  ref={upload}
                  type="file"
                  accept=".json,application/json"
                  aria-label="관심 목록 가져오기"
                  disabled={importing}
                  onChange={(e) => void importFile(e.target.files?.[0])}
                />
              </div>
            </div>
          </header>
          <button
            type="button"
            className="vessel-watchlist-toggle"
            aria-expanded={!listCollapsed}
            aria-controls="vessel-watchlist-content"
            aria-label={`선박 목록 ${listCollapsed ? "펼치기" : "접기"}`}
            onClick={() => setListCollapsed(!listCollapsed)}
          >
            <span>선박 목록</span>
            <span>{selected?.vessel.name ?? "선택 없음"}</span>
            <ChevronDown size={14} />
          </button>
          <div
            id="vessel-watchlist-content"
            className="vessel-watchlist-content"
          >
            <label className="gf-voyages-quick-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="관심 선박 빠른 검색"
                placeholder="선박명 또는 MMSI"
                value={interestQuery}
                onChange={(e) => setInterestQuery(e.target.value)}
              />
            </label>
            <div
              className="vessel-workflow-filters"
              role="group"
              aria-label="관심 선박 상태 필터"
            >
              {[
                ["all", "전체 관심"],
                ["underway", "항해 중"],
                ["planned", "출항 예정"],
                ["attention", "확인 필요"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  aria-label={label}
                  size="sm"
                  variant={filter === value ? "secondary" : "ghost"}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? "전체" : label}
                </Button>
              ))}
            </div>
            <div ref={watchlistRef} className="vessel-watchlist" aria-label="관심 선박 목록">
              {displayRows.map(({ vessel, voyage }) => {
                const ships = registry?.ships.filter(s => vessel.source !== 'demo' && vessel.mmsi && s.mmsi === vessel.mmsi) ?? [];
                const matches = ships.length === 1 ? registry?.voyages.filter(v => v.ship_code === ships[0].ship_code && ['underway', 'arrived', 'berthed', 'unloading'].includes(String(v.status))) ?? [] : [];
                const cargo = matches.length === 1 ? registry?.cargo.filter(c => c.voyage_no === matches[0].voyage_no) ?? [] : [];
                const quality = cargo.length === 1 ? registry?.quality_selection[String(cargo[0].cargo_no)] : null;
                return (
                <VesselVoyageCard
                  key={vessel.id}
                  vessel={vessel}
                  voyage={voyage}
                  coalName={cargo.length === 1 ? String(cargo[0].coal_name || '') : cargo.length > 1 ? `복수 탄종 ${cargo.length}건` : undefined}
                  cargoCv={typeof quality?.gcv_arb === 'number' ? quality.gcv_arb : undefined}
                  sharedCargo={cargo.length > 0}
                  registry={registry}
                  registryStatus={registryStatus}
                  waitingConfirmedAt={vessel.source !== 'demo' && vessel.mmsi ? waitingConfirmed[vessel.mmsi] : undefined}
                  observationLoading={vessel.source !== 'demo' && Boolean(berthFeed?.status === 'loading' || (!tracking.ready && !tracking.error))}
                  now={now}
                  selected={selected?.vessel.id === vessel.id}
                  onSelect={() => select(vessel)}
                  onRemove={() => removeInterest(vessel.id)}
                  dragging={draggingVessel === vessel.id}
                  dropSide={dragTarget?.id === vessel.id && draggingVessel !== vessel.id ? (dragTarget.after ? 'after' : 'before') : undefined}
                  onDragStart={() => { setDraggingVessel(vessel.id); setDragTarget(null); }}
                  onDragOver={(after) => { if (vessel.id !== draggingVessel) setDragTarget(previous => previous?.id === vessel.id && previous.after === after ? previous : { id: vessel.id, after }); }}
                  onDrop={() => { if (draggingVessel && dragTarget) reorderInterest(draggingVessel, dragTarget.id, dragTarget.after); setDraggingVessel(null); setDragTarget(null); }}
                  onDragEnd={() => { setDraggingVessel(null); setDragTarget(null); }}
                  onMove={(direction) => {
                    const visible = rows.map(row => row.vessel.id);
                    const index = visible.indexOf(vessel.id);
                    const target = visible[index + direction];
                    if (target) reorderInterest(vessel.id, target, direction > 0);
                  }}
                  onTouchStart={() => { setDraggingVessel(vessel.id); setDragTarget(null); }}
                  onTouchMove={(targetId, after) => { if (targetId !== vessel.id) setDragTarget(previous => previous?.id === targetId && previous.after === after ? previous : { id: targetId, after }); }}
                  onTouchDrop={(targetId, after) => { const target = targetId === vessel.id ? dragTarget : targetId ? { id: targetId, after } : null; if (target) reorderInterest(vessel.id, target.id, target.after); setDraggingVessel(null); setDragTarget(null); }}
                  onTouchCancel={() => { setDraggingVessel(null); setDragTarget(null); }}
                  berthObservation={vessel.source !== "demo" && vessel.mmsi
                    ? berthFeed?.rows.find(row => row.vessel.mmsi === vessel.mmsi)
                    : undefined}
                  basic={
                    usesAutomaticEta(vessel)
                      ? navigation.getBasicEta(vessel, now, voyage?.state)
                      : undefined
                  }
                />
              ); })}
              {!rows.length && (
                <div className="vessel-workflow-empty">
                  조건에 맞는 관심 선박이 없습니다. 검색어·상태 필터를 바꾸거나
                  선박을 추가해 주세요.
                </div>
              )}
            </div>
          </div>
        </aside>
        <div className="vessel-eta-map-column">
          {selected && (
            <div className="vessel-map-command-bar">
              <div className="gf-voyages-selected">
                <Ship size={20} aria-hidden="true" />
                <div>
                  <strong>{selected.vessel.name}</strong>
                  <small>MMSI {selected.vessel.mmsi || "미등록"}</small>
                </div>
              </div>
              {selected.vessel.source !== "demo" ? (
                <VesselRouteControls
                  vessel={selected.vessel}
                  navigation={{
                    ...navigation,
                    refresh: () => {
                      navigation.refresh();
                      forecast.refresh();
                    },
                  }}
                  trackingError={tracking.error}
                />
              ) : (
                <p className="vessel-demo-destination">
                  목적항{" "}
                  <strong>{selected.voyage?.destination ?? "미확정"}</strong>
                  <span className="tower-status">시연 자료</span>
                </p>
              )}
              <VesselSettings
                key={selected.vessel.id}
                vessel={selected.vessel}
                voyage={selected.voyage}
                navigation={{
                  ...navigation,
                  refresh: () => {
                    navigation.refresh();
                    forecast.refresh();
                  },
                }}
                sensitivity={sensitivity}
                setSensitivity={setSensitivity}
                onSave={saveVoyage}
                onRemove={() => removeInterest(selected.vessel.id)}
              />
            </div>
          )}
          <div className="vessel-map-stage">
            <VesselMap
              embedded
              fleetDiscovery={{
                interests: catalog
                  .filter(
                    (v) =>
                      workspace.watchlist.includes(v.id) &&
                      v.source === "aisstream",
                  )
                  .map((v) => v.mmsi),
                onAdd: add,
                focus: mapFocus,
              }}
              shipments={mapShipments}
              positions={mapPositions}
              plants={plants.filter((p) => plantDestinations.includes(p.id))}
              selectedVesselId={
                selected?.vessel.legacyId ?? selected?.vessel.id ?? null
              }
              onSelect={(id) =>
                onSelect(catalog.find((v) => v.legacyId === id)?.id ?? id)
              }
              theme={theme}
              weatherPoints={
                selected?.vessel.source === "demo" ? weatherPoints : undefined
              }
              weatherOverlay={weatherOverlay}
              weatherToolbar={
                selected && selected.vessel.source !== "demo" ? (
                  <MapToolButton
                    label="지도 기상 레이어"
                    aria-pressed={forecastOn}
                    onClick={() => setForecastOn((v) => !v)}
                  >
                    <CloudSun />
                  </MapToolButton>
                ) : undefined
              }
              weatherTimeline={
                forecastOn &&
                selectedForecast &&
                selected?.vessel.source !== "demo" ? (
                  <VesselMapWeather
                    state={selectedForecast}
                    hours={forecastHours}
                    setHours={setForecastHours}
                    remainingNm={basicEta?.distanceNm ?? null}
                    metric={weatherMetric}
                    setMetric={setWeatherMetric}
                    index={forecastIndex}
                    setIndex={setForecastIndex}
                    storms={relatedStorms}
                    cycloneData={cyclones.data}
                    cycloneError={cyclones.error}
                    cycloneBusy={cyclones.busy}
                    cycloneOn={cycloneOn}
                    setCycloneOn={setCycloneOn}
                    onShowDetails={() => showData("weather")}
                    refresh={() => {
                      forecast.refresh();
                      cyclones.refresh();
                    }}
                  />
                ) : undefined
              }
              showVesselPanel={false}
              selectionNotice={selectionNotice}
              navigationRoutes={navigation.routes}
            />
          </div>
          {selected && (
            <div className="gf-voyages-arrival-board">
              <VesselArrivalSummary
                vessel={selected.vessel}
                voyage={selected.voyage}
                now={now}
                basic={basicEta}
                weather={weatherEta}
                forecast={selectedForecast}
                registry={registry}
                observationLoading={selected.vessel.source !== 'demo' && Boolean(berthFeed?.status === 'loading' || (!tracking.ready && !tracking.error))}
                berthObservation={selected.vessel.source !== "demo" && selected.vessel.mmsi
                  ? berthFeed?.rows.find(row => row.vessel.mmsi === selected.vessel.mmsi)
                  : undefined}
                unverifiedConnection={
                  (navigation.route?.startOffsetNm ?? 0) > ROUTE_OFFSET_LIMIT_NM
                }
                onShowBasis={() => showData("basis")}
              />
              {selected.vessel.source !== 'demo' && <SharedVoyageSummary vessel={selected.vessel} registry={registry} status={registryStatus} onOpen={(key) => { setRegistryKey(key ?? ''); setRegistryOpen('voyages'); }} />}
              {selected.voyage && <VesselCargoSummary vessel={selected.vessel} voyage={selected.voyage} />}
            </div>
          )}
          {selected && (
            <VesselDataDetails
              key={selected.vessel.id}
              open={dataOpen}
              onOpenChange={setDataOpen}
              tab={dataTab}
              onTabChange={setDataTab}
              observation={
                <VesselEtaDetail
                  vessel={selected.vessel}
                  voyage={selected.voyage}
                  now={now}
                  basicEta={basicEta}
                  onPlant={onPlant}
                />
              }
              ports={
                selected.vessel.source !== "demo" ? (
                  <VesselPortVisits
                    key={selected.vessel.id}
                    vessel={selected.vessel}
                    owner={tracking.owner}
                    ready={tracking.ready}
                    theme={theme}
                  />
                ) : undefined
              }
              weather={
                selected.vessel.source !== "demo" && selectedForecast ? (
                  <VesselForecastPanel
                    state={selectedForecast}
                    hours={forecastHours}
                    setHours={setForecastHours}
                    busy={forecast.busy}
                    theme={theme}
                    enabled={forecastOn}
                    setEnabled={setForecastOn}
                    index={forecastIndex}
                    setIndex={setForecastIndex}
                    refresh={forecast.refresh}
                  />
                ) : (
                  <VesselWeatherPanel
                    enabled={weatherOn}
                    setEnabled={setWeatherOn}
                    hour={weatherHour}
                    setHour={setWeatherHour}
                    failed={weatherFailed}
                    setFailed={setWeatherFailed}
                    points={weatherPoints}
                  />
                )
              }
              basis={
                <>
                  <p className="vessel-eta-reason">
                    {basicEta?.reason ??
                      (selected.voyage
                        ? estimateArrival(selected.voyage).reason
                        : "항차 연결에서 목적항과 일정 가정을 등록해 주세요.")}
                  </p>
                  {weatherEta && (
                    <VesselWeatherEta
                      result={weatherEta}
                      sensitivity={sensitivity}
                    />
                  )}
                  {selected.vessel.source !== "demo" && (
                    <VesselRouteSummary
                      vessel={selected.vessel}
                      navigation={navigation}
                      theme={theme}
                    />
                  )}
                  <p>
                    {account
                      ? "관심 목록은 로그인한 계정에 저장됩니다."
                      : "관심 목록은 이 브라우저에 저장됩니다."}{" "}
                    시연 선박은 예시 항로, 실제 선박은 수집 항적과 예상 항로를
                    구분합니다. 기본 ETA는 실제 AIS와 예상 항로 기준이며, 등록
                    항차 일정·접안·하역 가정과 재고 원장은 별도입니다.
                    {scenario.arrivalDelayDays !== 0
                      ? ` 공통 재고 시나리오의 ${scenario.arrivalDelayDays}일 지연은 이 독립 ETA 가정에 중복 적용하지 않습니다.`
                      : ""}
                  </p>
                </>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
