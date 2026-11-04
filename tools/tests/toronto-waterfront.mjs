import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import * as THREE from 'three';
import {validateWaterfront,walkPose,waterfrontScene,waterfrontGroundAt} from '../../client/src/toronto/waterfront.js';
const bytes=fs.readFileSync('client/fixtures/toronto/waterfront/scene.json'),d=JSON.parse(bytes),p=JSON.parse(fs.readFileSync('client/fixtures/toronto/waterfront/provenance.json'));
test('Pinned waterfront budgets, original source IDs and continuous path remain reproducible',()=>{
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.sha256);assert.equal(bytes.length,p.bytes);assert.equal(validateWaterfront(d),d);assert.equal(d.groundVertices.length/9,13181);assert.equal(d.trees.length,729);assert.equal(d.sourceRoute.length,15);assert.ok(d.maxJoinM<.02);assert.ok(d.lengthM>1100&&d.lengthM<1102);
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
 const scene=new THREE.Scene(),r=waterfrontScene(scene,d);assert.equal(r.group.userData.trees,729);assert.ok(r.group.children.length<20);r.dispose();assert.equal(scene.children.length,0);
});

test('Full-width paving follows original terrain and continuously covers the guided route',()=>{
 // Spatial index keeps checks bounded without substituting nearest-height interpolation.
 const index=vertices=>{const cells=new Map();for(let i=0;i<vertices.length;i+=9){const t=vertices.slice(i,i+9),xs=[t[0],t[3],t[6]],zs=[t[2],t[5],t[8]];for(let x=Math.floor(Math.min(...xs)/20);x<=Math.floor(Math.max(...xs)/20);x++)for(let z=Math.floor(Math.min(...zs)/20);z<=Math.floor(Math.max(...zs)/20);z++){const key=`${x}_${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(t);}}return (x,z)=>{for(const t of cells.get(`${Math.floor(x/20)}_${Math.floor(z/20)}`)||[]){const [ax,ay,az,bx,by,bz,cx,cy,cz]=t,den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;if(u>=-1e-5&&v>=-1e-5&&u+v<=1+1e-5)return u*ay+v*by+(1-u-v)*cy;}return null;};};
 const ground=index(d.groundVertices),paving=index(d.pavingVertices);
 assert.ok(d.pavingVertices.length>0&&d.pavingVertices.length<1500000);
 // Every triangle centroid, including outer edges of bends, must match the source TIN.
 for(let i=0;i<d.pavingVertices.length;i+=9){const v=d.pavingVertices,x=(v[i]+v[i+3]+v[i+6])/3,z=(v[i+2]+v[i+5]+v[i+8])/3,y=(v[i+1]+v[i+4]+v[i+7])/3,h=ground(x,z);assert.notEqual(h,null,'No paving over missing terrain or mapped water');assert.ok(Math.abs(y-h-.06)<.003,'Paving must follow TIN across its width');}
 for(let distance=0;distance<d.lengthM;distance+=.5){const {position:[x,y,z]}=walkPose(d,distance),h=paving(x,z);assert.notEqual(h,null,`Paving gap at ${distance} m`);assert.ok(Math.abs(y-1.65-h-.04)<.04,'Walking eye remains above continuous paving');}
 const scene=new THREE.Scene(),r=waterfrontScene(scene,d);assert.equal(r.group.getObjectByName('terrainDrapedSidewalks').geometry.attributes.position.count,d.pavingVertices.length/3);r.dispose();
});

test('Missing terrain is explicit and walking never falls back to route heights',()=>{assert.equal(waterfrontGroundAt(d,100000,100000),null);assert.throws(()=>waterfrontGroundAt(d,NaN,0));assert.throws(()=>waterfrontGroundAt({groundVertices:[1e9,0,0,0,0,0,0,0,1]},0,0),/bounds/);assert.throws(()=>walkPose({...d,groundVertices:[]},0),/outside available terrain/);});
