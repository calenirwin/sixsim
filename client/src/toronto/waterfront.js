import * as THREE from 'three';
export function validateWaterfront(d){
 const fail=()=>{throw Error('Invalid waterfront scene');};
 if(d?.version!==1||d.frame?.lon!==-79.397||d.frame?.lat!==43.65||!Array.isArray(d.groundVertices)||d.groundVertices.length%9||d.groundVertices.length>500000||!d.groundVertices.every(Number.isFinite)||!Array.isArray(d.grassVertices)||d.grassVertices.length%9||d.grassVertices.length>500000||!d.grassVertices.every(Number.isFinite)||!Array.isArray(d.walk)||d.walk.length<2||d.walk.length>1000||!Number.isFinite(d.lengthM)||d.lengthM<100||d.lengthM>2000||!Array.isArray(d.trees)||d.trees.length>2000||!Array.isArray(d.paths)||d.paths.length>1000||!Array.isArray(d.roads)||d.roads.length>500||!Array.isArray(d.water)||d.water.length>20||d.waterLevel!==74.5)fail();
 if(!Array.isArray(d.pavingVertices)||!d.pavingVertices.length||d.pavingVertices.length%9||d.pavingVertices.length>1500000||!d.pavingVertices.every(Number.isFinite))fail();
 if(!Array.isArray(d.roadVertices)||!d.roadVertices.length||d.roadVertices.length%9||d.roadVertices.length>1500000||!d.roadVertices.every(Number.isFinite))fail();
 if(!Array.isArray(d.crossingVertices)||!d.crossingVertices.length||d.crossingVertices.length%9||d.crossingVertices.length>500000||!d.crossingVertices.every(Number.isFinite)||!Array.isArray(d.crossingSourceIds)||!d.crossingSourceIds.every(id=>d.paths.some(p=>p.id===id&&p.crosswalk)))fail();
 const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&Math.abs(p[0])<5000&&p[1]>50&&p[1]<150&&Math.abs(p[2])<5000;
 for(let i=0;i<d.walk.length;i++){const p=d.walk[i];if(!Array.isArray(p)||p.length!==4||!Number.isFinite(p[0])||!point(p.slice(1))||p[0]<0||(i&&p[0]<=d.walk[i-1][0]))fail();}
 if(d.walk[0][0]!==0||Math.abs(d.walk.at(-1)[0]-d.lengthM)>.001)fail();
 for(const p of d.trees)if(!point(p))fail();
 for(const r of [...d.paths,...d.roads])if(!Number.isSafeInteger(r.id)||!Array.isArray(r.points)||r.points.length<2||r.points.length>2000||!r.points.every(point))fail();
 for(const w of d.water){if(!Array.isArray(w.rings)||!w.rings.length)fail();for(const ring of w.rings)if(!Array.isArray(ring)||ring.length<4||ring.length>20000||!ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<5000)))fail();}
 return d;
}
// Reuse a bounded spatial index; never substitute a nearest height across missing terrain.
const terrainIndexes=new WeakMap();
export function waterfrontGroundAt(data,x,z){
 if(!Number.isFinite(x)||!Number.isFinite(z))throw Error('Invalid terrain query');
 let cells=terrainIndexes.get(data);
 if(!cells){cells=new Map();let references=0;const v=data.groundVertices;for(let i=0;i<v.length;i+=9){const xs=[v[i],v[i+3],v[i+6]],zs=[v[i+2],v[i+5],v[i+8]];if(![...xs,...zs].every(n=>Number.isFinite(n)&&Math.abs(n)<5000))throw Error('Invalid terrain bounds');for(let a=Math.floor(Math.min(...xs)/20);a<=Math.floor(Math.max(...xs)/20);a++)for(let b=Math.floor(Math.min(...zs)/20);b<=Math.floor(Math.max(...zs)/20);b++){const key=`${a}_${b}`;if(!cells.has(key))cells.set(key,[]);if(++references>500000)throw Error('Terrain index budget exceeded');cells.get(key).push(i);}}terrainIndexes.set(data,cells);}
 const v=data.groundVertices;
 for(const i of cells.get(`${Math.floor(x/20)}_${Math.floor(z/20)}`)||[]){const [ax,ay,az,bx,by,bz,cx,cy,cz]=v.slice(i,i+9),den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,w=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;if(u>=-1e-7&&w>=-1e-7&&u+w<=1+1e-7)return u*ay+w*by+(1-u-w)*cy;}
 return null;
}
export function walkPose(data,distance,yaw=0){
 if(!Number.isFinite(distance)||!Number.isFinite(yaw))throw Error('Invalid walking pose');
 const d=Math.max(0,Math.min(data.lengthM,distance)),rows=data.walk;
 const at=v=>{let i=1;while(i<rows.length-1&&rows[i][0]<v)i++;const a=rows[i-1],b=rows[i],t=Math.max(0,Math.min(1,(v-a[0])/(b[0]-a[0])));return a.slice(1).map((x,j)=>x+(b[j+1]-x)*t);};
 const position=at(d),a=at(Math.max(0,d-2)),b=at(Math.min(data.lengthM,d+2));const ground=waterfrontGroundAt(data,position[0],position[2]);if(ground===null)throw Error('Walking position outside available terrain');position[1]=ground+.10+1.65;
 const angle=Math.atan2(b[2]-a[2],b[0]-a[0])+yaw,target=[position[0]+12*Math.cos(angle),position[1],position[2]+12*Math.sin(angle)];
 return {distance:d,position,target};
}
function mesh(positions,material){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.receiveShadow=true;return m;}
export function waterfrontScene(scene,data){
 validateWaterfront(data);const group=new THREE.Group();group.name='queensQuayWaterfront';scene.add(group);
 const mat=(color,roughness=1)=>new THREE.MeshStandardMaterial({color,roughness,side:THREE.DoubleSide});
 group.add(mesh(data.groundVertices,mat(0xa7a58f)));group.add(mesh(data.grassVertices,mat(0x6e8751)));
 const road=mesh(data.roadVertices,mat(0x42494b));road.name='terrainDrapedRoads';group.add(road);
 const paving=mat(0xb7b3a5);paving.onBeforeCompile=s=>{s.vertexShader='varying vec3 pavingPoint;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npavingPoint=position;');s.fragmentShader='varying vec3 pavingPoint;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nvec2 joints=step(vec2(.97),fract(pavingPoint.xz/1.5)); diffuseColor.rgb*=1.-.15*max(joints.x,joints.y);');};
 const sidewalks=mesh(data.pavingVertices,paving);sidewalks.name='terrainDrapedSidewalks';group.add(sidewalks);const crossings=mesh(data.crossingVertices,mat(0xe8e2ce));crossings.name='terrainDrapedCrossings';group.add(crossings);
 const water=mat(0x286a7c,.26);water.metalness=.18;water.onBeforeCompile=s=>{s.vertexShader='varying vec3 waterPoint;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwaterPoint=position;');s.fragmentShader='varying vec3 waterPoint;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat ripples=sin(waterPoint.x*1.8+sin(waterPoint.z*.7))*sin(waterPoint.z*2.1); diffuseColor.rgb*=.92+.12*ripples;');};
 for(const w of data.water){const ring=r=>r.map(([x,z])=>new THREE.Vector2(x,-z)),s=new THREE.Shape(ring(w.rings[0]));for(const hole of w.rings.slice(1))s.holes.push(new THREE.Path(ring(hole)));const g=new THREE.ShapeGeometry(s);g.rotateX(-Math.PI/2);g.translate(0,data.waterLevel,0);group.add(new THREE.Mesh(g,water));}
 const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.28,3.8,6),mat(0x665244),data.trees.length),leaves=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),mat(0xffffff),data.trees.length),o=new THREE.Object3D();
 data.trees.forEach(([x,y,z],i)=>{o.position.set(x,y+1.9,z);o.scale.set(1,1,1);o.updateMatrix();trunk.setMatrixAt(i,o.matrix);o.position.set(x,y+5.4,z);const r=2.6+(i%5)*.22;o.scale.set(r,3.2,r);o.updateMatrix();leaves.setMatrixAt(i,o.matrix);leaves.setColorAt(i,new THREE.Color([0x5e7950,0x78945e,0x41674b][i%3]));});trunk.castShadow=true;leaves.castShadow=true;group.add(trunk,leaves);
 group.userData={basis:'source-grounded geometry with illustrative materials and vegetation',trees:data.trees.length,groundTriangles:data.groundVertices.length/9,lengthM:data.lengthM};
 return {group,dispose(){const materials=new Set();group.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});for(const m of materials)m.dispose();group.removeFromParent();}};
}
