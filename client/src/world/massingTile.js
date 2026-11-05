// Source geometry with explicitly illustrative procedural materials implementing the existing Streamer tile contract.
import {buildingGroundJoins} from '../toronto/buildingGroundJoins.js';
import { illustratedMaterial, massingColor } from '../toronto/appearance.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseTile, buildingsOf, holesOf } from './tiledata.js';
export async function assembleMassingTile(key, buf, ctx) {
  const tile=parseTile(buf), profile=tile.header.profile;
  if(profile?.id!==ctx.profile.id || profile.geoOrigin.lat!==ctx.profile.geoOrigin.lat || profile.geoOrigin.lon!==ctx.profile.geoOrigin.lon) throw new Error('Tile/profile mismatch');
  const group=new THREE.Group(), holes=holesOf(tile), records=[...buildingsOf(tile,{applyOverrides:false})];
  const material=illustratedMaterial();
  const ring=(start,len)=>Array.from({length:len},(_,i)=>new THREE.Vector2(tile.S.bldgXZ[(start+i)*2],-tile.S.bldgXZ[(start+i)*2+1]));
  const geometries=[],footprints=[];let joinMesh=null;
  const clearGroundJoin=()=>{if(joinMesh){joinMesh.geometry.dispose();joinMesh.material.dispose();joinMesh.removeFromParent();joinMesh=null;}};
  for(const b of records) {
    const shape=new THREE.Shape(ring(b.start,b.len));
    const worldRing=(start,len)=>ring(start,len).map(p=>[p.x+tile.header.origin[0],-p.y+tile.header.origin[1]]);
    footprints.push({baseY:b.baseY,rings:[worldRing(b.start,b.len),...(holes.get(b.i)||[]).map(h=>worldRing(h.start,h.len))]});
    for(const h of holes.get(b.i)||[]) shape.holes.push(new THREE.Path(ring(h.start,h.len)));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:b.height,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);geometry.translate(tile.header.origin[0],b.baseY,tile.header.origin[1]);
    const color=massingColor(tile.header.records[b.i].sourceId),colors=new Float32Array(geometry.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3)color.toArray(colors,i);
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('torontoBase',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(b.baseY),1));geometries.push(geometry);
  }
  const merged=mergeGeometries(geometries,false);
  for(const g of geometries)g.dispose();
  const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;
  mesh.userData={records:tile.header.records,source:'City of Toronto massing'};group.add(mesh);
  return {key,group,records,roads:[],nodes:[],
    setGroundJoin(sample,maxVertices=100000){
      material.userData.streetDetail.value=sample?1:0;clearGroundJoin();if(!sample)return {vertices:0};
      const positions=[],stats={segments:0,missing:0,excessive:0,budget:0};
      for(const f of footprints){const r=buildingGroundJoins(f.rings,f.baseY,sample,{maxVertices:maxVertices-positions.length/3});for(const v of r.positions)positions.push(v);for(const k of Object.keys(stats))stats[k]+=r.stats[k];}
      if(positions.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();joinMesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x77766e,roughness:1,side:THREE.DoubleSide}));joinMesh.name='illustrativeGroundPlinths';joinMesh.receiveShadow=true;group.add(joinMesh);}
      return {vertices:positions.length/3,...stats};
    },
    terrain:{grid:tile.S.terrain,res:tile.header.res,ox:tile.header.origin[0],oz:tile.header.origin[1]},
    surfaceY:()=>null,surfaceInfo:()=>null,roadAt:()=>false,
    dispose(scene){clearGroundJoin();scene.remove(group);for(const mesh of group.children)mesh.geometry.dispose();material.dispose();},
  };
}
