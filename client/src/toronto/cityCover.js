import * as THREE from 'three';
import {terrainPatch} from './cityTerrain.js';
import {COVER_COLORS,COVER_CLASSES} from './landCover.js';
export function validateCityCover(m){
 if(m?.version!==1||m.year!==2018||m.tile!==1024||m.step!==16||m.side!==64||m.rowOrder!=='north-to-south'||m.origin?.[0]!==-19520||m.origin?.[1]!==-22848||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<64||m.height<64||m.width%64||m.height%64||m.width*m.height>6000000||!m.tiles||Object.keys(m.tiles).length>1500)throw Error('Invalid municipal classified cover');
 for(let c=0;c<10;c++)if(m.classes?.[c]!==(c===9?'conflict':COVER_CLASSES[c]))throw Error('Invalid cover class');
 let inside=0;for(const [key,t] of Object.entries(m.tiles)){const [i,j]=key.split('_').map(Number);if(!/^\d+_\d+$/.test(key)||i*64>=m.width||j*64>=m.height||t.f!==key+'.u8'||t.bytes!==4096||!(/^[a-f0-9]{64}$/).test(t.sha256)||!Array.isArray(t.counts)||t.counts.length!==10||t.counts.some(n=>!Number.isInteger(n)||n<0)||t.counts.reduce((a,b)=>a+b,0)!==4096||!Number.isInteger(t.insideCells)||t.insideCells<1||t.insideCells>4096)throw Error('Invalid cover tile');inside+=t.insideCells;}
 if(inside!==m.insideCells||!Array.isArray(m.counts)||m.counts.length!==10||m.counts.some(n=>!Number.isInteger(n)||n<0)||m.counts.reduce((a,b)=>a+b,0)!==inside)throw Error('Invalid cover coverage');return m;
}
export function validateCoverTerrain(m,terrain){
 if(m.terrainSha256!==terrain.heightSha256||m.boundarySha256!==terrain.boundarySha256||m.origin.some((v,i)=>v!==terrain.origin[i])||m.width!==Math.ceil((terrain.width-1)/16)*64||m.height!==Math.ceil((terrain.height-1)/16)*64)throw Error('Cover terrain mismatch');
}
export function coverTileCells(buffer,record){
 if(buffer.byteLength!==4096)throw Error('Cover tile byte mismatch');const cells=new Uint8Array(buffer),counts=Array(10).fill(0);for(const c of cells){if(c>9)throw Error('Invalid cover class');counts[c]++;}if(counts.some((n,i)=>n!==record.counts[i]))throw Error('Cover tile count mismatch');return cells;
}
export function cityCoverMesh(grid,key,cells){
 const [i,j]=key.split('_').map(Number),geometry=terrainPatch(grid,i*16,j*16,16),uv=[];
 for(let y=0;y<=16;y++)for(let x=0;x<=16;x++)uv.push(x/16,1-y/16);geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 const pixels=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const c=cells[y*64+x],rgb=COVER_COLORS[c]||0,k=((63-y)*64+x)*4;pixels.set([rgb>>16,(rgb>>8)&255,rgb&255,c>0&&c<9?255:0],k);}
 const texture=new THREE.DataTexture(pixels,64,64,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,roughness:1,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,material);mesh.name='municipalClassifiedCover2018';mesh.receiveShadow=true;mesh.renderOrder=1;
 return {mesh,dispose(){geometry.dispose();material.dispose();texture.dispose();mesh.removeFromParent();}};
}
export class CityCover {
 constructor(scene,manifest,grid,{base,fetcher=fetch,assemble=cityCoverMesh,onChange=()=>{}}={}){
  this.manifest=validateCityCover(manifest);validateCoverTerrain(manifest,grid.meta);this.grid=grid;this.base=base;this.fetcher=(...a)=>fetcher(...a);this.assemble=assemble;this.onChange=onChange;this.group=new THREE.Group();this.group.name='municipalCover2018';scene.add(this.group);this.tiles=new Map();this.pending=new Map();this.errors=new Map();this.wanted=new Set();this.enabled=false;this.generation=0;
 }
 clear(){this.generation++;for(const p of this.pending.values())p.controller.abort();this.pending.clear();for(const t of this.tiles.values())t.dispose();this.tiles.clear();this.wanted.clear();this.errors.clear();}
 retry(){this.errors.clear();}
 update(target,distance){
  const keys=[];if(this.enabled&&distance<=5000){const i=Math.floor((target.x-this.manifest.origin[0])/1024),j=Math.floor((target.z-this.manifest.origin[1])/1024);for(let y=j-2;y<=j+2;y++)for(let x=i-2;x<=i+2;x++){const k=`${x}_${y}`;if(this.manifest.tiles[k])keys.push(k);}keys.sort((a,b)=>{const d=k=>{const [x,y]=k.split('_').map(Number);return (x-i)**2+(y-j)**2;};return d(a)-d(b);});}
  this.wanted=new Set(keys);for(const [k,t] of this.tiles)if(!this.wanted.has(k)){t.dispose();this.tiles.delete(k);}for(const [k,p] of this.pending)if(!this.wanted.has(k)){p.controller.abort();this.pending.delete(k);}
  for(const k of keys){if(this.pending.size>=2)break;if(!this.tiles.has(k)&&!this.pending.has(k)&&!this.errors.has(k))this.load(k);}
 }
 async load(key){
  const controller=new AbortController(),token={controller,generation:this.generation};this.pending.set(key,token);const current=()=>this.enabled&&this.generation===token.generation&&this.pending.get(key)===token&&this.wanted.has(key)&&!controller.signal.aborted;let data;
  try{const t=this.manifest.tiles[key],r=await this.fetcher(new URL(t.f,this.base),{signal:controller.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);const bytes=await r.arrayBuffer();if(!current())return;const cells=coverTileCells(bytes,t);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==t.sha256)throw Error('Cover checksum mismatch');if(!current())return;data=this.assemble(this.grid,key,cells);if(!current()){data.dispose();data=null;return;}this.group.add(data.mesh);this.tiles.set(key,data);data=null;
  }catch(e){if(current()&&e.name!=='AbortError')this.errors.set(key,e.message);data?.dispose();}finally{if(this.pending.get(key)===token)this.pending.delete(key);this.onChange();}
 }
 get state(){return {tiles:this.tiles.size,pending:this.pending.size,textureBytes:this.tiles.size*16384,triangles:[...this.tiles.values()].reduce((n,t)=>n+t.mesh.geometry.index.count/3,0),errors:[...this.errors.entries()].filter(([key])=>this.wanted.has(key))};}
 dispose(){this.enabled=false;this.clear();this.group.removeFromParent();}
}
