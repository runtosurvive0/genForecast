import { useEffect, useState } from 'react';
import { ProcessingOrb } from "@/components/ProcessingOrb";
import { Section } from '@/components/tower/primitives';
import { Button } from '@/components/ui/button';
import { authJson } from '@/lib/auth-client';
import './outage-schedule.css';

type Outage = {unit:string;kind:'coal'|'nuclear';start:string;end:string;start_at:string;end_at:string;note:string;capacity_mw:number|null};
type Schedule = {input_id:number|null;name:string;default_year:number;rows:Outage[];source_files:{name:string}[]};

export function OutageSchedule() {
  const [data,setData] = useState<Schedule|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [year,setYear] = useState('');
  const [kind,setKind] = useState('all');
  const [search,setSearch] = useState('');
  const [revision,setRevision] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    authJson<Schedule>('/api/planning/outages',{signal:controller.signal}).then(value=>{
      if (!Array.isArray(value.rows)) throw new Error('정비 일정 응답 형식을 확인하세요.');
      if (!controller.signal.aborted) {setData(value);setYear(current=>current || String(value.default_year));}
    }).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[revision]);
  const visible = (data?.rows ?? []).filter(row=>(kind==='all' || row.kind===kind) && row.unit.includes(search.trim()) &&
    (!year || row.start_at < `${Number(year)+1}-01-01T00:00:00+09:00` && row.end_at > `${year}-01-01T00:00:00+09:00`));
  const years = data ? Array.from(new Set([data.default_year,...data.rows.flatMap(r=>[Number(r.start.slice(0,4)),Number(r.end.slice(0,4))])])).sort() : [];
  return <div className="gf-outage-schedule">
    <Section title="호기별 계획정지 일정" note={data ? `${data.name} · DB 입력 ${data.input_id ?? '기본 설정'} · 종료일 포함, 다음 날 00:00 복귀` : 'DB에 등록된 석탄·원전 정비계획'}
      action={<Button variant="outline" disabled={loading} onClick={()=>setRevision(n=>n+1)}>다시 조회</Button>}>
      {loading && <ProcessingOrb state="searching" label="정비 일정을 불러오는 중" />}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && data && <>
        <div className="gf-outage-filters">
          <label>조회 연도<select aria-label="정비 조회 연도" value={year} onChange={e=>setYear(e.target.value)}><option value="">전체 기간</option>{years.map(y=><option key={y}>{y}</option>)}</select></label>
          <label>발전원<select aria-label="정비 발전원" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">전체</option><option value="coal">석탄</option><option value="nuclear">원전</option></select></label>
          <label>호기 검색<input type="search" aria-label="정비 호기 검색" value={search} onChange={e=>setSearch(e.target.value)} placeholder="당진1, 새울3"/></label>
          <span>등록 {data.rows.length}건 · 조회 {visible.length}건</span>
        </div>
        <p>등록된 계획정지입니다. 새 전망은 이 일정이 포함된 입력으로 실행해야 계산에 반영됩니다.</p>
        <div className="gf-outage-table"><table><thead><tr><th>호기</th><th>발전원</th><th>설비용량(MW)</th><th>정비 시작</th><th>정비 종료</th><th>비고</th></tr></thead>
          <tbody>{visible.map((row,i)=><tr key={`${row.kind}-${row.unit}-${row.start_at}-${i}`}><th scope="row">{row.unit}</th><td>{row.kind==='coal'?'석탄':'원전'}</td><td>{row.capacity_mw?.toLocaleString() ?? '제원 미등록'}</td><td>{row.start}</td><td>{row.end}</td><td>{row.note || '계획정비'}</td></tr>)}</tbody></table></div>
        {!visible.length && <p>해당 조건으로 등록된 정비 일정이 없습니다.</p>}
      </>}
    </Section>
  </div>;
}
