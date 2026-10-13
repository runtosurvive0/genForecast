import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Stockpile } from "@/data/control-tower";
import { pileRisk } from "@/domain/control-tower";
import { number as n } from "@/lib/format";
import { PileButton } from "./PileButton";
import { PlantGlyph, SeaTexture, ShipGlyph } from "./SiteArt";
import {
  BERTHS,
  DAYS_STATUS_LABEL,
  historyForPile,
  orderPiles,
  yardShortName,
  YARD_LAYOUT,
  YARD_UNIT_RANGES,
  DEFAULT_UNLOAD_TPD,
  type Attribution,
  type BerthStatus,
  type SiteVessel,
} from "./stockyard-domain";
import { inventoryStatusLabel, type InventoryGroup, type YardFeed, type YardUnload } from "./supply-view";

const YARDS = ["P1", "P2", "P3"] as const;
const STATE_LABEL: Record<BerthStatus["state"], string> = {
  unloading: "하역중",
  assigned: "접안 지정",
  empty: "빈 부두",
};

export interface LinkChip {
  label: string;
  status: "checking" | "online" | "offline";
  detail: string;
}

/**
 * 당진 항만·저탄장 약도 (SIMULATED): 해상 대기 → 부두 접안·하역 →
 * 하역 컨베이어 → 발전처별 저탄장 → 상탄 컨베이어 → 발전소.
 * 우측 패널은 `panel`로 받는다.
 */
