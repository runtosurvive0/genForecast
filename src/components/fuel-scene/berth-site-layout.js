import {yard2} from '../../data/fuel-reference/yard2-calibration.js';
// Illustrative plan proportions from the Google Earth capture and the user's
// identification: 1 open, 2 partially roofed, 3 fully roofed with solar panels.
// Units are scene units, NOT metres; roof height/capacity cannot be inferred.
export const siteLayout=Object.freeze({
  basis:'참고 배치 · 실측 아님',
  yards:[
    {id:1,length:99,width:36.08,x:-80.5,z:13.5,roof:'open'},
    {id:2,length:yard2.scene.length,width:yard2.scene.width,x:yard2.scene.centerX,z:yard2.scene.center,roof:'partial',basis:'참고 자료 기준 · 폭/높이 실증표 · 길이/형상 추정'},
    {id:3,length:110,width:24,x:82.5,z:-23.5,roof:'solar'}
  ]
});
// Keep the source graph intact. These are visual coordinates only. Shared
// connections receive identical transforms, including the two crossfeeds.
export function sitePoint(id,[x,z]){
  if(['cv54a','cv54b','cv54c','sr51a','sr51b','re51a'].includes(id)&&x>=23)x=23+(x-23)*yard2.lengthM/500;
  if(x>=-8){if(z===24)z=yard2.scene.railB;else if(z===13)z=yard2.scene.reclaimRail;}
  if(x<-20&&z<38)z=13.5+(z-13.5)*.82;
  if(id==='tt95')z=-23.5;
  if(id==='cv92ab'&&x===28)z=-23.5;
  if(id==='cv93a'||id==='tr91a')z=-25;
  if(id==='cv93b'||id==='tr91b')z=-22;
  if((id==='cv93a'||id==='cv93b')&&x===137)x=127.5;
  return [x,z];
}

// Display registration against the user's whole-site Earth view (2024-04-12
// imagery, inspected 2026-11-06). The source network remains a topology, not a
// survey. Yard-detail metres and inventory calculations are deliberately unchanged.
export const harbourLayout=Object.freeze({
  basis:'Google Earth 제공 전체 부지 영상 · 배치·외곽 비례 참고, 실측 아님',
  shoreZ:42,waterY:-2.6,
  yard1Stretch:1.3,yard3Offset:30,
  jetties:[
    {berths:[1],from:[-84,146],to:[-23,146],width:8},
    {berths:[2,3],from:[-8,146],to:[143,146],width:10}
  ],
  bridges:[
    {id:'01',shore:[-23,42],sea:[-23,146],width:5.4,assets:['cv02ab']},
    {id:'51',shore:[-5.5,42],sea:[-5.5,146],width:9,assets:['cv52ab','cv52c']}
  ],
  vessels:{1:{x:-59,z:159.5},2:{x:56.5,z:159.5},3:{x:112,z:159.5}}
});
export const yard1DisplayX=x=>-23+(x+23)*harbourLayout.yard1Stretch;
export function harbourPoint(id,p){
  let [x,z]=sitePoint(id,p);
  if(['csu01','cv01ab'].includes(id))return [-23+(x+23)*.62,146];
  if(id==='tt01')return [-23,146];
  if(['csu51','csu91','cv51ab','tt51'].includes(id))return [x,146];
  if(id==='tt91')return [-3,142];
  if(id==='cv51c')return [x===10?-3:x,142];
  if(id==='cv02ab'&&p[1]===46)return [-23,146];
  if(id==='cv52ab'&&p[1]===46)return [-8,146];
  if(id==='cv52c'&&p[1]===42)return [-3,142];
  if(x<-23)x=yard1DisplayX(x);
  if(['tt95','cv93a','cv93b','tr91a','tr91b'].includes(id)||(id==='cv92ab'&&p[0]===28))x+=harbourLayout.yard3Offset;
  return [x,z];
}
harbourPoint.projectTarget=(point,lotId)=>{
  const next=[...point];
  if(/^P[1-4]-/.test(lotId))next[0]=yard1DisplayX(next[0]);
  else if(/^[ab]\d/.test(lotId))next[0]+=harbourLayout.yard3Offset;
  return next;
};
harbourPoint.beltPoints=(id,points)=>id==='cv52c'?[points[0],[-3,42],points[1]]:points;

// Cut out only the middle of the straight offshore crossing. The quay, ship
// and unloaders translate together, retaining their original local dimensions.
const routePoint = ([x,z]) => [x,z > 100 ? z - 82 : z];
export const receivingPoint = (id,p) => routePoint(harbourPoint(id,p));
receivingPoint.projectTarget = harbourPoint.projectTarget;
receivingPoint.beltPoints = harbourPoint.beltPoints;
export const receivingLayout = {
  ...harbourLayout,
  jetties: harbourLayout.jetties.map(jetty => ({...jetty,from:routePoint(jetty.from),to:routePoint(jetty.to)})),
  bridges: harbourLayout.bridges.map(bridge => ({...bridge,sea:routePoint(bridge.sea)})),
  vessels: Object.fromEntries(Object.entries(harbourLayout.vessels).map(([id,{x,z}]) => [id,{x,z:routePoint([x,z])[1]}])),
};
