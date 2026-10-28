import { localFrame } from '../shared/localFrame.js';
export function validateServiceGraph(g) {
  const fail=()=>{throw new Error('Invalid transit graph topology or geometry');};
  const finite=Number.isFinite, coord=p=>p&&finite(p.lon)&&Math.abs(p.lon)<=180&&finite(p.lat)&&Math.abs(p.lat)<=90;
  if(g?.version!==1||g.coordinates!=='EPSG:4326'||!coord(g.geoOrigin))fail();
  const frame=localFrame(g.geoOrigin);
  const map=list=>{if(!Array.isArray(list))fail();const m=new Map();for(const x of list){if(!x||typeof x.id!=='string'||!x.id||m.has(x.id))fail();m.set(x.id,x);}return m;};
  const nodes=map(g.nodes),edges=map(g.edges),patterns=map(g.patterns),usedNodes=new Set(),usedEdges=new Set(),trips=new Set();
  const same=(a,b)=>a.lon===b.lon&&a.lat===b.lat;
  for(const p of patterns.values()){
    if(!Array.isArray(p.nodeIds)||p.nodeIds.length<2||!Array.isArray(p.edgeIds)||p.edgeIds.length!==p.nodeIds.length-1||!Array.isArray(p.tripIds)||!p.tripIds.length)fail();
    for(const id of p.tripIds){if(typeof id!=='string'||trips.has(id))fail();trips.add(id);}
    p.nodeIds.forEach((id,i)=>{
      const n=nodes.get(id);if(!n||usedNodes.has(id)||n.patternId!==p.id||n.occurrence!==i||!coord(n)||!finite(n.sourceDistance)||n.sourceDistance<0)fail();usedNodes.add(id);
      if(!i)return;
      const a=nodes.get(p.nodeIds[i-1]),e=edges.get(p.edgeIds[i-1]);
      if(!e||usedEdges.has(e.id)||e.patternId!==p.id||e.from!==a.id||e.to!==n.id||e.fromDistance!==a.sourceDistance||e.toDistance!==n.sourceDistance||!(e.toDistance>e.fromDistance)||!Array.isArray(e.points)||e.points.length<2)fail();
      let length=0;
      e.points.forEach((v,j)=>{if(!coord(v)||!finite(v.d)||v.d<e.fromDistance||v.d>e.toDistance)fail();if(j){const u=e.points[j-1];if(v.d<u.d||v.d===u.d&&!same(u,v))fail();const x=frame.project(u.lon,u.lat),y=frame.project(v.lon,v.lat);length+=Math.hypot(x[0]-y[0],x[1]-y[1]);}});
      if(!same(e.points[0],a)||!same(e.points.at(-1),n)||e.points[0].d!==e.fromDistance||e.points.at(-1).d!==e.toDistance||!(length>0)||!finite(e.lengthMeters)||Math.abs(length-e.lengthMeters)>.001)fail();
      usedEdges.add(e.id);
    });
  }
  if(usedNodes.size!==nodes.size||usedEdges.size!==edges.size)fail();
  return {nodes,edges,patterns};
}
