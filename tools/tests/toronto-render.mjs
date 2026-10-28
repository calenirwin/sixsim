import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportTorontoTracks } from '../toronto/renderTracks.mjs';
import { readTracks } from '../../core/tracks/format.mjs';
import { parseTracks } from '../../client/src/replay/coreReplay.js';
import { torontoWorld } from '../../core/sim/toronto.mjs';
import { supportsRemoteRenderer, NYC_RENDERING } from '../../core/sim/renderCapabilities.mjs';
import { localFrame } from '../../client/src/shared/localFrame.js';
test('scheduled world -> ATRK -> browser reader preserves identity, coordinates and provenance',async()=>{
 const result=await exportTorontoTracks(), native=readTracks(result.file), bytes=fs.readFileSync(result.file);
 const browser=parseTracks(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.equal(browser.header.startSeconds,28800);
 assert.equal(browser.frames.length,301);assert.equal(browser.header.basis,'schedule-derived');
 assert.deepEqual(browser.header.provenance,result.header.provenance);
 const {world:W}=await torontoWorld();
 const frame=localFrame(result.header.profile.geoOrigin);
 for(const i of [0,60,300]) {
   if(i>W.simTime)await W.step(i-W.simTime);
   for(const a of W.transit.actors) {
     const id=result.header.actors.find(r=>r.sourceId===a.id).id;
     const decoded=browser.frames[i].veh.find(r=>r.id===id);
     assert.ok(Math.abs(decoded.x-a.x)<0.001 && Math.abs(decoded.z-a.z)<0.001);
     const geo=frame.unproject(decoded.x,decoded.z),expected=frame.unproject(a.x,a.z);
     assert.ok(Math.abs(geo[0]-expected[0])<1e-7 && Math.abs(geo[1]-expected[1])<1e-7);
     assert.equal(decoded.y,0);
     assert.deepEqual(browser.header.transitFrames[i].find(r=>r[0]===id),[id,a.graph.nodeId,a.graph.edgeId,a.graph.progress]);
   }
 }
 assert.deepEqual(browser.frames[60].veh,native.frames[60].veh);
 const before=Buffer.from(bytes);await exportTorontoTracks();assert.deepEqual(fs.readFileSync(result.file),before);
});
test('remote rendering is a map capability, independent of traffic',async()=>{
 const {world:W}=await torontoWorld();assert.equal(supportsRemoteRenderer(W),false);
 W.traffic={pools:{}};assert.equal(supportsRemoteRenderer(W),false);
 assert.equal(supportsRemoteRenderer({traffic:null,renderCapabilities:NYC_RENDERING}),true);
 assert.equal(supportsRemoteRenderer({traffic:{},renderCapabilities:{remoteProtocol:'valdrada.render/0',assetProfile:'toronto-massing-scheduled'}}),false);
 assert.equal(supportsRemoteRenderer({traffic:{}}),false);
});

test('nondefault service start survives native and browser replay round trips',async()=>{
 const startSeconds=90000;
 const result=await exportTorontoTracks({startSeconds}),bytes=fs.readFileSync(result.file),native=readTracks(result.file);
 const browser=parseTracks(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.equal(native.header.startSeconds,startSeconds);assert.equal(browser.header.startSeconds,startSeconds);
 const {world:W}=await torontoWorld({startSeconds});
 for(const i of [0,60,300]){
  if(i>W.simTime)await W.step(i-W.simTime);
  assert.equal(browser.header.startSeconds+browser.header.simTime[i],W.transit.serviceSeconds);
  assert.ok(W.transit.actors.length>0);assert.equal(browser.frames[i].veh.length,W.transit.actors.length);
  for(const actor of W.transit.actors){
   const id=browser.header.actors.find(a=>a.sourceId===actor.id).id,decoded=browser.frames[i].veh.find(a=>a.id===id);
   assert.ok(Math.hypot(decoded.x-actor.x,decoded.z-actor.z)<.001);
   assert.deepEqual(browser.header.transitFrames[i].find(r=>r[0]===id),[id,actor.graph.nodeId,actor.graph.edgeId,actor.graph.progress]);
  }
 }
 await exportTorontoTracks();
});

test('paired recordings preserve world state and can replace an inherited replay session',async()=>{
 const {exportTorontoComparison}=await import('../toronto/renderTracks.mjs');
 const {recordingSession,assertComparable}=await import('../../client/src/toronto/recordingSession.js');
 const {ENV}=await import('../../client/src/world/materials.js');
 const {baseline,dwell}=await exportTorontoComparison();
 assertComparable(baseline.header,dwell.header);
 for(const changed of ['startSeconds','serviceDay','transitGraph','provenance']){const bad=structuredClone(dwell.header);bad[changed]=null;assert.throws(()=>assertComparable(baseline.header,bad),/comparison mismatch/);}
 const baselineBytes=fs.readFileSync(baseline.file),dwellBytes=fs.readFileSync(dwell.file);
 await exportTorontoComparison();assert.deepEqual(fs.readFileSync(baseline.file),baselineBytes);assert.deepEqual(fs.readFileSync(dwell.file),dwellBytes);
 const s=recordingSession(dwell,dwell.file,dwell.header.profile),{world:W}=await torontoWorld({scenario:dwell.header.transitScenario});
 await W.step(70);ENV.time.value=70;s.traffic.update(0);s.serviceGraph.update(s.replay.f);
 assert.equal(s.replay.f,70);
 for(const a of W.transit.actors){const id=dwell.header.actors.find(r=>r.sourceId===a.id).id,decoded=dwell.frames[70].veh.find(v=>v.id===id);assert.ok(Math.hypot(decoded.x-a.x,decoded.z-a.z)<.001);assert.deepEqual(s.serviceGraph.occupancy.find(r=>r[0]===id),[id,a.graph.nodeId,a.graph.edgeId,a.graph.progress]);}
 const targetId=dwell.header.actors.find(a=>a.tripId===dwell.header.transitScenario.tripId).id;
 assert.equal(s.serviceGraph.deviations.find(d=>d.actorId===targetId).departureDelaySeconds,60);
 s.dispose();assert.equal(s.group.children.length,0);
 const b=recordingSession(baseline,baseline.file,baseline.header.profile);b.traffic.update(0);b.serviceGraph.update(b.replay.f);
 const baselineId=baseline.header.actors.find(a=>a.tripId===dwell.header.transitScenario.tripId).id;
 assert.ok(b.serviceGraph.occupancy.find(r=>r[0]===baselineId)[2]);assert.equal(b.serviceGraph.deviations.length,0);b.dispose();
});
