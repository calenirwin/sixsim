import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {validateGreenSpaces,addGreenSpaces,greenSpaceFocus} from '../../client/src/toronto/greenSpaces.js';
import {PROFILE} from '../../client/src/toronto/profile.js';
import {localFrame} from '../../client/src/shared/localFrame.js';
const data=JSON.parse(fs.readFileSync('client/fixtures/toronto/green-spaces.geojson'));
const provenance=JSON.parse(fs.readFileSync('client/fixtures/toronto/green-spaces-provenance.json'));
test('pinned source crop, named focus and one-mesh overlay preserve area and holes',()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync('client/fixtures/toronto/green-spaces.geojson')).digest('hex'),provenance.subset_sha256);
 validateGreenSpaces(data);assert.equal(data.features.length,44);assert.deepEqual(data.bbox,[-79.41,43.642,-79.385,43.665]);
 const scene=new THREE.Scene(),group=addGreenSpaces(scene,data,PROFILE);assert.equal(group.children.length,1);assert.equal(group.userData.records,44);
 const frame=localFrame(PROFILE.geoOrigin),mesh=group.children[0],p=mesh.geometry.attributes.position;
 let trianglesArea=0;for(let i=0;i<p.count;i+=3){const [a,b,c]=[i,i+1,i+2].map(i=>[p.getX(i),p.getZ(i)]);trianglesArea+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
 const ringArea=r=>{const ps=r.map(p=>frame.project(...p));return Math.abs(ps.slice(1).reduce((n,b,i)=>n+ps[i][0]*b[1]-b[0]*ps[i][1],0))/2;};
 const sourceArea=data.features.reduce((sum,f)=>sum+(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).reduce((n,rings)=>n+ringArea(rings[0])-rings.slice(1).reduce((n,r)=>n+ringArea(r),0),0),0);
 assert.ok(Math.abs(trianglesArea-sourceArea)<2,'Triangulation retains holes and metric area');assert.ok(p.count/3<10000);
 const [lon,lat]=frame.unproject(...greenSpaceFocus(data,'GRANGE PARK',PROFILE));assert.ok(lon>-79.394&&lon<-79.39&&lat>43.65&&lat<43.654);
 const clone=addGreenSpaces(new THREE.Scene(),data,PROFILE);assert.deepEqual(clone.children[0].geometry.attributes.position.array,p.array);
 for(const g of [group,clone]){g.children[0].geometry.dispose();g.children[0].material.dispose();}
});
test('malformed identities, coordinates, rings and budgets fail closed',()=>{
 for(const mutate of [d=>d.features.push(d.features[0]),d=>d.features[0].geometry.coordinates[0][0][0]='',d=>d.bbox[2]=d.bbox[0],d=>d.features[0].properties.AREA_CLASS=null,d=>d.features=Array(101).fill(d.features[0])]){
  const bad=structuredClone(data);mutate(bad);assert.throws(()=>validateGreenSpaces(bad),/green-space/);
 }
 const shape={...data,features:[{type:'Feature',id:'test',properties:{AREA_NAME:'test',AREA_CLASS:'Park'},geometry:{type:'Polygon',coordinates:[[[-79.4,43.65],[-79.39,43.65],[-79.39,43.66],[-79.4,43.65]]]}}]};
 const open=structuredClone(shape);open.features[0].geometry.coordinates[0].pop();assert.throws(()=>validateGreenSpaces(open),/green-space/);
 assert.throws(()=>greenSpaceFocus(data,'missing',PROFILE),/unavailable/);
});
test('synthetic hole remains empty after metric projection and triangulation',()=>{
 const frame=localFrame(PROFILE.geoOrigin),ring=points=>points.map(p=>frame.unproject(...p));
 const sample={...data,features:[{id:'hole',properties:{AREA_NAME:'test',AREA_CLASS:'Park'},geometry:{type:'Polygon',coordinates:[ring([[0,0],[20,0],[20,20],[0,20],[0,0]]),ring([[5,5],[5,15],[15,15],[15,5],[5,5]])]}}]};
 const g=addGreenSpaces(new THREE.Scene(),sample,PROFILE),p=g.children[0].geometry.attributes.position;let area=0;
 for(let i=0;i<p.count;i+=3){const [a,b,c]=[i,i+1,i+2].map(i=>[p.getX(i),p.getZ(i)]);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
 assert.ok(Math.abs(area-300)<.001);g.children[0].geometry.dispose();g.children[0].material.dispose();
});
