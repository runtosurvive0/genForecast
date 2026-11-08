import {yard2,profileFor,heapPlacement,estimateClearances} from '../../data/fuel-reference/yard2-calibration.js';

// Same mass/shape and upper-edge definition as the shared heap renderer.
// Points are in the transfer model's local coordinates, before view transforms.
export function selectedClearances(lots,id){
 const selected=lots.find(l=>(l.sourceId||l.id)===id);if(!selected)return null;
 const profile=profileFor(selected.pile),title=`${selected.pile?'Pile '+String(selected.pile).replace(/^P/,''):selected.shed+' Shed'} · ${selected.coal}`;
 const result={id,title,tons:selected.tons,required:profile?.benchGap,measurements:[],message:''};
 if(!profile){result.message='상부 이격 기준·단면 자료 미제공';return result;}
 if(selected.tons<=0){result.message='소진 구간 · 하역 시작 시 이격 표시';return result;}
 const byId=new Map(lots.map(l=>[l.sourceId||l.id,l]));
 result.measurements=estimateClearances(lots).filter(g=>g.ids.includes(id)).map(g=>{
  const [a,b]=g.ids.map(key=>heapPlacement(byId.get(key))),u=yard2.scene.scale;
  const ends=[[a.x+Math.max(0,a.length-a.width)*u/2,.26+a.height*u,a.z],[b.x-Math.max(0,b.length-b.width)*u/2,.26+b.height*u,b.z]];
  const level=Math.max(...ends.map(p=>p[1]))+2.2,line=ends.map(p=>[p[0],level,p[2]]),neighbourId=g.ids.find(key=>key!==id);
  return {...g,key:g.ids.join(':'),neighbourId,neighbour:byId.get(neighbourId).coal,side:g.ids[0]===id?'오른쪽':'왼쪽',ends,line,
   state:!g.positionConfirmed?'unknown':g.benchGap<g.required-1e-6?'breach':'clear'};
 });
 if(!result.measurements.length)result.message='같은 Pile에 인접 더미 없음';
 return result;
}
