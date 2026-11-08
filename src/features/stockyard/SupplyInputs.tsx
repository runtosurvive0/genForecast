import { useEffect, useState } from 'react';
import { authJson } from '@/lib/auth-client';
import { fetchSupplyRecords } from './integrations';
import type { SupplyTransferRecord, SupplyVesselRecord } from './stockyard-domain';

const groups = [{id:'g14', label:'1~4호기 처'}, {id:'g58', label:'5~8호기 처'}, {id:'g910', label:'9~10호기 처'}];

export function SupplyInputs({onSaved}: {onSaved: () => void}) {
  const [from, setFrom] = useState('g14');
  const [to, setTo] = useState('g58');
  const [at, setAt] = useState('');
  const [tonnes, setTonnes] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [vessels, setVessels] = useState<SupplyVesselRecord[]>([]);
  const [transfers, setTransfers] = useState<SupplyTransferRecord[]>([]);
  const [vessel, setVessel] = useState('');
  const [unloadAt, setUnloadAt] = useState('');
  const [cumulative, setCumulative] = useState('');
  const [rate, setRate] = useState('');
  const [unloadMessage, setUnloadMessage] = useState('');
  const reload = () => fetchSupplyRecords().then(data => {setVessels(data.vessels.filter(v => v.classification !== 'simulation')); setTransfers(data.transfers);}).catch(error => setUnloadMessage(error.message));
  useEffect(() => { void reload(); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (from === to || !at || !(Number(tonnes) > 0)) { setMessage('서로 다른 출발·도착 처와 시각, 물량을 확인하세요.'); return; }
    setBusy(true); setMessage('');
    try {
      await authJson('/api/supply/transfers', {method:'POST', body:JSON.stringify({from_group:from, to_group:to, at:`${at}:00+09:00`, tonnes:Number(tonnes), note})});
      setTonnes(''); setNote(''); setMessage('이탄 내역을 저장했습니다. 전망을 다시 불러옵니다.'); await reload(); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function saveUnloading(event: React.FormEvent) {
    event.preventDefault();
    const selected = vessels.find(item => String(item.id) === vessel);
    const last = selected?.points.at(-1);
    if (!selected || !last || !unloadAt || cumulative === '' || rate === '') { setUnloadMessage('선박과 하역 시각, 누적량, 속도를 확인하세요.'); return; }
    setBusy(true); setUnloadMessage('');
    try {
      await authJson(`/api/supply/vessels/${selected.id}/unloading`, {method:'POST', body:JSON.stringify({at:`${unloadAt}:00+09:00`, cumulative:Number(cumulative), rate:Number(rate), allocations:last.allocations})});
      setUnloadMessage('하역 내역을 저장했습니다.'); setCumulative(''); setRate(''); await reload(); onSaved();
    } catch (error) { setUnloadMessage(error instanceof Error ? error.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  return <><details className="gf-supply-ledger__section"><summary>이탄 입력</summary>
    <p>처 간 실제 이동을 입력합니다. 적치 구역별 잔량은 Pile 재고 원장에서 확인하세요.</p>
    <form onSubmit={submit} className="gf-supply-inputs">
      <label>출발 처<select value={from} onChange={e=>setFrom(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
      <label>도착 처<select value={to} onChange={e=>setTo(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
      <label>이탄 시각 · KST<input type="datetime-local" value={at} required onChange={e=>setAt(e.target.value)}/></label>
      <label>이탄량 (t)<input type="number" min="0.001" step="any" required value={tonnes} onChange={e=>setTonnes(e.target.value)}/></label>
      <label>메모<input value={note} maxLength={300} onChange={e=>setNote(e.target.value)}/></label>
      <button disabled={busy} type="submit">이탄 저장</button>
    </form>{message && <p role="status">{message}</p>}
    {!!transfers.length && <div className="gf-supply-ledger__table"><table><thead><tr><th>이탄 시각 · KST</th><th>출발 처</th><th>도착 처</th><th>이탄량 (t)</th><th>메모</th></tr></thead><tbody>{[...transfers].sort((a,b) => b.at.localeCompare(a.at)).slice(0,10).map(row => <tr key={row.id}><td>{new Date(row.at).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'})}</td><td>{groups.find(g=>g.id===row.from_group)?.label ?? row.from_group}</td><td>{groups.find(g=>g.id===row.to_group)?.label ?? row.to_group}</td><td>{row.tonnes.toLocaleString('ko-KR')}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}
  </details><details className="gf-supply-ledger__section"><summary>하역 입력</summary>
    <p>등록된 선박의 누적 하역량과 이후 하역 속도를 입력합니다. 배분은 기존 원장에 등록된 비율을 따릅니다.</p>
    <form onSubmit={saveUnloading} className="gf-supply-inputs">
      <label>선박<select required value={vessel} onChange={e=>setVessel(e.target.value)}><option value="">선박 선택</option>{vessels.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label>기록 시각 · KST<input type="datetime-local" required value={unloadAt} onChange={e=>setUnloadAt(e.target.value)}/></label>
      <label>누적 하역량 (t)<input type="number" min="0" step="any" required value={cumulative} onChange={e=>setCumulative(e.target.value)}/></label>
      <label>하역 속도 (t/h)<input type="number" min="0" step="any" required value={rate} onChange={e=>setRate(e.target.value)}/></label>
      <button disabled={busy || !vessels.length} type="submit">하역 저장</button>
    </form>{vessel && vessels.find(v=>String(v.id)===vessel)?.points.at(-1) && <p>최근 원장 · 누적 {vessels.find(v=>String(v.id)===vessel)?.points.at(-1)?.cumulative.toLocaleString('ko-KR')} t · 하역 속도 {vessels.find(v=>String(v.id)===vessel)?.points.at(-1)?.rate.toLocaleString('ko-KR')} t/h</p>}{!vessels.length && !unloadMessage && <p>하역 원장에 등록된 선박이 없습니다.</p>}{unloadMessage && <p role="status">{unloadMessage}</p>}
  </details></>;
}
