import type { ReactNode } from "react";
import type { StockyardAlert, StockyardTarget } from "./stockyard-domain";

export interface KpiItem {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  tone?: "danger" | "warn" | "ok" | "unknown";
  /** 클릭 시 하는 일 (화면 낭독용 설명 겸). */
  action: string;
  onClick: () => void;
  pressed?: boolean;
}

/** 클릭 가능한 KPI 띠. 공통 Metric과 같은 `tower-metric` 마크업을 버튼으로 쓴다. */
export function StockyardKpis({ items }: { items: KpiItem[] }) {
  return (
    <div className="tower-kpis stockyard-kpis">
      {items.map((k) => (
        <button
          key={k.label}
          className={`tower-metric stockyard-kpi${k.tone ? ` is-${k.tone}` : ""}`}
          onClick={k.onClick}
          aria-pressed={k.pressed}
          aria-label={`${k.label} ${typeof k.value === "string" || typeof k.value === "number" ? k.value : ""}${k.unit ?? ""} · ${k.action}`}
          title={k.action}
        >
          <span>{k.label}</span>
          <strong>
            {k.value}
            <small>{k.unit}</small>
          </strong>
          {k.note && <p>{k.note}</p>}
        </button>
      ))}
    </div>
  );
}

const LEVEL_LABEL = { danger: "위험", warn: "주의", info: "정보" } as const;

/** 저탄장 알림 칩. 대상이 있으면 눌러서 선택한다. */
export function StockyardAlerts({
  alerts,
  onTarget,
}: {
  alerts: StockyardAlert[];
  onTarget: (target: StockyardTarget) => void;
}) {
  const [shown, rest] = [alerts.slice(0, 5), alerts.length - 5];
  return (
    <div className="stockyard-alerts" role="region" aria-label="저탄장 알림">
      <span className="stockyard-alerts-count">
        알림 <b>{alerts.length}</b>
      </span>
      {!alerts.length && <span className="stockyard-alerts-empty">현재 규칙에 걸린 항목이 없습니다</span>}
      {shown.map((a, i) => (
        <button
          key={`${a.text}-${i}`}
          className={`alert-chip is-${a.level}`}
          disabled={!a.target}
          onClick={() => a.target && onTarget(a.target)}
        >
          <i>{LEVEL_LABEL[a.level]}</i>
          {a.text}
        </button>
      ))}
      {rest > 0 && <span className="stockyard-alerts-more">외 {rest}건</span>}
      <small>화면 규칙 · 운영 지시 아님</small>
    </div>
  );
}
