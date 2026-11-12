// Offline diagnosis of illustrative canopy samples against the pinned rendered TIN.
// This does not establish surveyed roots, tree inventory, or current pedestrian access.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateWaterfront,waterfrontGroundAt} from '../../client/src/toronto/waterfront.js';
import {trunkContactDrop} from '../../client/src/toronto/vegetation.js';

function inside(x,z,ring){
 let result=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];
  if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;
 }
 return result;
}
function nearestWalk(x,z,walk){
 let distanceM=Infinity,alongM=0;
 for(let i=1;i<walk.length;i++){
  const a=walk[i-1],b=walk[i],dx=b[1]-a[1],dz=b[3]-a[3],length2=dx*dx+dz*dz;
  const t=length2?Math.max(0,Math.min(1,((x-a[1])*dx+(z-a[3])*dz)/length2)):0;
  const distance=Math.hypot(x-a[1]-t*dx,z-a[3]-t*dz);
  if(distance<distanceM){distanceM=distance;alongM=a[0]+t*(b[0]-a[0]);}
 }
 return {distanceM,alongM};
}
export function auditTreeContact(data){
 validateWaterfront(data);
 const counts={extended:0,negligible:0,missingCentre:0,inconsistentCentre:0,missingPerimeter:0,overCap:0},unsupported=[];
 const sample=(x,z)=>waterfrontGroundAt(data,x,z);
 data.trees.forEach((position,index)=>{
  const [x,y,z]=position,centre=sample(x,z),perimeter=Array.from({length:6},(_,k)=>sample(x+.28*Math.sin(k*Math.PI/3),z+.28*Math.cos(k*Math.PI/3)));
  const gapM=centre!==null&&perimeter.every(Number.isFinite)?y-Math.min(centre,...perimeter):null;
  const drop=trunkContactDrop(position,sample);
  const reason=centre===null?'missingCentre':Math.abs(centre-y)>.02?'inconsistentCentre':perimeter.some(h=>h===null)?'missingPerimeter':drop>0?'extended':gapM<=.005?'negligible':'overCap';
  counts[reason]++;
  if(reason==='extended'||reason==='negligible')return;
  unsupported.push({index,position:[...position],reason,centreM:centre,perimeterM:perimeter,gapM,extensionM:drop,
   mappedWater:data.water.filter(w=>inside(x,z,w.rings[0])&&!w.rings.slice(1).some(r=>inside(x,z,r))).map(w=>({id:w.id,name:w.name})),
   nearestWalk:nearestWalk(x,z,data.walk)});
 });
 return {version:1,counts,unsupported,limits:'Six perimeter samples diagnose bounded visual contact only. Water membership is mapped footprint, not bathymetry; steep TIN is not proof of a surveyed planting surface.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const bytes=fs.readFileSync(new URL('../../client/fixtures/toronto/waterfront/scene.json',import.meta.url));
 console.log(JSON.stringify({sceneSha256:crypto.createHash('sha256').update(bytes).digest('hex'),...auditTreeContact(JSON.parse(bytes))},null,2));
}
