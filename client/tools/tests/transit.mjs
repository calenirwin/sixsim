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
 assert.equal(data.trips.length,378);assert.equal(data.stops.length,34);assert.equal(model.shapes.size,7);
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
