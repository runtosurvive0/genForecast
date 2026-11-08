import catalog from '../data/fuel-reference/demo-catalog.json' with {type:'json'};
import type { FuelDemoSnapshot } from './fuel-demo/types.ts';

/** Read-only projection: no invented unit allocation, inventory or blend engine. */
export function blendReading(yard:number,value:unknown,status:string){
  const snapshot=status==='disabled'?null:value as FuelDemoSnapshot|null;
  const job=snapshot?.material?.jobs?.reclaim;
  const lot=job?catalog.materialLots.find(l=>l.id===job.lotId):null;
  const selectedJob=lot?.yard===yard?job:null;
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  const rate=selectedJob?finite(selectedJob.actualRate):null;
  return {job:selectedJob,lot:lot?.yard===yard?lot:null,rate,moved:selectedJob?finite(selectedJob.moved):null,
    flowing:status==='online'&&snapshot?.playing===true&&(rate??0)>0,
    bunkerLevel:null, // No bunker sensor or unit-specific coal feed in the demo contract.
    source:status==='disabled'?'운전 신호 미연결':status==='online'?'운전 정보 수신':status==='connecting'?'연결 중':status==='stale'?'수신 지연 · 마지막 값':'연결 끊김 · 마지막 값'};
}
