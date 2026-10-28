import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Engine } from '../core/engine.js';
import { Streamer } from '../world/streamer.js';
import { ENV } from '../world/materials.js';
import { assembleMassingTile } from '../world/massingTile.js';
import { parseTracks } from '../replay/coreReplay.js';
import { recordingSession, assertComparable } from './recordingSession.js';
import { applyIdentity } from '../shared/identity.js';
import { PROFILE } from './profile.js';
import { addDemoControls } from './demoControls.js';
import { localFrame } from '../shared/localFrame.js';
import { clock } from './transit.js';
import manifest from '../../.generated/toronto/manifest.json';
import network from '../../.generated/toronto/network.json';

import { addSourceNetwork } from './networkScene.js';
const tileUrls=Object.fromEntries(Object.entries(import.meta.glob('../../.generated/toronto/*.bin',{eager:true,query:'?url&no-inline',import:'default'})).map(([file,url])=>[file.split('/').at(-1),url]));
import tracksUrl from '../../.generated/toronto/tracks.atrk?url';
import baselineUrl from '../../.generated/toronto/tracks-baseline.atrk?url';
import dwellUrl from '../../.generated/toronto/tracks-dwell.atrk?url';
import comparison from '../../../tools/toronto/scenarios/510-stop-dwell.json';
export async function start() {
  const query=new URLSearchParams(location.search);
  if(['tiles','cells','lod16'].some(k=>query.has(k))) throw new Error('Toronto selects its own verified tile and asset profile');
  applyIdentity('Toronto');
  document.body.dataset.city='toronto';
  document.querySelector('#loc span').textContent='Toronto';
  document.querySelector('#hood').textContent='Spadina district';
  document.querySelector('#credits').textContent='Contains information licensed under OGL–Toronto. Framework: Valdrada, Mehmet Kerem Turkcan (MIT).';
  document.querySelector('#loading p').textContent='Loading Toronto data';
  const response=await fetch(tracksUrl);if(!response.ok)throw new Error(`Actor tracks: HTTP ${response.status}`);
  let tracks=parseTracks(await response.arrayBuffer()), h=tracks.header;
  let session=recordingSession(tracks,tracksUrl,PROFILE);
  const engine=new Engine(document.querySelector('#app'));
  engine.scene.background=new THREE.Color(0x182330);
  const streamer=await new Streamer(engine.scene,{manifest,profile:PROFILE,cityOverrides:false,assembleTile:assembleMassingTile,assetUrls:tileUrls}).init();
  let {replay,traffic,serviceGraph}=session;engine.scene.add(session.group);
  engine.camera.position.set(550,800,800);engine.camera.lookAt(0,0,-200);
  const controls=new OrbitControls(engine.camera,engine.renderer.domElement);controls.target.set(0,0,-200);controls.maxDistance=2200;controls.minDistance=30;controls.update();
  const grid=new THREE.GridHelper(2560,80,0x607080,0x344454);grid.position.set(0,-0.1,-256);engine.scene.add(grid);
  const contextGroup=addSourceNetwork(engine.scene,network,PROFILE);

  document.querySelector('#help').innerHTML='Drag to orbit · right-drag to pan · scroll/pinch to zoom<br><button id="pause-playback">Pause</button> <button id="restart-playback">Restart</button>';
  document.querySelector('#help').style.pointerEvents='auto';
  for(const id of ['cross','tethers'])document.getElementById(id).style.display='none';
  let elapsed=0,paused=false,failed=false;
  engine.idleNap=()=>paused?250:0;
  controls.addEventListener('change',()=>engine.wake());
  const fail=e=>{if(failed)return;failed=true;engine.holdDraw=true;const l=document.querySelector('#loading');l.style.display='flex';l.style.opacity='1';l.querySelector('p').textContent=`Unable to load city: ${e.message}. Reload to retry.`;};
  engine.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();fail(new Error('Graphics context lost'));});
  let demoControls;
  const setPaused=value=>{paused=!!value;engine.wake();document.querySelector('#pause-playback').textContent=paused?'Play':'Pause';};
  const seek=t=>{if(!Number.isFinite(t)||t<0||t>h.simTime.at(-1))throw new Error('Time outside recorded schedule');elapsed=t;ENV.time.value=t;traffic.update(0);serviceGraph.update(replay.f);demoControls?.update(t);engine.wake();};
  const togglePause=()=>setPaused(!paused);
  document.querySelector('#pause-playback').onclick=togglePause;
  document.querySelector('#restart-playback').onclick=()=>seek(0);
  addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/INPUT|BUTTON|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();togglePause();}if(e.code==='KeyR')seek(0);});
  const reference=h, urls={baseline:baselineUrl,dwell:dwellUrl,custom:tracksUrl},cache=new Map();
  let mode=h.transitScenario?'custom':'baseline',request=0;
  cache.set(mode,tracks);
  const selectRecording=async next=>{
    if(!Object.hasOwn(urls,next))throw new Error('Unknown recording');
    const token=++request;setPaused(true);
    let candidate=cache.get(next);
    if(!candidate){const r=await fetch(urls[next],{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Recording: HTTP ${r.status}`);candidate=parseTracks(await r.arrayBuffer());}
    if(token!==request)return;
    assertComparable(reference,candidate.header);setPaused(true);
    const replacement=recordingSession(candidate,urls[next],PROFILE);
    try {ENV.time.value=elapsed;replacement.traffic.update(0);replacement.serviceGraph.update(replacement.replay.f);}
    catch(error){replacement.dispose();throw error;}
    engine.scene.add(replacement.group);session.dispose();session=replacement;
    ({tracks,h,replay,traffic,serviceGraph}=session);mode=next;cache.set(next,tracks);
    Object.assign(window.__APP,{tracks,replay,traffic,serviceGraph});demoControls.setHeader(h);engine.wake();
  };
  const comparisonState=()=>{
    const actor=h.actors.find(a=>a.tripId===comparison.tripId),vehicle=tracks.frames[replay.f]?.veh.find(v=>v.id===actor?.id);
    const row=serviceGraph.occupancy.find(r=>r[0]===actor?.id),deviation=serviceGraph.deviations.find(d=>d.actorId===actor?.id);
    return {tripId:comparison.tripId,vehicle,phase:row?(row[1]?'at stop':'on link'):'outside recording time',delay:deviation?.departureDelaySeconds||0};
  };
  demoControls=addDemoControls({seek,setPaused,duration:h.simTime.at(-1),geoFrame:localFrame(PROFILE.geoOrigin),controls,engine,header:h,mode,selectRecording,comparisonState});
  window.__APP={engine,renderer:engine.renderer,scene:engine.scene,streamer,replay,traffic,profile:PROFILE,network,contextGroup,serviceGraph,controls,tracks,seek,setPaused};
  engine.onFrame=dt=>{
    if(failed)return;
    if(streamer.error){fail(streamer.error);return;}
    controls.target.x=Math.max(manifest.bounds[0],Math.min(manifest.bounds[2],controls.target.x));
    controls.target.z=Math.max(manifest.bounds[1],Math.min(manifest.bounds[3],controls.target.z));
    streamer.update(controls.target.x,controls.target.z);
    if(!paused)elapsed=Math.min(h.simTime.at(-1),elapsed+dt);
    ENV.time.value=elapsed;traffic.update(dt);serviceGraph.update(replay.f);demoControls.update(elapsed);controls.update();
    document.querySelector('#stats').textContent=`${clock(h.startSeconds+elapsed)} · scheduled-trip markers, not live vehicles${h.transitScenario?.extraDwellSeconds ? " · +60s dwell experiment" : ""} · flat ground`;
    if(streamer.tiles.get('0_0')?.state==='ready')document.querySelector('#loading').style.display='none';
  };
}
