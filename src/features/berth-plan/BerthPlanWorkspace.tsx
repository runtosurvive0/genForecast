// 통합 시뮬레이션 "접안 추천" 탭. 백엔드 접안 추천(읽기 전용) 결과를 카드·간트·표로 보인다.
// 실패·빈 값은 그대로 알린다: 합성 값이나 0으로 대신하지 않는다.
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { defaultOptionId, reasonLabel, type BerthAssignment, type BerthKpis, type BerthOption, type BerthPlanResult } from "@/domain/berth-plan";
import { fetchBerthPlan } from "@/domain/berth-plan-api";
import { fetchStacking } from "@/domain/stacking-api";
import type { StackingResult } from "@/domain/stacking";
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { StackingOptions } from "@/components/stacking/StackingOptions";
import { number as n } from "@/lib/format";
import { BerthGantt, kstLabel, yardClass } from "./BerthGantt";
import "./berth-plan.css";

const HORIZONS = [7, 14, 30] as const;
const DEFAULT_PENALTY = 20000;
const CURRENT_ID = "current";
const UNKNOWN = "미확인";

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "알 수 없는 오류");
const signedUsd = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : "±"}${n(Math.abs(v))} USD`;
const days = (v: number | null) => (v === null ? UNKNOWN : `${n(v, 1)}일`);
const count = (v: number | null) => (v === null ? UNKNOWN : `${n(v)}일`);

/** 현재 계획을 카드·간트가 같이 쓰는 안 모양으로 맞춘다. */
function currentOption(r: BerthPlanResult): BerthOption | null {
  if (!r.current) return null;
  return { id: CURRENT_ID, rank: 0, label: r.current.label, merged: [], status: "optimal", gap_pct: null, message: null, kpis: r.current.kpis, warnings: [], assignments: r.current.assignments };
}

function Kpis({ kpis, current }: { kpis: BerthKpis; current: boolean }) {
  return (
    <dl className="gf-bp-kpis">
      <div><dt>체선</dt><dd>{n(kpis.demurrage_hours, 0)}시간 · {n(kpis.demurrage_usd)} USD</dd></div>
      <div><dt>최저 재고일수</dt><dd>{days(kpis.min_days)}</dd></div>
      <div><dt>주의 · 위험</dt><dd>{count(kpis.caution_days)} · {count(kpis.danger_days)}</dd></div>
      {!current && kpis.demurrage_usd_delta !== undefined && <div><dt>현재 대비 체선료</dt><dd>{signedUsd(kpis.demurrage_usd_delta)}</dd></div>}
    </dl>
  );
}

function OptionCard({ option, selected, onSelect }: { option: BerthOption; selected: boolean; onSelect: () => void }) {
  const current = option.id === CURRENT_ID;
  return (
    <button type="button" className={`gf-bp-card${current ? " gf-bp-card-current" : ""}`} aria-pressed={selected} onClick={onSelect}>
      <span className="gf-bp-card-head">
        <strong className="gf-bp-card-title">{option.label}</strong>
        {option.rank === 1 && <span className="gf-bp-badge">추천</span>}
      </span>
      {option.status === "infeasible" || !option.kpis ? (
        <span className="gf-bp-card-infeasible">
          <strong>해 없음</strong>
          {option.message && <span>{option.message}</span>}
        </span>
      ) : (
        <Kpis kpis={option.kpis} current={current} />
      )}
      {option.status === "time_limit" && (
        <span className="gf-bp-card-note">{option.gap_pct === null ? "최선해 · 차이 미확인" : `최선해 · 차이 ${n(option.gap_pct, 1)}%`}</span>
      )}
      {option.warnings.map(w => <span key={w} className="gf-bp-card-warn">{w}</span>)}
    </button>
  );
}

type StackState = { status: "loading" } | { status: "done"; result: StackingResult } | { status: "error"; message: string };

function StackingRow({ voyageNo, colSpan }: { voyageNo: string; colSpan: number }) {
  const [state, setState] = useState<StackState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchStacking({ voyage_no: voyageNo }, controller.signal)
      .then(result => setState({ status: "done", result }))
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: "error", message: errorText(e) }); });
    return () => controller.abort();
  }, [voyageNo]);
  return (
    <tr className="gf-bp-stack-row">
      <td colSpan={colSpan}>
        {state.status === "loading" && <ProcessingOrb state="solving" label="적치 추천 계산 중" />}
        {state.status === "error" && <p className="gf-bp-error-inline">적치 추천을 불러오지 못했습니다: {state.message}</p>}
        {state.status === "done" && <StackingOptions result={state.result} compact />}
      </td>
    </tr>
  );
}

const COLUMNS = ["항차번호", "선박", "저탄장", "물량", "ETA", "부두", "접안", "하역완료", "체선", "원인", "변경", "적치"];

function AssignmentTable({ option, open, onToggle }: { option: BerthOption; open: Set<string>; onToggle: (no: string) => void }) {
  const current = option.id === CURRENT_ID;
  const change = (a: BerthAssignment) => (a.fixed ? "고정" : current ? "—" : a.changed ? "변경" : "유지");
  const demurrage = (a: BerthAssignment) => {
    if (a.fixed) return "—";
    if (a.demurrage_hours === null && a.demurrage_usd === null) return UNKNOWN;
    return `${a.demurrage_hours === null ? UNKNOWN : `${n(a.demurrage_hours)}시간`} · ${a.demurrage_usd === null ? UNKNOWN : `${n(a.demurrage_usd)} USD`}`;
  };
  return (
    <div className="gf-bp-table-scroll">
      <table className="gf-bp-table">
        <caption className="sr-only">{option.label} 항차별 배정</caption>
        <thead><tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {option.assignments.map(a => (
            <Fragment key={a.voyage_no}>
              <tr className={a.fixed ? "gf-bp-row-fixed" : undefined}>
                <td className="gf-bp-mono">{a.voyage_number ?? a.voyage_no}</td>
                <td>{a.vessel_name ?? UNKNOWN}</td>
                <td>{a.yard ? <span className="gf-bp-yard-cell"><i className={`gf-bp-key ${yardClass(a.yard)}`} />{a.yard}저탄장</span> : UNKNOWN}</td>
                <td className="gf-bp-num">{a.tonnes === null ? (a.fixed ? "—" : UNKNOWN) : `${n(a.tonnes)} t`}</td>
                <td className="gf-bp-mono">{a.fixed ? "—" : kstLabel(a.eta) ?? UNKNOWN}</td>
                <td>{a.berth_id ?? "미배정"}</td>
                <td className="gf-bp-mono">{kstLabel(a.berth_at) ?? "미배정"}</td>
                <td className="gf-bp-mono">{kstLabel(a.unload_end) ?? UNKNOWN}</td>
                <td className="gf-bp-num">{demurrage(a)}</td>
                <td>{a.reasons.length ? a.reasons.map(reasonLabel).join(" · ") : "—"}</td>
                <td><span className={`gf-bp-change gf-bp-change-${a.fixed ? "fixed" : a.changed && !current ? "on" : "off"}`}>{change(a)}</span></td>
                <td>
                  {!a.fixed && (
                    <button type="button" className="gf-bp-link" aria-expanded={open.has(a.voyage_no)} onClick={() => onToggle(a.voyage_no)}>적치 추천</button>
                  )}
                </td>
              </tr>
              {!a.fixed && open.has(a.voyage_no) && <StackingRow voyageNo={a.voyage_no} colSpan={COLUMNS.length} />}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BerthPlanWorkspace({ theme }: { theme: "light" | "dark" }) {
  const [horizon, setHorizon] = useState<number>(14);
  const [penalty, setPenalty] = useState(String(DEFAULT_PENALTY));
  const [inputError, setInputError] = useState("");
  const [result, setResult] = useState<BerthPlanResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openStacking, setOpenStacking] = useState<Set<string>>(() => new Set());
  const controller = useRef<AbortController | null>(null);
  const penaltyId = useId();

  const run = useCallback((body: { horizon_days: number; penalty_usd: number }) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true); setError(""); setResult(null); setOpenStacking(new Set());
    // signal을 넘겨 authJson 기본 15초 제한을 끈다(안마다 최대 30초 풀이).
    fetchBerthPlan(body, current.signal)
      .then(r => { setResult(r); setSelectedId(defaultOptionId(r) ?? (r.current ? CURRENT_ID : null)); })
      .catch((e: unknown) => { if (!current.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (controller.current === current) setLoading(false); });
  }, []);

  useEffect(() => {
    run({ horizon_days: 14, penalty_usd: DEFAULT_PENALTY });
    return () => controller.current?.abort();
  }, [run]);

  const recalc = () => {
    const value = Number(penalty);
    if (penalty.trim() === "" || !Number.isFinite(value) || value < 0) { setInputError("벌점 단가는 0 이상의 숫자로 입력하세요"); return; }
    setInputError("");
    run({ horizon_days: horizon, penalty_usd: value });
  };

  const cards = useMemo(() => {
    if (!result) return [];
    const now = currentOption(result);
    return [...(now ? [now] : []), ...[...result.options].sort((a, b) => a.rank - b.rank)];
  }, [result]);
  const selected = cards.find(c => c.id === selectedId) ?? null;
  const toggleStacking = (no: string) => setOpenStacking(prev => {
    const next = new Set(prev);
    if (next.has(no)) next.delete(no); else next.add(no);
    return next;
  });

  return (
    <section className="gf-bp-page" aria-label="접안 추천">
      <div className="gf-bp-bar-row">
        <form className="gf-bp-query" noValidate onSubmit={e => { e.preventDefault(); recalc(); }}>
          <span className="gf-bp-asof">기준시각 <strong>{result ? `${kstLabel(result.as_of) ?? UNKNOWN} KST` : loading ? "계산 중" : "—"}</strong></span>
          <label className="gf-bp-field">
            <span>기간</span>
            <select aria-label="기간" value={horizon} onChange={e => setHorizon(Number(e.target.value))} disabled={loading}>
              {HORIZONS.map(h => <option key={h} value={h}>{h}일</option>)}
            </select>
          </label>
          <span className="gf-bp-field">
            <label htmlFor={penaltyId}>벌점 단가 (USD/그룹·일)</label>
            <input id={penaltyId} type="number" inputMode="numeric" min={0} step={1000} value={penalty} onChange={e => setPenalty(e.target.value)} disabled={loading} aria-invalid={Boolean(inputError)} />
            <span className="gf-bp-tag">가정값</span>
          </span>
          <button type="submit" className="gf-bp-run" disabled={loading}>다시 계산</button>
        </form>
        <p className="gf-bp-assume">부두 능력 시연용 가정값</p>
      </div>
      {inputError && <p className="gf-bp-error-inline" role="alert">{inputError}</p>}

      {loading && <div className="gf-bp-loading"><ProcessingOrb theme={theme} state="solving" label="접안 계획 계산 중 · 안마다 최대 30초" size={32} /></div>}
      {error && <p className="gf-bp-error" role="alert">접안 추천을 계산하지 못했습니다: {error}</p>}

      {result && (
        <>
          {result.message && <p className="gf-bp-empty" role="status">{result.message}</p>}
          {cards.length > 0 && (
            <div className="gf-bp-cards" role="group" aria-label="접안 안 비교">
              {cards.map(c => <OptionCard key={c.id} option={c} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />)}
            </div>
          )}
          {selected && (
            <>
              <BerthGantt result={result} option={selected} theme={theme} />
              {selected.assignments.length > 0
                ? <AssignmentTable option={selected} open={openStacking} onToggle={toggleStacking} />
                : <p className="gf-bp-muted">이 안에 배정된 항차가 없습니다.</p>}
            </>
          )}
          <details className="gf-bp-notes">
            <summary>가정·빠진 자료</summary>
            <ul>
              {result.assumptions.map(a => <li key={`a-${a}`}>{a}</li>)}
              {result.gaps.map((g, i) => <li key={`g-${i}`} className="gf-bp-gap">{g.voyage_no ? `${g.voyage_no}: ${g.message}` : g.message}</li>)}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
