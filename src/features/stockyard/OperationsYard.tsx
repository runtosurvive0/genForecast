import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Layers3,
  LayoutGrid,
  ShieldAlert,
  Radio,
  Warehouse,
} from "lucide-react";
import { FuelScene } from "@/components/fuel-scene/FuelScene";
import { authJson } from "@/lib/auth-client";
import { summarizeManualYard, type ManualYardLot } from "@/domain/manual-yard-inventory";
import {
  referenceYards,
  getReferenceLotTons,
  type FuelReferenceLot,
} from "@/domain/fuel-reference";
import { useYardBaseline } from "@/domain/use-yard-baseline";
import { yardBaselineLots } from "@/domain/yard-baseline-lots.js";
import "./operations-yard.css";

type YardId = 1 | 2 | 3;
export interface OperationsYardProps {
  initialLotId: string | null;
  onOpenSupply: (id: string) => void;
  theme: "light" | "dark";
  snapshot: unknown | null;
  status: string;
  onOpenLedger: () => void;
  onNavigate: (page: string) => void;
}

const number = (value: number | null) =>
  value === null
    ? "미확정"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const nameOf = (lot: FuelReferenceLot) =>
  lot.pile === null
    ? `${lot.shed ?? ""} ${lot.cell ?? lot.id.toUpperCase()}`.trim()
    : `Pile ${lot.pile}`;
const groupOf = (lot: FuelReferenceLot) =>
  lot.pile === null
    ? `${lot.shed ?? lot.id[0].toUpperCase()} Shed`
    : `Pile ${lot.pile}`;

