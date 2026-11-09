import {harbourLayout as H,harbourPoint} from './berth-site-layout.js';
import {BerthNetwork} from '../../data/fuel-reference/berth-network.js';

/** Coastal civil works, registered to the receiving belts. No dispatch state. */
export function createHarbour({THREE,root,mesh,box,bar,mat,own,concrete,steel,ink,layout=H,project=harbourPoint,compact=false}){
 const works=new THREE.Group();works.name='해안 · 해상 교량 · 접안 잔교';root.add(works);
 const land=mat('#b6bdb8',.98,0),road=mat('#697477',.96,0),riprap=mat('#818c90',1,0),kerb=mat('#cbd1cc',.98,0);
 const lavender=mat('#a8a5bd',.76,.2),cream=mat('#c9ccc1',.76,.2),green=mat('#53675b',1,0);
 // One land parcel stops at the sea wall; no broad apron under the offshore berth.
 box(12,-1.15,-1,366,1.3,82,land,works);
 box(12,-.4,37,366,.18,4.2,road,works);
 for(const z of [34.7,39.3])box(12,-.22,z,366,.22,.35,kerb,works);
 box(12,-.7,41,366,1.1,3.5,riprap,works);
 const slope=mesh(new THREE.PlaneGeometry(366,6),riprap,works);slope.rotation.x=-Math.PI*.40;slope.position.set(12,-1.65,44);
 for(let x=-158;x<183;x+=7)box(x,-.27,37,2.6,.035,.12,kerb,works);
 for(let x=-155;x<183;x+=3.3){if(x>-32&&x<18)continue;box(x,.15,32.9,2.7,1.3,1.3,green,works);}
 const cylinder=own(new THREE.CylinderGeometry(1,1,1,8));
 function pile(x,z){const p=mesh(cylinder,concrete,works);p.position.set(x,-2,z);p.scale.set(.32,5,.32);}
 function walk(a,b,width=1.2){
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),g=new THREE.Group();g.position.set(a[0],0,a[1]);g.rotation.y=-Math.atan2(dz,dx);works.add(g);
  box(len/2,.28,0,len,.24,width,steel,g);
  for(const s of [-1,1]){bar([0,1.15,s*width/2],[len,1.15,s*width/2],.045,steel,g);for(let x=0;x<=len;x+=2)bar([x,.4,s*width/2],[x,1.15,s*width/2],.04,steel,g);}
 }
 function dolphin(x,z){box(x,.1,z,2.5,1,2.5,concrete,works);for(const dx of [-.7,.7])for(const dz of [-.7,.7])pile(x+dx,z+dz);box(x,.8,z,.4,.45,.5,ink,works);}
 for(const jetty of layout.jetties){
  const [x1,z]=jetty.from,[x2]=jetty.to,w=jetty.width;
  box((x1+x2)/2,-.05,z,x2-x1,.9,w,concrete,works);
  for(const dz of [-2.12,2.12])box((x1+x2)/2,.47,z+dz,x2-x1,.1,.12,steel,works);
  for(let x=x1+2;x<x2;x+=6){for(const dz of [-w/2+1,w/2-1])pile(x,z+dz);box(x,.02,z+w/2,1.4,1.7,.55,ink,works);box(x,.65,z+w/2-.9,.5,.45,.55,steel,works);}
  for(const [x,sign] of [[x1,-1],[x2,1]]){
   const a=[x+sign*7,z-2],b=[x+sign*12,z+4];dolphin(...a);dolphin(...b);walk([x,z],a,.8);walk(a,b,.8);
  }
 }
 for(const bridge of layout.bridges){
  const [sx,sz]=bridge.shore,[ex,ez]=bridge.sea,dx=ex-sx,dz=ez-sz,len=Math.hypot(dx,dz);
  const g=new THREE.Group();g.position.set(sx,0,sz);g.rotation.y=-Math.atan2(dz,dx);works.add(g);
  box(len/2,-.05,0,len,.7,bridge.width,concrete,g);
  for(const side of [-1,1]){
   const zz=side*(bridge.width/2-.5);
   bar([0,.7,zz],[len,.7,zz],.065,steel,g);
   for(let x=1;x<len;x+=5){bar([x,-4,zz],[x,.35,zz],.25,concrete,g);bar([x,.35,zz],[x,1,zz],.06,steel,g);}
  }
 }
 // Roof strips follow the actual conveyor centerlines, not a replacement link.
 // Open slots leave the moving coal readable below the longitudinal enclosure.
 function cover(a,b,width,m){
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),g=new THREE.Group();g.position.set(a[0],0,a[1]);g.rotation.y=-Math.atan2(dz,dx);works.add(g);
  for(let x=0;x<len;x+=4.2){box(x+1.6,6.15,0,3.15,.14,width,m,g);for(const z of [-width/2,width/2])bar([x,4.6,z],[x,6.15,z],.065,steel,g);}
  for(const side of [-1,1])box(len/2,5.7,side*width/2,len,.7,.08,m,g);
 }
 for(const id of ['cv02ab','cv52ab','cv52c']){
  const points=project.beltPoints(id,BerthNetwork.get(id).points.map(p=>project(id,p)));
  for(let i=1;i<points.length;i++)cover(points[i-1],points[i],id==='cv52c'?2.1:3.9,id==='cv02ab'?cream:lavender);
 }
 return works;
}
