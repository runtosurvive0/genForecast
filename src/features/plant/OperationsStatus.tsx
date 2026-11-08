import { useEffect, useState } from "react";
import { Anchor, ArrowRight, Ship, Timer } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../components/ui/chart";
import { Button } from "../../components/ui/button";
import { authJson } from "../../lib/auth-client";
import type { FuelDemoCatalog, FuelDemoSnapshot, FuelDemoStatus } from "../../domain/fuel-demo/types";
import type { PlanningRun } from "../../domain/planning";
import type { BerthFeed } from "../../domain/use-berth-feed";
import type { BerthRegistry } from "../../domain/berth-ais";
import { fetchWaiting } from "../../domain/waiting-api";
import type { WaitingFeed } from "../../domain/waiting-candidates";
import { arrivals, kstClock, kstDay, kstHour, loadTodayDemand, runCovering, unitOutputs, yardStock, type TodayDemand } from "../../domain/operations-status";
import "./operations-status.css";

const n = (value: number | null | undefined, digits = 0) => value == null ? "미확정" : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const tone = (unit: number) => (unit <= 4 ? 1 : unit <= 8 ? 2 : 3);
const STATUS: Record<string, string> = { running: "운전", stopped: "정지", fault: "고장", unknown: "미확인" };
const VOYAGE: Record<string, string> = { planned: "예정", underway: "항해" };
const LIST_MAX = 4;
const DEMAND_CONFIG: ChartConfig = { net: { label: "순수요", color: "var(--gf-os-c1)" } };
const when = (iso: string | null) => iso ? iso.slice(5, 16).replace("-", ".").replace("T", " ") : "ETA 미입력";

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

function usePolling<T>(load: (signal: AbortSignal) => Promise<T>, everyMs: number): Load<T> {
  const [value, setValue] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try { const data = await load(abort.signal); if (!abort.signal.aborted) setValue({ state: "ready", data }); }
      catch (error) { if (!abort.signal.aborted) setValue({ state: "error", message: error instanceof Error ? error.message : "조회 실패" }); }
      finally { if (!abort.signal.aborted) timer = setTimeout(run, everyMs); }
    };
    void run();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [load, everyMs]);
  return value;
}

const loadWaiting = (signal: AbortSignal) => fetchWaiting(signal);
const loadRegistry = async (signal: AbortSignal) => {
  const registry = await authJson<BerthRegistry>("/api/voyage-registry/records", { signal });
  if (![registry?.ships, registry?.voyages, registry?.cargo].every(Array.isArray)) throw new Error("항차 원장 형식이 맞지 않습니다.");
  return registry;
};

