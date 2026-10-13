import type { PlanningSnapshot } from "@/domain/planning";
import { Section } from "./tower/primitives";
import { number as n } from "@/lib/format";

export function InventoryPool({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  const waiting = s.inventory.kpis.port_remaining;
  const secured = s.inventory.kpis.stock_including_port;
  return (
    <Section
      title="항내 확보량과 하역 전망"
      note={`${s.start} 00:00 KST · 계획·가상 자료 포함 · 현재 실측 재고와 구분`}
    >
      <p className="tower-footnote">
        전망 옵션:{" "}
        {s.inventory_mode === "include_waiting"
          ? "체선 포함 · 가상 배정"
          : "기본 · 확정 배정만"}
      </p>
      <p>
        항내 선박 잔량{" "}
        <strong>{waiting == null ? "미확정" : `${n(waiting)} t`}</strong> ·
        저탄장 + 항내 확보량{" "}
        <strong>{secured == null ? "미확정" : `${n(secured)} t`}</strong>
      </p>
      <p className="tower-footnote">
        항내 확보량은 대기·하역 중 선박의 남은 화물을 포함합니다. 저탄장에는
        하역된 물량만 반영하며, 미배정 화물을 처별 재고에 미리 더하지 않습니다.
      </p>
      {!!s.estimated_assignments?.length && (
        <details>
          <summary>
            가상 접안·하역 배정 {s.estimated_assignments.length}건
          </summary>
          <ul>
            {s.estimated_assignments.map((a) => (
              <li key={a.vessel_id}>
                {s.vessels.find((v) => v.id === a.vessel_id)?.name ??
                  a.vessel_id}{" "}
                → {a.berth_id} · {a.start_at.slice(0, 16).replace("T", " ")} ·{" "}
                {a.reason}
              </li>
            ))}
          </ul>
          <p className="tower-footnote">
            가상 배정은 실제 예약 원장을 변경하지 않습니다.
          </p>
        </details>
      )}
    </Section>
  );
}
