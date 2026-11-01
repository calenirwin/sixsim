import {junctionAdmission} from './junctionAdmission.js';
import {localFrame} from '../shared/localFrame.js';
// A closed-form geometric experiment, never a legal route, lane model or observed vehicle.
export function roadProbe(input,{admission=null}={}){
 const data=structuredClone(input),policy=data?.policy,frame=localFrame(data?.geoOrigin||{}),fail=()=>{throw Error('Invalid constrained road corridor');};
 if(data?.version!==1||data.id!=='wellington-west-source-corridor'||data.geoOrigin?.lat!==43.65||data.geoOrigin?.lon!==-79.397||!Array.isArray(data.edges)||data.edges.length!==5||!Array.isArray(data.junctions)||data.junctions.length!==5||policy?.speedMps!==5||policy.startInsetM!==10||policy.stopInsetM!==10||policy.junctionCrossings!==0||policy.access!=='unverified'||policy.turns!=='unverified'||policy.elevation!=='district-flat-illustrative'||policy.basis!=='prescribed-geometric-probe'||policy.trafficInteractions!==false)fail();
 const ids=new Set(),lines=[];
 for(let i=0;i<data.edges.length;i++){const e=data.edges[i],j=data.junctions[i];if(!Number.isSafeInteger(e.id)||e.id<=0||ids.has(e.id)||!Number.isSafeInteger(e.fromNode)||!Number.isSafeInteger(e.toNode)||e.fromNode<=0||e.toNode<=0||e.fromNode===e.toNode||e.direction!==1||!Number.isFinite(e.sourceLengthM)||e.sourceLengthM<=0||!Array.isArray(e.points)||e.points.length<2||e.points.length>10000||j.id!==e.toNode||j.crossingPermission!=='unverified'||!Array.isArray(j.incidentSourceEdges)||!j.incidentSourceEdges.includes(e.id))fail();ids.add(e.id);
  for(const p of e.points)if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<-79.42||p[0]>-79.39||p[1]<43.63||p[1]>43.65)fail();
  if(i&&(data.edges[i-1].toNode!==e.fromNode||JSON.stringify(data.edges[i-1].points.at(-1))!==JSON.stringify(e.points[0])))fail();
  const points=e.points.map(p=>frame.project(...p)),distances=[0];for(let n=1;n<points.length;n++){const d=Math.hypot(points[n][0]-points[n-1][0],points[n][1]-points[n-1][1]);if(d<=0||!Number.isFinite(d))fail();distances.push(distances.at(-1)+d);}if(distances.at(-1)<=20||distances.at(-1)>1000)fail();lines.push({points,distances});
 }
 const first=lines[0],length=first.distances.at(-1),end=length-policy.stopInsetM,stopSeconds=(end-policy.startInsetM)/policy.speedMps;
 function legacyAt(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid road probe time');const distance=Math.min(end,policy.startInsetM+seconds*policy.speedMps);let segment=0;while(segment+1<first.distances.length-1&&first.distances[segment+1]<distance)segment++;const t=(distance-first.distances[segment])/(first.distances[segment+1]-first.distances[segment]),a=first.points[segment],b=first.points[segment+1];return {id:'wellington-probe',basis:policy.basis,seconds,edgeId:data.edges[0].id,fromNode:data.edges[0].fromNode,toNode:data.edges[0].toNode,distanceM:distance,progress:distance/length,x:a[0]+(b[0]-a[0])*t,y:0,z:a[1]+(b[1]-a[1])*t,status:seconds>=stopSeconds?'held-before-junction':'moving',speedMps:seconds>=stopSeconds?0:policy.speedMps,junctionCrossings:0,stopReason:'access-turn-and-structural-elevation-unverified',navigationReady:false,trafficInteractions:false,elevation:policy.elevation};}
 const next=lines[1],nextLength=next.distances.at(-1),travel=policy.stopInsetM+nextLength-policy.stopInsetM;
 const gate=admission===null?null:junctionAdmission(admission,{nodeId:data.edges[0].toNode,incomingEdgeId:data.edges[0].id,outgoingEdgeId:data.edges[1].id,readySeconds:stopSeconds,clearanceSeconds:travel/policy.speedMps});
 function at(seconds){
  const base=legacyAt(seconds);if(!gate)return base;
  const grant=gate.grantSeconds,cleared=grant!==null&&seconds>=gate.clearSeconds,admitted=grant!==null&&seconds>=grant;
  const distance=admitted?Math.min(length+nextLength-policy.stopInsetM,end+(seconds-grant)*policy.speedMps):base.distanceM;
  const crossed=distance>=length,index=crossed?1:0,line=lines[index],edgeDistance=crossed?distance-length:distance,edgeLength=line.distances.at(-1);let segment=0;
  while(segment+1<line.distances.length-1&&line.distances[segment+1]<edgeDistance)segment++;
  const t=(edgeDistance-line.distances[segment])/(line.distances[segment+1]-line.distances[segment]),a=line.points[segment],b=line.points[segment+1],phase=seconds<stopSeconds?'approaching':!admitted?'waiting':cleared?'cleared':'reserved';
  return {...base,coordinateFrame:'local-east-up-south-metres',edgeId:data.edges[index].id,fromNode:data.edges[index].fromNode,toNode:data.edges[index].toNode,distanceM:edgeDistance,corridorDistanceM:distance,progress:edgeDistance/edgeLength,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,status:phase==='approaching'?'moving':phase==='waiting'?'waiting-for-admission':phase==='reserved'?'crossing-admitted-source-node':'held-before-next-junction',speedMps:phase==='approaching'||phase==='reserved'?policy.speedMps:0,junctionCrossings:crossed?1:0,admission:{basis:gate.policy.basis,nodeId:gate.policy.nodeId,phase,grantSeconds:grant,clearSeconds:gate.clearSeconds,realPermissions:'unverified'}};
 }
 let current=at(0);return {definition:structuredClone(data),get admission(){return gate?structuredClone(gate.policy):null;},lines,stopSeconds,at,update(seconds){current=at(seconds);},get state(){return structuredClone(current);}};
}
