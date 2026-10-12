import {
  Anchor,
  Boxes,
  CalendarDays,
  CircleCheck,
  CircleHelp,
  Flame,
  Fuel,
  Ship,
  TriangleAlert,
} from "lucide-react";
import type { PlanningSnapshot } from "../domain/planning";
import {
  minimumInventoryPoint,
  SUPPLY_RISK_NAMES,
  type SupplyTarget,
} from "../domain/supply";
import "./supply.css";

const fmt = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });

export function SupplyKpis({
  snapshot: s,
  onTarget,
}: {
  snapshot: PlanningSnapshot;
  onTarget: (target: SupplyTarget) => void;
}) {
  const k = s.inventory.kpis;
  const minimum = minimumInventoryPoint(s);
  const RiskIcon =
    k.risk === "normal"
      ? CircleCheck
      : k.risk === "unknown"
        ? CircleHelp
        : TriangleAlert;
  const cards = [
    {
      title: "총 재고",
      icon: Boxes,
      value: k.stock,
      unit: "t",
      note:
        k.stock === null ? "기준재고 미등록" : "조회 시작시각 · DB 수급 원장",
      target: { section: "inventory" } as SupplyTarget,
    },
    {
      title: `최소 재고일수 (${s.horizon_days}일)`,
      icon: CalendarDays,
      value: k.min_days,
      unit: "일",
      digits: 1,
      note: minimum
        ? `${minimum.day} · 처별 전망 중 최소값`
        : "처별 전망 중 최소값",
      target: { section: "forecast", ...minimum } as SupplyTarget,
    },
    {
      title: "하역 잔량",
      icon: Anchor,
      value: k.unloading_remaining,
      unit: "t",
      note: `조회 시작시각 · ${fmt(k.active_vessels)}척 하역 중`,
      target: { section: "unloading" } as SupplyTarget,
    },
    {
      title: `입항 예정 (${s.horizon_days}일)`,
      icon: Ship,
      value: k.arrivals,
      unit: "t",
      note: `DB 등록 선박 ${fmt(k.arrival_count)}척 · 화물량 기준`,
      target: { section: "arrivals" } as SupplyTarget,
    },
    {
      title: "입항탄 평균 열량",
      icon: Flame,
      value: k.incoming_cv,
      unit: "kcal/kg",
      note: "예정 선박 화물량 가중평균",
    },
    {
      title: "조회 첫날 사용계획",
      icon: Fuel,
      value: s.daily[0]?.fuel_tonnes,
      unit: "t",
      note: `${s.start} · 고정 발열량 환산`,
    },
  ];
  return (
    <div className="fuel-supply-kpis">
      <button
        className={`fuel-supply-kpi fuel-supply-status risk-${k.risk}`}
        data-fuel-metric="연료수급 상태"
        aria-label="연료수급 상태 상세 보기"
        onClick={() => onTarget({ section: "inventory" })}
      >
        <span>연료수급 상태</span>
        <div>
          <RiskIcon size={35} aria-hidden="true" />
          <strong>{SUPPLY_RISK_NAMES[k.risk] ?? "미확정"}</strong>
        </div>
        <p>
          {k.risk === "unknown"
            ? "재고·계획 자료와 최신성 확인 필요"
            : "조회기간의 DB 재고전망 기준"}
        </p>
      </button>
      {cards.map((card) => {
        const Tag = card.target ? "button" : "section";
        return (
          <Tag
            key={card.title}
            className="fuel-supply-kpi"
            data-fuel-metric={card.title}
            aria-label={card.target ? `${card.title} 상세 보기` : undefined}
            onClick={card.target ? () => onTarget(card.target!) : undefined}
          >
            <span>
              <card.icon size={17} aria-hidden="true" />
              {card.title}
            </span>
            <strong>
              {fmt(card.value, card.digits)}
              {card.value != null && <small> {card.unit}</small>}
            </strong>
            <p>{card.note}</p>
          </Tag>
        );
      })}
    </div>
  );
}
