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
