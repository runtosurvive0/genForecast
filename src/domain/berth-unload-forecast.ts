export function estimateUnload(input: {baseTime:unknown; elapsed:unknown; playing:boolean; online:boolean; berth:number; remaining:number|null; job:{berth?:unknown;actualRate?:unknown;amount?:unknown;moved?:unknown}}): {kind:'ship'|'work';at:string}|null {
  const {baseTime,elapsed,playing,online,berth,remaining,job}=input;
  if (!playing || !online || job.berth!==berth || typeof baseTime!=='string' || typeof elapsed!=='number' || !Number.isFinite(elapsed) || remaining===null || remaining<=0 || typeof job.actualRate!=='number' || !Number.isFinite(job.actualRate) || job.actualRate<=0 || typeof job.amount!=='number' || typeof job.moved!=='number') return null;
  const base=Date.parse(baseTime), work=job.amount-job.moved;
  if (!Number.isFinite(base) || !Number.isFinite(work) || work<=0) return null;
  const at=new Date(base+elapsed*1000+Math.min(remaining,work)/job.actualRate*3600000);
  if (!Number.isFinite(at.getTime())) return null;
  return {kind:work>=remaining?'ship':'work',at:at.toISOString()};
}
