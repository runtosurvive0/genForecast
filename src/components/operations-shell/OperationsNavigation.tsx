import { Activity, ArrowRight, BarChart3, BookOpen, CalendarClock, CircleHelp, Database, Factory, FlaskConical, LayoutGrid, Network, Route, Settings2, Ship, SlidersHorizontal, TrendingUp, Users, Warehouse, Waves, Zap } from 'lucide-react';
import type { FuelDemoValue } from '@/domain/fuel-demo/types';
import { menuGroups, pageInfo, pageGroup, type Page } from '@/domain/navigation';
import type { PlanningState } from '@/domain/use-planning';
import { useYardBaseline } from '@/domain/use-yard-baseline';
import './operations-shell.css';
const icons: Record<Page, typeof Activity> = {overview:LayoutGrid,vessels:Ship,berth:Waves,yard:Warehouse,blend:Route,units:Factory,simulation:FlaskConical,procurement:BookOpen,costs:BarChart3,data:Database,connections:Network,members:Users,inventory:BookOpen,fuel:BookOpen,schedule:CalendarClock,scenario:SlidersHorizontal,models:Activity,'demo-control':SlidersHorizontal,forecast:TrendingUp};
const fmt = (v:number|null) => v === null ? '—' : v.toLocaleString('ko-KR',{maximumFractionDigits:0});
export { Gen4castBrand } from "./Gen4castBrand";
export function OperationsGroups({page,onNavigate}:{page:Page;onNavigate:(page:Page)=>void}) {
  return <nav className="gf-group-nav" aria-label="메뉴 그룹">{menuGroups.map(group=>{const Icon=group.id==='operations'?LayoutGrid:group.id==='planning'?BarChart3:group.id==='data'?Database:Settings2;return <button key={group.id} onClick={()=>onNavigate(group.pages[0])} aria-current={pageGroup(page)===group.id?'true':undefined}><Icon size={18}/><span>{group.label}</span></button>;})}</nav>;
}
export function OperationsNavigation({page,onNavigate,planning,demo,onHelp,observedBerths}:{observedBerths:number|null;synthetic:boolean;page:Page;onNavigate:(page:Page)=>void;planning:PlanningState;demo:FuelDemoValue;onHelp:()=>void}) {
  const baseline = useYardBaseline();
  const reference = page==='yard'||page==='berth';
  const stream = demo.status!=='disabled';
  const snapshot = stream ? demo.snapshot : null;
  const compatible = !!snapshot && !!baseline.data?.lots.length && baseline.data.lots.every(lot => lot.source_id && snapshot.material.lots[lot.source_id]);
  const stock = compatible ? snapshot!.material.totalStock : baseline.data?.total_t ?? null;
  const output = snapshot ? Object.values(snapshot.units).reduce((sum,u)=>sum+u.mw,0) : null;
  const source = baseline.data?.as_of ? `재고 기준 ${baseline.data.as_of}` : '기준재고 미연결';
  return <div className="gf-rail-content">
    <div className="gf-rail-heading"><span>연료 운영 현황</span><span className={`gf-signal ${demo.status==='online'?'is-online':''}`} title={source}/></div>
    <div className="gf-rail-metrics"><button className="gf-output" onClick={()=>onNavigate('units')}><span><Zap size={18}/>발전 출력</span><strong>{fmt(output)}<small>MW</small></strong><em>{snapshot?'운전 정보 수신':'실시간 운전 정보 미연계'}</em></button>
      <div className="gf-rail-pair"><button onClick={()=>onNavigate(reference||stream?'yard':'fuel')}><span><Warehouse size={16}/>총 저탄 재고</span><strong>{stock===null?'—':(stock/10000).toLocaleString('ko-KR',{maximumFractionDigits:2})}<small>만 t</small></strong></button><button onClick={()=>onNavigate('berth')}><span><Ship size={16}/>{stream?'접안 현황':'AIS 접안 추정'}</span><strong>{snapshot?Object.values(snapshot.material.ships).filter(s=>s.remaining>0).length:!stream?(observedBerths??'—'):'—'}<small>/ 3</small></strong></button></div>
    </div><p className="gf-rail-source">{source}</p>
    <div className="gf-stage-nav">{menuGroups[0].pages.map(id=>{const Icon=icons[id];return <button key={id} className={page===id?'is-active':''} aria-current={page===id?'page':undefined} onClick={()=>onNavigate(id)}><Icon size={21}/><span>{pageInfo[id].label}</span><ArrowRight size={15}/></button>;})}</div>
    <div className="gf-secondary-nav">{menuGroups.slice(1).map(group=><section key={group.id}><h2>{group.label}</h2><div>{group.pages.map(id=>{const Icon=icons[id];return <button key={id} className={page===id?'is-active':''} aria-current={page===id?'page':undefined} onClick={()=>onNavigate(id)}><Icon size={15}/><span>{pageInfo[id].label}</span></button>;})}</div></section>)}</div>
    <div className="gf-rail-bottom"><div className="sidebar-note"><span>{page==='vessels'?'선박별 출처·관측시각 확인':'계획·재고·운전 정보'}</span><small>{planning.failed?'ZGX 조회 실패 · 연결 상태 확인':'시각 KST · 재고 t · 열량 kcal/kg'}</small></div><button onClick={onHelp}><CircleHelp size={16}/>데이터·계산 안내<ArrowRight size={14}/></button></div>
  </div>;
}
