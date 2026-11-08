import {BerthNetwork} from '../../data/fuel-reference/berth-network.js';
import {BerthRoutes} from '../../data/fuel-reference/berth-routes.js';
import {YardData} from '../../data/fuel-reference/yard-snapshot.js';
import {selectedClearances} from './yard-clearance-data.js';
import {yard2,profileFor,estimateHeap,heapPlacement,heapVolume,dimensionText,estimateClearances,photoPosition} from '../../data/fuel-reference/yard2-calibration.js';
import {transferGeometry as G,beltHeight} from './transfer-geometry.js';
import {assetFlowPaths,isCoalFlowing,machinePose,workFor,unloaderPoints} from './coal-flow-paths.js';
import {createFlowEffect,detachMotion,withinMotion,animateMachinery} from './coal-flow-effect.js';
import * as THREE from 'three';
import {createBulkCarrier} from './berth-ship-model.js';
import {siteLayout,sitePoint as yardPoint,harbourPoint,harbourLayout as fullLayout,receivingLayout,receivingPoint,yard1DisplayX} from './berth-site-layout.js';
import {createHarbour} from './berth-harbour.js';
import {coalHeight,createCoalWindrow,coalSurfaceHeight,reshapeCoalWindrow} from './coal-windrow.js';
import {machineryKit} from './berth-machinery.js';
import {stockSnapshot,endpointLots,stockDescription} from './berth-stock-data.js';
import {yardBaselineLots} from '../../domain/yard-baseline-lots.js';

