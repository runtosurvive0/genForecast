import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw, CalendarClock, TriangleAlert } from "lucide-react";
import { Button } from "../../components/ui/button";
import { FuelDashboard } from "./FuelDashboard";
import {
  addDays,
  loadPlanningRuns,
  loadPlanningSnapshot,
  type PlanningRun,
  type PlanningSnapshot,
} from "../../domain/planning";
import "./midterm.css";

const initialQuery = (run: PlanningRun) => ({
  runId: run.id,
  start: run.start,
  horizon: addDays(run.start, 29) <= run.end ? 30 : 7,
});
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

function Results({
  snapshot,
  theme,
}: {
  snapshot: PlanningSnapshot;
  theme: string;
}) {
  return (
    <FuelDashboard snapshot={snapshot} theme={theme}>
      <Outages snapshot={snapshot} />
    </FuelDashboard>
  );
}

export function MidtermDashboard({ theme }: { theme: string }) {
  const [runs, setRuns] = useState<PlanningRun[]>([]);
  const [query, setQuery] = useState<{
    runId: string;
    start: string;
    horizon: number;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError("");
    loadPlanningRuns(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setRuns(rows);
        setQuery((current) =>
          current && rows.some((r) => r.id === current.runId)
            ? current
            : rows[0]
              ? initialQuery(rows[0])
              : null,
        );
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setListError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSnapshot(null);
    loadPlanningSnapshot(
      query.runId,
      query.start,
      query.horizon,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  const selected = runs.find((r) => r.id === query?.runId);
  const current =
    snapshot &&
    query &&
    snapshot.run_id === query.runId &&
    snapshot.start === query.start &&
    snapshot.horizon_days === query.horizon
      ? snapshot
      : null;
  const failed = listError || error;
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
              setQuery(initialQuery(r));
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
          onClick={() => setRevision((n) => n + 1)}
          disabled={loading || listLoading}
        >
          <RefreshCw size={14} />
          새로고침
        </Button>
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
              <span>당진 1~10호기</span>
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
          <Results snapshot={current} theme={theme} />
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
            · 모든 패널은 같은 계산 결과를 사용합니다.
          </div>
        </>
      )}
    </div>
  );
}
