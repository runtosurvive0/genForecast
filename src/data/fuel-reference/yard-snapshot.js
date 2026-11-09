import {initialReferenceTons} from './initial-stock.js';
import {StockSnapshot} from './stock-snapshot.js';
/* User-supplied photographs IMG_2820/2817, snapshot dated 2026-11-04.
   Positions are approximate readings of the photographed plot, not survey data.
   Equipment ON/OFF is not established by its coloured conveyor lines. */
export const YardData = (() => {
  const lots=[];
  function lot(id,pile,coal,voyage,tons,quality,from,to,age=null,history={}){
    lots.push({id,pile,name:coal,coal,voyage,tons,quality,from,to,age,...history});
  }
  lot('P1-G1','P1','Glencore','26-1-041',initialReferenceTons('P1-G1'),'고열량',350,420,null,{unloaded:12652,direct:0,bl:83769});
  lot('P2-K1','P2','KCH(Kaltim)','26-1-039',initialReferenceTons('P2-K1'),'저열량',380,420,14);
  lot('P2-C1','P2','Centennial','26-3-036',initialReferenceTons('P2-C1'),'고열량',174,310,3);
  lot('P3-G0','P3','Glencore','26-1-041',initialReferenceTons('P3-G0'),'고열량',390,420,null,{unloaded:4979,direct:4979,bl:83769});
  lot('P3-L1','P3','LXI','26-1-040',initialReferenceTons('P3-L1'),'고열량',230,380,10);
  lot('P3-G1','P3','Glencore','26-1-041',initialReferenceTons('P3-G1'),'고열량',30,130,null,{unloaded:26066,direct:4980,bl:83769});
  lot('P4-A1','P4','AVRA','26-1-038',initialReferenceTons('P4-A1'),'저열량',210,300,25);
  lot('P4-G1','P4','Glencore','26-1-041',initialReferenceTons('P4-G1'),'고열량',30,110,null,{unloaded:15799,direct:2695,bl:83769});
  // Same recovered snapshot as the berth model; preserve prior UI selection IDs.
  StockSnapshot.lots.filter(l=>l.yard==='P2').forEach((r,i)=>{
    lot(`P${r.pile}-${i}`,`P${r.pile}`,r.coal,r.voyage,r.tons,r.grade==='고'?'고열량':'저열량',null,null,r.days,{sourceId:r.id,span:r.span});
  });
  const cells=Array.from({length:20},(_,i)=>({id:`${i<10?'A':'B'}${10-i%10}`,pile:i<10?'A':'B',cell:true,name:'자료 미표시',coal:'—',voyage:'—',tons:null,quality:null,age:null}));
  function cell(id,coal,voyage,tons,quality,age){Object.assign(cells.find(c=>c.id===id),{name:coal,coal,voyage,tons,quality,age});}
  StockSnapshot.lots.filter(l=>l.yard==='P3').forEach(r=>{
    cell(r.shed+r.cell,r.coal,r.voyage,r.tons,r.grade==='고'?'고열량':'저열량',r.days);
    cells.find(c=>c.id===r.shed+r.cell).sourceId=r.id;
  });
  for(const id of ['A10','B1'])Object.assign(cells.find(c=>c.id===id),{name:'중기 출입로',access:true});
  const lanes=[473,550,550,473].map((lengthM,i)=>({id:`P${i+1}`,name:`Pile ${i+1}`,lengthM,x:0,z:-10.5+i*7,width:4.5}));
  const equipment=[
    ['SR01A','S/R-01A','상하탄기',15,-7],['RE01','RE-01','상탄기',-10,0],['SR01B','S/R-01B','상하탄기',12,7],
    ['CV04A','CV-04A','Pile 1·2 이송',-4,-7],['CV05A','CV-05A','Pile 2·3 이송',8,0],['CV04B','CV-04B','Pile 3·4 이송',-7,7],
    ['TT06','T/T-06','이송 타워',-30,-7],['TT05','T/T-05','이송 타워',-30,0],['TT04','T/T-04','이송 타워',-30,7],
    ['CV06','CV-06A/B','출구 이송',-34,-13],['BB01','B/B-01','분기 설비',-34,-21],['CV07','CV-07A/B','발전소 방향 이송',-26,-21],['SCB01','SCB-01','분쇄·분기 설비',-17,-21],['CV08','CV-08A/B','1–4호기 공급',-10,-25],
    ['TT03','T/T-03','반입 분기',31,-7],['TT02','T/T-02','반입 분기',31,7],['CV02','CV-02A/B','부두 반입선',33,14],['TT01','T/T-01','부두 이송 타워',33,21]
  ].map(([id,label,name,x,z])=>({id,label,name,x,z,state:'unknown',source:'운전 상태 신호 미연결'}));
  function pileLots(id){return lots.filter(l=>l.pile===id);}
  function segments(lane){
    const records=pileLots(lane.id).map(l=>({...l,x:(lane.lengthM/2-(l.from+l.to)/2)/10,z:lane.z,length:(l.to-l.from)/10,width:lane.width,kind:'lot'}));
    const occupied=records.map(r=>[r.from,r.to]).sort((a,b)=>a[0]-b[0]);let cursor=0,n=0;
    const gap=(from,to)=>({id:`${lane.id}-gap-${n++}`,pile:lane.id,name:'빈 바닥',from,to,x:(lane.lengthM/2-(from+to)/2)/10,z:lane.z,length:(to-from)/10,width:lane.width,kind:'gap',tons:null});
    const gaps=[];for(const [from,to]of occupied){if(from>cursor)gaps.push(gap(cursor,from));cursor=Math.max(cursor,to);}if(cursor<lane.lengthM)gaps.push(gap(cursor,lane.lengthM));
    return [...records,...gaps];
  }
  return {date:'2026.11.04',source:'첨부 운영화면 기준 · 실시간 미연결',lots,cells,lanes,equipment,pileLots,segments,sourceSnapshot:StockSnapshot,
    yards:[{name:'1저탄장',stock:109911,capacity:107000,operatingCapacity:90000,high:87098,low:22813,desc:'옥외 · Pile 1–4',cells:8},{name:'2저탄장',stock:106566,capacity:470000,operatingCapacity:200000,high:51925,low:54641,desc:'옥내 · Pile 5–8',cells:15},{name:'3저탄장',stock:146955,capacity:600000,operatingCapacity:460000,high:98516,low:48439,desc:'옥내 · A / B Shed',cells:20}]};
})();
