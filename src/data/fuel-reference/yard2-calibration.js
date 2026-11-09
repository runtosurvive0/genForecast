// User photographs: 최적 저탄용량 산정 / 저탄 더미간 이격거리 개선 결과.
// Widths, heights, bench clearances and capacities are transcribed.
// The inventory chart uses a descending 720 m axis. Its rectangles are stock
// records (including a 0 t rectangle), NOT a surveyed remaining-coal surface.
// 500 m is only the effective capacity-reference length from total / t per 100 m.
const profiles=[
 {pile:5,width:27.5,height:10.5,optimal:65000,operating:57800,maximum:80000,maxWidth:31.5,maxHeight:10.5,benchGap:40,lossPerGap:3600},
 {pile:6,width:41,height:14.3,optimal:135000,operating:119000,maximum:140000,maxWidth:43.1,maxHeight:15,benchGap:45,lossPerGap:8000},
 {pile:7,width:21.5,height:7.3,optimal:40000,operating:36000,maximum:40000,maxWidth:23.3,maxHeight:7.3,benchGap:25,lossPerGap:2000},
 {pile:8,width:29.5,height:9.7,optimal:60000,operating:53000,maximum:77500,maxWidth:30.9,maxHeight:9.7,benchGap:40,lossPerGap:3500}
].map(Object.freeze);
export const chartRanges=Object.freeze(Object.fromEntries(Object.entries({
 'p5-a':[570,620],'p5-b':[490,520],'p5-c':[380,430],'p5-d':[130,200],
 'p6-a':[570,590],'p6-b':[500,545],'p6-c':[240,340],'p6-d':[130,200],
 'p7-a':[400,610],'p7-b':[140,330],
 'p8-a':[490,590],'p8-b':[400,450],'p8-d':[230,290]
}).map(([id,range])=>[id,Object.freeze(range)])));
// Rounded to 5–10 m: photo perspective and line thickness preclude exact readings.
// p8-c / p8-e are absent from this chart; preserve their earlier inventory and
// demo positions, explicitly marked unconfirmed, rather than deleting 6,242 t.
const lengthM=720,capacityReferenceLengthM=500,scale=114/500,left=23,right=left+lengthM*scale;
const clearance=4.5*scale,railA=2;
const centerZ={5:railA-clearance-profiles[0].width*scale/2,6:railA+clearance+profiles[1].width*scale/2};
const reclaimRail=centerZ[6]+profiles[1].width*scale/2+clearance,wallZ=reclaimRail+1.2;
centerZ[7]=wallZ+13*scale+profiles[2].width*scale/2;
const railB=centerZ[7]+profiles[2].width*scale/2+clearance;
centerZ[8]=railB+clearance+profiles[3].width*scale/2;
const north=centerZ[5]-profiles[0].width*scale/2-clearance,south=centerZ[8]+profiles[3].width*scale/2+clearance;
export const yard2=Object.freeze({profiles,lengthM,capacityReferenceLengthM,operating:265800,optimal:300000,maximum:337500,operatingHeapCount:3,
 source:'제2저탄장 하역 실증 / 최적 저탄용량 산정 · 참고 자료',sourceDate:null,
 scene:Object.freeze({scale,left,right,length:right-left,centerX:(left+right)/2,railA,railB,reclaimRail,wallZ,centerZ:Object.freeze(centerZ),north,south,width:south-north,center:(north+south)/2})});
export const profileFor=pile=>profiles.find(p=>p.pile===Number(String(pile).replace(/^P/,'')));
// Triangular-section windrow, with two rounded half-cone ends.
// V = WH/2 × (L − W + πW/6). The source capacity calibrates mass / volume,
// avoiding an invented universal coal density. No claim of survey accuracy.
const endCorrection=1-Math.PI/6;
export const heapVolume=d=>d.width*d.height/2*Math.max(0,d.length-endCorrection*d.width);
export function estimateHeap(pile,tons){
 const p=profileFor(pile);if(!p)throw new RangeError('Pile 5–8만 환산합니다.');
 if(!Number.isFinite(tons)||tons<0)throw new RangeError('재고는 유효한 0 이상의 톤수여야 합니다.');
 if(tons===0)return {length:0,width:0,height:0,tons,pile:p.pile,estimated:true,outsideReference:false};
 const rate=p.optimal/(capacityReferenceLengthM-endCorrection*p.width),coneTons=rate*Math.PI*p.width/6;
 const k=tons<coneTons?Math.cbrt(tons/coneTons):1;
 const length=tons<coneTons?p.width*k:tons/rate+endCorrection*p.width;
 return {length,width:p.width*k,height:p.height*k,tons,pile:p.pile,estimated:true,outsideReference:tons>p.optimal};
}
export function photoPosition(lot){
 const range=lot.range||chartRanges[lot.sourceId||lot.id],centerM=range?(range[0]+range[1])/2:(1-(lot.span[0]+lot.span[1])/2)*lengthM;
 return {centerM,photoRange:range||null,positionSource:range?'photo-axis':'previous-demo',
  x:left+(lengthM-centerM)*scale};
}
export function heapPlacement(lot,tons=lot.tons){
 const d=estimateHeap(lot.pile,tons),p=photoPosition(lot),fromM=p.centerM-d.length/2,toM=p.centerM+d.length/2;
 return {...d,...p,fromM,toM,startFraction:(lengthM-toM)/lengthM,widthFraction:d.length/lengthM,z:centerZ[d.pile]};
}
// Compare upper ridge endpoints, not toe-to-toe ground gaps. These are model
// estimates for visual review, never a live operating interlock or survey result.
export function estimateClearances(lots){
 const result=[];
 for(const p of profiles){const heaps=lots.filter(l=>profileFor(l.pile)?.pile===p.pile&&l.tons>0).map(l=>({...heapPlacement(l),id:l.sourceId||l.id})).sort((a,b)=>b.centerM-a.centerM);
  for(let i=1;i<heaps.length;i++){const a=heaps[i-1],b=heaps[i],distance=a.centerM-b.centerM,benchGap=distance-(Math.max(0,a.length-a.width)+Math.max(0,b.length-b.width))/2;
   result.push({pile:p.pile,ids:[a.id,b.id],benchGap,groundGap:distance-(a.length+b.length)/2,required:p.benchGap,shortfall:Math.max(0,p.benchGap-benchGap),positionConfirmed:a.positionSource==='photo-axis'&&b.positionSource==='photo-axis'});
  }
 }
 return result;
}
export function dimensionText(pile,tons){const d=estimateHeap(pile,tons),f=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:1});return `${f(d.length)} × ${f(d.width)} × ${f(d.height)} m`;}

