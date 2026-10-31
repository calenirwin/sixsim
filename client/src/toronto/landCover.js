import * as THREE from 'three';
import {localFrame} from '../shared/localFrame.js';
export const COVER_CLASSES=['unknown','tree','grass','bare','water','building','road','other','shrub'];
export const COVER_COLORS=[0,0x567c51,0x8a9b62,0xb2a38b,0x628a9b,0xa59d90,0x747b7c,0x92938b,0x71865a];
export function decodeLandCover(data) {
 const fail=()=>{throw Error('Invalid classified land cover');};
 const {width:w,height:h,bbox:b,runs,counts}=data||{};
 if(data?.version!==1||data.rowOrder!=='north-to-south'||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>400000||!Array.isArray(b)||b.length!==4||b.some(v=>!Number.isFinite(v))||b[0]<-180||b[2]>180||b[1]<-90||b[3]>90||b[0]>=b[2]||b[1]>=b[3]||!Array.isArray(runs)||runs.length%2||runs.length>w*h*2||!Array.isArray(counts)||counts.length!==9)fail();
 for(let i=1;i<9;i++)if(data.classes?.[i]!==COVER_CLASSES[i])fail();
 const cells=new Uint8Array(w*h),actual=Array(9).fill(0);let offset=0;
 for(let i=0;i<runs.length;i+=2){const code=runs[i],n=runs[i+1];if(!Number.isInteger(code)||code<0||code>8||!Number.isInteger(n)||n<1||offset+n>cells.length)fail();cells.fill(code,offset,offset+n);offset+=n;actual[code]+=n;}
 if(offset!==cells.length||actual.some((n,i)=>n!==counts[i]))fail();return cells;
}
export function coverRGBA(data,cells=decodeLandCover(data)) {
 const bytes=new Uint8Array(cells.length*4);
 // Plane north has v=1; DataTexture starts at v=0 (south).
 for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
  const code=cells[y*data.width+x],rgb=COVER_COLORS[code],i=((data.height-1-y)*data.width+x)*4;
  bytes.set([rgb>>16,(rgb>>8)&255,rgb&255,code?255:0],i);
 }return bytes;
}
export function addLandCover(scene,data,profile) {
 const texture=new THREE.DataTexture(coverRGBA(data),data.width,data.height,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const frame=localFrame(profile.geoOrigin),[west,south]=frame.project(data.bbox[0],data.bbox[1]),[east,north]=frame.project(data.bbox[2],data.bbox[3]);
 const geometry=new THREE.PlaneGeometry(east-west,south-north);geometry.rotateX(-Math.PI/2);geometry.translate((west+east)/2,-.03,(south+north)/2);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:1}));mesh.name='classifiedCover2018';mesh.receiveShadow=true;mesh.visible=false;mesh.userData={basis:data.basis,year:2018};scene.add(mesh);return mesh;
}
