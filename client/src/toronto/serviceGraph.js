// Directed GTFS service paths, not surveyed rails, legal turns or lane topology.
import { localFrame } from '../shared/localFrame.js';
function at(points,d) {
  for(let i=1;i<points.length;i++)if(d<=points[i].d){const a=points[i-1],b=points[i],u=b.d===a.d?0:(d-a.d)/(b.d-a.d);return {d,lon:a.lon+u*(b.lon-a.lon),lat:a.lat+u*(b.lat-a.lat)};}
  return {...points.at(-1),d};
}
export function buildServiceGraph(schedule,{geoOrigin,serviceDay,sourceSha256,maxStopOffsetMeters=25}={}) {
  if(!Number.isFinite(maxStopOffsetMeters)||maxStopOffsetMeters<0)throw new Error('Invalid stop anchoring tolerance');
  const frame=localFrame(geoOrigin), groups=new Map(), bindings=new Map(), omissions=[];
  for(const trip of [...schedule.trips].sort((a,b)=>a.trip_id.localeCompare(b.trip_id))) {
    if(!trip.shape){omissions.push({tripId:trip.trip_id,reason:'missing-or-unusable-shape'});continue;}
    let reason=null;
    for(let i=1;i<trip.shape.length;i++) {
      const a=trip.shape[i-1],b=trip.shape[i];
      if(a.d===b.d && (a.lon!==b.lon||a.lat!==b.lat))reason='discontinuous-shape-distance';
    }
    for(let i=0;i<trip.times.length;i++) {
      const t=trip.times[i],p=at(trip.shape,t.d),stop=schedule.stops.get(t.stop_id),a=frame.project(p.lon,p.lat),b=frame.project(Number(stop.stop_lon),Number(stop.stop_lat));
      if(Math.hypot(a[0]-b[0],a[1]-b[1])>maxStopOffsetMeters)reason='stop-off-shape';
      if(i && t.d<=trip.times[i-1].d)reason='nonpositive-stop-link';
      if(i && t.a<=trip.times[i-1].b)reason='nonpositive-link-duration';
    }
    if(reason){omissions.push({tripId:trip.trip_id,reason});continue;}
    const key=JSON.stringify([trip.route_id,trip.direction_id,trip.shape_id,trip.times.map(t=>[t.stop_id,t.d])]);
    const group=groups.get(key)||[];group.push(trip);groups.set(key,group);
  }
  const nodes=[],edges=[],patterns=[];
  for(const [key,trips] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const trip=trips[0],id=`pattern:${patterns.length}`,nodeIds=[],edgeIds=[];
    trip.times.forEach((t,i)=>{
      const p=at(trip.shape,t.d),nodeId=`${id}:stop:${i}`;nodeIds.push(nodeId);
      nodes.push({id:nodeId,patternId:id,stopId:t.stop_id,occurrence:i,sourceDistance:t.d,lon:p.lon,lat:p.lat});
      if(!i)return;
      const from=trip.times[i-1].d,points=[at(trip.shape,from),...trip.shape.filter(p=>p.d>from&&p.d<t.d).map(({d,lon,lat})=>({d,lon,lat})),at(trip.shape,t.d)];
      let lengthMeters=0;for(let j=1;j<points.length;j++){const a=frame.project(points[j-1].lon,points[j-1].lat),b=frame.project(points[j].lon,points[j].lat);lengthMeters+=Math.hypot(a[0]-b[0],a[1]-b[1]);}
      if(!(lengthMeters>0))throw new Error('Service edge has no geometric extent');
      const edgeId=`${id}:link:${i-1}`;edgeIds.push(edgeId);
      edges.push({id:edgeId,patternId:id,from:nodeIds[i-1],to:nodeId,fromDistance:from,toDistance:t.d,lengthMeters,points});
    });
    patterns.push({id,routeId:trip.route_id,directionId:trip.direction_id,shapeId:trip.shape_id,nodeIds,edgeIds});
    for(const t of trips)bindings.set(t.trip_id,{trip:t,patternId:id,nodeIds,edgeIds});
  }
  const graph={version:1,basis:'GTFS directed service graph',coordinates:'EPSG:4326',sourceDistanceUnits:'GTFS shape_dist_traveled source units',lengthUnits:'metres in the local geographic frame',serviceDay,sourceSha256,geoOrigin,maxStopOffsetMeters,nodes,edges,patterns,limits:['No surveyed track or lane accuracy','No connections inferred at crossings or between patterns','No collision, capacity, signal or live-vehicle model']};
  const nodeMap=new Map(nodes.map(n=>[n.id,n])),edgeMap=new Map(edges.map(e=>[e.id,e]));
  return {graph,bindings,omissions,nodeMap,edgeMap};
}
export function graphPosition(compiled,tripId,seconds) {
  const binding=compiled.bindings.get(tripId);if(!binding||!Number.isFinite(seconds))return null;
  const {trip,nodeIds,edgeIds,patternId}=binding,ts=trip.times;
  if(seconds<ts[0].a||seconds>ts.at(-1).b)return null;
  for(let i=0;i<ts.length;i++) {
    if(seconds<=ts[i].b) {
      const node=compiled.nodeMap.get(nodeIds[i]);if(!node)throw new Error('Missing service node');
      return {lon:node.lon,lat:node.lat,patternId,phase:'dwell',nodeId:node.id,edgeId:null,progress:0};
    }
    if(i+1<ts.length && seconds<ts[i+1].a) {
      const edge=compiled.edgeMap.get(edgeIds[i]);
      if(!edge||edge.from!==nodeIds[i]||edge.to!==nodeIds[i+1]||edge.patternId!==patternId)throw new Error('Disconnected service path');
      const progress=(seconds-ts[i].b)/(ts[i+1].a-ts[i].b),p=at(edge.points,edge.fromDistance+progress*(edge.toDistance-edge.fromDistance));
      return {lon:p.lon,lat:p.lat,patternId,phase:'moving',nodeId:null,edgeId:edge.id,progress};
    }
  }
  throw new Error('Unresolved service state');
}
