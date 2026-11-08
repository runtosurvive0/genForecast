// Shared schematic coal geometry. Footprints follow the snapshot; heights are
// illustrative. A roughly 35° repose slope prevents rounded, vertical-sided blocks.
export function coalHeight(tons,length,width){
 return Math.min(Math.min(length,width)*.5*.72, .7+Math.cbrt(Math.max(0,tons))/12);
}
export function createCoalWindrow(THREE,settings){
 const {length,width}=settings,geo=new THREE.PlaneGeometry(length,width,Math.max(48,Math.min(160,Math.ceil(length*3))),32);
 geo.rotateX(-Math.PI/2);const p=geo.attributes.position,grid=new Float32Array(p.count*2);
 for(let i=0;i<p.count;i++){grid[i*2]=p.getX(i)/(length/2);grid[i*2+1]=p.getZ(i)/(width/2);}
 geo.userData.grid=grid;return reshapeCoalWindrow(THREE,geo,settings);
}
export function reshapeCoalWindrow(THREE,geo,{length,width,height,seed=1,calibrated=false}){
 const radius=Math.min(width,length)/2,run=Math.max(0,length/2-radius);
 const h=calibrated?height:Math.min(height,radius*.72),p=geo.attributes.position,colors=[],grid=geo.userData.grid;
 const phase=String(seed).split('').reduce((n,c)=>n+c.charCodeAt(0),0)*.37;
 const random=(x,z)=>{const v=Math.sin(x*127.1+z*311.7+phase)*43758.5453;return v-Math.floor(v);};
 const noise=(x,z)=>{const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);return (random(ix,iz)*(1-u)+random(ix+1,iz)*u)*(1-v)+(random(ix,iz+1)*(1-u)+random(ix+1,iz+1)*u)*v;};
 for(let i=0;i<p.count;i++){
  const x=grid[i*2]*length/2,v=grid[i*2+1],end=Math.max(0,Math.abs(x)-run);
  const cap=Math.sqrt(Math.max(0,1-(end/radius)**2));
  const shoulder=.97+.06*noise(x*.7,3);
  const z=v*radius*cap*shoulder;
  const distance=Math.sqrt(end*end+(v*radius*cap)**2)/radius;
  const profile=Math.max(0,1-distance);
  // Small deposition irregularities; no procedural stripes or inflated cushions.
  const grain=noise(x*3,z*3)-.5;
  const ridge=.96+.08*noise(x*.6,8);
  const y=Math.max(0,h*profile*ridge+grain*.028*Math.sin(profile*Math.PI));
  p.setXYZ(i,x,y,z+.035*Math.sin(x*.7+phase)*cap*(1-Math.abs(v)));
  const shade=.82+.13*noise(x*2.6,z*2.6)+.04*noise(x*7,z*7);
  colors.push(shade,shade*.99,shade*.98);
 }
 if(geo.attributes.color){geo.attributes.color.array.set(colors);geo.attributes.color.needsUpdate=true;}else geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
 geo.userData={grid,shape:'repose-windrow',height:h,footprint:[length,width]};p.needsUpdate=true;geo.computeBoundingBox();geo.computeBoundingSphere();return geo;
}


// Landing height follows the rendered surface, including the live pile scale.
export function coalSurfaceHeight(THREE,mesh,point){
 mesh.updateWorldMatrix(true,false);const local=mesh.worldToLocal(new THREE.Vector3(...point)),v=mesh.geometry.attributes.position;let closest=Infinity,top=0;
 for(let i=0;i<v.count;i++){const d=(v.getX(i)-local.x)**2+(v.getZ(i)-local.z)**2;if(d<closest){closest=d;top=v.getY(i);}}
 return mesh.localToWorld(new THREE.Vector3(local.x,top,local.z)).y+.035;
}
