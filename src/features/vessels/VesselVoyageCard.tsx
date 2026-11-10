import { ArrowRight, Minus, Flame, Mountain, Ship, GripVertical } from "lucide-react";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import {
  estimateArrival,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { number as n } from "@/lib/format";
import { VesselFreshnessTag } from "./VesselFreshnessTag";
import { etaDate } from "./VesselEtaDetail";
import type { BasicEta } from "./vessel-basic-eta";
import type { Observation } from "@/domain/berth-ais";
import { berthDisplay } from "./vessel-berth-display";
import type { BerthRegistry } from "@/domain/berth-ais";

function waitingStamp(iso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export function VesselVoyageCard({
  vessel,
  voyage,
  basic,
  selected,
  now,
  onSelect,
  onRemove,
  berthObservation,
  registry,
  registryStatus = 'ready',
  waitingConfirmedAt,
  observationLoading = false,
  coalName,
  cargoCv,
  sharedCargo,
  dragging, dropSide, onDragStart, onDragOver, onDrop, onDragEnd, onMove, onTouchStart, onTouchMove, onTouchDrop, onTouchCancel,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
  basic?: BasicEta;
  selected: boolean;
  now: number;
  onSelect: () => void;
  onRemove: () => void;
  berthObservation?: Observation;
  registry?: BerthRegistry | null;
  registryStatus?: 'loading' | 'ready' | 'error';
  /** 사용자가 부두 대기(체선)로 확인한 시각 */
  waitingConfirmedAt?: string;
  observationLoading?: boolean;
  coalName?: string;
  cargoCv?: number;
  sharedCargo?: boolean;
  dragging?: boolean;
  dropSide?: 'before' | 'after';
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: (after: boolean) => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
  onTouchStart: () => void;
  onTouchMove: (target: string, after: boolean) => void;
  onTouchDrop: (target: string | null, after: boolean) => void;
  onTouchCancel: () => void;
}) {
  const position = vessel.ais?.position ?? voyage?.position;
  const registered = voyage ? estimateArrival(voyage) : undefined;
  const eta = basic ? basic.eta : registered?.eta;
  const berth = berthDisplay(vessel, berthObservation, registry ?? null, now);
  const loadingCargo = vessel.source !== 'demo' && registryStatus === 'loading';
  const loadingArrival = vessel.source !== 'demo' && (observationLoading || (Boolean(berth) && loadingCargo));
  const skeleton = <ProcessingOrb state="searching" label="정보 불러오는 중" hideLabel className="gf-voyage-skeleton" />;
  const berthText = berth?.actual ? etaDate(berth.actual) : berth?.observation.stale ? "마지막 위치 · 확인 필요" : "접안 시각 미확인";
  const source =
    vessel.source === "demo"
      ? "시연 자료"
      : vessel.ais
        ? "AIS 관측"
        : "직접 등록";
  return (
    <div className="gf-voyage-card-wrap" data-vessel-id={vessel.id} data-dragging={dragging || undefined} data-drop-side={dropSide} draggable
      onDragStart={event => {
        if ((event.target as HTMLElement).closest('.gf-voyage-card-remove')) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', vessel.id);
        onDragStart();
      }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const box = event.currentTarget.getBoundingClientRect(); onDragOver(event.clientY >= box.top + box.height / 2); }}
      onDrop={event => { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); onDrop(event.clientY >= box.top + box.height / 2); }}
      onDragEnd={onDragEnd}>
    <button
      className={`shipment-card gf-voyage-card ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="gf-voyage-card-head">
        <strong>{vessel.name}</strong>
      </span>
      <span className="gf-voyage-card-id">
        <span>MMSI {vessel.mmsi || "미등록"}</span>
        <span className="gf-voyage-card-source">{source} <VesselFreshnessTag observedAt={position?.observedAt} now={now} synthetic={vessel.source === "demo"} /></span>
      </span>
      {berthObservation && <span className="gf-voyage-card-berth">
        {berthObservation.berth ? `${berthObservation.berth}부두` : "부두 인근"} · {berthObservation.stale ? "마지막 위치 · 확인 필요" : berthObservation.estimated ? "AIS 접안 추정" : "접안 판별 대기"}
      </span>}
      {waitingConfirmedAt && <span className="vw-wait-confirmed">부두 대기 확인 · {waitingStamp(waitingConfirmedAt)}</span>}
      <span className="gf-voyage-card-compact" aria-hidden={selected}>
        <span className="gf-voyage-card-compact-inner">
          <span title={voyage?.destination || vessel.ais?.destination || "미수신"}>{voyage?.destination || vessel.ais?.destination || "미수신"}</span>
          <span>{loadingArrival && !eta ? skeleton : berth ? berth.actual ? `${berth.actualLabel} ${berthText}` : berthText : eta ? etaDate(eta) : "ETA 미확정"}</span>
        </span>
      </span>
      <span className="gf-voyage-card-extra" aria-hidden={!selected}>
      <span className="gf-voyage-card-extra-inner">
      <span className="gf-voyage-card-route">
        <span className="gf-voyage-card-route-ends">
        <span>
          <small>출항지</small>
          <b title={voyage?.origin || "미등록"}>{voyage?.origin || "미등록"}</b>
        </span>
        <span>
          <small>{voyage ? "도착지" : "AIS 목적지"}</small>
          <b title={voyage?.destination || vessel.ais?.destination || "미수신"}>{voyage?.destination || vessel.ais?.destination || "미수신"}</b>
        </span>
        </span>
        <span className="gf-voyage-card-path" aria-label="항로 진행 위치 확인 필요"><i /><span><Ship size={13} aria-hidden="true" /> 위치 확인 필요</span><i /></span>
      </span>
      <span className="gf-voyage-card-facts">
        <span>
          <small><Mountain size={14} aria-hidden="true" /> 탄종</small>
          <b title={coalName || undefined}>{coalName || (loadingCargo ? skeleton : registryStatus === 'error' && vessel.source !== 'demo' ? '조회 실패' : '미확인')}</b>
        </span>
        <span>
          <small><Flame size={14} aria-hidden="true" /> 발열량</small>
          <b>
            {cargoCv != null || (!sharedCargo && voyage) ? (
              <>
                {n(cargoCv ?? voyage!.cv)} <em>kcal/kg{cargoCv != null ? ' · ARB' : ' · 등록 가정'}</em>
              </>
            ) : (
              loadingCargo ? skeleton : registryStatus === 'error' && vessel.source !== 'demo' ? "조회 실패" : "미등록"
            )}
          </b>
        </span>
      </span>
      <span className="gf-voyage-card-footer">
        <span>
          <small>{loadingArrival && !eta ? "도착 상태 확인 중" : berth ? berth.actual ? `${berth.actualLabel} · KST` : "마지막 AIS 관측 · KST" : `${basic ? "기본 ETA" : "등록 입항"} · KST`}</small>
          <b>{loadingArrival && !eta ? skeleton : berth ? berth.actual ? berthText : etaDate(berth.observation.observedAt) : eta ? etaDate(eta) : "미확정"}</b>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </span>
      </span>
      </span>
    </button>
    <button type="button" className="gf-voyage-card-drag" aria-label={`${vessel.name} 순서 이동`} aria-keyshortcuts="ArrowUp ArrowDown" title="드래그하거나 위·아래 방향키로 순서 이동"
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onMove(event.key === 'ArrowUp' ? -1 : 1); } }}
      onPointerDown={event => { if (event.pointerType === 'touch') { event.currentTarget.setPointerCapture(event.pointerId); onTouchStart(); } }}
      onPointerMove={event => {
        if (event.pointerType !== 'touch' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.gf-voyage-card-wrap');
        if (!target?.dataset.vesselId) return;
        const box = target.getBoundingClientRect();
        onTouchMove(target.dataset.vesselId, event.clientY >= box.top + box.height / 2);
      }}
      onPointerUp={event => {
        if (event.pointerType !== 'touch') return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.gf-voyage-card-wrap');
        const box = target?.getBoundingClientRect();
        onTouchDrop(target?.dataset.vesselId ?? null, box ? event.clientY >= box.top + box.height / 2 : false);
      }} onPointerCancel={onTouchCancel}><GripVertical size={15} aria-hidden="true" /></button>
    <button type="button" className="gf-voyage-card-remove" aria-label={`${vessel.name} 관심 선박 해제`} title="관심 선박 해제" onClick={(event) => {
      const card = event.currentTarget.parentElement;
      const neighbour = card?.nextElementSibling ?? card?.previousElementSibling;
      const search = card?.closest(".vessel-watchlist-content")?.querySelector<HTMLInputElement>("input");
      onRemove();
      requestAnimationFrame(() => (neighbour?.querySelector<HTMLButtonElement>(".shipment-card") ?? search)?.focus({ preventScroll: true }));
    }}><Minus size={14} strokeWidth={3} aria-hidden="true" /></button>
    </div>
  );
}
