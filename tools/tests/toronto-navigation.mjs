import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {locatorTransform} from '../../client/src/toronto/cityNavigator.js';
import {terrainGrid} from '../../client/src/toronto/cityTerrain.js';
import {localFrame} from '../../client/src/shared/localFrame.js';
const meta=JSON.parse(fs.readFileSync('client/fixtures/toronto/city-terrain/manifest.json'));
const bytes=fs.readFileSync('client/fixtures/toronto/city-terrain/heights.f32');
const grid=terrainGrid(meta,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
test('Locator preserves geographic orientation, aspect and coordinate round trips across Toronto',()=>{
 const tx=locatorTransform(meta),frame=localFrame(meta.frame);
 for(const [lon,lat] of [[-79.397,43.65],[-79.55,43.68],[-79.414,43.76],[-79.25,43.77]]){
  const p=frame.project(lon,lat),pixel=tx.toPixel(...p),back=tx.fromPixel(...pixel);assert.ok(Math.hypot(back[0]-p[0],back[1]-p[1])<1e-8);assert.ok(grid.sample(...back)>60);assert.ok(pixel[0]>=0&&pixel[0]<=280&&pixel[1]>=0&&pixel[1]<=170);
 }
 assert.ok(tx.toPixel(0,-1000)[1]<tx.toPixel(0,0)[1]);assert.ok(tx.toPixel(1000,0)[0]>tx.toPixel(0,0)[0]);assert.equal(grid.sample(...tx.fromPixel(0,0)),null);
});
