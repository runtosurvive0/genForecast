import type { PlanningState } from '@/domain/use-planning';
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { SUPPLY_GROUPS } from '@/domain/supply';
import { useYardBaseline } from '@/domain/use-yard-baseline';
import { sumKnownInventory, supplyFeeds } from './supply-view';
import { SupplyInputs } from './SupplyInputs';
import './supply-ledger.css';

const fmt = (value: number | null | undefined) => value == null ? '미확정' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })} t`;

export function SupplyLedger({ planning, selectedDay }: { planning: PlanningState; selectedDay?: string }) {
  const { data, error } = useYardBaseline();
  const snapshot = planning.current?.classification === 'functional_demo' ? null : planning.current;
  const planDay = selectedDay && snapshot?.inventory.daily.some(row => row.day === selectedDay) ? selectedDay : snapshot?.start;
  return <div className="gf-supply-ledger">
    <section className="gf-supply-ledger__section" aria-label="저탄장 기준재고">
      <header><h2>저탄장 기준재고</h2><span>{data?.as_of ? `${data.as_of} 기준` : '기준일 미확인'}</span></header>
      {error ? <p role="alert">{error}</p> : !data ? <ProcessingOrb state="searching" label="기준재고 조회 중" /> : !data.as_of ? <p>등록된 기준재고가 없습니다.</p> : <>
        <strong>{fmt(data.total_t)}</strong>
        <div className="gf-supply-ledger__yards">{[1, 2, 3].map(yard => {
          const lots = data.lots.filter(row => yard === 3 ? /^[AB]/.test(row.location) : /^P\d+$/.test(row.location) && (Number(row.location.slice(1)) <= 4 ? 1 : 2) === yard);
          return <div key={yard}><span>{yard}저탄장</span><b>{fmt(lots.length ? lots.reduce((sum, row) => sum + row.tonnes, 0) : null)}</b></div>;
        })}</div>
        <p>기준일에 확인된 재고입니다. 실시간 운전 정보는 연결되지 않았습니다.</p>
      </>}
    </section>
    {snapshot && <section className="gf-supply-ledger__section" aria-label="호기군별 발전과 연료 계획"><header><h2>호기군별 발전과 연료 계획</h2><span>{planDay} · 일별 계획</span></header><div className="gf-supply-ledger__feeds">{supplyFeeds(snapshot,planDay).map((feed,index)=><article key={feed.yard}><h3>{['1~4호기','5~8호기','9~10호기'][index]}</h3><dl><div><dt>발전량</dt><dd>{feed.generationMwh == null ? '미확정' : `${feed.generationMwh.toLocaleString('ko-KR')} MWh`}</dd></div><div><dt>연료 사용</dt><dd>{fmt(feed.tonnesPerDay)} / 일</dd></div><div><dt>시간당 평균</dt><dd>{feed.tonnesPerHour == null ? '미확정' : `${feed.tonnesPerHour.toLocaleString('ko-KR',{maximumFractionDigits:1})} t/h`}</dd></div></dl></article>)}</div><p>시간당 값은 일별 계획의 평균이며 실시간 상탄량이 아닙니다.</p></section>}
    <section className="gf-supply-ledger__section" aria-label="발전 수급 전망 상세">
      <header><h2>발전·수급 전망</h2><span>{snapshot ? `${snapshot.start} ~ ${snapshot.end}` : '계획 미선택'}</span></header>
      {snapshot && selectedDay && snapshot.inventory.daily.filter(row => row.day === selectedDay).map(row => <section className="gf-supply-ledger__yards" aria-label="선택 날짜 수급" key={row.day}><span>{row.day}</span><b>{fmt(sumKnownInventory(SUPPLY_GROUPS.map(group => row.groups[group.id]?.stock ?? null)))}</b></section>)}
      {!snapshot ? <p>{planning.failed || (planning.current?.classification === 'functional_demo' ? '실제 발전계획이 아직 연결되지 않았습니다.' : '저장된 발전계획을 선택하면 재고·입하·사용 전망을 확인할 수 있습니다.')}</p> : <div className="gf-supply-ledger__table"><table><thead><tr><th>일자</th>{SUPPLY_GROUPS.map(group => <th key={group.id}>{group.name} 재고</th>)}<th>입하</th><th>사용</th></tr></thead><tbody>{snapshot.inventory.daily.map(row => {
        const values = (key: 'receipts' | 'burn') => sumKnownInventory(SUPPLY_GROUPS.map(group => row.groups[group.id]?.[key] ?? null));
        return <tr key={row.day}><th>{row.day}</th>{SUPPLY_GROUPS.map(group => { const cell = row.groups[group.id]; const short = cell?.shortage ?? 0; return <td key={group.id} className={short > 0 ? 'gf-supply-ledger__short' : undefined}>{fmt(cell?.stock)}{short > 0 && <small>부족 {fmt(short)}</small>}</td>; })}<td>{fmt(values('receipts'))}</td><td>{fmt(values('burn'))}</td></tr>;
      })}</tbody></table></div>}
      <p>기준일만 있는 재고는 다음 날 0시부터 적용합니다. 성상이 확인되지 않은 처의 연소량과 전망은 계산하지 않습니다. 입하에는 항차 원장의 계획 항차(하역완료 예정일)가 포함됩니다. 재고가 바닥나면 0으로 두고 계획대로 태우지 못한 양을 부족으로 표시합니다.</p>
    </section>
    <SupplyInputs onSaved={planning.refresh}/>
  </div>;
}
