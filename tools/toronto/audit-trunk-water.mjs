// Offline footprint audit against pinned mapped water, not surveyed tree roots.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {waterfrontScene} from '../../client/src/toronto/waterfront.js';

const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function pointDistance(p,a,b){
 const dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/n)):0;
 return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
function segmentDistance(a,b,c,d){
 const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
 if(((x>0&&y<0)||(x<0&&y>0))&&((z>0&&w<0)||(z<0&&w>0)))return 0;
 return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function inside(p,ring){
 let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }return hit;
}
export function footprintWaterRelation(footprint,rings){
 let clearanceM=Infinity;
 for(const ring of rings)for(let i=0;i<ring.length;i++)for(let j=0;j<footprint.length;j++)
  clearanceM=Math.min(clearanceM,segmentDistance(ring[i],ring[(i+1)%ring.length],footprint[j],footprint[(j+1)%footprint.length]));
 // Includes tangencies, a water sliver through an edge, and enclosed water islands.
 const intersects=clearanceM<=1e-8||(inside(footprint[0],rings[0])&&!rings.slice(1).some(r=>inside(footprint[0],r)))||rings.some(r=>r.some(p=>inside(p,footprint)));
 return {intersects,clearanceM:intersects?0:clearanceM};
}
export function auditTrunkWater(data){
 const rendered=waterfrontScene(new THREE.Scene(),data);
 try{
  const trunk=rendered.group.getObjectByName('illustrativeTreeTrunks'),vertices=trunk.geometry.attributes.position,baseY=Math.min(...Array.from({length:vertices.count},(_,i)=>vertices.getY(i))),base=[];
  for(let i=0;i<vertices.count;i++){
   const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
   if(Math.abs(y-baseY)<1e-6&&Math.hypot(x,z)>1e-6&&!base.some(p=>Math.hypot(p[0]-x,p[2]-z)<1e-6))base.push([x,y,z]);
  }
  base.sort((a,b)=>Math.atan2(a[0],a[2])-Math.atan2(b[0],b[2]));
  const matrix=new THREE.Matrix4(),rows=[];
  for(let i=0;i<trunk.count;i++){
   trunk.getMatrixAt(i,matrix);
   const footprint=base.map(p=>{const v=new THREE.Vector3(...p).applyMatrix4(matrix);return [v.x,v.z];});
   const relations=data.water.map(w=>({waterId:w.id,...footprintWaterRelation(footprint,w.rings)})).sort((a,b)=>a.clearanceM-b.clearanceM||a.waterId-b.waterId);
   rows.push({index:i,candidateId:data.treeStyleIds?.[i]??i,footprint,nearest:relations[0]??null,intersectingWaterIds:relations.filter(r=>r.intersects).map(r=>r.waterId)});
  }
  return {version:1,trees:trunk.count,footprintVertices:base.length,baseRadiusM:Math.max(...base.map(p=>Math.hypot(p[0],p[2]))),intersections:rows.filter(r=>r.intersectingWaterIds.length),nearest:rows.filter(r=>r.nearest).sort((a,b)=>a.nearest.clearanceM-b.nearest.clearanceM||a.index-b.index).slice(0,5),limits:'Rendered trunk-base polygons and instance transforms against pinned mapped water. Includes touch; no surveyed roots, canopy exclusion, present shoreline accuracy or terrain repair.'};
 }finally{rendered.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const bytes=fs.readFileSync(new URL('../../client/fixtures/toronto/waterfront/scene.json',import.meta.url));
 console.log(JSON.stringify({sceneSha256:crypto.createHash('sha256').update(bytes).digest('hex'),...auditTrunkWater(JSON.parse(bytes))},null,2));
}
