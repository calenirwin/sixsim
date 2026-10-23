// Neutral source geometry implementing the existing Streamer tile contract.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseTile, buildingsOf, holesOf } from './tiledata.js';
export async function assembleMassingTile(key, buf, ctx) {
  const tile=parseTile(buf), profile=tile.header.profile;
  if(profile?.id!==ctx.profile.id || profile.geoOrigin.lat!==ctx.profile.geoOrigin.lat || profile.geoOrigin.lon!==ctx.profile.geoOrigin.lon) throw new Error('Tile/profile mismatch');
  const group=new THREE.Group(), holes=holesOf(tile), records=[...buildingsOf(tile,{applyOverrides:false})];
  const material=new THREE.MeshStandardMaterial({color:0x829ba9,roughness:0.85});
  const ring=(start,len)=>Array.from({length:len},(_,i)=>new THREE.Vector2(tile.S.bldgXZ[(start+i)*2],-tile.S.bldgXZ[(start+i)*2+1]));
  const geometries=[];
  for(const b of records) {
    const shape=new THREE.Shape(ring(b.start,b.len));
    for(const h of holes.get(b.i)||[]) shape.holes.push(new THREE.Path(ring(h.start,h.len)));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:b.height,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(tile.header.origin[0],b.baseY,tile.header.origin[1]);
    geometries.push(geometry);
  }
  const merged=mergeGeometries(geometries,false);
  for(const g of geometries)g.dispose();
  const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;
  mesh.userData={records:tile.header.records,source:'City of Toronto massing'};group.add(mesh);
  return {key,group,records,roads:[],nodes:[],
    terrain:{grid:tile.S.terrain,res:tile.header.res,ox:tile.header.origin[0],oz:tile.header.origin[1]},
    surfaceY:()=>null,surfaceInfo:()=>null,roadAt:()=>false,
    dispose(scene){scene.remove(group);for(const mesh of group.children)mesh.geometry.dispose();material.dispose();},
  };
}
