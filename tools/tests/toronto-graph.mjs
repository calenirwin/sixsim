import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepare, position } from '../../client/src/toronto/transit.js';
import { buildServiceGraph, graphPosition } from '../../client/src/toronto/serviceGraph.js';
import { scheduledTransit } from '../../core/sim/scheduledTransit.mjs';
import { localFrame } from '../../client/src/shared/localFrame.js';
import { addServiceGraph } from '../../client/src/toronto/serviceGraphScene.js';
import * as THREE from 'three';
const data=JSON.parse(fs.readFileSync(new URL('../../client/fixtures/transit/510-20261022.json',import.meta.url)));
const options={geoOrigin:{lat:43.65,lon:-79.397},serviceDay:data.service_day,sourceSha256:data.source_sha256};
const schedule=prepare(data),compiled=buildServiceGraph(schedule,options),frame=localFrame(options.geoOrigin);
test('pinned service topology is complete, deterministic and path constrained for the entire service day',()=>{
 assert.equal(compiled.bindings.size,378);assert.equal(compiled.graph.patterns.length,7);assert.deepEqual(compiled.omissions,[]);
 assert.deepEqual(buildServiceGraph({...schedule,trips:[...schedule.trips].reverse()},options).graph,compiled.graph);
 assert.equal(compiled.graph.sourceSha256,data.source_sha256);
 let checks=0,midnight=false;
 for(const trip of schedule.trips)for(let i=0;i<trip.times.length;i++){
  const t=trip.times[i],times=[t.a,t.b];if(i)times.push((trip.times[i-1].b+t.a)/2);
  for(const time of times){
   const p=graphPosition(compiled,trip.trip_id,time),reference=position(trip,time);
   const a=frame.project(p.lon,p.lat),b=frame.project(...reference);
   assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<.001);checks++;midnight ||= time>86400;
   if(p.edgeId){const e=compiled.edgeMap.get(p.edgeId);assert.equal(e.patternId,p.patternId);assert.ok(p.progress>0&&p.progress<1);}
   else assert.equal(compiled.nodeMap.get(p.nodeId).patternId,p.patternId);
  }
 }
 assert.ok(checks>17000&&midnight);
 for(const p of compiled.graph.patterns){
  assert.equal(p.nodeIds.length,p.edgeIds.length+1);
  p.edgeIds.forEach((id,i)=>{const e=compiled.edgeMap.get(id);assert.equal(e.from,p.nodeIds[i]);assert.equal(e.to,p.nodeIds[i+1]);assert.ok(e.lengthMeters>0);});
 }
});
function synthetic(){return {stops:new Map([['a',{stop_lon:0,stop_lat:0}],['b',{stop_lon:.001,stop_lat:0}]]),trips:[{trip_id:'loop',route_id:'r',direction_id:'0',shape_id:'s',shape:[{d:0,lon:0,lat:0},{d:10,lon:.001,lat:0},{d:20,lon:0,lat:0}],times:[{stop_id:'a',d:0,a:86400,b:86410},{stop_id:'b',d:10,a:86420,b:86430},{stop_id:'a',d:20,a:86440,b:86450}]}]};}
const syntheticOptions={geoOrigin:{lat:0,lon:0}};
test('loop occurrences, dwell and midnight boundaries never infer connections or teleport',()=>{
 const c=buildServiceGraph(synthetic(),syntheticOptions);
 assert.notEqual(c.graph.nodes[0].id,c.graph.nodes[2].id);
 for(const t of [86400,86410,86420,86430,86440,86450])assert.equal(graphPosition(c,'loop',t).phase,'dwell');
 assert.equal(graphPosition(c,'loop',86415).progress,.5);
 assert.equal(graphPosition(c,'loop',86399),null);assert.equal(graphPosition(c,'loop',86451),null);
 c.edgeMap.delete(c.graph.edges[0].id);assert.throws(()=>graphPosition(c,'loop',86415),/Disconnected/);
});
test('bad anchors, discontinuous distances and zero-duration links are explicitly omitted',()=>{
 for(const [mutate,reason] of [
  [s=>s.stops.get('b').stop_lat=.1,'stop-off-shape'],
  [s=>s.trips[0].shape.splice(1,0,{d:0,lon:.0005,lat:0}),'discontinuous-shape-distance'],
  [s=>s.trips[0].times[1].a=86410,'nonpositive-link-duration'],
  [s=>s.trips[0].times[1].d=0,'nonpositive-stop-link'],
  [s=>s.trips[0].shape=null,'missing-or-unusable-shape']]){
   const s=synthetic();mutate(s);const c=buildServiceGraph(s,syntheticOptions);
   assert.equal(c.bindings.size,0);assert.equal(c.omissions[0].reason,reason);assert.equal(graphPosition(c,'loop',86415),null);
 }
});
test('world occupancy partitions actors and is independent of step subdivision',()=>{
 const a=scheduledTransit(data,options),b=scheduledTransit(data,options);
 a.update(300);for(let i=1;i<=300;i++)b.update(i);
 assert.deepEqual(a.actors,b.actors);assert.deepEqual(a.occupancy,b.occupancy);
 const occupied=[...a.occupancy.nodes,...a.occupancy.edges].flatMap(x=>x.actorIds).sort();
 assert.deepEqual(occupied,a.actors.map(x=>x.id).sort());
});
test('renderer fails closed on missing or malformed graph occupancy',()=>{
 const graph=compiled.graph,edge=graph.edges[0].id;
 const make=row=>({header:{transitGraph:graph,transitFrames:[row]},frames:[{veh:[{id:0}]}]});
 for(const row of [[],[[0,null,'unknown',.5]],[[0,null,edge,NaN]],[[0,null,edge,.5],[0,null,edge,.5]]])assert.throws(()=>addServiceGraph(new THREE.Scene(),make(row),options),/occupancy/);
 const state=addServiceGraph(new THREE.Scene(),make([[0,null,edge,.5]]),options);state.update(0);assert.equal(state.group.children.filter(x=>x.visible).length,1);
});
