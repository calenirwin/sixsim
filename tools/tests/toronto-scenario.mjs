import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepare } from '../../client/src/toronto/transit.js';
import { scheduledTransit } from '../../core/sim/scheduledTransit.mjs';
import { applyTransitScenario } from '../../core/sim/transitScenario.mjs';
import { buildServiceGraph,graphPosition } from '../../client/src/toronto/serviceGraph.js';
import { exportTorontoTracks } from '../toronto/renderTracks.mjs';
import { addServiceGraph } from '../../client/src/toronto/serviceGraphScene.js';
import * as THREE from 'three';
const data=JSON.parse(fs.readFileSync('client/fixtures/transit/510-20261022.json'));
const scenario=JSON.parse(fs.readFileSync('tools/toronto/scenarios/510-stop-dwell.json'));
const options={geoOrigin:{lat:43.65,lon:-79.397},startSeconds:0},schedule=prepare(data),trip=schedule.trips.find(t=>t.trip_id===scenario.tripId);
test('targeted dwell propagates exactly 60 seconds without changing other trips, routes or travel',()=>{
 const baseline=scheduledTransit(data,options),delayed=scheduledTransit(data,{...options,scenario}),zero=scheduledTransit(data,{...options,scenario:{...scenario,extraDwellSeconds:0}});
 assert.deepEqual(delayed.graph,baseline.graph);assert.ok(Object.isFrozen(delayed.scenario));
 const source=trip.times[scenario.stopOccurrence];
 for(const t of [source.a-1,source.a,source.b,source.b+30,source.b+60,source.b+61,trip.times.at(-1).b,trip.times.at(-1).b+30,trip.times.at(-1).b+60,trip.times.at(-1).b+61]){
  baseline.update(t);delayed.update(t);zero.update(t);
  assert.deepEqual(zero.actors,baseline.actors);
  assert.deepEqual(delayed.actors.filter(a=>a.tripId!==scenario.tripId),baseline.actors.filter(a=>a.tripId!==scenario.tripId));
 }
 delayed.update(source.b+30);const held=delayed.actors.find(a=>a.tripId===scenario.tripId);assert.equal(held.graph.phase,'dwell');assert.equal(held.scheduleDeviation.stopOccurrence,3);
 delayed.update(trip.times.at(-1).b+30);assert.ok(delayed.actors.some(a=>a.tripId===scenario.tripId));
 delayed.update(trip.times.at(-1).b+61);assert.ok(!delayed.actors.some(a=>a.tripId===scenario.tripId));
 for(let i=0;i<trip.times.length;i++){const d=delayed.deviations[i];assert.equal(d.arrivalDelaySeconds,i>3?60:0);assert.equal(d.departureDelaySeconds,i>=3?60:0);}
 for(const stop of trip.times.slice(4)){baseline.update(stop.a);delayed.update(stop.a+60);const a=baseline.actors.find(a=>a.tripId===scenario.tripId),b=delayed.actors.find(a=>a.tripId===scenario.tripId);assert.deepEqual(b.graph,a.graph);assert.deepEqual([b.x,b.z],[a.x,a.z]);}
 const a=applyTransitScenario(schedule,data.service_day,scenario).schedule.trips.find(t=>t.trip_id===scenario.tripId);
 for(let i=1;i<a.times.length;i++)assert.equal(a.times[i].a-a.times[i-1].b,trip.times[i].a-trip.times[i-1].b);
 const stepped=scheduledTransit(data,{...options,scenario});
 for(let t=28800;t<=29100;t++)stepped.update(t);delayed.update(29100);assert.deepEqual(stepped.actors,delayed.actors);
 delayed.update(28800);delayed.update(29100);assert.deepEqual(stepped.actors,delayed.actors);
 // At the dwell boundary both sides converge to the same node; no position jump.
 delayed.update(source.b+60);const before=delayed.actors.find(a=>a.tripId===scenario.tripId);
 delayed.update(source.b+60+.00001);const after=delayed.actors.find(a=>a.tripId===scenario.tripId);
 assert.ok(Math.hypot(before.x-after.x,before.z-after.z)<.01);
});
test('invalid scenario targets and durations fail closed, inputs are copied',()=>{
 for(const change of [{tripId:'missing'},{stopOccurrence:-1},{stopOccurrence:999},{stopOccurrence:1.5},{stopId:'missing'},{serviceDay:'20261023'},{extraDwellSeconds:-1},{extraDwellSeconds:NaN},{extraDwellSeconds:'60'},{extraDwellSeconds:61},{recovery:true}])assert.throws(()=>scheduledTransit(data,{...options,scenario:{...scenario,...change}}),/scenario|target/);
 const input={...scenario},model=scheduledTransit(data,{...options,scenario:input});input.extraDwellSeconds=0;assert.equal(model.scenario.extraDwellSeconds,60);
});
test('repeated-stop loop after midnight retains distinct occurrences and delayed final dwell',()=>{
 const trip={trip_id:'loop',route_id:'r',shape_id:'s',times:[{stop_id:'a',d:0,a:86400,b:86410},{stop_id:'b',d:10,a:86420,b:86430},{stop_id:'a',d:20,a:86440,b:86450}],shape:[{d:0,lon:0,lat:0},{d:10,lon:.001,lat:0},{d:20,lon:0,lat:0}]};
 const s={trips:[trip],stops:new Map([['a',{stop_lon:0,stop_lat:0}],['b',{stop_lon:.001,stop_lat:0}]])};
 for(const occurrence of [0,2]){
  const result=applyTransitScenario(s,'20261022',{...scenario,tripId:'loop',stopOccurrence:occurrence,stopId:'a'});
  const c=buildServiceGraph(result.schedule,{geoOrigin:{lat:0,lon:0}});
  const p=graphPosition(c,'loop',86500);assert.equal(p.phase,'dwell');assert.equal(p.nodeId,c.graph.patterns[0].nodeIds[2]);assert.equal(graphPosition(c,'loop',86511),null);
 }
});
test('scenario replay preserves world graph, identity, deviations and occupancy',async()=>{
 const result=await exportTorontoTracks({scenario});
 assert.deepEqual(result.header.transitScenario,scenario);assert.equal(result.header.transitDeviations[3].departureDelaySeconds,60);
 const scene=addServiceGraph(new THREE.Scene(),{header:result.header,frames:result.frames},options);
 scene.update(70);const id=result.header.actors.find(a=>a.tripId===scenario.tripId).id;
 assert.equal(scene.deviations[0].departureDelaySeconds,60);
 const model=scheduledTransit(data,{...options,startSeconds:28800,scenario});model.update(70);
 const {actorId,...deviation}=scene.deviations[0];assert.deepEqual(deviation,model.actors.find(a=>a.tripId===scenario.tripId).scheduleDeviation);
 const corrupt=structuredClone(result.header);corrupt.transitDeviations[4].arrivalDelaySeconds=0;
 assert.throws(()=>addServiceGraph(new THREE.Scene(),{header:corrupt,frames:result.frames},options),/scenario replay/);
 const row=scene.occupancy.find(r=>r[0]===id);assert.ok(row[1]);assert.equal(row[2],null);
 const bytes=fs.readFileSync(result.file);await exportTorontoTracks({scenario});assert.deepEqual(fs.readFileSync(result.file),bytes);
 await exportTorontoTracks({scenario:null});
});
