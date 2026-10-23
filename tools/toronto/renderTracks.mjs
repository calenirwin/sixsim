// Export the shared world's scheduled actors through the inherited ATRK v1 contract.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { torontoWorld } from '../../core/sim/toronto.mjs';
import { writeTracks } from '../../core/tracks/format.mjs';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function exportTorontoTracks() {
  const { world: W, provenance } = await torontoWorld();
  const frames=[], actors=new Map(), ids=new Map(), simTime=[];
  for(let f=0;f<=300;f++) {
    if(f) await W.step(1);
    simTime.push(W.simTime);
    const veh=W.transit.actors.map(a=>{
      if(!ids.has(a.id)) {
        const id=ids.size+1; ids.set(a.id,id);
        actors.set(id,{id,type:'vehicle',kind:'scheduled-trip-marker',sourceId:a.id,tripId:a.tripId,
          routeId:a.routeId,shapeId:a.shapeId,basis:a.basis,elevation:a.elevation,color:0xd78b39,seed:0});
      }
      return {id:ids.get(a.id),x:a.x,y:a.y,z:a.z,q:[0,0,0,1],v:0,spin:0,steer:0,bend:0,lamps:0,flags:0,kind:0};
    });
    frames.push({veh,walk:[],sig:new Uint8Array(),train:[]});
  }
  const header={shot:'510-scheduled',seed:W.seed,dt:1,simTime,profile:PROFILE,rendering:W.renderCapabilities,
    basis:'schedule-derived',serviceDay:W.transit.serviceDay,timezone:W.transit.timezone,startSeconds:28800,
    vehicleKinds:['scheduled-trip-marker'],actors:[...actors.values()],parked:[],signals:[],
    provenance, massingProvenance:JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/provenance.json'))),
    unknownFields:['vehicleDimensions','heading','speed','animation'],
    marker:'Symbol only; no vehicle dimensions, heading, speed or fleet model inferred'};
  const file=path.join(root,'client/.generated/toronto/tracks.atrk');
  const bytes=writeTracks(file,header,frames);
  return {file,bytes,header,frames};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const r=await exportTorontoTracks();console.log(`Toronto ATRK: ${r.frames.length} frames, ${r.bytes} bytes`);
}
