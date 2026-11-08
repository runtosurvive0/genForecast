import {transferGeometry as G,unloaderGeometry} from './transfer-geometry.js';
// Authored geometry from the manufacturer's structural references in EQUIPMENT_REFERENCES.md.
// Identifying construction, not an as-built survey or a live machine pose.
export function machineryKit({THREE,mesh,box,bar,mat,cylinder,white,steel,ink,glass}){
 const rail=mat('#b4a16e',.65,.25),dark=mat('#4f626e',.6,.35);
 const wheelGeo=new THREE.CylinderGeometry(1,1,1,16),ringGeo=new THREE.TorusGeometry(1,.085,6,28);
 function axle(x,y,z,r,w,g){const o=mesh(wheelGeo,ink,g);o.rotation.x=Math.PI/2;o.scale.set(r,w,r);o.position.set(x,y,z);return o;}
 function railing(a,b,g){
  const length=Math.hypot(...a.map((n,i)=>b[i]-n)),n=Math.max(1,Math.ceil(length/1.8));
  for(const h of [.45,.9])bar([a[0],a[1]+h,a[2]],[b[0],b[1]+h,b[2]],.035,rail,g);
  for(let i=0;i<=n;i++){const p=a.map((v,k)=>v+(b[k]-v)*i/n);bar(p,[p[0],p[1]+.95,p[2]],.035,rail,g);}
 }
 function ladder(x,z,y1,y2,g){
  for(const dx of [-.3,.3])bar([x+dx,y1,z],[x+dx,y2,z],.04,steel,g);
  for(let y=y1;y<y2;y+=.4)bar([x-.3,y,z],[x+.3,y,z],.035,steel,g);
 }
 function boom(a,b,width,g){
  const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz),normal=[-dz/len,dx/len],accent=g.userData.accent;
  const point=(t,side,h=0)=>[a[0]+dx*t+normal[0]*side,a[1]+(b[1]-a[1])*t+h,a[2]+dz*t+normal[1]*side];
  for(const side of [-width/2,width/2]){
   bar(point(0,side),point(1,side),.12,accent,g);bar(point(0,side,.85),point(1,side,.85),.085,steel,g);
   const n=Math.ceil(len/1.5);for(let i=0;i<n;i++)bar(point(i/n,side),point((i+1)/n,side,.85),.05,steel,g);
   railing(point(0,side+.12),point(1,side+.12),g);
  }
  bar(a,b,width*.27,ink,g);
  for(let t=0;t<=1;t+=.1)bar(point(t,-width*.4,.12),point(t,width*.4,.12),.085,steel,g);
 }
 function conveyor(a,b,g,count=1,height=G.belt){
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx),accent=g.userData.accent;
  for(let lane=0;lane<count;lane++){
   const unit=new THREE.Group(),offset=(lane-(count-1)/2)*1.5;g.add(unit);unit.position.set(a[0],0,a[1]);unit.rotation.y=angle;unit.userData.accent=accent;
   box(len/2,height-.18,offset,len,.24,1.1,steel,unit);box(len/2,height+.1,offset,len,.12,.7,ink,unit);
   for(const z of [offset-.55,offset+.55]){
    box(len/2,height-.65,z,len,.13,.12,accent,unit);box(len/2,height+.25,z,len,.08,.08,steel,unit);
    for(let x=0;x<len;x+=2.4)bar([x,height-.6,z],[Math.min(x+2.4,len),height+.25,z],.045,steel,unit);
   }
   // One maintenance walk, handrails, return belt and three-roll trough sets.
   box(len/2,height,offset+.88,len,.12,.5,white,unit);railing([0,height,offset+1.12],[len,height,offset+1.12],unit);
   box(len/2,height-.55,offset,len,.07,.66,ink,unit);
   for(let x=.7;x<len;x+=2.1){bar([x,height+.16,offset-.2],[x,height+.16,offset+.2],.065,steel,unit);for(const s of [-1,1])bar([x,height+.16,offset+s*.2],[x,height+.3,offset+s*.48],.06,steel,unit);}
   for(let x=1;x<len;x+=8){for(const s of [-.5,.5]){box(x,.05,offset+s,.7,.18,.65,white,unit);bar([x,.2,offset+s],[x,height-.5,offset+s],.11,steel,unit);}bar([x,.2,offset-.5],[x,height-.5,offset+.5],.065,steel,unit);}
   for(const x of [.25,len-.25]){axle(x,height+.13,offset,.22,.82,unit);box(x,height+.2,offset-.85,.55,.45,.5,dark,unit);}
  }
 }
 function tower(x,z,g,width=4.8){
  const accent=g.userData.accent;
  for(const a of [-width/2+.4,width/2-.4])for(const b of [-1.9,1.9]){box(x+a,4.2,z+b,.26,8.4,.26,steel,g);bar([x+a,.2,z+b],[x-a,5.6,z+b],.075,steel,g);}
  box(x,8,z,width,2.8,4.4,white,g);box(x,9.55,z,width+.5,.25,4.9,accent,g);
  for(let dx=-width/2+.4;dx<width/2;dx+=.55)box(x+dx,8,z+2.23,.035,2.6,.04,steel,g);
  box(x,6.5,z,width+1,.18,5.3,steel,g);railing([x-width/2-.5,6.6,z+2.65],[x+width/2+.5,6.6,z+2.65],g);
  const hopper=mesh(new THREE.CylinderGeometry(1.45,.55,1.5,4),dark,g);hopper.rotation.y=Math.PI/4;hopper.position.set(x,6,z);
  // Outlet chute and actuator belong to the transfer house, not a disconnected cube.
  bar([x,5.4,z],[x+1,4.9,z],.42,white,g);box(x+.65,5.9,z+.65,.55,.55,.8,accent,g);
  box(x+width*.25,8,z+2.25,1,.65,.07,glass,g);ladder(x-width/2-.7,z+1 ,.3,9.6,g);
  box(x-width/2+.5,10.1,z-.7,.65,1,.65,steel,g);box(x-width/2+.5,10.7,z-.7,.9,.2,.9,accent,g);
 }
 function stacker(x,z,parent,reclaim=false){
  const g=new THREE.Group();parent.add(g);g.position.set(x,0,z);g.userData.accent=parent.userData.accent;const accent=g.userData.accent;
  // Rail bogies, portal, slew ring and feed opening.
  for(const side of [-1.8,1.8]){box(0,.55,side,6,.45,.5,steel,g);for(const dx of [-2.2,-1.5,1.5,2.2])axle(dx,.4,side,.36,.4,g);for(const dx of [-2,2])bar([dx,.8,side],[dx*.6,5.6,side*.7],.18,white,g);}
  box(0,5.6,0,4.5,.45,3.8,accent,g);const pivot=mesh(cylinder,steel,g);pivot.position.set(0,6,0);pivot.scale.set(1.5,.45,1.5);
  box(0,6.6,0,2.8,.8,2.8,white,g);box(1,7.35,1.35,1.7,1.35,1.45,white,g);box(1,7.55,2.1,1.4,.7,.06,glass,g);
  const tip=[-10.7,reclaim?G.reclaimTip:G.stackerTip,-5.5],back=[5.5,8.5,2.85];boom([0,G.center,0],tip,1.15,g);boom([0,G.center+.2,0],back,1.3,g);
  for(const side of [-.8,.8]){bar([side,6.9,.4],[side,12.3,1.2],.15,white,g);bar([side,12.3,1.2],tip,.05,dark,g);bar([side,12.3,1.2],back,.06,dark,g);}
  bar([-.8,12.3,1.2],[.8,12.3,1.2],.16,white,g);box(back[0],back[1],back[2],2.8,1.5,2.5,white,g);
  // A real bucket wheel: radial spokes, hub and open scoop-shaped buckets.
  const rotor=new THREE.Group();rotor.userData.motion="rotor";rotor.position.set(...tip);rotor.position.y-=.45;rotor.rotation.y=-Math.atan2(-5.5,-10.7);g.add(rotor);
  const ring=mesh(ringGeo,steel,rotor);ring.scale.setScalar(1.35);axle(0,0,0,.32,.9,rotor);
  for(let i=0;i<10;i++){const a=i*Math.PI/5;bar([0,0,0],[Math.cos(a)*1.35,Math.sin(a)*1.35,0],.065,steel,rotor);const bucket=new THREE.Group();bucket.position.set(Math.cos(a)*1.4,Math.sin(a)*1.4,0);bucket.rotation.z=a;rotor.add(bucket);box(0,0,0,.55,.18,.8,accent,bucket);for(const side of [-.4,.4])box(0,.2,side,.55,.5,.065,steel,bucket);box(-.25,.18,0,.09,.5,.8,steel,bucket);}
  if(!reclaim){boom([6,G.belt+.05,0],[1,G.center+.2,0],1,g);box(5,4.2,0,1,.25,2.4,steel,g);for(const s of [-1,1])bar([5,.6,s],[5,5.5,s],.1,steel,g);}
  else box(2.2,5.5,0,1.4,1.7,1.4,dark,g);
  ladder(2,1.4 ,.8,7,g);railing([-2,6.1,2],[-.2,6.1,2],g);
 }
 function tripper(x,z,parent,end){
  const sign=end==='shed-a'?-1:1,g=new THREE.Group();parent.add(g);g.position.set(x,0,z);g.userData.accent=parent.userData.accent;
  for(const dx of [-3.5,2])for(const s of [-1,1]){axle(dx,.35,s,.3,.35,g);bar([dx,.6,s],[dx,dx<0?5.6:8.1,s],.14,steel,g);}
  boom([-5,G.coal,0],[2,G.tripperHead,0],1.1,g);axle(2,8.25,0,.45,1.2,g);box(2,7.6,0,2,1.25,2,white,g);
  boom([2,7.3,0],[2,G.tripperOutlet,sign*5],1.05,g);box(2,6.2,sign*5,.8,1.7,.8,g.userData.accent,g);
  railing([-4,5.5,1.5],[2,8.4,1.5],g);ladder(-3,1.4 ,.5,5.6,g);
 }
 function unloader(x,z,parent){
  const g=new THREE.Group();parent.add(g);g.position.set(x,0,z);g.scale.setScalar(.53);g.userData.accent=parent.userData.accent;const accent=g.userData.accent;
  for(const side of [-4,4]){box(0,1,side,9,.7,1,steel,g);for(const dx of [-3.5,-2.5,2.5,3.5])axle(dx,.65,side,.6,.75,g);for(const dx of [-3.2,3.2])bar([dx,1.4,side],[dx*.7,11.8,side*.6],.3,white,g);bar([-3.2,2,side],[2.2,11.8,side*.6],.12,steel,g);}
  box(0,11.8,0,7,.8,7,accent,g);const slew=mesh(cylinder,steel,g);slew.position.set(0,12.7,0);slew.scale.set(2.4,1,2.4);
  box(0,15,-1,4.2,3.5,5,white,g);box(2.8,14.5,2.2,2.3,2.1,2,white,g);box(2.8,14.8,3.25,1.9,1.25,.06,glass,g);
  const {head}=unloaderGeometry();
  boom([0,17,0],head,2.5,g);boom([0,17,0],[0,18,-9],2.7,g);box(0,18,-9,5.5,3,4,white,g);
  for(const side of [-1.5,1.5]){bar([side,15,-2],[side,27,-3],.25,white,g);bar([side,27,-3],head,.08,dark,g);bar([side,27,-3],[side,18,-9],.09,dark,g);}
  bar([-1.5,27,-3],[1.5,27,-3],.22,white,g);
  // Slewing bucket elevator stays vertical while its digging boot turns with it.
  const elevator=new THREE.Group();elevator.position.set(...head);elevator.rotation.y=G.unloaderBucketSlew;g.add(elevator);
  box(0,.3,0,4.3,2.3,4,accent,elevator);
  box(0,-9.1,0,1.6,18.2,2.4,white,elevator);
  const buckets=new THREE.Group();buckets.userData.motion='elevator';elevator.add(buckets);
  for(let i=0;i<24;i++)box(i<12?1.2:-1.2,-18.2+(i%12)*1.5,0,.55,.65,2.6,accent,buckets);
  boom([0,-18.2,0],[0,-18.2,5],2.6,elevator);for(let zz=0;zz<=5;zz+=1.1)box(0,-18.7,zz,3.1,.55,.65,steel,elevator);
  for(const zz of [0,5]){const drum=mesh(wheelGeo,dark,elevator);drum.rotation.z=Math.PI/2;drum.position.set(0,-18.2,zz);drum.scale.set(.9,2.9,.9);}
  box(0,16.1,0,2.8,2,2.8,steel,g);bar([0,15,0],G.unloaderOutlet,.7,white,g);
  // Open discharge beyond the portal deck; coal visibly falls onto the receiving belt.
  const mouth=mesh(new THREE.CylinderGeometry(.8,.6,.7,8,true),steel,g);mouth.position.set(5,14,0);
  for(const side of [-.85,.85])box(5,G.coal/G.unloaderScale-.1,side,3,.6,.12,steel,g);
  railing([-3.5,12.3,-3.5],[3.5,12.3,-3.5],g);ladder(-3.5,-3.5,1.2,12.7,g);ladder(-2,-2,16,27,g);
 }
 return {conveyor,tower,stacker,tripper,unloader};
}
