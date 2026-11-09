import {BerthRoutes} from './berth-routes.js';
/* Dangjin receiving topology, transcribed from the supplied handling schematic.
 * Primary: coal-source.pdf, 2022-07-01, including TT-52/92 and TT-53/93 insets.
 * Cross-check: IMG_2820.JPEG (2026-11-04 operational schematic).
 * Coordinates express the drawing's spatial relationships; they are not surveyed.
 * Routes are inspectable valid receiving routes, not a dispatch or live gate state.
 */
export const BerthNetwork = (() => {
  'use strict';
  const assets=[];
  function add(id,code,name,kind,points,extra={}){assets.push({id,code,name,kind,points,...extra});}
  add('csu01','CSU-01A/B','1부두 연속식 하역기','unloader',[[-95,46],[-70,46]],{berth:1});
  add('csu51','CSU-51C/D','2부두 연속식 하역기','unloader',[[46,46],[67,46]],{berth:2});
  add('csu91','CSU-91E/F','3부두 연속식 하역기','unloader',[[102,46],[124,46]],{berth:3});
  const tower=(id,code,x,z,extra={})=>add(id,code,'이송·분기 타워','tower',[[x,z]],extra);
  tower('tt01','T/T-01',-23,46);tower('tt02','T/T-02',-23,24);tower('tt03','T/T-03',-23,2);
  tower('tt51','T/T-51',-8,46);tower('tt91','T/T-91',10,42);
  tower('tt5292','T/T-52 · T/T-92',1,24,{twin:true,gates:'FG-52A1/A2/A3 · FG-52B1/B2/B3 · FG-52C'});
  tower('tt5393','T/T-53 · T/T-93',1,2,{twin:true,gates:'FG-53A1/A · FG-53B1/B · FG-53C1/C2 · FG-61A'});
  tower('tt94','T/T-94',5,-16,{wide:15});tower('tt95','T/T-95',28,-31);
  const belt=(id,code,a,b,count=1,extra={})=>add(id,code,'벨트 컨베이어','belt',[a,b],{count,...extra});
  belt('cv01ab','CV-01A/B',[-119,46],[-23,46],2);
  belt('cv02ab','CV-02A/B',[-23,46],[-23,24],2);
  belt('cv03ab','CV-03A/B',[-23,24],[-23,2],2);
  belt('cv04a','CV-04A',[-23,2],[-132,2]);
  belt('cv04b','CV-04B',[-23,24],[-132,24]);
  belt('cv51ab','CV-51A/B',[141,46],[-8,46],2);
  belt('cv51c','CV-51C',[141,42],[10,42]);
  belt('cv52ab','CV-52A/B',[-8,46],[-8,24],2);
  belt('cv52c','CV-52C',[10,42],[10,24]);
  belt('cv53ab','CV-53A/B',[-8,24],[-8,2],2);
  belt('cv53c','CV-53C',[10,24],[10,2]);
  // Separate directional crossfeeds; the opposite-facing belts are not one bidirectional edge.
  belt('cv60a','CV-60A',[-8,.4],[-23,.4]);
  belt('cv61a','CV-61A',[-23,4.2],[-8,4.2]);
  belt('cv54a','CV-54A',[-8,2],[137,2]);
  belt('cv54b','CV-54B',[-8,24],[137,24]);
  belt('cv91ab','CV-91A/B',[0,2],[0,-16],2);
  belt('cv91c','CV-91C',[10,2],[10,-16]);
  belt('cv92ab','CV-92A/B',[5,-16],[28,-31],2,{height:6});
  belt('cv93a','CV-93A',[28,-32.5],[137,-32.5]);
  belt('cv93b','CV-93B',[28,-29.5],[137,-29.5]);
  add('sr01a','S/R-01A','상하탄기 · Pile 1·2','stacker',[[-99,2]],{ends:['pile-1','pile-2']});
  add('sr01b','S/R-01B','상하탄기 · Pile 3·4','stacker',[[-102,24]],{ends:['pile-3','pile-4']});
  add('sr51a','S/R-51A','상하탄기 · Pile 5·6','stacker',[[86,2]],{ends:['pile-5','pile-6']});
  add('sr51b','S/R-51B','상하탄기 · Pile 7·8','stacker',[[103,24]],{ends:['pile-7','pile-8']});
  add('tr91a','TR-91A','트리퍼 · A Shed','tripper',[[76,-32.5]],{ends:['shed-a']});
  add('tr91b','TR-91B','트리퍼 · B Shed','tripper',[[111,-29.5]],{ends:['shed-b']});
  // Reclaim-only equipment remains visible as context; it is never selected as an incoming route.
  belt('cv05a','CV-05A',[-31,13],[-132,13],1,{outbound:true});
  belt('cv54c','CV-54C',[137,13],[-5,13],1,{outbound:true});
  add('re01','RE-01','상탄기 · 반출 전용','reclaimer',[[-91,13]],{outbound:true});
  add('re51a','RE-51A','상탄기 · 반출 전용','reclaimer',[[91,13]],{outbound:true});
  tower('tt04','T/T-04',-132,24,{outbound:true});tower('tt05','T/T-05',-132,13,{outbound:true});tower('tt06','T/T-06',-132,2,{outbound:true});
  tower('tt55','T/T-55',-5,13,{outbound:true});
  // Display numbers are stable identifiers, never positions in a sorted asset list.
  const numbers={csu01:'1',csu51:'2',csu91:'3',tt01:'4',tt02:'5',tt03:'6',tt51:'7',tt91:'8',tt5292:'9',tt5393:'10',tt94:'11',tt95:'12',cv01ab:'13',cv02ab:'14',cv03ab:'15',cv04a:'16',cv04b:'17',cv51ab:'18',cv51c:'19',cv52ab:'20',cv52c:'21',cv53ab:'22',cv53c:'23',cv60a:'24',cv61a:'25',cv54a:'26',cv54b:'27',cv91ab:'28',cv91c:'29',cv92ab:'30',cv93a:'31',cv93b:'32',sr01a:'33',sr01b:'34',sr51a:'35',sr51b:'36',tr91a:'37',tr91b:'38',cv05a:'39',cv54c:'40',re01:'41',re51a:'42',tt04:'43',tt05:'44',tt06:'45',tt55:'46'};
  const parts=assets.filter(a=>a.twin).flatMap(a=>['A','B'].map((side,index)=>({...a,id:a.id+side,code:numbers[a.id]+side,parentId:a.id,signal:a.id+side,twin:false,side,number:numbers[a.id]+side,points:[[a.points[0][0]+(index===0?-9:9),a.points[0][1]]]})));
  const equipment=assets.filter(a=>!a.twin).concat(parts);
  const get=id=>assets.find(a=>a.id===id)||parts.find(a=>a.id===id)||null;
  const label=id=>{const a=get(id);return a?.twin?`${numbers[id]}A·${numbers[id]}B`:a?.number||numbers[id]||'';};
  const entryPart=(id,berth)=>get(id)?.twin?id+(berth===3?'B':'A'):id;
  const head={1:['csu01','cv01ab','tt01','cv02ab','tt02'],2:['csu51','cv51ab','tt51','cv52ab','tt5292A'],3:['csu91','cv51c','tt91','cv52c','tt5292B']};
  function path(berth,end){
    if(!BerthRoutes.canReach(berth,end))return [];
    const p=[...head[berth]],pile=BerthRoutes.endpoint(end).pileNo;
    if(berth===1){
      if(pile===3||pile===4)return p.concat('cv04b','sr01b');
      p.push('cv03ab','tt03');
      if(pile===1||pile===2)return p.concat('cv04a','sr01a');
      p.push('cv61a','tt5393A');
    }else{
      if(pile===7||pile===8)return p.concat(berth===3?['tt5292A']:[],'cv54b','sr51b');
      p.push(berth===2?'cv53ab':'cv53c',berth===2?'tt5393A':'tt5393B');
      if(berth===3&&pile)p.push('tt5393A');
      if(pile===1||pile===2)return p.concat('cv60a','tt03','cv04a','sr01a');
    }
    if(pile===5||pile===6)return p.concat('cv54a','sr51a');
    if(berth===1)p.push('tt5393B');
    return p.concat(berth===2?'cv91ab':'cv91c','tt94','cv92ab','tt95',end==='shed-a'?'cv93a':'cv93b',end==='shed-a'?'tr91a':'tr91b');
  }
  function all(berth){return [...new Set(BerthRoutes.forBerth(berth).filter(e=>e.reachable).flatMap(e=>path(berth,e.id)))];}
  function adjacent(id){
    const before=new Set(),after=new Set();
    for(const b of [1,2,3])for(const e of BerthRoutes.endpoints){const p=path(b,e.id),i=p.indexOf(id);if(i<0)continue;if(i>0)before.add(get(p[i-1]).code);if(i<p.length-1)after.add(get(p[i+1]).code);else after.add(e.label);}
    return {before:[...before],after:[...after]};
  }
  const yardAssets=id=>id===1?['cv04a','cv04b','cv05a','sr01a','sr01b','re01','tt04','tt05','tt06','tt03','tt02','cv03ab']:id===2?['cv54a','cv54b','cv54c','sr51a','sr51b','re51a','tt55','tt5292','tt5393','cv53ab','cv53c']:id===3?['cv93a','cv93b','tr91a','tr91b','tt95','cv92ab','tt94']:[];
  return Object.freeze({assets,equipment,parts,get,label,entryPart,path,all,head,adjacent,yardAssets,source:'이송설비 연결 배치'});
})();
