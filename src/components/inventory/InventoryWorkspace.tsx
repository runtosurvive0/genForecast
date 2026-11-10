import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { authJson } from '@/lib/auth-client';
import { useYardBaseline } from '@/domain/use-yard-baseline';
import { lotDetailKeys, lotQualityLabel } from '@/domain/blend-quality';
import type { LotDetail } from '@/domain/assistant-checks';
import './inventory-workspace.css';

type Lot = { id: number; cargo_no: string; location: string; yard: number; coal_name: string;
  voyage_number: string | null; plan_name: string | null; initial_t: number; remaining_t: number;
  updated_at: string; receipt_at: string | null; recorded_receipt_end: string | null; needs_review: boolean; assay: null | { stage: string; gcv_arb: number | null; tm_ar: number | null; sulfur_ar: number | null } };
type Reconciliation = {id:number; cargo_no:string; actor:string; actor_name?:string | null; reason:string; at:string; before:Lot[]; after:Lot[]};
type Inventory = { revision: number; lots: Lot[]; reconciliations?: Reconciliation[] };
type Register = { revision: number; cargo: Array<{ cargo_no: string; voyage_no: string; coal_name: string; received_t: number | null; receipt_end_date: string | null; destination_plant_id: string }>;
  voyages: Array<{ voyage_no: string; voyage_number: string | null; plan_name: string | null; actual_unload_end: string | null }> };
type Result = { status: string; reason?: string; inventory_revision: number; as_of?: string; excluded: Array<{ id: string; missing: string[] }>;
  lots: Array<{ id: string; tonnes: number }>; quality?: { gcv_arb: number; tm_ar: number | null; sulfur_ar: number | null } };
const root = '/api/voyage-registry';
const locs = [...Array.from({length: 8}, (_, i) => `P${i + 1}`), ...['A', 'B'].flatMap(s => Array.from({length: 10}, (_, i) => `${s}${i + 1}`))];
const label = (loc: string) => loc.startsWith('P') ? `Pile ${loc.slice(1)}` : `${loc[0]} Shed · ${loc.slice(1)} Cell`;
const fmt = (value: number | null | undefined) => value == null ? '미확인' : value.toLocaleString('ko-KR', {maximumFractionDigits: 2});
const dateKst = (value: string) => Number.isNaN(Date.parse(value)) ? '시각 미확인' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(value));
const dateTimeKst = (value: string | null | undefined) => !value || Number.isNaN(Date.parse(value)) ? '미확인' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(value));
const errorText = (e: unknown) => e instanceof Error ? e.message : '요청을 처리하지 못했습니다.';

function LotQuality({ details, id }: { details: Record<string, LotDetail> | undefined; id: string | undefined }) {
  if (!details) return null; // 점검 결과가 아직 없으면 성분을 모르는 것이지 미확인이 아니다
  const detail = id ? details[id] : undefined;
  const q = lotQualityLabel(detail);
  if (!q.known) return <small className="gf-inventory-quality">성분 미확인</small>;
  return <small className="gf-inventory-quality">{[q.grade, q.gcv, q.sulfur].filter(Boolean).join(' · ')}{q.dummy && <span className="gf-inventory-dummy" title="더미 성분 값입니다">더미</span>}</small>;
}

