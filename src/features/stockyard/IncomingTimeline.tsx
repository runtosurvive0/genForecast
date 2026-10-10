import type { CSSProperties } from "react";
import { Section } from "@/components/tower/primitives";
import { date as fmtDate, number as n } from "@/lib/format";
import type { TimelineRow } from "./stockyard-domain";

/** 입하·하역 타임라인: 대기 → 하역 → 하역 완료(재고 반영). */
export function IncomingTimeline({
  rows,
  horizon,
  selectedId,
  onSelect,
}: {
  rows: TimelineRow[];
  horizon: number;
  selectedId: string | null;
  onSelect: (voyageId: string) => void;
}) {
  const span = (range: [number, number]) =>
    ({
      left: `${range[0] * 100}%`,
      width: `max(3px, ${(range[1] - range[0]) * 100}%)`,
    }) as CSSProperties;
  return (
    <Section
      title="입하 예정"
      note={`취소 항차 제외 · 하역 완료 순 · 재고 반영은 하역 완료 시점 · 기준시각부터 ${horizon}일`}
    >
      <div className="tower-table-wrap">
        <table className="tower-table stockyard-incoming">
          <thead>
            <tr>
              <th>선박 · 물량</th>
              <th className="timeline-head">
                <span>기준</span>
                <span>+{Math.round(horizon / 2)}일</span>
                <span>+{horizon}일</span>
              </th>
              <th>하역 완료</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.voyage.voyage_id}
                className={selectedId === r.voyage.voyage_id ? "is-selected" : undefined}
              >
                <td>
                  <button onClick={() => onSelect(r.voyage.voyage_id)}>{r.voyage.vessel_name}</button>
                  <small>
                    {n(r.voyage.cargo_t)} t · {r.voyage.coal_type} · {n(r.voyage.calorific_value_kcal_kg)}
                  </small>
                </td>
                <td className="timeline-cell">
                  <div
                    className="timeline-track"
                    role="img"
                    aria-label={`${r.voyage.vessel_name}: ETA ${fmtDate(r.eta, true)}, 접안 ${fmtDate(r.berthAt, true)}, 하역 완료 ${fmtDate(r.unloadEnd, true)}`}
                  >
                    {r.wait && <i className="timeline-wait" style={span(r.wait)} />}
                    <i className="timeline-unload" style={span(r.unload)} />
                    <i className="timeline-reflect" style={{ left: `${r.reflect * 100}%` }} />
                  </div>
                </td>
                <td>{fmtDate(r.unloadEnd, true)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3}>기간 내 입하 예정이 없습니다</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="timeline-wait" />
          접안 대기
        </span>
        <span>
          <i className="timeline-unload" />
          하역
        </span>
        <span>
          <i className="timeline-reflect" />
          재고 반영
        </span>
      </div>
    </Section>
  );
}
