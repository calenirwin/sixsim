import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import * as THREE from 'three';
import {validateWaterfront,walkPose,waterfrontScene,waterfrontGroundAt} from '../../client/src/toronto/waterfront.js';
const bytes=fs.readFileSync('client/fixtures/toronto/waterfront/scene.json'),d=JSON.parse(bytes),p=JSON.parse(fs.readFileSync('client/fixtures/toronto/waterfront/provenance.json'));
test('Water exclusion retains candidate identities and every surviving tree transform and colour',()=>{
 assert.deepEqual(d.treeStyleIds,[...Array(729).keys()].filter(i=>i!==707));
 const excluded=p.derivation.vegetation_exclusions;assert.equal(excluded.length,1);
 assert.deepEqual(excluded[0].gridEPSG2952,[314594,4833220]);assert.deepEqual(excluded[0].canopyFeatureIds,[179]);assert.deepEqual(excluded[0].waterFeatureIds,[403]);
 const historic=structuredClone(d);delete historic.treeStyleIds;historic.trees.splice(707,0,excluded[0].position);
 const old=waterfrontScene(new THREE.Scene(),historic),current=waterfrontScene(new THREE.Scene(),d);
 for(const name of ['illustrativeTreeTrunks','illustrativeTreeCrowns']){
  const a=old.group.getObjectByName(name),b=current.group.getObjectByName(name);
  for(let i=0;i<b.count;i++){
   const id=d.treeStyleIds[i];assert.deepEqual(b.instanceMatrix.array.slice(i*16,i*16+16),a.instanceMatrix.array.slice(id*16,id*16+16));
   if(b.instanceColor)assert.deepEqual(b.instanceColor.array.slice(i*3,i*3+3),a.instanceColor.array.slice(id*3,id*3+3));
  }
 }
 old.dispose();current.dispose();
 for(const ids of [[],Array(d.trees.length).fill(0),d.treeStyleIds.map((n,i)=>i===0?-1:n)])assert.throws(()=>validateWaterfront({...d,treeStyleIds:ids}));
});
import {auditTreeContact} from '../toronto/audit-tree-contact.mjs';
test('Contact audit distinguishes steep supported ground from mapped-water absence without modifying the scene',()=>{
 const original=JSON.stringify(d),audit=auditTreeContact(d);
 assert.deepEqual(audit,auditTreeContact(d));assert.equal(JSON.stringify(d),original);
 assert.deepEqual(audit.counts,{extended:398,negligible:326,missingCentre:0,inconsistentCentre:0,missingPerimeter:0,overCap:4});
 assert.equal(Object.values(audit.counts).reduce((a,b)=>a+b,0),d.trees.length);
 assert.deepEqual(audit.unsupported.map(t=>t.index),[385,464,498,519]);
 for(const t of audit.unsupported.slice(0,4)){
  assert.equal(t.reason,'overCap');assert.equal(t.extensionM,0);assert.deepEqual(t.mappedWater,[]);
  assert.ok(t.perimeterM.every(Number.isFinite));assert.ok(Math.abs(t.centreM-t.position[1])<.003);
  assert.ok(t.gapM>.33&&t.gapM<.59);assert.ok(t.nearestWalk.distanceM>64&&t.nearestWalk.distanceM<298);
 }
 const historic=structuredClone(d);historic.trees.push(p.derivation.vegetation_exclusions[0].position);historic.treeStyleIds.push(707);const water=auditTreeContact(historic).unsupported.at(-1);assert.equal(water.reason,'missingCentre');assert.equal(water.centreM,null);assert.equal(water.gapM,null);
 assert.deepEqual(water.perimeterM,Array(6).fill(null));assert.deepEqual(water.mappedWater,[{id:403,name:'Toronto Harbour'}]);
 assert.ok(water.nearestWalk.distanceM>528&&water.nearestWalk.distanceM<529);assert.ok(Math.abs(water.nearestWalk.alongM-d.lengthM)<.0001);
 // Mapped-water diagnosis must respect holes, without manufacturing terrain underneath.
 const holes=structuredClone(historic),[x,,z]=holes.trees.at(-1);holes.water=[{id:99,name:'synthetic hole test',rings:[[[x-2,z-2],[x+2,z-2],[x+2,z+2],[x-2,z+2]],[[x-1,z-1],[x+1,z-1],[x+1,z+1],[x-1,z+1]]]}];
 const inHole=auditTreeContact(holes).unsupported.find(t=>t.index===728);assert.deepEqual(inHole.mappedWater,[]);assert.equal(inHole.reason,'missingCentre');
});
test('Pinned waterfront budgets, original source IDs and continuous path remain reproducible',()=>{
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.sha256);assert.equal(bytes.length,p.bytes);assert.equal(validateWaterfront(d),d);assert.equal(d.groundVertices.length/9,13181);assert.equal(d.trees.length,728);assert.equal(d.sourceRoute.length,15);assert.ok(d.maxJoinM<.02);assert.ok(d.lengthM>1100&&d.lengthM<1102);
 const inside=(q,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>q[1])!==(b[1]>q[1]))&&(q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]))c=!c;}return c;};
 for(let i=0;i<d.groundVertices.length;i+=9){const v=d.groundVertices,q=[(v[i]+v[i+3]+v[i+6])/3,(v[i+2]+v[i+5]+v[i+8])/3];assert.ok(!d.water.some(w=>inside(q,w.rings[0])&&!w.rings.slice(1).some(r=>inside(q,r))),'Ground must not cover mapped harbour');}
 for(const row of d.walk){const q=[row[1],row[3]];assert.ok(!d.water.some(w=>inside(q,w.rings[0])&&!w.rings.slice(1).some(r=>inside(q,r))),'Walk must not enter mapped water');}
});
test('Eye-level walking clamps endpoints, rejects invalid inputs and preserves source interpolation',()=>{
 assert.equal(walkPose(d,-10).distance,0);assert.equal(walkPose(d,1e6).distance,d.lengthM);assert.throws(()=>walkPose(d,NaN));assert.throws(()=>walkPose(d,1,Infinity));
 for(const row of d.walk.filter((_,i)=>i%50===0)){const pose=walkPose(d,row[0]);assert.ok(Math.abs(pose.position[1]-row[2]-1.65)<.001);assert.ok(Math.hypot(pose.position[0]-row[1],pose.position[2]-row[3])<1e-7);const turned=walkPose(d,row[0],Math.PI);assert.deepEqual(turned.position,pose.position);assert.notDeepEqual(turned.target,pose.target);}
 assert.deepEqual(walkPose(d,10+10),walkPose(d,20));
});
test('Malformed assets fail before scene allocation; bounded render resources dispose',()=>{
 for(const mutate of [x=>x.walk[1][0]=0,x=>x.waterLevel=NaN,x=>x.trees[0][1]=null,x=>x.pavingVertices[0]=NaN,x=>x.pavingVertices.pop(),x=>x.paths[0].points[0][0]=Infinity]){const bad=structuredClone(d);mutate(bad);assert.throws(()=>validateWaterfront(bad));}
 const scene=new THREE.Scene(),r=waterfrontScene(scene,d);assert.equal(r.group.userData.trees,728);assert.ok(r.group.children.length<20);r.dispose();assert.equal(scene.children.length,0);
});

