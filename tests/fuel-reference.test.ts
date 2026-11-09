import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceLots, referenceYards, canReceive, endpointForLot, getReferenceLotTons } from '../src/domain/fuel-reference.ts';
import { yard2, estimateHeap, heapVolume, heapPlacement } from '../src/data/fuel-reference/yard2-calibration.js';
import { selectedClearances } from '../src/components/fuel-scene/yard-clearance-data.js';
import { createTransferModel } from '../src/components/fuel-scene/berth-transfer-model.js';
import catalog from '../src/data/fuel-reference/demo-catalog.json' with {type:'json'};

test('junction labels, control signals and cross-line routes stay distinct', async () => {
  const {BerthNetwork:N}=await import('../src/data/fuel-reference/berth-network.js');
  const ids=new Set(catalog.equipment.map(e=>e.id));
  assert.equal(ids.size,catalog.equipment.length);
  assert.equal(new Set(N.equipment.map(a=>N.label(a.id))).size,N.equipment.length);
  assert.deepEqual(N.parts.map(a=>N.label(a.id)),['9A','9B','10A','10B']);
  for(const part of N.parts) {assert.equal(part.signal,part.id);assert.ok(ids.has(part.id));assert.ok(!ids.has(part.parentId));}
  for(const r of catalog.routes)for(const endpoint of r.endpoints) {
    assert.deepEqual(endpoint.assets,N.path(r.berth,endpoint.id));
    endpoint.assets.forEach(id=>assert.ok(ids.has(id),id));
  }
  assert.ok(N.path(3,'pile-7').includes('tt5292A'));
  assert.ok(N.path(3,'pile-7').includes('tt5292B'));
  const model=createTransferModel();
  try {
    const a=model.root.children.find(g=>g.userData.id==='tt5292A')!;
    const b=model.root.children.find(g=>g.userData.id==='tt5292B')!;
    assert.notEqual(a.userData.accent,b.userData.accent);
    model.applyTelemetry({equipment:{tt5292A:{status:'running',flow:1000},tt5292B:{status:'stopped',flow:0}}},true);
    assert.ok(a.userData.accent.emissiveIntensity>0);
    assert.equal(b.userData.accent.emissiveIntensity,0);
    model.applyTelemetry({equipment:{tt5292A:{status:'stopped',flow:0},tt5292B:{status:'running',flow:1000}}},true);
    assert.equal(a.userData.accent.emissiveIntensity,0);
    assert.ok(b.userData.accent.emissiveIntensity>0);
  } finally {model.dispose();}
});

test('compact receiving bridges have no unsupported dark crossbars over the conveyor roofs', () => {
  const model=createTransferModel({compact:true});
  try {
    const harbour=model.root.getObjectByName('해안 · 해상 교량 · 접안 잔교');
    assert.ok(harbour);
    const floating=harbour.children.filter((part:any)=>part.isMesh && Math.abs(part.position.y-6.6)<.001 && Math.abs(part.scale.x-.22)<.001 && part.material.color.getHexString()==='344653');
    assert.equal(floating.length,0,'bridge-top geometry must have a real structural purpose');
  } finally {model.dispose();}
});

test('AIS hulls remain at every occupied berth while inspecting another quay', () => {
  for (const compact of [true,false]) {
    const model=createTransferModel({compact});
    try {
      for (const berth of [1,2,3]) {
        model.setRoute({berth,observedDockMask:14,endpoint:null,steps:[]});
        for (const id of [1,2,3]) assert.equal(model.root.getObjectByName('ais-berth-'+id)?.visible,true);
      }
      model.setRoute({berth:2,observedDockMask:10,endpoint:null,steps:[]});
      assert.equal(model.root.getObjectByName('ais-berth-2')?.visible,false);
      assert.equal(model.root.getObjectByName('ais-berth-3')?.visible,true);
    } finally { model.dispose(); }
  }
});

