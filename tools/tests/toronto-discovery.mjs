import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {discovery,findPlaces,destination} from '../../client/src/toronto/discovery.js';
import {terrainGrid} from '../../client/src/toronto/cityTerrain.js';import {localFrame} from '../../client/src/shared/localFrame.js';
const meta=JSON.parse(fs.readFileSync('client/fixtures/toronto/city-terrain/manifest.json')),b=fs.readFileSync('client/fixtures/toronto/city-terrain/heights.f32'),grid=terrainGrid(meta,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),frame=localFrame(meta.frame);
test('Pinned StrollTO index preserves group links and bounded names/coordinates without external media',()=>{
 assert.equal(discovery.starts.length,159);assert.equal(discovery.pois.length,1838);const groups=new Set(discovery.starts.map(p=>p.group)),ids=new Set();
 for(const p of [...discovery.starts,...discovery.pois]){assert.ok(!ids.has(p.id));ids.add(p.id);assert.ok(groups.has(p.group));assert.ok(p.name&&p.name.length<500);assert.deepEqual(Object.keys(p).sort(),['coordinate','group','id','name','neighbourhood']);assert.ok(p.coordinate.every(Number.isFinite));}
 for(const s of discovery.sources){assert.match(s.url,/^https:\/\/ckan0.cf.opendata.inter.prod-toronto.ca\//);assert.match(s.sha256,/^[a-f0-9]{64}$/);assert.match(s.licence,/Toronto/);}
});
test('Search is deterministic, case/accent-insensitive and constrained by source neighbourhood',()=>{
 assert.deepEqual(findPlaces(),[]);assert.deepEqual(findPlaces('CITY hall').map(p=>p.id),['pois:1783']);assert.deepEqual(findPlaces('café'),findPlaces('CAFE'));assert.ok(findPlaces('','78').every(p=>p.group==='78'));assert.equal(findPlaces('zzzzunfindable').length,0);assert.equal(findPlaces('<img src=x onerror=alert(1)>').length,0);assert.deepEqual(findPlaces('park'),findPlaces('park'));
});
test('Navigation retains exact source coordinates; missing terrain and unknown identities cannot focus',()=>{
 assert.ok(discovery.starts.every(p=>destination(p.id,grid,frame)));assert.equal(discovery.pois.filter(p=>!destination(p.id,grid,frame)).length,23);
 for(const id of ['starts:71','pois:1783']){const d=destination(id,grid,frame),p=frame.unproject(d.x,d.z);assert.ok(Math.abs(p[0]-d.place.coordinate[0])<1e-10&&Math.abs(p[1]-d.place.coordinate[1])<1e-10);assert.equal(d.y,grid.sample(d.x,d.z));}
 assert.equal(destination('pois:8',grid,frame),null);assert.equal(destination('__proto__',grid,frame),null);
});
