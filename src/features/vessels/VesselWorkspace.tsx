import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CloudSun,
  Download,
  MoreHorizontal,
  RefreshCw,
  Upload,
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
import { useAccount } from "@/lib/account-context";
import "./vessel-workflow.css";
import { fetchVesselCatalog } from "./vessel-discovery";
import { mapFleet } from "./vessel-navigation";
import { useTrackedVessels, useVesselRoute } from "./useVesselNavigation";
import { VesselRouteControls, VesselRouteSummary } from "./VesselRouteControls";
import { VesselFreshnessTag } from "./VesselFreshnessTag";
import { ROUTE_OFFSET_LIMIT_NM, usesAutomaticEta } from "./vessel-basic-eta";
import { useVesselWeather } from "./useVesselWeather";
import { VesselForecastPanel } from "./VesselForecastPanel";
import { forecastRange } from "./vessel-weather";
import { useCyclones } from "./useCyclones";
import { nearbyCyclones, type WeatherMetric } from "./vessel-weather-layers";
import { VesselMapWeather } from "./VesselMapWeather";
import { VesselPortVisits } from "./VesselPortVisits";

export function VesselTracking({
  plants,
  theme,
  scenario,
  selectedId,
  onSelect,
  onPlant,
}: {
  plants: Plant[];
  theme: "light" | "dark";
  scenario: Scenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlant: (id: string) => void;
}) {
  const { workspace, save, error, setError } = useVesselWorkspace();
  const account = useAccount();
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const [, tick] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const [filter, setFilter] = useState("all");
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
    [workspace.watchlist, catalog, allVoyages, filter, now],
  );
  const selected =
    rows.find(
      (r) => r.vessel.id === selectedId || r.vessel.legacyId === selectedId,
    ) ?? rows[0];
  const select = (v: TrackingVessel) => onSelect(v.id);
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
  function removeInterest(id: string) {
    const current = latestWorkspace.current;
    save({
      ...current,
      watchlist: current.watchlist.filter((vesselId) => vesselId !== id),
    });
    setNotice("관심만 해제했습니다. 항차와 화물은 보존됩니다.");
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
      new Blob([JSON.stringify(workspace, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "genforecast-vessel-watchlist.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="tower-page vessel-workflow">
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
              업데이트 확인
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
          <button
            type="button"
            className="vessel-watchlist-toggle"
            aria-expanded={!listCollapsed}
            aria-controls="vessel-watchlist-content"
            aria-label={`선박 목록 ${listCollapsed ? "펼치기" : "접기"}`}
            onClick={() => setListCollapsed(!listCollapsed)}
          >
            <span>선박 목록 · {rows.length}척</span>
            <span>{selected?.vessel.name ?? "선택 없음"}</span>
            <ChevronDown size={14} />
          </button>
          <div
            id="vessel-watchlist-content"
            className="vessel-watchlist-content"
          >
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
            <div className="vessel-watchlist" aria-label="관심 선박 목록">
              {rows.map(({ vessel, voyage }) => {
                const position = vessel.ais?.position ?? voyage?.position;
                return (
                  <button
                    className={`shipment-card ${selected?.vessel.id === vessel.id ? "selected" : ""}`}
                    key={vessel.id}
                    aria-pressed={selected?.vessel.id === vessel.id}
                    onClick={() => select(vessel)}
                  >
                    <div>
                      <strong>{vessel.name}</strong>
                      <VesselFreshnessTag
                        observedAt={position?.observedAt}
                        now={now}
                      />
                    </div>
                    {voyage && <span>{voyage.destination}</span>}
                    {vessel.source === "demo" && <span>합성 표본</span>}
                  </button>
                );
              })}
              {!rows.length && (
                <div className="vessel-workflow-empty">
                  현재 상태에 해당하는 관심 선박이 없습니다. 선박을 추가하거나
                  상태 필터를 바꿔 주세요.
                </div>
              )}
            </div>
          </div>
        </aside>
        <div className="vessel-eta-map-column">
          {selected && (
            <div className="vessel-map-command-bar">
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
                  <span className="tower-status">합성 표본</span>
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
          {selected && (
            <VesselArrivalSummary
              vessel={selected.vessel}
              voyage={selected.voyage}
              now={now}
              basic={basicEta}
              weather={weatherEta}
              forecast={selectedForecast}
              unverifiedConnection={
                (navigation.route?.startOffsetNm ?? 0) > ROUTE_OFFSET_LIMIT_NM
              }
              onShowBasis={() => showData("basis")}
            />
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
              weatherBusy={
                forecastOn && (forecast.busy || (cycloneOn && cyclones.busy))
              }
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
                    합성 선박은 예시 항로, 실제 선박은 수집 항적과 예상 항로를
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
