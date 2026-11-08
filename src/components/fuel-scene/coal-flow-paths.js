import {StockSnapshot} from '../../data/fuel-reference/stock-snapshot.js';
import {yard2,photoPosition,chartRanges} from '../../data/fuel-reference/yard2-calibration.js';
import {transferGeometry as G,beltHeight,unloaderGeometry} from './transfer-geometry.js';
import {harbourLayout} from './berth-site-layout.js';
const terminal={cv04a:'sr01a',cv04b:'sr01b',cv54a:'sr51a',cv54b:'sr51b',cv93a:'tr91a',cv93b:'tr91b'};
const receiving={cv01ab:'csu01',cv51ab:'csu51',cv51c:'csu91'};
export function unloaderPoints(asset,sitePoint){
 const center=harbourLayout.vessels[asset.berth].x;
 const intakeOffset=unloaderGeometry().boot[0]*G.unloaderScale;
 return asset.points.map(point=>{
  const [x,z]=sitePoint(asset.id,point);
  const hold=Math.max(-3,Math.min(3,Math.round((x+intakeOffset-center)/(22*.19))));
  return [center+hold*22*.19-intakeOffset,z];
 });
}
export function workFor(id,state){return Object.values(state?.material?.jobs||{}).find(j=>j?.machine===id)||null;}
export function machinePose(asset,state,sitePoint){
 const base=sitePoint(asset.id,asset.points[0]),job=workFor(asset.id,state),range=asset.id.includes('01')||asset.id==='re01'?[-126,-84.5].map(x=>sitePoint(asset.id,[x,asset.points[0][1]])[0]):asset.kind==='tripper'?[41.5,123.5].map(x=>sitePoint(asset.id,[x,asset.points[0][1]])[0]):[yard2.scene.left+4,yard2.scene.right-4];
 if(job&&['stacker','reclaimer'].includes(asset.kind)){
  const target=sitePoint.projectTarget?.(job.pose.target,job.lotId)||[...job.pose.target],pile=Number(job.lotId.match(/^p([5-8])-/)?.[1]);if(pile){target[2]=yard2.scene.centerZ[pile];const source=chartRanges[job.lotId]?{id:job.lotId}:StockSnapshot.lots.find(l=>l.id===job.lotId);if(source)target[0]=photoPosition(source).x;}
  const dz=target[2]-base[1],reach=Math.hypot(10.7,5.5),dx=(Math.cos(job.pose.angle)<0?1:-1)*Math.sqrt(Math.max(0,reach*reach-dz*dz));
  return {x:target[0]-dx,z:base[1],angle:Math.atan2(-5.5,-10.7)-Math.atan2(dz,dx),target};
 }
 return {x:range[0]+(range[1]-range[0])*(state.equipment[asset.id]?.position??50)/100,z:base[1],angle:0,target:job?.pose.target};
}
export function assetFlowPaths(asset,state,N,sitePoint){
 if(!asset)return [];const id=asset.id,h=beltHeight(asset)+.25,points=asset.points.map(p=>sitePoint(id,p));
 const path=(points,kind)=>({points,...(kind?{drop:{from:points.length-2,to:points.length-1,kind}}:{})});
 if(asset.kind==='unloader')return unloaderPoints(asset,sitePoint).map(([x,z])=>{
  const {head,boot}=unloaderGeometry();
  return path([boot,[head[0],boot[1],head[2]],head,[0,17,0],G.unloaderOutlet,[5,G.coal/G.unloaderScale,0]].map(([a,b,c])=>[x+a*G.unloaderScale,b*G.unloaderScale,z+c*G.unloaderScale]),'belt');
 });
 if(['stacker','reclaimer','tripper'].includes(asset.kind)){
  const p=machinePose(asset,state,sitePoint),cos=Math.cos(p.angle),sin=Math.sin(p.angle),world=([x,y,z])=>[p.x+x*cos+z*sin,y,p.z-x*sin+z*cos];
  if(asset.kind==='tripper'){const sign=asset.ends[0]==='shed-a'?-1:1;return [path([[-5,G.coal,0],[2,G.tripperHead,0],[2,G.tripperOutlet,sign*5],[2,.4,sign*5]].map(world),'pile')];}
  const tip=world([-10.7,asset.kind==='reclaimer'?G.reclaimTip:G.stackerTip,-5.5]),ground=p.target||[tip[0],.35,tip[2]],center=world([0,G.center,0]);
  if(asset.kind==='reclaimer')return [path([ground,tip,center,world([2.2,G.coal,0])])];
  return [path([world([6,G.coal,0]),world([1,G.center+.2,0]),center,tip,ground],'pile')];
 }
 if(asset.kind==='belt'){
  const [a,b]=points,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),n=[-dz/len,dx/len];
  const displayed=sitePoint.beltPoints?.(id,points);if(displayed?.length>2)return [path(displayed.map(([x,z])=>[x,h,z]))];
  if(receiving[id])return assetFlowPaths(N.get(receiving[id]),state,N,sitePoint).map((feed,i)=>{const out=feed.points.at(-1),offset=asset.count===2?(i-.5)*1.5:0;return path([out,[out[0]+n[0]*offset,h,a[1]+n[1]*offset],[b[0]+n[0]*offset,h,b[1]+n[1]*offset]]);});
  if(terminal[id])return [path([[a[0],h,a[1]],assetFlowPaths(N.get(terminal[id]),state,N,sitePoint)[0].points[0]])];
  if(id==='cv05a'||id==='cv54c'){const source=assetFlowPaths(N.get(id==='cv05a'?'re01':'re51a'),state,N,sitePoint)[0].points.at(-1);return [path([source,[b[0],h,b[1]]])];}
  return Array.from({length:asset.count||1},(_,i)=>{const offset=(i-((asset.count||1)-1)/2)*1.5;return path([[a[0]+n[0]*offset,h,a[1]+n[1]*offset],[b[0]+n[0]*offset,h,b[1]+n[1]*offset]]);});
 }
 return [];
}
export function isCoalFlowing(asset,state,online,N){
 const r=state?.equipment[asset.id];return !!online&&r?.status==='running'&&r.flow>0;
}
export function samplePath(points,t){
 const lengths=points.slice(1).map((p,i)=>Math.hypot(...p.map((v,k)=>v-points[i][k]))),total=lengths.reduce((a,b)=>a+b,0);let d=Math.max(0,Math.min(1,t))*total;
 for(let i=0;i<lengths.length;i++){if(d<=lengths[i]||i===lengths.length-1){const f=lengths[i]?d/lengths[i]:0,delta=points[i+1].map((v,k)=>v-points[i][k]);return {point:points[i].map((v,k)=>v+delta[k]*f),tangent:delta.map(v=>v/(lengths[i]||1))};}d-=lengths[i];}
 return {point:points[0],tangent:[1,0,0]};
}
// Ballistic vertical acceleration with a fixed landing point on the coal surface.
export function sampleFall(a,b,t){const u=Math.max(0,Math.min(1,t));if(u===0)return [...a];if(u===1)return [...b];return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u*u,a[2]+(b[2]-a[2])*u];}
