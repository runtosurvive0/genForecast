import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  MoreHorizontal,
  RefreshCw,
  Upload,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { VesselMap } from "./VesselMap";
import { freshness } from "@/domain/control-tower";
import {
  BASE_TIME,
  shipments,
  type Plant,
  type Scenario,
} from "@/domain/operations";
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
import { number as n, date as fmtDate } from "@/lib/format";
import { VesselSearchDialog } from "./VesselSearchDialog";
import { VesselEtaDetail, etaDate, voyageState } from "./VesselEtaDetail";
import { VesselWeatherPanel } from "./VesselWeatherPanel";
import { useVesselWorkspace } from "./useVesselWorkspace";
import "./vessel-workflow.css";
import { fetchVesselCatalog } from "./vessel-discovery";
import { mapFleet } from "./vessel-navigation";
import { useTrackedVessels, useVesselRoute } from "./useVesselNavigation";
import { VesselRouteControls, VesselRouteSummary } from "./VesselRouteControls";
import { VesselFreshnessTag } from "./VesselFreshnessTag";
import { usesAutomaticEta } from "./vessel-basic-eta";
import { useVesselWeather } from "./useVesselWeather";
import { VesselForecastPanel, WeatherCredits } from "./VesselForecastPanel";
import { forecastLabels } from "./vessel-weather";
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
  const [weatherMetric, setWeatherMetric] = useState<WeatherMetric>("wave");
  const [cycloneOn, setCycloneOn] = useState(true);
  const [importing, setImporting] = useState(false);
  const [refreshingAis, setRefreshingAis] = useState(false);
  const [showOrb, setShowOrb] = useState(false);
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
        const inScope = !voyage || plants.some((p) => p.id === voyage.plantId);
        const attention =
          !voyage ||
          !estimateArrival(voyage).eta ||
          !voyage.position ||
          freshness(voyage.position.observedAt, now) === "STALE";
        if (
          !inScope ||
          (filter === "attention" && !attention) ||
          (filter === "underway" && voyage?.state !== "underway") ||
          (filter === "planned" && voyage?.state !== "planned")
        )
          return [];
        return [{ vessel, voyage }];
      }),
    [workspace.watchlist, catalog, allVoyages, plants, filter, now],
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
  const selectedForecast = selected ? forecast.get(selected.vessel) : undefined;
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
    ],
  );
  useEffect(
    () => setForecastIndex(0),
    [selected?.vessel.id, navigation.destination],
  );
  const forecastPoints = useMemo(
    () =>
      forecastOn
        ? (selectedForecast?.data?.points ?? []).map((p, i) => ({
            id: `forecast-${selected?.vessel.id}-${i}`,
            longitude: p.longitude,
            latitude: p.latitude,
            at: p.passageAt,
            waveM: p.waveM,
            windKn: p.windKn,
            label: `예보 · ${etaDate(p.passageAt)} KST 통과 · 풍향 ${p.windFromDeg ?? "미수신"}°`,
          }))
        : [],
    [forecastOn, selectedForecast?.data, selected?.vessel.id],
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
    const id = canonical.id;
    select(canonical);
    const addedVoyage = allVoyages.find((v) => v.vesselId === id);
    setNotice(
      addedVoyage && !plants.some((p) => p.id === addedVoyage.plantId)
        ? "관심 목록에 추가했습니다. 현재 발전소 범위 밖입니다. 상단에서 전체 발전본부를 선택해 주세요."
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
      plants.some((p) => p.id === voyage.plantId)
        ? "항차 가정을 저장했습니다. 팀 입하·재고 원장은 변경되지 않습니다."
        : "항차 가정을 저장했습니다. 변경한 목적지가 현재 발전소 범위 밖입니다. 상단 발전소 필터를 바꿔 주세요.",
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
                {workspace.watchlist.length}척 · 현재 범위 {rows.length}척 · 이
                브라우저에 저장
              </span>
            </div>
            <p>
              {catalog.some((v) => v.ais && workspace.watchlist.includes(v.id))
                ? "실제 AIS 관측과 합성 표본을 함께 표시 · 관심 선박 실제 기상 예보 · 표본은 별도 표시"
                : `합성 AIS·기상 · ${fmtDate(BASE_TIME, true)} 기준 표본 · 실제 선박은 추가 창에서 연결`}
            </p>
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
                  size="sm"
                  variant={filter === value ? "secondary" : "ghost"}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="vessel-watchlist" aria-label="관심 선박 목록">
              {rows.map(({ vessel, voyage }) => {
                const automatic = usesAutomaticEta(vessel);
                const estimate = automatic
                  ? navigation.getBasicEta(vessel, now, voyage?.state)
                  : voyage
                    ? estimateArrival(voyage)
                    : null;
                const position = vessel.ais?.position ?? voyage?.position;
                const speed = position?.sogKn;
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
                    <span>
                      {vessel.ais
                        ? `${vessel.source === "digitraffic" ? "Digitraffic · 핀란드" : "AISstream"} · `
                        : ""}
                      {voyage
                        ? `${voyageState[voyage.state]} · ${voyage.destination}`
                        : "항차 미연결"}
                    </span>
                    <span className="vessel-watchlist-speed">
                      {speed != null &&
                      Number.isFinite(speed) &&
                      speed >= 0 &&
                      speed < 102.3
                        ? `${vessel.source === "demo" ? "표본 속도" : "관측 속도"} ${speed.toFixed(1)} kn`
                        : "속도 미수신"}
                    </span>
                    <b>
                      {estimate?.eta ? (
                        <>
                          {etaDate(estimate.eta)} <small>KST</small>
                        </>
                      ) : estimate &&
                        "state" in estimate &&
                        estimate.state === "blocked" ? (
                        "ETA 계산 보류"
                      ) : (
                        "ETA 계산 전"
                      )}
                    </b>
                    <span>
                      {automatic
                        ? estimate?.eta
                          ? "기상 미반영 · 기본 ETA"
                          : estimate?.reason
                        : estimate?.deltaH == null
                          ? voyage
                            ? (estimate?.reason ?? "항차 가정 확인 필요")
                            : "항차 연결 필요"
                          : `등록 계획 대비 ${estimate.deltaH > 0 ? "+" : ""}${n(estimate.deltaH, 1)} h`}
                    </span>
                    {automatic && (
                      <span className="vessel-watchlist-weather">
                        {forecastLabels[forecast.get(vessel).status]}
                      </span>
                    )}
                  </button>
                );
              })}
              {!rows.length && (
                <div className="vessel-workflow-empty">
                  현재 범위에 관심 선박이 없습니다. 선박을 추가하거나
                  상태·발전소 필터를 바꿔 주세요.
                </div>
              )}
            </div>
          </div>
        </aside>
        <div className="vessel-eta-map-column">
          <div className="vessel-map-command-bar">
            <div className="vessel-selection-header">
              <h3>{selected?.vessel.name ?? "선박을 선택해 주세요"}</h3>
              {selected &&
                (() => {
                  const position =
                    selected.vessel.ais?.position ?? selected.voyage?.position;
                  return (
                    <>
                      <VesselFreshnessTag
                        observedAt={position?.observedAt}
                        now={now}
                      />
                      <span className="vessel-selection-observed">
                        {position
                          ? `마지막 관측 ${etaDate(position.observedAt)} KST`
                          : "현재 위치 미수신"}
                      </span>
                    </>
                  );
                })()}
            </div>
            {selected?.vessel.source !== "demo" && selected && (
              <VesselRouteControls
                vessel={selected.vessel}
                navigation={navigation}
                trackingError={tracking.error}
              />
            )}
          </div>
          <VesselMap
            embedded
            shipments={mapShipments}
            positions={mapPositions}
            plants={plants}
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
                <Button
                  size="xs"
                  variant={forecastOn ? "secondary" : "outline"}
                  aria-label="지도 기상 레이어"
                  aria-pressed={forecastOn}
                  onClick={() => setForecastOn((v) => !v)}
                >
                  기상
                </Button>
              ) : undefined
            }
            weatherTimeline={
              forecastOn &&
              selectedForecast &&
              selected?.vessel.source !== "demo" ? (
                <VesselMapWeather
                  state={selectedForecast}
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
          {selected?.vessel.source !== "demo" && !!forecastPoints.length && (
            <div className="vessel-forecast-note">
              표식: 선택한 기상 항목 · 통과 예상 시각별 표본 ·{" "}
              <WeatherCredits />
            </div>
          )}
          {selected?.vessel.source !== "demo" && selected && (
            <VesselRouteSummary
              vessel={selected.vessel}
              navigation={navigation}
              theme={theme}
            />
          )}
          {selected && (
            <VesselEtaDetail
              vessel={selected.vessel}
              voyage={selected.voyage}
              now={now}
              forecast={selectedForecast}
              basicEta={
                usesAutomaticEta(selected.vessel)
                  ? navigation.getBasicEta(
                      selected.vessel,
                      now,
                      selected.voyage?.state,
                    )
                  : undefined
              }
              onPlant={onPlant}
              onSave={saveVoyage}
              onRemove={() => removeInterest(selected.vessel.id)}
            />
          )}
          {selected && selected.vessel.source !== "demo" && (
            <VesselPortVisits
              key={selected.vessel.id}
              vessel={selected.vessel}
              owner={tracking.owner}
              ready={tracking.ready}
              theme={theme}
            />
          )}
          {selected && selected.vessel.source !== "demo" && selectedForecast ? (
            <VesselForecastPanel
              state={selectedForecast}
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
          )}
        </div>
      </div>
      <p className="tower-footnote">
        관심 목록은 로그인·다른 PC와 동기화되지 않습니다. 합성 선박은 예시 항로,
        실제 선박은 수집 항적과 예상 항로를 구분합니다. 기본 ETA는 실제 AIS와
        예상 항로 기준이며, 등록 항차 일정·접안·하역 가정과 재고 원장은
        별도입니다.
        {scenario.arrivalDelayDays !== 0
          ? ` 공통 재고 시나리오의 ${scenario.arrivalDelayDays}일 지연은 이 독립 ETA 가정에 중복 적용하지 않습니다.`
          : ""}
      </p>
    </div>
  );
}