test('receiving scene has two offshore jetties and long trestles, with coal and vessels on their actual displayed joins', async () => {
  const model=createTransferModel();
  try {
    const h=model.debug().harbour;
    assert.ok(h,'reviewable satellite-grounded harbour layout');
    assert.equal(h.jetties.length,2);
    assert.equal(h.bridges.length,2);
    assert.deepEqual(h.jetties.map(j=>j.berths),[[1],[2,3]]);
    assert.ok(h.jetties[0].to[0]-h.jetties[0].from[0]<(h.jetties[1].to[0]-h.jetties[1].from[0])*.5);
    for(const bridge of h.bridges)assert.ok(bridge.sea[1]-h.shoreZ>70,'visible water separates land from jetty');
    const {BerthNetwork:N}=await import('../src/data/fuel-reference/berth-network.js');
    const {assetFlowPaths}=await import('../src/components/fuel-scene/coal-flow-paths.js');
    const {harbourPoint}=await import('../src/components/fuel-scene/berth-site-layout.js');
    for(const berth of [1,2]) {
      model.setRoute({berth,endpoint:null,steps:[]});
      assert.ok(model.ship.position.z>h.jetties[berth-1].from[1],'ships lie on seaward face');
      const shipHalfLength=113*model.ship.scale.x;
      const id=berth===1?'csu01':'csu51';
      for(const flow of assetFlowPaths(N.get(id),{equipment:{}},N,harbourPoint)){
        assert.ok(Math.abs(flow.points[0][0]-model.ship.position.x)<shipHalfLength*.7,'unloader boot enters cargo region');
        assert.ok(Math.abs(flow.points[0][2]-model.ship.position.z)<16.1*model.ship.scale.z,'unloader boot lies inside vessel beam');
        assert.ok(flow.points.at(-1)[2]>h.shoreZ+70,'flow uses the offshore location');
      }
    }
    const yard=createTransferModel({yardOnly:1});
    assert.equal(yard.debug().harbour,null,'yard detail has no artificial sea/jetty geometry');yard.dispose();
  } finally {model.dispose();}
});

test('unloader intake and its coal path enter a cargo hold in both harbour views', async () => {
  const {BerthNetwork}=await import('../src/data/fuel-reference/berth-network.js');
  const {assetFlowPaths}=await import('../src/components/fuel-scene/coal-flow-paths.js');
  const {harbourPoint,receivingPoint,harbourLayout,receivingLayout}=await import('../src/components/fuel-scene/berth-site-layout.js');
  for(const [project,layout] of [[harbourPoint,harbourLayout],[receivingPoint,receivingLayout]] as const){
    for(const [berth,id] of [[1,'csu01'],[2,'csu51'],[3,'csu91']] as const){
      for(const path of assetFlowPaths(BerthNetwork.get(id),{equipment:{}},BerthNetwork,project)){
        const [x,y,z]=path.points[0],ship=layout.vessels[berth];
        const legBottom=path.points[1],legTop=path.points[2];
        assert.ok(Math.abs(legBottom[0]-legTop[0])<.001);
        assert.ok(Math.abs(legBottom[2]-legTop[2])<.001);
        assert.ok(Math.abs(x-legBottom[0])>.1,'the digging boot slews horizontally');
        const nearest=Math.round((x-ship.x)/(22*.19));
        assert.ok(Math.abs(nearest)<=3);
        assert.ok(Math.abs(x-(ship.x+nearest*22*.19))<.05);
        assert.ok(Math.abs(z-ship.z)<11.4*.19);
        assert.ok(y<4*.19+1);
      }
    }
  }
});

test('CSU boom slew, luff and bucket slew have separate axes', async () => {
  const {unloaderGeometry}=await import('../src/components/fuel-scene/transfer-geometry.js');
  const base=unloaderGeometry({boomSlew:0,luff:0,bucketSlew:0});
  const slew=unloaderGeometry({boomSlew:.1,luff:0,bucketSlew:0});
  const luff=unloaderGeometry({boomSlew:0,luff:.1,bucketSlew:0});
  const bucket=unloaderGeometry({boomSlew:0,luff:0,bucketSlew:.4});
  assert.ok(slew.head[0]>base.head[0]);
  assert.ok(luff.head[1]>base.head[1]);
  assert.deepEqual(bucket.head,base.head);
  assert.ok(bucket.boot[0]>base.boot[0]);
  assert.equal(bucket.boot[1],base.boot[1]);
});

