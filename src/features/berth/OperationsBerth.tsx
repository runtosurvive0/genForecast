import { docks, matchCargo } from "@/domain/berth-ais";
import type { BerthFeed } from "@/domain/use-berth-feed";
import { useEffect, useMemo, useState } from "react";
import { StackingOptions } from "@/components/stacking/StackingOptions";
import { stackingFocusValue, type StackingResult } from "@/domain/stacking";
import { fetchStacking } from "@/domain/stacking-api";
import {
  ArrowRight,
  Clock3,
  Anchor,
  Ship,
  Radio,
  Info,
  Layers3,
} from "lucide-react";
import { FuelScene } from "@/components/fuel-scene/FuelScene";
import { BerthNetwork } from "@/data/fuel-reference/berth-network.js";
import {
  referenceLots as drawingLots,
  referenceYards,
  referenceEquipment,
  canReceive,
  endpointForLot,
} from "@/domain/fuel-reference";
import "./operations-berth.css";
import { useYardBaseline } from '@/domain/use-yard-baseline';
import { yardBaselineLots } from '@/domain/yard-baseline-lots.js';
import { estimateUnload } from '@/domain/berth-unload-forecast';
import { demoFleet, kstParts } from "@/data/demo-fleet";

export interface OperationsBerthProps {
  feed: BerthFeed;
  theme: "light" | "dark";
  snapshot: unknown | null;
  status: string;
  onOpenYard: (lotId?: string) => void;
  onOpenStacking?: (value: string) => void;
  onNavigate: (page: string) => void;
}
type BerthId = 1 | 2 | 3;
const number = (value: number | null) =>
  value === null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
// 시연 모의 선박: 선박 지도·관심 선박과 같은 목록(src/data/demo-fleet.ts). 실제 AIS·DB 원장과 별개.
const voyageExamples = demoFleet().map((voyage) => ({ ...voyage, ...kstParts(voyage.arrivalAt) }));
// 접안 일정 머리글: 첫 접안일부터 7일(KST)
const calendarDays = Array.from({ length: 7 }, (_, i) =>
  kstParts(new Date(Date.parse(voyageExamples[0].arrivalAt) + i * 86_400_000).toISOString()).date,
);
const nextArrival = voyageExamples.find((voyage) => voyage.state !== "arrived");
const upcomingTons = voyageExamples
  .filter((voyage) => voyage.state !== "arrived")
  .reduce((total, voyage) => total + voyage.tons, 0);
const stepNames = [
  "하역기",
  "부두 컨베이어",
  "이송 타워",
  "반입 컨베이어",
  "저탄장 분기",
];
const endpoints = [
  ...new Map(
    drawingLots.map((lot) => [
      endpointForLot(lot),
      {
        id: endpointForLot(lot),
        yard: lot.yard,
        label:
          lot.pile === null
            ? `${lot.shed ?? lot.id[0].toUpperCase()} Shed`
            : `Pile ${lot.pile}`,
        lotId: lot.id,
      },
    ]),
  ).values(),
];

/** Destination choices inspect reachability without allocating cargo. */
/** 원장과 연결된 하역 대기 항차의 적치 추천 1순위 한 줄. 실패하면 이유만 보인다. */
function BerthStackingHint({ voyageNo, onOpenStacking }: { voyageNo: string; onOpenStacking?: (value: string) => void }) {
  const [result, setResult] = useState<StackingResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    fetchStacking({ voyage_no: voyageNo }, controller.signal)
      .then(setResult)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "알 수 없는 오류"); });
    return () => controller.abort();
  }, [voyageNo]);
  if (error) return <p className="gf-ob-stack-hint">적치 추천을 불러오지 못했습니다: {error}</p>;
  if (!result) return <p className="gf-ob-stack-hint" role="status">적치 추천 계산 중</p>;
  return (
    <div className="gf-ob-stack-hint">
      <StackingOptions compact result={result} onOpenYard={onOpenStacking ? p => onOpenStacking(stackingFocusValue(p)) : undefined} />
    </div>
  );
}

