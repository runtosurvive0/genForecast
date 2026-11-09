import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Outage = { unit: string; start: string; end: string; note?: string };
type Scenario = { name: string; start: string; end: string; weather: string | number; demand_growth_pct: number | null; solar_growth_pct: number | null; coal_adjust_pct: number[]; reserve_ratio: number; quality: string; workers: number | null; coal_oh: Outage[]; nuclear_oh: Outage[]; [key: string]: unknown };
export type PlanningInputDetail = { id: number; payload: { scenario: Scenario; heat_prices: Record<string, number[]>; fuel: { calorific_kcal_kg: number; is_assumption: boolean } } };
type InputSet = { id: number; name: string; start: string; end: string };

export function PlanningInputForm({ inputs, busy, onLoad, onSave, simple = false, readOnly = false, initialId }: {
  inputs: InputSet[]; busy: boolean; onLoad: (id: number) => Promise<PlanningInputDetail>;
  onSave: (data: FormData, run: boolean) => Promise<void>;
  simple?: boolean; readOnly?: boolean; initialId?: number;
}) {
  const [base, setBase] = useState<PlanningInputDetail | null>(null);
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const initialized = useRef(false);
  const request = useRef(0);
  useEffect(() => { if (initialId && !initialized.current) { initialized.current = true; void load(String(initialId)); } }, [initialId]);
  const scenario = base?.payload.scenario;
  const updateScenario = (change: Partial<Scenario>) => setBase(old => old && ({...old, payload: {...old.payload, scenario: {...old.payload.scenario, ...change}}}));
  const updateFuel = (change: Partial<PlanningInputDetail['payload']['fuel']>) => setBase(old => old && ({...old, payload: {...old.payload, fuel: {...old.payload.fuel, ...change}}}));
  const numberOrNull = (value: string) => value === "" ? null : Number(value);
  async function load(id: string) {
    const token = ++request.current;
    if (!id) { setBase(null); return; }
    setLoading(true); setError("");
    try { const detail = await onLoad(Number(id)); if(token !== request.current) return; setBase(structuredClone(detail)); setUnit(Object.keys(detail.payload.heat_prices)[0] ?? ""); }
    catch (e) { if(token === request.current) { setError((e as Error).message); setBase(null); } }
    finally { if(token === request.current) setLoading(false); }
  }
  function submit(run: boolean) {
    if (readOnly || !base || !scenario) return;
    setError("");
    const days = (Date.parse(scenario.end) - Date.parse(scenario.start)) / 86400000;
    if (!Number.isFinite(days) || days < 6 || days > 731) { setError("계산 기간을 7일 이상, 최대 2년으로 입력하세요."); return; }
    if (!/^(normal|\d{4})$/.test(String(scenario.weather))) { setError("기상 기준은 normal 또는 네 자리 연도로 입력하세요."); return; }
    if ([...scenario.nuclear_oh, ...scenario.coal_oh].some(row => !row.unit.trim() || !row.start.trim() || !row.end.trim())) { setError("정비 일정의 호기, 시작, 종료를 모두 입력하세요."); return; }
    if (Object.values(base.payload.heat_prices).some(values => values.length !== 12 || values.some(value => !Number.isFinite(value) || value <= 0))) { setError("모든 호기의 월별 열량단가를 0보다 큰 값으로 입력하세요."); return; }
    const form = new FormData();
    form.append("scenario", new Blob([JSON.stringify(scenario)], {type:"application/json"}), "화면입력.json");
    const columns = ["unit", ...Array.from({length:12}, (_,i) => `${i+1}월`)];
    const rows = Object.entries(base.payload.heat_prices).map(([name, prices]) => Object.fromEntries([["unit",name], ...prices.map((price,i) => [columns[i+1],price])]));
    form.append("heat_prices", new Blob([JSON.stringify({columns,rows})], {type:"application/json"}), "월별단가.json");
    form.append("calorific", String(base.payload.fuel.calorific_kcal_kg));
    form.append("assumption", String(base.payload.fuel.is_assumption));
    void onSave(form, run);
  }
  return <section className="tower-section planning-input" aria-labelledby="planning-input-title">
    <header><div><h2 id="planning-input-title">{simple ? '계산할 기간' : '새 전망 조건 입력'}</h2><p>{simple ? '저장된 조건을 불러와 기간과 달라진 항목만 설정합니다.' : '저장된 입력을 복사해 수정합니다. 원본은 그대로 보관됩니다.'}</p></div></header>
    <label className="planning-input-base">기준으로 가져올 입력
      <select aria-label="기준으로 가져올 입력" value={base?.id ?? ""} disabled={busy || loading} onChange={e => void load(e.target.value)}><option value="">기준 선택</option>{!simple && <option value="0">기본 조건에서 작성 · 2026년 10월 단가 확인 필요</option>}{inputs.map(item => <option key={item.id} value={item.id}>{item.name} · {item.start} ~ {item.end}</option>)}</select>
    </label>
    {base?.id === 0 && <p className="planning-input-note">기준 단가는 2026년 10월 자료를 12개월에 적용한 값입니다. 전망에 맞게 각 호기·월별 단가와 정비 일정을 확인하고 수정하세요.</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">저장된 조건을 불러오는 중…</p>}
    {base && scenario && <form onInvalid={e => { const details = (e.target as HTMLElement).closest('details'); if (details) details.open = true; }} onSubmit={e => {e.preventDefault(); submit(false);}}>
      <fieldset disabled={readOnly || busy || loading} className="planning-input-fields">
      <div className="planning-input-grid">
        {!simple && <label>전망 이름<input required maxLength={100} value={scenario.name} onChange={e => updateScenario({name:e.target.value})}/></label>}
        <label>시작일<input type="date" required value={scenario.start} onChange={e => updateScenario({start:e.target.value})}/></label>
        <label>종료일<input type="date" required value={scenario.end} onChange={e => updateScenario({end:e.target.value})}/></label>
      </div>
      <p className="planning-input-note">7일~2년 · KST · 시작일과 종료일 포함. 저장하면 새 조건으로 보관되며 기존 결과는 바뀌지 않습니다.</p>
      {simple && <div className="planning-input-inherited" aria-label="DB에서 가져온 조건"><span>열량단가 <b>{Object.keys(base.payload.heat_prices).length}개 호기</b></span><span>정비 일정 <b>{scenario.coal_oh.length + scenario.nuclear_oh.length}건</b></span><span>연료 환산 <b>{base.payload.fuel.calorific_kcal_kg.toLocaleString()} kcal/kg</b></span><span>기상 <b>{scenario.weather === 'normal' ? '평년' : `${scenario.weather}년`}</b></span></div>}
      <details open={!simple}><summary>저장 이름·연료 환산 기준</summary><div className="planning-input-grid">
        {simple && <label>전망 이름<input required maxLength={100} value={scenario.name} onChange={e => updateScenario({name:e.target.value})}/></label>}
        <label>연료 환산 발열량 (kcal/kg)<input type="number" min={1000} max={10000} required value={base.payload.fuel.calorific_kcal_kg} onChange={e => updateFuel({calorific_kcal_kg:Number(e.target.value)})}/></label>
        <label>발열량 기준<select value={String(base.payload.fuel.is_assumption)} onChange={e => updateFuel({is_assumption:e.target.value === 'true'})}><option value="true">가정값</option><option value="false">사용자 확정값</option></select></label>
      </div></details>
      <details><summary>수요·기상과 계산 조건</summary><div className="planning-input-grid">
        <label>기상 기준<select value={scenario.weather === 'normal' ? 'normal' : 'year'} onChange={e => updateScenario({weather:e.target.value === 'normal' ? 'normal' : ''})}><option value="normal">평년 기상</option><option value="year">특정 연도 기상</option></select></label>
        {scenario.weather !== 'normal' && <label>기상 연도<input type="number" min={1900} max={2100} value={scenario.weather} onChange={e => updateScenario({weather:e.target.value})}/><small>모델에 저장된 기상 연도를 입력하세요.</small></label>}
        <label>수요 증가율 (%)<input type="number" step="any" min={-100} max={300} value={scenario.demand_growth_pct ?? ''} onChange={e => updateScenario({demand_growth_pct:numberOrNull(e.target.value)})}/><small>빈칸은 모델 기준을 사용합니다.</small></label>
        <label>태양광 증가율 (%)<input type="number" step="any" min={-100} max={300} value={scenario.solar_growth_pct ?? ''} onChange={e => updateScenario({solar_growth_pct:numberOrNull(e.target.value)})}/></label>
        <label>운전예비율 (%)<input type="number" step="any" min={0} max={100} value={Number((scenario.reserve_ratio * 100).toFixed(6))} onChange={e => updateScenario({reserve_ratio:Number(e.target.value)/100})}/></label>
        <label>계산 품질<select value={scenario.quality} onChange={e => updateScenario({quality:e.target.value})}><option value="fast">빠르게</option><option value="normal">기본</option><option value="precise">정밀하게</option></select></label>
        {!simple && <label>병렬 작업자 수<input type="number" min={1} max={32} value={scenario.workers ?? ''} onChange={e => updateScenario({workers:numberOrNull(e.target.value)})}/><small>빈칸은 서버 설정을 따릅니다.</small></label>}
      </div><h3>월별 석탄 목표 보정 (%)</h3><div className="planning-input-months">{scenario.coal_adjust_pct.map((value,i) => <label key={i}>{i+1}월<input type="number" required min={-100} max={300} step="any" value={value} onChange={e => updateScenario({coal_adjust_pct:scenario.coal_adjust_pct.map((n,j) => i===j ? Number(e.target.value) : n)})}/></label>)}</div></details>
      <details><summary>정비 일정 · 원전 {scenario.nuclear_oh.length}건 / 석탄 {scenario.coal_oh.length}건</summary><p className="planning-input-note">종료일은 정비에 포함됩니다. 기존 일정은 그대로 가져오며 필요한 항목을 직접 수정할 수 있습니다.</p>{(['nuclear_oh','coal_oh'] as const).map(kind => <div key={kind} className="planning-input-outages"><h3>{kind === 'nuclear_oh' ? '원전' : '석탄'} 정비</h3>{scenario[kind].map((row,i) => <div className="planning-input-outage" key={i}>{(['unit','start','end','note'] as const).map(field => <label key={field}>{({unit:'호기',start:'시작',end:'종료',note:'내용'})[field]}<input value={row[field] ?? ''} onChange={e => updateScenario({[kind]:scenario[kind].map((x,j) => j===i ? {...x,[field]:e.target.value} : x)})}/></label>)}<Button type="button" variant="outline" onClick={() => updateScenario({[kind]:scenario[kind].filter((_,j)=>j!==i)})}>삭제</Button></div>)}<Button type="button" variant="outline" onClick={() => updateScenario({[kind]:[...scenario[kind],{unit:'',start:'',end:'',note:''}]})}>정비 추가</Button></div>)}</details>
      <details><summary>호기별 월 열량단가 · {Object.keys(base.payload.heat_prices).length}개 호기</summary><p className="planning-input-note">단위: 원/Gcal. 표시된 호기 외의 단가도 기준 입력에서 그대로 유지됩니다.</p><label>단가를 볼 호기<select aria-label="단가를 볼 호기" value={unit} onChange={e=>setUnit(e.target.value)}>{Object.keys(base.payload.heat_prices).map(name=><option key={name}>{name}</option>)}</select></label><div className="planning-input-months">{(base.payload.heat_prices[unit] ?? []).map((price,i)=><label key={i}>{i+1}월<input type="number" step="any" value={price} onChange={e=>setBase(old=>old && ({...old,payload:{...old.payload,heat_prices:{...old.payload.heat_prices,[unit]:old.payload.heat_prices[unit].map((v,j)=>j===i?Number(e.target.value):v)}}}))}/></label>)}</div></details>
      {!readOnly && <div className="planning-input-actions"><Button type="submit" variant="outline" disabled={busy}>입력 저장</Button><Button type="button" disabled={busy} onClick={e=>{const form=e.currentTarget.form;if(form?.reportValidity()) submit(true);}}>저장 후 전망 실행</Button></div>}
      </fieldset>
    </form>}
  </section>;
}
