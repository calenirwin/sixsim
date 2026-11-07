import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as THREE from 'three';
import {sharedJunction} from '../../client/src/toronto/sharedJunction.js';import {torontoWorld} from '../../core/sim/toronto.mjs';import {exportTorontoTracks} from '../toronto/renderTracks.mjs';import {addSharedJunction} from '../../client/src/toronto/sharedJunctionScene.js';
const read=f=>JSON.parse(fs.readFileSync(f)),d=read('client/fixtures/toronto/shared-junction.json'),p=read('tools/toronto/scenarios/shared-junction-arrivals.json'),make=(q=p)=>sharedJunction(d,q);
test('six FIFO requests reuse released exit slots without overlapping reservations',()=>{
 const m=make();assert.deepEqual(m.reservations.map(r=>[r.grantSeconds,r.clearSeconds,r.dischargeSeconds]),[[20,24,32],[24,28,36],[32,36,44],[36,40,48],[44,48,56],[48,52,60]]);
 assert.deepEqual(make({...p,arrivals:[...p.arrivals].reverse()}).reservations,m.reservations);
 for(let t=0;t<=70;t+=.125){const s=m.at(t);assert.ok(s.probes.filter(a=>a.phase==='reserved').length<=1);for(const e of s.downstream)assert.equal(e.available+Number(e.initialOccupied)+e.reservedIds.length+e.occupiedIds.length,1);const ranks=s.queue.map(q=>m.reservations.findIndex(r=>r.id===q.id));assert.deepEqual(ranks,[...ranks].sort((a,b)=>a-b));}
 const before=m.at(32-1e-8),after=m.at(32);assert.equal(before.downstream.find(e=>e.edgeId===1146640).occupiedIds[0],'bathurst-probe');assert.deepEqual(after.downstream.find(e=>e.edgeId===1146640).reservedIds,['bathurst-probe-2']);assert.equal(after.probes.find(a=>a.id==='bathurst-probe').present,false);assert.equal(after.probes.find(a=>a.id==='bathurst-probe').phase,'discharged');
 const final=m.at(60);assert.equal(final.queue.length,0);assert.ok(final.downstream.every(e=>e.available===1));assert.ok(final.probes.every(a=>a.phase==='discharged'&&!a.present));assert.deepEqual(m.at(200000).probes,final.probes);
 for(const r of m.reservations){const a=m.at(r.clearSeconds-2-1e-7).probes.find(a=>a.id===r.id),b=m.at(r.clearSeconds-2+1e-7).probes.find(a=>a.id===r.id);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.000002);}
});
test('permanent occupancy, interrupted windows and zero-delay discharge have explicit boundaries',()=>{
 const q=structuredClone(p);q.downstream['1146640'].dischargeAfterSeconds=null;const m=make(q);assert.deepEqual(m.reservations.map(r=>r.grantSeconds),[20,24,null,null,null,null]);assert.equal(m.at(300).queue.length,4);assert.equal(m.at(300).queue[0].reason,'downstream-full');
 const interrupted=make({...p,interruptions:[[22,26]]});assert.deepEqual(interrupted.reservations.map(r=>r.grantSeconds),[26,30,38,42,50,54]);
 const short=make({...p,windows:[[10,31]]});assert.deepEqual(short.reservations.map(r=>r.grantSeconds),[20,24,null,null,null,null]);assert.equal(short.at(100).queue.length,4);
 const zero=structuredClone(p);for(const e of Object.values(zero.downstream))e.dischargeAfterSeconds=0;assert.deepEqual(make(zero).reservations.map(r=>r.grantSeconds),[20,24,28,32,36,40]);assert.ok(make(zero).at(24).probes.find(a=>a.id==='bathurst-probe').phase==='discharged');
 const late=structuredClone(p);late.arrivals=late.arrivals.map(a=>({...a,startSeconds:a.startSeconds+90000}));late.windows=[[90010,90100]];late.downstream['1146640'].occupiedUntilSeconds=90020;assert.equal(make(late).at(90032).ownerId,'bathurst-probe-2');
});
test('invalid demand/discharge inputs fail closed and legacy v2 snapshots stay stable',()=>{
 for(const mutate of [q=>q.arrivals=[],q=>q.arrivals=Array(33).fill(q.arrivals[0]),q=>q.arrivals[1].id=q.arrivals[0].id,q=>q.arrivals[0].pathId='unknown',q=>q.arrivals[0].startSeconds='0',q=>q.arrivals[0].startSeconds=-1,q=>q.arrivals[0].extra=true,q=>q.downstream['1146640'].dischargeAfterSeconds=-1,q=>q.downstream['1146640'].dischargeAfterSeconds='8',q=>q.downstream['1146640'].dischargeAfterSeconds=Infinity]){const q=structuredClone(p);mutate(q);assert.throws(()=>make(q));}
 const m=make(),expected=m.at(32);m.policy.arrivals.reverse();m.reservations[0].dischargeSeconds=0;m.state.queue.pop();assert.deepEqual(m.at(32),expected);
 const legacy=make(read('tools/toronto/scenarios/shared-junction-queue.json'));assert.deepEqual(legacy.reservations.map(r=>[r.grantSeconds,r.clearSeconds]),[[20,24],[24,28]]);assert.ok(legacy.at(300).probes.every(a=>a.present&&a.phase==='cleared'));assert.equal(legacy.at(300).probes[0].dischargeSeconds,undefined);
});
test('world, API-shaped snapshots, replay markers, seeking and transit variants agree',async()=>{
 const {world:a}=await torontoWorld({sharedAdmission:p}),{world:b}=await torontoWorld({startSeconds:90000,sharedAdmission:p});for(let i=0;i<264;i++)await a.step(.125);await b.step(33);assert.deepEqual(a.junctionProbes.state,b.junctionProbes.state);
 const r=await exportTorontoTracks({sharedAdmission:p}),scene=new THREE.Scene(),replay=addSharedJunction(scene,r);assert.equal(replay.markers.size,6);
 for(const t of [0,10,20,28,32,36,60,300,32,0]){replay.update(t);assert.deepEqual(replay.current,a.junctionProbes.at(t));for(const probe of replay.current.probes)assert.equal(replay.markers.get(probe.id).visible,probe.present);}replay.dispose();assert.equal(scene.children.length,0);
 const bad=structuredClone(r.header);bad.sharedJunctionFrames[32].probes[0].present=true;assert.throws(()=>addSharedJunction(scene,{header:bad,frames:r.frames}),/state mismatch/);
 const scenario=read('tools/toronto/scenarios/510-stop-dwell.json'),{world:c}=await torontoWorld({scenario,sharedAdmission:p});await c.step(33);assert.deepEqual(c.junctionProbes.state,a.junctionProbes.state);
});
