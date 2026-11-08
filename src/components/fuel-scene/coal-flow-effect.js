import {samplePath,sampleFall} from './coal-flow-paths.js';
export function createFlowEffect(THREE,parent,own,{scale=1}={}){
 const group=new THREE.Group();parent.add(group);group.visible=false;
 const geo=own(new THREE.CylinderGeometry(1,1,1,6)),bedGeo=own(new THREE.BoxGeometry(1,1,1)),grain=own(new THREE.DodecahedronGeometry(.25*scale,0));
 const coreMat=own(new THREE.MeshBasicMaterial({color:'#6e8fff',transparent:true,opacity:.65,toneMapped:false,depthWrite:false}));
 const haloMat=own(new THREE.MeshBasicMaterial({color:'#2447c5',transparent:true,opacity:.11,toneMapped:false,depthWrite:false}));
 const grainMat=own(new THREE.MeshStandardMaterial({color:'#20242a',roughness:.85}));
 const bedMat=own(new THREE.MeshStandardMaterial({color:'#202429',roughness:1}));
 const core=new THREE.InstancedMesh(geo,coreMat,32),halo=new THREE.InstancedMesh(geo,haloMat,32),bed=new THREE.InstancedMesh(bedGeo,bedMat,32),particles=new THREE.InstancedMesh(grain,grainMat,384),falling=new THREE.InstancedMesh(grain,grainMat,256);
 group.add(halo,core,bed,particles,falling);const all=[core,halo,bed,particles,falling];for(const o of all){own(o);o.frustumCulled=false;o.count=0;}
 const dummy=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),across=new THREE.Vector3(1,0,0);let current=[];
 function particle(mesh,index,point,size,seed){dummy.position.set(...point);dummy.rotation.set(seed*.7,seed*.9,seed*.4);dummy.scale.set(size,size*.75,size*1.25);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);}
 function update(paths,flow,clock,active){
  group.visible=active;current=paths;if(!active){for(const o of all)o.count=0;return;}let count=0,p=0,beds=0,drops=0;
  for(const path of paths){
   for(let i=1;i<path.points.length&&count<32;i++){
    if(path.drop?.to===i)continue;
    const a=new THREE.Vector3(...path.points[i-1]),b=new THREE.Vector3(...path.points[i]),d=b.clone().sub(a);if(d.length()<.001)continue;
    dummy.position.copy(a.add(b).multiplyScalar(.5));dummy.quaternion.setFromUnitVectors(up,d.clone().normalize());
    // Neon belongs to the equipment edge; the material itself stays charcoal black.
    const side=new THREE.Vector3(-d.z,0,d.x).normalize().multiplyScalar(.53*scale);dummy.position.add(side);
    dummy.scale.set(.08*scale,d.length(),.08*scale);dummy.updateMatrix();core.setMatrixAt(count,dummy.matrix);
    dummy.scale.set(.45*scale,d.length(),.45*scale);dummy.updateMatrix();halo.setMatrixAt(count++,dummy.matrix);
    if(Math.abs(d.y)<Math.hypot(d.x,d.z)*.8){dummy.position.sub(side);dummy.position.y+=.09*scale;dummy.quaternion.setFromUnitVectors(across,d.clone().normalize());dummy.scale.set(d.length(),.18*scale,.72*scale);dummy.updateMatrix();bed.setMatrixAt(beds++,dummy.matrix);}
   }
   const travel=path.drop?path.points.slice(0,path.drop.from+1):path.points;
   const length=travel.slice(1).reduce((n,v,i)=>n+Math.hypot(...v.map((x,k)=>x-travel[i][k])),0),n=Math.min(192,Math.max(48,Math.ceil(length*2)),384-p);
   for(let i=0;i<n;i++){
    const t=(i/n+clock*Math.min(flow,5000)/50000)%1,s=samplePath(travel,t),point=s.point;point[1]+=.24*scale;point[0]+=Math.sin(i*7.13)*.19*scale;point[2]+=Math.cos(i*4.37)*.19*scale;
    particle(particles,p++,point,.75+(i%5)*.12,i+clock*.3);
   }
   if(path.drop){
    const a=path.points[path.drop.from],b=path.points[path.drop.to],height=Math.max(.1,a[1]-b[1]),duration=Math.sqrt(2*height/9.81),rate=Math.max(.45,Math.min(1.4,flow/1200));
    // Reserve particles for the short open fall; long belts cannot dilute this stream.
    for(let i=0;i<96&&drops<256;i++){
     const t=(i/96+clock*rate/duration)%1,point=sampleFall(a,b,t),spread=(.13+.20*t)*scale;
     point[0]+=Math.sin(i*12.73)*spread;point[2]+=Math.cos(i*8.61)*spread;
     particle(falling,drops++,point,.58+(i%7)*.08,i+clock*rate*4);
    }
    // Small landing scatter stays above the receiving surface; it never falls through it.
    for(let i=0;i<24&&drops<256;i++){
     const t=(i/24+clock*rate*1.7)%1,angle=i*2.399,radius=t*(path.drop.kind==='pile'?.75:.34)*scale;
     const point=[b[0]+Math.cos(angle)*radius,b[1]+Math.sin(t*Math.PI)*.23*scale,b[2]+Math.sin(angle)*radius];
     particle(falling,drops++,point,(1-t)*.6+.1,i+clock);
    }
   }
  }
  core.count=halo.count=count;bed.count=beds;particles.count=p;falling.count=drops;for(const o of all)o.instanceMatrix.needsUpdate=true;
 }
 return {group,update,debug:()=>({visible:group.visible,paths:current,transportParticles:particles.count,fallingParticles:falling.count})};
}
export function detachMotion(g){const moving=[];g.traverse(o=>{if(o.userData.motion)moving.push(o);});g.updateMatrixWorld(true);for(const o of moving){g.attach(o);o.userData.baseQuaternion=o.quaternion.clone();}return moving;}
export function withinMotion(o){while(o){if(o.userData.motion)return true;o=o.parent;}return false;}
export function animateMachinery(THREE,parts,clock,flow){
 if(!flow)return;for(const o of parts){if(o.userData.motion==='rotor')o.quaternion.copy(o.userData.baseQuaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-clock*flow/6000));
  if(o.userData.motion==='elevator')o.children.forEach((m,i)=>{const t=(i/o.children.length+clock*flow/50000)%1,side=t<.5?1:-1;m.position.set(side*1.2,t<.5?1.8+t*36.4:20-(t-.5)*36.4,23);});
 }
}