test('harbour presentation transforms preserve live drop contacts and the shared yard inventory', async () => {
  const {createEngine}=(await import('../scripts/fuel-demo/demo-engine.cjs')).default;
  const {loadCatalog}=(await import('../scripts/fuel-demo/demo-catalog.cjs')).default;
  const {harbourPoint}=await import('../src/components/fuel-scene/berth-site-layout.js');
  const {assetFlowPaths}=await import('../src/components/fuel-scene/coal-flow-paths.js');
  const {BerthNetwork:N}=await import('../src/data/fuel-reference/berth-network.js');
  for(const [berth,lotId] of [[1,'P3-G0'],[2,'p5-c']] as const){
    const engine=createEngine(loadCatalog());engine.command({op:'work',kind:'unload',running:true,berth,lotId,rate:3600});engine.command({op:'play'});engine.advance(100);
    const state=engine.snapshot(),model=createTransferModel();
    try {
      model.setRoute({berth,endpoint:null,steps:[]});model.applyTelemetry(state,true,100);
      const job=state.material.jobs.unload,flow=model.debug().telemetry.flowPaths[job.machine][0];
      assert.equal(model.debug().telemetry.mounds[lotId].tons,state.material.lots[lotId].tons);
      const expected=harbourPoint.projectTarget(job.pose.target,lotId);
      if(berth===1)assert.equal(flow.points.at(-1)[0],expected[0]);
      assert.ok(flow.points.at(-1)[1]>.26,'drop lands on growing coal surface');
      assert.ok(model.debug().telemetry.flowMarkers.includes(berth===1?'cv02ab':'cv52ab'));
      const bend=assetFlowPaths(N.get('cv52c'),state,N,harbourPoint)[0].points;
      assert.equal(bend.length,3,'bridge lane bends only after reaching shore');
      assert.equal(bend[0][0],bend[1][0]);assert.equal(bend[1][2],42);
    }finally{model.dispose();}
  }
});

test('blend display never allocates a reclaim job to another line or invents bunker levels', async () => {
  const { blendReading } = await import('../src/domain/blend.ts');
  const snapshot = {playing:true,material:{jobs:{reclaim:{lotId:'P2-K1',actualRate:900,moved:12,route:['re01','cv08ab']}}},units:{'1':{mw:460,status:'running'}}};
  assert.equal(blendReading(1, null, 'disabled').rate, null);
  assert.equal(blendReading(1, snapshot, 'online').rate, 900);
  assert.equal(blendReading(2, snapshot, 'online').rate, null);
  assert.equal(blendReading(1, snapshot, 'stale').flowing, false);
  assert.equal(blendReading(1, {...snapshot,playing:false}, 'online').flowing, false);
  assert.equal(blendReading(1, snapshot, 'online').bunkerLevel, null);
});

test('blend scenes retain same yard heaps and distinct boiler units without fabricated downstream flow', async () => {
  const { createBlendModel } = await import('../src/components/fuel-scene/blend-model.js');
  for(const [yard,units] of [[1,[1,2,3,4]],[2,[5,6,7,8]],[3,[9,10]]] as const){
    const model=createBlendModel({yardOnly:yard});
    assert.deepEqual(model.debug().boilerUnits,[...units]);
    assert.equal(model.stockMeshes.size,referenceLots.filter(l=>l.yard===yard).length);
    model.applyTelemetry(null,false,0);
    assert.equal(model.debug().downstreamFlow,false);
    const state=model.debug();
    assert.deepEqual(state.distributionBranches.flatMap(branch=>branch.units),[...units]);
    for(const branch of state.distributionBranches){
      const conveyor=state.connections.find(connection=>connection.code===branch.code);
      assert.ok(conveyor,'each unit group has its source-documented distribution conveyor');
      assert.equal(conveyor.count,2,'A/B and C/D are separate decks');
      for(const unit of branch.units){
        const x=state.unitPositions.find(position=>position.unit===unit).x;
        assert.ok(x>=Math.min(conveyor.a[0],conveyor.b[0])&&x<=Math.max(conveyor.a[0],conveyor.b[0]),'gallery reaches each assigned bunker');
      }
    }
    model.dispose();
  }
});

