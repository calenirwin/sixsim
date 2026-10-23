import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { compileDistrict } from '../toronto/compile.mjs';
import { writeTile } from '../pipeline/binio.mjs';
import { parseTile,buildingsOf } from '../../src/world/tiledata.js';
import { localFrame } from '../../src/shared/localFrame.js';
import { PROFILE } from '../../src/toronto/profile.js';
import { sourceNetwork } from '../../src/toronto/sourceNetwork.js';
const read=name=>fs.readFileSync(new URL(`../../fixtures/toronto/${name}`,import.meta.url));
const source=JSON.parse(read('district.geojson')), frame=localFrame(PROFILE.geoOrigin);
test('district provenance, multi-tile geometry, whole-part ownership and deterministic bytes',()=>{
 const p=JSON.parse(read('district-provenance.json'));
 assert.equal(createHash('sha256').update(read('district.geojson')).digest('hex'),p.subset_sha256);
 assert.equal(source.features.length,2344);assert.deepEqual(p.invalid_geometry_exclusions,[137520]);assert.deepEqual(p.small_geometry_exclusions,[137415]);
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'district-'));
 try {
  const m=compileDistrict(source,out), originals=new Map(source.features.map(f=>[f.id,f]));
  assert.equal(Object.keys(m.tiles).length,19);assert.deepEqual(m.macros,{});
  const expected=new Set(source.features.flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map((_,i)=>`${f.id}:${i}`))), seen=new Set(), bytes=new Map();let overflow=0,total=0;
  for(const [key,meta] of Object.entries(m.tiles)) {
   const b=fs.readFileSync(path.join(out,meta.f));bytes.set(key,b);total+=b.length;
   const tile=parseTile(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
   assert.deepEqual(tile.header.origin,key.split('_').map(Number).map(v=>v*512));
   const bs=[...buildingsOf(tile,{applyOverrides:false})];assert.equal(bs.length,meta.b);
   for(const building of bs) {
    const id=tile.header.records[building.i],token=`${id.sourceId}:${id.part}`;assert.ok(!seen.has(token));seen.add(token);
    const f=originals.get(id.sourceId),polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    const coords=polys[id.part][0].slice(0,-1).map(p=>frame.project(...p));
    const decoded=Array.from({length:building.len},(_,i)=>[tile.S.bldgXZ[(building.start+i)*2],tile.S.bldgXZ[(building.start+i)*2+1]]);
    for(const q of decoded)if(q.some(v=>v<0||v>=512))overflow++;
    for(const p of coords)assert.ok(decoded.some(q=>Math.hypot(q[0]+tile.header.origin[0]-p[0],q[1]+tile.header.origin[1]-p[1])<.001));
    assert.ok(Math.abs(building.height-f.properties.AVG_HEIGHT)<.0001);
   }
  }
  assert.deepEqual(seen,expected);assert.equal(seen.size,2531);assert.ok(overflow>0);assert.ok(total<1_500_000);
  assert.deepEqual(compileDistrict(source,out),m);
  for(const [key,b] of bytes)assert.deepEqual(fs.readFileSync(path.join(out,m.tiles[key].f)),b);
 } finally {fs.rmSync(out,{recursive:true,force:true});}
});
test('network preserves source connectivity and coordinates without invented routing',()=>{
 const bytes=read('district-network.json'),p=JSON.parse(read('network-provenance.json'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),p.subset_sha256);
 const raw=JSON.parse(bytes),n=sourceNetwork(raw);assert.equal(n.roads.length,841);assert.equal(n.stops.length,43);assert.equal(n.routing,false);
 const junction=n.nodes.find(node=>node.id===13466982);
 const names=junction.edge_ids.map(id=>n.roads.find(r=>r.id===id).properties.LINEAR_NAME_FULL);
 assert.ok(names.includes('Queen St W') && names.includes('Spadina Ave'),'Source Queen/Spadina intersection connectivity');
 const blank=structuredClone(raw);blank.stops[0].stop_lon='';assert.throws(()=>sourceNetwork(blank),/Missing stop coordinate/);
 assert.deepEqual(n.routes.map(r=>r.route_short_name).sort(),['501','505','506','510']);
 for(const node of n.nodes)for(const id of node.edge_ids){const r=n.roads.find(r=>r.id===id);assert.ok([r.properties.FROM_INTERSECTION_ID,r.properties.TO_INTERSECTION_ID].includes(node.id));}
 for(const r of n.roads)for(const line of r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates)for(const p of line){const q=frame.unproject(...frame.project(...p));assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-10);}
 const bad=structuredClone(raw);bad.roads.push(bad.roads[0]);assert.throws(()=>sourceNetwork(bad),/Duplicate/);
});
test('profiled macro loading uses mapped assets and suppresses NYC corrections and crowns',async()=>{
 globalThis.location={search:''};
 const {Streamer}=await import('../../src/world/streamer.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'district-macro-')),oldFetch=globalThis.fetch;
 try {
  const box=new THREE.BoxGeometry(30,90,30).toNonIndexed();box.translate(100,45,100);
  const pos=new Int16Array(box.attributes.position.array),col=new Uint8Array(pos.length/3*4).fill(180);box.dispose();
  const file=path.join(dir,'macro.bin');writeTile(file,{origin:[0,0]},[{name:'pos',array:pos},{name:'col',array:col}]);const bytes=fs.readFileSync(file),requests=[];
  globalThis.fetch=async url=>{requests.push(url);assert.equal(url,'/mapped/macro.bin');return new Response(bytes);};
  const scene=new THREE.Scene(),mat=new THREE.MeshBasicMaterial({vertexColors:true});
  const streamer=new Streamer(scene,{cityOverrides:false,farMat:mat,assetUrls:{'macro.bin':'/mapped/macro.bin'}});
  streamer.manifest={macros:{'0_0':{f:'macro.bin'}}};await streamer._fetchMacro('0_0');
  assert.deepEqual(requests,['/mapped/macro.bin']);const macro=streamer.macros.get('0_0');assert.equal(macro.state,'ready');assert.equal(macro.cMesh,null);assert.equal(macro.mesh.geometry.attributes.position.count,pos.length/3);assert.equal(macro.mesh.geometry.attributes.uv,undefined);
  macro.mesh.geometry.dispose();mat.dispose();
 } finally {globalThis.fetch=oldFetch;fs.rmSync(dir,{recursive:true,force:true});}
});
