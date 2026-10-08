// Presentation of the existing dashboard API. No fixture values or write-on-load actions.
const sum = values => values.reduce((a, b) => a + b, 0);
const dayMs = 86400000;
const dateTime = s => Date.parse(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : String(s).length === 10 ? 'T00:00:00Z' : 'Z'));
const shortDate = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const dashboardIcon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let dashboardRequest = 0;

async function refreshDashboard(runId) {
  const ticket = ++dashboardRequest;
  $('dashboard-refresh').disabled = true;
  try {
    const chosen = runId || state.dashboard?.run_id;
    const data = await api('/api/dashboard' + (chosen ? `?run_id=${encodeURIComponent(chosen)}` : ''));
    if (ticket !== dashboardRequest) return;
    state.dashboard = data;
    $('dash-run').innerHTML = data.runs.map(r => `<option value="${esc(r.id)}">${esc(r.name)} · ${r.period.slice(0, 4)}</option>`).join('') || '<option value="">저장된 발전계획 없음</option>';
    $('dash-run').value = data.run_id || '';
    const selected = $('dash-unit').value;
    $('dash-unit').innerHTML = '<option value="all">당진 전체</option>' + data.units.map(u => `<option value="${esc(u)}">${esc(u.replace('당진', '당진 '))}호기</option>`).join('');
    $('dash-unit').value = data.units.includes(selected) ? selected : 'all';
    const fuel = data.settings.fuel;
    $('f-calorific').value = fuel.calorific_kcal_kg ?? '';
    $('f-fuel-assumption').value = String(fuel.is_assumption);
    $('f-fuel-source').value = fuel.source || '';
    if (data.summary) state.result = {id: data.run_id, ...data.summary};
    $('dashboard-error').innerHTML = '';
    renderDashboard();
  } catch (e) {
    if (ticket !== dashboardRequest) return;
    $('dashboard-error').innerHTML = `<div class="err">${esc(e.message)} <button class="btn small" onclick="refreshDashboard()">다시 시도</button></div>`;
    $('dashboard-status').textContent = '불러오기 실패';
  } finally { if (ticket === dashboardRequest) $('dashboard-refresh').disabled = false; }
}

async function saveDatabase() {
  $('btn-save').disabled = true;
  try {
    const result = await api('/api/settings', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario:scenario(), fuel:{calorific_kcal_kg:$('f-calorific').value === '' ? null : Number($('f-calorific').value), is_assumption:$('f-fuel-assumption').value === 'true', source:$('f-fuel-source').value}})});
    loadScenario(result.scenario);
    await refreshDashboard();
    message('DB에 저장했습니다. 발열량 환산은 즉시 반영되며, 정비·발전 가정 변경은 MILP를 다시 실행하면 발전계획에 반영됩니다.');
    return true;
  } catch (e) { message(e.message, true); return false; }
  finally { $('btn-save').disabled = false; }
}

function setFuelMode(mode) { state.fuelMode = mode; $('dash-month').value = ''; hide('fuel-day-detail'); renderDashboard(); }
function measure(mode = state.fuelMode) {
  return mode === 'actual' || state.dashboard.settings.fuel.calorific_kcal_kg
    ? {key:'tonnes', unit:'톤', map:'unit_tonnes'} : {key:'heat_gcal', unit:'Gcal', map:'unit_heat_gcal'};
}
function fuelAmount(row, mode = state.fuelMode) {
  const m = measure(mode), unit = $('dash-unit').value;
  if (!row) return null;
  return unit === 'all' ? row[m.key] ?? null : row[m.map]?.[unit] ?? null;
}
function fuelRows() { const d = state.dashboard; return state.fuelMode === 'actual' ? d.actual.daily : (state.fuelMode === 'historical' ? d.historical.daily : d.plan?.daily || []); }
function selectedDays() { return fuelRows().filter(r => r.period.startsWith($('dash-month').value)); }
function selectedTotal(rows, mode = state.fuelMode) { const vals = rows.map(r => fuelAmount(r, mode)).filter(v => v != null); return vals.length ? sum(vals) : null; }
function modeName() { return {plan:'계획', historical:'실적 추정', actual:'실측'}[state.fuelMode]; }
function dashboardScope() { return $('dash-unit').value === 'all' ? '당진 전체' : $('dash-unit').value.replace('당진','당진 ') + '호기'; }
function compactFuel(value, mode = 'plan') { return {value: value == null ? null : value / 10000, unit:measure(mode).unit === '톤' ? '만 톤' : '만 Gcal'}; }
function fuelHeadline(value, mode = 'plan') { const f = compactFuel(value, mode); return `${fmt(f.value,1)}<small>${f.unit}</small>`; }
function daysInMonth(period) { return new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).getUTCDate(); }
function priorPeriod(period) { return `${Number(period.slice(0,4))-1}${period.slice(4)}`; }
function monthlyComparison(period) {
  const previous = priorPeriod(period), rows = state.dashboard.historical.daily.filter(r => r.period.startsWith(previous));
  const complete = new Set(rows.filter(r => fuelAmount(r,'historical') != null).map(r => r.period)).size === daysInMonth(previous);
  return complete ? selectedTotal(rows,'historical') : null;
}