export function StockyardSite({
  piles,
  attributions,
  vessels,
  berths,
  activeShipId,
  onSelectShip,
  selectedPileId,
  onSelectPile,
  selectedYard,
  onSelectYard,
  sort,
  riskFilter,
  unitCount,
  feeds,
  unloads,
  feedDate,
  feedSource,
  yardDeltas,
  yardForecasts,
  showSample,
  links,
  onRefreshLinks,
  panel,
  historyDays,
}: {
  piles: Stockpile[];
  attributions: Attribution[];
  vessels: SiteVessel[];
  berths: BerthStatus[];
  activeShipId: string | null;
  onSelectShip: (id: string) => void;
  selectedPileId: string | null;
  onSelectPile: (id: string) => void;
  selectedYard: string | null;
  onSelectYard: (yard: string) => void;
  sort: "tons" | "age" | "risk";
  riskFilter: "all" | "낮음" | "관찰" | "높음";
  unitCount: number;
  feeds: YardFeed[];
  unloads: YardUnload[];
  feedDate: string;
  feedSource: string;
  /** 처별 이탄 순증감 (모의 + 저장분). */
  yardDeltas: Record<string, number>;
  yardForecasts: InventoryGroup[];
  /** 해상 ‘예시 대기선’ 표시 (더미 AIS 동안만, showSampleWaiting 참고). */
  showSample: boolean;
  links: LinkChip[];
  onRefreshLinks: () => void;
  panel: ReactNode;
  historyDays: number;
}) {
  const titleId = useId();
  const receiving = new Set(
    attributions
      .filter((a) => a.voyage.voyage_id === activeShipId)
      .map((a) => a.pile.stockpile_id),
  );
  const maxTons = Math.max(1, ...piles.map((p) => p.on_hand_t));
  const moored = vessels.filter((v) => v.state === "unloading");
  const atSea = vessels.filter((v) => v.state === "waiting");
  const running = new Set(
    unloads.filter((b) => b.rateTpd !== null && b.rateTpd > 0).map((b) => b.berth),
  );
  // 처 선택은 그 처의 부두·컨베이어를, 선박 선택은 그 선박의 부두 → 컨베이어 → 귀속 Pile 경로를 강조.
  const selectedBerth =
    berths.find((b) => b.plant_yard === selectedYard)?.berth_id ??
    vessels.find((v) => v.voyage.voyage_id === activeShipId)?.berth_id;

  // 방향키 이동용 격자: 처 → 구역 → Pile (화면 순서).
  const grid = useMemo(
    () =>
      YARDS.map((yard) =>
        [0, 1, 2, 3].map((zone) =>
          orderPiles(
            piles.filter((p) => p.plant_yard === yard && p.zone === zone),
            sort,
            "all",
          ),
        ),
      ),
    [piles, sort],
  );
  const firstId = grid.flat(2)[0]?.stockpile_id ?? null;
  const [focusId, setFocusId] = useState<string | null>(null);
  const rovingId =
    (focusId && piles.some((p) => p.stockpile_id === focusId) && focusId) ||
    (selectedPileId && piles.some((p) => p.stockpile_id === selectedPileId) && selectedPileId) ||
    firstId;
  const moveFocus = (key: string, id: string) => {
    let y = -1;
    let z = -1;
    let i = -1;
    for (let yy = 0; yy < grid.length; yy++)
      for (let zz = 0; zz < grid[yy].length; zz++) {
        const ii = grid[yy][zz].findIndex((p) => p.stockpile_id === id);
        if (ii >= 0) [y, z, i] = [yy, zz, ii];
      }
    if (y < 0) return null;
    const row = grid[y].flat();
    i = row.findIndex((p) => p.stockpile_id === id);
    const columns = YARD_LAYOUT[YARDS[y]].columns;
    const at = (yy: number, zz: number, ii: number) => {
      const r = grid[yy]?.[zz];
      return r?.length ? r[Math.max(0, Math.min(r.length - 1, ii))].stockpile_id : null;
    };
    if (key === "ArrowRight") return row[i + 1]?.stockpile_id ?? at(y + 1, 0, 0);
    if (key === "ArrowLeft") return row[i - 1]?.stockpile_id ?? at(y - 1, 3, Infinity);
    if (key === "ArrowDown") return row[i + columns]?.stockpile_id ?? null;
    if (key === "ArrowUp") return row[i - columns]?.stockpile_id ?? null;
    if (key === "Home") return row[Math.floor(i / columns) * columns].stockpile_id;
    if (key === "End") return row[Math.min(row.length - 1, Math.floor(i / columns) * columns + columns - 1)].stockpile_id;
    return null;
  };

  const shipButton = (v: SiteVessel, style: CSSProperties) => {
    const selected = activeShipId === v.voyage.voyage_id;
    const label =
      v.state === "unloading"
        ? `${v.ledgerState ?? "하역중"} · ${v.berth_id}`
        : `${v.waitH == null ? "대기시간 미확정" : `대기 ${v.waitH}h`}${v.assigned ? ` · 지정 ${v.berth_id}` : ""}`;
    return (
      <button
        key={v.voyage.voyage_id}
        className={`harbor-ship is-${v.state === "unloading" ? "moored" : "anchored"}`}
        style={style}
        aria-pressed={selected}
        aria-label={`${v.voyage.vessel_name}, ${label}, 선택`}
        onClick={() => onSelectShip(v.voyage.voyage_id)}
      >
        <ShipGlyph mode={v.state === "unloading" ? "moored" : "anchored"} />
        <span className="harbor-ship-label">
          <b>{v.voyage.vessel_name}</b> {label}
        </span>
      </button>
    );
  };

  return (
    <section className="stockyard-site" aria-labelledby={titleId}>
      <div className="stockyard-site-header">
        <div>
          <h2 id={titleId}>당진 항만 · 저탄장 현황</h2>
          <p>
            선박 대기·접안·하역 → 발전처별 저탄 → 발전소 상탄 · Pile에 마우스를
            올리면 탄질과 하역 이력, 선택하면 우측 패널에 상세
          </p>
        </div>
        <div className="site-links" aria-label="외부 연계 상태">
          {links.map((l) => (
            <span key={l.label} className={`link-chip is-${l.status}`} title={l.detail}>
              <i />
              {l.label}
            </span>
          ))}
          <button onClick={onRefreshLinks} aria-label="연계 상태 다시 확인">
            ↻
          </button>
          <span className="tower-tag">SIMULATED 약도</span>
        </div>
      </div>

      <div className="stockyard-site-canvas">
        <div className="site-scene">
          <div className="site-plants" role="group" aria-label="당진 발전소 처별 발전·상탄 계획">
            <div className="site-plants-caption"><strong>당진 발전소</strong><span>{feedDate} · {feedSource} · KST · 일평균 · 실시간 계측 미연계</span></div>
            <p className="site-unload-note">하역 기본 {n(DEFAULT_UNLOAD_TPD)} t/일 (약 {n(DEFAULT_UNLOAD_TPD / 24, 1)} t/h) · 가정 · 선박 잔량·접안시간 반영</p>
            <div className="site-plant-grid">
              {YARDS.map((yard) => {
                const feed = feeds.find((f) => f.yard === yard);
                const [first, last] = YARD_UNIT_RANGES[yard];
                return <button key={yard} className={`site-plant${selectedYard === yard ? " is-selected" : ""}`} data-feed-yard={yard}
                  aria-label={`${yardShortName(yard)} 발전·상탄 계획`} aria-pressed={selectedYard === yard} onClick={() => onSelectYard(yard)}>
                  <div className="site-plant-heading"><PlantGlyph /><div><strong>{yardShortName(yard)}</strong><span>{first}~{last}호기</span></div></div>
                  <dl>
                    <div><dt>발전량</dt><dd data-feed-value="generation">{n(feed?.generationMwh)}<small> MWh/일</small></dd></div>
                    <div><dt>상탄량</dt><dd data-feed-value="tonnes">{n(feed?.tonnesPerDay, 1)}<small> t/일</small></dd></div>
                    <div><dt>일평균 상탄</dt><dd data-feed-value="hourly">{n(feed?.tonnesPerHour, 1)}<small> t/h</small></dd></div>
                  </dl>
                </button>;
              })}
            </div>
          </div>
          <div className="site-belt stockyard-gauge">
            <div className="site-feed-conveyors">
              {YARDS.map((yard) => <div key={yard} className="site-feed-conveyor" data-conveyor-yard={yard}
                aria-label={`${yardShortName(yard)} 상탄 컨베이어`}>
                <span className="site-feed-track" aria-hidden="true">↑</span>
                <span className="site-belt-chip"><span>{yardShortName(yard)} 상탄 컨베이어</span>
                  <strong>{n(feeds.find((f) => f.yard === yard)?.tonnesPerHour, 1)} t/h</strong>
                </span>
              </div>)}
            </div>
          </div>

          <div
            className="site-yards"
            role="group"
            aria-label="발전처 저탄장 · 방향키로 Pile 이동"
            onKeyDown={(event) => {
              const id = (event.target as HTMLElement).dataset?.pileId;
              if (!id) return;
              const next = moveFocus(event.key, id);
              if (!next) return;
              event.preventDefault();
              setFocusId(next);
              document
                .querySelector<HTMLElement>(`.site-yards [data-pile-id="${next}"]`)
                ?.focus();
            }}
          >
            {YARDS.map((yard, y) => {
              const yardPiles = piles.filter((p) => p.plant_yard === yard);
              const indoor = yardPiles.some((p) => p.indoor);
              const tons = yardPiles.reduce((s, p) => s + p.on_hand_t, 0);
              const delta = yardDeltas[yard] ?? 0;
              const forecast = yardForecasts.find((f) => f.group.yard === yard);
              return (
                <div
                  key={yard}
                  className={`yard-block${indoor ? " is-indoor" : ""}${selectedYard === yard ? " is-selected" : ""}`}
                  data-yard={yard}
                  data-yard-layout={`${YARD_LAYOUT[yard].columns}x${YARD_LAYOUT[yard].rows}`}
                  style={{ gridArea: yard }}
                >
                  <header>
                    <button
                      className="yard-title"
                      aria-pressed={selectedYard === yard}
                      onClick={() => onSelectYard(yard)}
                    >
                      <strong>{yardShortName(yard)}</strong>
                      <span>
                        {indoor ? "옥내" : "옥외"} · {n(forecast?.source === "db" ? forecast.currentTons : tons)} t
                      </span>
                    </button>
                    {forecast && (
                      <span
                        className={`yard-days is-${forecast.status}`}
                        title={`재고일수 ${inventoryStatusLabel(forecast)} · 기준시각 → 기간 최저${forecast.minDays ? ` (${forecast.minDays.date.slice(5).replace("-", "/")})` : ""} · ${forecast.source === "db" ? "DB 설정 기준" : "기준 SPEC §13"}`}
                      >
                        {forecast.currentDays === null
                          ? forecast.source === "db" ? "미확정" : "소비 없음"
                          : forecast.minDays && forecast.minDays.days < forecast.currentDays - 0.05
                            ? `${n(forecast.currentDays, 1)}→${n(forecast.minDays.days, 1)}일`
                            : `${n(forecast.currentDays, 1)}일`}
                      </span>
                    )}
                    {delta !== 0 && (
                      <em className="yard-transfer-tag">
                        이탄 {delta > 0 ? "+" : "−"}
                        {n(Math.abs(delta))} t
                      </em>
                    )}
                  </header>
                  {grid[y].map((group, zone) => {
                    if (!group.length) return null;
                    return (
                      <div key={zone} className="zone-group">
                        <span>
                          {zone + 1}구역 · {group[0].coal_type}
                        </span>
                        <div className="yard-piles">
                          {group.map((pile) => (
                            <PileButton
                              key={pile.stockpile_id}
                              pile={pile}
                              entries={historyForPile(pile, attributions, historyDays)}
                              selected={selectedPileId === pile.stockpile_id}
                              restricted={pile.eligible_unit_ids.length < unitCount}
                              maxTons={maxTons}
                              dimmed={riskFilter !== "all" && pileRisk(pile).label !== riskFilter}
                              receiving={receiving.has(pile.stockpile_id)}
                              tabIndex={pile.stockpile_id === rovingId ? 0 : -1}
                              onSelect={() => {
                                setFocusId(pile.stockpile_id);
                                onSelectPile(pile.stockpile_id);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {[["P1", "P2"], ["P2", "P3"]].map(([from, to], i) =>
              <div key={`${from}-${to}`} className="site-transfer-belt" style={{ gridArea: `t${i + 1}${i + 2}` }}
                data-transfer-route={`${from}-${to}`} role="img" aria-label={`${yardShortName(from)} ↔ ${yardShortName(to)} 이탄벨트 연결 개념도`}
                title="이탄 연결 개념도 · 실제 설비 연결 확인 필요">
                <span className="site-transfer-label">이탄벨트</span>
                <span className="site-transfer-track" aria-hidden="true">↔</span>
                <small>{i + 1}↔{i + 2}</small>
              </div>)}
          </div>

          <div className="site-unload-conveyors" role="group" aria-label="부두별 하역량·당일 재고 반영">
          {BERTHS.map((berth, i) => (
            <div
              key={berth}
              className={`site-conveyor${running.has(berth) ? " is-running" : ""}${selectedBerth === berth ? " is-selected" : ""}`}
              data-unload-berth={berth}
              style={{ gridArea: `c${i + 1}` }}
            >
              <span className="site-conveyor-belt" aria-hidden="true" />
              <span className="site-unload-chip"><small>하역 {berth} → {yardShortName(YARDS[i])}</small>
                <strong data-unload-value="rate">{n(unloads.find((u) => u.berth === berth)?.rateTpd)} t/일</strong>
                <small>당일 입고 <b data-unload-value="receipts">{n(unloads.find((u) => u.berth === berth)?.receipts)} t</b></small>
              </span>
            </div>
          ))}
          </div>

          <ul className="harbor-quay stockyard-berths" aria-label="부두 점유">
            {berths.map((b) => (
              <li
                key={b.berth_id}
                className={`harbor-berth is-${b.state}${selectedBerth === b.berth_id ? " is-selected" : ""}`}
                title={b.vessel ? `ETA ${b.vessel.voyage.ais_eta}` : undefined}
              >
                <i aria-hidden="true" />
                <b>{b.berth_id}</b>
                <span>
                  {b.vessel?.ledgerState ?? STATE_LABEL[b.state]}
                  {b.vessel ? ` · ${b.vessel.voyage.vessel_name}` : ""}
                </span>
              </li>
            ))}
          </ul>

          <div className="harbor-sea">
            <SeaTexture />
            <span className="harbor-sea-name">당진항 앞바다</span>
            <div className="harbor-anchorage" aria-hidden="true">
              <span>묘박지</span>
            </div>
            {moored.map((v) => {
              const slot = BERTHS.indexOf(v.berth_id as (typeof BERTHS)[number]);
              const stack = moored.filter((m) => m.berth_id === v.berth_id).indexOf(v);
              return shipButton(v, {
                "--slot": Math.max(0, slot),
                "--stack": stack,
              } as CSSProperties);
            })}
            {atSea.map((v, k) => shipButton(v, { "--k": k } as CSSProperties))}
            {showSample && (
              <div
                className="harbor-ship is-anchored is-sample"
                style={{ "--k": atSea.length } as CSSProperties}
                role="img"
                aria-label="예시 대기선: 해상 대기 표현용 임의 선박, 항차 데이터 아님"
                title="예시 대기선 · 해상 대기 표현용 임의 선박 (항차 데이터 아님)"
              >
                <ShipGlyph mode="anchored" />
                <span className="harbor-ship-label">
                  <b>예시 대기선</b> 묘박 대기 · 임의 표시
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {panel}
    </section>
  );
}
