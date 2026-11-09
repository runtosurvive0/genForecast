import {useEffect,useMemo,useState} from 'react';
import {ArrowRight, Factory, Layers3, Route, Radio, SlidersHorizontal, Info} from 'lucide-react';
import {FuelScene} from '@/components/fuel-scene/FuelScene';
import {blendLines,silosPerUnit} from '@/data/fuel-reference/blend-lines.js';
import {getReferenceLotTons} from '@/domain/fuel-reference';
import {yardBaselineLots} from '@/domain/yard-baseline-lots.js';
import {useYardBaseline} from '@/domain/use-yard-baseline';
import {blendReading} from '@/domain/blend';
import {InventoryWorkspace} from '@/components/inventory/InventoryWorkspace';
import type {FuelDemoSnapshot} from '@/domain/fuel-demo/types';
import {AssistantSection} from '@/components/assistant-section/AssistantSection';
import {SCREEN_QUESTIONS,type AssistantContext,type LotDetail} from '@/domain/assistant-checks';
import './operations-blend.css';

const fmt=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:1});
export function OperationsBlend({theme,snapshot,status,view,onView,onNavigate,onAsk,onOpenYard,initialLotId}:{
  initialLotId:string|null;onOpenYard:(id?:string)=>void;
  theme:'light'|'dark';snapshot:FuelDemoSnapshot|null;status:string;
  view:'diagram'|'analysis';onView:(view:'diagram'|'analysis')=>void;
  onNavigate:(page:string)=>void;onAsk:(question:string,context:AssistantContext)=>void;
}){
  const baseline=useYardBaseline();
  const [lotDetails,setLotDetails]=useState<Record<string,LotDetail>|null>(null);
  const referenceLots=useMemo(()=>yardBaselineLots(baseline.data?.lots??[],true),[baseline.data]);
  const baselineStock=useMemo(()=>Object.fromEntries((baseline.data?.lots??[]).filter(row=>row.source_id).map(row=>[row.source_id!,row.tonnes])),[baseline.data]);
  const baselineDetails=useMemo(()=>Object.fromEntries((baseline.data?.lots??[]).filter(row=>row.source_id).map(row=>[row.source_id!,{coal:row.coal_name,voyage:row.voyage_number??'',days:row.age_days??null}])),[baseline.data]);
  const initialLot=referenceLots.find(lot=>lot.id===initialLotId);
  const [yard,setYard]=useState<1|2|3>(initialLot?.yard ?? 1);
  const line=blendLines.find(l=>l.id===yard)!;
  const [unit,setUnit]=useState<number>(line.units[0]),[lotId,setLotId]=useState<string|null>(initialLot?.id ?? null);
  useEffect(()=>{const lot=referenceLots.find(item=>item.id===initialLotId);if(lot){setYard(lot.yard);setUnit(blendLines.find(item=>item.id===lot.yard)!.units[0]);setLotId(lot.id);}},[initialLotId,referenceLots]);
  const demo=status==='disabled'?null:snapshot,reading=blendReading(yard,demo,status);
  const lot=referenceLots.find(l=>l.id===lotId),unitValue=demo?.units?.[String(unit)];
  const unitSilos=Array.from({length:6},(_,i)=>demo?.silos?.[`${unit}-${i+1}`]);
  const offline=line.units.some(id=>!demo?.units?.[String(id)]);
  const siloReady=unitSilos.every(Boolean);
  const changeLine=(id:1|2|3)=>{setYard(id);setUnit(blendLines.find(l=>l.id===id)!.units[0]);setLotId(null);};
  const currentLot=lot??referenceLots.find(l=>l.id===reading.lot?.id);
  const route=['저탄장 반출',...line.stages.flatMap((_,i)=>[`이송 설비 ${i+1}번`,`분기 ${i+1}번`]),'호기별 분배'];
  return <div className={`gf-operations-blend ${view==='analysis'?'is-analysis':''} ${siloReady?'has-silos':''}`} data-testid="operations-blend">
    <header className="gf-bl-heading">
      <div><h1>상탄·혼탄</h1><p>당진발전본부 · 저탄장에서 보일러까지</p></div>
      <div className="gf-bl-view" role="group" aria-label="상탄 화면 보기">
        <button aria-pressed={view==='diagram'} onClick={()=>onView('diagram')}><Route size={16}/>공급 계통</button>
        <button aria-pressed={view==='analysis'} onClick={()=>onView('analysis')}><SlidersHorizontal size={16}/>혼탄 분석</button>
      </div>
    </header>
    <AssistantSection screen="blend" params={{yard}} context={{screen:'blend',selection:{yard,view,...(lotId&&view==='diagram'?{lot:lotId}:{})}}} questions={SCREEN_QUESTIONS.blend} onAsk={onAsk} onNavigate={onNavigate} onResult={r=>setLotDetails(r?r.details?.lots??{}:null)}/>
    {view==='analysis'?<div className="gf-bl-analysis"><InventoryWorkspace mode="blend" lotDetails={lotDetails}/></div>:<>
      <div className="gf-bl-command">
        <div className="gf-bl-line-tabs" role="group" aria-label="주 공급 계통 선택">
          {blendLines.map(l=><button key={l.id} aria-pressed={yard===l.id} onClick={()=>changeLine(l.id as 1|2|3)}><Factory size={16}/><span>{l.label}<small>{l.source}</small></span></button>)}
        </div>
        <span className="gf-bl-signal"><Radio size={14}/>{reading.source}{offline&&<em className="gf-bl-offline">운전 미연결</em>}</span>
      </div>
      <section className="gf-bl-stage" aria-label="상탄·분배 계통">
        <div className="gf-bl-stage-heading"><h2>{line.source} <ArrowRight size={15}/> {line.label} 보일러</h2><span>주계통 보기 · 교차 공급 생략</span></div>
        {baseline.data?.as_of ? <FuelScene mode="blend" yard={yard} berth={yard} theme={theme} snapshot={demo} baselineLots={baseline.data.lots} baselineStock={baselineStock} baselineDetails={baselineDetails} online={status==='online'} selectedLotId={lotId} onSelectLot={setLotId} selectedUnitId={unit} onSelectUnit={setUnit}/> : <p role="status">{baseline.error || '기준재고 확인 중'}</p>}
        <div className="gf-bl-units" role="group" aria-label="보일러 선택">
          {line.units.map(id=>{const u=demo?.units?.[String(id)];return <button key={id} aria-pressed={unit===id} onClick={()=>setUnit(id)}><Factory size={18}/><span>{id}호기{u&&<small>{status==='online'?({running:'운전',stopped:'정지',fault:'고장'}[u.status]):'마지막 수신값'}</small>}</span>{u&&<strong>{fmt(u.mw)}<small>MW</small></strong>}</button>;})}
        </div>
      </section>
      <div className="gf-bl-bottom">
        <section className="gf-bl-panel gf-bl-route"><header><h2><Route size={17}/>상탄 경로</h2><span>{reading.flowing?'상탄 중':reading.job?'작업 확인':'경로 참고'}</span></header>
          <ol>{route.map((code,i)=><li key={i}><span>{code}</span>{i<route.length-1&&<ArrowRight size={13}/>}</li>)}</ol>
          <div className="gf-bl-readings"><div><span>상탄 유량</span><strong>{fmt(reading.rate)}<small>t/h</small></strong></div><div><span>작업 누적</span><strong>{fmt(reading.moved)}<small>t</small></strong></div><p>{reading.job?'선택 계통의 상탄 작업 수신값':'조작반의 상탄 작업을 연결하면 유량과 누적량이 표시됩니다.'}</p></div>
          <p className="gf-bl-footnote">교차 공급 경로는 별도 확인이 필요합니다.</p>
        </section>
        <section className="gf-bl-panel gf-bl-coal"><header><h2><Layers3 size={17}/>선택 원탄</h2>{currentLot&&<span>{currentLot.pile?`Pile ${currentLot.pile}`:`${currentLot.shed} Shed`}</span>}</header>
          {currentLot?<><h3>{currentLot.coal}</h3><strong className="gf-bl-stock">{fmt(getReferenceLotTons(currentLot,demo))}<small>t</small></strong><div className="gf-bl-coal-meta"><span>{currentLot.voyage}</span><span>{currentLot.grade==='고'?'고열량':currentLot.grade==='저'?'저열량':'미확인'}</span><span>{baseline.data?.as_of} 기준</span></div></>:<div className="gf-bl-empty"><p>원탄을 선택하세요.</p><span>도면이나 상단 원탄 목록에서 원탄을 선택하면 재고와 탄종이 연결됩니다.</span></div>}
          <button className="gf-bl-link" onClick={()=>onView('analysis')}>원탄·혼탄 분석 열기<ArrowRight size={15}/></button>
        </section>
        <section className="gf-bl-panel gf-bl-boiler"><header><h2><Factory size={17}/>{unit}호기 공급</h2><button className="gf-bl-link" onClick={()=>onNavigate('units')}>호기·연소<ArrowRight size={15}/></button></header>
          <div className="gf-bl-chain"><span>사일로 {silosPerUnit}기</span><ArrowRight size={13}/><span>급탄기</span><ArrowRight size={13}/><span>미분기</span><ArrowRight size={13}/><span>보일러</span></div>
          <dl><div><dt>호기 출력</dt><dd>{fmt(unitValue?.mw)} <small>MW</small></dd></div><div><dt>사일로 잔량</dt><dd>{siloReady?`${fmt(unitSilos.reduce((n,s)=>n+(s?.tonnes ?? 0),0))} t`:'미연결'}</dd></div><div><dt>급탄량</dt><dd>{siloReady?`${fmt(unitSilos.reduce((n,s)=>n+(s?.actualRate ?? 0),0))} t/h`:'미연결'}</dd></div></dl>
          {siloReady&&<div className="gf-bl-silos" aria-label={`${unit}호기 사일로 현황`}>{unitSilos.map((s,i)=><div key={i}><span>{i+1}번</span><b>{fmt(s?.tonnes)} t</b><small>{status!=='online'?'마지막 수신':s?.status==='fault'?'고장':s?.status==='running'?(demo?.playing?(s.actualRate>0?'급탄 중':'잔량 없음'):'일시정지'):'정지'}</small></div>)}</div>}
          <p className="gf-bl-footnote">선택한 사일로로 상탄하며, 급탄 속도는 조작반에서 설정합니다.</p>
        </section>
      </div>
      <footer className="gf-bl-caption"><Info size={13}/><span>참고 배치 · 연결은 계통도 기준 · 설비 치수·내부 개념 표현</span><button onClick={()=>onOpenYard(currentLot?.id ?? referenceLots.find(lot=>lot.yard===yard)?.id)}>저탄·재고<ArrowRight size={13}/></button></footer>
    </>}
  </div>;
}
