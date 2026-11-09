import * as THREE from 'three';
import {createTransferModel} from './berth-transfer-model.js';
import {machineryKit} from './berth-machinery.js';
import {siteLayout} from './berth-site-layout.js';
import {blendLines,silosPerUnit,blendBuildingLayout as layout} from '../../data/fuel-reference/blend-lines.js';
import {createFlowEffect} from './coal-flow-effect.js';

/** Source-connected reclaim diagram. Plan relationships follow the Earth/photo
 * comparison; dimensions, facades and exposed bunker internals are illustrative. */
export function createBlendModel({yardOnly=1,baselineLots=null}={}){
  const line=blendLines.find(l=>l.id===yardOnly)||blendLines[0];
  const yard=createTransferModel({yardOnly:line.yard,baselineLots});
  const root=new THREE.Group(),resources=new Set(),own=v=>(resources.add(v),v);
  const loc=siteLayout.yards.find(y=>y.id===line.yard),scale=180/loc.length;
  yard.root.scale.setScalar(scale);yard.root.position.set(-loc.x*scale,0,layout.yardZ-loc.z*scale);root.add(yard.root);
  const anchors=new Map(),pickables=[...yard.pickables],yardLabels=[],boilers=new Map(),assets=new Map(),flows=[],connections=[],reclaimAssets=[];
  const mat=(color,roughness=.7,metalness=.15)=>own(new THREE.MeshStandardMaterial({color,roughness,metalness}));
  const white=mat('#e1e9ed'),steel=mat('#9aafbf',.5,.4),ink=mat('#354a59'),glass=mat('#537c93'),blue=mat('#75abc5'),concrete=mat('#d1dce4');
  const roofMetal=mat('#aeb6c0'),galleryRoof=mat('#b4afc5'),plantSkins=[];
  const cube=own(new THREE.BoxGeometry(1,1,1)),cylinder=own(new THREE.CylinderGeometry(1,1,1,12));
  const mesh=(geometry,material,parent=root)=>{const m=new THREE.Mesh(own(geometry),material);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const box=(x,y,z,w,h,d,m,parent=root)=>{const o=mesh(cube,m,parent);o.position.set(x,y,z);o.scale.set(w,h,d);return o;};
  function skin(type,x,y,z,w,h,d,m,parent=root){const o=box(x,y,z,w,h,d,m,parent);o.userData.plantSkin=type;plantSkins.push(o);return o;}
  const bar=(a,b,r,m,parent=root)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av),o=mesh(cylinder,m,parent);o.position.copy(av.add(bv).multiplyScalar(.5));o.scale.set(r,v.length(),r);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;};
  const kit=machineryKit({THREE,mesh,box,bar,mat,cylinder,white,steel,ink,glass});
  function group(id,code,name,signal=null){const g=new THREE.Group();g.userData.accent=mat('#75a1c5');root.add(g);assets.set(id,{id,code,name,signal,g});return g;}
  // Two physically distinct A/B decks. Rising galleries carry the same full
  // endpoint coordinates as the coal particles, without detached drop points.
  function belt(id,code,a,b,{signal=null,count=2,covered=true}={}){
    const g=group(id,code,'상탄 컨베이어',signal),dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length];
    connections.push({code,a:[...a],b:[...b],count});
    if(Math.abs(a[1]-b[1])<.01)kit.conveyor([a[0],a[2]],[b[0],b[2]],g,count,a[1]);
    else for(let lane=0;lane<count;lane++){
      const offset=(lane-(count-1)/2)*1.8;
      const p=(t,s=0,h=0)=>[a[0]+dx*t+normal[0]*(offset+s),a[1]+(b[1]-a[1])*t+h,a[2]+dz*t+normal[1]*(offset+s)];
      for(const s of [-.6,.6]){bar(p(0,s),p(1,s),.13,g.userData.accent,g);bar(p(0,s,1),p(1,s,1),.07,steel,g);}
      bar(p(0),p(1),.32,ink,g);
      const n=Math.max(2,Math.ceil(length/2.4));
      for(let i=0;i<=n;i++){const t=i/n;bar(p(t,-.55,.12),p(t,.55,.12),.08,steel,g);if(i<n)bar(p(t,-.6),p((i+1)/n,-.6,1),.045,steel,g);}
      for(let t=.12;t<1;t+=.25){const q=p(t);for(const s of [-.65,.65]){const r=p(t,s);bar([r[0],0,r[2]],r,.12,steel,g);}box(q[0],.05,q[2],2,.2,2,concrete,g);}
    }
    if(covered){
      const cover=new THREE.Group(),direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),span=direction.length(),width=count===2?4.8:2.8;
      g.add(cover);cover.position.set(...a);cover.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction.normalize());
      skin('gallery',span/2,2.3,0,span,.2,width,galleryRoof,cover);
      for(const side of [-1,1])skin('gallery',span/2,1.2,side*width/2,span,2.2,.12,white,cover);
      for(let t=2;t<span;t+=5)skin('gallery',t,2.43,0,.12,.08,width+.1,steel,cover);
    }
    anchors.set(id,new THREE.Vector3(...a).lerp(new THREE.Vector3(...b),.5));
    if(signal){const effect=createFlowEffect(THREE,root,own);flows.push({effect,signal,points:[a.map((v,i)=>i===1?v+.25:v),b.map((v,i)=>i===1?v+.25:v)]});}
    return g;
  }
  function house(id,code,x,z,signal=null,height=8){
    const g=group(id,code,code.startsWith('SCB')?'샘플링·파쇄 설비 (CN/CQ)':'이송·분기 타워',signal);
    kit.tower(x,z,g,5.5);g.scale.y=height/8;anchors.set(id,new THREE.Vector3(x,height+4,z));return g;
  }
  root.updateMatrixWorld(true);
  const yardPoint=id=>yard.anchors.get(id).clone().applyMatrix4(yard.root.matrixWorld);
  let start;
  if(line.yard===1){
    // CV06 is the shared collector passing all three return outlets.
    const outlets=['tt04','tt05','tt06'].map(yardPoint);
    for(let i=0;i<2;i++)belt('blend-collector-'+i,'CV-06A/B',[outlets[i].x,5.2*scale,outlets[i].z],[outlets[i+1].x,5.2*scale,outlets[i+1].z],{signal:'cv06ab'});
    start=[outlets[2].x,5.2*scale,outlets[2].z];
  }else if(line.yard===2){const p=yardPoint('tt55');start=[p.x,5.2*scale,p.z];}
  else{
    // Separate return rails along the outside of A/B sheds; TT95 remains the
    // incoming connection of the shared yard model and is never a reclaim exit.
    const left=-90,right=90,aZ=layout.yardZ-loc.width*scale/2-2,bZ=layout.yardZ+loc.width*scale/2+2;
    belt('blend-94a','CV-94A',[right,6,aZ],[left,6,aZ],{count:1});
    belt('blend-94b','CV-94B',[right,6,bZ],[left,6,bZ],{count:1});
    belt('blend-94c','CV-94C',[left,6,aZ],[left,6,bZ],{count:1});
    house('blend-tt96','TT-96',left,aZ);house('blend-tt97','TT-97',left,bZ);
    for(const [code,x,z,side] of [['RE-91C',-48,aZ,1],['RE-91A',46,aZ,1],['RE-91D',-48,bZ,-1],['RE-91B',46,bZ,-1]]){
      const g=group(code,code,'옥내 상탄기 · 외형 개념');reclaimAssets.push(code);
      // Rail-mounted portal with a scraper boom reaching toward its own shed.
      for(const xx of [-2.5,2.5]){box(x+xx,1,z,1,1.3,2,steel,g);bar([x+xx,1,z],[x+xx,8,z],.2,steel,g);}
      box(x,8,z,7,1.2,3,white,g);bar([x,8,z],[x,1.1,z+side*14],.35,steel,g);
      bar([x,8,z],[x,9,z+side*7],.12,blue,g);bar([x,9,z+side*7],[x,1.1,z+side*14],.12,blue,g);
      anchors.set(code,new THREE.Vector3(x,10,z));
    }
    start=[left,6,bZ];
  }
  for(let i=0;i<line.stages.length;i++){
    const stage=line.stages[i],[x,z]=line.nodes[i],height=i===line.stages.length-1?20:7,end=[x,height,z];
    // Every change of direction occurs at a right angle in plan. The final
    // gallery runs through the boiler gap to the transverse tripper band.
    if(Math.abs(start[0]-x)>.01&&Math.abs(start[2]-z)>.01){
      const elbow=[start[0],height,z];
      belt('blend-main-'+i+'-approach',stage.code,start,elbow,{signal:stage.signal});
      belt('blend-main-'+i,stage.code,elbow,end,{signal:stage.signal});
    }else belt('blend-main-'+i,stage.code,start,end,{signal:stage.signal});
    house('blend-node-'+i,stage.to,x,z,stage.houseSignal,height+1);
    start=end;
  }
  // TTT01/02 are between the second and third unit; TTT03 is before unit9.
  for(const [i,branch]of line.branches.entries())belt('blend-distribution-'+i,branch.code,[line.distributionX,20,layout.millZ],[branch.toX,20,layout.millZ],{covered:false});
  const xs=line.units.length===4?[-63,-21,21,63]:[-28,28],unitPositions=[];
  for(let i=0;i<line.units.length;i++){
    const unit=line.units[i],x=xs[i],z=layout.boilerZ,g=new THREE.Group();root.add(g);
    const accent=mat('#8eafbd');boilers.set(unit,{g,accent});unitPositions.push({unit,x,z});
    box(x,-.5,z,39,.7,27,concrete,g);
    // Enclosed pale facades, tall blue vertical panels and stepped upper roof
    // seen in Dangjin press/site photos, rather than a generic exposed furnace.
    box(x,20,z,25,32,22,white,g);box(x,36.3,z,26,.6,23,accent,g);
    box(x,39,z-1,19,5,18,white,g);box(x,41.7,z-1,20,.4,19,accent,g);
    if(line.yard<3){
      box(x,23,z+11.1,9,25,.22,blue,g);
      for(let y=12;y<36;y+=3.4)box(x,y,z+11.3,9,.13,.15,white,g);
      for(const dx of [-3,0,3])box(x+dx,23,z+11.3,.12,25,.15,white,g);
      box(x,38,z+8.1,9,4,.25,accent,g);
    }else{
      for(const dx of [-10,-7,3,8])box(x+dx,22,z+11.1,1.5,27,.2,blue,g);
      box(x-8,22,z+13,5,29,5,white,g);
      for(let y=11;y<36;y+=3)box(x-9.7,y,z+15.55,.65,1.1,.12,glass,g);
      for(const dx of [-7,-2,3,8])box(x+dx,42.1,z-1,1,.8,14,steel,g);
    }
    for(const side of [-1,1])for(let y=8;y<35;y+=3.5)box(x+side*12.55,y,z,.1,.15,21,steel,g);
    // Six silos per unit, confirmed by the user. Each discharges into a small
    // coal feeder and then the pulverizer below. Only dimensions are conceptual.
    for(let slot=0;slot<silosPerUnit;slot++){
      const dx=(slot-(silosPerUnit-1)/2)*4,identity={unit,index:slot+1};
      const siloZ=layout.millZ;
      const b=mesh(new THREE.CylinderGeometry(1.6,1.6,7,14),steel,g);b.position.set(x+dx,15.8,siloZ);b.userData.silo=identity;
      const cone=mesh(new THREE.CylinderGeometry(1.6,.55,3,14),white,g);cone.position.set(x+dx,10.8,siloZ);
      const feeder=box(x+dx,8.7,siloZ,2.8,1.2,1.8,accent.clone(),g);feeder.userData.coalFeeder=identity;
      box(x+dx,8.7,siloZ+.95,1.5,.45,.15,ink,g);
      box(x+dx,.7,siloZ,2.9,1.4,2.9,concrete,g);
      const mill=mesh(new THREE.CylinderGeometry(1.1,1.4,3.4,12),steel,g);mill.position.set(x+dx,3.1,siloZ);mill.userData.pulverizer=identity;
      bar([x+dx,4.8,siloZ],[x+dx,8.1,siloZ],.4,ink,g);bar([x+dx,3.8,siloZ],[x+dx,7,z+10],.3,white,g);
      box(x+dx,19.9,siloZ,1.6,1.2,2.8,white,g);
      for(const side of [-1.8,1.8])bar([x+dx+side,0,siloZ],[x+dx+side,20,siloZ],.08,steel,g);
    }
    anchors.set('unit-'+unit,new THREE.Vector3(x,46,z));yardLabels.push({text:unit+'호기',point:anchors.get('unit-'+unit)});
    g.traverse(o=>{if(o.isMesh){o.userData.unitId=unit;pickables.push(o);}});
  }
  // Three adjoining building bands, in the user's Earth-photo order:
  // turbine hall → mill/silo room (tripper above) → boilers. Envelopes are
  // shown by default; an independent cutaway exposes the machinery inside.
  const hallWidth=line.units.length===4?166:96;
  const millWidth=line.yard===3?126:hallWidth,millX=line.yard===3?-15:0;
  box(millX,-.3,layout.millZ,millWidth,.6,12,concrete);
  for(const side of [-1,1])skin('mill',millX,11.5,side*6,millWidth,23,.25,white);
  for(const side of [-1,1])skin('mill',millX+side*millWidth/2,11.5,0,.25,23,12,white);
  skin('mill',millX,23.15,0,millWidth+.4,.3,12.4,galleryRoof);
  for(let x=millX-millWidth/2+3;x<millX+millWidth/2;x+=6){
    for(const side of [-1,1]){box(x,11.5,side*5.8,.18,23,.18,steel);skin('mill',x,20.8,side*6.18,3.8,1,.1,glass);}
    skin('mill',x,23.4,0,.12,.1,12.4,steel);
  }
  const hallZ=layout.turbineZ,hallDepth=28;
  box(0,-.3,hallZ,hallWidth,.6,hallDepth,concrete);
  for(const side of [-1,1]){
    skin('turbine',0,6,hallZ+side*hallDepth/2,hallWidth,12,.3,white);
    skin('turbine',side*hallWidth/2,6,hallZ,.3,12,hallDepth,white);
  }
  skin('turbine',0,12.2,hallZ,hallWidth+1,.4,hallDepth+1,roofMetal);
  for(let x=-hallWidth/2+4;x<hallWidth/2;x+=8){
    skin('turbine',x,9,hallZ+hallDepth/2+.2,5,2,.1,glass);
    skin('turbine',x,12.8,hallZ,2,1,18,steel);
    for(const side of [-1,1])box(x,6,hallZ+side*(hallDepth/2-.3),.2,12,.2,steel);
  }
  for(const x of (line.units.length===4?[-42,42]:[0])){
    const stack=mesh(new THREE.CylinderGeometry(1.6,2.6,52,16),white);stack.position.set(x,26,-57);
    const rim=mesh(new THREE.CylinderGeometry(1.7,1.7,2,16),blue);rim.position.set(x,51,-57);
  }
  yardLabels.push({text:line.source,point:new THREE.Vector3(0,3,layout.yardZ-24)},{text:`TTT-0${line.id}`,point:new THREE.Vector3(line.distributionX,27,0)},
    {text:'터빈동',point:new THREE.Vector3(0,14,hallZ+9)},{text:'미분기룸 · 상부 트리퍼',point:new THREE.Vector3(millX-millWidth/2+2,25,5)});
  for(const [id,a] of assets)a.g.traverse(o=>{if(o.isMesh){o.userData.part=id;pickables.push(o);}});
  let selectedUnit=line.units[0],snapshot=null,online=false,plantInspection=false;
  function syncAnchors(){yard.root.updateMatrixWorld(true);for(const [id,p]of yard.anchors)anchors.set(id,p.clone().applyMatrix4(yard.root.matrixWorld));}
  syncAnchors();
  function selectUnit(id){selectedUnit=id;for(const [unit,b]of boilers)b.accent.color.set(unit===id?'#2447c5':'#8eafbd');}
  selectUnit(selectedUnit);
  return {root,anchors,pickables,yardLabels,stockMeshes:yard.stockMeshes,
    setRoute(){},selectStock:id=>yard.selectStock(id),hoverStock:id=>yard.hoverStock(id),clearanceSelection:()=>null,
    setRoofInspection:v=>yard.setRoofInspection(v),selectUnit,
    setPlantInspection(v){plantInspection=!!v;for(const skin of plantSkins)skin.visible=!plantInspection;},
    assetInfo:id=>{const a=assets.get(id);return a?{...a,status:snapshot?.equipment?.[a.signal]?.status}:null;},
    applyTelemetry(next,connected,clock){snapshot=next;online=connected;yard.applyTelemetry(next,connected,clock);syncAnchors();
      root.traverse(object=>{if(!object.isMesh||!object.userData.coalFeeder)return;const {unit,index}=object.userData.coalFeeder,reading=next?.silos?.[`${unit}-${index}`],running=connected&&next?.playing&&reading?.actualRate>0;object.material.emissive?.set(running?'#2447c5':'#000000');if('emissiveIntensity' in object.material)object.material.emissiveIntensity=running?.8:0;});
      const job=next?.material?.jobs?.reclaim,active=connected&&next?.playing&&job?.actualRate>0;
      for(const f of flows){const s=next?.equipment?.[f.signal],running=active&&job.route?.includes(f.signal)&&s?.status==='running'&&s.flow>0;f.effect.update([{points:f.points}],s?.flow||0,clock/Math.max(1,next?.speed||1),!!running);}
      for(const a of assets.values()){const s=next?.equipment?.[a.signal],activeFlow=active&&job.route?.includes(a.signal)&&s?.status==='running'&&s.flow>0;a.g.userData.accent.emissive.set(activeFlow?'#2447c5':'#000000');a.g.userData.accent.emissiveIntensity=activeFlow?.65:0;}
    },
    debug(){return {boilerUnits:line.units,unitPositions,connections,buildingBands:{turbine:{z:layout.turbineZ},mill:{z:layout.millZ},boiler:{z:layout.boilerZ},yard:{z:layout.yardZ}},plantInspection,connectionCount:connections.length,distributionTower:`TTT-0${line.id}`,distributionX:line.distributionX,distributionBranches:line.branches,reclaimOrigin:line.yard===3?'TT-97':line.outlet,reclaimAssets,downstreamFlow:false,activeConveyors:[...new Set(flows.filter(f=>f.effect.group.visible).map(f=>f.signal))],selectedUnit,online,yard:yard.debug()};},
    dispose(){yard.dispose();resources.forEach(r=>r.dispose?.());resources.clear();},
  };
}