function outageData() {
  const d = state.dashboard, latest = $('outage-source').value === 'db' || !d.summary;
  const source = latest ? {coal:d.settings.scenario.coal_oh, nuclear:d.settings.scenario.nuclear_oh} : d.summary.outages;
  const sc = latest ? d.settings.scenario : d.summary.scenario;
  const start = dateTime(sc.start), end = dateTime(sc.end) + dayMs;
  const scope = $('outage-scope').value, unit = $('dash-unit').value, kind = scope === 'nuclear' ? 'nuclear' : 'coal';
  const rows = (source[kind] || []).filter(r => scope !== 'dangjin' || (r.unit.startsWith('당진') && (unit === 'all' || r.unit === unit)))
    .map(r => ({...r, kind, from:dateTime(r.start), to:dateTime(r.end) + (r.end.length === 10 ? dayMs : 0)}))
    .filter(r => r.from < end && r.to > start).sort((a,b) => a.from - b.from || a.unit.localeCompare(b.unit,'ko',{numeric:true}));
  const units = scope === 'dangjin' ? (unit === 'all' ? d.units : [unit]) : [...new Set(rows.map(r => r.unit))].sort((a,b) => a.localeCompare(b,'ko',{numeric:true}));
  return {rows, units, start, end, sc, latest, scope};
}
// Merge overlapping intervals before counting days for a unit.
function outageDays(rows, start, end) {
  let days = 0;
  for (const unit of new Set(rows.map(r => r.unit))) {
    const ranges = rows.filter(r => r.unit === unit).map(r => [Math.max(start,r.from),Math.min(end,r.to)]).filter(([a,b]) => b > a).sort((a,b) => a[0]-b[0]);
    let from = null, to = null;
    for (const [a,b] of ranges) {
      if (from === null) { from=a; to=b; }
      else if (a <= to) to=Math.max(to,b);
      else { days+=(to-from)/dayMs; from=a; to=b; }
    }
    if (from !== null) days+=(to-from)/dayMs;
  }
  return days;
}
function dashboardUnitRows() {
  const d = state.dashboard, s = d.summary;
  if (!s) return [];
  const selected = $('dash-unit').value;
  const start=dateTime(s.scenario.start), end=dateTime(s.scenario.end)+dayMs, hours=(end-start)/3600000;
  const oh=s.outages.coal.map(r => ({...r,from:dateTime(r.start),to:dateTime(r.end)+(r.end.length===10?dayMs:0)}));
  return s.units.filter(u => selected==='all' || u===selected).map(unit => {
    const values=s.daily.map(r => r.unit_mwh?.[unit]), generation=values.length && values.every(v => Number.isFinite(v)) ? sum(values) : null;
    const capacity=state.meta?.coal_units.find(u => u.unit===unit)?.installed_mw ?? null;
    const events=oh.filter(r => r.unit===unit && r.from<end && r.to>start);
    return {unit,capacity,generation,utilization:capacity && generation!=null ? generation/(capacity*hours)*100 : null,fuel:d.plan?.total?.[measure('plan').map]?.[unit] ?? null,outageDays:outageDays(events,start,end),outageCount:events.length};
  });
}

