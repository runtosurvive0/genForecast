import { useState } from "react";
import { Ship } from "lucide-react";
import type { Stockpile } from "@/data/control-tower";
import { pileRisk, weightedCalorific } from "@/domain/control-tower";
import { BASE_TIME } from "@/domain/operations";
import { date as fmtDate, number as n } from "@/lib/format";
import { PileDetail } from "./PileDetail";
import type { LinkState, SupplyRecords } from "./integrations";
import {
  BERTHS,
  DAYS_STATUS_LABEL,
  YARD_NAMES,
  supplyCumulative,
  transferTons,
  yardShortName,
  type BerthRecommendation,
  type BerthStatus,
  type GroupForecast,
  type HistoryEntry,
  type SimTransfer,
  type SiteVessel,
  type SupplyVesselRecord,
} from "./stockyard-domain";

export type PanelTab = "vessel" | "yard" | "pile";
const TABS: { id: PanelTab; label: string }[] = [
  { id: "vessel", label: "선박" },
  { id: "yard", label: "처" },
  { id: "pile", label: "Pile" },
];
const YARDS = ["P1", "P2", "P3"] as const;
/** datetime-local 값(KST) ↔ ISO 8601. */
const toLocal = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 16);
const fromLocal = (value: string) => `${value}:00+09:00`;

