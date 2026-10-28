import * as THREE from 'three';
import { validateScenarioReplay } from './scenarioReplay.js';
import { validateServiceGraph } from './validateServiceGraph.js';
import { localFrame } from '../shared/localFrame.js';
// A replay of graph occupancy from the world, never a browser-side route inference.
export function addServiceGraph(scene,tracks,profile) {
  const {transitGraph:g,transitFrames:frames}=tracks.header;
  if(g?.version!==1||g.coordinates!=='EPSG:4326'||g.geoOrigin.lat!==profile.geoOrigin.lat||g.geoOrigin.lon!==profile.geoOrigin.lon||frames?.length!==tracks.frames.length)throw new Error('Invalid transit graph replay');
  const {nodes,edges,patterns}=validateServiceGraph(g);
  validateScenarioReplay(tracks.header,patterns,nodes);
  const actors=new Map();
  for(const actor of tracks.header.actors||[]){
    const p=patterns.get(actor.patternId);
    if(actors.has(actor.id)||!p||!p.tripIds.includes(actor.tripId)||p.routeId!==actor.routeId||p.shapeId!==actor.shapeId)throw new Error('Invalid transit actor pattern');
    actors.set(actor.id,actor);
  }
  for(let i=0;i<frames.length;i++) {
    const ids=new Set(tracks.frames[i].veh.map(a=>a.id)),seen=new Set();
    if(ids.size!==tracks.frames[i].veh.length)throw new Error('Duplicate transit replay actor');
    for(const [id,nodeId,edgeId,progress] of frames[i]) {
      if(!ids.has(id)||seen.has(id)||!Number.isFinite(progress)||progress<0||progress>1||Boolean(nodeId)===Boolean(edgeId)||nodeId&&!nodes.has(nodeId)||edgeId&&!edges.has(edgeId))throw new Error('Invalid transit graph occupancy');
      const element=nodes.get(nodeId)||edges.get(edgeId),actor=actors.get(id);
      if(!actor||actor.patternId!==element.patternId||nodeId&&progress!==0)throw new Error('Invalid transit actor occupancy pattern');
      seen.add(id);
    }
    if(seen.size!==ids.size)throw new Error('Incomplete transit graph occupancy');
  }
  const frame=localFrame(profile.geoOrigin),group=new THREE.Group(),meshes=new Map();group.name='scheduledServiceGraph';
  const material=new THREE.LineBasicMaterial({color:0x75cfc4});
  for(const edge of g.edges) {
    const points=edge.points.map(p=>{const [x,z]=frame.project(p.lon,p.lat);return new THREE.Vector3(x,.45,z);});
    const mesh=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material);mesh.name=edge.id;mesh.visible=false;group.add(mesh);meshes.set(edge.id,mesh);
  }
  scene.add(group);
  const state={group,graph:g,frame:-1,occupancy:[],deviations:[],scenario:tracks.header.transitScenario||null,update(index){
    if(index===state.frame)return;
    state.frame=index;state.occupancy=frames[index];
    state.deviations=state.occupancy.flatMap(([id,nodeId,edgeId])=>{
      if(!state.scenario?.extraDwellSeconds||actors.get(id).tripId!==state.scenario.tripId)return [];
      const node=nodes.get(nodeId||edges.get(edgeId).from);
      return [{actorId:id,...tracks.header.transitDeviations[node.occurrence]}];
    });
    const active=new Set(state.occupancy.map(r=>r[2]).filter(Boolean));
    for(const [id,mesh] of meshes)mesh.visible=active.has(id);
  }};
  return state;
}