test('blend geometry follows the photo topology and parallel plant row, not a two-by-two cluster', async () => {
  const { createBlendModel } = await import('../src/components/fuel-scene/blend-model.js');
  const expected = [
    ['CV-06A/B','CV-07A/B','CV-08A/B','CV-09A/B','CV-09C/D'],
    ['CV-55A/B','CV-56A/B','CV-57A/B','CV-58A/B','CV-59A/B','CV-59C/D'],
    ['CV-94A','CV-94B','CV-94C','CV-95A/B','CV-96A/B','CV-97A/B','CV-98A/B','CV-99A/B'],
  ];
  for (const yard of [1,2,3]) {
    const model=createBlendModel({yardOnly:yard}), state=model.debug();
    assert.ok(state.unitPositions,'reviewable scene unit positions');
    assert.equal(new Set(state.unitPositions.map(p=>p.z)).size,1,'units share the long plant axis');
    assert.equal(new Set(state.unitPositions.map(p=>p.x)).size,state.boilerUnits.length);
    for(const code of expected[yard-1])assert.ok(state.connections.some(c=>c.code===code),code);
    assert.equal(state.distributionTower,`TTT-0${yard}`);
    if(yard<3){
      assert.deepEqual(state.distributionBranches.map(b=>b.units),yard===1?[[1,2],[3,4]]:[[5,6],[7,8]]);
      assert.ok(state.distributionBranches[0].toX<state.distributionX);
      assert.ok(state.distributionBranches[1].toX>state.distributionX);
    }else{
      assert.deepEqual(state.distributionBranches.map(b=>b.units),[[9,10]]);
      assert.ok(state.distributionBranches[0].toX>state.distributionX);
      assert.equal(state.reclaimOrigin,'TT-97');
      assert.ok(state.reclaimAssets.includes('RE-91A')&&state.reclaimAssets.includes('RE-91D'));
    }
    model.dispose();
  }
});

test('each of the ten units has six separate silos reached by its distribution gallery', async () => {
  const { createBlendModel } = await import('../src/components/fuel-scene/blend-model.js');
  for(const yard of [1,2,3]){
    const model=createBlendModel({yardOnly:yard}),state=model.debug();
    try{
      for(const unit of state.boilerUnits){
        const silos:any[]=[];
        model.root.traverse(object=>{if(object.userData.silo?.unit===unit)silos.push(object);});
        assert.equal(silos.length,6,`${unit}호기 silo count`);
        assert.deepEqual(silos.map(silo=>silo.userData.silo.index),[1,2,3,4,5,6]);
        const branch=state.distributionBranches.find(branch=>branch.units.includes(unit));
        const gallery=state.connections.find(connection=>connection.code===branch.code);
        for(const [index,silo] of silos.entries()){
          let feeder:any,mill:any;
          model.root.traverse(object=>{
            if(object.userData.coalFeeder?.unit===unit&&object.userData.coalFeeder.index===index+1)feeder=object;
            if(object.userData.pulverizer?.unit===unit&&object.userData.pulverizer.index===index+1)mill=object;
          });
          assert.ok(feeder&&mill,'each silo has its own coal feeder above its pulverizer');
          assert.equal(feeder.position.x,silo.position.x);
          assert.equal(mill.position.x,silo.position.x);
          assert.equal(feeder.position.z,silo.position.z);
          assert.equal(mill.position.z,silo.position.z);
          assert.ok(silo.position.y>feeder.position.y&&feeder.position.y>mill.position.y);
          assert.ok(feeder.scale.y<mill.geometry.parameters.height,'the coal feeder is smaller than the mill');
          assert.equal(silo.position.z,gallery.a[2]);
          assert.ok(silo.position.x>=Math.min(gallery.a[0],gallery.b[0])&&silo.position.x<=Math.max(gallery.a[0],gallery.b[0]));
          if(index>0)assert.ok(silo.position.x-silos[index-1].position.x>silo.geometry.parameters.radiusTop+silos[index-1].geometry.parameters.radiusTop,'adjacent silo shells stay separate');
        }
      }
    }finally{model.dispose();}
  }
});

