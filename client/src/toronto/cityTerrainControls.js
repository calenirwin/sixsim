import {terrainGrid,terrainRenderer} from './cityTerrain.js';
import {localFrame} from '../shared/localFrame.js';
import meta from '../../fixtures/toronto/city-terrain/manifest.json';
import gridUrl from '../../fixtures/toronto/city-terrain/heights.f32?url';
export function cityTerrainControls({engine,controls,setPaused,profile}) {
 const panel=document.createElement('div');panel.id='city-terrain-controls';document.querySelector('#help').append(panel);
 const button=document.createElement('button');button.id='toggle-city-terrain';button.textContent='City terrain · 2023';panel.append(button);
 const status=document.createElement('div');status.id='city-terrain-status';status.setAttribute('role','status');panel.append(status);
 const places=document.createElement('div');places.hidden=true;panel.append(places);
 let terrain=null,active=false,saved=null;const frame=localFrame(profile.geoOrigin);
 const focus=(lon,lat,overview=false)=>{const [x,z]=frame.project(lon,lat),y=terrain.grid.sample(x,z)??100;controls.target.set(x,y,z);engine.camera.position.set(x+(overview?15000:1800),y+(overview?30000:2200),z+(overview?18000:2500));controls.update();engine.wake();};
 for(const [label,lon,lat,overview] of [['Toronto overview',-79.377,43.72,true],['Etobicoke terrain',-79.55,43.68,false],['North York terrain',-79.414,43.76,false],['Scarborough terrain',-79.25,43.77,false]]){const b=document.createElement('button');b.textContent=label;b.dataset.terrainPlace=label;b.onclick=()=>focus(lon,lat,overview);places.append(b);}
 button.onclick=async()=>{
  if(active){active=false;terrain.group.visible=false;for(const [o,visible] of saved.objects)o.visible=visible;for(const [b,disabled,hidden] of saved.buttons){b.disabled=disabled;b.hidden=hidden;}for(const [o,inert,hidden] of saved.rows){o.inert=inert;o.hidden=hidden;}controls.maxDistance=saved.maxDistance;engine.camera.far=saved.far;engine.camera.near=saved.near;engine.camera.updateProjectionMatrix();engine.camera.position.copy(saved.camera);controls.target.copy(saved.target);controls.update();places.hidden=true;status.textContent='';button.textContent='City terrain · 2023';document.querySelector('#hood').textContent='Spadina district';engine.wake();return;}
  button.disabled=true;status.textContent='Loading municipal terrain…';
  try{
   if(!terrain){const r=await fetch(gridUrl);if(!r.ok)throw Error(`Terrain HTTP ${r.status}`);const bytes=await r.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==meta.heightSha256)throw Error('Terrain checksum mismatch');terrain=terrainRenderer(engine.scene,terrainGrid(meta,bytes));terrain.group.visible=false;}
   setPaused(true);saved={camera:engine.camera.position.clone(),target:controls.target.clone(),far:engine.camera.far,near:engine.camera.near,maxDistance:controls.maxDistance,objects:engine.scene.children.filter(o=>o!==terrain.group&&!o.isLight).map(o=>[o,o.visible]),buttons:[...document.querySelectorAll('#help button')].filter(b=>!panel.contains(b)).map(b=>[b,b.disabled,b.hidden]),rows:[...document.querySelectorAll('.toronto-demo-controls')].map(o=>[o,o.inert,o.hidden])};
   for(const [o] of saved.objects)o.visible=false;for(const [b] of saved.buttons){b.disabled=true;b.hidden=true;}for(const [o] of saved.rows){o.inert=true;o.hidden=true;}
   active=true;terrain.group.visible=true;controls.maxDistance=65000;engine.camera.near=5;engine.camera.far=120000;engine.camera.updateProjectionMatrix();places.hidden=false;button.textContent='Return to district simulation';document.querySelector('#hood').textContent='Municipal terrain';
   status.textContent='2023 bare earth · CGVD2013 metres · 64 m samples / 512 m overview. Terrain inspection only: buildings, cover and 510 simulation remain district-scoped and flat. Colours indicate elevation, not land cover. No water fill or missing-height extrapolation.';
   status.style.maxWidth='440px';focus(-79.377,43.72,true);
  }catch(e){status.textContent=`Terrain unavailable: ${e.message}. District retained.`;}finally{button.disabled=false;}
 };
 return {get active(){return active;},get terrain(){return terrain;},update(){if(active){for(const o of engine.scene.children)if(o!==terrain.group&&!o.isLight&&!saved.objects.some(([p])=>p===o)){saved.objects.push([o,o.visible]);o.visible=false;}terrain.update(controls.target,engine.camera.position.distanceTo(controls.target));}}};
}
