import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import * as THREE from 'three';
import {validateWaterfront,walkPose,waterfrontScene} from '../../client/src/toronto/waterfront.js';
const bytes=fs.readFileSync('client/fixtures/toronto/waterfront/scene.json'),d=JSON.parse(bytes),p=JSON.parse(fs.readFileSync('client/fixtures/toronto/waterfront/provenance.json'));
test('Pinned waterfront budgets, original source IDs and continuous path remain reproducible',()=>{
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.sha256);assert.equal(bytes.length,p.bytes);assert.equal(validateWaterfront(d),d);assert.equal(d.groundVertices.length/9,13181);assert.equal(d.trees.length,729);assert.equal(d.sourceRoute.length,15);assert.ok(d.maxJoinM<.02);assert.ok(d.lengthM>1100&&d.lengthM<1102);
 const inside=(q,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(((a[1]>q[1])!==(b[1]>q[1]))&&(q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]))c=!c;}return c;};
 for(let i=0;i<d.groundVertices.length;i+=9){const v=d.groundVertices,q=[(v[i]+v[i+3]+v[i+6])/3,(v[i+2]+v[i+5]+v[i+8])/3];assert.ok(!d.water.some(w=>inside(q,w.rings[0])&&!w.rings.slice(1).some(r=>inside(q,r))),'Ground must not cover mapped harbour');}
 for(const row of d.walk){const q=[row[1],row[3]];assert.ok(!d.water.some(w=>inside(q,w.rings[0])&&!w.rings.slice(1).some(r=>inside(q,r))),'Walk must not enter mapped water');}
});
test('Eye-level walking clamps endpoints, rejects invalid inputs and preserves source interpolation',()=>{
 assert.equal(walkPose(d,-10).distance,0);assert.equal(walkPose(d,1e6).distance,d.lengthM);assert.throws(()=>walkPose(d,NaN));assert.throws(()=>walkPose(d,1,Infinity));
 for(const row of d.walk.filter((_,i)=>i%50===0)){const pose=walkPose(d,row[0]);assert.ok(Math.abs(pose.position[1]-row[2]-1.65)<1e-8);assert.ok(Math.hypot(pose.position[0]-row[1],pose.position[2]-row[3])<1e-7);const turned=walkPose(d,row[0],Math.PI);assert.deepEqual(turned.position,pose.position);assert.notDeepEqual(turned.target,pose.target);}
 assert.deepEqual(walkPose(d,10+10),walkPose(d,20));
});
test('Malformed assets fail before scene allocation; bounded render resources dispose',()=>{
 for(const mutate of [x=>x.walk[1][0]=0,x=>x.waterLevel=NaN,x=>x.trees[0][1]=null,x=>x.paths[0].points[0][0]=Infinity]){const bad=structuredClone(d);mutate(bad);assert.throws(()=>validateWaterfront(bad));}
 const scene=new THREE.Scene(),r=waterfrontScene(scene,d);assert.equal(r.group.userData.trees,729);assert.ok(r.group.children.length<20);r.dispose();assert.equal(scene.children.length,0);
});
