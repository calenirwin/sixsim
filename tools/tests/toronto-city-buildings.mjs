import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';import * as THREE from 'three';
import {CityBuildings,validateCityBuildings,cityBuildingTiles} from '../../client/src/toronto/cityBuildings.js';
import {parseTile,buildingsOf} from '../../client/src/world/tiledata.js';import {terrainGrid} from '../../client/src/toronto/cityTerrain.js';
const root='client/fixtures/toronto/city-buildings/',manifest=JSON.parse(fs.readFileSync(root+'manifest.json'));
test('all municipal CTL1 tiles preserve unique source parts, valid heights and terrain anchors within byte budget',()=>{
 validateCityBuildings(manifest);assert.equal(manifest.counts.sourceRecords,428184);assert.equal(manifest.counts.retainedParts,427946);assert.equal(manifest.counts.retainedRecords,427584);assert.equal(Object.keys(manifest.tiles).length,2469);
 const prov=JSON.parse(fs.readFileSync(root+'provenance.json'));assert.equal(createHash('sha256').update(fs.readFileSync(root+'manifest.json')).digest('hex'),prov.manifest_sha256);assert.equal(createHash('sha256').update(fs.readFileSync(root+'omissions.json')).digest('hex'),prov.omissions_sha256);
 const hm=JSON.parse(fs.readFileSync('client/fixtures/toronto/city-terrain/manifest.json')),hb=fs.readFileSync('client/fixtures/toronto/city-terrain/heights.f32'),ground=terrainGrid(hm,hb.buffer.slice(hb.byteOffset,hb.byteOffset+hb.byteLength));const ids=new Set(),records=new Set();let parts=0,bytes=0;
 for(const [key,t] of Object.entries(manifest.tiles)){const b=fs.readFileSync(root+t.f);assert.equal(b.length,t.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),t.sha256);const tile=parseTile(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));assert.deepEqual(tile.header.origin,key.split('_').map(Number).map(v=>v*512));assert.equal(tile.header.terrainSourceSha256,hm.heightSha256);assert.equal(tile.header.records.length,t.b);assert.equal(tile.S.bAnchorXZ.length,t.b*2);
  for(const building of buildingsOf(tile,{applyOverrides:false})){const r=tile.header.records[building.i],id=r.sourceId+':'+r.part;assert.ok(!ids.has(id));ids.add(id);records.add(r.sourceRecordIndex);assert.ok(building.height>0&&building.height<600);const height=ground.sample(tile.S.bAnchorXZ[building.i*2],tile.S.bAnchorXZ[building.i*2+1]);assert.ok(height!==null&&Math.abs(height-building.baseY)<.005);parts++;}
  assert.ok(tile.S.bldgXZ.every(Number.isFinite));bytes+=b.length;
 }
 assert.equal(parts,427946);assert.equal(records.size,427584);assert.equal(bytes,manifest.counts.bytes);assert.ok(bytes<120000000);
 for(const [lon,lat] of [[-79.55,43.68],[-79.414,43.76],[-79.25,43.77],[-79.3963,43.6488]])assert.ok(cityBuildingTiles(manifest,lon,lat).reduce((n,t)=>n+t.b,0)>100);
 assert.deepEqual(cityBuildingTiles(manifest,-80,44),[]);assert.throws(()=>cityBuildingTiles(manifest,'',43.65),/Invalid/);assert.throws(()=>cityBuildingTiles(manifest,-79.4,43.65,10),/Invalid/);
});
const payload=new Uint8Array([1,2,3]),hash=createHash('sha256').update(payload).digest('hex');
const mock=()=>({version:1,tile:512,profile:manifest.profile,counts:{bytes:9*3,retainedParts:9},tiles:Object.fromEntries([-1,0,1].flatMap(x=>[-1,0,1].map(z=>{const key=`${x}_${z}`;return [key,{f:key+'.bin',b:1,bytes:3,sha256:hash}];})))});
const tick=()=>new Promise(r=>setTimeout(r,2));
const response=()=>({ok:true,arrayBuffer:async()=>payload.buffer});
function assembled(){const group=new THREE.Group(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));group.add(new THREE.Mesh(g));return {group,records:[{}],dispose(parent){parent.remove(group);g.dispose();}};}
test('nearby loader caps requests/cache and disposes distant geometry; failures require explicit retry',async()=>{
 let calls=0;const loader=new CityBuildings(new THREE.Scene(),mock(),{base:'http://localhost/city-buildings/',fetcher:async function(){assert.equal(this,undefined);calls++;return response();},assemble:async()=>assembled()});
 for(let i=0;i<12;i++){loader.update({x:1,z:1},1000);assert.ok(loader.pending.size<=2);await tick();}
 assert.equal(loader.state.tiles,9);assert.equal(calls,9);assert.equal(loader.state.vertices,27);loader.update({x:1,z:1},10000);assert.equal(loader.state.tiles,0);assert.equal(loader.state.vertices,0);loader.dispose();
 const bad=new CityBuildings(new THREE.Scene(),mock(),{base:'http://localhost/',fetcher:async()=>({ok:false,status:404}),assemble:async()=>assembled()});for(let i=0;i<12;i++){bad.update({x:1,z:1},1000);await tick();}assert.equal(bad.state.errors.length,9);assert.equal(bad.state.tiles,0);bad.retry();assert.equal(bad.state.errors.length,0);bad.dispose();
});
test('cancelled/late requests cannot attach stale tiles; corrupt payloads fail closed',async()=>{
 const waits=[];let assemblies=0;const loader=new CityBuildings(new THREE.Scene(),mock(),{base:'http://localhost/',fetcher:(_,{signal})=>new Promise(resolve=>waits.push({resolve,signal})),assemble:async()=>{assemblies++;return assembled();}});loader.update({x:1,z:1},1000);assert.equal(waits.length,2);loader.update({x:10000,z:10000},1000);assert.ok(waits.every(w=>w.signal.aborted));for(const w of waits)w.resolve(response());await tick();assert.equal(assemblies,0);assert.equal(loader.state.tiles,0);loader.dispose();
 const bad=new CityBuildings(new THREE.Scene(),mock(),{base:'http://localhost/',fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([3,2,1]).buffer}),assemble:async()=>{throw Error('Must not assemble');}});bad.update({x:1,z:1},1000);for(let i=0;i<100&&bad.pending.size;i++)await tick();assert.equal(bad.state.errors.length,2);assert.ok(bad.state.errors.every(([,v])=>v.includes('checksum')));assert.equal(bad.state.tiles,0);bad.dispose();
});