test('blend buildings follow turbine–mill–boiler bands and roofed right-angle TTT approach', async () => {
  const { createBlendModel } = await import('../src/components/fuel-scene/blend-model.js');
  for(const yard of [1,2,3]){
    const model=createBlendModel({yardOnly:yard});
    try{
      const state=model.debug(),bands=state.buildingBands;
      assert.ok(bands,'reviewable plant bands');
      assert.ok(bands.turbine.z>bands.mill.z&&bands.mill.z>bands.boiler.z&&bands.boiler.z>bands.yard.z);
      const approach=state.connections.findLast(connection=>connection.code===`CV-${yard===1?'08':yard===2?'58':'98'}A/B`);
      assert.equal(approach.a[0],state.distributionX);
      assert.equal(approach.b[0],state.distributionX);
      assert.equal(approach.b[2],bands.mill.z);
      assert.ok(approach.a[2]<bands.boiler.z,'approaches from behind the boilers');
      for(const branch of state.distributionBranches){
        const belt=state.connections.find(connection=>connection.code===branch.code);
        assert.deepEqual(belt.a,approach.b);
        assert.equal(belt.a[2],belt.b[2]);
      }
      const skins:any[]=[];model.root.traverse(object=>{if(object.userData.plantSkin)skins.push(object);});
      assert.ok(skins.some(mesh=>mesh.userData.plantSkin==='mill'),'mill room has an exterior');
      assert.ok(skins.some(mesh=>mesh.userData.plantSkin==='gallery'),'approach has a continuous enclosure');
      assert.ok(skins.every(mesh=>mesh.visible),'normal view shows building envelopes');
      model.setPlantInspection(true);assert.ok(skins.every(mesh=>!mesh.visible));
      model.setRoofInspection(true);assert.ok(skins.every(mesh=>!mesh.visible),'yard roof control does not override plant inspection');
      model.setPlantInspection(false);assert.ok(skins.every(mesh=>mesh.visible));
    }finally{model.dispose();}
  }
});

test('photo reference lots retain source IDs, zero stock and separate yard totals', () => {
  assert.equal(referenceLots.length, 34);
  assert.equal(new Set(referenceLots.map(l => l.id)).size, 34);
  assert.deepEqual(referenceYards.map(y => referenceLots.filter(l => l.yard === y.id).reduce((n,l) => n+l.tons,0)), [109911,106566,146955]);
  assert.equal(referenceLots.find(l => l.id === 'P3-G0')?.tons, 0);
  assert.equal(referenceLots.find(l => l.id === 'p5-c')?.tons, 0);
  assert.equal(referenceLots.find(l => l.id === 'a8')?.cell, '8');
});

test('receiving routes preserve the documented blocked endpoint pairs', () => {
  for (const berth of [1,2,3]) for (const lot of referenceLots) {
    const blocked = berth === 1 ? [7,8] : [3,4];
    assert.equal(canReceive(berth, endpointForLot(lot)), !blocked.includes(lot.pile ?? 0));
  }
  assert.equal(canReceive(0,'pile-1'),false);
  assert.equal(canReceive(1,'missing'),false);
});

test('only explicit same-ID demo material overrides photo reference inventory', () => {
  const lot = referenceLots.find(l => l.id === 'p5-a')!;
  assert.equal(getReferenceLotTons(lot,{ inventory:{stock:999999} }),lot.tons);
  assert.equal(getReferenceLotTons(lot,{ material:{lots:{'p5-a':{tons:0}}} }),0);
  for (const tons of [-1,NaN,Infinity,'20',null]) assert.equal(getReferenceLotTons(lot,{material:{lots:{'p5-a':{tons}}}}),lot.tons);
});

