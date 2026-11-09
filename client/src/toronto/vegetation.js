import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
// Original illustrative crown; no species, inventory or measured tree dimensions.
// Retain the 80-triangle envelope and share vertices for smooth lobe normals.
export function canopyGeometry({shaped=true}={}){
 const source=new THREE.IcosahedronGeometry(1,1);source.deleteAttribute('normal');source.deleteAttribute('uv');
 const geometry=mergeVertices(source);source.dispose();const p=geometry.attributes.position;
 if(shaped)for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),angle=Math.atan2(z,x),lobe=.88+.12*Math.cos(3*angle+.8*y);
  p.setXYZ(i,x*lobe*(.92+.08*y),y*.95+.04*Math.sin(3*angle)*(1-Math.abs(y)),z*lobe*(.94+.06*Math.sin(2*angle+1)));
 }
 geometry.computeVertexNormals();if(!shaped){const n=geometry.attributes.normal;for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).normalize();n.setXYZ(i,v.x,v.y,v.z);}}geometry.computeBoundingSphere();return geometry;
}

// Extend only the illustrated trunk foot; retain the source centre and trunk top.
// Do not extrapolate over absent terrain or large/ambiguous slopes.
export function trunkContactDrop([x,y,z],sample){
 const centre=sample(x,z);if(centre===null||!Number.isFinite(centre)||Math.abs(centre-y)>.02)return 0;
 let lowest=centre;
 for(let k=0;k<6;k++){const a=k*Math.PI/3,h=sample(x+.28*Math.sin(a),z+.28*Math.cos(a));if(h===null||!Number.isFinite(h))return 0;lowest=Math.min(lowest,h);}
 const gap=y-lowest;if(gap<=.005||gap+.01>.25)return 0;
 return gap+.01;
}