export function OperationsBerth({
  feed,
  theme,
  snapshot,
  status,
  onOpenYard,
  onOpenStacking,
  onNavigate,
}: OperationsBerthProps) {
  const baseline = useYardBaseline();
  const referenceLots = useMemo(() => yardBaselineLots(baseline.data?.lots ?? [], true), [baseline.data]);
  const baselineStock = useMemo(() => Object.fromEntries((baseline.data?.lots ?? []).filter(row => row.source_id).map(row => [row.source_id!, row.tonnes])), [baseline.data]);
  const baselineDetails = useMemo(() => Object.fromEntries((baseline.data?.lots ?? []).filter(row => row.source_id).map(row => [row.source_id!, {coal:row.coal_name,voyage:row.voyage_number ?? '',days:row.age_days ?? null}])), [baseline.data]);
  const [chosenBerth, setBerth] = useState<BerthId | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [berthView, setBerthView] = useState<"route" | "site">("route");
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState(3);
  const demo = status !== "disabled";
  const detected = feed.rows.filter((row) => row.estimated);
  const occupied = docks.filter((id) =>
    detected.some((row) => row.berth === id),
  );
  const berth = chosenBerth ?? (demo ? 1 : (occupied[0] ?? 1));
  const atDock = (id: number) => feed.rows.filter((row) => row.berth === id);
  const lastObservation = (row: (typeof feed.rows)[number]) =>
    row.vessel.ais?.position?.sogKn != null ? "마지막 저속 관측" : "마지막 위치";
  const detectionLabel = (id: number) =>
    feed.status === "error"
      ? "AIS 조회 불가"
      : feed.status === "loading"
        ? "AIS 조회 중"
        : occupied.some((d) => d === id)
          ? "접안 추정"
          : atDock(id).some((row) => row.stale)
            ? atDock(id).some((row) => row.stale && row.vessel.ais?.position?.sogKn != null)
              ? "마지막 저속 관측 · 확인 필요"
              : "마지막 위치 · 확인 필요"
          : atDock(id).length
            ? "접안 판별 대기"
            : feed.status === "partial"
              ? "일부 신호 미확인"
              : "최근 신호 없음";
  const kst = (value: string) =>
    new Date(value).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const state = record(demo ? snapshot : null);
  const material = record(state.material);
  const ships = record(material.ships);
  const hasMaterial = Object.keys(ships).length > 0;
  const unloadJob = record(record(material.jobs).unload);
  const selectedLot = referenceLots.find((lot) => lot.id === selectedLotId);
  const selectedEndpoint = selectedLot ? endpointForLot(selectedLot) : null;
  const endpoint = endpoints.find((item) => item.id === selectedEndpoint);
  const current = voyageExamples[berth - 1];
  const shipReading = (index: number) => {
    const live = record(ships[index + 1]);
    const total = finite(live.total);
    const unloaded = finite(live.unloaded);
    const remaining = finite(live.remaining);
    return {
      total,
      unloaded,
      remaining,
      percent:
        total !== null && total > 0 && unloaded !== null
          ? Math.min(100, Math.max(0, (unloaded / total) * 100))
          : null,
    };
  };
  const currentReading = shipReading(berth - 1);
  const readings = [shipReading(0), shipReading(1)];
  const estimateFor = (id:number) => estimateUnload({baseTime:state.baseTime,elapsed:state.elapsed,playing:state.playing===true,online:status==='online',berth:id,remaining:shipReading(id-1).remaining,job:unloadJob});
  const sum = (key: "unloaded" | "remaining") =>
    readings.some((item) => item[key] === null)
      ? null
      : readings.reduce((total, item) => total + (item[key] ?? 0), 0);
  const signal = !demo
    ? "설비 미연결"
    : status === "online"
      ? "운전 정보 수신"
      : status === "connecting"
        ? "연결 중"
        : status === "stale"
          ? "수신 지연"
          : "연결 끊김";
  const berthState = (id: number) => {
    if (id === 3) return "입항 대기";
    if (!hasMaterial) return "수신 대기";
    if (status !== "online") return "마지막 수신값";
    if (unloadJob.berth !== id) return "작업 대기";
    if (state.playing !== true) return "일시정지";
    return (finite(unloadJob.actualRate) ?? 0) > 0 ? "하역 중" : "이송 대기";
  };
  const inspectBerth = (id: BerthId) => {
    setBerth(id);
    if (selectedEndpoint && !canReceive(id, selectedEndpoint))
      setSelectedLotId(null);
  };
  const chooseBerth = (id: BerthId) => {
    inspectBerth(id);
    setFocusRequest(request => request + 1);
  };
  const chooseLot = (id: string | null) => {
    if (id === null) {
      setSelectedLotId(null);
      return;
    }
    const lot = referenceLots.find((item) => item.id === id);
    if (lot && canReceive(berth, endpointForLot(lot))) {
      setBerth(berth);
      setSelectedLotId(id);
    }
  };
  const steps = BerthNetwork.head[berth].map((id: string, index: number) => ({
    id,
    label: stepNames[index],
    asset: referenceEquipment.find((item) => item.id === id),
  }));
  const equipment = steps[selectedStep];
  const equipmentState = record(record(state.equipment)[equipment.id]);
  const equipmentStatus =
    equipmentState.status === "running"
      ? "운전"
      : equipmentState.status === "stopped"
        ? "정지"
        : equipmentState.status === "fault"
          ? "고장"
          : "미확인";
  const reachable = endpoints.filter((item) => canReceive(berth, item.id));
  const blocked = endpoints.filter((item) => !canReceive(berth, item.id));
  return (
    <div className="gf-operations-berth" data-testid="operations-berth">
      <header className="gf-ob-heading">
        <div>
          <h1>접안·하역</h1>
          <p>
            당진발전본부 ·{" "}
            {demo ? "접안 및 하역 현황" : "선박 추적 연계"}
            {!demo && <span>AIS</span>}
          </p>
        </div>
        <button
          type="button"
          className="gf-ob-link"
          onClick={() => onNavigate("vessels")}
        >
          항차·화물 <ArrowRight />
        </button>
      </header>
      <section className="gf-ob-kpis" aria-label="접안 하역 요약">
        <div>
          <Anchor />
          <span>
            {demo ? "접안 현황" : "AIS 접안 추정"}
            <strong>
              {demo
                ? hasMaterial
                  ? "2"
                  : "미확정"
                : feed.status === "ready"
                  ? occupied.length
                  : "—"}
              <small>/ 3 부두</small>
            </strong>
          </span>
        </div>
        <div>
          <Ship />
          <span>
            {demo ? "하역 완료" : "부두 인근 관측"}
            <strong>
              {demo
                ? number(sum("unloaded"))
                : feed.status === "ready"
                  ? feed.rows.length
                  : "—"}
              <small>
                {demo ? (sum("unloaded") === null ? "" : "t") : "척"}
              </small>
            </strong>
          </span>
        </div>
        <div>
          <Layers3 />
          <span>
            {demo ? "하역 잔량" : "접안 판별 대기"}
            <strong>
              {demo
                ? number(sum("remaining"))
                : feed.status === "ready"
                  ? feed.rows.length - detected.length
                  : "—"}
              <small>
                {demo ? (sum("remaining") === null ? "" : "t") : "척"}
              </small>
            </strong>
          </span>
        </div>
        <div>
          <Clock3 />
          <span>
            {demo ? "다음 입항 일정" : "최근 조회 · KST"}
            <strong>
              {demo ? (
                <>
                  {nextArrival?.date}<small>{nextArrival?.time} KST</small>
                </>
              ) : feed.checked ? (
                kst(feed.checked).split(" ").at(-1)
              ) : (
                "—"
              )}
            </strong>
          </span>
        </div>
      </section>
      <div className="gf-ob-main">
        <div className="gf-ob-docks" aria-label="부두 선택">
          {!demo
            ? docks.map((id) => (
                <button
                  type="button"
                  key={id}
                  className="gf-ob-dock"
                  aria-pressed={berth === id}
                  onClick={() => chooseBerth(id)}
                >
                  <span className="gf-ob-dock-id">
                    <b>
                      {id}
                      <small>부두</small>
                    </b>
                    <span>{detectionLabel(id)}</span>
                  </span>
                  <span className="gf-ob-dock-vessel">
                    <b>
                      {atDock(id)
                        .map((r) => r.vessel.name)
                        .join(" · ") ||
                        (feed.status === "ready" ? "관측 선박 없음" : "—")}
                    </b>
                    <span>
                      {atDock(id).length ? "위치 관측 · 상세 확인" : "당진 석탄부두"}
                    </span>
                  </span>
                </button>
              ))
            : voyageExamples.slice(0, 3).map((voyage, index) => {
                const reading = shipReading(index);
                return (
                  <button
                    key={voyage.id}
                    type="button"
                    className="gf-ob-dock"
                    aria-pressed={berth === index + 1}
                    aria-controls="gf-berth-detail"
                    onClick={() => chooseBerth((index + 1) as BerthId)}
                  >
                    <span className="gf-ob-dock-id">
                      <b>
                        {index + 1}
                        <small>부두</small>
                      </b>
                      <span>{berthState(index + 1)}</span>
                    </span>
                    <span className="gf-ob-dock-vessel">
                      <b>
                        {index === 2
                          ? "다음 · OCEAN"
                          : voyage.name.replace("GEN4CAST ", "")}
                      </b>
                      <span>
                        {index === 2
                          ? `${voyage.date} ${voyage.time} 예정`
                          : `${voyage.coal} · ${number(voyage.tons)} t`}
                      </span>
                    </span>
                    <span className="gf-ob-dock-progress">
                      {index < 2 ? (
                        <>
                          <strong>
                            {reading.percent === null
                              ? "—"
                              : reading.percent.toFixed(1)}
                            <small>%</small>
                          </strong>
                          <span className="gf-ob-track" aria-hidden="true">
                            <i style={{ width: `${reading.percent ?? 0}%` }} />
                          </span>
                          <span>잔량 {number(reading.remaining)} t</span>
                        </>
                      ) : (
                        <>
                          <strong>
                            70,000<small>t</small>
                          </strong>
                          <span>목적지 미배정</span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
        </div>

        <section
          className="gf-ob-panel gf-ob-board"
          aria-label="부두별 반입 계통"
        >
          <div className="gf-ob-route-title">
            <h3>
              {endpoint
                ? `${berth}부두 → ${endpoint.label} · 경로 검토`
                : `${berth}부두 · 반입 가능 ${reachable.length}구역 / ${endpoints.length}구역`}
            </h3>
            <div
              className="gf-ob-view-switch"
              role="group"
              aria-label="부두 도면 범위"
            >
              <button
                type="button"
                aria-pressed={berthView === "route"}
                onClick={() => setBerthView("route")}
              >
                선택 부두
              </button>
              <button
                type="button"
                aria-pressed={berthView === "site"}
                onClick={() => setBerthView("site")}
              >
                전체 배치
              </button>
            </div>
          </div>
          <div className="gf-ob-scene">
            {baseline.data?.as_of && <FuelScene
              mode="berth"
              berthView={berthView}
              focusRequest={focusRequest}
              onInspectBerth={inspectBerth}
              observedDockMask={
                demo
                  ? undefined
                  : docks.filter((id) => atDock(id).length).reduce<number>((mask, id) => mask | (1 << id), 0)
              }
              yard={(selectedLot?.yard ?? 1) as BerthId}
              berth={berth}
              theme={theme}
              selectedLotId={selectedLotId}
              onSelectLot={chooseLot}
              snapshot={demo ? snapshot : null}
              baselineStock={baseline.data?.as_of ? baselineStock : undefined}
              baselineDetails={baselineDetails}
              baselineLots={baseline.data.lots}
              online={status === "online"}
            />}
            {!baseline.data?.as_of && <p role="status">{baseline.error || '기준재고 확인 중'}</p>}
          </div>
          <div
            className="gf-ob-equipment-tabs"
            role="group"
            aria-label="하역·이송 설비 선택"
          >
            {steps.map((step, index) => (
              <button
                type="button"
                key={step.id}
                aria-pressed={index === selectedStep}
                aria-controls="gf-equipment-detail"
                onClick={() => setSelectedStep(index)}
              >
                <span>{step.label}</span>
                <small>{step.asset ? `${BerthNetwork.label(BerthNetwork.entryPart(step.id,berth))}번` : "설비 정보 미제공"}</small>
              </button>
            ))}
          </div>
          <div
            className="gf-ob-equipment-detail"
            id="gf-equipment-detail"
            aria-live="polite"
          >
            <div>
              <span>선택 설비</span>
              <strong>
                {equipment.asset ? `${BerthNetwork.label(BerthNetwork.entryPart(equipment.id,berth))}번` : "미제공"}{" "}
                <small>{equipment.asset?.name ?? ""}</small>
              </strong>
            </div>
            <div>
              <span>경로 검토</span>
              <strong>
                {endpoint
                  ? `${berth}부두 → ${endpoint.label}`
                  : "반입 가능한 구역 전체"}
              </strong>
            </div>
            <div>
              <span>운전 신호 / 이송량</span>
              <strong>
                {demo
                  ? `${equipmentStatus} · ${number(finite(equipmentState.flow))} t/h`
                  : "실시간 미연결"}
              </strong>
            </div>
          </div>
        </section>
        <aside
          className="gf-ob-panel gf-ob-detail"
          id="gf-berth-detail"
          aria-label="선택 부두 상세"
        >
          <div className="gf-ob-section-head">
            <h2>{berth}부두 상세</h2>
            <span>{demo ? berthState(berth) : detectionLabel(berth)}</span>
          </div>
          {!demo ? (
            <div className="gf-ob-live-detail">
              {atDock(berth).length ? (
                atDock(berth).map((row) => {
                  const linked = matchCargo(row.vessel, feed.registry);
                  return (
                    <div className="gf-ob-vessel" key={row.vessel.mmsi}>
                      <h3>{row.vessel.name}</h3>
                      {row.stale && <p>{lastObservation(row)} · 1시간 이상 수신 없음 · 현재 접안 여부 미확인</p>}
                      <span>
                        MMSI {row.vessel.mmsi} · {kst(row.observedAt)} KST ·{" "}
                        {row.vessel.ais?.position?.sogKn ?? "—"} kn ·{" "}
                        {row.vessel.ais?.position?.feed === "openwaters"
                          ? "Open Waters"
                          : "AIS"}
                      </span>
                      <p>
                        {linked
                          ? [
                              linked.voyage.voyage_number ||
                                linked.voyage.plan_name ||
                                "배선 계획",
                              ...linked.cargo.map((c) => c.coal_name),
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : feed.registry
                            ? "일치 항차 미확인"
                            : "항차 원장 미확인"}
                      </p>
                      {linked && (
                        <dl className="gf-ob-facts">
                          <div>
                            <dt>하역 상태</dt>
                            <dd>
                              {linked.voyage.status === "unloading"
                                ? "원장 · 하역 중"
                                : "하역 개시 미확인"}
                            </dd>
                          </div>
                          <div>
                            <dt>원장 입하량</dt>
                            <dd>
                              {linked.cargo.length &&
                              linked.cargo.every(
                                (c) => typeof c.received_t === "number",
                              )
                                ? number(
                                    linked.cargo.reduce(
                                      (sum, c) => sum + Number(c.received_t),
                                      0,
                                    ),
                                  ) + " t"
                                : "미확인"}
                            </dd>
                          </div>
                        </dl>
                      )}
                      {linked && linked.voyage.voyage_no != null && linked.voyage.status !== "unloading" && !linked.voyage.actual_unload_end && (
                        <BerthStackingHint voyageNo={String(linked.voyage.voyage_no)} onOpenStacking={onOpenStacking} />
                      )}
                    </div>
                  );
                })
              ) : (
                <p>{detectionLabel(berth)}</p>
              )}
            </div>
          ) : (
            <>
              <div className="gf-ob-vessel">
                <h3>{current.name}</h3>
                <span>
                  {current.id} · {current.coal}
                </span>
              </div>
              <dl className="gf-ob-facts">
                <div>
                  <dt>출항지</dt>
                  <dd>{current.origin}</dd>
                </div>
                <div>
                  <dt>입항 일정 KST</dt>
                  <dd>
                    {current.date} {current.time}
                  </dd>
                </div>
              </dl>
              {berth < 3 ? (
                <>
                  <div className="gf-ob-cargo">
                    <div>
                      <span>하역 완료</span>
                      <strong>
                        {number(currentReading.unloaded)}
                        <small>t</small>
                      </strong>
                    </div>
                    <div>
                      <span>남은 물량</span>
                      <strong>
                        {number(currentReading.remaining)}
                        <small>t</small>
                      </strong>
                    </div>
                  </div>
                  <div
                    className="gf-ob-track gf-ob-detail-track"
                    role="progressbar"
                    aria-label="선택 부두 하역 진행률"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={currentReading.percent ?? undefined}
                    aria-valuetext={
                      currentReading.percent === null
                        ? "수신 전 · 미확정"
                        : `${currentReading.percent.toFixed(1)}%`
                    }
                  >
                    <i style={{ width: `${currentReading.percent ?? 0}%` }} />
                  </div>
                  <div className="gf-ob-progress-caption">
                    <span>총 {number(currentReading.total)} t</span>
                    <span>
                      {currentReading.percent === null
                        ? "미확정"
                        : `${currentReading.percent.toFixed(1)}% · 하역`}
                    </span>
                  </div>
                </>
              ) : (
                <p className="gf-ob-empty-berth">
                  다음 입항 선박입니다.
                  <br />
                  현재 하역량은 제공되지 않습니다.
                </p>
              )}
            </>
          )}
          <section className="gf-ob-destinations" aria-label="반입 가능 구역">
            <div className="gf-ob-section-head">
              <h2>반입 가능 구역</h2>
              <button
                type="button"
                className="gf-ob-link"
                disabled={selectedLotId === null}
                onClick={() => setSelectedLotId(null)}
              >
                전체 보기
              </button>
            </div>
            {referenceYards.map((yard) => (
              <div className="gf-ob-destination-yard" key={yard.id}>
                <div>
                  <strong>{yard.name}</strong>
                  <small>{yard.id === 1 ? "옥외" : "옥내"}</small>
                </div>
                <div>
                  {endpoints
                    .filter((item) => item.yard === yard.id)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!canReceive(berth, item.id)}
                        aria-pressed={selectedEndpoint === item.id}
                        title={
                          canReceive(berth, item.id)
                            ? "경로 조회 · 하역 배정 아님"
                            : `${berth}부두에서 반입 불가`
                        }
                        onClick={() => chooseLot(item.lotId)}
                      >
                        {item.label}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            <p className="gf-ob-unreachable">
              <Radio />
              반입 불가: {blocked.map((item) => item.label).join(" · ")}
            </p>
            <label className="gf-ob-receiving-lot">
              <span>도착 원탄</span>
              <select
                aria-label="원탄 선택"
                value={selectedLotId ?? ""}
                onChange={(event) => chooseLot(event.target.value || null)}
              >
                <option value="">선택 없음</option>
                {referenceLots
                  .filter((lot) => canReceive(berth, endpointForLot(lot)))
                  .map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.pile ? `Pile ${lot.pile}` : `${lot.shed}${lot.cell}`}{" "}
                      · {lot.coal}
                      {lot.tons === 0 ? " · 소진" : ""}
                    </option>
                  ))}
              </select>
            </label>
            {demo && typeof unloadJob.reason === "string" && (
              <p className="gf-ob-destination-note">
                작업 · {unloadJob.reason.replace(/(?:CSU|CV|T\/T|TT|S\/R|RE|TR|FG|BB|SCB)-[A-Z0-9./·-]+/gi, '설비')} ·{" "}
                {number(finite(unloadJob.moved))} t
              </p>
            )}
          </section>
          <button
            type="button"
            className="gf-ob-link gf-ob-ledger-link"
            onClick={() => onOpenYard(selectedLot?.id)}
          >
            {selectedLot
              ? `${selectedLot.yard}저탄장 · ${endpoint?.label ?? "선택 구역"} 재고 보기`
              : "저탄장 재고 보기"}{" "}
            <ArrowRight />
          </button>
        </aside>
      </div>
      {!demo ? (
        <section
          className="gf-ob-panel gf-ob-observations"
          aria-label="당진 석탄부두 AIS 관측"
        >
          <div className="gf-ob-section-head">
            <h2>부두 인근 선박</h2>
            <span>최근 24시간 · 위치 관측시각 KST</span>
          </div>
          {feed.rows.length ? (
            <div className="gf-ob-observation-list">
              {feed.rows.map((row) => (
                <div key={row.vessel.mmsi}>
                  <strong>{row.vessel.name}</strong>
                  <span>
                    {row.berth !== null ? row.berth + "부두" : "부두 경계"}
                  </span>
                  <span>{row.stale ? lastObservation(row) + " · 확인 필요" : row.estimated ? "접안 추정" : "판별 대기"}</span>
                  <time>{kst(row.observedAt)}</time>
                </div>
              ))}
            </div>
          ) : (
            <p>
              {feed.status === "ready"
                ? "최근 24시간 이내 부두에서 관측된 접안 후보가 없습니다."
                : feed.status === "error"
                  ? "ZGX AIS 조회 불가 · 자동 재시도 중"
                  : feed.status === "partial"
                    ? "일부 선박 위치 조회 실패 · 재조회 중"
                    : "ZGX AIS 위치 조회 중"}
            </p>
          )}
        </section>
      ) : (
        <div className="gf-ob-bottom">
          <section className="gf-ob-panel gf-ob-schedule">
            <div className="gf-ob-section-head">
              <h2>부두별 입항 일정</h2>
              <span>{calendarDays[0]}–{calendarDays[calendarDays.length - 1]} · KST</span>
            </div>
            <div
              className="gf-ob-calendar-scroll"
              tabIndex={0}
              role="region"
              aria-label="접안 일정"
            >
              <div className="gf-ob-calendar">
                <div className="gf-ob-calendar-head">
                  <span>부두 / 선박</span>
                  <div>
                    {calendarDays.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                </div>
                {voyageExamples.slice(0, 3).map((voyage, index) => (
                  <button
                    type="button"
                    key={voyage.id}
                    className="gf-ob-calendar-row"
                    aria-pressed={berth === index + 1}
                    onClick={() => chooseBerth((index + 1) as BerthId)}
                  >
                    <span>
                      <b>{index + 1}부두</b>
                      <small>{voyage.name.replace("GEN4CAST ", "")}</small>
                    </span>
                    <span className="gf-ob-calendar-lane">
                      {index < 2 ? (
                        <span className="gf-ob-running">
                          {(() => { const estimate=estimateFor(index+1); return estimate ? `${estimate.kind==='ship'?'하역 완료 예상':'작업 종료 예상'} · ${kst(estimate.at)}` : berthState(index+1); })()}
                        </span>
                      ) : (
                        <span className="gf-ob-arrival">
                          <Ship />
                          {voyage.date} {voyage.time} 입항 예정
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <p className="gf-ob-schedule-note">
              <Info />
              하역 잔량과 현재 이송량이 유지된다는 조건의 예상입니다. 작업량이 선박 잔량보다 적으면 작업 종료만 표시합니다.
            </p>
          </section>
          <section className="gf-ob-panel gf-ob-upcoming">
            <div className="gf-ob-section-head">
              <h2>다음 입항</h2>
              <span>{voyageExamples.length - 2}항차 · {number(upcomingTons)} t</span>
            </div>
            <div
              className="gf-ob-upcoming-scroll"
              tabIndex={0}
              role="region"
              aria-label="다음 입항 표"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">선박 / 출항지</th>
                    <th scope="col">입항 예정 KST</th>
                    <th scope="col" className="gf-ob-number">
                      물량 t
                    </th>
                    <th scope="col">부두</th>
                  </tr>
                </thead>
                <tbody>
                  {voyageExamples.slice(2).map((voyage) => (
                    <tr key={voyage.id}>
                      <td>
                        <button
                          type="button"
                          onClick={() => onNavigate("vessels")}
                        >
                          {voyage.name}
                          <ArrowRight />
                        </button>
                        <small>{voyage.origin}</small>
                      </td>
                      <td>
                        {voyage.date}
                        <small>{voyage.time}</small>
                      </td>
                      <td className="gf-ob-number">{number(voyage.tons)}</td>
                      <td>{voyage.berth ? `${voyage.berth}부두` : "미배정"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gf-ob-upcoming-footer">
              <span>ETA와 접안 배정은 구분해 확인합니다.</span>
              <button
                type="button"
                className="gf-ob-link"
                onClick={() => onNavigate("vessels")}
              >
                항차·화물 확인 <ArrowRight />
              </button>
            </div>
          </section>
        </div>
      )}
      <p className="gf-ob-source" role="status">
        {demo
          ? signal
          : (feed.status === "partial" ? "일부 선박 미수신 · " : "") +
            "AIS 위치·속력 기반 접안 추정 · 하역 실적은 설비·원장 기준"}
        {demo && status !== "online" && hasMaterial
          ? " · 마지막 수신값 유지 · 애니메이션 정지"
          : ""}
      </p>
    </div>
  );
}
