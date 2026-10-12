import type { ReactNode } from "react";
import { FuelDashboard } from "./FuelDashboard";
import { addDays, type PlanningSnapshot } from "../../domain/planning";
import type { SupplyTarget } from "../../domain/supply";
import "./midterm.css";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="tower-section">
      <header>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
function Outages({ snapshot: s }: { snapshot: PlanningSnapshot }) {
  const first = Date.parse(s.start + "T00:00:00+09:00");
  const last = Date.parse(addDays(s.end, 1) + "T00:00:00+09:00");
  const visible = s.outages.filter(
    (o) => Date.parse(o.end_at) > first && Date.parse(o.start_at) < last,
  );
  return (
    <Section
      title="호기별 계획정지 일정"
      note={`${s.start} ~ ${s.end} · 선택한 MILP 계산에 반영된 일정 · 종료시각 제외`}
    >
      <div className="midterm-outage-axis">
        <span>{s.start}</span>
        <span>{s.end}</span>
      </div>
      <div className="midterm-outages">
        {s.units.map((u) => (
          <div className="midterm-outage-row" key={u.unit_id}>
            <span>{u.name}</span>
            <div className="midterm-outage-track">
              {visible
                .filter((o) => o.unit_id === u.unit_id)
                .map((o, i) => {
                  const left = Math.max(first, Date.parse(o.start_at));
                  const end = Math.min(last, Date.parse(o.end_at));
                  return (
                    <span
                      className="midterm-outage-bar"
                      key={i}
                      title={`${o.name}: ${o.start_at} ~ ${o.end_at} · ${o.note}`}
                      style={{
                        left: `${((left - first) / (last - first)) * 100}%`,
                        width: `${((end - left) / (last - first)) * 100}%`,
                      }}
                    />
                  );
                })}
              {!visible.some((o) => o.unit_id === u.unit_id) && (
                <small>등록 일정 없음</small>
              )}
            </div>
          </div>
        ))}
      </div>
      {visible.length ? (
        <div className="tower-table-wrap">
          <table className="tower-table">
            <thead>
              <tr>
                <th>호기</th>
                <th>정지 시작 KST</th>
                <th>재가동 시각 KST</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o, i) => (
                <tr key={i}>
                  <td>{o.name}</td>
                  <td>{o.start_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{o.end_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{o.note || "계획정지"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="tower-footnote">
          이 기간에 등록된 당진 정지 일정이 없습니다. 계획정지 자료의 등록
          여부를 확인하세요.
        </p>
      )}
    </Section>
  );
}

export function MidtermDashboard({
  snapshot,
  theme,
  onSupplyTarget,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
  onSupplyTarget: (target: SupplyTarget) => void;
}) {
  return (
    <FuelDashboard
      snapshot={snapshot}
      theme={theme}
      onSupplyTarget={onSupplyTarget}
    >
      <Outages snapshot={snapshot} />
    </FuelDashboard>
  );
}
