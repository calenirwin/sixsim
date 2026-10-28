// Export the shared world's scheduled actors through the inherited ATRK v1 contract.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { torontoWorld } from '../../core/sim/toronto.mjs';
import { writeTracks } from '../../core/tracks/format.mjs';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function exportTorontoTracks(options = {}, outputName = 'tracks.atrk') {
  if(!['tracks.atrk','tracks-baseline.atrk','tracks-dwell.atrk'].includes(outputName))throw new Error('Unsupported recording output');
  const { world: W, provenance } = await torontoWorld(options);
  const startSeconds=W.transit.serviceSeconds;
  const frames=[], actors=new Map(), ids=new Map(), simTime=[], transitFrames=[];
  for(let f=0;f<=300;f++) {
    if(f) await W.step(1);
    simTime.push(W.simTime);
    const veh=W.transit.actors.map(a=>{
      if(!ids.has(a.id)) {
        const id=ids.size+1; ids.set(a.id,id);
        actors.set(id,{id,type:'vehicle',kind:'scheduled-trip-marker',sourceId:a.id,tripId:a.tripId,
          patternId:a.graph.patternId,routeId:a.routeId,shapeId:a.shapeId,basis:a.basis,elevation:a.elevation,color:0xd78b39,seed:0});
      }
      return {id:ids.get(a.id),x:a.x,y:a.y,z:a.z,q:[0,0,0,1],v:0,spin:0,steer:0,bend:0,lamps:0,flags:0,kind:0};
    });
    transitFrames.push(W.transit.actors.map(a=>[ids.get(a.id),a.graph.nodeId,a.graph.edgeId,a.graph.progress]));
    frames.push({veh,walk:[],sig:new Uint8Array(),train:[]});
  }
  const header={shot:'510-scheduled',seed:W.seed,dt:1,simTime,profile:PROFILE,rendering:W.renderCapabilities,
    transitGraph:W.transit.graph,transitFrames,transitScenario:W.transit.scenario,transitDeviations:W.transit.deviations,
    basis:'schedule-derived',serviceDay:W.transit.serviceDay,timezone:W.transit.timezone,startSeconds,
    vehicleKinds:['scheduled-trip-marker'],actors:[...actors.values()],parked:[],signals:[],
    provenance, massingProvenance:JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/district-provenance.json'))),
    unknownFields:['vehicleDimensions','heading','speed','animation'],
    marker:'Symbol only; no vehicle dimensions, heading, speed or fleet model inferred'};
  const file=path.join(root,'client/.generated/toronto',outputName);
  const bytes=writeTracks(file,header,frames);
  return {file,bytes,header,frames};
}
export async function exportTorontoComparison() {
  const scenario=JSON.parse(fs.readFileSync(path.join(root,'tools/toronto/scenarios/510-stop-dwell.json')));
  const baseline=await exportTorontoTracks({scenario:null},'tracks-baseline.atrk');
  const dwell=await exportTorontoTracks({scenario},'tracks-dwell.atrk');
  return {baseline,dwell};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=await exportTorontoTracks();await exportTorontoComparison();console.log(`Toronto ATRK: ${r.frames.length} frames, ${r.bytes} bytes`);
}
