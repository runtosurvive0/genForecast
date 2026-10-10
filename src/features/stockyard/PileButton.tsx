import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Stockpile } from "@/data/control-tower";
import { pileRisk } from "@/domain/control-tower";
import { BASE_TIME } from "@/domain/operations";
import { date as fmtDate, number as n } from "@/lib/format";
import { pileFootprint, type HistoryEntry } from "./stockyard-domain";

const riskClass = (label: string) =>
  label === "높음" ? "high" : label === "관찰" ? "medium" : "low";

export function PileHistory({ entries }: { entries: HistoryEntry[] }) {
  return entries.length ? (
    <ul className="pile-history-entries">
      {entries.map((entry) => (
        <li key={entry.voyage_id}>
          <div>
            <strong>{entry.vessel_name}</strong>
            <span>
              {Date.parse(entry.unloaded_at) > Date.parse(BASE_TIME)
                ? "하역 예정"
                : "하역 완료"}
            </span>
          </div>
          <p>
            {fmtDate(entry.unloaded_at, true)} KST · {n(entry.tons)} t
          </p>
          <p>
            {entry.coal_type} · {n(entry.calorific_value_kcal_kg)} kcal/kg
          </p>
          <small>
            수분 {entry.moisture_pct}% · 회분 {entry.ash_pct}% · 황분{" "}
            {entry.sulfur_pct}%
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="pile-history-empty">등록된 하역 이력·예정이 없습니다.</p>
  );
}

/**
 * 약도용 Pile: 재고 비례 둔덕 + 번호 + 하역 이력 건수 배지.
 * 마우스오버·포커스 시 탄질과 하역 이력·예정을 툴팁으로 보여준다.
 */
export function PileButton({
  pile,
  entries,
  selected,
  restricted,
  maxTons,
  dimmed = false,
  receiving = false,
  tabIndex,
  onSelect,
}: {
  pile: Stockpile;
  entries: HistoryEntry[];
  selected: boolean;
  restricted: boolean;
  maxTons: number;
  /** 위험도 필터에 맞지 않는 Pile: 자리는 유지하고 흐리게. */
  dimmed?: boolean;
  /** 선택한 선박의 하역분이 귀속되는 Pile. */
  receiving?: boolean;
  /** 약도 방향키 이동(roving tabindex)용. 없으면 기본 탭 순서. */
  tabIndex?: number;
  onSelect: () => void;
}) {
  const risk = pileRisk(pile);
  const size = pileFootprint(pile.on_hand_t, maxTons);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = () => {
    cancelClose();
    setAnchor(null);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(close, 150);
  };
  const show = () => {
    cancelClose();
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      left: Math.max(
        12,
        Math.min(rect.left + rect.width / 2 - 150, window.innerWidth - 312),
      ),
      top: rect.top > 330 ? rect.top - 8 : rect.bottom + 8,
      above: rect.top > 330,
    });
  };
  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);
  return (
    <>
      <button
        ref={button}
        className={`yard-pile risk-${riskClass(risk.label)}${
          dimmed ? " is-dimmed" : ""
        }${receiving ? " is-receiving" : ""}`}
        aria-pressed={selected}
        aria-describedby={anchor ? id : undefined}
        tabIndex={tabIndex}
        data-pile-id={pile.stockpile_id}
        style={
          {
            "--pile-grow": size.grow,
            "--pile-height": size.height,
          } as CSSProperties
        }
        onClick={onSelect}
        onMouseEnter={show}
        onMouseLeave={closeSoon}
        onFocus={show}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <span className="pile-mound" aria-hidden="true">
          <svg viewBox="0 0 100 42" preserveAspectRatio="none">
            <ellipse cx="50" cy="37" rx="49" ry="5" className="pile-ground" />
            <path
              d="M3 37 16 27 30 14 46 4 60 9 74 22 97 37 66 41 30 41Z"
              className="pile-body"
            />
            <path d="M3 37 30 14 46 4 39 24 30 41Z" className="pile-lit" />
            <path d="M46 4 60 9 74 22 97 37 66 41 55 23Z" className="pile-shade" />
            <path
              d="m18 32 12-6m4-9 6-3m13 6 7 5m3 7 11 4m-40 1 9-5"
              className="pile-grain"
            />
          </svg>
        </span>
        <span className="pile-label">
          <span className="pile-label-prefix">
            {pile.stockpile_id.split("-")[0]}-
          </span>
          {pile.stockpile_id.split("-").slice(1).join("-")}
        </span>
        {entries.length > 0 && (
          <span className="pile-badge" aria-hidden="true">
            ↓{entries.length}
          </span>
        )}
        <span className="yard-pile-sr">
          {n(pile.on_hand_t)} t · {risk.label}
          {restricted ? " · 혼탄" : ""}
          {pile.indoor ? " · 옥내" : ""} · 하역 이력·예정 {entries.length}건
        </span>
      </button>
      {anchor &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="pile-history-tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={closeSoon}
            style={{
              left: anchor.left,
              top: anchor.top,
              transform: anchor.above ? "translateY(-100%)" : undefined,
            }}
          >
            <header>
              <strong>
                {pile.stockpile_id} · {pile.coal_type}
              </strong>
              <span className={`pile-risk-tag risk-${riskClass(risk.label)}`}>
                {risk.label} {risk.score}
              </span>
            </header>
            <dl className="pile-history-summary">
              <div>
                <dt>재고</dt>
                <dd>{n(pile.on_hand_t)} t</dd>
              </div>
              <div>
                <dt>열량</dt>
                <dd>{n(pile.calorific_value_kcal_kg)} kcal/kg</dd>
              </div>
              <div>
                <dt>적치</dt>
                <dd>{risk.age}일</dd>
              </div>
              <div>
                <dt>수분 / 회분 / 황분</dt>
                <dd>
                  {pile.moisture_pct} / {pile.ash_pct} / {pile.sulfur_pct} %
                </dd>
              </div>
              <div>
                <dt>온도 · CO</dt>
                <dd>
                  {pile.temperature_c === null && pile.co_ppm === null
                    ? "센서 미연결"
                    : `${pile.temperature_c ?? "-"} ℃ · ${pile.co_ppm ?? "-"} ppm`}
                </dd>
              </div>
              <div>
                <dt>위험도 근거</dt>
                <dd>{risk.source === "SENSOR" ? "센서 + 적치·탄종" : "적치·탄종 (모의)"}</dd>
              </div>
            </dl>
            {(restricted || pile.indoor) && (
              <p className="pile-history-flags">
                {[restricted && "혼탄 전용", pile.indoor && "옥내"]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <strong className="pile-history-title">
              하역 이력·예정 {entries.length}건
            </strong>
            <PileHistory entries={entries} />
            <p className="pile-history-source">
              SIMULATED · 실효 부두의 처 안 탄종 일치 Pile에 재고 비례 배분 · 조회 기간
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