// Spatial arrangement follows the source schematic: yard 1 left, yard 2 right,
// A/B sheds behind yard 2, separate 01 and 51/91 receiving spines in between.
export function createTransferModel({yardOnly=null,compact=false,baselineLots=null}={}){
 const databaseLots=baselineLots===null?null:yardBaselineLots(baselineLots);
 const harbourLayout=compact?receivingLayout:fullLayout;
 const sitePoint=yardOnly?yardPoint:compact?receivingPoint:harbourPoint;
 const root=new THREE.Group(),resources=new Set(),groups=new Map(),pickables=[],anchors=new Map(),endpoints=new Map(),yardLabels=[],roofs=new Map(),stockMeshes=new Map();
 let inspectRoofs=false,hoveredStock=null,selectedStock=null,demoState=null,demoOnline=false;
 const flowMarkers=new Map(),motions=new Map();
 const N=BerthNetwork,R=BerthRoutes,own=v=>(resources.add(v),v);
 const mat=(color,roughness=.7,metalness=.15)=>own(new THREE.MeshStandardMaterial({color,roughness,metalness}));
 const white=mat('#dce4e8'),steel=mat('#9baab6',.5,.38),ink=mat('#344653'),coal=mat('#424b55',.9,0),concrete=mat('#cad4db',.95,0),glass=mat('#345774',.3,.3),safety=mat('#a9a08b');
 const base=own(new THREE.BoxGeometry(1,1,1)),cylinder=own(new THREE.CylinderGeometry(1,1,1,7));
 const mesh=(geo,m,parent=root)=>{const o=new THREE.Mesh(own(geo),m);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;};
 const box=(x,y,z,w,h,d,m,parent=root)=>{const o=mesh(base,m,parent);o.position.set(x,y,z);o.scale.set(w,h,d);return o;};
 const bar=(a,b,r,m,parent=root)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),o=mesh(cylinder,m,parent);o.position.copy(av.add(bv).multiplyScalar(.5));o.scale.set(r,d.length(),r);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());o.castShadow=false;return o;};
 function group(id){const g=new THREE.Group();g.userData.accent=mat('#829baa');g.userData.id=id;root.add(g);groups.set(id,g);return g;}
 const {conveyor,tower,stacker,tripper,unloader}=machineryKit({THREE,mesh,box,bar,mat,cylinder,white,steel,ink,glass});

 for(const asset of N.assets.filter(a=>!yardOnly||N.yardAssets(yardOnly).includes(a.id))){
  const g=group(asset.id),points=asset.points.map(p=>sitePoint(asset.id,p)),[a,b]=points;
  if(asset.kind==='belt'){
   const beltPoints=sitePoint.beltPoints?.(asset.id,points)||points;
   for(let i=1;i<beltPoints.length;i++)conveyor(beltPoints[i-1],beltPoints[i],g,asset.count,beltHeight(asset));
  }
  if(asset.kind==='tower'){
   if(asset.twin){
    for(const [side,dx] of [['A',-9],['B',9]]){
     const part=group(asset.id+side);
     tower(a[0]+dx,a[1],part);
     part.traverse(o=>{if(o.isMesh)o.userData.part=asset.id+side;});
     anchors.set(asset.id+side,new THREE.Vector3(a[0]+dx,10,a[1]));
    }
    // One supported link between the two transfer houses. No free-standing
    // hoppers: those implied additional branches with no downstream conveyor.
    const bridge=new THREE.Group();bridge.name=asset.id+'-link';bridge.userData.accent=g.userData.accent;g.add(bridge);
    conveyor([a[0]+6.6,a[1]],[a[0]-6.6,a[1]],bridge,1,G.belt);
   }else tower(a[0],a[1],g,asset.wide||4.8);
  }
  if(asset.kind==='unloader')for(const p of unloaderPoints(asset,sitePoint))unloader(p[0],p[1],g);
  if(asset.kind==='stacker'||asset.kind==='reclaimer')stacker(a[0],a[1],g,asset.kind==='reclaimer');
  if(asset.kind==='tripper')tripper(a[0],a[1],g,asset.ends[0]);
  const pos=asset.kind==='belt'?[(a[0]+b[0])/2,(a[1]+b[1])/2]:a;
  anchors.set(asset.id,new THREE.Vector3(pos[0],asset.kind==='tower'?7.5:asset.kind==='belt'?(beltHeight(asset))+.4:5,pos[1]));
 }
 // Reuse the small carrier and quayside design. Only the selected berth's vessel is inspected.
 const carrier=yardOnly?{ship:new THREE.Group(),dispose(){}}:createBulkCarrier({includePort:false});carrier.ship.scale.setScalar(.19);root.add(carrier.ship);
 const workingCarrier=yardOnly?null:createBulkCarrier({includePort:false});if(workingCarrier){workingCarrier.ship.scale.setScalar(.19);workingCarrier.ship.visible=false;root.add(workingCarrier.ship);}
 // The live scene draws one generic silhouette per observed berth. Geometry
 // and materials are shared with the carrier; AIS provides no hold readings.
 const observedShips=yardOnly?[]:[1,2,3].map(id=>{
  const ship=carrier.ship.clone(),v=harbourLayout.vessels[id];
  ship.name='ais-berth-'+id;ship.position.set(v.x,0,v.z);ship.visible=false;root.add(ship);return ship;
 });
 if(!yardOnly)createHarbour({THREE,root,mesh,box,bar,mat,own,concrete,steel,ink,layout:harbourLayout,project:sitePoint,compact});
 const residue=own(new THREE.MeshStandardMaterial({color:yardOnly?'#8d969d':'#575f64',roughness:1}));
 coal.vertexColors=true;
 function stockMound(lot,px,z,length,width,g){
  const depleted=lot.tons===0,reference=depleted?2000:lot.tons,calibrated=lot.yard==='P2',floorLength=length;
  const dimensions=calibrated?estimateHeap(lot.pile,reference):null;
  if(calibrated){length=dimensions.length*yard2.scene.scale;width=dimensions.width*yard2.scene.scale;}
  const h=calibrated?dimensions.height*yard2.scene.scale:coalHeight(reference,length,width);
  const material=own(coal.clone()),m=mesh(createCoalWindrow(THREE,{length,width,height:h,seed:lot.id,calibrated}),material,g);m.position.set(px,.26,z);m.userData.lotId=lot.id;m.visible=!depleted;
  if(calibrated&&photoPosition(lot).positionSource==='previous-demo'){
   material.transparent=true;material.opacity=.48;material.depthWrite=false;
   const lineGeo=own(new THREE.BufferGeometry().setFromPoints([[-length/2,-width/2],[length/2,-width/2],[length/2,width/2],[-length/2,width/2],[-length/2,-width/2]].map(([x,d])=>new THREE.Vector3(px+x,.31,z+d))));
   const outline=new THREE.Line(lineGeo,own(new THREE.LineDashedMaterial({color:'#687f91',dashSize:.6,gapSize:.35})));outline.computeLineDistances();g.add(outline);
  }
  let floor=null;if(depleted){floor=mesh(new THREE.PlaneGeometry(floorLength,calibrated?profileFor(lot.pile).width*yard2.scene.scale:width),own(residue.clone()),g);floor.rotation.x=-Math.PI/2;floor.position.set(px,.27,z);floor.userData.lotId=lot.id;}
  stockMeshes.set(lot.id,{mesh:m,floor,lot,reference,base:material.color.clone(),height:h,currentTons:lot.tons,calibrated,dimensions:calibrated?estimateHeap(lot.pile,lot.tons):null});
  const anchorX=!yardOnly?(/^P[1-4]-/.test(lot.id)?yard1DisplayX(px):/^[ab]\d/.test(lot.id)?px+harbourLayout.yard3Offset:px):px;
  anchors.set('lot:'+lot.id,new THREE.Vector3(anchorX,.26+(depleted?0:h),z));
 }
 for(const y of R.yards.filter(y=>!yardOnly||y.id===yardOnly)){
  const yard=new THREE.Group();root.add(yard);const left=y.id===1?-130:23,right=y.id===1?-31:y.id===2?yard2.scene.right:137;
  if(y.id===1){yard.scale.z=.82;yard.position.z=13.5*(1-.82);}
  if(!yardOnly&&y.id===1){yard.scale.x=harbourLayout.yard1Stretch;yard.position.x=23*(harbourLayout.yard1Stretch-1);}
  if(!yardOnly&&y.id===3)yard.position.x=harbourLayout.yard3Offset;
  if(y.id<3)box((left+right)/2,-.45,y.id===2?yard2.scene.center:13.5,right-left+4,.6,y.id===2?yard2.scene.width+2:44,concrete,yard);
  if(y.id===2)box(yard2.scene.centerX,.65,yard2.scene.wallZ,yard2.scene.length,1.3,.24,concrete,yard);
  else if(y.id===3)box(82.5,-.45,-23.5,110,.6,24,concrete,yard);
  for(let i=0;i<y.ids.length;i++){
   const id=y.ids[i],z=y.id===3?(i===0?-30:-17):y.id===2?yard2.scene.centerZ[i+5]:-3.5+i*11,len=y.id===3?90:right-left;
   const x=y.id===3?82.5:(left+right)/2,g=new THREE.Group();yard.add(g);
   const laneWidth=y.id===2?profileFor(i+5).width*yard2.scene.scale:y.id===3?10:8;
   const surface=mat('#d4dde3');box(x,.1,z,len,.2,laneWidth,surface,g);
   if(y.id===1){
    const plane=mesh(new THREE.PlaneGeometry(len,8),residue,g);plane.rotation.x=-Math.PI/2;plane.position.set(x,.23,z);
    const photo=YardData,lane=photo.lanes[i];
    for(const lot of (databaseLots ? databaseLots.filter(l=>l.yard===1&&l.pile===i+1).map(l=>({...l,pile:'P'+l.pile})) : photo.pileLots('P'+(i+1)))){
     const length=(lot.to-lot.from)/lane.lengthM*len,px=left+(1-(lot.from+lot.to)/2/lane.lengthM)*len;
     stockMound(lot,px,z,length,6.9,g);
    }
   }
   if(y.id===3){
    if(yardOnly)for(let cell=10;cell>=1;cell--){
     const px=37.5+(10-cell+.5)*9,cellId=(i===0?'A':'B')+cell;
     const floor=box(px,.22,z,8.9,.015,9.9,own(residue.clone()),g);floor.userData.cellId=cellId;
     anchors.set('cell:'+cellId,new THREE.Vector3(px,.5,z));
    }
    // Ten source cells per shed. Their footprint is illustrative, not capacity.
    for(let px=37.5;px<=127.5;px+=9){
     for(const zz of [-5,5])bar([px,0,z+zz],[px,7.4,z+zz],.09,steel,g);
     box(px,.45,z,.12,.8,10,concrete,g);
    }
   }
   if(y.id===2){const floor=mesh(new THREE.PlaneGeometry(len,laneWidth),residue,g);floor.rotation.x=-Math.PI/2;floor.position.set(x,.23,z);}
   if(y.id===2)for(const lot of (databaseLots ? databaseLots.filter(l=>l.yard===2&&'pile-'+l.pile===id).map(l=>({...l,yard:'P2'})) : endpointLots(id))){
    const p=photoPosition(lot),floorLength=p.photoRange?(p.photoRange[1]-p.photoRange[0])*yard2.scene.scale:(lot.span[1]-lot.span[0])*len;
    stockMound(lot,p.x,z,floorLength,6.8,g);
   }
   if(y.id===3)for(const lot of (databaseLots ? databaseLots.filter(l=>l.yard===3&&'shed-'+l.shed.toLowerCase()===id).map(l=>({...l,yard:'P3'})) : endpointLots(id))){
    stockMound(lot,37.5+(10-lot.cell+.5)*9,z,8.35,8.7,g);
   }
   const displayX=!yardOnly?(y.id===1?yard1DisplayX(x):y.id===3?x+harbourLayout.yard3Offset:x):x;
   endpoints.set(id,{g,surface});anchors.set(id,new THREE.Vector3(displayX,.4,y.id===1?13.5+(z-13.5)*.82:z));g.traverse(o=>{if(o.isMesh){o.userData.part=id;pickables.push(o);}});
  }
 }
 // Finished roof and exposed frame are different parts, not identical wire cages.
 const roofMaterial=()=>{const m=mat('#d2dce3',.8,.12);m.side=THREE.DoubleSide;m.transparent=true;return m;};
 const roof2=roofMaterial(),roof3=roofMaterial(),solar=mat('#25485f',.52,.3),solarFrame=mat('#8b9eac',.5,.4);
 solar.transparent=solarFrame.transparent=true;
 const roofGroups={2:new THREE.Group(),3:new THREE.Group()};root.add(roofGroups[2],roofGroups[3]);
 function vault(x1,x2,z,w,eave,rise,m,g){
  const geo=new THREE.PlaneGeometry(x2-x1,w,1,20);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,eave+rise*Math.sin((p.getZ(i)/w+.5)*Math.PI));
  geo.computeVertexNormals();const shell=mesh(geo,m,g);shell.position.set((x1+x2)/2,0,z);
  for(let px=x1;px<=x2+.01;px+=9){
   for(let j=0;j<20;j++){const a=j/20,b=(j+1)/20;bar([px,eave+rise*Math.sin(a*Math.PI),z-w/2+a*w],[px,eave+rise*Math.sin(b*Math.PI),z-w/2+b*w],.035,steel,g);}
  }
  return shell;
 }
 if(!yardOnly||yardOnly===2)for(let x=23;x<=yard2.scene.right;x+=9.5){
  for(const z of [yard2.scene.north,yard2.scene.south])bar([x,0,z],[x,11.5,z],.12,steel);
  for(let j=0;j<12;j++){const a=j/12,b=(j+1)/12;bar([x,11.5+Math.sin(a*Math.PI)*4.5,yard2.scene.north+a*yard2.scene.width],[x,11.5+Math.sin(b*Math.PI)*4.5,yard2.scene.north+b*yard2.scene.width],.08,steel);}
 }
 // Earth view: the finished roofing is at the corridor/LEFT end; exposed
 // long-span framing continues to the right. Internal inventory is independent.
 if(!yardOnly||yardOnly===2)vault(23,23+yard2.scene.length*.25,yard2.scene.center,yard2.scene.width,11.5,4.5,roof2,roofGroups[2]);
 // A/B are internal storage bands under one continuous exterior roof.
 let solarPanelCount=0;
 if(!yardOnly||yardOnly===3){
  const z=-23.5,w=24;
  vault(27.5,137.5,z,w,7.4,2.2,roof3,roofGroups[3]);
  for(const zz of [-w/2,w/2])box(82.5,3.7,z+zz,110,7.4,.12,roof3,roofGroups[3]);
  for(const xx of [27.5,137.5])box(xx,3.7,z,.12,7.4,w,roof3,roofGroups[3]);
  for(let x=31.25;x<135;x+=7.5)for(const off of [-9,-6,-3,0,3,6,9]){
   const t=off/w+.5,y=7.4+2.2*Math.sin(t*Math.PI),tilt=-Math.atan(2.2*Math.PI/w*Math.cos(t*Math.PI));
   const frame=box(x,y+.13,z+off,6.9,.12,2.6,solarFrame,roofGroups[3]);frame.rotation.x=tilt;
   const panel=box(x,y+.22,z+off,6.7,.06,2.4,solar,roofGroups[3]);panel.rotation.x=tilt;solarPanelCount++;
  }
  if(!yardOnly)roofGroups[3].position.x=harbourLayout.yard3Offset;
 }
 if(!yardOnly||yardOnly===2)roofs.set(2,{group:roofGroups[2],materials:[roof2],opacity:1,panels:0});
 if(!yardOnly||yardOnly===3)roofs.set(3,{group:roofGroups[3],materials:[roof3,solar,solarFrame],opacity:1,panels:solarPanelCount});
 yardLabels.push({text:'1저탄장 · 옥외',point:new THREE.Vector3(yardOnly?-129:yard1DisplayX(-129),.5,-7)},{text:'2저탄장 · 부분 지붕',point:new THREE.Vector3(56,1,yard2.scene.south+2)},{text:'3저탄장 · 태양광 지붕',point:new THREE.Vector3(yardOnly?40:70,10,-38)});
 if(!yardOnly)yardLabels.push({text:'1부두',point:new THREE.Vector3(-72,.3,170)},{text:'2부두',point:new THREE.Vector3(34,.3,170)},{text:'3부두',point:new THREE.Vector3(110,.3,170)});
 // Batch repeated supports/rollers per asset and material; keep per-equipment raycasting.
 for(const [id,g] of groups){
  const moving=detachMotion(g);motions.set(id,moving);
  g.updateMatrixWorld(true);const inverse=g.matrixWorld.clone().invert(),buckets=new Map();
  g.traverse(o=>{if(!o.isMesh||withinMotion(o))return;const part=o.userData.part||id,key=part+'/'+o.geometry.uuid+'/'+o.material.uuid+'/'+o.castShadow;let b=buckets.get(key);if(!b){b={part,geo:o.geometry,mat:o.material,shadow:o.castShadow,matrices:[]};buckets.set(key,b);}b.matrices.push(inverse.clone().multiply(o.matrixWorld));});
  g.clear();for(const part of moving){g.add(part);part.traverse(o=>{if(o.isMesh){o.userData.part=id;pickables.push(o);}});}for(const b of buckets.values()){const inst=own(new THREE.InstancedMesh(b.geo,b.mat,b.matrices.length));b.matrices.forEach((m,i)=>inst.setMatrixAt(i,m));inst.instanceMatrix.needsUpdate=true;inst.castShadow=b.shadow;inst.receiveShadow=true;inst.userData.part=b.part;inst.computeBoundingSphere();g.add(inst);pickables.push(inst);}
 }
 const baseAnchors=new Map([...anchors].map(([id,p])=>[id,p.clone()]));
 for(const asset of N.assets.filter(a=>a.kind!=='tower'&&groups.has(a.id)))flowMarkers.set(asset.id,createFlowEffect(THREE,root,own));
 function applyTelemetry(snapshot,online,clock=snapshot?.elapsed||0){
  demoState=snapshot;demoOnline=online&&!!snapshot;
  if(!snapshot){snapshot={equipment:{}};for(const effect of flowMarkers.values())effect.update([],0,0,false);for(const [id,g]of groups){g.rotation.y=0;g.position.set(0,0,0);anchors.get(id).copy(baseAnchors.get(id));g.userData.accent.emissive.set('#000000');g.userData.accent.emissiveIntensity=0;}}
  const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,phase=reduced?0:clock/Math.max(1,snapshot.speed||1);
  for(const [id,s]of stockMeshes){const tons=(Number.isFinite(snapshot.material?.lots?.[id]?.tons)&&snapshot.material.lots[id].tons>=0?snapshot.material.lots[id].tons:s.lot.tons),k=Math.cbrt(Math.max(0,tons)/s.reference);
   if(s.calibrated){
    if(tons!==s.currentTons){s.dimensions=estimateHeap(s.lot.pile,tons);if(tons>0){const d=s.dimensions,u=yard2.scene.scale;reshapeCoalWindrow(THREE,s.mesh.geometry,{length:d.length*u,width:d.width*u,height:d.height*u,seed:id,calibrated:true});s.height=d.height*u;}}
    s.mesh.scale.setScalar(1);
   }else s.mesh.scale.setScalar(Math.max(.00001,k));
   s.currentTons=tons;s.mesh.visible=tons>0;if(s.floor)s.floor.visible=tons===0;
   const anchor=anchors.get('lot:'+id);if(anchor)anchor.y=.26+(tons>0?s.height*s.mesh.scale.y:0);
  }
  for(const [id,g]of groups){const r=snapshot.equipment?.[id],a=N.get(id);if(!r){flowMarkers.get(id)?.update([],0,0,false);continue;}
   if(['stacker','reclaimer','tripper'].includes(a.kind)){
    const pose=machinePose(a,snapshot,sitePoint),base=sitePoint(id,a.points[0]);
    g.rotation.y=pose.angle;g.position.set(pose.x-base[0]*Math.cos(pose.angle)-base[1]*Math.sin(pose.angle),0,pose.z+base[0]*Math.sin(pose.angle)-base[1]*Math.cos(pose.angle));
    anchors.get(id).set(pose.x,baseAnchors.get(id).y,pose.z);
   }
   const active=isCoalFlowing(a,snapshot,online,N);animateMachinery(THREE,motions.get(id)||[],phase,active?r.flow:0);
   const effect=flowMarkers.get(id);if(effect){const paths=assetFlowPaths(a,snapshot,N,sitePoint),job=workFor(id,snapshot),pile=job&&stockMeshes.get(job.lotId);
    if(pile&&paths.length){const point=job.kind==='reclaim'?paths[0].points[0]:paths[0].points.at(-1);if(pile.currentTons===0)point[1]=.295;else{root.updateWorldMatrix(true,false);const worldPoint=root.localToWorld(new THREE.Vector3(...point));worldPoint.y=coalSurfaceHeight(THREE,pile.mesh,worldPoint.toArray());point[1]=root.worldToLocal(worldPoint).y;}}
    effect.update(paths,r.flow,phase,active);
   }
  }
  if(workingCarrier){const other=data?.berth===2?1:2,v=harbourLayout.vessels[other];workingCarrier.ship.visible=data?.observedDockMask===undefined;workingCarrier.ship.position.set(v.x,0,v.z);workingCarrier.setRemaining(snapshot.material?.ships?.[other]?snapshot.material.ships[other].remaining/(other===1?43800:63400):1);}
  const displayedBerth=data?.berth===2?2:1;
  if(!yardOnly)carrier.setRemaining?.(snapshot.material?.ships?.[displayedBerth]?snapshot.material.ships[displayedBerth].remaining/(displayedBerth===1?43800:63400):1);
  recolor();
 }
 let data=null,selected='inland',activeRoute=[],available=[];
 function resolve(id){return data?.steps.find(s=>s.id===id)?.assetId||id;}
 function paintStockSelection(){for(const [id,s]of stockMeshes){s.mesh.material.color.copy(s.base);if(id===selectedStock)s.mesh.material.color.lerp(new THREE.Color('#2447c5'),.3);if(id===hoveredStock)s.mesh.material.color.set('#2447c5');}}
 function recolor(){
  const focus=resolve(selected),active=new Set(activeRoute),allowed=new Set(available);
  for(const [id,g]of groups){const asset=N.get(id);g.userData.accent.color.set(id===focus?'#2447c5':data?.endpoint&&active.has(id)?'#2447c5':allowed.has(id)?'#7399b5':'#b1bbc3');if(asset.outbound)g.userData.accent.color.set(id===focus?'#2447c5':'#a4acb4');}
  for(const [id,g]of groups){const r=demoState?.equipment?.[id];if(r){const active=isCoalFlowing(N.get(id),demoState,demoOnline,N);g.userData.accent.emissive.set(active?'#2447c5':'#000000');g.userData.accent.emissiveIntensity=active?.65:0;g.userData.accent.color.set(!demoOnline?'#8d9aa6':r.status==='fault'?'#c17a36':r.status==='running'?'#2447c5':'#a5b0ba');}}
  for(const [id,e]of endpoints)e.surface.color.set(yardOnly?'#d4dde3':id===data?.endpoint?'#71b2ee':R.canReach(data?.berth,id)?'#d4dde3':'#b1bac2');
  const inspectedYard=R.endpoint(data?.endpoint)?.yard;
  for(const [id,roof]of roofs){
   const local=id===2?['cv54a','cv54b','cv54c','sr51a','sr51b','re51a']:['cv93a','cv93b','tr91a','tr91b'];
   roof.opacity=inspectRoofs ? .12 : 1;
   for(const m of roof.materials){m.opacity=roof.opacity;m.depthWrite=roof.opacity===1;}
   roof.group.traverse(o=>{if(o.isMesh)o.castShadow=roof.opacity===1;});
  }
 }
 function setRoute(next){
  data=next;
  available=N.all(data.berth);
  activeRoute=data.endpoint?N.path(data.berth,data.endpoint):[];
  const observed=typeof data.observedDockMask==='number';
  observedShips.forEach((ship,index)=>{const id=index+1;ship.visible=observed && Boolean(data.observedDockMask & (1<<id));});
  carrier.ship.visible=!observed && !yardOnly;
  const v=harbourLayout.vessels[data.berth===2?2:1];
  carrier.ship.position.set(v.x,0,v.z);
  for(const step of data.steps){
   const point=anchors.get(step.assetId);
   if(point)anchors.set(step.id,point);
  }
  recolor();
 }
 return {root,applyTelemetry,selectStock(id){selectedStock=stockMeshes.has(id)?id:null;paintStockSelection();},clearanceSelection(){return selectedClearances([...stockMeshes.values()].map(s=>({...s.lot,tons:s.currentTons,coal:demoState?.material?.lots[s.lot.id]?.received>0?demoState.material.lots[s.lot.id].demoLabel:s.lot.coal})),selectedStock);},ship:carrier.ship,pickables,anchors,yardLabels,setRoute,stockMeshes,
  workPoint(kind){const job=demoState?.material?.jobs?.unload;if(!job)return null;const id=kind==='unload'?({1:'csu01',2:'csu51'}[job.berth]):job.machine,path=flowMarkers.get(id)?.debug().paths[0];if(!path?.drop)return null;const a=path.points[path.drop.from],b=path.points[path.drop.to];return new THREE.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);},
  setRoofInspection(value){inspectRoofs=value;recolor();},
  stockInfo(id){const s=stockMeshes.get(id),live=demoState?.material?.lots?.[id];return s?stockDescription({...s.lot,tons:s.currentTons,coal:live?.coal??s.lot.coal,voyage:live?.voyage??s.lot.voyage,days:live&&Object.hasOwn(live,'days')?live.days:s.lot.days})+(s.calibrated?`\n더미 추정 (길이 × 폭 × 높이) ${dimensionText(s.lot.pile,s.currentTons)}\n${photoPosition(s.lot).photoRange?'참고 구간 약 '+photoPosition(s.lot).photoRange.join('–')+' m':'위치 미확인'} · 상부 이격기준 ${profileFor(s.lot.pile).benchGap} m`:''):null;},
  hoverStock(id){if(id===hoveredStock)return false;hoveredStock=id;paintStockSelection();return true;},
  select(id){selected=id;recolor();},
  debug(){return {harbour:yardOnly?null:harbourLayout,selectedStock,activeWorkVessel:demoState?.material?.jobs?.unload?.berth!==data?.berth?demoState?.material?.jobs?.unload?.berth:null,telemetry:{online:demoOnline,positions:Object.fromEntries([...groups].filter(([id])=>['stacker','reclaimer','tripper'].includes(N.get(id).kind)).map(([id,g])=>[id,anchors.get(id).x])),running:[...groups.keys()].filter(id=>demoState?.equipment?.[id]?.status==='running'),flowMarkers:[...flowMarkers].filter(([id,f])=>f.group.visible).map(([id])=>id),fallingParticles:Object.fromEntries([...flowMarkers].filter(([id,f])=>f.group.visible).map(([id,f])=>[id,f.debug().fallingParticles])),flowPaths:Object.fromEntries([...flowMarkers].filter(([id,f])=>f.group.visible).map(([id,f])=>[id,f.debug().paths])),mounds:Object.fromEntries([...stockMeshes].map(([id,s])=>[id,{tons:s.currentTons,scale:s.mesh.scale.x,position:s.mesh.position.toArray(),height:s.currentTons>0?s.height*s.mesh.scale.y:0,dimensions:s.dimensions,volume:s.dimensions?heapVolume(s.dimensions):null,visible:s.mesh.visible}]))},reachable:R.forBerth(data?.berth).filter(e=>e.reachable).map(e=>e.id),endpoint:data?.endpoint,route:activeRoute,assets:[...groups.keys()],dashedLinks:0,layout:siteLayout,calibration:yard2,clearances:estimateClearances([...stockMeshes.values()].filter(s=>s.calibrated).map(s=>({...s.lot,tons:s.currentTons}))),stock:{asOf:stockSnapshot.asOf,records:[...stockMeshes.values()].map(s=>({...s.lot,height:s.height})),hovered:hoveredStock},roofs:[...roofs].map(([yard,r])=>({yard,opacity:r.opacity,solarPanels:r.panels}))};},
  dispose(){carrier.dispose();workingCarrier?.dispose();resources.forEach(r=>r.dispose?.());resources.clear();}
 };
}