test('Full-width paving follows original terrain and continuously covers the guided route',()=>{
 // Spatial index keeps checks bounded without substituting nearest-height interpolation.
 const index=vertices=>{const cells=new Map();for(let i=0;i<vertices.length;i+=9){const t=vertices.slice(i,i+9),xs=[t[0],t[3],t[6]],zs=[t[2],t[5],t[8]];for(let x=Math.floor(Math.min(...xs)/20);x<=Math.floor(Math.max(...xs)/20);x++)for(let z=Math.floor(Math.min(...zs)/20);z<=Math.floor(Math.max(...zs)/20);z++){const key=`${x}_${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);}}return (x,z)=>{for(const t of cells.get(`${Math.floor(x/20)}_${Math.floor(z/20)}`)||[]){const [ax,ay,az,bx,by,bz,cx,cy,cz]=t,den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;if(u>=-1e-5&&v>=-1e-5&&u+v<=1+1e-5)return u*ay+v*by+(1-u-v)*cy;}return null;};};
 const ground=index(d.groundVertices),paving=index(d.pavingVertices),roads=index(d.roadVertices);
 assert.ok(d.pavingVertices.length>0&&d.pavingVertices.length<1500000);
 // Every triangle centroid, including outer edges of bends, must match the source TIN.
 for(let i=0;i<d.pavingVertices.length;i+=9){const v=d.pavingVertices,x=(v[i]+v[i+3]+v[i+6])/3,z=(v[i+2]+v[i+5]+v[i+8])/3,y=(v[i+1]+v[i+4]+v[i+7])/3,h=ground(x,z);assert.notEqual(h,null,'No paving over missing terrain or mapped water');assert.ok(Math.abs(y-h-.06)<.003,'Paving must follow TIN across its width');}
 for(let distance=0;distance<d.lengthM;distance+=.5){const {position:[x,y,z]}=walkPose(d,distance),h=paving(x,z)??roads(x,z);assert.notEqual(h,null,`Walking surface gap at ${distance} m`);assert.ok(Math.abs(y-1.65-h-.04)<.04,'Walking eye remains above continuous paving');}
 const scene=new THREE.Scene(),r=waterfrontScene(scene,d);assert.equal(r.group.getObjectByName('terrainDrapedSidewalks').geometry.attributes.position.count,d.pavingVertices.length/3);r.dispose();
});

test('Missing terrain is explicit and walking never falls back to route heights',()=>{assert.equal(waterfrontGroundAt(d,100000,100000),null);assert.throws(()=>waterfrontGroundAt(d,NaN,0));assert.throws(()=>waterfrontGroundAt({groundVertices:[1e9,0,0,0,0,0,0,0,1]},0,0),/bounds/);assert.throws(()=>walkPose({...d,groundVertices:[]},0),/outside available terrain/);});

import {buildingGroundJoins} from '../../client/src/toronto/buildingGroundJoins.js';
test('Illustrative plinths preserve wall tops, follow slope, retain holes and reject unsupported gaps',()=>{
 const ring=[[0,0],[4,0],[4,4],[0,4]],hole=[[1,1],[1,2],[2,2],[2,1]],input=structuredClone([ring,hole]);
 const r=buildingGroundJoins(input,80,(x,z)=>78+x/10);assert.ok(r.stats.segments>8);assert.deepEqual(input,[ring,hole]);
 for(let i=0;i<r.positions.length;i+=3){const [x,y,z]=r.positions.slice(i,i+3);assert.ok(Math.abs(y-80.01)<1e-8||Math.abs(y-(78+x/10-.05))<1e-8);}
 assert.equal(buildingGroundJoins([ring],80,()=>null).positions.length,0);
 assert.equal(buildingGroundJoins([ring],80,()=>70).positions.length,0);
 assert.equal(buildingGroundJoins([ring],80,()=>81).positions.length,0);
 const limited=buildingGroundJoins([ring],80,()=>78,{maxVertices:6});assert.equal(limited.positions.length,18);assert.ok(limited.stats.budget>0);
 assert.throws(()=>buildingGroundJoins([ring],80,()=>78,{maxDrop:100}));
});

test('Road surfaces follow original TIN across full width without bridging missing ground',()=>{
 const v=d.roadVertices;assert.ok(v.length>0&&v.length<1500000);
 for(let i=0;i<v.length;i+=9){const x=(v[i]+v[i+3]+v[i+6])/3,z=(v[i+2]+v[i+5]+v[i+8])/3,y=(v[i+1]+v[i+4]+v[i+7])/3,h=waterfrontGroundAt(d,x,z);assert.notEqual(h,null,'No road surface over missing terrain or mapped water');assert.ok(Math.abs(y-h-.035)<.003,'Road width must follow terrain rather than centreline height');}
 for(const bad of [[],[0,0,0],Array(9).fill(NaN)])assert.throws(()=>validateWaterfront({...d,roadVertices:bad}));
 const r=waterfrontScene(new THREE.Scene(),d);assert.equal(r.group.getObjectByName('terrainDrapedRoads').geometry.attributes.position.count,v.length/3);r.dispose();
});

test('Crossing paint stays on source-flagged road overlaps, follows terrain and does not cover paving',()=>{
 const road={groundVertices:d.roadVertices},paving={groundVertices:d.pavingVertices},v=d.crossingVertices;
 assert.ok(d.crossingSourceIds.length>0);assert.equal(new Set(d.crossingSourceIds).size,d.crossingSourceIds.length);
 for(const id of d.crossingSourceIds)assert.ok(d.paths.some(p=>p.id===id&&p.crosswalk));
 for(let i=0;i<v.length;i+=9){const x=(v[i]+v[i+3]+v[i+6])/3,z=(v[i+2]+v[i+5]+v[i+8])/3,y=(v[i+1]+v[i+4]+v[i+7])/3,h=waterfrontGroundAt(road,x,z);assert.notEqual(h,null,'Paint must remain over roads and outside missing terrain/water');assert.ok(Math.abs(y-h-.01)<.003);assert.equal(waterfrontGroundAt(paving,x,z),null,'Crossing must not look like a sidewalk carpet over road');}
 for(const bad of [{...d,crossingVertices:[NaN]},{...d,crossingSourceIds:[-1]}])assert.throws(()=>validateWaterfront(bad));
 const r=waterfrontScene(new THREE.Scene(),d);assert.equal(r.group.getObjectByName('terrainDrapedCrossings').geometry.attributes.position.count,v.length/3);r.dispose();
});

import {shorelineClosure} from '../../client/src/toronto/shoreline.js';
test('Shoreline closure preserves terrain tops and only joins supported mapped edges to illustrative water',()=>{
 const original=JSON.stringify(d),r=shorelineClosure(d);assert.equal(r.positions.length/3,4728);assert.equal(r.omitted,0);assert.deepEqual(shorelineClosure(d),r);assert.equal(JSON.stringify(d),original);
 const source=new Set();for(let i=0;i<d.groundVertices.length;i+=3)source.add(d.groundVertices.slice(i,i+3).join(','));
 for(let i=0;i<r.positions.length;i+=18){const [a,b,c,e,f,g]=[0,3,6,9,12,15].map(j=>r.positions.slice(i+j,i+j+3));assert.ok(source.has(a.join(','))&&source.has(b.join(',')));assert.deepEqual(e,b);assert.deepEqual(g,c);assert.deepEqual(c,[a[0],d.waterLevel,a[2]]);assert.deepEqual(f,[b[0],d.waterLevel,b[2]]);assert.ok(a[1]>c[1]&&b[1]>f[1]);}
 const fixture={groundVertices:[0,76,0,2,77,0,0,76,2],waterLevel:74.5,water:[{rings:[[[0,0],[2,0],[2,-2],[0,-2],[0,0]]]}]};
 assert.equal(shorelineClosure(fixture).positions.length,18);
 assert.equal(shorelineClosure({...fixture,water:[]}).positions.length,0,'No closure across an unmapped edge');
 assert.equal(shorelineClosure({...fixture,waterLevel:78}).positions.length,0,'Never extrude upward to cover submerged terrain');
 assert.equal(shorelineClosure({...fixture,waterLevel:70}).positions.length,0,'Unsupported height gap omitted');
 assert.equal(shorelineClosure({...fixture,groundVertices:[...fixture.groundVertices,2,77,0,0,76,0,2,77,2]}).positions.length,0,'Shared triangle edge is not an exposed boundary');
 const scene=new THREE.Scene(),render=waterfrontScene(scene,d),edge=render.group.getObjectByName('illustrativeShorelineClosure');assert.equal(edge.geometry.attributes.position.count,4728);let disposed=false;edge.geometry.addEventListener('dispose',()=>disposed=true);render.dispose();assert.ok(disposed);assert.equal(scene.children.length,0);
});


test('Walking daylight fill is bounded, shadow-free and owned by the removable waterfront group',()=>{
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(0xfff2e2,3.5);scene.add(sun);const r=waterfrontScene(scene,d),fill=r.group.getObjectByName('waterfrontDaylightFill');
 assert.ok(fill.isHemisphereLight);assert.equal(fill.intensity,.85);assert.equal(fill.castShadow,false);assert.equal(fill.parent,r.group);assert.equal(sun.intensity,3.5);
 r.group.visible=false;const visible=[];scene.traverseVisible(o=>{if(o.isLight)visible.push(o);});assert.deepEqual(visible,[sun]);r.group.visible=true;assert.equal(fill.intensity,.85);r.dispose();assert.deepEqual(scene.children,[sun]);
});


test('Filtered paving preserves source geometry and uses independent reversible diagnostic uniforms',()=>{
 const a=waterfrontScene(new THREE.Scene(),d),b=waterfrontScene(new THREE.Scene(),d),mesh=a.group.getObjectByName('terrainDrapedSidewalks'),material=mesh.material,uniform=material.userData.filteredJoints;
 assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),Array.from(new Float32Array(d.pavingVertices)));assert.equal(material.map,null);assert.equal(material.roughness,1);assert.equal(uniform.value,1);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};material.onBeforeCompile(shader);assert.equal(shader.uniforms.pavingFiltered,uniform);uniform.value=0;assert.equal(b.group.getObjectByName('terrainDrapedSidewalks').material.userData.filteredJoints.value,1);uniform.value=1;a.dispose();b.dispose();
});


import {canopyGeometry,trunkContactDrop} from '../../client/src/toronto/vegetation.js';
test('Illustrative crowns retain triangle budget, deterministic shape, smooth seams and source positions',()=>{
 const a=canopyGeometry(),b=canopyGeometry(),legacy=canopyGeometry({shaped:false});assert.equal(a.index.count/3,80);assert.equal(a.attributes.position.count,42);assert.equal(a.getAttribute('uv'),undefined);assert.deepEqual(a.attributes.position.array,b.attributes.position.array);assert.notDeepEqual(a.attributes.position.array,legacy.attributes.position.array);
 for(let i=0;i<a.attributes.position.count;i++){const p=a.attributes.position,n=a.attributes.normal;assert.ok(Math.hypot(p.getX(i),p.getY(i),p.getZ(i))<=1.00001);assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);}
 const r=waterfrontScene(new THREE.Scene(),d),crowns=r.group.getObjectByName('illustrativeTreeCrowns'),trunks=r.group.getObjectByName('illustrativeTreeTrunks'),m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();assert.equal(crowns.count,728);assert.equal(trunks.count,728);
 for(let i=0;i<d.trees.length;i++){const [x,y,z]=d.trees[i];crowns.getMatrixAt(i,m);m.decompose(p,q,scale);assert.ok(p.distanceTo(new THREE.Vector3(x,y+5.4,z))<.001);assert.ok(Math.abs(scale.x-(2.6+d.treeStyleIds[i]%5*.22))<1e-5);trunks.getMatrixAt(i,m);m.decompose(p,q,scale);assert.ok(p.distanceTo(new THREE.Vector3(x,y+1.9-trunkContactDrop([x,y,z],(x,z)=>waterfrontGroundAt(d,x,z))/2,z))<.001);assert.ok(q.angleTo(new THREE.Quaternion())<1e-5);}
 assert.equal(crowns.geometry.index.count*crowns.count/3,58240);a.dispose();b.dispose();legacy.dispose();r.dispose();
});


test('Trunk contact closes small downhill gaps without moving source tops or crossing missing terrain',()=>{
 assert.equal(trunkContactDrop([0,76,0],()=>76),0);assert.ok(Math.abs(trunkContactDrop([0,76,0],(x,z)=>76+z*.4)-.122)<1e-6);
 assert.equal(trunkContactDrop([0,76,0],()=>null),0);assert.equal(trunkContactDrop([0,76,0],(x,z)=>z>.1?null:76),0);assert.equal(trunkContactDrop([0,76,0],(x,z)=>76+z*2),0);assert.equal(trunkContactDrop([0,76,0],()=>75),0);
 const r=waterfrontScene(new THREE.Scene(),d),t=r.group.getObjectByName('illustrativeTreeTrunks'),m=new THREE.Matrix4();let adjusted=0;
 for(let i=0;i<d.trees.length;i++){const [x,y,z]=d.trees[i],drop=trunkContactDrop(d.trees[i],(x,z)=>waterfrontGroundAt(d,x,z));t.getMatrixAt(i,m);const top=new THREE.Vector3(0,1.9,0).applyMatrix4(m);assert.ok(top.distanceTo(new THREE.Vector3(x,y+3.8,z))<.001);if(drop){adjusted++;assert.ok(drop<=.25);for(let k=0;k<6;k++){const a=k*Math.PI/3,b=new THREE.Vector3(.28*Math.sin(a),-1.9,.28*Math.cos(a)).applyMatrix4(m);assert.ok(b.y<waterfrontGroundAt(d,b.x,b.z)+.001);}}}
 assert.ok(adjusted>0);assert.equal(t.count,728);assert.equal(t.geometry.index.count/3,24);r.dispose();
});
