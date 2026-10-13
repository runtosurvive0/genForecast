import type { ReactNode } from "react";
import { RefreshCw, CalendarClock, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { Section } from "./tower/primitives";
import { addDays, type PlanningSnapshot } from "../domain/planning";
import {
  initialPlanningQuery,
  type PlanningState,
} from "../domain/use-planning";
import "./planning-workspace.css";
import { InventoryPool } from "./InventoryPool";
import type { InventoryMode } from "../domain/planning";

export function PlanningWorkspace({
  state,
  children,
}: {
  state: PlanningState;
  children: (snapshot: PlanningSnapshot) => ReactNode;
}) {
  const {
    runs,
    query,
    setQuery,
    current,
    listLoading,
    loading,
    failed,
    refresh,
  } = state;
  const selected = runs.find((r) => r.id === query?.runId);
  return (
    <div className="tower-page midterm-page">
      <div className="midterm-controls">
        <label>
          저장된 MILP 계산
          <select
            aria-label="저장된 MILP 계산"
            value={query?.runId ?? ""}
            disabled={listLoading || !runs.length}
            onChange={(e) => {
              const r = runs.find((x) => x.id === e.target.value)!;
              setQuery(initialPlanningQuery(r));
            }}
          >
            {!runs.length && <option value="">계산 목록 없음</option>}
            {runs.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name} · {r.period}
              </option>
            ))}
          </select>
        </label>
        <label>
          조회 시작일 · KST
          <input
            aria-label="MILP 조회 시작일"
            type="date"
            value={query?.start ?? ""}
            min={selected?.start}
            max={
              selected && query
                ? addDays(selected.end, 1 - query.horizon)
                : undefined
            }
            disabled={!query || listLoading}
            onChange={(e) => {
              if (query && e.target.value)
                setQuery({ ...query, start: e.target.value });
            }}
          />
        </label>
        <div
          className="horizon-control"
          role="group"
          aria-label="MILP 조회 기간"
        >
          {[7, 30, 60, 90].map((days) => (
            <button
              key={days}
              aria-pressed={query?.horizon === days}
              className={query?.horizon === days ? "selected" : ""}
              disabled={
                !query ||
                !selected ||
                addDays(query.start, days - 1) > selected.end
              }
              onClick={() => query && setQuery({ ...query, horizon: days })}
            >
              {days}일
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading || listLoading}
        >
          <RefreshCw size={14} />
          새로고침
        </Button>
        <label>
          재고 전망 옵션
          <select
            aria-label="재고 전망 옵션"
            value={query?.inventoryMode ?? "assigned"}
            disabled={!query || loading}
            onChange={(e) =>
              query &&
              setQuery({
                ...query,
                inventoryMode: e.target.value as InventoryMode,
              })
            }
          >
            <option value="assigned">기본 · 확정 배정만</option>
            <option value="include_waiting">체선 포함 · 가상 접안·하역</option>
          </select>
        </label>
      </div>
      {failed ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>MILP 결과를 불러오지 못했습니다.</strong>
            <p>{failed}</p>
            <p>Python 서버와 선택한 계산 기간을 확인한 뒤 새로고침하세요.</p>
          </div>
        </div>
      ) : listLoading || loading || (query && !current) ? (
        <div className="midterm-empty" role="status">
          저장된 MILP 결과를 불러오는 중입니다…
        </div>
      ) : !current ? (
        <div className="midterm-empty">
          저장된 MILP 계산이 없습니다. Python 백엔드에 계산 결과를 등록하세요.
        </div>
      ) : (
        <>
          <div className="tower-context midterm-source">
            <div>
              <span className="tower-tag">
                {current.classification === "functional_demo"
                  ? "동작 확인용 MILP"
                  : "저장된 MILP 전망"}
              </span>
              <span>당진 1~10호기 · 계획 시점 수급</span>
            </div>
            <span>
              {current.start} ~ {current.end} · KST
            </span>
          </div>
          <details className="fuel-source-details">
            <summary>
              {current.classification === "functional_demo"
                ? "동작 확인용 계획 · 가정·정비자료 확인 필요"
                : "계산 출처·주의사항 확인"}
            </summary>
            <p>
              계산 ID {current.run_id} · 결과 저장{" "}
              {current.generated_at.slice(0, 16).replace("T", " ")} KST
            </p>
            {current.classification_note && (
              <p>{current.classification_note}</p>
            )}
          </details>
          {children(current)}
          <InventoryPool snapshot={current} />
          <Section title="자료 확인사항">
            <ul className="midterm-issues">
              {current.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
            <p className="tower-footnote">{current.fuel_method}</p>
          </Section>
          <div className="midterm-footer">
            <CalendarClock size={14} /> 저장된 계획 조회 · 현재 운전 실적과 구분
            · 발전소 종합과 저탄장은 같은 수급 결과를 사용합니다.
          </div>
        </>
      )}
    </div>
  );
}
