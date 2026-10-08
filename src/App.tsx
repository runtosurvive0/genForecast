import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Factory,
  Fuel,
  Gauge,
  Layers3,
  LayoutDashboard,
  Menu,
  Moon,
  Play,
  RotateCcw,
  Settings2,
  Ship,
  Sparkles,
  Sun,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { InventoryChart, OutageTimeline } from "@/components/OperationsCharts";
import { VesselMap } from "@/components/VesselMap";
import {
  BASE_TIME,
  shipments,
  scenarioDefaults,
  simulate,
  type Forecast,
  type Plant,
  type Scenario,
  type Unit,
} from "@/domain/operations";
import {
  plantInputs as plants,
  towerSummary,
  defaultModels,
} from "@/domain/control-tower";
import {
  PlantOverview,
  Stockyard,
  VesselTracking,
  ModelsPage,
  DataPage,
} from "@/components/ControlTower";
import { forecastTask } from "@/lib/forecast-task";
import { number as n, date as fmtDate, shiftDate } from "@/lib/format";

type Page =
  "overview" | "schedule" | "fuel" | "vessels" | "scenario" | "models" | "data";
const pages = [
  {
    id: "overview" as Page,
    label: "발전소 종합",
    icon: LayoutDashboard,
    sub: "재고와 입하탄, 발전 전망을 하나의 흐름으로 확인합니다.",
  },
  {
    id: "fuel" as Page,
    label: "저탄장 현황",
    icon: Layers3,
    sub: "Pile별 재고·탄질과 모의 위험도를 확인합니다.",
  },
  {
    id: "vessels" as Page,
    label: "선박 추적",
    icon: Ship,
    sub: "입하탄의 위치부터 하역 완료까지 연결합니다.",
  },
  {
    id: "models" as Page,
    label: "예측/모델 상세",
    icon: Activity,
    sub: "합성 시계열로 학습한 기준모델과 검증 결과입니다.",
  },
  {
    id: "data" as Page,
    label: "데이터/관리자",
    icon: Settings2,
    sub: "더미데이터와 서비스 연동 상태를 확인합니다.",
  },
  {
    id: "schedule" as Page,
    label: "발전기 정지계획",
    icon: CalendarClock,
    sub: "계획정지와 연료 부족 예측을 구분해 확인합니다.",
  },
  {
    id: "scenario" as Page,
    label: "시나리오 분석",
    icon: Settings2,
    sub: "부하와 입항 지연에 따른 발전 영향을 비교합니다.",
  },
];
const baseMs = new Date(BASE_TIME).getTime();
const isStopped = (unit: Unit) =>
  unit.outages.some(
    (o) =>
      new Date(o.startAt).getTime() <= baseMs &&
      new Date(o.endAt).getTime() > baseMs,
  );
const daysUntil = (time: string) =>
  Math.max(
    0,
    Math.floor((new Date(time).getTime() + 9 * 3600000) / 86400000) -
      Math.floor((baseMs + 9 * 3600000) / 86400000),
  );
