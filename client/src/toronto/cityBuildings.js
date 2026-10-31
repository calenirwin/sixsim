import {localFrame} from '../shared/localFrame.js';
import * as THREE from 'three';
import {assembleMassingTile} from '../world/massingTile.js';
export function validateCityBuildings(m){
 if(m?.version!==1||m.tile!==512||!m.tiles||Object.keys(m.tiles).length>6000||m.profile?.geoOrigin?.lat!==43.65||m.profile?.geoOrigin?.lon!==-79.397)throw Error('Invalid municipal building manifest');
 let bytes=0,parts=0;for(const [key,t] of Object.entries(m.tiles)){if(!/^-?\d+_-?\d+$/.test(key)||t.f!==key+'.bin'||!Number.isInteger(t.bytes)||t.bytes<=0||t.bytes>2000000||!Number.isInteger(t.b)||t.b<1||t.b>10000||!(/^[a-f0-9]{64}$/).test(t.sha256))throw Error('Invalid municipal building tile');bytes+=t.bytes;parts+=t.b;}
 if(bytes>120000000||bytes!==m.counts?.bytes||parts!==m.counts?.retainedParts)throw Error('Municipal building budget/count mismatch');return m;
}
export class CityBuildings {
 constructor(scene,manifest,{base,fetcher=fetch,assemble=assembleMassingTile,onChange=()=>{}}={}){this.manifest=validateCityBuildings(manifest);this.base=base;this.fetcher=(...args)=>fetcher(...args);this.assemble=assemble;this.onChange=onChange;this.group=new THREE.Group();this.group.name='municipalBuildings';scene.add(this.group);this.tiles=new Map();this.pending=new Map();this.errors=new Map();this.wanted=new Set();this.vertices=0;this.bytes=0;this.enabled=true;this.generation=0;}
 clear(){this.generation++;for(const p of this.pending.values())p.controller.abort();this.pending.clear();for(const key of [...this.tiles.keys()])this.remove(key);this.wanted.clear();}
 remove(key){const t=this.tiles.get(key);if(t){t.data.dispose(this.group);this.vertices-=t.vertices;this.bytes-=t.bytes;this.tiles.delete(key);}}
 retry(){this.errors.clear();}
 update(target,distance){
  const wanted=[];if(this.enabled&&distance<=5000){const x=Math.floor(target.x/512),z=Math.floor(target.z/512);for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const key=`${x+i}_${z+j}`;if(this.manifest.tiles[key])wanted.push(key);}wanted.sort((a,b)=>{const dist=k=>{const [x,z]=k.split('_').map(Number);return Math.hypot((x+.5)*512-target.x,(z+.5)*512-target.z);};return dist(a)-dist(b);});}
  this.wanted=new Set(wanted);for(const key of this.tiles.keys())if(!this.wanted.has(key))this.remove(key);for(const [key,p] of this.pending)if(!this.wanted.has(key)){p.controller.abort();this.pending.delete(key);}
  for(const key of wanted){if(this.pending.size>=2)break;if(!this.tiles.has(key)&&!this.pending.has(key)&&!this.errors.has(key))this.load(key);}
 }
 async load(key){
  const record=this.manifest.tiles[key],controller=new AbortController(),token={controller,generation:this.generation};this.pending.set(key,token);let data=null;
  const current=()=>this.enabled&&this.pending.get(key)===token&&token.generation===this.generation&&this.wanted.has(key)&&!controller.signal.aborted;
  try{const r=await this.fetcher(new URL(record.f,this.base),{signal:controller.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);const bytes=await r.arrayBuffer();if(!current())return;if(bytes.byteLength!==record.bytes)throw Error('Tile byte mismatch');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(sha!==record.sha256)throw Error('Tile checksum mismatch');if(!current())return;
   data=await this.assemble(key,bytes,{profile:this.manifest.profile});const vertices=data.group.children.reduce((n,m)=>n+(m.geometry?.attributes.position.count||0),0);
   if(!current()){data.dispose(this.group);data=null;return;}if(this.bytes+bytes.byteLength>12000000||this.vertices+vertices>1200000){data.dispose(this.group);data=null;throw Error('Nearby geometry budget reached');}
   this.group.add(data.group);this.tiles.set(key,{data,vertices,bytes:bytes.byteLength});this.vertices+=vertices;this.bytes+=bytes.byteLength;data=null;
  }catch(e){if(current()&&e.name!=='AbortError')this.errors.set(key,e.message);if(data)data.dispose(this.group);}finally{if(this.pending.get(key)===token)this.pending.delete(key);this.onChange();}
 }
 get state(){return {tiles:this.tiles.size,pending:this.pending.size,vertices:this.vertices,bytes:this.bytes,errors:[...this.errors.entries()],parts:[...this.tiles.values()].reduce((n,t)=>n+t.data.records.length,0)};}
 dispose(){this.enabled=false;this.clear();this.group.removeFromParent();}
}

export function cityBuildingTiles(m,longitude,latitude,radius=1){
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90||!Number.isInteger(radius)||radius<0||radius>2)throw Error('Invalid municipal building query');
 const [x,z]=localFrame(m.profile.geoOrigin).project(longitude,latitude),tx=Math.floor(x/512),tz=Math.floor(z/512),tiles=[];
 for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){const key=`${tx+i}_${tz+j}`,t=m.tiles[key];if(t)tiles.push({key,...t,bounds:[(tx+i)*512,(tz+j)*512,(tx+i+1)*512,(tz+j+1)*512]});}return tiles;
}
