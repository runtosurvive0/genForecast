import * as THREE from 'three';
import { createTransferModel } from './berth-transfer-model.js';
import { createBlendModel } from './blend-model.js';
import { createClearanceOverlay } from './yard-clearance-overlay.js';
import { BerthRoutes } from '../../data/fuel-reference/berth-routes.js';
import { BerthNetwork } from '../../data/fuel-reference/berth-network.js';
import { yard2 } from '../../data/fuel-reference/yard2-calibration.js';
import {harbourLayout,receivingLayout} from './berth-site-layout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Instance-owned renderer: no shared camera, listeners, animation or browser globals. */
export function mountFuelScene(host, initial, onSelect, onView) {
  let renderer, model, observer, overlay, disposed = false, lost = false, frame = 0;
  let state = initial, receivedAt = performance.now(), zoom = 1, panX = 0, panY = 0;
  let roof = initial.mode !== 'berth' && initial.yard > 1, drag = null;
  let plant = false, plan = false, orbitTool = false;
  const resources = new Set(), abort = new AbortController();
  const options = { signal: abort.signal };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-150,150,60,-60,.1,900);
  const blendOffset = new THREE.Vector3(40,200,260);
  // Satellite photography anchors the site plan, while the default retains the
  // existing dimensional illustration: orthographic, oblique, visible sides.
  const compact = initial.mode === 'berth' && initial.berthView === 'route';
  const berthOblique = compact ? new THREE.Vector3(22,185,280) : new THREE.Vector3(115,230,280);
  const homeOffset = initial.mode === 'yard' ? new THREE.Vector3(12,100,135) : initial.mode === 'blend' ? blendOffset : berthOblique;
  const berthOffset = homeOffset.clone();
  const orbitShift = new THREE.Vector3();
  const angles = new THREE.Spherical();
  let berthFrame = null;
  let inspectAfterMove = false, reportedBerth = null;
  const dockPositions = (compact ? receivingLayout : harbourLayout).vessels;
  const waterPlane = new THREE.Plane(new THREE.Vector3(0,1,0),0);
  function inspectViewport() {
    if (!state.onInspectBerth) return;
    ray.setFromCamera(pointer.set(0,0),camera);
    const center = ray.ray.intersectPlane(waterPlane,new THREE.Vector3());
    if (!center) return;
    // Compare positions on the quay plane so orbit and plan views agree.
    const ids = [1,2,3];
    const distance = id => Math.abs(center.x-dockPositions[id].x);
    const nearest = ids.reduce((best,id) => distance(id)<distance(best) ? id : best);
    const current = reportedBerth ?? state.berth;
    if (nearest === current || distance(nearest)>38 || Math.abs(center.z-dockPositions[nearest].z)>40) return;
    if (distance(nearest)+4 >= distance(current)) return;
    reportedBerth = nearest;
    state.onInspectBerth(nearest);
  }
  const own = value => (resources.add(value), value);
  const labels = document.createElement('div');
  labels.className = 'fuel-scene__labels'; labels.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.className = 'fuel-scene__tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;

  function report(error = null) { if (!disposed) onView({ zoom, roof, plant, plan, orbitTool, error }); }
  function schedule() { if (!frame && !disposed && !lost) frame = requestAnimationFrame(draw); }
  function hideTip() { tip.hidden = true; if (model?.hoverStock(null)) schedule(); }
  function route(openSelection = false) {
    const lot = state.selectedLotId && model.stockMeshes.get(state.selectedLotId)?.lot;
    const endpoint = lot ? (lot.shed ? 'shed-' + lot.shed.toLowerCase() : 'pile-' + String(lot.pile).replace(/^P/, '')) : null;
    model.setRoute({ berth: state.berth, observedDockMask: state.observedDockMask, endpoint: BerthRoutes.normalize(state.berth, endpoint), steps: [] });
    model.selectStock(state.selectedLotId);
    if(state.mode==='blend')model.selectUnit(state.selectedUnitId);
    // Inspecting a stored heap opens its roof, while reset/toggle still remain available.
    if (openSelection && lot && (lot.yard === 'P2' || lot.yard === 'P3')) roof = true;
    model.setRoofInspection(roof);
  }
  function dimensions() {
    const w = Math.max(1,host.clientWidth), h = Math.max(1,host.clientHeight), aspect = w/h;
    // Fit the projected network, including its roof height, vessel and labels.
    // A fixed world-height minimum wastes most of a wide, shallow canvas.
    // Pixel margins also leave room for the small berth labels at mobile widths.
    const horizontalSpace = Math.max(.5,1-32/w), verticalSpace = Math.max(.5,1-28/h);
    const span = state.mode !== 'yard' && berthFrame
      ? Math.max(berthFrame.height/verticalSpace,berthFrame.width/aspect/horizontalSpace)
      : state.yard === 2 ? Math.max(52,220/aspect) : state.yard === 1 ? Math.max(42,132/aspect) : Math.max(36,150/aspect);
    return {w,h,aspect,span};
  }
  function measureBerthFrame() {
    const basis = new THREE.Matrix4().lookAt(berthOffset,new THREE.Vector3(),new THREE.Vector3(0,1,0));
    const right = new THREE.Vector3().setFromMatrixColumn(basis,0), up = new THREE.Vector3().setFromMatrixColumn(basis,1);
    const bounds = new THREE.Box2(), point = new THREE.Vector3();
    const include = value => bounds.expandByPoint(new THREE.Vector2(value.dot(right),value.dot(up)));
    scene.updateMatrixWorld(true);
    if (compact) {
      const {x,z} = receivingLayout.vessels[state.berth];
      const points = [
        new THREE.Vector3(x-24,0,z+6),new THREE.Vector3(x+24,0,z+6),
        new THREE.Vector3(x,14,z-12),
      ];
      const lot = model.stockMeshes.get(state.selectedLotId)?.lot;
      const endpoint = lot && (lot.shed ? 'shed-'+lot.shed.toLowerCase() : 'pile-'+String(lot.pile).replace(/^P/,''));
      const path = endpoint ? BerthNetwork.path(state.berth,endpoint) : BerthNetwork.head[state.berth];
      for (const id of path) {
        const anchor = model.anchors.get(id);
        if (anchor) points.push(anchor);
      }
      const destination = model.anchors.get('lot:'+state.selectedLotId);
      if (destination) points.push(destination);
      points.forEach(include);
      const middle = bounds.getCenter(new THREE.Vector2()), size = bounds.getSize(new THREE.Vector2());
      const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
      center.addScaledVector(right,middle.x-center.dot(right)).addScaledVector(up,middle.y-center.dot(up));
      return {center,width:size.x+9,height:size.y+12};
    }
    // The sea is a decorative backdrop; its padding must not shrink the network.
    model.root.traverseVisible(object => {
      if (!object.geometry || (object.isInstancedMesh && object.count === 0)) return;
      if (object.isInstancedMesh) object.computeBoundingBox();
      else if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.isInstancedMesh ? object.boundingBox : object.geometry.boundingBox;
      if (!box || box.isEmpty()) return;
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) include(point.set(x,y,z).applyMatrix4(object.matrixWorld));
    });
    for (const label of model.yardLabels) include(label.point);
    const midpoint = bounds.getCenter(new THREE.Vector2()), size = bounds.getSize(new THREE.Vector2());
    const center = new THREE.Vector3(28,2,8);
    center.addScaledVector(right,midpoint.x-center.dot(right)).addScaledVector(up,midpoint.y-center.dot(up));
    return {center,width:size.x,height:size.y};
  }
  function homeCenter() {
    if (state.mode !== 'yard') return berthFrame.center;
    if (state.yard === 1) return new THREE.Vector3(-80,2,13.5);
    if (state.yard === 2) return new THREE.Vector3(yard2.scene.centerX-20,2,yard2.scene.center);
    return new THREE.Vector3(68,2,-23.5);
  }
  function updateCamera() {
    const {w,h,aspect,span} = dimensions();
    if (renderer.domElement.width !== Math.round(w*renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h*renderer.getPixelRatio())) renderer.setSize(w,h,false);
    camera.left = -span*aspect/2; camera.right = span*aspect/2; camera.top = span/2; camera.bottom = -span/2;
    const center = homeCenter();
    camera.position.copy(center).add(berthOffset); camera.up.set(0,1,0); camera.lookAt(center); camera.position.add(orbitShift); camera.updateMatrixWorld();
    // Reserve 8px above the model and 20px below its berth-label anchors. Labels
    // extend down from their anchors, so a symmetric 14px margin clips their text.
    const labelShift = state.mode === 'berth' && zoom === 1 ? -6*span/h : 0;
    const shift = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(panX).addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),panY+labelShift);
    camera.position.add(shift); camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    return {w,h};
  }
  function updateLabels(w,h) {
    let source = state.mode !== 'yard' ? model.yardLabels : [...model.anchors].filter(([id]) => id.startsWith('pile-') || id.startsWith('cell:')).map(([id,point]) => ({text:id.startsWith('cell:')?id.slice(5):'Pile '+id.slice(5),point}));
    if (compact) {
      const split = BerthNetwork.entryPart(BerthNetwork.head[state.berth].at(-1),state.berth);
      source = [
        ...Object.entries(dockPositions).map(([id,vessel]) => ({text:id+'부두',point:new THREE.Vector3(vessel.x,0,vessel.z+5)})),
        {text:`${BerthNetwork.label(split)}번`,point:model.anchors.get(split)},
      ];
      const lot = model.stockMeshes.get(state.selectedLotId)?.lot;
      if(lot) source.push({text:lot.shed ? lot.shed+' Shed · '+lot.cell : 'Pile '+String(lot.pile).replace(/^P/,''),point:model.anchors.get('lot:'+lot.id)});
    }
    labels.hidden = zoom > 4;
    const placed = [];
    const entries = source.map(label => {
      const element = document.createElement('span'), p = label.point.clone().project(camera);
      // Roof descriptions remain in the facility details. Keep mobile anchors concise.
      element.textContent = state.mode === 'berth' && w < 600 ? label.text.split(' · ')[0] : label.text;
      element.hidden = p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1;
      return {element,x:(p.x+1)*w/2,y:(1-p.y)*h/2};
    });
    labels.replaceChildren(...entries.map(entry => entry.element));
    for (const entry of entries.sort((a,b) => a.y-b.y)) {
      const {element} = entry;
      if (element.hidden) continue;
      const width = element.offsetWidth, height = element.offsetHeight;
      const x = clamp(entry.x,6,Math.max(6,w-width-6));
      let y = clamp(entry.y,4,Math.max(4,h-height-4));
      for (let attempt=0;attempt<entries.length;attempt++) {
        const overlap=placed.find(box => x < box.x+box.width+5 && x+width+5 > box.x && y < box.y+box.height+4 && y+height+4 > box.y);
        if (!overlap) break;
        y=overlap.y+overlap.height+4;
      }
      element.style.left=x+'px';element.style.top=y+'px';
      element.hidden=y+height>h-2;
      if (!element.hidden) placed.push({x,y,width,height});
    }
  }
  function draw() {
    frame = 0;
    if (disposed || lost || !host.isConnected || !host.clientWidth || !host.clientHeight) return;
    const {w,h} = updateCamera(), snapshot = state.snapshot;
    if (inspectAfterMove) { inspectAfterMove=false; inspectViewport(); }
    const elapsed = Number.isFinite(snapshot?.elapsed) ? snapshot.elapsed : 0;
    const running = state.online && snapshot?.playing && !reducedMotion.matches;
    const clock = elapsed + (running ? Math.min(.3,(performance.now()-receivedAt)/1000)*(snapshot.speed || 1) : 0);
    const materialSnapshot = snapshot ?? (state.baselineStock ? {material:{lots:Object.fromEntries(Object.entries(state.baselineStock).map(([id, tons]) => [id, {tons,...state.baselineDetails?.[id]}]))}} : null);
    model.applyTelemetry(materialSnapshot,state.online,clock);
    renderer.render(scene,camera);
    overlay.update(model.clearanceSelection(), point => {
      const p = model.root.localToWorld(new THREE.Vector3(...point)).project(camera);
      return {x:(p.x+1)*w/2,y:(1-p.y)*h/2,depth:p.z};
    }, {online:state.online,connected:!!snapshot});
    updateLabels(w,h);
    host.dataset.renderer = 'webgl'; host.dataset.textures = String(renderer.info.memory.textures);
    host.dataset.animating = String(!!running); host.dataset.selectedLot = state.selectedLotId || '';
    host.dataset.plantInspection=String(plant);host.dataset.projection=plan?'plan':'perspective';
    if (running) schedule();
  }
  function theme() {
    const dark = state.theme === 'dark';
    const waterColor=dark?'#20272e':'#d7e7f2';
    scene.background = new THREE.Color(state.mode==='berth'?waterColor:dark ? '#222428' : '#e8eff4');
    renderer.toneMappingExposure = dark ? 1.05 : 1.1;
    if (sea) sea.material.color.set(waterColor);
  }
  function zoomBy(factor, position) {
    const old = zoom; zoom = clamp(zoom*factor,1,12);
    if (position) {
      inspectAfterMove = true;
      const {w,h,span,aspect} = dimensions();
      panX += (position.x/w-.5)*span*aspect*(1/old-1/zoom);
      panY -= (position.y/h-.5)*span*(1/old-1/zoom);
    }
    if (zoom === 1 && old > 1) {
      panX = panY = 0;
      orbitShift.set(0,0,0);
    }
    hideTip(); report(); schedule();
  }
  function centerView() {
    inspectAfterMove = false;
    zoom = 1; panX = panY = 0; orbitShift.set(0,0,0);
    hideTip(); report(); schedule();
  }
  function reset() {
    plan = false;
    berthOffset.copy(homeOffset);
    if (state.mode !== 'yard') berthFrame = measureBerthFrame();
    centerView();
  }
  function rotate(horizontal, vertical) {
    if (plan) return;
    // Keep the point under the viewport centre as the pivot, even after panning.
    updateCamera();
    orbitShift.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),panX);
    orbitShift.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),panY);
    panX = panY = 0;
    angles.setFromVector3(berthOffset);
    angles.theta -= horizontal;
    angles.phi = clamp(angles.phi - vertical, Math.PI / 36, Math.PI * .46);
    berthOffset.setFromSpherical(angles);
    hideTip(); schedule();
  }
  function hit(event) {
    // Input can arrive between a focus/zoom action and its scheduled render.
    updateCamera();
    const rect = host.getBoundingClientRect(); pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(pointer,camera);
    const hits = ray.intersectObjects(model.pickables,false).filter(hit => hit.object.visible);
    return hits.find(hit => hit.object.userData.lotId)?.object.userData || hits[0]?.object.userData || null;
  }
  function inspect(event) {
    const info = hit(event), asset = info?.part && (model.assetInfo?.(info.part)||BerthNetwork.get(info.part));
    if (model.hoverStock(info?.lotId || null)) schedule();
    host.style.cursor = info?.lotId ? 'pointer' : 'grab';
    // Equipment labels appear only on hover; no persistent equipment callout cards.
    if (!asset && !info?.unitId) { tip.hidden = true; return; }
    const signal = info?.unitId ? state.snapshot?.units?.[info.unitId] : state.snapshot?.equipment?.[asset.signal||asset.id];
    const status = !signal ? '신호 미연결' : !state.online ? '수신 끊김 · 마지막 값' : signal.status === 'running' ? '운전' : signal.status === 'fault' ? '고장' : '정지';
    const assetNumber=BerthNetwork.label(asset?.id);
    tip.textContent = info?.unitId ? `${info.unitId}호기 · 보일러 · ${status}` : `${assetNumber ? `${assetNumber}번 · ` : ''}${asset.name} · ${status}`; tip.hidden = false;
    const rect = host.getBoundingClientRect(); tip.style.left = clamp(event.clientX-rect.left+12,8,Math.max(8,rect.width-tip.offsetWidth-8))+'px'; tip.style.top = clamp(event.clientY-rect.top-tip.offsetHeight-12,8,Math.max(8,rect.height-tip.offsetHeight-8))+'px';
  }
  let sea = null, key = null;
  try {
    renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // No authored image maps. Three owns its internal StandardMaterial DFG LUT.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-hidden','true');
    host.append(renderer.domElement,labels,tip);
    scene.add(new THREE.HemisphereLight(0xe5efff,0x7d8a97,2.2));
    key = new THREE.DirectionalLight(0xfff6e9,3.1); key.position.set(-70,150,75); key.castShadow = true;
    key.shadow.mapSize.set(2048,1024); Object.assign(key.shadow.camera,{left:-220,right:220,top:125,bottom:-125,near:1,far:450});
    key.shadow.bias = -.0002; key.shadow.normalBias = .08; scene.add(key);
    const fill = new THREE.DirectionalLight(0xc4dbff,1); fill.position.set(35,70,-65); scene.add(fill);
    model = state.mode==='blend' ? createBlendModel({yardOnly:state.yard,baselineLots:state.baselineLots ?? null}) : createTransferModel({yardOnly:state.mode === 'yard' ? state.yard : null,compact,baselineLots:state.baselineLots ?? null}); scene.add(model.root);
    if (state.mode === 'berth') {
      sea = new THREE.Mesh(own(new THREE.PlaneGeometry(1400,1200)),own(new THREE.MeshBasicMaterial({color:'#d7e7f2',toneMapped:false})));
      sea.rotation.x = -Math.PI/2; sea.position.set(12,harbourLayout.waterY,350); scene.add(sea);
    }
    overlay = createClearanceOverlay(host,{onClear:()=>onSelect(null)});
    theme(); route(true);
    if (state.mode !== 'yard') berthFrame = measureBerthFrame();
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;if(frame)cancelAnimationFrame(frame);frame=0;host.dataset.renderer='unavailable';overlay.clear();report('3D 표시가 중단되었습니다. 재고 표에서 원탄을 확인할 수 있습니다.');},options);
    renderer.domElement.addEventListener('webglcontextrestored',()=>{lost=false;report();schedule();},options);
    host.addEventListener('wheel',event=>{event.preventDefault();if(lost)return;const rect=host.getBoundingClientRect();zoomBy(Math.exp(-event.deltaY*.0015),{x:event.clientX-rect.left,y:event.clientY-rect.top});},{...options,passive:false});
    host.addEventListener('pointerdown', event => {
      if (drag || lost || event.button !== 0 || event.target.closest('button')) return;
      drag = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false, rotate:!plan && (orbitTool || event.shiftKey)};
      host.setPointerCapture(event.pointerId);
      hideTip();
    }, options);
    host.addEventListener('pointermove', event => {
      if (lost) return;
      if (!drag) { inspect(event); return; }
      if (event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx,dy) < 4) return;
      drag.moved = true;
      if (drag.rotate) rotate(dx * .008, dy * .008);
      else {
        const scale = dimensions().span / host.clientHeight / zoom;
        panX = clamp(panX - dx * scale,-220,220);
        panY = clamp(panY + dy * scale,-130,130);
        inspectAfterMove = true;
        schedule();
      }
      drag.x = event.clientX; drag.y = event.clientY;
      host.style.cursor = 'grabbing';
    }, options);
    host.addEventListener('pointerup', event => {
      if (drag?.id !== event.pointerId) return;
      if (!lost && !drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4) {
        const item = hit(event);
        if (item?.unitId && state.onSelectUnit) state.onSelectUnit(item.unitId);
        else onSelect(item?.lotId || null);
      }
      drag = null; host.style.cursor = 'grab';
    }, options);
    for (const event of ['pointercancel','lostpointercapture']) host.addEventListener(event,e=>{
      if (drag?.id === e.pointerId) { drag = null; host.style.cursor = 'grab'; }
    },options);
    host.addEventListener('pointerleave',hideTip,options);
    host.addEventListener('keydown',event=>{
      if(event.target!==host||lost)return;
      if(event.key==='Escape'){onSelect(null);return;}
      if (!plan && (event.shiftKey || orbitTool) && event.key.startsWith('Arrow')) {
        event.preventDefault();
        const step = Math.PI / 12;
        rotate(({ArrowLeft:-step,ArrowRight:step})[event.key] || 0, ({ArrowUp:step,ArrowDown:-step})[event.key] || 0);
        return;
      }
      if(!['+','=','-','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();if(event.key==='Home')reset();else if(event.key==='+'||event.key==='=')zoomBy(1.25);else if(event.key==='-')zoomBy(.8);else{const amount=8/zoom;panX=clamp(panX+({ArrowLeft:-amount,ArrowRight:amount}[event.key]||0),-220,220);panY=clamp(panY+({ArrowUp:amount,ArrowDown:-amount}[event.key]||0),-130,130);inspectAfterMove=true;hideTip();schedule();}
    },options);
    reducedMotion.addEventListener('change',schedule,options);
    observer = new ResizeObserver(schedule); observer.observe(host); report(); schedule();
  } catch (error) {
    dispose(); throw error;
  }

  function dispose() {
    if(disposed)return;disposed=true;abort.abort();observer?.disconnect();if(frame)cancelAnimationFrame(frame);frame=0;
    overlay?.dispose();model?.dispose();key?.shadow.map?.dispose();resources.forEach(resource=>resource.dispose?.());resources.clear();
    if(renderer){renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}
    labels.remove();tip.remove();scene.clear();delete host.dataset.animating;delete host.dataset.renderer;delete host.dataset.textures;delete host.dataset.plantInspection;delete host.dataset.projection;
  }
  return {
    update(next){
      if(disposed)return;
      const nextSnapshot=next.snapshot!==state.snapshot,selectionChanged=next.selectedLotId!==state.selectedLotId;
      const explicitFocus = next.focusRequest !== state.focusRequest;
      const followingView = next.berth === reportedBerth && !explicitFocus;
      const reframe=compact && !followingView && (explicitFocus || selectionChanged || next.berth!==state.berth);
      reportedBerth=null;
      state=next;
      if(nextSnapshot)receivedAt=performance.now();
      theme();route(selectionChanged);
      if(reframe){reset();return;}
      report();schedule();
    },
    zoomBy,reset,
    toggleRoof(){roof=!roof;model.setRoofInspection(roof);report();schedule();},
    togglePlant(){if(state.mode!=='blend')return;plant=!plant;model.setPlantInspection(plant);hideTip();report();schedule();},
    toggleOrbit(){if(!plan){orbitTool=!orbitTool;report();}},
    togglePlan(){if(state.mode==='yard')return;plan=!plan;berthOffset.copy(plan?new THREE.Vector3(0,380,.01):homeOffset);berthFrame=measureBerthFrame();centerView();},
    focusSelected(){
      const heap = model.stockMeshes.get(state.selectedLotId);
      const mesh = heap?.mesh.visible ? heap.mesh : heap?.floor;
      let point = model.anchors.get('lot:'+state.selectedLotId);
      if (mesh) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        point = mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new THREE.Vector3()));
      }
      if (!point) return;
      // Retain the heap's depth as well as its screen position when orbiting close up.
      orbitShift.subVectors(point,homeCenter());
      panX = panY = 0;
      zoom = state.mode === 'berth' ? 5 : 3;
      roof = true; model.setRoofInspection(true);
      hideTip(); report(); schedule();
    },
    debug(){const {w,h,span,aspect}=dimensions();return {zoom,roof,plant,plan,resources:renderer.info.memory,model:model.debug(),disposed,view:{width:w,height:h,span,horizontalSpan:span*aspect,fit:berthFrame?{width:berthFrame.width,height:berthFrame.height}:null}};},
    dispose,
  };
}