export function SitePanel(props: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  vessels: SiteVessel[];
  activeVessel: SiteVessel | null;
  onSelectVessel: (id: string) => void;
  berths: BerthStatus[];
  recommendFor: (voyageId: string) => BerthRecommendation;
  assignedBerths: Record<string, string>;
  onAssign: (voyageId: string, berthId: string) => void;
  onUnassign: (voyageId: string) => void;
  supply: LinkState<SupplyRecords> & { refresh: () => Promise<void> };
  onRegisterVessel: (vessel: SiteVessel) => Promise<void>;
  onCorrectUnloading: (record: SupplyVesselRecord, cumulative: number) => Promise<void>;
  yardForecasts: GroupForecast[];
  activeYard: string;
  onSelectYard: (yard: string) => void;
  transfers: SimTransfer[];
  transferCapacity: number;
  onApplyTransfer: (transfer: Omit<SimTransfer, "id">) => void;
  onUndoTransfer: (id: string) => void;
  onSaveTransfer: (id: string) => Promise<void>;
  unitNames: Record<string, string>;
  activePile: Stockpile | null;
  pileEntries: HistoryEntry[];
  eligibleNames: string;
  onShowInLedger: () => void;
}) {
  const { tab, onTab } = props;
  return (
    <aside className="stockyard-site-side">
      <div className="site-panel-tabs" role="tablist" aria-label="상세 패널">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`site-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`site-tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              const next =
                e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
              if (next >= 0) {
                e.preventDefault();
                onTab(TABS[next].id);
                document.getElementById(`site-tab-${TABS[next].id}`)?.focus();
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="site-tabpanel"
        role="tabpanel"
        id={`site-tabpanel-${tab}`}
        aria-labelledby={`site-tab-${tab}`}
      >
        {tab === "vessel" && <VesselTab {...props} />}
        {tab === "yard" && <YardTab {...props} />}
        {tab === "pile" && <PileTab {...props} />}
      </div>
    </aside>
  );
}

function VesselTab({
  vessels,
  activeVessel: active,
  onSelectVessel,
  berths,
  recommendFor,
  assignedBerths,
  onAssign,
  onUnassign,
  supply,
  onRegisterVessel,
  onCorrectUnloading,
}: Parameters<typeof SitePanel>[0]) {
  const [draftBerth, setDraftBerth] = useState<Record<string, string>>({});
  const [cumulative, setCumulative] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const rec = active ? recommendFor(active.voyage.voyage_id) : null;
  const draft = active ? (draftBerth[active.voyage.voyage_id] ?? active.berth_id) : "BD-1";
  const record =
    active && supply.data
      ? (supply.data.vessels.find((v) => v.name === active.voyage.vessel_name) ?? null)
      : null;
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="site-side-heading">
        접안·대기 선박 <span>{vessels.length}척</span>
      </div>
      <div className="site-ship-list" aria-label="약도에서 선박 선택">
        {vessels.map((v) => (
          <button
            key={v.voyage.voyage_id}
            aria-pressed={active?.voyage.voyage_id === v.voyage.voyage_id}
            onClick={() => onSelectVessel(v.voyage.voyage_id)}
          >
            <Ship />
            <span>{v.voyage.vessel_name}</span>
            <small>{v.state === "unloading" ? `하역 ${v.berth_id}` : `대기 ${v.waitH}h`}</small>
          </button>
        ))}
        {!vessels.length && <p>도착한 당진행 선박이 없습니다.</p>}
      </div>
      {active && rec && (
        <div className="site-ship-detail" aria-live="polite">
          <div className="site-ship-detail-name">
            <strong>{active.voyage.vessel_name}</strong>
            <span>
              {active.state === "unloading" ? "하역중" : "해상 대기"} · {active.berth_id} →{" "}
              {YARD_NAMES[berths.find((b) => b.berth_id === active.berth_id)?.plant_yard ?? ""] ?? "-"}
            </span>
          </div>
          <div>
            <span>물량</span>
            <b>{n(active.voyage.cargo_t)} t</b>
          </div>
          <div>
            <span>탄종 · 열량</span>
            <b>
              {active.voyage.coal_type} · {n(active.voyage.calorific_value_kcal_kg)}
            </b>
          </div>
          <div>
            <span>대기 · h</span>
            <b>{active.waitH}</b>
          </div>
          <div>
            <span>접안 예정 · KST</span>
            <b>{fmtDate(active.berthAt, true)}</b>
          </div>
          <div>
            <span>체선료 · $</span>
            <b>{n(active.demurrageUsd)}</b>
          </div>
          <div>
            <span>AIS 최신성</span>
            <b>
              <span className="tower-tag">{active.freshnessLabel}</span>
            </b>
          </div>
          <div className="site-ship-rec">
            <span className="tower-tag">추천 {rec.berth_id}</span>
            <small>{rec.reason}</small>
          </div>
          <div className="site-ship-assign">
            <select
              aria-label={`${active.voyage.vessel_name} 접안 부두`}
              value={draft}
              onChange={(e) =>
                setDraftBerth((prev) => ({ ...prev, [active.voyage.voyage_id]: e.target.value }))
              }
            >
              {BERTHS.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === rec.berth_id ? " (추천)" : ""}
                </option>
              ))}
            </select>
            <button onClick={() => onAssign(active.voyage.voyage_id, draft)}>접안 지정</button>
          </div>
          {active.voyage.voyage_id in assignedBerths && (
            <div className="site-sim-note">
              <em className="sim-badge">모의 적용</em>
              <small>저장되지 않음 · 하역분 귀속과 처 전망에 반영</small>
              <button onClick={() => onUnassign(active.voyage.voyage_id)}>되돌리기</button>
            </div>
          )}
          <div className="site-ledger-link">
            <span>하역 원장 · /api/supply</span>
            {supply.status === "checking" ? (
              <b>확인 중…</b>
            ) : supply.status === "offline" ? (
              <b className="is-offline">미연결 · {supply.error}</b>
            ) : record ? (
              <>
                <b>
                  원장 #{record.id} · 누적 {n(supplyCumulative(record, new Date().toISOString()))} /{" "}
                  {n(record.cargo)} t
                </b>
                <div className="site-ship-assign">
                  <input
                    aria-label="누적 하역량 보정"
                    type="number"
                    min={0}
                    placeholder="누적 하역량 · t"
                    value={cumulative}
                    onChange={(e) => setCumulative(e.target.value)}
                  />
                  <button
                    disabled={busy || !cumulative}
                    onClick={() =>
                      run(() => onCorrectUnloading(record, Number(cumulative)), "누적 하역량을 저장했습니다")
                    }
                  >
                    보정 저장
                  </button>
                </div>
              </>
            ) : (
              <>
                <b>원장 미등록</b>
                <button
                  disabled={busy}
                  onClick={() => run(() => onRegisterVessel(active), "하역 원장에 등록했습니다")}
                >
                  원장 등록
                </button>
              </>
            )}
            {message && <small role="status">{message}</small>}
          </div>
        </div>
      )}
    </>
  );
}