const scenarioIsDefault = (s: Scenario) =>
  s.loadChangePct === 0 && s.arrivalDelayDays === 0 && s.includeInbound;

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "good" | "warning" | "danger" | "neutral";
}) {
  return (
    <Badge variant="outline" className={`status-badge status-${tone}`}>
      <span className="status-dot" />
      {children}
    </Badge>
  );
}
function App() {
  const [page, setPage] = useState<Page>("overview");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scope, setScope] = useState("all");
  const [horizon, setHorizon] = useState(30);
  const [applied, setApplied] = useState<Scenario>({ ...scenarioDefaults });
  const [draft, setDraft] = useState<Scenario>({ ...scenarioDefaults });
  const [models, setModels] = useState(defaultModels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<{
    plantId: string;
    unitId?: string;
  } | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const selectedPlants = useMemo(
    () => (scope === "all" ? plants : plants.filter((p) => p.id === scope)),
    [scope],
  );
  const tower = useMemo(
    () => towerSummary(selectedPlants, applied, horizon, models),
    [selectedPlants, applied, horizon, models],
  );
  const forecast = tower.forecast;
  const selectedShipments = shipments.filter((s) =>
    selectedPlants.some((p) => p.id === s.plantId),
  );
  const baseline = useMemo(
    () =>
      towerSummary(selectedPlants, scenarioDefaults, horizon, models).forecast,
    [selectedPlants, horizon, models],
  );
  const units = selectedPlants.flatMap((p) => p.units);
  const running = units.filter((u) => !isStopped(u) && u.loadPct > 0).length;
  const outages = selectedPlants
    .flatMap((p) =>
      p.units.flatMap((u) =>
        u.outages.map((o) => ({ ...o, plant: p, unit: u })),
      ),
    )
    .filter((o) => new Date(o.endAt).getTime() > baseMs)
    .sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  const nextOutage = outages.find(
    (o) => new Date(o.startAt).getTime() > baseMs,
  );
  const riskPlants = forecast.byPlant
    .filter((p) => p.firstShortageAt)
    .sort(
      (a, b) =>
        new Date(a.firstShortageAt!).getTime() -
        new Date(b.firstShortageAt!).getTime(),
    );
  const safetyStock = forecast.byPlant.reduce(
    (s, p) =>
      s +
      p.dailyConsumptionTons *
        (plants.find((x) => x.id === p.plantId)?.lowStockDays ?? 7),
    0,
  );
  const currentPage = pages.find((p) => p.id === page)!;
  const scenarioChanged = JSON.stringify(draft) !== JSON.stringify(applied);
  const detailPlant = plants.find((p) => p.id === detail?.plantId);
  const detailForecast = detailPlant
    ? forecast.byPlant.find((p) => p.plantId === detailPlant.id)
    : undefined;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0d171b" : "#f5f7f8");
  }, [theme]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      try {
        if (!localStorage.getItem("ewp-theme"))
          setTheme(media.matches ? "dark" : "light");
      } catch {}
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timeout);
  }, [message]);

  const changeTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem("ewp-theme", next);
    } catch {}
  };
  const navigate = (next: Page) => {
    setPage(next);
    setMobileOpen(false);
    setAlertsOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  async function calculate(scenario = draft, plantId = scope, days = horizon) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const target =
        plantId === "all" ? plants : plants.filter((p) => p.id === plantId);
      await new Promise((resolve) => setTimeout(resolve, 350));
      setScope(plantId);
      setHorizon(days);
      setApplied({ ...scenario });
      setDraft({ ...scenario });
      setMessage("운영 전망을 다시 계산했습니다.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "계산을 완료하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    const rows = [
      [
        "자료구분",
        "발전소",
        "현재재고(t)",
        "발전가능량(GWh)",
        "현재출력(MW)",
        "연료부족예상(KST)",
        "기준시각",
      ],
      ...forecast.byPlant.map((p) => [
        "샘플 시나리오",
        p.name,
        p.inventoryTons,
        p.availableEnergyGwh.toFixed(2),
        p.currentOutputMw.toFixed(1),
        p.firstShortageAt
          ? fmtDate(p.firstShortageAt, true)
          : `${horizon}일 내 없음`,
        BASE_TIME,
      ]),
    ];
    const text =
      "\uFEFF" +
      rows
        .map((r) =>
          r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "발전운영_전망_2026-10-06.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("현재 조건의 운영 전망 CSV를 내보냈습니다.");
  }
  const nav = (
    <>
      <div className="nav-section-label">발전 운영</div>
      {pages.slice(0, 3).map((p) => (
        <button
          key={p.id}
          onClick={() => navigate(p.id)}
          className={`nav-item ${page === p.id ? "active" : ""}`}
          aria-current={page === p.id ? "page" : undefined}
        >
          <p.icon size={18} />
          <span>{p.label}</span>
          {p.id === "schedule" && (
            <span className="nav-count">{outages.length}</span>
          )}
        </button>
      ))}
      <div className="nav-section-label nav-section-second">수급 관리</div>
      {pages.slice(3, 5).map((p) => (
        <button
          key={p.id}
          onClick={() => navigate(p.id)}
          className={`nav-item ${page === p.id ? "active" : ""}`}
          aria-current={page === p.id ? "page" : undefined}
        >
          <p.icon size={18} />
          <span>{p.label}</span>
        </button>
      ))}
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <div>
            <span className="online-dot" />
            오프라인 데모
          </div>
          <p>운영·정비계획 샘플 데이터</p>
          <span>기준 2026.10.06 09:00 KST</span>
        </div>
        <button
          className="nav-item help-nav"
          onClick={() => {
            setHelpOpen(true);
            setMobileOpen(false);
          }}
        >
          <CircleHelp size={17} />
          <span>데이터·계산 안내</span>
          <ArrowUpRight size={14} />
        </button>
      </div>
    </>
  );

  const plantTable = (
    <div className="table-scroll">
      <table className="operations-table">
        <thead>
          <tr>
            <th>발전본부</th>
            <th>현재 출력</th>
            <th>보유 재고</th>
            <th>발전가능량</th>
            <th>현재 부하 기준 재고일수</th>
            <th>연료부족 예상</th>
            <th>운영 상태</th>
          </tr>
        </thead>
        <tbody>
          {forecast.byPlant.map((p) => (
            <tr key={p.plantId}>
              <td>
                <button
                  className="plant-link"
                  onClick={() => setDetail({ plantId: p.plantId })}
                >
                  <span className="plant-icon">
                    <Factory size={17} />
                  </span>
                  {p.name}
                  <ChevronRight size={14} />
                </button>
              </td>
              <td>
                {n(p.currentOutputMw)}
                <small> MW</small>
              </td>
              <td>
                {n(p.inventoryTons / 10000, 1)}
                <small> 만t</small>
              </td>
              <td className="strong-cell">
                {n(p.availableEnergyGwh, 1)}
                <small> GWh</small>
              </td>
              <td>
                {p.coverageDays === null
                  ? "소비 없음"
                  : `${n(p.coverageDays, 1)}일`}
                <small className="cell-note">입항·향후 정비 제외</small>
              </td>
              <td>
                {p.firstShortageAt ? (
                  <>
                    <span className="warning-text">
                      {fmtDate(p.firstShortageAt)}
                    </span>
                    <small className="cell-note">
                      D+{daysUntil(p.firstShortageAt)}
                    </small>
                  </>
                ) : (
                  `${horizon}일 내 없음`
                )}
              </td>
              <td>
                <Status tone={p.firstShortageAt ? "warning" : "good"}>
                  {p.firstShortageAt ? "수급 확인" : "안정"}
                </Status>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const checkpoints = (
    <div className="checkpoint-list">
      {riskPlants.length > 0 ? (
        <button
          className="checkpoint warning-checkpoint"
          onClick={() => setDetail({ plantId: riskPlants[0].plantId })}
        >
          <span className="checkpoint-icon">
            <TriangleAlert size={18} />
          </span>
          <div>
            <div className="checkpoint-top">
              <strong>연료 확보 검토</strong>
              <span>예측</span>
            </div>
            <p>
              {riskPlants[0].name} · {fmtDate(riskPlants[0].firstShortageAt)}{" "}
              연료부족 예상
            </p>
            <small>입항 일정과 발전 부하를 함께 검토하세요.</small>
          </div>
          <ChevronRight size={16} />
        </button>
      ) : (
        <div className="checkpoint">
          <span className="checkpoint-icon good-icon">
            <Check size={18} />
          </span>
          <div>
            <strong>전망 기간 내 연료 수급 안정</strong>
            <p>현재 조건에서 연료부족이 예상되지 않습니다.</p>
          </div>
        </div>
      )}
      {nextOutage && (
        <button
          className="checkpoint"
          onClick={() =>
            setDetail({
              plantId: nextOutage.plant.id,
              unitId: nextOutage.unit.id,
            })
          }
        >
          <span className="checkpoint-icon">
            <Wrench size={18} />
          </span>
          <div>
            <div className="checkpoint-top">
              <strong>다가오는 계획정지</strong>
              <span>계획</span>
            </div>
            <p>
              {nextOutage.plant.name} {nextOutage.unit.name} ·{" "}
              {fmtDate(nextOutage.startAt)}
            </p>
            <small>
              {nextOutage.title} · {n(nextOutage.unit.capacityMw)} MW
            </small>
          </div>
          <ChevronRight size={16} />
        </button>
      )}
      <button className="checkpoint" onClick={() => navigate("vessels")}>
        <span className="checkpoint-icon">
          <Ship size={18} />
        </span>
        <div>
          <div className="checkpoint-top">
            <strong>입항·하역 일정 확인</strong>
            <span>수급</span>
          </div>
          <p>
            예정 물량{" "}
            {n(selectedShipments.reduce((a, s) => a + s.tons, 0) / 10000, 1)}만t
            · {selectedShipments.length}척
          </p>
          <small>하역 완료 후 사용 가능한 재고에 반영됩니다.</small>
        </div>
        <ChevronRight size={16} />
      </button>
    </div>
  );

  return (
    <TooltipProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          본문 바로가기
        </a>
        <header className="top-bar">
          <div className="top-brand">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <div className="brand-mark">
              G<span />
            </div>
            <div className="brand-name">GenForecast</div>
            <div className="top-divider" />
            <span className="top-breadcrumb">
              운영 워크스페이스 <ChevronRight size={13} /> {currentPage.label}
            </span>
          </div>
          <div className="top-actions">
            <span className="demo-label">
              <span />
              샘플 데이터
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"
              }
              title={theme === "light" ? "다크 모드" : "라이트 모드"}
              onClick={changeTheme}
            >
              {theme === "light" ? <Moon /> : <Sun />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="notification-button"
              aria-label="운영 알림 보기"
              onClick={() => setAlertsOpen(true)}
            >
              <Bell />
              <span />
            </Button>
            <div className="top-avatar" title="샘플 운영자">
              OP
            </div>
          </div>
        </header>
        <aside className="sidebar">
          <nav aria-label="주 메뉴">{nav}</nav>
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="mobile-sidebar">
            <SheetHeader>
              <SheetTitle>GenForecast</SheetTitle>
              <SheetDescription>운영 메뉴</SheetDescription>
            </SheetHeader>
            <nav aria-label="모바일 메뉴">{nav}</nav>
          </SheetContent>
        </Sheet>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <h1>{currentPage.label}</h1>
              <p>{currentPage.sub}</p>
            </div>
            <div className="heading-actions">
              <Button
                variant="outline"
                className="export-button"
                onClick={exportCsv}
                disabled={busy}
              >
                <ArrowDownToLine />
                CSV 내보내기
              </Button>
              <Button
                onClick={() => navigate("scenario")}
                className="scenario-shortcut"
              >
                <Settings2 />
                시나리오 분석
              </Button>
            </div>
          </div>
          <div className="context-bar">
            <div className="context-left">
              <span className="context-caption">조회 범위</span>
              <Select
                value={scope}
                onValueChange={(v) => calculate(applied, v, horizon)}
                disabled={busy}
              >
                <SelectTrigger
                  className="plant-select"
                  aria-label="발전본부 선택"
                >
                  <Factory size={15} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 발전본부</SelectItem>
                  {plants.map((p) => (
                    <SelectItem value={p.id} key={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div
                className="horizon-control"
                role="group"
                aria-label="전망 기간"
              >
                {[30, 60, 90].map((d) => (
                  <button
                    disabled={busy}
                    key={d}
                    aria-pressed={horizon === d}
                    className={horizon === d ? "selected" : ""}
                    onClick={() => calculate(applied, scope, d)}
                  >
                    {d}일
                  </button>
                ))}
              </div>
            </div>
            <div className="context-right">
              {!scenarioIsDefault(applied) && (
                <Badge variant="outline" className="scenario-applied">
                  사용자 시나리오 적용
                </Badge>
              )}
              <Clock3 size={13} />
              <span>
                2026.10.06 09:00 <b>KST</b>
              </span>
            </div>
          </div>
          {busy && (
            <div className="processing-strip">
              <ProcessingOrb
                theme={theme}
                state="solving"
                label="발전·연료 전망을 계산하고 있습니다"
              />
              <span className="processing-hint">
                계획정지와 하역 일정을 반영 중
              </span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              {error}
              <Button variant="outline" size="sm" onClick={() => calculate()}>
                다시 계산
              </Button>
            </div>
          )}
          {page === "overview" && (
            <PlantOverview
              summary={tower}
              plants={selectedPlants}
              models={models}
              theme={theme}
              onSchedule={() => navigate("schedule")}
              onScenario={() => navigate("scenario")}
              onPlant={(plantId) => setDetail({ plantId })}
            />
          )}

          {page === "schedule" && (
            <>
              <div className="section-intro">
                <div className="intro-icon">
                  <CalendarClock />
                </div>
                <div>
                  <strong>계획된 정지와 예측된 수급 위험을 분리합니다.</strong>
                  <p>
                    아래 일정은 입력된 정비계획입니다. 연료 부족 예측은 운전
                    정지 명령이나 확정 일정이 아닙니다.
                  </p>
                </div>
                <Badge variant="outline">샘플 계획</Badge>
              </div>
              <Panel
                title="호기별 운영 타임라인"
                description="오늘부터 14일 · 호기를 선택하면 상세 정보를 확인할 수 있습니다."
              >
                <OutageTimeline
                  plants={selectedPlants}
                  days={14}
                  onSelect={(plantId, unitId) => setDetail({ plantId, unitId })}
                />
              </Panel>
              <Panel
                title="계획정지 일정"
                description="정비 시작부터 복귀 예정 시각까지 KST 기준"
                action={
                  <div className="segmented">
                    {[
                      ["all", "전체"],
                      ["upcoming", "정지 예정"],
                      ["active", "정비 중"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={scheduleFilter === id ? "selected" : ""}
                        aria-pressed={scheduleFilter === id}
                        onClick={() => setScheduleFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              >
                <div className="schedule-list">
                  {outages
                    .filter(
                      (o) =>
                        scheduleFilter === "all" ||
                        (scheduleFilter === "active"
                          ? new Date(o.startAt).getTime() <= baseMs
                          : new Date(o.startAt).getTime() > baseMs),
                    )
                    .map((o) => (
                      <button
                        className="schedule-row"
                        key={`${o.plant.id}-${o.id}`}
                        onClick={() =>
                          setDetail({ plantId: o.plant.id, unitId: o.unit.id })
                        }
                      >
                        <div className="calendar-date">
                          <span>
                            {new Date(o.startAt).toLocaleDateString("ko-KR", {
                              timeZone: "Asia/Seoul",
                              month: "long",
                            })}
                          </span>
                          <strong>
                            {new Date(o.startAt)
                              .toLocaleDateString("ko-KR", {
                                timeZone: "Asia/Seoul",
                                day: "numeric",
                              })
                              .replace("일", "")}
                          </strong>
                        </div>
                        <div className="schedule-info">
                          <strong>
                            {o.plant.name} {o.unit.name}
                            <Status
                              tone={
                                new Date(o.startAt).getTime() <= baseMs
                                  ? "warning"
                                  : "neutral"
                              }
                            >
                              {new Date(o.startAt).getTime() <= baseMs
                                ? "정비 중"
                                : "정지 예정"}
                            </Status>
                          </strong>
                          <p>
                            {o.title} · {o.reason}
                          </p>
                          <span>
                            {fmtDate(o.startAt, true)} →{" "}
                            {fmtDate(o.endAt, true)} KST
                          </span>
                        </div>
                        <div className="schedule-capacity">
                          {n(o.unit.capacityMw)}
                          <small>MW 설비</small>
                        </div>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                  {outages.filter(
                    (o) =>
                      scheduleFilter === "all" ||
                      (scheduleFilter === "active"
                        ? new Date(o.startAt).getTime() <= baseMs
                        : new Date(o.startAt).getTime() > baseMs),
                  ).length === 0 && (
                    <div className="empty-state">
                      <Check />
                      해당 조건의 계획정지가 없습니다.
                    </div>
                  )}
                </div>
              </Panel>
              <Panel
                title="연료 부족에 따른 운영 영향"
                description={`${horizon}일 시뮬레이션 결과 · 계획정지와 별도로 검토할 예측입니다.`}
              >
                {plantTable}
              </Panel>
            </>
          )}
          {page === "fuel" && (
            <Stockyard plants={selectedPlants} theme={theme} />
          )}

          {page === "vessels" && (
            <VesselTracking
              plants={selectedPlants}
              theme={theme}
              scenario={applied}
              selectedId={selectedVesselId}
              onSelect={setSelectedVesselId}
              onPlant={(plantId) => setDetail({ plantId })}
            />
          )}
          {page === "models" && (
            <ModelsPage models={models} onModels={setModels} theme={theme} />
          )}
          {page === "data" && <DataPage plants={selectedPlants} />}

          {page === "scenario" && (
            <>
              <div className="scenario-layout">
                <Panel
                  title="운영 조건 설정"
                  description="가정을 조정한 뒤 분석을 실행하세요."
                  className="scenario-controls"
                >
                  <div className="scenario-presets">
                    <button
                      disabled={busy}
                      onClick={() => setDraft({ ...scenarioDefaults })}
                    >
                      <RotateCcw size={14} />
                      기준 조건
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          loadChangePct: 15,
                          arrivalDelayDays: 3,
                          includeInbound: true,
                        })
                      }
                    >
                      <TriangleAlert size={14} />
                      수급 지연
                    </button>
                  </div>
                  <div className="scenario-field">
                    <div>
                      <label id="load-label">발전 부하 변화</label>
                      <strong>
                        {draft.loadChangePct > 0 ? "+" : ""}
                        {draft.loadChangePct}%
                      </strong>
                    </div>
                    <Slider
                      aria-labelledby="load-label"
                      value={[draft.loadChangePct]}
                      onValueChange={(v) =>
                        setDraft((d) => ({ ...d, loadChangePct: v[0] }))
                      }
                      min={-30}
                      max={30}
                      step={5}
                      disabled={busy}
                    />
                    <div className="slider-labels">
                      <span>−30%</span>
                      <span>기준 부하</span>
                      <span>+30%</span>
                    </div>
                    <p>호기별 부하에 적용하며 설비용량을 넘지 않습니다.</p>
                  </div>
                  <div className="scenario-field">
                    <div>
                      <label id="delay-label">입항·하역 지연</label>
                      <strong>+{draft.arrivalDelayDays}일</strong>
                    </div>
                    <Slider
                      aria-labelledby="delay-label"
                      value={[draft.arrivalDelayDays]}
                      onValueChange={(v) =>
                        setDraft((d) => ({ ...d, arrivalDelayDays: v[0] }))
                      }
                      min={0}
                      max={10}
                      step={1}
                      disabled={busy}
                    />
                    <div className="slider-labels">
                      <span>지연 없음</span>
                      <span>+10일</span>
                    </div>
                    <p>입항 및 하역 완료 일정을 함께 이동합니다.</p>
                  </div>
                  <label className="inbound-toggle">
                    <span>
                      <strong>입항 예정 연료 포함</strong>
                      <small>하역 완료 이후 재고에 반영</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft.includeInbound}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          includeInbound: e.target.checked,
                        }))
                      }
                      disabled={busy}
                    />
                  </label>
                  <Button
                    className="run-scenario"
                    onClick={() => calculate()}
                    disabled={busy}
                  >
                    {busy ? (
                      <ProcessingOrb
                        theme={theme}
                        state="solving"
                        label="계산 중"
                      />
                    ) : (
                      <>
                        <Play size={16} />
                        시나리오 분석 실행
                      </>
                    )}
                  </Button>
                  <div className="scenario-save-state" role="status">
                    {scenarioChanged
                      ? "변경한 조건은 아직 결과에 반영되지 않았습니다."
                      : "현재 결과에 적용된 조건입니다."}
                  </div>
                  <p className="scenario-disclaimer">
                    계획정지 일정은 고정합니다. 결과는 운영 검토용 예측이며 정지
                    계획을 자동으로 변경하지 않습니다.
                  </p>
                </Panel>
                <div className="scenario-results">
                  <div className="result-heading">
                    <div>
                      <h2>기준안과 비교</h2>
                    </div>
                    <Badge variant="outline">
                      {scope === "all" ? "전체 본부" : selectedPlants[0].name} ·{" "}
                      {horizon}일
                    </Badge>
                  </div>
                  <div className="comparison-cards">
                    <Card className="comparison-card">
                      <span>전망 기간 발전량</span>
                      <strong>
                        {n(
                          forecast.daily.reduce(
                            (s, d) => s + d.productionGwh,
                            0,
                          ),
                          1,
                        )}
                        <small> GWh</small>
                      </strong>
                      <p>
                        기준안 대비{" "}
                        <b>
                          {n(
                            forecast.daily.reduce(
                              (s, d) => s + d.productionGwh,
                              0,
                            ) -
                              baseline.daily.reduce(
                                (s, d) => s + d.productionGwh,
                                0,
                              ),
                            1,
                          )}{" "}
                          GWh
                        </b>
                      </p>
                    </Card>
                    <Card className="comparison-card">
                      <span>최초 연료부족 예상</span>
                      <strong>
                        {forecast.firstShortageAt
                          ? fmtDate(forecast.firstShortageAt)
                          : "기간 내 없음"}
                      </strong>
                      <p>
                        기준안 <b>{fmtDate(baseline.firstShortageAt)}</b>
                      </p>
                    </Card>
                  </div>
                  <Panel
                    title="재고 변화 비교"
                    description="점선은 기준안, 실선은 적용한 시나리오입니다."
                  >
                    <InventoryChart
                      forecast={forecast}
                      comparison={baseline}
                      safetyStockTons={safetyStock}
                    />
                    <div className="applied-conditions">
                      <span>
                        적용 부하 {applied.loadChangePct > 0 ? "+" : ""}
                        {applied.loadChangePct}%
                      </span>
                      <span>지연 +{applied.arrivalDelayDays}일</span>
                      <span>
                        입항 {applied.includeInbound ? "포함" : "제외"}
                      </span>
                    </div>
                  </Panel>
                </div>
              </div>
              <Panel
                title="시나리오별 발전본부 영향"
                description="예측된 연료부족을 실제 정지계획과 비교해 운영 대응을 검토하세요."
              >
                {plantTable}
              </Panel>
            </>
          )}
          <footer className="page-footer">
            <span>
              <Layers3 size={13} />
              샘플 데이터 기반 운영 시뮬레이션
            </span>
            <span>
              기준시각 고정 · 실제 운전 및 정지계획과 다를 수 있습니다.
            </span>
            <button onClick={() => setHelpOpen(true)}>
              산정 기준
              <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
        <Dialog
          open={!!detail}
          onOpenChange={(open) => !open && setDetail(null)}
        >
          <DialogContent className="detail-dialog">
            <DialogHeader>
              <DialogTitle>{detailPlant?.name} 운영 상세</DialogTitle>
              <DialogDescription>
                기준 2026.10.06 09:00 KST · 샘플 운영 및 정비계획
              </DialogDescription>
            </DialogHeader>
            {detailPlant && (
              <>
                <div className="detail-metrics">
                  <div>
                    <span>보유 연료</span>
                    <b>
                      {n(detailPlant.inventoryTons / 10000, 1)}
                      <small> 만t</small>
                    </b>
                  </div>
                  <div>
                    <span>발전가능량</span>
                    <b>
                      {n(
                        detailForecast?.availableEnergyGwh ??
                          towerSummary([detailPlant], applied, horizon, models)
                            .forecast.availableEnergyGwh,
                        1,
                      )}
                      <small> GWh</small>
                    </b>
                  </div>
                  <div>
                    <span>연료부족 예측</span>
                    <b className="detail-date">
                      {fmtDate(
                        detailForecast?.firstShortageAt ??
                          towerSummary([detailPlant], applied, horizon, models)
                            .forecast.firstShortageAt,
                      )}
                    </b>
                  </div>
                </div>
                <h3 className="dialog-section-title">호기별 운전·정지계획</h3>
                <div className="detail-unit-list">
                  {detailPlant.units.map((unit) => (
                    <div
                      key={unit.id}
                      className={`detail-unit ${detail?.unitId === unit.id ? "focused-unit" : ""}`}
                    >
                      <div className="detail-unit-heading">
                        <strong>
                          {unit.name}
                          <span>{n(unit.capacityMw)} MW</span>
                        </strong>
                        <Status
                          tone={
                            isStopped(unit)
                              ? "warning"
                              : unit.loadPct
                                ? "good"
                                : "neutral"
                          }
                        >
                          {isStopped(unit)
                            ? "계획정비 중"
                            : unit.loadPct
                              ? "운전 중"
                              : "대기"}
                        </Status>
                      </div>
                      <p>
                        기준 부하율 {unit.loadPct}% · 시나리오 부하율{" "}
                        {n(
                          Math.min(
                            100,
                            unit.loadPct * (1 + applied.loadChangePct / 100),
                          ),
                          1,
                        )}
                        %
                      </p>
                      {unit.outages
                        .filter((o) => new Date(o.endAt).getTime() > baseMs)
                        .map((o) => (
                          <div className="outage-detail" key={o.id}>
                            <Wrench size={14} />
                            <div>
                              <b>{o.title}</b>
                              <span>
                                {fmtDate(o.startAt, true)} ~{" "}
                                {fmtDate(o.endAt, true)}
                              </span>
                              <small>{o.reason} · 입력된 샘플 계획</small>
                            </div>
                          </div>
                        ))}
                      {!unit.outages.some(
                        (o) => new Date(o.endAt).getTime() > baseMs,
                      ) && (
                        <small className="subtle-label">
                          등록된 향후 계획정지 없음
                        </small>
                      )}
                    </div>
                  ))}
                </div>
                <div className="detail-footnote">
                  <CircleHelp size={15} />
                  발전가능량은 보유 연료·평균 발열량·효율로 계산합니다. 연료
                  부족 예측과 계획정지는 서로 독립된 정보입니다.
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={alertsOpen} onOpenChange={setAlertsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>운영 알림</DialogTitle>
              <DialogDescription>
                현재 전망 조건에서 검토할 항목 · 샘플
              </DialogDescription>
            </DialogHeader>
            {checkpoints}
          </DialogContent>
        </Dialog>
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="help-dialog">
            <DialogHeader>
              <DialogTitle>데이터와 계산 기준</DialogTitle>
              <DialogDescription>
                모든 시간은 KST, 기준시각은 2026.10.06 09:00입니다.
              </DialogDescription>
            </DialogHeader>
            <div className="help-copy">
              <h3>운영·정비계획은 샘플입니다</h3>
              <p>
                실제 발전사 자료와 연동하지 않았습니다. 발전소·호기·입항량·정지
                일정은 기능 검증을 위한 예시이며 실제 운영 현황을 의미하지
                않습니다.
              </p>
              <h3>발전 가능량과 현재 출력을 구분합니다</h3>
              <p>
                GWh는 연료로 생산할 수 있는 전력량, MW는 현재 가동 출력입니다.
                발전가능량 = 재고(t) × 발열량(kcal/kg) × 0.001163 × 효율 ÷
                1,000.
              </p>
              <h3>재고는 시간별로 계산합니다</h3>
              <p>
                하역 완료 이후 도착 본부에 연료를 더하고, 계획정지 중에는 해당
                호기의 소비를 제외합니다. 부족하면 가용 연료만큼 발전하며 재고는
                음수가 되지 않습니다. 시간 단위 추정이므로 정지 시각은 운영
                확정값이 아닙니다.
              </p>
              <h3>재고일수와 연료부족 예상일</h3>
              <p>
                종합 화면의 현재 재고일수는 재고 ÷ 첫날 예상 사용량입니다. 미래
                재고일수는 해당 일 기말 재고 ÷ 이후 7일 평균 계획 사용량입니다.
                30일 이상 안정, 20일 이상 주의, 20일 미만 위험으로 표시합니다.
                연료부족 예상일은 입하·정비·모델 전망과 부하 시나리오를
                반영합니다.
              </p>
              <h3>참고 안전재고선</h3>
              <p>
                현재 소비량에 본부별 참고 재고일수를 곱한 합계입니다. 전체
                합계가 충분해도 개별 본부에서 부족이 발생할 수 있습니다.
              </p>
            </div>
          </DialogContent>
        </Dialog>
        {message && (
          <div className="toast" role="status">
            <Check size={16} />
            {message}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
export default App;
