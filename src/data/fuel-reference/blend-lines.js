// User's 2022-07-01 handling drawing, checked against IMG_2820.
// Topology is transcribed; coordinates and building dimensions are illustrative.
const stage=(code,to,signal=null,houseSignal=null)=>({code,to,signal,houseSignal});
// User-confirmed on 2026-11-05; dimensions remain illustrative.
export const silosPerUnit = 6;
// User-annotated Earth capture: rear yard → boiler gap → tripper/mill band → turbine hall.
// These are diagram coordinates, not surveyed dimensions.
export const blendBuildingLayout = {yardZ:-110,boilerZ:-24,millZ:0,turbineZ:20};
export const blendLines = [
  {id:1,label:'1–4호기',yard:1,units:[1,2,3,4],source:'1저탄장',outlet:'TT-04·05·06',
   stages:[stage('CV-06A/B','BB-01','cv06ab','bb01'),stage('CV-07A/B','SCB-01','cv07ab','scb01'),stage('CV-08A/B','TTT-01','cv08ab')],
   nodes:[[-106,-72],[0,-72],[0,0]],distributionX:0,
   branches:[{code:'CV-09A/B',units:[1,2],toX:-73},{code:'CV-09C/D',units:[3,4],toX:73}],
   note:'CV-62A → BB-02 교차 공급 별도 · SCB: CN/CQ 설비'},
  {id:2,label:'5–8호기',yard:2,units:[5,6,7,8],source:'2저탄장',outlet:'TT-55',
   stages:[stage('CV-55A/B','TT-54'),stage('CV-56A/B','BB-02'),stage('CV-57A/B','SCB-02'),stage('CV-58A/B','TTT-02')],
   nodes:[[-106,-89],[-106,-72],[0,-72],[0,0]],distributionX:0,
   branches:[{code:'CV-59A/B',units:[5,6],toX:-73},{code:'CV-59C/D',units:[7,8],toX:73}],
   note:'CV-62A·CV-56C/D 교차 공급 별도 · SCB: CN/CQ 설비'},
  {id:3,label:'9–10호기',yard:3,units:[9,10],source:'3저탄장',outlet:'CV-94A/B/C → TT-97',
   stages:[stage('CV-95A/B','TT-98'),stage('CV-96A/B','BB-03'),stage('CV-97A/B','SCB-03'),stage('CV-98A/B','TTT-03')],
   nodes:[[-114,-86],[-114,-66],[-70,-66],[-70,0]],distributionX:-70,
   branches:[{code:'CV-99A/B',units:[9,10],toX:45}],
   note:'TT-96·97 반출 합류 · TT-95 반입과 분리 · 교차 공급 별도'},
];