function YardTab({
  yardForecasts,
  activeYard,
  onSelectYard,
  berths,
  transfers,
  transferCapacity,
  onApplyTransfer,
  onUndoTransfer,
  onSaveTransfer,
  supply,
  unitNames,
}: Parameters<typeof SitePanel>[0]) {
  const [draft, setDraft] = useState({
    tons: 5000,
    to: "P3",
    at: toLocal(BASE_TIME),
    note: "",
  });
  const [message, setMessage] = useState("");
  const forecast = yardForecasts.find((f) => f.group.yard === activeYard) ?? null;
  const piles = forecast?.group.piles ?? [];
  const berth = berths.find((b) => b.plant_yard === activeYard);
  const last = transfers.at(-1) ?? null;
  const lastCheck = last ? transferTons(last.tons, transferCapacity) : null;
  const to = draft.to === activeYard ? YARDS.find((y) => y !== activeYard)! : draft.to;
  return (
    <>
      <div className="site-yard-chooser" role="group" aria-label="처 선택">
        {yardForecasts.map((f) => (
          <button
            key={f.group.id}
            aria-pressed={f.group.yard === activeYard}
            onClick={() => f.group.yard && onSelectYard(f.group.yard)}
          >
            <i className={`days-dot is-${f.status}`} />
            {f.group.label}
          </button>
        ))}
      </div>
      {forecast && (
        <div className="site-yard-detail" aria-live="polite">
          <div className="site-ship-detail-name">
            <strong>
              {YARD_NAMES[activeYard]}{" "}
              <span className={`days-pill is-${forecast.status}`}>{DAYS_STATUS_LABEL[forecast.status]}</span>
            </strong>
            <span>
              {berth?.berth_id ?? "-"} 연결 ·{" "}
              {forecast.group.unitIds.length
                ? forecast.group.unitIds.map((id) => unitNames[id] ?? id).join(", ")
                : "소속 호기 표본 없음"}
            </span>
          </div>
          <div>
            <span>재고</span>
            <b>{n(forecast.currentTons)} t</b>
          </div>
          <div>
            <span>가중 열량</span>
            <b>
              {n(
                weightedCalorific(
                  piles.map((p) => ({ tons: p.on_hand_t, cv: p.calorific_value_kcal_kg })),
                ) ?? 0,
              )}{" "}
              kcal/kg
            </b>
          </div>
          <div>
            <span>재고일수 (현재)</span>
            <b>{forecast.currentDays === null ? "소비 없음" : `${n(forecast.currentDays, 1)}일`}</b>
          </div>
          <div>
            <span>기간 최저 일수</span>
            <b className={`days-text is-${forecast.status}`}>
              {forecast.minDays
                ? `${n(forecast.minDays.days, 1)}일 · ${forecast.minDays.date.slice(5).replace("-", "/")}`
                : "-"}
            </b>
          </div>
          <div>
            <span>소진 예상</span>
            <b>{forecast.firstShortageDate?.slice(5).replace("-", "/") ?? "기간 내 없음"}</b>
          </div>
          <div>
            <span>Pile · 고위험</span>
            <b>
              {piles.length}개 · {piles.filter((p) => pileRisk(p).label === "높음").length}개
            </b>
          </div>
        </div>
      )}
      <div className="site-side-heading">처 간 이탄</div>
      <div className="stockyard-transfer">
        <label>
          이송량 · t
          <input
            aria-label="이송량 입력"
            type="number"
            min={0}
            value={draft.tons}
            onChange={(e) => setDraft((d) => ({ ...d, tons: Number(e.target.value) }))}
          />
        </label>
        <label>
          출발
          <select aria-label="출발 발전처" value={activeYard} onChange={(e) => onSelectYard(e.target.value)}>
            {YARDS.map((y) => (
              <option key={y} value={y}>
                {YARD_NAMES[y]}
              </option>
            ))}
          </select>
        </label>
        <label>
          도착
          <select
            aria-label="도착 발전처"
            value={to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          >
            {YARDS.filter((y) => y !== activeYard).map((y) => (
              <option key={y} value={y}>
                {YARD_NAMES[y]}
              </option>
            ))}
          </select>
        </label>
        <label>
          시각 · KST
          <input
            aria-label="이탄 시각"
            type="datetime-local"
            value={draft.at}
            onChange={(e) => setDraft((d) => ({ ...d, at: e.target.value }))}
          />
        </label>
        <label className="is-wide">
          비고
          <input
            aria-label="이탄 비고"
            maxLength={300}
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
        </label>
        <button
          onClick={() => {
            setMessage("");
            onApplyTransfer({
              from: activeYard,
              to,
              tons: draft.tons,
              at: draft.at ? fromLocal(draft.at) : BASE_TIME,
              note: draft.note,
            });
          }}
        >
          이탄 적용
        </button>
      </div>
      {last && lastCheck && (
        <p className="stockyard-transfer-result">
          적용 이송 {last.from} → {last.to} · {n(lastCheck.tons)} t (가용 {n(lastCheck.capacity)} t)
          {lastCheck.overCapacity && <strong> · 가용 초과, 경고 (차단하지 않음)</strong>}
        </p>
      )}
      {transfers.length > 0 && (
        <ul className="site-transfer-list">
          {transfers.map((t) => (
            <li key={t.id}>
              <span>
                {yardShortName(t.from)} → {yardShortName(t.to)} · {n(t.tons)} t ·{" "}
                {fmtDate(t.at, true)}
                {t.note ? ` · ${t.note}` : ""}
              </span>
              {t.savedId ? (
                <em className="saved-badge">원장 #{t.savedId}</em>
              ) : (
                <>
                  <em className="sim-badge">모의 적용</em>
                  {supply.status === "online" && (
                    <button
                      onClick={async () => {
                        setMessage("");
                        try {
                          await onSaveTransfer(t.id);
                          setMessage("이탄 원장에 저장했습니다");
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : String(error));
                        }
                      }}
                    >
                      원장 저장
                    </button>
                  )}
                  <button onClick={() => onUndoTransfer(t.id)}>되돌리기</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="site-link-line">
        이탄 원장 · /api/supply{" "}
        {supply.status === "online"
          ? "연결됨"
          : supply.status === "checking"
            ? "확인 중…"
            : `미연결 (${supply.error}) · 화면 모의만 적용`}
        <button onClick={() => void supply.refresh()}>다시 확인</button>
      </p>
      {message && (
        <p className="site-link-line" role="status">
          {message}
        </p>
      )}
    </>
  );
}

function PileTab({
  activePile,
  pileEntries,
  eligibleNames,
  onShowInLedger,
}: Parameters<typeof SitePanel>[0]) {
  if (!activePile)
    return <p className="site-empty">약도나 원장에서 Pile을 선택하면 탄질·센서·하역 이력이 여기에 표시됩니다.</p>;
  return (
    <>
      <h3 className="site-pile-title">
        {activePile.stockpile_id} · {activePile.coal_type}
      </h3>
      <PileDetail pile={activePile} entries={pileEntries} eligibleNames={eligibleNames} compact />
      <button className="site-link-button" onClick={onShowInLedger}>
        원장에서 보기 →
      </button>
    </>
  );
}