test('720m photo axis remains distinct from 500m capacity calibration; volume follows mass', () => {
  assert.equal(yard2.lengthM,720);
  assert.equal(yard2.capacityReferenceLengthM,500);
  assert.equal(yard2.profiles.reduce((n,p)=>n+p.operating,0),265800);
  for(const p of yard2.profiles) {
    const full = estimateHeap(p.pile,p.optimal);
    assert.ok(Math.abs(full.length-500)<1e-9);
    for(const tons of [0,316,1457,5000,30000,p.optimal]) {
      const heap = estimateHeap(p.pile,tons);
      assert.ok(Math.abs(heapVolume(heap)/heapVolume(full)-tons/p.optimal)<1e-9);
      if(tons===0) assert.equal(heap.height,0);
    }
  }
  assert.equal(heapPlacement({id:'p8-e',pile:8,tons:4701,span:[.81,.94]}).positionSource,'previous-demo');
});

test('clearance follows live ridge endpoints and never certifies unknown photo positions', () => {
  const lots=[{id:'p5-b',pile:5,tons:10455,coal:'Centennial',span:[.3,.36]},{id:'p5-c',pile:5,tons:5000,coal:'demo',span:[.42,.49]}];
  const copy=structuredClone(lots);
  assert.equal(selectedClearances(lots,'p5-c')?.measurements[0].state,'clear');
  const growth=selectedClearances(lots.map(l=>l.id==='p5-c'?{...l,tons:10000}:l),'p5-c')!;
  assert.equal(growth.measurements[0].state,'breach');
  assert.equal(growth.measurements[0].required,40);
  assert.deepEqual(lots,copy);
  assert.equal(selectedClearances([{id:'p8-c',pile:8,tons:1541,coal:'Flame',span:[.51,.59]},{id:'p8-d',pile:8,tons:316,coal:'Centennial',span:[.66,.73]}],'p8-c')?.measurements[0].state,'unknown');
  assert.equal(selectedClearances([{id:'a8',shed:'A',cell:8,tons:21728,coal:'AVRA'}],'a8')?.measurements.length,0);
});

test('scene mesh uses catalog IDs, shows zero stock as floor, grows from zero, and resets to reference', () => {
  const model = createTransferModel();
  model.setRoute({berth:1,endpoint:null,steps:[]});
  const before = model.debug();
  assert.deepEqual(before.stock.records.map(l=>l.id).sort(),catalog.materialLots.map(l=>l.id).sort());
  assert.equal(before.telemetry.mounds['p5-c'].visible,false);
  const geometry = model.stockMeshes.get('p5-c').mesh.geometry;
  const position = geometry.attributes.position;
  model.applyTelemetry({equipment:{},material:{lots:{'p5-c':{tons:5000}}}},true,1);
  assert.equal(model.debug().telemetry.mounds['p5-c'].tons,5000);
  assert.equal(model.debug().telemetry.mounds['p5-c'].visible,true);
  assert.equal(geometry.attributes.position,position);
  model.applyTelemetry(null,false);
  assert.equal(model.debug().telemetry.mounds['p5-c'].tons,0);
  assert.equal(model.debug().telemetry.mounds['p5-c'].visible,false);
  model.dispose();
});

test('all yard views contain their machinery and dispose visible geometry/material/instance resources', () => {
  for(const yard of [1,2,3]) {
    const model=createTransferModel({yardOnly:yard});
    const resources=new Set(),disposed=new Set();
    model.root.traverse(object=>{
      if(object.geometry)resources.add(object.geometry);
      if(object.material)for(const material of [object.material].flat()) {
        resources.add(material);
        assert.equal(Object.values(material).some(value=>value?.isTexture),false);
      }
      if(object.isInstancedMesh)resources.add(object);
    });
    for(const resource of resources)resource.addEventListener('dispose',()=>disposed.add(resource));
    const expected = yard===1?'sr01a':yard===2?'sr51a':'tr91a';
    assert.ok(model.debug().assets.includes(expected));
    model.dispose();
    assert.equal(disposed.size,resources.size,`yard ${yard} resources released`);
    model.dispose();
  }
});
