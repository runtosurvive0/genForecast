import { useState, type ReactNode } from "react";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { RefreshCw, CalendarClock, TriangleAlert, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { Section } from "./tower/primitives";
import { addDays, type PlanningSnapshot } from "../domain/planning";
import { sourceDescription } from "../domain/source-description";
import { planLabel } from "../domain/planning-labels";
import {
  initialPlanningQuery,
  type PlanningState,
} from "../domain/use-planning";
import "./planning-workspace.css";
import { ForecastStockConditions } from './ForecastStockConditions';

export function PlanningWorkspace({
  state,
  children,
  onOpenInputs,
  onOpenPurchasing,
  renderInputs,
}: {
  state: PlanningState;
  children: (snapshot: PlanningSnapshot) => ReactNode;
  onOpenInputs?: () => void;
  onOpenPurchasing?: () => void;
  renderInputs?: (onResult: (run: {id: string; start: string; end: string}) => void) => ReactNode;
}) {
  const [tab, setTab] = useState<'conditions' | 'results'>('results');
  const [inputsVisited, setInputsVisited] = useState(false);
  const openInputs = () => { setInputsVisited(true); setTab('conditions'); };
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
  const ready = !failed && !listLoading && !loading && current ? current : null;
  return (
    <div className="tower-page midterm-page">
      {renderInputs && <section className="gf-forecast-navigation" aria-label="전망이 만들어지는 과정">
        <p>저장된 수요·정비·단가 → 발전계획 계산 → 연료 사용량·저탄장 재고 전망</p>
        <div role="tablist" aria-label="전망 작업"><button role="tab" id="forecast-conditions-tab" aria-controls="forecast-conditions" aria-selected={tab === 'conditions'} onClick={openInputs}>조건 설정</button><button role="tab" id="forecast-results-tab" aria-controls="forecast-results" aria-selected={tab === 'results'} onClick={()=>setTab('results')}>전망 결과</button></div>
      </section>}
      {renderInputs && <div id="forecast-conditions" role="tabpanel" aria-labelledby="forecast-conditions-tab" hidden={tab !== 'conditions'}>{inputsVisited && renderInputs(run => { setQuery(initialPlanningQuery({...run, name:'', period:`${run.start} ~ ${run.end}`})); refresh(); setTab('results'); })}</div>}
      {(!renderInputs || tab === 'results') && <div className="gf-forecast-results" id="forecast-results" role={renderInputs ? 'tabpanel' : undefined} aria-labelledby={renderInputs ? 'forecast-results-tab' : undefined}>
      {!renderInputs && onOpenInputs && <section className="gf-planning-flow" aria-label="전망이 만들어지는 과정">
        <div className="gf-planning-flow-heading"><div><h2>전망이 만들어지는 과정</h2><p>입력한 조건으로 발전계획을 계산하고, 재고와 입하를 함께 살펴봅니다.</p></div><button type="button" onClick={onOpenInputs}>계산 입력·실행 <ArrowRight size={15} aria-hidden="true" /></button></div>
        <ol className="gf-planning-steps">
          <li><strong>수요·정비·단가</strong><span>전망에 사용할 조건</span></li>
          <li><strong>발전계획 계산</strong><span>호기별 발전량 산출</span></li>
          <li><strong>기준재고와 입하</strong><span>계획 기준의 재고 전망</span></li>
          <li><strong>구매 검토</strong><span>부족 시점과 반입 가능 여부</span>{onOpenPurchasing && <button type="button" disabled={!current} onClick={onOpenPurchasing}>구매 검토</button>}</li>
        </ol>
        <p className="gf-planning-flow-note">이 화면은 저장된 계산을 조회합니다. 입력을 바꾼 뒤에는 새 계산을 실행해야 결과에 반영됩니다.</p>
      </section>}
      <section className="gf-planning-query" aria-label="조회 조건">
      <div className="midterm-controls">
        <label>
          조회할 발전계획
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
                {planLabel({ name: r.name, run_id: r.id, start: r.start, end: r.end })}
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
      </div>
      {ready && <div className="gf-planning-query-strip">
        <div className="tower-context midterm-source">
          <div>
            <span className="tower-tag">
              {ready.classification === "functional_demo"
                ? "가정 입력 기반 전망"
                : "저장된 발전계획"}
            </span>
            <span>당진 1~10호기 · 계획 시점 수급</span>
          </div>
          <span>
            {ready.start} ~ {ready.end} · KST
          </span>
        </div>
        <ForecastStockConditions key={ready.run_id} snapshot={ready} onSaved={refresh} />
      </div>}
      </section>
      {failed ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>발전계획을 불러오지 못했습니다.</strong>
            <p>{failed}</p>
            <p>서버 연결과 선택한 계산 기간을 확인한 뒤 새로고침하세요.</p>
          </div>
        </div>
      ) : listLoading || loading || (query && !current) ? (
        <div className="gf-planning-loading">
          <ProcessingOrb state="searching" label="저장된 발전·수급 전망을 불러오는 중" className="gf-planning-loading__text" />
          <div className="gf-planning-loading__metrics" aria-hidden="true"><i /><i /><i /></div>
          <div className="gf-planning-loading__chart" aria-hidden="true" />
        </div>
      ) : !current ? (
        <div className="midterm-empty">
          저장된 발전계획이 없습니다. 계산 입력을 준비하고 실행해 주세요.
          {renderInputs && <Button onClick={openInputs}>조건 설정</Button>}
        </div>
      ) : (
        <>
          {children(current)}
          <div id="gf-forecast-sources"><details className="gf-forecast-details"><summary><strong>자료·계산 기준</strong><span>기준시각 · 입력 출처 · 확인사항 {current.issues.length}건</span></summary><Section title="자료 확인사항">
            <p className="gf-planning-basis">재고 기준: {current.start} 00:00 KST. 왼쪽 현재 재고와 기준시각이 다를 수 있습니다. 사용량은 1저탄장 1~4호기, 2저탄장 5~8호기, 3저탄장 9~10호기 계획을 기준으로 계산합니다.</p>
            <p className="tower-footnote">계산 ID {current.run_id} · 결과 저장 {current.generated_at.slice(0,16).replace('T',' ')} KST</p>
            {current.classification_note && <p className="tower-footnote">{sourceDescription(current.classification_note)}</p>}
            <ul className="midterm-issues">
              {current.issues.map((issue, i) => (
                <li key={i}>{sourceDescription(issue)}</li>
              ))}
            </ul>
            <p className="tower-footnote">{current.fuel_method}</p>
          </Section></details></div>
          <div className="midterm-footer">
            <CalendarClock size={14} /> 저장된 계획 조회 · 현재 운전 실적과 구분
            · 발전소 종합과 저탄장은 같은 수급 결과를 사용합니다.
          </div>
        </>
      )}
      </div>}
    </div>
  );
}
