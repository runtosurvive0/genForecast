import * as THREE from 'three';

// Authored bulk-carrier illustration. Dimensions, hold fills and unloader locations
// describe the visual model only; they are not vessel particulars or telemetry.
export function createBulkCarrier({includePort=true}={}) {
  const root = new THREE.Group(), ship = new THREE.Group(), port = new THREE.Group();
  root.add(ship, port);
  const resources = new Set(), parts = [], anchors = {};
  const own = value => (resources.add(value), value);
  const mat = (color, roughness=.6, metalness=.15) => own(new THREE.MeshStandardMaterial({color, roughness, metalness}));
  const m = {
    hull:mat('#304453',.48,.25), rim:mat('#bdc8cc',.45,.3), deck:mat('#7e8e94',.78,.15),
    wall:mat('#52646c',.8,.15), coal:mat('#252c31',.97,.02), steel:mat('#cbd3d4',.43,.45),
    white:mat('#e9edeb',.58,.12), glass:mat('#294b5f',.24,.48), blue:mat('#2878bf',.48,.2),
    rubber:mat('#263239',.96,.02), yellow:mat('#d8b762',.65,.2), orange:mat('#d8793d',.7,.1),
    concrete:mat('#cad1d4',.98,0), rail:mat('#60727e',.65,.4), rope:mat('#b5aa8d',.95,0)
  };
  const unitBox = own(new THREE.BoxGeometry(1,1,1));
  function mesh(geo,material,parent=ship,cast=true) {
    const o = new THREE.Mesh(own(geo),material); o.castShadow=cast; o.receiveShadow=true; parent.add(o); return o;
  }
  function box(x,y,z,w,h,d,material,parent=ship) {
    const o = mesh(unitBox,material,parent); o.position.set(x,y,z); o.scale.set(w,h,d); return o;
  }
  const cylGeo = own(new THREE.CylinderGeometry(1,1,1,10));
  const vY = new THREE.Vector3(0,1,0);
  function rod(a,b,r,material,parent=ship) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), dir=end.clone().sub(start);
    const o=mesh(cylGeo,material,parent,false); o.position.copy(start.add(end).multiplyScalar(.5)); o.scale.set(r,dir.length(),r); o.quaternion.setFromUnitVectors(vY,dir.normalize()); return o;
  }
  function cylinder(x,y,z,r,h,material,parent=ship){const o=mesh(cylGeo,material,parent);o.position.set(x,y,z);o.scale.set(r,h,r);return o;}
  function part(object,label,anchor){object.userData.label=label;parts.push(object);if(anchor)anchors[label]=new THREE.Vector3(...anchor);return object;}
  function label(text,x,y,z,w,d,parent=ship){ const anchor=new THREE.Object3D();anchor.position.set(x,y,z);anchor.userData.label=text;parent.add(anchor);return anchor; }
  // Continuous, rounded shell: bow at left, accommodation and transom aft.
  const stations=[[-113,.3],[-110,4.1],[-104,8.3],[-96,11.9],[-86,14.3],[-74,15.5],[-60,16],[-40,16.1],[0,16.1],[40,16.1],[72,15.9],[91,15],[103,12.4],[109,9.4],[111,5.5]];
  const curve=new THREE.SplineCurve(stations.map(([x,z])=>new THREE.Vector2(x,z)));
  const edge=curve.getPoints(120);
  function outline(){return [...edge.map(p=>[p.x,p.y]),...edge.slice().reverse().map(p=>[p.x,-p.y])];}
  const contour=outline();
  const ringLevels=[[-3,.67],[-1.7,.88],[1.5,.98],[4,1]];
  const pos=[], indices=[];
  for(const [y,f] of ringLevels)for(const [x,z] of contour)pos.push(x,y,z*f);
  const count=contour.length;
  for(let ring=0;ring<ringLevels.length-1;ring++)for(let j=0;j<count;j++){
    const k=(j+1)%count,a=ring*count+j,b=ring*count+k,c=(ring+1)*count+j,d=(ring+1)*count+k;
    indices.push(a,b,c,b,d,c);
  }
  const hullGeo=new THREE.BufferGeometry();hullGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));hullGeo.setIndex(indices);hullGeo.computeVertexNormals();
  part(mesh(hullGeo,m.hull),'선체',[-55,4,14]);
  const deckShape = new THREE.Shape(); contour.forEach(([x,z],i)=>i?deckShape.lineTo(x,-z):deckShape.moveTo(x,-z));deckShape.closePath();
  const coalSurfaces=[];
  const holdXs=[-66,-44,-22,0,22,44,66];
  for(const x of holdXs){const hole=new THREE.Path();hole.moveTo(x-8.6,-11.4);hole.lineTo(x+8.6,-11.4);hole.lineTo(x+8.6,11.4);hole.lineTo(x-8.6,11.4);hole.closePath();deckShape.holes.push(hole);}
  const deckGeo=new THREE.ShapeGeometry(deckShape,48);deckGeo.rotateX(-Math.PI/2);const deck=mesh(deckGeo,m.deck);deck.position.y=4;
  // Bulwark, toe rails and three continuous guard rails follow the sheer outline.
  const railPoints=contour.filter((_,i)=>i%3===0);
  for(let i=0;i<railPoints.length;i++){
    const a=railPoints[i],b=railPoints[(i+1)%railPoints.length];
    rod([a[0],4.12,a[1]],[b[0],4.12,b[1]],.25,m.rim);
    rod([a[0],4.15,a[1]],[a[0],5.65,a[1]],.085,m.steel);
    for(const y of [4.75,5.5])rod([a[0],y,a[1]],[b[0],y,b[1]],.065,m.steel);
  }
  for(const z of [-13.2,13.2]){
    box(0,4.035,z,155,.055,.15,m.yellow);
    for(let x=-76;x<77;x+=5){box(x,4.04,z+Math.sign(z)*.7,.06,.05,1.5,m.rim);}
    rod([-75,4.38,z+.45],[75,4.38,z+.45],.14,m.steel);
  }
  // Rough coal surfaces sit inside deep coamings; no visual percentage is implied.
  const noise=(x,z)=>{const n=Math.sin(x*129.8+z*73.3)*43758.5453;return n-Math.floor(n);};
  m.coal.flatShading=true;m.coal.vertexColors=true;m.coal.color.set('#ffffff');
  holdXs.forEach((x,i)=>{
    const hold=new THREE.Group();hold.userData.label=`화물창 ${i+1} · 적재 형상은 예시`;ship.add(hold);
    const localBox=(a,y,z,w,h,d,mat)=>box(a,y,z,w,h,d,mat,hold);
    localBox(x,1.25,0,17.2,.3,22.8,m.wall);
    for(const z of [-11.65,11.65]){
      part(localBox(x,3.2,z,18.8,3.6,.55,m.wall),hold.userData.label);
      localBox(x,5.08,z,19,.22,.86,m.rim);
      for(let a=x-8;a<=x+8;a+=2)localBox(a,4.6,z+Math.sign(z)*.4,.16,1.15,.5,m.rim);
    }
    for(const a of [x-9,x+9]){localBox(a,3.2,0,.65,3.6,23.4,m.wall);localBox(a,5.08,0,.9,.22,24.1,m.rim);}
    const geo=new THREE.PlaneGeometry(17.1,22.6,36,46);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;
    const colors=[];
    for(let j=0;j<p.count;j++){const a=p.getX(j),z=p.getZ(j),h=Math.pow(Math.max(0,(1-(a/8.6)**2)*(1-(z/11.4)**2)),.7);p.setY(j,2.15+h*2.2+(noise(a+i*30,z)-.5)*.5);const c=new THREE.Color('#252a30').multiplyScalar(.7+noise(a*5,z+i)*.6);colors.push(c.r,c.g,c.b);}
    geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geo.computeVertexNormals();const pile=mesh(geo,m.coal,hold);pile.position.x=x;coalSurfaces.push(pile);part(pile,hold.userData.label);
    // Folded hatch panels, hinges and hydraulic arms along the fore coaming.
    for(let j=0;j<3;j++){
      localBox(x-10.15+j*.38,5.7,0,.3,2.9,22.4,m.deck);
      for(let z=-10;z<=10;z+=2)localBox(x-10.33+j*.38,5.7,z,.08,2.6,.12,m.rim);
    }
    for(const z of [-11,11])cylinder(x-9.8,5.25,z,.25,.65,m.yellow,hold);
    label(`H${i+1}`,x,4.08,14.55,3.2,.85);
  });
  // Forecastle with radial deck stiffeners, windlasses, chains and mooring gear.
  const bowShape=new THREE.Shape();[[-112,0],[-107,-6],[-97,-11.5],[-82,-14.8],[-82,14.8],[-97,11.5],[-107,6]].forEach(([x,z],i)=>i?bowShape.lineTo(x,z):bowShape.moveTo(x,z));bowShape.closePath();
  const bowGeo=new THREE.ExtrudeGeometry(bowShape,{depth:.8,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.15,bevelThickness:.12});bowGeo.rotateX(-Math.PI/2);
  const fore=mesh(bowGeo,m.deck);fore.position.y=4;part(fore,'선수 · 윈들러스와 계류 장치',[-99,6,0]);
  for(const sign of [-1,1]){
    for(let i=0;i<6;i++){const x=-107+i*4,z=(3+i*1.35)*sign;rod([x,4.9,z],[x+3,4.9,z*.62],.2,m.rim);}
    box(-94,5.15,sign*5.2,7.2,.7,4,m.wall);box(-94,5.6,sign*5.2,5.3,.25,3.1,m.steel);
    const drum=cylinder(-94,6.15,sign*5.2,1.1,2.6,m.yellow);drum.rotation.z=Math.PI/2;
    for(const x of [-95.3,-92.7]){const wheel=cylinder(x,6.15,sign*5.2,1.35,.22,m.steel);wheel.rotation.z=Math.PI/2;}
    for(let x=-106;x<-94;x+=.63){const chain=mesh(new THREE.TorusGeometry(.23,.07,5,8),m.rail);chain.position.set(x,4.97,sign*4.8);chain.rotation.x=Math.PI/2;}
    for(const x of [-103,-86]){box(x,4.95,sign*(x===-103?7:12),3,.25,1.8,m.wall);for(const dx of [-.8,.8]){cylinder(x+dx,5.5,sign*(x===-103?7:12),.4,1,m.yellow);cylinder(x+dx,6,sign*(x===-103?7:12),.57,.18,m.rim);}}
  }
  box(-84,5.5,0,4,1.3,5,m.rim);box(-84,6.22,0,4.2,.2,5.2,m.deck);
  rod([-105,4.8,0],[-105,12,0],.17,m.steel);rod([-107,8,0],[-103,8,0],.1,m.steel);
  cylinder(-105,12.1,0,.25,.4,m.white);
  // Aft accommodation: stepped decks, glazed bridge wings, funnel and lifeboats.
  const bridge = new THREE.Group();ship.add(bridge);
  for(let level=0;level<4;level++){
    const y=5.25+level*2.45,w=14.8-level*.6,d=20-level*1.1;
    part(box(89,y,0,w,2.4,d,m.white,bridge),'선교 · 거주구',[89,16,0]);
    box(89,y+1.3,0,w+1.4,.26,d+1.6,m.steel,bridge);
    for(const sign of [-1,1])for(let x=84;x<=94;x+=2.4)box(x,y+.25,sign*(d/2+.04),1.25,.8,.09,m.glass,bridge);
    if(level<3)for(const sign of [-1,1]){
      rod([81.5,y+1.5,sign*(d/2+.6)],[96.6,y+1.5,sign*(d/2+.6)],.055,m.rim,bridge);
      for(let x=82;x<=96;x+=2)rod([x,y+1.3,sign*(d/2+.6)],[x,y+2.2,sign*(d/2+.6)],.05,m.rim,bridge);
    }
  }
  box(86.8,14.8,0,10.8,2.1,26.7,m.white,bridge);box(86.8,16,0,11.5,.3,27.4,m.steel,bridge);
  for(const x of [81.35,92.25]){box(x,15,0,.08,1.1,25.6,m.glass,bridge);for(let z=-12;z<=12;z+=1.8)box(x,15,z,.12,1.3,.12,m.white,bridge);}
  for(const z of [-13.4,13.4])box(86.8,15,z,9.8,1.15,.09,m.glass,bridge);
  // Bridge roof fittings break up the broad upper deck at the inspection scale.
  for(const sign of [-1,1]){
    for(const x of [83.3,90.1]){
      box(x,16.6,sign*8.1,2.5,.95,2.1,m.white,bridge);box(x,17.1,sign*8.1,2.3,.12,1.9,m.rail,bridge);
      for(let z=sign*8.1-.7;z<sign*8.1+.8;z+=.3)box(x,17.18,z,2.2,.05,.09,m.steel,bridge);
    }
    rod([82,16.3,sign*12.4],[92,16.3,sign*12.4],.07,m.yellow,bridge);
    for(let x=82;x<=92;x+=2)rod([x,16.2,sign*12.4],[x,17.15,sign*12.4],.06,m.steel,bridge);
    rod([82,17.15,sign*12.4],[92,17.15,sign*12.4],.06,m.steel,bridge);
    const dome=mesh(new THREE.SphereGeometry(.8,12,8),m.white,bridge);dome.position.set(84,17.15,sign*4.5);cylinder(84,16.55,sign*4.5,.65,.8,m.rail,bridge);
  }
  box(86.4,16.22,0,2.2,.12,6,m.deck,bridge);
  for(let x=84.9;x<88.1;x+=.65)box(x,16.25,0,.1,.1,6.2,m.rim,bridge);
  box(90,17,0,5,1.8,7,m.white,bridge);rod([90,17.9,0],[90,25,0],.18,m.steel,bridge);
  for(const y of [20.5,23]){rod([90,y,-3],[90,y,3],.12,m.steel,bridge);box(90,y+.35,2,3,.22,.55,m.white,bridge);}
  for(const z of [-6,6])rod([86,16.2,z],[86,20,z],.08,m.steel,bridge);
  box(101,8.9,0,6.7,9.6,7,m.white);box(101,12.8,0,6.8,2.3,7.1,m.blue);box(101,14.1,0,7.1,.4,7.4,m.rubber);
  for(const z of [-1.7,1.7])cylinder(101,14.65,z,.7,1,m.rail);
  for(const sign of [-1,1]){
    const boat=mesh(new THREE.CapsuleGeometry(1.15,4.2,4,10),m.orange);boat.rotation.z=Math.PI/2;boat.position.set(96,7.3,sign*12.5);part(boat,'구명정');
    box(96,8.1,sign*12.5,2.4,.5,1.1,m.white);
    for(const x of [93,99]){rod([x,4.2,sign*11.2],[x,9.5,sign*11.2],.18,m.steel);rod([x,9.5,sign*11.2],[x,9.5,sign*13],.15,m.steel);rod([x,9.5,sign*13],[x,7.4,sign*13],.05,m.rail);}
    for(let x=102;x<=108;x+=3)cylinder(x,4.7,sign*6,.4,1.2,m.yellow);
    for(let s=0;s<10;s++)box(78.3+s*.3,4.3+s*.25,sign*9,.4,.16,2,m.steel);
  }
  label('gen4cast',104,4.06,0,6,1.5);
  // Shore side: rails, fenders, bollards, conveyor and two supported grab unloaders.
  if(includePort){
  const quay=box(0,.6,-30,244,3,14,m.concrete,port);part(quay,'부두 · 이송 컨베이어');
  for(const z of [-24,-35]){box(0,2.15,z,240,.2,.22,m.rail,port);box(0,2.08,z+.6,240,.04,.12,m.yellow,port);}
  for(let x=-112;x<=112;x+=14){box(x,.8,-22.6,3.7,3,1.1,m.rubber,port);cylinder(x,2.7,-24.9,.5,1.2,m.rail,port);}
  box(0,4.6,-34,240,.8,2.1,m.blue,port);box(0,5.1,-34,239,.18,1.25,m.rubber,port);
  for(let x=-116;x<118;x+=5){box(x,3.25,-34,.22,2.2,1.9,m.steel,port);rod([x,2.2,-33],[x+4.7,4.55,-33],.1,m.steel,port);}
  for(const x of [-107,105])for(const z of [-11,-9])rod([x,4.8,z],[x+Math.sign(x)*5,2.8,-24.8],.1,m.rope,ship);
  function unloader(x){
    const g=new THREE.Group();port.add(g);g.position.x=x;
    for(const a of [-4,4])for(const z of [-24,-35]){
      box(a,2.7,z,4,1.1,1.2,m.rail,g);for(const dx of [-1.2,1.2]){const wheel=cylinder(a+dx,2.7,z,.65,.4,m.rubber,g);wheel.rotation.x=Math.PI/2;}
      box(a,8.8,z,.75,11.3,.85,m.blue,g);
    }
    for(const z of [-24,-35]){box(0,14.6,z,10.5,1,1,m.blue,g);rod([-4,3.8,z],[4,13.8,z],.16,m.steel,g);rod([4,3.8,z],[-4,13.8,z],.16,m.steel,g);}
    for(const a of [-4,4]){box(a,14.6,-29.5,.8,1,12,m.blue,g);rod([a,4,-24],[a,13,-35],.18,m.steel,g);}
    part(box(0,16.4,-29,9,3,7,m.white,g),'하역기 · 위치·운전 신호 미연결');box(3,16.1,-24,2.7,2.5,3,m.glass,g);
    for(const a of [-2.5,2.5]){
      rod([a,18,-29],[a,26,-28],.22,m.blue,g);
      for(const y of [17.5,19.8])rod([a,y,-36],[a,y,4],.24,m.blue,g);
      for(let z=-35;z<4;z+=4){rod([a,17.5,z],[a,19.8,z+4],.12,m.steel,g);rod([a,19.8,z],[a,17.5,z+4],.12,m.steel,g);}
      rod([a,26,-28],[a,19.8,4],.09,m.rail,g);rod([a,26,-28],[a,19.8,-36],.09,m.rail,g);
      rod([a,18,-1],[a,8,-1],.065,m.rail,g);
    }
    box(0,18.3,-1,6.1,.7,2.1,m.rail,g);box(0,7.5,-1,4.5,1,3.6,m.steel,g);
    for(const sign of [-1,1]){const jaw=box(sign*1.3,6.55,-1,2.5,1.5,3.7,m.wall,g);jaw.rotation.z=sign*.25;rod([sign*2,7.1,-1],[0,9,-1],.16,m.steel,g);}
    // Back hopper joins the longitudinal quay conveyor.
    const hopper=mesh(new THREE.CylinderGeometry(2.2,.9,3.5,4),m.steel,g);hopper.rotation.y=Math.PI/4;hopper.position.set(0,7,-34);
    box(0,4.9,-34,1.2,1.3,1.2,m.rail,g);
  }
  unloader(-22);unloader(44);
  }
  return {root,ship,port,parts,anchors,holdCount:holdXs.length,setRemaining(ratio){for(const p of coalSurfaces){p.scale.y=Math.max(0,ratio);p.position.y=1.4*(1-Math.max(0,ratio));p.visible=ratio>0;}},dispose(){resources.forEach(r=>r.dispose?.());resources.clear();}};
}
