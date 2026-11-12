import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {sharedJunction} from '../../client/src/toronto/sharedJunction.js';
import {torontoWorld} from '../../core/sim/toronto.mjs';
import {exportTorontoTracks} from '../toronto/renderTracks.mjs';
import {addSharedJunction} from '../../client/src/toronto/sharedJunctionScene.js';
const d=JSON.parse(fs.readFileSync('client/fixtures/toronto/shared-junction.json'));
const p=JSON.parse(fs.readFileSync('tools/toronto/scenarios/shared-junction-queue.json'));
const make=(policy=p)=>sharedJunction(d,policy);
test('persistent FIFO holds behind a full exit and reserves storage before entering',()=>{
 const m=make();assert.deepEqual(m.reservations.map(r=>[r.grantSeconds,r.clearSeconds]),[[20,24],[24,28]]);
 for(const t of [2,10,19.999]){const s=m.at(t);assert.deepEqual(s.queue.map(q=>q.id),['bathurst-probe','wellington-probe']);assert.deepEqual(s.queue.map(q=>q.reason),['downstream-full','queue-order']);assert.equal(s.queue[0].waitSeconds,t-2);assert.equal(s.ownerId,null);}
 assert.equal(m.at(20).ownerId,'bathurst-probe');assert.deepEqual(m.at(20).queue.map(q=>q.reason),['junction-busy']);
 const b=m.at(20).downstream.find(e=>e.edgeId===1146640);assert.equal(b.initialOccupied,false);assert.deepEqual(b.reservedIds,['bathurst-probe']);assert.equal(b.available,0);
 assert.equal(m.at(24).ownerId,'wellington-probe');assert.deepEqual(m.at(28).queue,[]);
 for(let t=0;t<=40;t+=.125){const s=m.at(t);assert.ok(s.probes.filter(a=>a.phase==='reserved').length<=1);for(const e of s.downstream)assert.equal(e.available+Number(e.initialOccupied)+e.reservedIds.length+e.occupiedIds.length,e.capacity);}
 const end=m.at(200000);assert.equal(end.ownerId,null);assert.ok(end.downstream.every(e=>e.occupiedIds.length===1&&e.available===0));assert.deepEqual(end.probes,m.at(28).probes);
 for(const [id,t] of [['bathurst-probe',22],['wellington-probe',26]]){const a=m.at(t-1e-7).probes.find(a=>a.id===id),b=m.at(t+1e-7).probes.find(a=>a.id===id);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.000002);}
});
test('blocked FIFO head, interruptions and insufficient windows never overbook or bypass',()=>{
 const blocked=structuredClone(p);blocked.downstream['1146640'].occupiedUntilSeconds=null;
 const m=make(blocked);assert.ok(m.reservations.every(r=>r.grantSeconds===null));assert.equal(m.at(100).queue.length,2);assert.equal(m.at(100).downstream.find(e=>e.edgeId===8491785).available,1);
 const interrupted=make({...p,interruptions:[[22,26]]});assert.deepEqual(interrupted.reservations.map(r=>r.grantSeconds),[26,30]);
 const short=make({...p,windows:[[10,23]]});assert.ok(short.reservations.every(r=>r.grantSeconds===null));assert.equal(short.at(40).queue.length,2);
 const one=make({...p,windows:[[10,24]]});assert.deepEqual(one.reservations.map(r=>r.grantSeconds),[20,null]);assert.equal(one.at(40).queue[0].reason,'admission-window');
 const midnight=make({...p,windows:[[90000,90010]]});assert.equal(midnight.at(90004).ownerId,'wellington-probe');
});
test('invalid capacity and release inputs fail closed; state and policies cannot mutate queues',()=>{
 for(const value of [-1,'20',NaN,Infinity,172801]){const q=structuredClone(p);q.downstream['1146640'].occupiedUntilSeconds=value;assert.throws(()=>make(q));}
 for(const mutate of [q=>q.downstream['1146640'].capacity=0,q=>q.downstream['1146640'].capacity=2,q=>delete q.downstream['8491785'],q=>q.downstream.extra={},q=>q.downstream['1146640'].extra=true]){const q=structuredClone(p);mutate(q);assert.throws(()=>make(q));}
 const q=structuredClone(p),m=make(q);q.downstream['1146640'].occupiedUntilSeconds=0;m.policy.downstream['1146640'].occupiedUntilSeconds=0;m.at(10).queue.pop();m.state.downstream[0].available=10;assert.equal(m.at(10).queue.length,2);assert.equal(m.reservations[0].grantSeconds,20);
 const legacy=JSON.parse(fs.readFileSync('tools/toronto/scenarios/shared-junction.json'));assert.equal(make(legacy).at(10).queue,undefined);assert.equal(make(legacy).at(10).ownerId,'bathurst-probe');
 const free=structuredClone(p);free.downstream['1146640'].occupiedUntilSeconds=0;for(const t of [0,2,10,12,14,18,300]){const {queue,downstream,...state}=make(free).at(t);assert.deepEqual(state,make(legacy).at(t));}
});
test('world, subdivision, reset, scenario and replay retain queue/capacity identity',async()=>{
 const {world:a}=await torontoWorld(),{world:b}=await torontoWorld({startSeconds:90000});for(let n=0;n<192;n++)await a.step(.125);await b.step(24);assert.deepEqual(a.junctionProbes.state,b.junctionProbes.state);
 const r=await exportTorontoTracks(),scene=new THREE.Scene(),replay=addSharedJunction(scene,r);for(const t of [0,2,10,20,24,28,300,10,0]){replay.update(t);assert.deepEqual(replay.current,a.junctionProbes.at(t));}replay.dispose();
 const bad=structuredClone(r.header);bad.sharedJunctionFrames[10].queue.reverse();assert.throws(()=>addSharedJunction(scene,{header:bad,frames:r.frames}),/state mismatch/);assert.equal(scene.children.length,0);
 const scenario=JSON.parse(fs.readFileSync('tools/toronto/scenarios/510-stop-dwell.json')),{world:c}=await torontoWorld({scenario});await c.step(24);assert.deepEqual(c.junctionProbes.state,a.junctionProbes.state);
});
