import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '@/lib/account-context';
import { Button } from '@/components/ui/button';
import { PlanningInputForm, type PlanningInputDetail } from './PlanningInputForm';
import { PlanningJobProgress } from '@/components/planning-job/PlanningJobProgress';
import { parsePlanningJob, planningJobView, type PlanningJob } from '@/domain/planning-job';
import { planningJobStore } from '@/domain/use-planning-job';
import './data.css';
import './forecast-input.css';

type Input = {id: number; name: string; start: string; end: string};
type Job = PlanningJob;
type Execution = {id: string; input_id: number; state: string; error?: string; summary?: {scenario: {name: string; start: string; end: string}}};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => { throw new Error('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'); });
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `요청 실패 (${response.status})`);
  return body as T;
}
const loadInput = (id: number) => request<PlanningInputDetail>(`/api/planning/inputs/${id}`);

/** Main-screen editor; uses the same persisted inputs and calculator as the data tools. */
export function ForecastInputPanel({onResult, onSetup}: {onResult: (run: {id: string; start: string; end: string}) => void; onSetup: () => void}) {
  const account = useAccount();
  const canEdit = account?.user.role === 'admin';
  const [inputs, setInputs] = useState<Input[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [statusReady, setStatusReady] = useState(false);
  const [message, setMessage] = useState('');
  const [job, setJob] = useState<Job>({state:'idle'});
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [activeRun, setActiveRun] = useState<string>();
  const [retryInput, setRetryInput] = useState<number>();
  const lock = useRef(false);
  const refreshInputs = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const rows = await request<Input[]>('/api/planning/inputs');
      if (!Array.isArray(rows)) throw new Error('저장된 조건 목록을 확인하지 못했습니다.');
      setInputs(rows.sort((a,b) => b.id-a.id));
    } catch(e) { setLoadError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  const refreshStatus = useCallback(async () => {
    try {
      const [current, history] = await Promise.all([request<Job>('/api/job'),request<Execution[]>('/api/planning/executions')]);
      if (!Array.isArray(history)) throw new Error('계산 이력을 확인하지 못했습니다.');
      if (!['idle','running','done','error'].includes(current.state)) throw new Error('계산 상태 응답을 확인하지 못했습니다.');
      setJob(current); setExecutions(history); setStatusError(''); setStatusReady(true);
      planningJobStore.publish(parsePlanningJob(current));
    } catch(e) { setStatusError((e as Error).message); }
  }, []);
  useEffect(() => { void refreshInputs(); void refreshStatus(); }, [refreshInputs, refreshStatus]);
  const active = executions.find(row => row.id === activeRun);
  const tracking = job.state === 'running' || Boolean(activeRun && (!active || active.state === 'running'));
  useEffect(() => {
    if (!tracking && !statusError) return;
    const timer = setInterval(() => void refreshStatus(), 3000);
    return () => clearInterval(timer);
  }, [tracking, statusError, refreshStatus]);
  async function start(id: number) {
    const result = await request<{run_id:string}>('/api/run', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input_id:id})});
    setActiveRun(result.run_id); setJob({state:'running',run_id:result.run_id}); setRetryInput(undefined);
    setMessage('조건을 저장하고 전망 계산을 시작했습니다. 화면을 나가도 서버에서 계속 계산합니다.');
    await refreshStatus();
  }
  async function save(data: FormData, run: boolean) {
    if (!canEdit || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage(''); setRetryInput(undefined); setActiveRun(undefined);
    let saved: PlanningInputDetail | undefined;
    try {
      saved = await request<PlanningInputDetail>('/api/planning/inputs/upload', {method:'POST',body:data});
      const s = saved.payload.scenario;
      setInputs(old => [{id:saved!.id,name:s.name,start:s.start,end:s.end},...old.filter(row=>row.id!==saved!.id)]);
      setMessage('조건을 DB에 저장했습니다. 다음 방문에도 불러올 수 있습니다.');
      if(run) await start(saved.id);
    } catch(e) {
      if(saved && run) { setRetryInput(saved.id); setError(`조건은 저장됐지만 계산을 시작하지 못했습니다. ${(e as Error).message}`); }
      else setError((e as Error).message);
    } finally { lock.current=false; setBusy(false); }
  }
  const completed = active?.state === 'done' && active.summary ? active : undefined;
  const failed = active?.state === 'error' ? active : undefined;
  return <div className="forecast-input-panel milp-admin">
    {loading && !inputs.length && <p role="status">DB에서 전망 조건을 불러오는 중…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><Button variant="outline" onClick={()=>void refreshInputs()}>조건 다시 불러오기</Button></div>}
    {!loading && !loadError && !inputs.length && <div className="forecast-input-empty"><h2>저장된 전망 조건이 없습니다</h2><p>수요·정비·단가의 기준 조건을 먼저 등록해 주세요. 한 번 등록하면 다음 계산부터 가져올 수 있습니다.</p>{canEdit && <Button onClick={onSetup}>기준 조건 등록</Button>}</div>}
    {!canEdit && <p className="planning-input-note">저장된 조건과 계산 결과를 조회할 수 있습니다. 조건 저장과 전망 실행은 관리자 권한이 필요합니다.</p>}
    {!!inputs.length && <PlanningInputForm inputs={inputs} initialId={inputs[0].id} simple readOnly={!canEdit} busy={busy || tracking || !statusReady || Boolean(statusError)} onLoad={loadInput} onSave={save}/>}
    <section className="forecast-execution" aria-label="전망 실행 상태" aria-live="polite">
      {!statusReady && !statusError && <p>서버 계산 상태를 확인하고 있습니다…</p>}
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      {statusError && <p role="alert">계산 상태를 확인하지 못했습니다. 연결을 다시 확인하고 있습니다. {statusError}</p>}
      {tracking && <div><strong>전망을 계산하고 있습니다</strong><p>수요 전망 → 호기별 발전계획 → 연료 사용량·재고 전망</p>{job.state === 'running' ? <PlanningJobProgress view={planningJobView(job, true)}/> : <p>계산 자료를 준비하고 있습니다.</p>}</div>}
      {failed && <p role="alert">계산을 완료하지 못했습니다. {failed.error} 저장된 조건을 수정해 다시 실행하세요.</p>}
      {retryInput !== undefined && <Button disabled={busy || tracking || Boolean(statusError)} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await start(retryInput);}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}}>저장된 조건으로 다시 실행</Button>}
      {completed && <Button onClick={()=>onResult({id:completed.id,...completed.summary!.scenario})}>이번 계산 결과 보기</Button>}
    </section>
    <details className="forecast-history"><summary>최근 계산 이력 · {executions.length}건</summary>{executions.length ? <ul>{executions.slice(0,10).map(row=><li key={row.id}><span><strong>{row.summary?.scenario.name ?? '전망 계산'}</strong><small>{row.summary ? `${row.summary.scenario.start} ~ ${row.summary.scenario.end}` : row.id}</small></span>{row.state==='done' && row.summary ? <Button variant="outline" onClick={()=>onResult({id:row.id,...row.summary!.scenario})}>결과 보기</Button> : <span>{row.state==='error' ? '계산 실패' : '계산 중'}</span>}</li>)}</ul> : <p>아직 실행한 계산이 없습니다.</p>}</details>
  </div>;
}
