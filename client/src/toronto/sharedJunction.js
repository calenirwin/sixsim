import {localFrame} from '../shared/localFrame.js';
import {junctionAdmission} from './junctionAdmission.js';
// One shared conservative resource, not a measured conflict polygon or legal traffic controller.
export function sharedJunction(input,policy){
 const d=structuredClone(input),p=structuredClone(policy),fail=()=>{throw Error('Invalid shared junction experiment');};
 if(d?.version!==1||d.nodeId!==13467884||d.geoOrigin?.lat!==43.65||d.geoOrigin?.lon!==-79.397||!Array.isArray(d.edges)||d.edges.length!==4||!Array.isArray(d.paths)||d.paths.length!==2)fail();
 const travel=p?.version===4,repeated=travel||p?.version===3,queued=repeated||p?.version===2;
 if(![1,2,3,4].includes(p?.version)||p.basis!=='illustrative-shared-admission'||p.nodeId!==d.nodeId||p.capacity!==1||p.order!=='ready-time-then-id'||p.realPermissions!=='unverified'||p.speedMps!==5||p.approachM!==20||p.holdM!==10||p.exitM!==10||(!repeated&&!p.starts))fail();
 if(Object.keys(p).sort().join()!==['version','basis','nodeId','capacity','order','realPermissions','speedMps','approachM','holdM','exitM',repeated?'arrivals':'starts','windows','interruptions',...(queued?['downstream']:[])].sort().join())fail();
 const frame=localFrame(d.geoOrigin),edges=new Map();
 for(const e of d.edges){if(!Number.isSafeInteger(e.id)||e.id<=0||edges.has(e.id)||!Number.isSafeInteger(e.fromNode)||!Number.isSafeInteger(e.toNode)||e.fromNode<=0||e.toNode<=0||e.fromNode===e.toNode||![-1,0,1].includes(e.direction)||!Number.isFinite(e.sourceLengthM)||e.sourceLengthM<=0||!Array.isArray(e.points)||e.points.length<2||e.points.length>10000)fail();
  for(const a of e.points)if(!Array.isArray(a)||a.length!==2||!a.every(Number.isFinite)||a[0]<-79.42||a[0]>-79.39||a[1]<43.63||a[1]>43.65)fail();
  const points=e.points.map(a=>frame.project(...a)),distances=[0];for(let n=1;n<points.length;n++){const length=Math.hypot(points[n][0]-points[n-1][0],points[n][1]-points[n-1][1]);if(length<=0)fail();distances.push(distances.at(-1)+length);}if(distances.at(-1)<=p.approachM||distances.at(-1)>2000)fail();edges.set(e.id,{...e,local:points,distances});
 }
 const ids=new Set(),movements=new Set(),requests=[],paths=new Map();let common=null;
 for(const path of d.paths){if(typeof path.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(path.id)||ids.has(path.id))fail();ids.add(path.id);const a=edges.get(path.incoming),b=edges.get(path.outgoing),start=repeated?0:p.starts[path.id];if(!a||!b||a===b||a.toNode!==d.nodeId||b.fromNode!==d.nodeId||a.direction===-1||b.direction===-1||JSON.stringify(a.points.at(-1))!==JSON.stringify(b.points[0])||!Number.isFinite(start)||start<0||start>172000)fail();const coordinate=JSON.stringify(a.points.at(-1));if(common!==null&&common!==coordinate)fail();common=coordinate;const movement=`${a.id}/${b.id}`;if(movements.has(movement))fail();movements.add(movement);paths.set(path.id,{a,b});if(!repeated)requests.push({id:path.id,a,b,start,ready:start+(p.approachM-p.holdM)/p.speedMps});}
 if(repeated){
  if(!Array.isArray(p.arrivals)||p.arrivals.length<1||p.arrivals.length>32)fail();
  const arrivalIds=new Set();
  for(const r of p.arrivals){
   if(!r||Object.keys(r).sort().join()!=='id,pathId,startSeconds'||typeof r.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(r.id)||arrivalIds.has(r.id)||!paths.has(r.pathId)||!Number.isFinite(r.startSeconds)||r.startSeconds<0||r.startSeconds>172000)fail();
   arrivalIds.add(r.id);requests.push({id:r.id,pathId:r.pathId,...paths.get(r.pathId),start:r.startSeconds,ready:r.startSeconds+(p.approachM-p.holdM)/p.speedMps});
  }
 }else if(Object.keys(p.starts).sort().join()!==[...ids].sort().join())fail();
 const exits=new Map(),holds=new Map();
 if(queued){
  if(!p.downstream||Array.isArray(p.downstream)||Object.keys(p.downstream).sort().join()!==[...new Set([...paths.values()].map(r=>String(r.b.id)))].sort().join())fail();
  for(const [id,slot] of Object.entries(p.downstream)){
   if(!slot||Object.keys(slot).sort().join()!==(travel?'capacity,holdingCapacity,holdingSpacingM,occupiedUntilSeconds,stopBeforeNodeM':repeated?'capacity,dischargeAfterSeconds,occupiedUntilSeconds':'capacity,occupiedUntilSeconds')||slot.capacity!==1||!(slot.occupiedUntilSeconds===null||(Number.isFinite(slot.occupiedUntilSeconds)&&slot.occupiedUntilSeconds>=0&&slot.occupiedUntilSeconds<=172800)))fail();
   if(repeated&&!travel&&!(slot.dischargeAfterSeconds===null||(Number.isFinite(slot.dischargeAfterSeconds)&&slot.dischargeAfterSeconds>=0&&slot.dischargeAfterSeconds<=86400)))fail();
   if(travel){
    const edge=edges.get(Number(id));
    if(!Number.isSafeInteger(slot.holdingCapacity)||slot.holdingCapacity<1||slot.holdingCapacity>8||!Number.isFinite(slot.stopBeforeNodeM)||slot.stopBeforeNodeM<10||slot.stopBeforeNodeM>50||!Number.isFinite(slot.holdingSpacingM)||slot.holdingSpacingM<10||slot.holdingSpacingM>50||edge.distances.at(-1)-slot.stopBeforeNodeM-(slot.holdingCapacity-1)*slot.holdingSpacingM<=p.exitM)fail();
    holds.set(Number(id),0);
   }
   exits.set(Number(id),slot.occupiedUntilSeconds===null?Infinity:slot.occupiedUntilSeconds);
  }
 }
 requests.sort((a,b)=>a.ready-b.ready||(a.id<b.id?-1:a.id>b.id?1:0));let available=0,blocked=false;
 const reservations=requests.map(r=>{
  const exitReady=queued?exits.get(r.b.id):0,slot=p.downstream?.[r.b.id],holdingFull=travel&&holds.get(r.b.id)>=slot.holdingCapacity;
  const stopDistanceM=travel&&!holdingFull?r.b.distances.at(-1)-slot.stopBeforeNodeM-holds.get(r.b.id)*slot.holdingSpacingM:null;
  // Reserve downstream storage before entry. V4 releases the travel slot only
  // on arrival at a separately reserved terminal hold; it never removes probes.
  const impossible=queued&&(blocked||exitReady===Infinity||holdingFull);
  const gate=junctionAdmission({version:1,basis:'illustrative-reservation',nodeId:d.nodeId,incomingEdgeId:r.a.id,outgoingEdgeId:r.b.id,maxCrossings:1,realPermissions:'unverified',windows:p.windows,interruptions:p.interruptions},{nodeId:d.nodeId,incomingEdgeId:r.a.id,outgoingEdgeId:r.b.id,readySeconds:Math.max(r.ready,available,Number.isFinite(exitReady)?exitReady:0),clearanceSeconds:(p.holdM+p.exitM)/p.speedMps});
  const grantSeconds=impossible?null:gate.grantSeconds,clearSeconds=impossible?null:gate.clearSeconds;
  const dischargeSeconds=repeated&&!travel&&clearSeconds!==null&&p.downstream[r.b.id].dischargeAfterSeconds!==null?clearSeconds+p.downstream[r.b.id].dischargeAfterSeconds:null;
  const segmentReleaseSeconds=travel&&clearSeconds!==null?clearSeconds+(stopDistanceM-p.exitM)/p.speedMps:null;
  const holdingSlot=travel&&clearSeconds!==null?holds.get(r.b.id)+1:null;
  if(clearSeconds!==null){available=clearSeconds;if(queued)exits.set(r.b.id,(travel?segmentReleaseSeconds:dischargeSeconds)??Infinity);if(travel)holds.set(r.b.id,holdingSlot);}
  else if(queued)blocked=true; // Strict FIFO: a blocked head is never overtaken.
  return {id:r.id,readySeconds:r.ready,grantSeconds,clearSeconds,...(travel?{segmentReleaseSeconds,stopDistanceM,holdingSlot}:repeated?{dischargeSeconds}: {})};
 });
 const grants=new Map(reservations.map(r=>[r.id,r]));
 function point(edge,distance){let n=0;while(n+1<edge.distances.length-1&&edge.distances[n+1]<distance)n++;const f=(distance-edge.distances[n])/(edge.distances[n+1]-edge.distances[n]),a=edge.local[n],b=edge.local[n+1];return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];}
 function at(seconds){if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid shared junction time');const probes=[...requests].sort((a,b)=>a.id<b.id?-1:1).map(r=>{const g=grants.get(r.id),admitted=g.grantSeconds!==null&&seconds>=g.grantSeconds,cleared=admitted&&seconds>=g.clearSeconds,discharged=repeated&&!travel&&g.dischargeSeconds!==null&&seconds>=g.dischargeSeconds,held=travel&&g.segmentReleaseSeconds!==null&&seconds>=g.segmentReleaseSeconds,phase=held?'held-before-next-junction':discharged?'discharged':seconds<r.start?'not-started':seconds<r.ready?'approaching':!admitted?'waiting':cleared?(travel?'downstream':'cleared'):'reserved';const travelled=admitted?Math.min(p.approachM+(travel?g.stopDistanceM:p.exitM),p.approachM-p.holdM+(seconds-g.grantSeconds)*p.speedMps):Math.min(p.approachM-p.holdM,Math.max(0,seconds-r.start)*p.speedMps);const crossed=travelled>=p.approachM,e=crossed?r.b:r.a,distance=crossed?travelled-p.approachM:r.a.distances.at(-1)-p.approachM+travelled,[x,z]=point(e,distance);return {id:r.id,...(travel?{pathId:r.pathId,segmentReleaseSeconds:g.segmentReleaseSeconds,stopDistanceM:g.stopDistanceM,holdingSlot:g.holdingSlot,stopBeforeNodeId:r.b.toNode}:repeated?{pathId:r.pathId,dischargeSeconds:g.dischargeSeconds}:{}),phase,present:phase!=='not-started'&&!discharged,edgeId:e.id,fromNode:e.fromNode,toNode:e.toNode,distanceM:distance,pathDistanceM:travelled,progress:distance/e.distances.at(-1),x,y:0,z,speedMps:phase==='approaching'||phase==='reserved'||phase==='downstream'?p.speedMps:0,junctionCrossings:crossed?1:0,grantSeconds:g.grantSeconds,clearSeconds:g.clearSeconds};});const owners=probes.filter(a=>a.phase==='reserved');if(owners.length>1)throw Error('Shared admission overlap');const extra={};if(queued){
   extra.downstream=Object.entries(p.downstream).map(([id,slot])=>{const edgeId=Number(id),initialOccupied=slot.occupiedUntilSeconds===null||seconds<slot.occupiedUntilSeconds,reservedIds=[],occupiedIds=[];for(const r of requests){if(r.b.id!==edgeId)continue;const g=grants.get(r.id);if(g.grantSeconds!==null&&seconds>=g.grantSeconds&&(travel?seconds<g.segmentReleaseSeconds:!repeated||g.dischargeSeconds===null||seconds<g.dischargeSeconds))(seconds<g.clearSeconds?reservedIds:occupiedIds).push(r.id);}const available=slot.capacity-Number(initialOccupied)-reservedIds.length-occupiedIds.length;if(available<0)throw Error('Downstream capacity exceeded');const holding={};if(travel){const reservedIds=[],heldIds=[];for(const r of requests){const g=grants.get(r.id);if(r.b.id===edgeId&&g.grantSeconds!==null&&seconds>=g.grantSeconds)(seconds<g.segmentReleaseSeconds?reservedIds:heldIds).push(r.id);}const free=slot.holdingCapacity-reservedIds.length-heldIds.length;if(free<0)throw Error('Terminal holding capacity exceeded');holding.holding={capacity:slot.holdingCapacity,available:free,reservedIds,heldIds};}return {edgeId,capacity:slot.capacity,initialOccupied,reservedIds,occupiedIds,available,...holding};}).sort((a,b)=>a.edgeId-b.edgeId);
   extra.queue=requests.filter(r=>probes.find(a=>a.id===r.id).phase==='waiting').map((r,index)=>({id:r.id,readySeconds:r.ready,waitSeconds:seconds-r.ready,reason:index?'queue-order':travel&&extra.downstream.find(e=>e.edgeId===r.b.id).holding.available===0?'holding-full':extra.downstream.find(e=>e.edgeId===r.b.id).available===0?'downstream-full':owners.length?'junction-busy':'admission-window'}));
  }return {seconds,...extra,basis:p.basis,coordinateFrame:'local-east-up-south-metres',nodeId:d.nodeId,ownerId:owners[0]?.id??null,probes,navigationReady:false,realPermissions:'unverified',physicalCollisions:false,elevation:'district-flat-illustrative'};}
 let state=at(0);return {get definition(){return structuredClone(d);},get policy(){return structuredClone(p);},get reservations(){return structuredClone(reservations);},at,update(seconds){state=at(seconds);},get state(){return structuredClone(state);}};
}
