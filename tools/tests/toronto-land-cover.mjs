import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {decodeLandCover,coverRGBA,addLandCover,COVER_COLORS} from '../../client/src/toronto/landCover.js';
import {PROFILE} from '../../client/src/toronto/profile.js';
import {localFrame} from '../../client/src/shared/localFrame.js';
const bytes=fs.readFileSync('client/fixtures/toronto/land-cover-2018.json'),data=JSON.parse(bytes),p=JSON.parse(fs.readFileSync('client/fixtures/toronto/land-cover-provenance.json'));
test('classified cover preserves source hash, histogram, bounded texture and district coordinates',()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),p.subset_sha256);assert.equal(p.study_year,2018);assert.equal(p.grid.conflict_cells,0);assert.equal(p.normalization.parts.length,751);assert.equal(p.normalization.omitted_parts.length,0);
 const cells=decodeLandCover(data);assert.equal(cells.length,327680);assert.deepEqual(data.counts,[0,46095,6237,14395,0,122260,48680,86848,3165]);
 const mesh=addLandCover(new THREE.Scene(),data,PROFILE);assert.equal(mesh.visible,false);assert.equal(mesh.geometry.index.count,6);assert.equal(mesh.material.map.image.data.length,1310720);
 const pos=mesh.geometry.attributes.position,frame=localFrame(PROFILE.geoOrigin);for(let i=0;i<pos.count;i++){const [lon,lat]=frame.unproject(pos.getX(i),pos.getZ(i));assert.ok(Math.min(Math.abs(lon-data.bbox[0]),Math.abs(lon-data.bbox[2]))<1e-6);assert.ok(Math.min(Math.abs(lat-data.bbox[1]),Math.abs(lat-data.bbox[3]))<1e-6);}
 mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();
});
test('north-first source rows map to north v=1 without east/west reflection; unknown transparent',()=>{
 const d={...data,width:2,height:2,runs:[1,1,2,1,7,1,0,1],counts:[1,1,1,0,0,0,0,1,0]};const rgba=coverRGBA(d);
 const rgb=i=>(rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2];assert.equal(rgb(0),COVER_COLORS[7]);assert.equal(rgba[7],0);assert.equal(rgb(2),COVER_COLORS[1]);assert.equal(rgb(3),COVER_COLORS[2]);
});
test('malformed classifications and allocation budgets fail closed',()=>{
 for(const mutate of [d=>d.width=400001,d=>d.width='',d=>d.runs[0]=9,d=>d.runs[1]=0,d=>d.runs[1]='1',d=>d.runs.pop(),d=>d.counts[1]++,d=>d.bbox[0]='',d=>d.bbox[2]=d.bbox[0],d=>d.classes[1]='park',d=>d.rowOrder='south-to-north']){const bad=structuredClone(data);mutate(bad);assert.throws(()=>decodeLandCover(bad),/classified land cover/);}
});