function renderDashboard() {
  const d=state.dashboard; if (!d) return;
  hide('fuel-day-detail');
  const m=measure(), pm=measure('plan'), summary=d.summary, fuel=d.settings.fuel, sc=summary?.scenario || d.settings.scenario;
  $('dashboard-period').textContent=`${sc.start} — ${sc.end} · ${sc.name} · ${dashboardScope()}`;
  $('dashboard-status').textContent=summary ? '저장된 발전계획' : '계획 미실행';
  $('dashboard-export').disabled=!d.plan?.monthly.length;
  $('fuel-basis').innerHTML=fuel.calorific_kcal_kg ? `${dashboardIcon('fuel')} 기준 발열량 <b>${fmt(fuel.calorific_kcal_kg)} kcal/kg · ${fuel.is_assumption ? '임시 가정' : '확정 기준'}</b>` : '<b>발열량 미등록 · 열량(Gcal) 표시</b>';
  document.querySelectorAll('[data-fuel-mode]').forEach(b => { const on=b.dataset.fuelMode===state.fuelMode; b.classList.toggle('on',on); b.setAttribute('aria-pressed',String(on)); });
  const months=[...new Set(fuelRows().map(r => r.period.slice(0,7)))].sort(), prior=$('dash-month').value;
  $('dash-month').innerHTML=months.map(v => `<option value="${v}">${v.slice(0,4)}년 ${Number(v.slice(5))}월</option>`).join('') || '<option value="">자료 없음</option>';
  $('dash-month').value=months.includes(prior) ? prior : (state.fuelMode==='plan' ? months[0] : months.at(-1)) || '';
  $('dash-month').disabled=!months.length;
  const index=months.indexOf($('dash-month').value);
  document.querySelector('[aria-label="이전 월"]').disabled=index<=0;
  document.querySelector('[aria-label="다음 월"]').disabled=index<0 || index>=months.length-1;
  const days=selectedDays(), vals=days.map(r => fuelAmount(r)).filter(v => v!=null), total=selectedTotal(days), annual=fuelAmount(d.plan?.total,'plan'), outage=outageData();
  const genRows=dashboardUnitRows(), generation=genRows.length && genRows.every(r => r.generation!=null) ? sum(genRows.map(r => r.generation)) : null;
  const capacity=genRows.length && genRows.every(r => r.capacity!=null) ? sum(genRows.map(r => r.capacity)) : null;
  const hours=(dateTime(sc.end)+dayMs-dateTime(sc.start))/3600000;
  const cf=generation!=null && capacity ? generation/(capacity*hours)*100 : null;
  const a=compactFuel(annual), t=compactFuel(total,state.fuelMode), month=$('dash-month').value;
  const kpis=[
    {name:'계획기간 석탄 사용 예정량',value:fmt(a.value,1),unit:a.unit,icon:'fuel',foot:`<span class="delta">계획 추정</span><span>시간별 열량곡선 기준</span>`},
    {name:`${month ? Number(month.slice(5))+'월 ' : '조회 월 '}${modeName()} 사용량`,value:fmt(t.value,1),unit:t.unit,icon:'calendar',foot:`<span class="delta">${state.fuelMode==='plan' && annual ? '기간 '+fmt(total/annual*100,1)+'%' : '유효 '+vals.length+'일'}</span><span>${state.fuelMode==='plan' ? '조회 월 비중' : '자료가 있는 날짜 기준'}</span>`},
    {name:'계획기간 예상 발전량',value:fmt(generation==null?null:generation/1e6,2),unit:'TWh',icon:'bolt',foot:`<span class="delta">${fmt(cf,1)}%</span><span>평균 설비이용률</span>`},
    {name:'선택 범위 계획정지',value:fmt(outageDays(outage.rows,outage.start,outage.end),1),unit:'호기·일',icon:'settings',foot:`<span class="delta">${outage.rows.length}건</span><span>${outage.latest ? 'DB 최신' : '발전계획 반영'} 일정</span>`}
  ];
  $('dashboard-kpis').innerHTML=kpis.map(k => `<article class="kpi"><div class="kpi-label">${esc(k.name)}<span class="kpi-icon">${dashboardIcon(k.icon)}</span></div><div class="kpi-value"><strong>${k.value}</strong><span>${k.unit}</span></div><div class="kpi-foot">${k.foot}</div></article>`).join('');
  $('dashboard-notice').innerHTML=!summary ? '<div class="inline-notice">저장된 발전계획이 없습니다. DB · 계획 관리에서 가정과 정비계획을 저장한 뒤 MILP를 실행하세요.</div>' : (!summary.outages.coal.some(r => r.unit.startsWith('당진')) ? '<div class="inline-notice">현재 발전계획에는 당진 계획정지가 반영되어 있지 않습니다. 정비계획을 등록하고 다시 실행하면 연료 예정량에 반영됩니다.</div>' : '');
  $('monthly-subtitle').textContent=`${dashboardScope()} · ${sc.start.slice(0,4)}년 발전계획 · ${pm.unit}`;
  $('monthly-value').innerHTML=fuelHeadline(annual);
  $('selected-month-tag').textContent=state.fuelMode==='plan' && month ? `${Number(month.slice(5))}월 선택됨` : '기간 전체';
  monthlyFuelChart(d.plan?.monthly || []);
  $('daily-subtitle').textContent=`${month || '자료 없음'} · ${dashboardScope()} · ${modeName()}`;
  $('daily-value').innerHTML=fuelHeadline(total,state.fuelMode);
  $('daily-days').textContent=`유효 자료 ${vals.length}일`;
  $('daily-detail-button').disabled=!days.length;
  dailyFuelChart(days);
  $('daily-summary').innerHTML=`<span>일 최대 <b>${fmt(vals.length ? Math.max(...vals) : null)} ${m.unit}</b></span><span>${state.fuelMode==='actual' ? '호기별 누락 자료는 합산하지 않음' : state.fuelMode==='historical' ? '24시간·전체 호기 자료가 있는 날만 집계' : '일자 선택 시 호기별 상세'}</span>`;
  renderOutageDashboard(outage); renderDashboardUnits(genRows);
  $('dashboard-sources').innerHTML=[
    ['발열량 기준',fuel.calorific_kcal_kg ? `${fmt(fuel.calorific_kcal_kg)} kcal/kg · ${fuel.is_assumption ? '임시 가정' : '확정'}` : '미등록'],
    ['발열량 출처',fuel.source || '미등록'],
    ['발전실적 범위',d.historical.daily.length ? `${d.historical.daily[0].period} ~ ${d.historical.daily.at(-1).period}` : '자료 없음'],
    ['실측 연료량',d.actual.daily.length ? `${d.actual.daily.length}일 등록` : '미등록'],
    ['입력값 저장소','프로젝트 내부 SQLite DB']
  ].map(([a,b]) => `<div class="source-row"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('') + `<p class="source-note">${esc(d.method.tonnes)}<br>열량곡선은 호기별 시간 출력에 적용합니다. ${esc(d.method.scope)}${d.historical.omitted_days ? `<br>시간·호기 자료가 불완전한 ${d.historical.omitted_days}일은 실적 추정에서 제외했습니다.` : ''}</p>`;
  $('dashboard-warning-text').innerHTML=(summary?.warnings || []).map(w => `<div class="warn">${esc(w)}</div>`).join('') || '<p>등록된 검토사항이 없습니다.</p>';
  if (!$('tab-result').classList.contains('hidden') && state.result) renderResult();
}

function chartStart(id,values,height=255,mode='plan') {
  const W=Math.max(290,$(id).clientWidth || 520), l=43,r=12,t=25,b=32;
  const max=Math.max(...values.filter(v => v!=null),1),ticks=axisTicks(max*1.08),top=ticks.at(-1),divisor=max>=100000 ? 10000 : max>=10000 ? 1000 : 1;
  const y=v => t+(height-t-b)*(1-v/top),axisUnit=(divisor===10000?'만 ':divisor===1000?'천 ':'')+measure(mode).unit;
  let svg=`<svg viewBox="0 0 ${W} ${height}" width="100%" role="group" aria-label="${esc(id==='fuel-monthly' ? '월별 석탄 사용 예정량' : '일별 석탄 사용량')} (${axisUnit})"><text x="${l}" y="12" fill="#a0abba" font-size="9">${axisUnit}</text>`;
  ticks.forEach(v => svg+=`<line x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-dasharray="3 4"/><text x="${l-8}" y="${y(v)+3}" text-anchor="end" fill="#a0abba" font-size="9">${fmt(v/divisor,v/divisor<10 && v?1:0)}</text>`);
  return {W,l,r,t,b,H:height,y,svg};
}
function markTip(text) { return `tabindex="0" class="chart-mark" data-tip="${esc(text)}" aria-label="${esc(text)}"`; }
function chartEmpty(id,title,note) { $(id).innerHTML=`<div class="empty-state"><div>${esc(title)}<br><small>${esc(note)}</small></div></div>`; }

function monthlyFuelChart(rows) {
  const comparisons=rows.map(r => monthlyComparison(r.period)), any=comparisons.some(v => v!=null);
  $('monthly-comparison-legend').classList.toggle('hidden',!any);
  $('monthly-comparison-note').textContent=any ? '전년 동월은 발전실적 기반 추정이며, 월 전체 자료가 있는 경우만 비교합니다.' : '';
  if (!rows.length) return chartEmpty('fuel-monthly','발전계획이 아직 없습니다','DB · 계획 관리에서 MILP 실행 후 표시됩니다.');
  const {W,l,r,H,t,y,svg:base}=chartStart('fuel-monthly',[...rows.map(r => fuelAmount(r,'plan')),...comparisons],235);
  let svg=base,step=(W-l-r)/rows.length;
  rows.forEach((row,i) => {
    const value=fuelAmount(row,'plan'),previous=comparisons[i],month=row.period,x=l+i*step,active=state.fuelMode==='plan' && month===$('dash-month').value;
    const barWidth=step*(any ? .25 : .48),planX=x+step*(any ? .51 : .26);
    const tip=`${month}\n사용 예정량 ${fmt(value)} ${measure('plan').unit}\n${previous!=null?'전년 실적 추정 '+fmt(previous)+' '+measure('plan').unit:'전년 동월 전체 자료 없음'}`;
    svg+=`<g role="button" ${markTip(tip)} aria-pressed="${active}" data-plan-month="${month}" onclick="chooseMonth('${month}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseMonth('${month}')}"><rect x="${x+2}" y="${t-5}" width="${Math.max(2,step-4)}" height="${H-t-7}" rx="5" fill="${active?'#f0f5ff':'transparent'}"/>`;
    if (previous!=null) svg+=`<rect x="${x+step*.19}" y="${y(previous)}" width="${barWidth}" height="${y(0)-y(previous)}" rx="3" fill="#dce3ef"/>`;
    if (value!=null) svg+=`<rect x="${planX}" y="${y(value)}" width="${barWidth}" height="${y(0)-y(value)}" rx="3" fill="${active?'#3569e8':'#7799ed'}"/>`;
    svg+=`<text x="${x+step*.5}" y="${H-12}" text-anchor="middle" font-size="9" font-weight="${active?700:400}" fill="${active?'#3569e8':'#96a2b5'}">${Number(month.slice(5))}월${rows.some(r => r.period.slice(0,4)!==rows[0].period.slice(0,4))?' '+month.slice(2,4):''}</text><title>${esc(tip)}</title></g>`;
  });
  $('fuel-monthly').innerHTML=svg+'</svg>'; bindTips('fuel-monthly');
}
function chooseMonth(month) { state.fuelMode='plan'; $('dash-month').innerHTML=`<option value="${month}">${month}</option>`; $('dash-month').value=month; hide('fuel-day-detail'); renderDashboard(); }
function stepDashboardMonth(step) { const select=$('dash-month'),next=select.selectedIndex+step; if (next>=0 && next<select.options.length) { select.selectedIndex=next; renderDashboard(); } }

function dailyFuelChart(rows) {
  const m=measure(),color=state.fuelMode==='plan' ? '#3569e8' : state.fuelMode==='historical' ? '#71a9a6' : '#9978b9';
  $('daily-legend').innerHTML=`<span><i class="dot line" style="background:${color}"></i>${modeName()}</span>`;
  if (!rows.length || !rows.some(r => fuelAmount(r)!=null)) return chartEmpty('fuel-daily',state.fuelMode==='actual' ? '실측 연료량이 등록되어 있지 않습니다' : '조회 가능한 일별 자료가 없습니다',state.fuelMode==='actual' ? '일자·호기별 실측 데이터가 연계되면 표시됩니다.' : '다른 자료 구분이나 월을 선택하세요.');
  const month=$('dash-month').value,count=daysInMonth(month),byDay=new Map(rows.map(r => [Number(r.period.slice(8)),r]));
  const previous=new Map(state.fuelMode==='plan' ? state.dashboard.historical.daily.filter(r => r.period.startsWith(priorPeriod(month))).map(r => [Number(r.period.slice(8)),fuelAmount(r,'historical')]) : []);
  const hasPrevious=[...previous.values()].some(v => v!=null);
  if (hasPrevious) $('daily-legend').innerHTML+='<span><i class="dot line teal"></i>전년 동월 · 실적 추정</span>';
  const {W,l,r,H,y,svg:base}=chartStart('fuel-daily',[...rows.map(r => fuelAmount(r)),...previous.values()],235,state.fuelMode);
  let svg=base,segments=[],path='',previousPath='',segment=false,oldSegment=false;
  const x=n => l+(W-l-r)*(n-1)/Math.max(1,count-1);
  for (let day=1;day<=count;day++) {
    const value=fuelAmount(byDay.get(day)),old=previous.get(day);
    if (value==null) { if (path) segments.push(path);path='';segment=false; }
    else { path+=`${segment?'L':'M'}${x(day)},${y(value)} `;segment=true; }
    if (old==null) oldSegment=false; else { previousPath+=`${oldSegment?'L':'M'}${x(day)},${y(old)} `;oldSegment=true; }
  }
  if (path) segments.push(path);
  svg+=`<defs><linearGradient id="fuel-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".14"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  segments.forEach(p => {
    const points=[...p.matchAll(/[ML]([\d.]+),([\d.]+)/g)];
    if (points.length) svg+=`<path d="${p}L${points.at(-1)[1]},${y(0)} L${points[0][1]},${y(0)} Z" fill="url(#fuel-area)"/>`;
    svg+=`<path d="${p}" stroke="${color}" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  if (hasPrevious) svg+=`<path d="${previousPath}" stroke="#91bebb" fill="none" stroke-width="1.6" stroke-dasharray="4 4"/>`;
  for (let day=1;day<=count;day++) {
    const row=byDay.get(day),value=fuelAmount(row),old=previous.get(day);
    if ([1,5,10,15,20,25,count].includes(day)) svg+=`<text x="${x(day)}" y="${H-12}" text-anchor="middle" fill="#99a5b7" font-size="9">${day}일</text>`;
    if (value!=null) {
      const tip=`${row.period}\n${modeName()} ${fmt(value)} ${m.unit}${old!=null?'\n전년 실적 추정 '+fmt(old)+' '+m.unit:''}`;
      svg+=`<circle cx="${x(day)}" cy="${y(value)}" r="3" fill="${color}" role="button" ${markTip(tip)} onclick="fuelDayDetail('${row.period}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();fuelDayDetail('${row.period}')}"><title>${esc(tip)}</title></circle>`;
    }
  }
  $('fuel-daily').innerHTML=svg+'</svg>'; bindTips('fuel-daily');
}

function renderOutageDashboard(d) {
  const {rows,units,start,end,sc}=d;
  $('outage-subtitle').textContent=`${d.latest?'DB 최신 일정':'발전계획 반영 일정'} · ${sc.start} ~ ${sc.end}`;
  $('outage-count').textContent=`${rows.length}건 반영`;
  $('outage-total').textContent=`합계 ${fmt(outageDays(rows,start,end),1)} 호기·일`;
  const W=Math.max(560,$('dashboard-gantt').clientWidth || 560),l=72,r=12,t=29,rowH=29,H=t+Math.max(1,units.length)*rowH+5;
  const x=v => l+(W-l-r)*(Math.max(start,Math.min(end,v))-start)/(end-start),selected=$('dash-month').value;
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="호기별 계획정지 일정"><text x="0" y="14" font-size="9" fill="#96a1b2">발전 호기</text>`;
  const first=new Date(start);
  for (let dt=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1));dt.getTime()<end;dt=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,1))) {
    const next=new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,1)),left=x(dt.getTime()),right=x(next.getTime()),active=dt.toISOString().slice(0,7)===selected;
    svg+=`<rect x="${left}" y="${t}" width="${right-left}" height="${H-t}" fill="${active?'#f0f5ff':'#fff'}"/><line x1="${left}" x2="${left}" y1="${t}" y2="${H}" stroke="var(--grid)"/><text x="${(left+right)/2}" y="14" text-anchor="middle" fill="${active?'#3569e8':'#98a3b3'}" font-size="9">${dt.getUTCMonth()+1}월${new Date(start).getUTCFullYear()!==new Date(end-dayMs).getUTCFullYear()?' '+dt.getUTCFullYear():''}</text>`;
  }
  units.forEach((unit,i) => {
    const cy=t+i*rowH,events=rows.filter(r => r.unit===unit);
    svg+=`<text x="0" y="${cy+18}" font-size="10" fill="#6c7a90">${esc(unit.replace('당진','당진 '))}</text><line x1="${l}" x2="${W-r}" y1="${cy+rowH}" y2="${cy+rowH}" stroke="var(--grid)"/>`;
    if (!events.length) svg+=`<text x="${l+10}" y="${cy+18}" font-size="9" fill="#b2bac3">등록된 계획정지 없음</text>`;
    events.forEach(row => {
      const a=x(row.from),b=x(row.to),days=(Math.min(end,row.to)-Math.max(start,row.from))/dayMs,tip=`${row.unit}\n${row.start} ~ ${row.end}\n${row.note || '계획정지'}`;
      const index=rows.indexOf(row);
      svg+=`<rect x="${a}" y="${cy+7}" width="${Math.max(2,b-a)}" height="15" rx="3" fill="${row.kind==='nuclear'?'var(--nuc)':'var(--accent)'}" role="button" ${markTip(tip)} onclick="openDashboardOutage(${index})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openDashboardOutage(${index})}"><title>${esc(tip)}</title></rect>`;
      if (b-a>28) svg+=`<text x="${(a+b)/2}" y="${cy+17.5}" text-anchor="middle" font-size="8" fill="${row.kind==='nuclear'?'#456b69':'#79551d'}" pointer-events="none">${fmt(days,days%1?1:0)}일</text>`;
    });
  });
  if (!units.length) svg+=`<text x="${l+15}" y="${t+18}" font-size="10" fill="var(--muted)">이 기간에 등록된 계획정지 일정이 없습니다.</text>`;
  $('dashboard-gantt').innerHTML=svg+'</svg>';bindTips('dashboard-gantt');
  $('outage-empty').innerHTML=rows.length ? '' : '<div class="outage-note">등록된 일정이 없습니다. DB · 계획 관리에서 정비계획을 확인하세요.</div>';
  $('outage-list').innerHTML=rows.length ? `<div class="scroll" style="max-height:250px;border:0"><table><thead><tr><th class="l">호기</th><th class="l">시작</th><th class="l">종료</th><th>기간 내 정지일</th></tr></thead><tbody>${rows.map(row => `<tr><td class="l"><b>${esc(row.unit)}</b></td><td class="l">${esc(row.start)}</td><td class="l">${esc(row.end)}</td><td>${fmt((Math.min(end,row.to)-Math.max(start,row.from))/dayMs,1)}일</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state" style="min-height:145px"><div>등록된 계획정지 일정이 없습니다.<br><button class="btn small" onclick="tab(\'input\')">DB · 계획 관리 →</button></div></div>';
  const monthStart=selected ? dateTime(selected+'-01') : start,from=monthStart>=start && monthStart<end ? monthStart : start;
  const upcoming=rows.filter(r => r.to>from).slice(0,3);
  $('events-subtitle').textContent=`${new Date(from).toISOString().slice(0,7)} 이후 · ${d.latest?'DB 최신':'계획 반영'}`;
  $('dashboard-events').innerHTML=upcoming.length ? upcoming.map(row => {
    const day=new Date(Math.max(from,row.from)).toISOString().slice(0,10),duration=(Math.min(end,row.to)-Math.max(start,row.from))/dayMs;
    return `<article class="event"><div class="event-date"><span>${Number(day.slice(5,7))}월</span><strong>${day.slice(8)}</strong></div><div class="event-info"><b>${esc(row.unit)}<span class="duration">${fmt(duration,duration%1?1:0)}일</span></b><p>${esc(row.start)} – ${esc(row.end)}<br>${esc(row.note || '계획정지')}</p><span class="event-type">${row.from<from?'조회 월 진행 중':'계획정지'}</span></div></article>`;
  }).join('') : '<div class="empty">이 기간에 조회할<br>정비 일정이 없습니다.</div>';
}

