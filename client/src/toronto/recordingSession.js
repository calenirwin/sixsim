import { validateDepartures } from './departures.js';
import * as THREE from 'three';
import { createCoreReplay } from '../replay/coreReplay.js';
import { scheduledMarkerPool } from '../replay/scheduledMarkers.js';
import { addServiceGraph } from './serviceGraphScene.js';
export function assertComparable(reference,candidate) {
  for(const key of ['serviceDay','timezone','startSeconds','profile','rendering','simTime','transitGraph','massingProvenance','provenance']) {
    if(JSON.stringify(reference[key])!==JSON.stringify(candidate[key]))throw new Error(`Recording comparison mismatch: ${key}`);
  }
}
// Prepare a complete replacement off-scene. A failed validation leaves the old scene intact.
export function recordingSession(tracks,url,profile) {
  const h=tracks.header;
  if(h.profile?.id!==profile.id||h.profile.geoOrigin.lat!==profile.geoOrigin.lat||h.profile.geoOrigin.lon!==profile.geoOrigin.lon||h.rendering?.assetProfile!=='toronto-massing-scheduled'||h.rendering?.browserReplay!=='atrk/1'||h.vehicleKinds?.join()!=='scheduled-trip-marker')throw new Error('Actor/asset profile mismatch');
  const group=new THREE.Group();group.name='scheduledRecording';
  const serviceGraph=addServiceGraph(group,tracks,profile);
  let traffic;
  try {
    validateDepartures(h.transitDepartures,h);
    const replay=createCoreReplay(tracks,url);traffic=scheduledMarkerPool(group,h.actors.length);replay.attachTraffic(traffic);
    return {group,tracks,h,replay,traffic,serviceGraph,dispose(){group.removeFromParent();traffic.dispose();serviceGraph.dispose();}};
  } catch(error){traffic?.dispose();serviceGraph.dispose();throw error;}
}