export function InventoryWorkspace({ mode, onBack, standalone = false, lotDetails }: {mode: 'inventory' | 'blend'; onBack?: () => void; standalone?: boolean; lotDetails?: Record<string, LotDetail> | null}) {
  const baseline = useYardBaseline();
  const [baselineChosen, setBaselineChosen] = useState<string[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cargo, setCargo] = useState('');
  const [rows, setRows] = useState([{ location: 'P1', tonnes: '' }]);
  const [balanceId, setBalanceId] = useState<number | null>(null);
  const [balance, setBalance] = useState('');
  const [reason, setReason] = useState('');
  const [reconcileCargo, setReconcileCargo] = useState<string | null>(null);
  const [reconcileRows, setReconcileRows] = useState<Array<{location:string; tonnes:string; remaining_t:string}>>([]);
  const [reconcileReason, setReconcileReason] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const [tonnes, setTonnes] = useState('');
  const [target, setTarget] = useState('');
  const [tolerance, setTolerance] = useState('0');
  const [moisture, setMoisture] = useState('');
  const [sulfur, setSulfur] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  async function refresh(signal?: AbortSignal) {
    setBusy(true); setError('');
    try {
      const [stock, data] = await Promise.all([authJson<Inventory>(root + '/inventory', {signal}), authJson<Register>(root + '/records', {signal})]);
      if (signal?.aborted) return;
      setInventory(stock); setRegister(data); setResult(null);
    } catch (e) { if (!signal?.aborted) setError(errorText(e)); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const abort = new AbortController(); void refresh(abort.signal); return () => abort.abort(); }, []);
  const posted = new Set(inventory?.lots.map(row => row.cargo_no));
  const eligible = register?.cargo.filter(row => row.destination_plant_id === 'dangjin' && row.received_t != null && row.received_t > 0 && row.receipt_end_date && !posted.has(row.cargo_no) && register.voyages.some(v => v.voyage_no === row.voyage_no && v.actual_unload_end)) ?? [];
  const selectedCargo = eligible.find(row => row.cargo_no === cargo);
  const pending = rows.reduce((sum, row) => sum + (Number(row.tonnes) || 0), 0);
  const lots = inventory?.lots ?? [];
  async function post(path: string, body: unknown): Promise<Inventory | null> {
    setBusy(true); setError('');
    try { const data = await authJson<Inventory>(root + path, {method: 'POST', body: JSON.stringify(body)}); setInventory(data); return data; }
    catch (e) { setError(errorText(e)); return null; }
    finally { setBusy(false); }
  }
  async function assign() {
    if (!inventory || !selectedCargo || rows.some(r => !r.tonnes || Number(r.tonnes) <= 0)) { setError('화물과 각 적치 구역의 물량을 입력하세요.'); return; }
    const saved = await post('/inventory/receipts', {cargo_no: cargo, allocations: rows.map(row => ({location: row.location, tonnes: Number(row.tonnes)})), revision: inventory.revision});
    if (saved) { setCargo(''); setRows([{location: 'P1', tonnes: ''}]); }
  }
  async function correct() {
    if (!inventory || balanceId === null || balance === '' || !reason.trim()) { setError('잔량과 변경 사유를 입력하세요.'); return; }
    const saved = await post('/inventory/balance', {lot_id: balanceId, remaining_t: Number(balance), reason, revision: inventory.revision});
    if (saved) { setBalanceId(null); setBalance(''); setReason(''); }
  }
  function openReconciliation(cargoNo: string) {
    setBalanceId(null); setError(''); setReconcileCargo(cargoNo); setReconcileReason('');
    setReconcileRows(lots.filter(lot => lot.cargo_no === cargoNo).map(lot => ({location:lot.location, tonnes:String(lot.initial_t), remaining_t:String(lot.remaining_t)})));
  }
  async function reconcile() {
    if (!inventory || !register || !reconcileCargo || !reconcileReason.trim() || reconcileRows.some(row => row.tonnes === '' || row.remaining_t === '')) {
      setError('모든 적치량·잔량과 정정 사유를 입력하세요.'); return;
    }
    const saved = await post('/inventory/reconcile', {cargo_no:reconcileCargo, allocations:reconcileRows.map(row => ({location:row.location, tonnes:Number(row.tonnes), remaining_t:Number(row.remaining_t)})),
      reason:reconcileReason, revision:inventory.revision, registry_revision:register.revision});
    if (saved) { setReconcileCargo(null); setReconcileRows([]); setReconcileReason(''); }
  }
  async function calculate() {
    if ((!chosen.length && !baselineChosen.length) || !tonnes || !target) { setError('원탄, 요청량, 목표 발열량을 입력하세요.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const criteria = {tonnes: Number(tonnes), target_gcv_arb: Number(target), gcv_tolerance: Number(tolerance || 0),
        ...(moisture !== '' ? {max_tm_ar: Number(moisture)} : {}), ...(sulfur !== '' ? {max_sulfur_ar: Number(sulfur)} : {})};
      setResult(await authJson<Result>(root + (baselineChosen.length ? '/blend/baseline-recommend' : '/blend/recommend'), {method: 'POST', body: JSON.stringify(baselineChosen.length ? {lot_ids: baselineChosen, revision:baseline.data?.revision, criteria} : {lot_ids: chosen, criteria})}));
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const change = (fn: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { fn(e.target.value); setResult(null); };
  return <section className="gf-inventory" aria-label={mode === 'inventory' ? 'Pile 재고 원장' : '조건별 혼탄 검토'}>
    <header className="gf-inventory-head"><div>{onBack && <button className="gf-inventory-back" onClick={onBack}><ArrowLeft size={15}/> 돌아가기</button>}
      {standalone ? <h1>Pile 재고 원장</h1> : <h2>{mode === 'inventory' ? 'Pile 재고 원장' : '조건별 혼탄 검토'}</h2>}
      <p>{mode === 'inventory' ? '화물별 실제 적치 구역과 수기 잔량을 관리합니다.' : '입력한 목표와 제한을 만족하는 조합을 계산합니다.'}</p></div>
      <button onClick={() => void refresh()} disabled={busy}><RefreshCw size={15}/> 새로고침</button></header>
    {error && <p className="gf-inventory-error" role="alert">{error}</p>}
    {busy && !inventory && <p role="status">공용 재고를 불러오는 중입니다…</p>}
    {inventory && <>
      {mode === 'inventory' && <div className="gf-inventory-entry"><h3>입하 화물 적치</h3>
        <p>입고 종료일·입하량·실제 하역완료 시각이 등록된 당진 화물만 선택할 수 있습니다.</p>
        <label>입하 화물<select aria-label="입하 화물" value={cargo} onChange={e => setCargo(e.target.value)}><option value="">화물 선택</option>{eligible.map(c => {
          const voyage = register?.voyages.find(v => v.voyage_no === c.voyage_no);
          return <option key={c.cargo_no} value={c.cargo_no}>{voyage?.voyage_number || voyage?.plan_name || '항차 미정'} · {c.coal_name} · {fmt(c.received_t)} t</option>;
        })}</select></label>
        {!eligible.length && <p>배선·화물 원장에서 실제 하역완료 시각과 입하 정보를 먼저 등록하세요.</p>}
        {rows.map((row, index) => <div className="gf-inventory-allocation" key={index}>
          <label>적치 구역<select aria-label={`적치 구역 ${index + 1}`} value={row.location} onChange={e => setRows(rows.map((r, i) => i === index ? {...r, location: e.target.value} : r))}>{locs.map(loc => <option key={loc} value={loc}>{label(loc)}</option>)}</select></label>
          <label>적치량 (t)<input aria-label={`적치량 ${index + 1}`} type="number" min="0" step="any" value={row.tonnes} onChange={e => setRows(rows.map((r, i) => i === index ? {...r, tonnes: e.target.value} : r))}/></label>
          {rows.length > 1 && <button aria-label={`적치 구역 ${index + 1} 삭제`} onClick={() => setRows(rows.filter((_, i) => i !== index))}><Trash2 size={16}/></button>}
        </div>)}
        <div className="gf-inventory-entry-actions"><button onClick={() => setRows([...rows, {location: 'P1', tonnes: ''}])}><Plus size={15}/> 구역 추가</button>
          <span>배분 {fmt(pending)} / 입하 {fmt(selectedCargo?.received_t)} t</span><button className="gf-inventory-primary" disabled={busy || !selectedCargo} onClick={() => void assign()}>재고에 반영</button></div>
      </div>}
      <div className="gf-inventory-grid"><div><div className="gf-inventory-subhead"><h3>{mode === 'inventory' ? '기록된 재고' : '혼탄 대상 원탄'}</h3><span>{lots.length}건 · 수기 기록</span></div>
        {mode === 'blend' && baseline.data?.as_of && <section aria-label="기준재고 혼탄 대상"><h3>기준재고 · {baseline.data.as_of}</h3><p>해당 기준일의 수량입니다. 이후 변동을 확인하세요. 입하 배분 재고와 동시에 선택할 수 없습니다.</p><div className="gf-inventory-list">{(() => { const keys = lotDetailKeys(baseline.data.lots); return baseline.data.lots.map((row, index) => ({row, key: keys[index]})); })().filter(({row}) => row.source_id && row.tonnes > 0).map(({row, key}) => <label className="gf-inventory-row gf-inventory-row-compact" key={row.source_id}><input type="checkbox" disabled={chosen.length > 0} checked={baselineChosen.includes(row.source_id!)} onChange={event => {setBaselineChosen(event.target.checked ? [...baselineChosen,row.source_id!] : baselineChosen.filter(id => id !== row.source_id));setResult(null);}}/><span className="gf-inventory-name">{label(row.location)} · {row.coal_name}<small> {row.voyage_number || '항차 미확인'}</small><LotQuality details={lotDetails ?? undefined} id={key}/></span><strong>{fmt(row.tonnes)} t</strong></label>)}</div></section>}
        {!lots.length ? <p className="gf-inventory-empty">아직 배분된 입하 재고가 없습니다. 항차 원장에서 Pile별 적치량을 등록하세요.</p> : <div className="gf-inventory-list">{lots.map(lot => <div className="gf-inventory-row" key={lot.id}>
          {mode === 'blend' && <input type="checkbox" aria-label={`${label(lot.location)} ${lot.coal_name} 선택`} disabled={baselineChosen.length > 0 || lot.needs_review || lot.remaining_t <= 0} checked={chosen.includes(lot.id)} onChange={e => {setChosen(e.target.checked ? [...chosen, lot.id] : chosen.filter(id => id !== lot.id)); setResult(null);}}/>}
          <div><strong>{label(lot.location)} · {lot.coal_name}</strong><small>{lot.voyage_number || lot.plan_name || '항차 미정'} · {lot.assay ? (lot.assay.stage === 'unloading' ? '하역 분석' : '선적 분석') : '확정 성상 없음'}{lot.needs_review ? ' · 입하 정보 재확인' : ''}</small></div>
          <div className="gf-inventory-value"><strong>{fmt(lot.remaining_t)} <small>t</small></strong><small>수기 잔량 · {dateKst(lot.updated_at)}</small></div>
          {mode === 'inventory' && <><button onClick={() => {setReconcileCargo(null); setBalanceId(lot.id); setBalance(String(lot.remaining_t)); setReason('');}}>잔량 수정</button>
            <button onClick={() => openReconciliation(lot.cargo_no)}>배분 정정</button></>}
        </div>)}</div>}
        {balanceId !== null && mode === 'inventory' && <div className="gf-inventory-correct"><label>수기 잔량 (t)<input aria-label="수기 잔량" type="number" min="0" step="any" value={balance} onChange={e => setBalance(e.target.value)}/></label><label>변경 사유<input aria-label="잔량 변경 사유" value={reason} onChange={e => setReason(e.target.value)} placeholder="상탄 실적 반영 등"/></label><button disabled={busy} onClick={() => void correct()}>저장</button><button onClick={() => setBalanceId(null)}>취소</button></div>}
        {reconcileCargo && mode === 'inventory' && <section className="gf-inventory-reconcile" aria-label="화물 배분 정정">
          <h3>화물 배분 정정 · {register?.cargo.find(c => c.cargo_no === reconcileCargo)?.coal_name ?? reconcileCargo}</h3>
          <p>이 화물의 모든 구역을 확인하세요. 원장 입하량과 적치량 합계가 같아야 합니다. 잔량은 현재 확인한 값으로 입력하세요.</p>
          {reconcileRows.map((row, index) => <div className="gf-inventory-reconcile-row" key={index}>
            <label>적치 구역<select aria-label={`정정 구역 ${index + 1}`} value={row.location} onChange={e => setReconcileRows(reconcileRows.map((r, i) => i === index ? {...r, location:e.target.value} : r))}>{locs.map(loc => <option key={loc} value={loc}>{label(loc)}</option>)}</select></label>
            <label>적치량 (t)<input aria-label={`정정 적치량 ${index + 1}`} type="number" min="0" step="any" value={row.tonnes} onChange={e => setReconcileRows(reconcileRows.map((r, i) => i === index ? {...r, tonnes:e.target.value} : r))}/></label>
            <label>현재 잔량 (t)<input aria-label={`정정 잔량 ${index + 1}`} type="number" min="0" step="any" value={row.remaining_t} onChange={e => setReconcileRows(reconcileRows.map((r, i) => i === index ? {...r, remaining_t:e.target.value} : r))}/></label>
            {reconcileRows.length > 1 && <button aria-label={`정정 구역 ${index + 1} 삭제`} onClick={() => setReconcileRows(reconcileRows.filter((_, i) => i !== index))}><Trash2 size={16}/></button>}
          </div>)}
          <div className="gf-inventory-reconcile-actions"><button onClick={() => setReconcileRows([...reconcileRows, {location:'P1',tonnes:'',remaining_t:''}])}><Plus size={15}/> 구역 추가</button>
            <span>배분 {fmt(reconcileRows.reduce((sum, row) => sum + (Number(row.tonnes) || 0), 0))} / 입하 {fmt(register?.cargo.find(c => c.cargo_no === reconcileCargo)?.received_t)} t</span></div>
          <label>정정 사유<input aria-label="배분 정정 사유" value={reconcileReason} onChange={e => setReconcileReason(e.target.value)} placeholder="적치 위치 확인 등" maxLength={300}/></label>
          <p>저장하면 이전 배분이 이력에 남고, 영향받는 발전처의 수급 전망은 기준재고 재확인이 필요할 수 있습니다.</p>
          <div className="gf-inventory-reconcile-actions"><button className="gf-inventory-primary" disabled={busy} onClick={() => void reconcile()}>정정 저장</button><button onClick={() => setReconcileCargo(null)}>취소</button></div>
        </section>}
        {mode === 'inventory' && !!inventory.reconciliations?.length && <details className="gf-inventory-history"><summary>배분 정정 이력</summary>
          {inventory.reconciliations.map(event => <article key={event.id}><strong>{event.after[0]?.coal_name ?? event.cargo_no}</strong><span>{dateTimeKst(event.at)} KST · {event.actor_name || `작성자 ${event.actor.slice(0, 8)}`} · {event.reason}</span>
            <small>이전: {event.before.map(row => `${label(row.location)} ${fmt(row.initial_t)} t · 잔량 ${fmt(row.remaining_t)} t`).join(' / ')}</small>
            <small>이전 입고 종료 {event.before[0]?.recorded_receipt_end ?? '미확인'} · 하역 완료 {dateTimeKst(event.before[0]?.receipt_at)}</small>
            <small>정정: {event.after.map(row => `${label(row.location)} ${fmt(row.initial_t)} t · 잔량 ${fmt(row.remaining_t)} t`).join(' / ')}</small>
            <small>정정 입고 종료 {event.after[0]?.recorded_receipt_end ?? '미확인'} · 하역 완료 {dateTimeKst(event.after[0]?.receipt_at)}</small></article>)}
        </details>}
      </div>
      {mode === 'blend' && <div className="gf-inventory-criteria"><h3>목표와 제한</h3><p>확정 하역 분석을 우선하고, 없으면 확정 선적 분석을 사용합니다.</p>
        <label>혼탄 요청량 (t)<input aria-label="혼탄 요청량" type="number" min="0" value={tonnes} onChange={change(setTonnes)}/></label>
        <label>목표 발열량 ARB (kcal/kg)<input aria-label="목표 발열량 ARB" type="number" min="0" value={target} onChange={change(setTarget)}/></label>
        <label>발열량 허용오차 (± kcal/kg)<input aria-label="발열량 허용오차" type="number" min="0" value={tolerance} onChange={change(setTolerance)}/></label>
        <label>총수분 AR 상한 (%wt)<input aria-label="총수분 상한" type="number" min="0" max="100" value={moisture} onChange={change(setMoisture)} placeholder="제한 없음"/></label>
        <label>유황분 AR 상한 (%wt)<input aria-label="유황분 상한" type="number" min="0" max="100" value={sulfur} onChange={change(setSulfur)} placeholder="제한 없음"/></label>
        <button className="gf-inventory-primary" disabled={busy} onClick={() => void calculate()}>조건 충족 조합 계산</button>
      </div>}</div>
      {result && <div className="gf-inventory-result" role="status"><h3>{result.status === 'ok' ? '조건 충족 조합' : '조건을 만족하는 조합 없음'}</h3>
        {result.as_of && <p>재고 기준일 {result.as_of} · 현재 잔량 확인 필요</p>}
        {result.reason && <p>{result.reason}</p>}{result.quality && <p>발열량 ARB {fmt(result.quality.gcv_arb)} kcal/kg · 총수분 AR {fmt(result.quality.tm_ar)}% · 유황분 AR {fmt(result.quality.sulfur_ar)}%</p>}
        {result.lots.map(row => { const lot = lots.find(item => String(item.id) === row.id) ?? baseline.data?.lots.find(item => item.source_id === row.id); return <div key={row.id}>{lot ? `${label(lot.location)} · ${lot.coal_name}` : row.id}<strong>{fmt(row.tonnes)} t</strong></div>; })}
        {result.excluded.map(row => { const lot = lots.find(item => String(item.id) === row.id) ?? baseline.data?.lots.find(item => item.source_id === row.id); return <p key={row.id}>{lot?.coal_name ?? row.id} 제외 · {row.missing.map(k => ({gcv_arb:'발열량 ARB',tm_ar:'총수분 AR',sulfur_ar:'유황분 AR'}[k] ?? k)).join(', ')} 미확인</p>; })}
        <p>수기 잔량과 선택한 성상 항목만 반영한 검토 결과입니다. 별도 설비·운전 조건 확인이 필요합니다.</p></div>}
      <p className="gf-inventory-note">잔량은 자동 실측값이 아닙니다. 입하 이후 상탄·이탄과 기준 변경을 수기로 갱신하세요.</p>
    </>}
  </section>;
}
