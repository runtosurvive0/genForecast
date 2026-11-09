const NS='http://www.w3.org/2000/svg',clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const number=n=>n.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1});
const point=p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`;
const svgNode=(tag,parent,attrs={})=>{const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);parent.append(el);return el;};
const intersects=(a,b)=>a.x<b.x+b.w+8&&a.x+a.w+8>b.x&&a.y<b.y+b.h+6&&a.y+a.h+6>b.y;

export function createClearanceOverlay(host,{onClear}={}){
 const root=document.createElement('div');root.className='scene-clearance';root.hidden=true;root.setAttribute('aria-label','선택 원탄 상부 이격거리');host.append(root);
 const svg=svgNode('svg',root,{'aria-hidden':'true',class:'scene-clearance-lines'});
 const heading=document.createElement('div');heading.className='scene-clearance-heading';root.append(heading);
 const title=document.createElement('span');heading.append(title);
 if(onClear){const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','원탄 선택 해제');button.textContent='선택 해제';button.addEventListener('click',onClear);heading.append(button);}
 const announcement=document.createElement('span');announcement.className='scene-clearance-announcement';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');root.append(announcement);
 const entries=new Map();let previousStatus='';
 function entry(key){
  if(entries.has(key))return entries.get(key);
  const g=svgNode('g',svg),leader=svgNode('path',g,{class:'scene-clearance-leader'}),line=svgNode('path',g,{class:'scene-clearance-measure'}),link=svgNode('path',g,{class:'scene-clearance-link'});
  const dots=[svgNode('circle',g,{r:1.7}),svgNode('circle',g,{r:1.7})];
  const label=document.createElement('div');label.className='scene-clearance-label';label.dataset.clearanceKey=key;label.innerHTML='<span class="scene-clearance-neighbour"></span><strong class="scene-clearance-value"></strong><span class="scene-clearance-limit"></span>';root.append(label);
  const e={g,leader,line,link,dots,label,name:label.children[0],value:label.children[1],limit:label.children[2]};entries.set(key,e);return e;
 }
 function update(data,project,{online=true,connected=true}={}){
  root.hidden=!data;if(!data){previousStatus='';return;}
  const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;
  const stale=connected&&!online,breaches=data.measurements.filter(m=>m.state==='breach');
  root.dataset.selectedLot=data.id;root.dataset.status=stale?'stale':breaches.length?'breach':'clear';
  title.textContent=`${data.title} · 상부 이격 추정${stale?' · 수신 끊김 / 마지막 값':data.message?' · '+data.message:''}`;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const active=new Set(data.measurements.map(m=>m.key));for(const [key,e]of entries)if(!active.has(key)){e.g.remove();e.label.remove();entries.delete(key);}
  const placed=[{x:heading.offsetLeft,y:heading.offsetTop,w:heading.offsetWidth,h:heading.offsetHeight}],labelW=Math.min(116,(w-28)/2),labelH=30,minimumY=8,maximumY=Math.max(minimumY,h-labelH-62);
  if(host.id==='berth-transfer-canvas')placed.push({x:0,y:0,w,h:w<640?42:26});
  for(const m of data.measurements){
   const e=entry(m.key),ends=m.ends.map(project),line=m.line.map(project),mid={x:(line[0].x+line[1].x)/2,y:(line[0].y+line[1].y)/2};
   const state=stale?'stale':m.state;e.g.dataset.state=e.label.dataset.state=state;e.label.dataset.gap=m.benchGap;e.label.dataset.required=m.required;
   const projectable=[...ends,...line].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.depth>=-1&&p.depth<=1);
   e.g.style.display=projectable?'':'none';
   let rect={x:clamp(mid.x-labelW/2,8,w-labelW-8),y:clamp(mid.y-labelH-5,minimumY,maximumY),w:labelW,h:labelH};
   if(placed.some(p=>intersects(rect,p))){
    const candidates=[{...rect,y:clamp(rect.y-labelH-10,minimumY,maximumY)},{...rect,y:clamp(rect.y+labelH+10,minimumY,maximumY)},{...rect,x:m.side==='왼쪽'?8:w-labelW-8,y:minimumY}];
    rect=candidates.find(r=>!placed.some(p=>intersects(r,p)))||candidates.at(-1);
   }
   placed.push(rect);Object.assign(e.label.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px'});
   e.name.textContent=`${m.side} · ${m.neighbour}`;
   e.value.textContent=m.state==='unknown'?'거리 미확인':m.benchGap<0?`상부 겹침 ${number(-m.benchGap)}m`:`${m.state==='breach'&&Math.round(m.benchGap*10)/10>=m.required?'< '+m.required:number(m.benchGap)} m`;
   const lack=m.shortfall<.1?'0.1m 미만':number(m.shortfall)+'m';
   e.limit.textContent=m.state==='unknown'?'위치 확인 필요':`기준 ${m.required}m${m.state==='breach'?' · '+lack+' 부족':''}`;
   e.label.setAttribute('aria-label',`${m.side} ${m.neighbour}. ${e.value.textContent}. ${e.limit.textContent}${stale?'. 마지막 수신값':''}`);
   if(projectable){
    const dx=line[1].x-line[0].x,dy=line[1].y-line[0].y,len=Math.hypot(dx,dy)||1,n={x:-dy/len*4,y:dx/len*4};
    e.leader.setAttribute('d',ends.map((p,i)=>`M${point(p)} L${point(line[i])}`).join(' '));
    e.line.setAttribute('d',`M${point(line[0])} L${point(line[1])} `+line.map(p=>`M${point({x:p.x-n.x,y:p.y-n.y})} L${point({x:p.x+n.x,y:p.y+n.y})}`).join(' '));
    e.link.setAttribute('d',`M${(rect.x+rect.w/2).toFixed(1)},${(rect.y+rect.h).toFixed(1)} L${point(mid)}`);
    e.dots.forEach((dot,i)=>{dot.setAttribute('cx',ends[i].x);dot.setAttribute('cy',ends[i].y);});
   }
  }
  const statusKey=data.id+':'+stale+':'+data.measurements.map(m=>m.key+':'+m.state).join('|');
  if(statusKey!==previousStatus){announcement.textContent=stale?'운전정보 수신이 끊겼습니다. 마지막 이격 추정값입니다.':breaches.length?`${data.title}. ${breaches.map(m=>m.side+' 원탄과 상부 이격 기준 '+m.required+'m 미달').join('. ')}`:`${data.title}. ${data.message||'상부 이격 추정 표시'}`;previousStatus=statusKey;}
 }
 return {host,update,clear:()=>update(null),dispose(){root.remove();entries.clear();},debug:()=>({selected:root.dataset.selectedLot,status:root.dataset.status,visible:!root.hidden,count:entries.size})};
}
