import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scheduledTransit } from '../../core/sim/scheduledTransit.mjs';
import { departureComparison,validateDepartures } from '../../client/src/toronto/departures.js';
import { exportTorontoComparison } from '../toronto/renderTracks.mjs';
import { prepare,clock } from '../../client/src/toronto/transit.js';
const data=JSON.parse(fs.readFileSync('client/fixtures/transit/510-20261022.json'));
const scenario=JSON.parse(fs.readFileSync('tools/toronto/scenarios/510-stop-dwell.json'));
const options={geoOrigin:{lat:43.65,lon:-79.397}};
test('source, world and paired replay share departure events and same-pattern predecessor gaps',async()=>{
 const baseline=scheduledTransit(data,options),model=scheduledTransit(data,{...options,scenario}),source=prepare(data);
 const actual=model.departures(scenario.tripId),zero=scheduledTransit(data,{...options,scenario:{...scenario,extraDwellSeconds:0}});
 assert.deepEqual(zero.departures(scenario.tripId),baseline.departures(scenario.tripId));
 for(const r of actual.rows){
  assert.equal(r.baseline.departure,source.trips.find(t=>t.trip_id===scenario.tripId).times[r.stopOccurrence].b);
  assert.equal(r.selected.departure-r.baseline.departure,r.stopOccurrence>=3?60:0);
  if(r.baseline.previous)assert.equal(r.baseline.previous.departure,source.trips.find(t=>t.trip_id===r.baseline.previous.tripId).times[r.stopOccurrence].b);
 }
 assert.deepEqual(actual.rows.slice(3,6).map(r=>[r.baseline.gapSeconds,r.selected.gapSeconds]),[[720,780],[720,780],[720,780]]);
 const previous=actual.rows[3].baseline.previous.tripId;
 assert.deepEqual(model.departures(previous),baseline.departures(previous));
 const next=model.graph.patterns.find(p=>p.id===actual.patternId).tripIds.find(id=>model.departures(id).rows[3].baseline.previous?.tripId===scenario.tripId);
 assert.ok(next);assert.equal(model.departures(next).rows[3].selected.gapSeconds,baseline.departures(next).rows[3].baseline.gapSeconds-60);
 model.update(12345);assert.deepEqual(model.departures(scenario.tripId),actual);
 assert.throws(()=>model.departures('missing'),/unavailable/);
 const pair=await exportTorontoComparison();
 assert.deepEqual(pair.dwell.header.transitDepartures,actual);
 assert.deepEqual(pair.baseline.header.transitDepartures,baseline.departures(scenario.tripId));
 validateDepartures(actual,pair.dwell.header);
 for(const mutate of [v=>v.rows[3].selected.gapSeconds++,v=>v.rows[3].stopId='bad',v=>v.rows[3].baseline.departure='',v=>v.rows[3].selected.departure++,v=>v.rows[3].selected.previous.tripId=v.tripId]){
  const bad=structuredClone(actual);mutate(bad);assert.throws(()=>validateDepartures(bad,pair.dwell.header),/departure comparison/);
 }
});
test('chronological predecessors handle overtaking, ties, midnight and loop occurrences without wrapping',()=>{
 const trips=[['a',86400],['b',86430],['c',86430]].map(([trip_id,b])=>({trip_id,times:[{stop_id:'loop',b},{stop_id:'loop',b:b+100}]}));
 const base={trips,stops:new Map()},graph={serviceDay:'20261022',patterns:[{id:'p',tripIds:['c','b','a']}]};
 const changed={...base,trips:trips.map(t=>t.trip_id==='a'?{...t,times:t.times.map(s=>({...s,b:s.b+60}))}:t)};
 const a=departureComparison(base,changed,graph,'a');assert.equal(a.rows[0].baseline.gapSeconds,null);assert.equal(a.rows[0].selected.previous.tripId,'c');assert.equal(a.rows[0].selected.gapSeconds,30);
 assert.equal(clock(a.rows[1].selected.departure),'24:02:40');assert.equal(a.rows[1].stopOccurrence,1);
 const c=departureComparison(base,changed,graph,'c');assert.equal(c.rows[0].baseline.previous.tripId,'b');assert.equal(c.rows[0].baseline.gapSeconds,0);
 const b=departureComparison(base,changed,graph,'b');assert.equal(b.rows[0].selected.previous,null);
});
