import source from '../../fixtures/toronto/next-node-access.json' with {type:'json'};
// Topology evidence never grants a turn, access right or signal phase.
export function nextNodeAccess(input=source){
 const d=structuredClone(input),fail=()=>{throw Error('Invalid next-node source evidence');};
 if(d?.version!==1||d.coordinateSystem!=='EPSG:4326'||!Array.isArray(d.nodes)||d.nodes.length!==2||JSON.stringify(d.provenance)!==JSON.stringify(source.provenance)||JSON.stringify(d.missingEvidence)!==JSON.stringify(source.missingEvidence))fail();
 const seenNodes=new Set(),nodes=d.nodes.map(n=>{
  if(!Number.isSafeInteger(n.nodeId)||n.nodeId<=0||seenNodes.has(n.nodeId)||!Number.isSafeInteger(n.incomingEdgeId)||n.incomingEdgeId<=0||!Array.isArray(n.coordinate)||n.coordinate.length!==2||!n.coordinate.every(Number.isFinite)||!Array.isArray(n.records)||n.records.length<1||n.records.length>16)fail();seenNodes.add(n.nodeId);
  const seen=new Set(),incoming=n.records.find(e=>e.id===n.incomingEdgeId);if(!incoming||incoming.toNode!==n.nodeId)fail();
  const movements=n.records.map(e=>{
   const direction=e.rawDirection===null?0:e.rawDirection;
   if(!Number.isSafeInteger(e.id)||e.id<=0||seen.has(e.id)||!Number.isSafeInteger(e.fromNode)||!Number.isSafeInteger(e.toNode)||e.toNode<=0||e.fromNode<=0||e.fromNode===e.toNode||![0,1,-1].includes(direction)||e.directionDescription!==({'0':'Not One-Way','1':'Follow-Digitization','-1':'Against-Digitization'})[direction]||typeof e.name!=='string'||!e.name||e.jurisdiction!=='CITY OF TORONTO'||typeof e.featureClass!=='string'||!Array.isArray(e.points)||e.points.length<2||e.points.length>10000)fail();seen.add(e.id);
   for(const p of e.points)if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<-80||p[0]>-79||p[1]<43||p[1]>44)fail();
   const forward=e.fromNode===n.nodeId;if(!forward&&e.toNode!==n.nodeId)fail();if(JSON.stringify(forward?e.points[0]:e.points.at(-1))!==JSON.stringify(n.coordinate))fail();
   const directionSupported=forward?direction!==-1:direction!==1,returns=e.id===n.incomingEdgeId;
   return {edgeId:e.id,name:e.name,fromNode:n.nodeId,toNode:forward?e.toNode:e.fromNode,orientation:forward?'forward':'reverse',directionSupported,returnOnIncomingEdge:returns,topologyCandidate:directionSupported&&!returns,permission:'unknown',mayAdvance:false,reason:!directionSupported?'against-source-direction':returns?'return-movement-unverified':'turn-and-access-unverified',directionEvidence:{rawCode:e.rawDirection,description:e.directionDescription},jurisdiction:e.jurisdiction};
  }).sort((a,b)=>a.edgeId-b.edgeId);
  return {nodeId:n.nodeId,incomingEdgeId:n.incomingEdgeId,coordinate:n.coordinate,holdReason:'next-node-permission-unverified',mayAdvance:false,movements};
 }).sort((a,b)=>a.nodeId-b.nodeId);
 return {version:1,basis:'pinned-source-direction-and-connectivity',permission:'unknown',mayAdvance:false,missingEvidence:d.missingEvidence,provenance:d.provenance,nodes};
}
export function validateNextNodeAccess(value){if(JSON.stringify(value)!==JSON.stringify(nextNodeAccess()))throw Error('Next-node access evidence mismatch');return structuredClone(value);}