function openDashboardOutage(index) {
  const d=outageData(),row=d.rows[index];if (!row) return;
  $('fuel-dialog-title').textContent=`${row.unit} · 계획정지 일정`;
  $('fuel-dialog-content').innerHTML=`<div class="dialog-content"><div class="detail-grid"><div><small>시작일</small><strong>${esc(row.start)}</strong></div><div><small>종료일</small><strong>${esc(row.end)}</strong></div><div><small>조회 기간 내 정지일수</small><strong>${fmt((Math.min(d.end,row.to)-Math.max(d.start,row.from))/dayMs,1)}일</strong></div><div><small>일정 기준</small><strong>${d.latest?'DB 최신':'발전계획 반영'}</strong></div></div><p>${esc(row.note || '비고 없음')}</p><div class="setting-note">날짜만 지정한 정지는 시작·종료일을 포함합니다.</div></div>`;
  $('fuel-dialog').showModal();
}
function renderDashboardUnits(rows) {
  const d=state.dashboard,s=d.summary,m=measure('plan');
  $('dashboard-unit-subtitle').textContent=s ? `${s.scenario.start} — ${s.scenario.end} · ${dashboardScope()} · 발전계획 반영 정비` : '발전계획 실행 후 표시됩니다.';
  $('dashboard-unit-fuel-heading').textContent=m.key==='tonnes' ? '석탄 사용량' : '연료 열량';
  if (!rows.length) { $('dashboard-unit-table').innerHTML='<tr><td colspan="7" class="empty">저장된 발전계획이 없습니다.</td></tr>';return; }
  const packed=rows.map(row => `<tr><td>${esc(row.unit.replace('당진','당진 '))}호기</td><td>${fmt(row.capacity)} MW</td><td>${fmt(row.generation==null?null:row.generation/1000,1)} GWh</td><td>${fmt(row.fuel==null?null:row.fuel/10000,1)} ${compactFuel(row.fuel).unit}</td><td><span class="utilization"><span class="mini-track"><i style="width:${Math.min(100,Math.max(0,row.utilization ?? 0))}%"></i></span>${fmt(row.utilization,1)}%</span></td><td>${fmt(row.outageDays,row.outageDays%1?1:0)}일</td><td><span class="status-pill ${row.outageCount?'ready':''}">${row.outageCount?'정비 반영':'정비 미등록'}</span></td></tr>`).join('');
  const capacity=rows.every(r => r.capacity!=null) ? sum(rows.map(r => r.capacity)) : null,generation=rows.every(r => r.generation!=null) ? sum(rows.map(r => r.generation)) : null,hours=(dateTime(s.scenario.end)+dayMs-dateTime(s.scenario.start))/3600000;
  const total=fuelAmount(d.plan?.total,'plan');
  $('dashboard-unit-table').innerHTML=packed+`<tr class="total-row"><td>조회 범위 합계</td><td>${fmt(capacity)} MW</td><td>${fmt(generation==null?null:generation/1000,1)} GWh</td><td>${fmt(total==null?null:total/10000,1)} ${compactFuel(total).unit}</td><td>${fmt(capacity && generation!=null ? generation/(capacity*hours)*100 : null,1)}%</td><td>${fmt(sum(rows.map(r => r.outageDays)),1)} 호기·일</td><td>저장된 계획</td></tr>`;
}
function fuelDayDetail(day) {
  const row=fuelRows().find(r => r.period===day);if (!row) return;
  show('fuel-day-detail');$('fuel-day-title').textContent=`${day} · 호기별 ${modeName()} 사용량`;
  const m=measure(),unit=$('dash-unit').value,units=unit==='all' ? state.dashboard.units : [unit];
  $('fuel-day-units').innerHTML=units.map(u => `<div class="unit-detail">${esc(u)}<b>${fmt(row[m.map]?.[u])} <small>${m.unit}</small></b></div>`).join('');
  const btn=$('fuel-hourly-button');btn.classList.toggle('hidden',state.fuelMode!=='plan');
  btn.onclick=() => {tab('result');dayDetail(day).catch(e => message(e.message,true));};
  $('fuel-day-detail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function openFuelDailyTable() {
  const rows=selectedDays(),m=measure();if (!rows.length) return;
  const previous=new Map(state.fuelMode==='plan' ? state.dashboard.historical.daily.map(r => [r.period,fuelAmount(r,'historical')]) : []);
  $('fuel-dialog-title').textContent=`${$('dash-month').value} · ${modeName()} 일별 사용량`;
  $('fuel-dialog-content').innerHTML=`<div class="dialog-content">${esc(dashboardScope())} · ${m.unit}${state.fuelMode==='plan'?' · 전년 동월 값은 발전실적 기반 추정':''}</div><div class="dialog-table"><table><thead><tr><th class="l">일자</th><th>${modeName()} (${m.unit})</th>${state.fuelMode==='plan'?`<th>전년 동월일 (${m.unit})</th>`:''}</tr></thead><tbody>${rows.map(row => `<tr><td class="l">${row.period}</td><td>${fmt(fuelAmount(row),1)}</td>${state.fuelMode==='plan'?`<td>${fmt(previous.get(priorPeriod(row.period)),1)}</td>`:''}</tr>`).join('')}<tr class="total-row"><td class="l">조회 월 합계</td><td>${fmt(selectedTotal(rows),1)}</td>${state.fuelMode==='plan'?'<td>—</td>':''}</tr></tbody></table></div><div class="dialog-actions"><button class="btn" onclick="exportFuel('daily')">${dashboardIcon('download')}일별 CSV 내보내기</button></div>`;
  $('fuel-dialog').showModal();
}
function downloadDashboardCsv(headers,rows,name) {
  const quote=v => `"${String(v ?? '').replace(/"/g,'""')}"`,blob=new Blob(['\uFEFF'+[headers,...rows].map(row => row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000);
}
function exportFuel(kind) {
  if (!state.dashboard) return;
  const mode=kind==='monthly'?'plan':state.fuelMode,rows=kind==='monthly'?state.dashboard.plan?.monthly || []:selectedDays(),m=measure(mode),units=$('dash-unit').value==='all'?state.dashboard.units:[$('dash-unit').value],basis=state.dashboard.settings.fuel;
  downloadDashboardCsv(['기간','자료 구분',`합계(${m.unit})`,...units.map(u => `${u}(${m.unit})`),'발열량(kcal/kg)','발열량 구분'],rows.map(row => [row.period,kind==='monthly'?'계획 추정':modeName(),fuelAmount(row,mode),...units.map(u => row[m.map]?.[u]),basis.calorific_kcal_kg,basis.is_assumption?'임시 가정':'확정 기준']),`당진_연료_${kind==='monthly'?'월별계획':$('dash-month').value+'_'+state.fuelMode}_${$('dash-unit').value}.csv`);
}
function exportDashboardUnits() {
  if (!state.dashboard?.summary) return;
  const m=measure('plan'),basis=state.dashboard.settings.fuel;
  downloadDashboardCsv(['호기','설비용량(MW)','발전량(MWh)',`연료(${m.unit})`,'이용률(%)','기간 내 정지일수','반영 정비 건수','발열량(kcal/kg)'],dashboardUnitRows().map(r => [r.unit,r.capacity,r.generation,r.fuel,r.utilization,r.outageDays,r.outageCount,basis.calorific_kcal_kg]),`당진_호기별계획_${state.dashboard.run_id}_${$('dash-unit').value}.csv`);
}

let tipElement;
function bindTips(id) {
  if (!tipElement) {tipElement=document.createElement('div');tipElement.className='chart-tip hidden';document.body.append(tipElement);}
  const off=() => tipElement.classList.add('hidden');
  $(id).querySelectorAll('[data-tip]').forEach(mark => {
    const showTip=event => {tipElement.textContent=mark.dataset.tip;tipElement.classList.remove('hidden');const box=mark.getBoundingClientRect(),x=event.clientX || box.x+box.width/2,y=event.clientY || box.y;tipElement.style.left=Math.min(Math.max(8,x+10),window.innerWidth-tipElement.offsetWidth-12)+'px';tipElement.style.top=Math.max(8,Math.min(y+12,window.innerHeight-tipElement.offsetHeight-12))+'px';};
    mark.onmouseenter=showTip;mark.onmousemove=showTip;mark.onmouseleave=off;mark.onfocus=showTip;mark.onblur=off;mark.addEventListener('click',off);
  });
}
let resizeTimer;
window.addEventListener('resize',() => {clearTimeout(resizeTimer);resizeTimer=setTimeout(() => {if (!$('tab-dashboard').classList.contains('hidden')) renderDashboard();if (!$('tab-result').classList.contains('hidden') && state.result) renderResult();if (!$('tab-input').classList.contains('hidden')) renderGantt();},150);});
$('fuel-dialog').addEventListener('click',e => {const r=e.currentTarget.getBoundingClientRect();if (e.target===e.currentTarget && (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)) e.currentTarget.close();});