function Panel({ title, note, className = "", children }: { title: string; note?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={`gf-os-panel ${className}`} aria-label={title}>
    <header><h2>{title}</h2>{note && <span>{note}</span>}</header>
    {children}
  </section>;
}

function Empty({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return <p className="gf-os-empty" role={alert ? "alert" : undefined}>{children}</p>;
}

export function OperationsStatus({ demo, runs, runsLoading, runsError, berthFeed, onNavigate }: {
  demo: { status: FuelDemoStatus; snapshot: FuelDemoSnapshot | null; catalog: FuelDemoCatalog | null; receivedAt: number | null };
  runs: PlanningRun[];
  runsLoading: boolean;
  runsError: string | null;
  berthFeed: BerthFeed;
  onNavigate: (page: string) => void;
}) {
  const live = demo.status !== "disabled" && demo.snapshot ? demo.snapshot : null;
  const now = new Date();
  const day = kstDay(now);
  const hour = kstHour(now);
  const run = runCovering(runs, day);
  const [demand, setDemand] = useState<Load<TodayDemand> | null>(null);
  useEffect(() => {
    if (!run) { setDemand(null); return; }
    const abort = new AbortController();
    setDemand({ state: "loading" });
    loadTodayDemand(run.id, day, abort.signal)
      .then((data) => !abort.signal.aborted && setDemand({ state: "ready", data }))
      .catch((error) => !abort.signal.aborted && setDemand({ state: "error", message: error instanceof Error ? error.message : "조회 실패" }));
    return () => abort.abort();
  }, [run?.id, day]);
  const waiting = usePolling<WaitingFeed>(loadWaiting, 60000);
  const registry = usePolling<BerthRegistry>(loadRegistry, 60000);

  const units = live ? unitOutputs(live, demo.catalog) : null;
  const stock = live ? yardStock(live) : null;
  const yardMax = stock ? Math.max(1, ...stock.yards.map((y) => y.high + y.low)) : 1;
  const received = demo.receivedAt ? new Date(demo.receivedAt + 9 * 3600_000).toISOString().slice(11, 19) : null;

  const demandRows = demand?.state === "ready" ? demand.data.net.map((value, h) => ({ hour: `${h}시`, net: value })) : [];
  const peak = demand?.state === "ready" ? demand.data.net.reduce((best, value, h) => (value > best.value ? { value, h } : best), { value: -Infinity, h: 0 }) : null;
  const low = demand?.state === "ready" ? Math.min(...demand.data.net) : null;

  const berthed = live
    ? Object.entries(live.material.ships).map(([berth, ship]) => ({ key: `demo-${berth}`, name: ship.name, detail: `${berth}부두 · 잔량 ${n(ship.remaining)} t / ${n(ship.total)} t` }))
    : berthFeed.rows.map((row) => ({ key: row.vessel.mmsi || row.vessel.id, name: row.vessel.name, detail: `${row.berth ? `${row.berth}부두` : "부두 미확인"}${row.estimated ? " 추정" : ""} · AIS ${kstClock(row.observedAt)} KST` }));
  const berthNote = live ? "운전 정보 하역선" : berthFeed.status === "error" ? null : "AIS 부두 판정";
  const arrivalRows = registry.state === "ready" ? arrivals(registry.data) : [];

  return (
    <div className="gf-os-page">
      <Panel title="발전소 출력" className="gf-os-units" note={units ? <>합계 <b>{n(units.totalMW)}</b> MW · 운전 {units.running}기{received && ` · 수신 ${received}`}</> : "당진 1~10호기 현재 출력"}>
        {units ? <div className="gf-os-unit-grid">{units.rows.map((row) => {
          const ratio = row.mw != null && row.maxMW ? Math.min(100, Math.max(0, (row.mw / row.maxMW) * 100)) : 0;
          return <div key={row.unit} className="gf-os-unit" data-tone={tone(row.unit)} data-status={row.status}>
            <span className="gf-os-unit-track" aria-hidden="true"><i style={{ height: `${ratio}%` }} /></span>
            <span className="gf-os-unit-name">{row.unit}호기</span>
            <strong>{n(row.mw)}{row.mw != null && <small> MW</small>}</strong>
            <small>{row.status === "running" ? `정격 ${n(row.maxMW)} · ${n(ratio)}%` : STATUS[row.status]}</small>
          </div>;
        })}</div> : <Empty>운전 정보 미연계 · 현재 출력은 계획값으로 채우지 않습니다. <button type="button" className="gf-os-link" onClick={() => onNavigate("data")}>운전 데모 연결 <ArrowRight size={13} /></button></Empty>}
      </Panel>

      <Panel title="금일 수요전망" className="gf-os-demand" note={run ? `${day} · '${run.name}' 순수요(수요−태양광) 예측` : day}>
        {runsError ? <Empty alert>{runsError}</Empty>
          : runsLoading ? <Empty>저장 계획을 확인하는 중</Empty>
          : !run ? <Empty>오늘을 포함한 저장 계획이 없습니다. 통합 시뮬레이션에서 계산을 실행하세요.</Empty>
          : !demand || demand.state === "loading" ? <Empty>오늘 순수요를 불러오는 중</Empty>
          : demand.state === "error" ? <Empty alert>{demand.message}</Empty>
          : <>
            <div className="gf-os-demand-stats">
              <div><span>현재 {hour}시</span><strong>{n(demand.data.net[hour])}<small> MW</small></strong></div>
              <div><span>최대 · {peak!.h}시</span><strong>{n(peak!.value)}<small> MW</small></strong></div>
              <div><span>최소</span><strong>{n(low)}<small> MW</small></strong></div>
            </div>
            <ChartContainer config={DEMAND_CONFIG} className="gf-os-chart" aria-label="금일 시간대별 순수요 예측 MW">
              <AreaChart data={demandRows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs><linearGradient id="gf-os-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-net)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--color-net)" stopOpacity={0.04} /></linearGradient></defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={6} interval={2} />
                <YAxis tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${n(v / 1000)}k`} />
                <ReferenceLine x={`${hour}시`} className="gf-os-now" strokeDasharray="4 4" label={{ value: "현재", position: "insideTopRight", className: "gf-os-now-label" }} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" formatter={(v) => <span className="gf-os-tip"><span>순수요</span><b>{n(Number(v))} MW</b></span>} />} />
                <Area dataKey="net" type="monotone" stroke="var(--color-net)" strokeWidth={2.25} fill="url(#gf-os-fill)" isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          </>}
      </Panel>

      <Panel title="저탄 현황" className="gf-os-yardstock" note={stock ? <>합계 <b>{n(stock.total)}</b> t</> : "저탄장별 고·저열량탄"}>
        {stock ? <>
          <div className="gf-os-grade">
            <div data-grade="high"><i /><span>고열량탄</span><strong>{n(stock.high)} t</strong><small>{n(stock.total ? (stock.high / stock.total) * 100 : null)}%</small></div>
            <div data-grade="low"><i /><span>저열량탄</span><strong>{n(stock.low)} t</strong><small>{n(stock.total ? (stock.low / stock.total) * 100 : null)}%</small></div>
          </div>
          <div className="gf-os-yards">{stock.yards.map((y) => <div key={y.yard} className="gf-os-yard">
            <span>{y.yard}저탄장</span>
            <span className="gf-os-yard-bar" aria-hidden="true" style={{ width: `${((y.high + y.low) / yardMax) * 100}%` }}>
              <i data-grade="high" style={{ flexGrow: y.high }} /><i data-grade="low" style={{ flexGrow: y.low }} />
            </span>
            <strong>{n(y.high + y.low)} t</strong>
            <small>고 {n(y.high)} · 저 {n(y.low)}</small>
          </div>)}</div>
          <button type="button" className="gf-os-link" onClick={() => onNavigate("yard")}>저탄장 배치 보기 <ArrowRight size={13} /></button>
        </> : <Empty>운전 정보 미연계 · 저탄 재고는 운전 정보가 연결되면 표시합니다. <button type="button" className="gf-os-link" onClick={() => onNavigate("fuel-ledger")}>기준재고 원장 보기 <ArrowRight size={13} /></button></Empty>}
      </Panel>

      <Panel title="선박 현황" className="gf-os-ships" note="당진 부두 기준">
        <div className="gf-os-ship-cols">
          <section aria-label="접안 중" className="gf-os-ship-col">
            <h3><Anchor size={15} aria-hidden="true" />접안 중 <b>{berthed.length}</b>{berthNote && <small>{berthNote}</small>}</h3>
            {!live && berthFeed.status === "error" ? <Empty>AIS 부두 조회 실패</Empty>
              : !live && berthFeed.status === "loading" ? <Empty>AIS 확인 중</Empty>
              : berthed.length ? <ul>{berthed.slice(0, LIST_MAX).map((row) => <li key={row.key}><strong>{row.name}</strong><span>{row.detail}</span></li>)}</ul>
              : <Empty>접안한 배 없음</Empty>}
            {berthed.length > LIST_MAX && <p className="gf-os-more">외 {berthed.length - LIST_MAX}척</p>}
            <button type="button" className="gf-os-link" onClick={() => onNavigate("berth")}>접안·하역 보기 <ArrowRight size={13} /></button>
          </section>
          <section aria-label="체선 대기" className="gf-os-ship-col">
            <h3><Timer size={15} aria-hidden="true" />체선 대기 <b>{waiting.state === "ready" ? waiting.data.candidates.length : "–"}</b><small>AIS 대기 후보</small></h3>
            {waiting.state === "loading" ? <Empty>AIS 확인 중</Empty>
              : waiting.state === "error" ? <Empty>{waiting.message}</Empty>
              : waiting.data.candidates.length ? <ul>{waiting.data.candidates.slice(0, LIST_MAX).map((c) => <li key={c.mmsi}><strong>{c.name}{waiting.data.confirmed[c.mmsi] && <em>확인됨</em>}</strong><span>{Math.round(c.dwellHours)}시간 대기 · 부두에서 {c.distanceKm.toFixed(1)}km{c.stale ? " · 관측 지연" : ""}</span></li>)}</ul>
              : <Empty>대기 후보 없음</Empty>}
            {waiting.state === "ready" && waiting.data.candidates.length > LIST_MAX && <p className="gf-os-more">외 {waiting.data.candidates.length - LIST_MAX}척</p>}
            <button type="button" className="gf-os-link" onClick={() => onNavigate("voyages")}>확인할 배 보기 <ArrowRight size={13} /></button>
          </section>
          <section aria-label="입항 예정" className="gf-os-ship-col">
            <h3><Ship size={15} aria-hidden="true" />입항 예정 <b>{registry.state === "ready" ? arrivalRows.length : "–"}</b><small>항차 원장</small></h3>
            {registry.state === "loading" ? <Empty>항차 원장 확인 중</Empty>
              : registry.state === "error" ? <Empty>{registry.message}</Empty>
              : arrivalRows.length ? <ul>{arrivalRows.slice(0, LIST_MAX).map((row) => <li key={row.voyage}><strong>{row.ship}</strong><span>{VOYAGE[row.status] ?? row.status} · ETA {when(row.eta)}{row.berth ? ` · ${row.berth.replace("BD-", "")}부두` : ""}</span></li>)}</ul>
              : <Empty>예정 항차 없음</Empty>}
            {arrivalRows.length > LIST_MAX && <p className="gf-os-more">외 {arrivalRows.length - LIST_MAX}척</p>}
            <button type="button" className="gf-os-link" onClick={() => onNavigate("voyages")}>항차·화물 보기 <ArrowRight size={13} /></button>
          </section>
        </div>
      </Panel>

      <div className="gf-os-next">
        <Button variant="outline" onClick={() => onNavigate("simulation")}>재고 전망·구매 검토는 통합 시뮬레이션에서 <ArrowRight size={15} /></Button>
      </div>
    </div>
  );
}
