import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {prepare,position,serviceSeconds,clock} from '../../src/toronto/transit.js';
import {localFrame} from '../../src/shared/localFrame.js';
import {PROFILE} from '../../src/toronto/profile.js';
const bytes=fs.readFileSync(new URL('../../fixtures/transit/510-20261022.json',import.meta.url));
const data=JSON.parse(bytes),model=prepare(data);
test('pinned source, route, service selection and referential integrity',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../../fixtures/transit/provenance.json',import.meta.url)));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),p.subset_sha256);
 assert.equal(data.source_sha256,p.source_sha256);assert.equal(data.routes[0].route_type,'0');
 assert.equal(data.trips.length,378);assert.equal(data.stops.length,36);assert.equal(model.shapes.size,7);
 for(const s of data.stops) if(s.parent_station) assert.ok(model.stops.has(s.parent_station));
 for(const t of model.trips){assert.equal(t.route_id,'510');assert.equal(t.service_id,'1');assert.ok(t.shape);assert.ok(data.calendar.some(c=>c.service_id===t.service_id&&c.thursday==='1'));}
});
test('service-day midnight and shape interpolation with dwell',()=>{
 assert.equal(serviceSeconds('25:47:00'),92820);assert.equal(clock(92820),'25:47:00');assert.throws(()=>serviceSeconds('24:60:00'));
 const t={times:[{a:86340,b:86400,d:0},{a:86520,b:86580,d:100}],shape:[{d:0,lon:0,lat:0},{d:100,lon:10,lat:20}]};
 assert.deepEqual(position(t,86370),[0,0]);assert.deepEqual(position(t,86460),[5,10]);assert.deepEqual(position(t,86550),[10,20]);assert.equal(position(t,86581),null);assert.equal(position({...t,shape:null},86460),null);
});
test('published geometry aligns with Toronto frame and beyond-midnight trips remain active',()=>{
 const project=localFrame(PROFILE.geoOrigin).project;
 const s=data.stops.find(s=>s.stop_name==='Spadina Ave at Queen St West North Side');
 const [x,z]=project(+s.stop_lon,+s.stop_lat);assert.ok(x>0&&x<60&&z>50&&z<120);
 assert.ok(model.trips.some(t=>position(t,25*3600)));assert.equal(model.trips.filter(t=>position(t,30*3600)).length,0);
 for(const t of model.trips){for(const time of t.times){const p=position(t,time.a);assert.ok(p&&p.every(Number.isFinite));}}
});
test('missing shapes are explicit, invalid schedules fail closed',()=>{
 const missing=prepare({...data,shapes:[]});assert.ok(missing.trips.every(t=>t.shape===null));
 assert.throws(()=>prepare({...data,stops:[]}));assert.throws(()=>prepare({...data,timezone:'UTC'}));
});

function numericFixture() {
 return {version:1,timezone:'America/Toronto',stops:[{stop_id:'a',stop_lon:'0',stop_lat:'0'},{stop_id:'b',stop_lon:'1',stop_lat:'1'}],shapes:[
  {shape_id:'s',shape_pt_sequence:'0',shape_dist_traveled:'0',shape_pt_lon:'0',shape_pt_lat:'0'},
  {shape_id:'s',shape_pt_sequence:'1',shape_dist_traveled:'100',shape_pt_lon:'1',shape_pt_lat:'1'}],
  trips:[{trip_id:'t',shape_id:'s'}],stop_times:[
   {trip_id:'t',stop_id:'a',stop_sequence:'0',arrival_time:'00:00:00',departure_time:'00:00:00',shape_dist_traveled:'0'},
   {trip_id:'t',stop_id:'b',stop_sequence:'1',arrival_time:'00:01:00',departure_time:'00:01:00',shape_dist_traveled:'100'}]};
}
const missingNumbers=['',' \t ',null,undefined,false,'NaN','Infinity',Infinity];
test('malformed numeric shape fields omit the entire shape and never invent a position',()=>{
 for(const field of ['shape_dist_traveled','shape_pt_lon','shape_pt_lat','shape_pt_sequence']) for(const value of missingNumbers) {
  const fixture=numericFixture();fixture.shapes[0][field]=value;
  const result=prepare(fixture);
  assert.equal(result.shapes.size,0,`${field}: ${String(value)}`);
  assert.equal(result.trips[0].shape,null);
  assert.equal(position(result.trips[0],30),null);
 }
});
test('valid string and numeric zero distances/coordinates/sequences remain usable',()=>{
 for(const zero of ['0',0]) {
  const fixture=numericFixture();
  Object.assign(fixture.shapes[0],{shape_dist_traveled:zero,shape_pt_lon:zero,shape_pt_lat:zero,shape_pt_sequence:zero});
  Object.assign(fixture.stop_times[0],{shape_dist_traveled:zero,stop_sequence:zero});
  const trip=prepare(fixture).trips[0];
  assert.ok(trip.shape);assert.equal(trip.times[0].d,0);
  assert.deepEqual(position(trip,0),[0,0]);assert.deepEqual(position(trip,30),[0.5,0.5]);
 }
});
test('analogous stop distance, sequence and coordinate coercions fail closed',()=>{
 for(const value of missingNumbers) {
  let fixture=numericFixture();fixture.stop_times[0].shape_dist_traveled=value;
  assert.equal(position(prepare(fixture).trips[0],30),null);
  fixture=numericFixture();fixture.stop_times[0].stop_sequence=value;
  assert.throws(()=>prepare(fixture),/Invalid trip times/);
  for(const field of ['stop_lon','stop_lat']) {
   fixture=numericFixture();fixture.stops[0][field]=value;
   assert.throws(()=>prepare(fixture),/Invalid stop coordinates/);
  }
 }
 assert.equal(position(prepare(numericFixture()).trips[0],NaN),null);
 assert.throws(()=>serviceSeconds('9'.repeat(400)+':00:00'),/Invalid service time/);
});
