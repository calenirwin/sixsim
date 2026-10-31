import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';import * as THREE from 'three';
import {terrainGrid,terrainPatch,terrainRenderer} from '../../client/src/toronto/cityTerrain.js';import {localFrame} from '../../client/src/shared/localFrame.js';
const root='client/fixtures/toronto/city-terrain/',m=JSON.parse(fs.readFileSync(root+'manifest.json')),b=fs.readFileSync(root+'heights.f32'),grid=terrainGrid(m,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
test('municipal grid hash, source coverage, units, missing-data semantics and shared edges',()=>{
 assert.equal(createHash('sha256').update(b).digest('hex'),m.heightSha256);assert.equal(createHash('sha256').update(fs.readFileSync(root+'boundary.geojson')).digest('hex'),m.boundarySha256);assert.equal(m.boundaryNodes,156647);assert.equal(m.validNodes,m.boundaryNodes);assert.equal(m.conflictNodes,0);assert.equal(grid.heights.filter(Number.isFinite).length,m.validNodes);
 const frame=localFrame(m.frame);for(const [lon,lat] of [[-79.55,43.68],[-79.414,43.76],[-79.25,43.77],[-79.3963,43.6488]]){const [x,z]=frame.project(lon,lat),height=grid.sample(x,z);assert.ok(height>60&&height<230);const [a,c]=frame.unproject(x,z);assert.ok(Math.abs(a-lon)<1e-10&&Math.abs(c-lat)<1e-10);}
 assert.equal(grid.sample(-100000,-100000),null);assert.equal(grid.sample(0,50000),null);
 const a=terrainPatch(grid,300,300,16),c=terrainPatch(grid,316,300,16);for(let j=0;j<=16;j++){const p=a.attributes.position,q=c.attributes.position;assert.deepEqual([p.getX(j*17+16),p.getY(j*17+16),p.getZ(j*17+16)],[q.getX(j*17),q.getY(j*17),q.getZ(j*17)]);}a.dispose();c.dispose();
});
test('missing interior samples are never bridged by coarse geometry; bad grids fail closed',()=>{
 const meta={...m,width:9,height:9,origin:[0,0]},values=new Float32Array(81).fill(100);values[40]=NaN;const g=terrainGrid(meta,values.buffer);assert.equal(g.sample(256,256),null);const mesh=terrainPatch(g,0,0,1,8);assert.equal(mesh.index.count,0);mesh.dispose();
 for(const bad of [{...m,width:1000000},{...m,step:0},{...m,units:'feet'},{...m,verticalDatum:'unknown'}])assert.throws(()=>terrainGrid(bad,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),/terrain/);
 assert.throws(()=>terrainGrid(m,new ArrayBuffer(4)),/terrain/);values[0]=Infinity;assert.throws(()=>terrainGrid(meta,values.buffer),/height/);
});
test('overview and near LOD stay bounded, dispose replaced meshes and return consistent samples',()=>{
 const scene=new THREE.Scene(),r=terrainRenderer(scene,grid),target=new THREE.Vector3(0,100,-10000);r.update(target,40000);assert.ok(r.group.children.length<=24);assert.ok(r.group.userData.triangles<13000);const old=r.group.children[0].geometry;let disposed=false;old.addEventListener('dispose',()=>disposed=true);r.update(target,3000);assert.ok(disposed);assert.ok(r.group.children.length<=25);assert.ok(r.group.userData.triangles<=12800);r.dispose();assert.equal(scene.children.length,0);
});