/** Photograph inventory and local demo material share selections, never the operational DB ledger. */
export function OperationsYard({
  initialLotId,
  onOpenSupply,
  theme,
  snapshot,
  status,
  onOpenLedger,
  onNavigate,
}: OperationsYardProps) {
  const baseline = useYardBaseline();
  const referenceLots: FuelReferenceLot[] = useMemo(() => yardBaselineLots(baseline.data?.lots ?? [], true), [baseline.data]);
  const baselineStock = useMemo(() => Object.fromEntries((baseline.data?.lots ?? []).filter(row => row.source_id).map(row => [row.source_id!, row.tonnes])), [baseline.data]);
  const baselineDetails = useMemo(() => Object.fromEntries((baseline.data?.lots ?? []).filter(row => row.source_id).map(row => [row.source_id!, {coal:row.coal_name,voyage:row.voyage_number ?? '',days:row.age_days ?? null}])), [baseline.data]);
  const mappingComplete = !!baseline.data;
  const initialLot = referenceLots.find(lot => lot.id === initialLotId);
  const [yard, setYard] = useState<YardId>(initialLot?.yard ?? 1);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [manualLots, setManualLots] = useState<ManualYardLot[] | null>(null);
  const [manualError, setManualError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setManualLots(null); setManualError(false);
    authJson<{ lots: ManualYardLot[] }>("/api/voyage-registry/inventory", { signal: abort.signal })
      .then(data => setManualLots(data.lots))
      .catch(() => { if (!abort.signal.aborted) setManualError(true); });
    return () => abort.abort();
  }, []);
  const [selection, setSelection] = useState<Partial<Record<YardId, string>>>(
    initialLot ? { [initialLot.yard]: initialLot.id } : {},
  );
  useEffect(() => {
    const initial = referenceLots.find(lot => lot.id === initialLotId);
    if (initial) { setYard(initial.yard); setSelection(value => ({ ...value, [initial.yard]: initial.id })); }
  }, [initialLotId, referenceLots]);
  const demo = status !== "disabled";
  const material = record(record(snapshot).material);
  const materialLots = record(material.lots);
  const hasMaterial = Object.keys(materialLots).length > 0;
  const compatibleMaterial = !!baseline.data?.lots.length && baseline.data.lots.every(row => row.source_id && Object.hasOwn(materialLots,row.source_id));
  const waiting = demo && !hasMaterial;
  const currentSnapshot = demo ? snapshot : null;
  const tonsOf = (lot: FuelReferenceLot): number | null =>
    getReferenceLotTons(lot, currentSnapshot);
  const lots = referenceLots.filter((lot) => lot.yard === yard);
  const placedIds = new Set(yardBaselineLots(baseline.data?.lots ?? []).map(lot => lot.id));
  const unplacedLots = (baseline.data?.lots ?? []).filter((row, index) => {
    if (placedIds.has(row.source_id || `baseline-${row.location}-${index}`)) return false;
    const pile = /^P([1-8])$/.exec(row.location);
    const rowYard = pile ? (Number(pile[1]) <= 4 ? 1 : 2) : /^[AB](?:\d+)?$/i.test(row.location) ? 3 : null;
    return rowYard === yard;
  });
  const query = inventoryQuery.trim().toLocaleLowerCase('ko-KR');
  const matches = (...values: (string | null | undefined)[]) => !query || values.some(value => value?.toLocaleLowerCase('ko-KR').includes(query));
  const visibleLots = lots.filter(lot => matches(nameOf(lot), `P${lot.pile ?? ''}`, lot.coal, lot.voyage));
  const visibleUnplacedLots = unplacedLots.filter(lot => !referenceLots.some(item => item.id === lot.source_id) && matches(lot.location, lot.coal_name, lot.voyage_number));
  const selected = lots.find((lot) => lot.id === selection[yard]) ?? lots[0];
  const selectedMaterial = record(materialLots[selected?.id]);
  const sum = (items: FuelReferenceLot[]): number | null => {
    if (!baseline.data?.as_of || !mappingComplete) return null;
    const values = items.map(tonsOf);
    return values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
  const totals = referenceYards.map((item) =>
    sum(referenceLots.filter((lot) => lot.yard === item.id)),
  );
  const totalStock = totals.some((value) => value === null)
    ? null
    : totals.reduce<number>((total, value) => total + (value ?? 0), 0);
  const yardData = referenceYards.find((item) => item.id === yard)!;
  const manualSummary = manualLots ? summarizeManualYard(manualLots, yard) : [];
  const groups = [...new Set(lots.map(groupOf))];
  const total = sum(lots);
  const active =
    total === null
      ? null
      : lots.filter((lot) => (tonsOf(lot) ?? -1) > 0).length;
  const depleted =
    total === null ? null : lots.filter((lot) => tonsOf(lot) === 0).length;
  const sourceText = !demo
    ? baseline.error || (baseline.data?.as_of ? `${baseline.data.as_of} 기준 재고` : '기준재고 확인 중')
    : compatibleMaterial
      ? "기준 재고 + 운전 정보"
      : `${baseline.data?.as_of ?? '기준일 미확인'} 기준 재고`;
  const signal = !demo
    ? "미연결"
    : status === "online"
      ? "운전 정보 수신"
      : status === "connecting"
        ? "연결 중"
        : status === "stale"
          ? "수신 지연"
          : "연결 끊김";
  const choose = (id: string | null) => {
    const lot = referenceLots.find((item) => item.id === id);
    if (lot) {
      setYard(lot.yard as YardId);
      setSelection((value) => ({ ...value, [lot.yard]: id }));
    }
  };
  const lotState = (lot: FuelReferenceLot) =>
    tonsOf(lot) === null ? "미확정" : tonsOf(lot) === 0 ? "소진" : "적치 중";
  const coalOf = (lot: FuelReferenceLot) => {
    const live = record(materialLots[lot.id]);
    return demo &&
      (finite(live.received) ?? 0) > 0 &&
      typeof live.demoLabel === "string"
      ? live.demoLabel
      : lot.coal;
  };
  const high = !baseline.data?.as_of || !mappingComplete ? null : lots
    .filter((lot) => lot.grade === "고")
    .reduce((value, lot) => value + lot.tons, 0);
  const low = !baseline.data?.as_of || !mappingComplete ? null : lots
    .filter((lot) => lot.grade === "저")
    .reduce((value, lot) => value + lot.tons, 0);
  return (
    <div className="gf-operations-yard" data-testid="operations-yard">
      <header className="gf-oy-heading">
        <div>
          <h1>저탄·재고</h1>
          <p>당진발전본부 · {sourceText}</p>
        </div>
        <button onClick={onOpenLedger}>수기 Pile 재고 원장</button>
        <div className="gf-oy-tabs" role="tablist" aria-label="저탄장 선택">
          {referenceYards.map((item) => (
            <button
              key={item.id}
              type="button"
              id={`gf-yard-tab-${item.id}`}
              role="tab"
              aria-controls="gf-yard-panel"
              aria-selected={yard === item.id}
              tabIndex={yard === item.id ? 0 : -1}
              onClick={() => setYard(item.id as YardId)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 1
                    : event.key === "End"
                      ? 3
                      : ((yard - 1 + (event.key === "ArrowRight" ? 1 : 2)) %
                          3) +
                        1;
                setYard(next as YardId);
                document.getElementById(`gf-yard-tab-${next}`)?.focus();
              }}
            >
              {item.name}
              <small>{item.id === 1 ? "옥외" : "옥내"}</small>
            </button>
          ))}
        </div>
        <button
          className="gf-oy-link"
          type="button"
          onClick={() => onNavigate("simulation")}
        >
          수급 시뮬레이션 <ArrowRight />
        </button>
      </header>

      <section className="gf-oy-kpis" aria-label="선택 저탄장 요약">
        <div>
          <Layers3 />
          <span>
            {yardData.name} 재고
            <strong>
              {number(total)}
              <small>{total === null ? "" : "t"}</small>
            </strong>
          </span>
        </div>
        <div>
          <LayoutGrid />
          <span>
            적치 구간
            <strong>
              {number(active)}
              <small>
                구간{depleted === null ? "" : ` · 소진 ${depleted}`}
              </small>
            </strong>
          </span>
        </div>
        <div>
          <Warehouse />
          <span>
            {yard === 1 ? "현재 사용 범위" : "운영용량 참고"}
            <strong>
              {yard === 1 ? "전체" : number(yardData.operatingCapacityTons)}
              <small>{yard === 1 ? "구간" : "t"}</small>
            </strong>
          </span>
        </div>
        <div>
          <Radio />
          <span>
            설비 운전 신호
            <strong className="gf-oy-signal" data-status={status}>
              {signal}
              <small>{demo ? "연결됨" : "실시간 미연결"}</small>
            </strong>
          </span>
        </div>
      </section>

      <div className="gf-oy-stage">
        <section
          className="gf-oy-map gf-oy-panel"
          id="gf-yard-panel"
          role="tabpanel"
          aria-labelledby={`gf-yard-tab-${yard}`}
        >
          <div className="gf-oy-section-head">
            <h2>{yardData.name} 배치</h2>
            <span>
              {yard === 1
                ? "옥외 · Pile 1–4"
                : yard === 2
                  ? "옥내 · Pile 5–8"
                  : "옥내 · A / B Shed"}
            </span>
          </div>
          <div className="gf-oy-manual" aria-label="수기 원장 구역별 잔량" aria-live="polite">
            <span className="gf-oy-manual-title">입하 배분 원장</span>
            {manualError ? <span>불러오지 못했습니다. 재고 원장에서 다시 확인하세요.</span> :
              !manualLots ? <span>불러오는 중</span> : manualSummary.length === 0 ?
                <span>입하 배분 기록 없음 · 기준재고와 별도</span> :
                manualSummary.map(item => <button type="button" className="gf-oy-manual-item" key={item.location} onClick={onOpenLedger} title="수기 재고 원장 열기">
                  {item.location.startsWith('P') ? `Pile ${item.location.slice(1)}` : `${item.location[0]}${item.location.slice(1)} 셀`}
                  {' '}<b>{number(item.tonnes)} t</b>{item.review > 0 && ' · 재확인'}
                </button>)}
            <span className="gf-oy-manual-note">수기 배분 잔량 · 더미 위치 미확인 · 기준재고와 별도</span>
          </div>
          <div className="gf-oy-scene">
            {baseline.data?.as_of && <FuelScene
              mode="yard"
              yard={yard}
              berth={1}
              theme={theme}
              selectedLotId={selected?.id ?? null}
              onSelectLot={choose}
              snapshot={currentSnapshot}
              baselineStock={baselineStock}
              baselineDetails={baselineDetails}
              baselineLots={baseline.data.lots}
              online={status === "online"}
            />}
            {baseline.error && <p role="alert">{baseline.error}</p>}
            {unplacedLots.length > 0 && <p role="status">위치 미확인 {unplacedLots.length}건은 재고 목록에서 확인하세요.</p>}
          </div>
          <div className="gf-oy-map-caption">
            <span>참고 배치 · 형상은 개념 표현</span>
            <span>
              {yard === 2
                ? "720 m 종단축 · 위치 미확인 구간은 이격 판단 제외"
                : yard === 3
                  ? "미제공 CELL은 재고 미확정"
                  : "전체 구간 사용 · 기준 재고"}
            </span>
          </div>
        </section>

        <aside className="gf-oy-inspector" aria-label="저탄장 구역 정보">
          <section className="gf-oy-panel gf-oy-piles">
            <div className="gf-oy-section-head">
              <h2>{yard === 3 ? "Shed" : "Pile"}별 재고</h2>
              <span>구역 · 잔량</span>
            </div>
            {groups.map((group) => {
              const items = lots.filter((lot) => groupOf(lot) === group);
              const groupTotal = sum(items);
              return (
                <button
                  key={group}
                  type="button"
                  className="gf-oy-pile"
                  aria-pressed={!!selected && groupOf(selected) === group}
                  onClick={() =>
                    choose(
                      (items.find((lot) => (tonsOf(lot) ?? 0) > 0) ?? items[0])
                        .id,
                    )
                  }
                >
                  <span>
                    <b>{group}</b>
                    <strong>
                      {number(groupTotal)}
                      <small>{groupTotal === null ? "" : "t"}</small>
                    </strong>
                  </span>
                  <span className="gf-oy-stock-strip" aria-hidden="true">
                    {items.map((lot) => (
                      <i
                        key={lot.id}
                        className={tonsOf(lot) === 0 ? "is-empty" : ""}
                        style={{ flexGrow: Math.max(1, tonsOf(lot) ?? 1) }}
                      />
                    ))}
                  </span>
                  <span className="gf-oy-pile-caption">
                    <span>
                      {groupTotal === null
                        ? "적치 수 미확정"
                        : `${items.filter((lot) => (tonsOf(lot) ?? 0) > 0).length}개 적치`}
                    </span>
                    <span>
                      {yard === 1 ? "전체 구간 사용" : "참고 구역 기준"}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
          <section
            className="gf-oy-panel gf-oy-detail"
            aria-label="선택 구간 상세"
            aria-live="polite"
          >
            {!selected && <p className="gf-oy-detail-note">선택 가능한 도면 구간이 없습니다 · 센서 미연결</p>}
            {selected && (
              <>
                <div className="gf-oy-section-head">
                  <h2>{nameOf(selected)} 상세</h2>
                  <button type="button" className="gf-oy-link" onClick={() => onOpenSupply(selected.id)}>상탄 경로 보기 <ArrowRight /></button>
                </div>
                <div className="gf-oy-selected-reading">
                  <h3>{coalOf(selected)}</h3>
                  <strong>
                    {number(tonsOf(selected))}
                    <small>{tonsOf(selected) === null ? "" : "t"}</small>
                  </strong>
                </div>
                <p className="gf-oy-detail-meta">
                  <span>{lotState(selected)}</span>
                  <span>
                    {demo && (finite(selectedMaterial.received) ?? 0) > 0
                      ? "미분석"
                      : selected.grade
                        ? `${selected.grade}열량`
                        : "성상 미제공"}
                  </span>
                  <span>
                    {selected.days === null
                      ? "경과일 미제공"
                      : `기준일 D+${selected.days}`}
                  </span>
                </p>
                <dl>
                  <div>
                    <dt>항차</dt>
                    <dd>{selected.voyage || "미제공"}</dd>
                  </div>
                  <div>
                    <dt>기준 재고</dt>
                    <dd>{number(selected.tons)} t</dd>
                  </div>
                  <div>
                    <dt>반입 / 상탄</dt>
                    <dd>
                      {demo
                        ? `${number(finite(selectedMaterial.received))} / ${number(finite(selectedMaterial.reclaimed))} t`
                        : "연결 안 됨"}
                    </dd>
                  </div>
                  <div>
                    <dt>온도 / CO</dt>
                    <dd>센서 미연결</dd>
                  </div>
                </dl>
                <p className="gf-oy-detail-note">
                  <ShieldAlert />
                  {yard === 1
                    ? "전체 구간 사용 · 기준 재고"
                    : yard === 2
                      ? "위치가 확인된 구간만 상부 이격 표시"
                      : "참고 배치 · 이격 기준 미제공"}
                </p>
              </>
            )}
          </section>
        </aside>
      </div>

      <div className="gf-oy-bottom">
        <section className="gf-oy-panel gf-oy-inventory">
          <div className="gf-oy-section-head">
            <h2>
              구역별 재고 <small>{lots.length + visibleUnplacedLots.length}개 구간</small>
            </h2>
            <input type="search" className="gf-oy-inventory-search" aria-label="구역별 재고 검색" placeholder="구역 · 탄종 · 항차" value={inventoryQuery} onChange={event => setInventoryQuery(event.target.value)}/>
            <button className="gf-oy-link" type="button" onClick={onOpenLedger}>
              재고 원장 <ArrowRight />
            </button>
          </div>
          <div
            className="gf-oy-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="구역별 재고 표"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">구역 / 공급사</th>
                  <th scope="col">항차</th>
                  <th scope="col" className="gf-oy-number">
                    재고 (t)
                  </th>
                  <th scope="col">탄종</th>
                  <th scope="col">경과</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {visibleLots.map((lot) => (
                  <tr key={lot.id} data-selected={lot.id === selected?.id}>
                    <td>
                      <button
                        type="button"
                        className="gf-oy-row-select"
                        aria-pressed={lot.id === selected?.id}
                        onClick={() => choose(lot.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                          const buttons = Array.from(event.currentTarget.closest('tbody')?.querySelectorAll<HTMLButtonElement>('.gf-oy-row-select') ?? []);
                          const index = buttons.indexOf(event.currentTarget);
                          const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
                          if (next) { event.preventDefault(); next.focus(); }
                        }}
                      >
                        <b>{nameOf(lot)}</b>
                        <span>{coalOf(lot)}</span>
                      </button>
                    </td>
                    <td>{lot.voyage || "미제공"}</td>
                    <td className="gf-oy-number">{number(tonsOf(lot))}</td>
                    <td>
                      {demo &&
                      (finite(record(materialLots[lot.id]).received) ?? 0) > 0
                        ? "미분석"
                        : lot.grade
                          ? `${lot.grade}열량`
                          : "미제공"}
                    </td>
                    <td>{lot.days === null ? "—" : `D+${lot.days}`}</td>
                    <td>{lot.unplaced ? '위치 미확인' : lotState(lot)}</td>
                  </tr>
                ))}
                {visibleUnplacedLots.map((lot, index) => (
                  <tr key={`unplaced-${lot.source_id ?? lot.location}-${index}`}>
                    <td><b>{/^P[1-8]$/.test(lot.location) ? `Pile ${lot.location.slice(1)}` : lot.location}</b><br/><span>{lot.coal_name}</span></td>
                    <td>{lot.voyage_number || '미제공'}</td>
                    <td className="gf-oy-number">{number(lot.tonnes)}</td>
                    <td>{lot.grade ? (lot.grade.endsWith('열량') ? lot.grade : `${lot.grade}열량`) : '미제공'}</td>
                    <td>{lot.age_days == null ? '—' : `D+${lot.age_days}`}</td>
                    <td>위치 미확인</td>
                  </tr>
                ))}
                {query && !visibleLots.length && !visibleUnplacedLots.length && <tr><td colSpan={6}>검색 결과가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="gf-oy-table-note">
            {demo && compatibleMaterial
              ? `하역 +${number(finite(material.received))} t / 상탄 −${number(finite(material.outbound))} t`
              : `${baseline.data?.as_of ?? '기준일 미확인'} 기준 재고`}
          </p>
        </section>
        <section className="gf-oy-panel gf-oy-summary">
          <div className="gf-oy-section-head">
            <h2>저탄장별 재고</h2>
            <span>
              {demo
                ? hasMaterial
                  ? (compatibleMaterial ? "운전 정보 마지막 수신" : `${baseline.data?.as_of ?? '기준일 미확인'} 기준`)
                  : "운전 정보 수신 대기"
                : `${baseline.data?.as_of ?? '기준일 미확인'} 기준`}
            </span>
          </div>
          <p className="gf-oy-total">
            {totalStock === null ? "미확정" : (totalStock / 10000).toFixed(2)}
            <small>{totalStock === null ? "" : "만 t"}</small>
          </p>
          <div className="gf-oy-distribution" aria-hidden="true">
            {totals.map((value, index) => (
              <span
                key={index}
                style={{
                  width: totalStock
                    ? `${((value ?? 0) / totalStock) * 100}%`
                    : "0%",
                }}
              />
            ))}
          </div>
          <dl>
            {referenceYards.map((item, index) => (
              <div key={item.id}>
                <dt>
                  <button
                    type="button"
                    onClick={() => setYard(item.id as YardId)}
                  >
                    {item.name}
                  </button>
                </dt>
                <dd>
                  {number(totals[index])}{" "}
                  <small>{totals[index] === null ? "" : "t"}</small>
                  <span>
                    {totalStock
                      ? `${(((totals[index] ?? 0) / totalStock) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="gf-oy-quality">
            <div>
              <h3>{yardData.name} 기준 탄종</h3>
              <span>중량 기준</span>
            </div>
            <div className="gf-oy-quality-track" aria-hidden="true">
              <i
                style={{
                  width:
                    high !== null && low !== null && high + low > 0 ? `${(high / (high + low)) * 100}%` : "0%",
                }}
              />
            </div>
            <div className="gf-oy-quality-values">
              <span>
                고열량
                <b>
                  {number(high)}
                  <small>{high === null ? '' : 't'}</small>
                </b>
              </span>
              <span>
                저열량
                <b>
                  {number(low)}
                  <small>{low === null ? '' : 't'}</small>
                </b>
              </span>
            </div>
          </div>
        </section>
      </div>
      <p className="gf-oy-source" role="status">
        {signal} ·{" "}
        {demo
          ? hasMaterial
            ? (compatibleMaterial ? "재고: 기준값 + 운전 정보" : "재고: 기준값")
            : "운전 정보 미확정"
          : `재고: ${baseline.data?.as_of ?? '기준일 미확인'} 기준`}{" "}
        · 실제 설비 미연결
        {demo && status !== "online" && hasMaterial
          ? " · 마지막 수신값 유지 · 애니메이션 정지"
          : ""}
      </p>
    </div>
  );
}
