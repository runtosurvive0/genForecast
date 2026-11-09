import { Anchor, Navigation, Ship, Warehouse } from "lucide-react";
import {
  estimateArrival,
  type TrackingVessel,
  type TrackingVoyage,
} from "@/domain/vessel-workflow";
import { number as n } from "@/lib/format";
import { etaDate } from "./VesselEtaDetail";

/** Registered assumptions stay separate from the independently calculated AIS ETA. */
export function VesselCargoSummary({
  vessel,
  voyage,
}: {
  vessel: TrackingVessel;
  voyage?: TrackingVoyage;
}) {
  const arrival = voyage ? estimateArrival(voyage) : undefined;
  const steps = [
    { label: "출항 계획", at: voyage?.etd, icon: Ship, note: "등록 ETD" },
    {
      label: arrival?.method === "actual" ? "입항 실적" : "입항 전망",
      at: arrival?.eta,
      icon: Navigation,
      note: arrival?.method === "actual" ? "등록 실적" : "등록 항차 계산",
    },
    {
      label: "접안 전망",
      at: arrival?.berth,
      icon: Anchor,
      note:
        voyage?.portWaitH == null
          ? "대기 가정 필요"
          : `대기 ${n(voyage.portWaitH)}h 가정`,
    },
    {
      label: "하역 완료 전망",
      at: arrival?.unload,
      icon: Warehouse,
      note:
        voyage?.unloadH == null
          ? "작업 가정 필요"
          : `작업 ${n(voyage.unloadH)}h 가정`,
    },
  ];
  return (
    <section
      className="gf-voyages-cargo"
      aria-label="선택 선박 등록 화물"
      data-vessel-id={vessel.id}
    >
      <header>
        <h2>항로 설정 일정</h2>
        <span>
          {vessel.source === "demo"
            ? "시연 자료"
            : voyage
              ? "개인 설정"
              : "설정 없음"}{" "}
          · KST
        </span>
        {voyage && <div className="gf-voyages-cargo-totals">
          <span>
            화물 <b>{voyage ? `${n(voyage.cargoT)} t` : "미등록"}</b>
          </span>
          <span>
            열량 <b>{voyage ? `${n(voyage.cv)} kcal/kg` : "미등록"}</b>
          </span>
        </div>}
      </header>
      {voyage && <ol className="gf-voyages-timeline" aria-label="등록 운송 일정">
        {steps.map(({ label, at, icon: Icon, note }) => (
          <li key={label} data-known={Boolean(at)}>
            <span className="gf-voyages-timeline-icon">
              <Icon size={17} aria-hidden="true" />
            </span>
            <div>
              <span>{label}</span>
              <strong>{at ? etaDate(at) : "미확정"}</strong>
              <small>{note}</small>
            </div>
          </li>
        ))}
      </ol>}
      <p>
        {voyage
          ? vessel.source === 'demo' ? "시연 일정 기준 · 공용 배선과 재고 원장에는 반영되지 않습니다." : "개인 항로 설정 기준 · 공용 배선과 재고 원장에는 반영되지 않습니다."
          : "항로·계산 설정에서 일정 가정을 입력할 수 있습니다."}
      </p>
    </section>
  );
}
