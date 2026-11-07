import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as THREE from 'three';
import {nextNodeAccess,validateNextNodeAccess} from '../../client/src/toronto/nextNodeAccess.js';import {torontoWorld} from '../../core/sim/toronto.mjs';import {exportTorontoTracks} from '../toronto/renderTracks.mjs';import {addSharedJunction} from '../../client/src/toronto/sharedJunctionScene.js';
const read=f=>JSON.parse(fs.readFileSync(f)),source=read('client/fixtures/toronto/next-node-access.json');
test('complete pinned incident records support direction/connectivity, not admission',()=>{
 const graph=read('client/fixtures/toronto/city-roads/graph.json'),contract=nextNodeAccess();assert.equal(contract.mayAdvance,false);assert.equal(contract.permission,'unknown');
 for(const n of source.nodes){assert.deepEqual(n.records.map(e=>e.id).sort((a,b)=>a-b),graph.edges.filter(e=>e[1]===n.nodeId||e[2]===n.nodeId).map(e=>e[0]).sort((a,b)=>a-b));for(const e of n.records){const g=graph.edges.find(r=>r[0]===e.id);assert.deepEqual([e.fromNode,e.toNode,e.rawDirection??0],g.slice(1,4));assert.deepEqual(e.points[0],graph.nodes.find(n=>n[0]===e.fromNode).slice(1));assert.deepEqual(e.points.at(-1),graph.nodes.find(n=>n[0]===e.toNode).slice(1));}}
 assert.deepEqual(contract.nodes.map(n=>n.movements.filter(m=>m.topologyCandidate).map(m=>m.edgeId)),[[8457327,8457366],[7553950,20053388]]);
 const bathurst=contract.nodes[0],stewart=bathurst.movements.find(m=>m.edgeId===8457327);assert.equal(stewart.orientation,'reverse');assert.equal(stewart.directionSupported,true);assert.equal(bathurst.movements.find(m=>m.edgeId===1146640).returnOnIncomingEdge,true);
 const wellington=contract.nodes[1];assert.deepEqual(wellington.movements.filter(m=>!m.directionSupported).map(m=>m.edgeId),[1146774,8491785]);
 assert.ok(contract.nodes.every(n=>!n.mayAdvance&&n.holdReason==='next-node-permission-unverified'&&n.movements.every(m=>m.permission==='unknown'&&!m.mayAdvance)));
});
test('malformed geometry/direction and forged permission evidence fail closed',()=>{
 for(const mutate of [d=>d.nodes[0].records[0].rawDirection='',d=>d.nodes[0].records[0].directionDescription='Follow-Digitization',d=>d.nodes[0].records[0].points[0][0]='',d=>d.nodes[0].coordinate[0]+=.001,d=>d.nodes[0].records.push(d.nodes[0].records[0]),d=>d.nodes[0].records[0].fromNode=0]){const d=structuredClone(source);mutate(d);assert.throws(()=>nextNodeAccess(d));}
 const c=nextNodeAccess();c.nodes[0].movements[0].mayAdvance=true;assert.throws(()=>validateNextNodeAccess(c),/mismatch/);const changed=nextNodeAccess();changed.nodes[0].movements.pop();assert.throws(()=>validateNextNodeAccess(changed));assert.deepEqual(validateNextNodeAccess(nextNodeAccess()),nextNodeAccess());
});
test('world and replay carry identical access evidence without changing travel or legacy behavior',async()=>{
 const {world:w}=await torontoWorld(),expected=nextNodeAccess();assert.deepEqual(w.nextNodeAccess,expected);w.nextNodeAccess.nodes.pop();assert.deepEqual(w.nextNodeAccess,expected);await w.step(150);assert.ok(w.junctionProbes.state.probes.every(p=>p.phase==='held-before-next-junction'&&p.junctionCrossings===1));
 const r=await exportTorontoTracks(),scene=new THREE.Scene(),replay=addSharedJunction(scene,r);assert.deepEqual(replay.access,expected);replay.update(150);assert.deepEqual(replay.current,w.junctionProbes.state);replay.dispose();
 const bad=structuredClone(r.header);bad.sharedJunction.nextNodeAccess.nodes[0].mayAdvance=true;assert.throws(()=>addSharedJunction(scene,{header:bad,frames:r.frames}),/mismatch/);assert.equal(scene.children.length,0);
 const legacy=structuredClone(r.header);delete legacy.sharedJunction.nextNodeAccess;const old=addSharedJunction(scene,{header:legacy,frames:r.frames});assert.equal(old.access,null);old.update(150);assert.deepEqual(old.current,w.junctionProbes.state);old.dispose();
 const scenario=read('tools/toronto/scenarios/510-stop-dwell.json'),{world:d}=await torontoWorld({scenario});assert.deepEqual(d.nextNodeAccess,w.nextNodeAccess);await d.step(150);assert.deepEqual(d.junctionProbes.state,w.junctionProbes.state);
});
