// Generalized City designations, not vegetation, public access, terrain or routing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { localFrame } from '../shared/localFrame.js';
export function validateGreenSpaces(data) {
  const fail=()=>{throw new Error('Invalid green-space context');};
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.bbox)||data.bbox.length!==4||data.bbox.some(v=>!Number.isFinite(v))||data.bbox[0]<-180||data.bbox[2]>180||data.bbox[1]<-90||data.bbox[3]>90||data.bbox[0]>=data.bbox[2]||data.bbox[1]>=data.bbox[3]||!Array.isArray(data.features)||data.features.length>100)fail();
  const ids=new Set();let vertices=0;
  for(const f of data.features){
    if(typeof f.id!=='string'||ids.has(f.id)||typeof f.properties?.AREA_NAME!=='string'||typeof f.properties?.AREA_CLASS!=='string')fail();ids.add(f.id);
    const polygons=f.geometry?.type==='Polygon'?[f.geometry.coordinates]:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:null;
    if(!Array.isArray(polygons)||!polygons.length)fail();
    for(const polygon of polygons){if(!Array.isArray(polygon)||!polygon.length)fail();for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<4)fail();vertices+=ring.length;
      for(const p of ring)if(!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))||p[0]<data.bbox[0]-1e-9||p[0]>data.bbox[2]+1e-9||p[1]<data.bbox[1]-1e-9||p[1]>data.bbox[3]+1e-9)fail();
      const [x0,y0]=ring[0];const area=ring.slice(1).reduce((n,b,i)=>n+(ring[i][0]-x0)*(b[1]-y0)-(b[0]-x0)*(ring[i][1]-y0),0);if(!Number.isFinite(area)||Math.abs(area)<1e-18)fail();
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])fail();
    }}
  }
  if(vertices>15000)fail();return data;
}
export function greenSpaceFocus(data,name,profile) {
  const f=data.features.find(f=>f.properties.AREA_NAME===name);if(!f)throw Error('Green-space focus unavailable');
  const points=(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).flat(2);
  const lon=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2;
  const lat=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
  return localFrame(profile.geoOrigin).project(lon,lat);
}
export function addGreenSpaces(scene,data,profile) {
  validateGreenSpaces(data);const frame=localFrame(profile.geoOrigin),geometries=[];
  for(const f of data.features){
    const kind=f.properties.AREA_CLASS,color=new THREE.Color(kind==='Park'||kind==='Open Green Space'?0x678361:kind==='Civic Centre Square'?0x9b937f:0x83918b);
    for(const polygon of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates){
      const ring=r=>r.slice(0,-1).map(p=>{const [x,z]=frame.project(...p);return new THREE.Vector2(x,-z);});
      const shape=new THREE.Shape(ring(polygon[0]));for(const hole of polygon.slice(1))shape.holes.push(new THREE.Path(ring(hole)));
      const g=new THREE.ShapeGeometry(shape).toNonIndexed();g.rotateX(-Math.PI/2);g.translate(0,-.04,0);
      const colors=new Float32Array(g.attributes.position.count*3);for(let i=0;i<colors.length;i+=3)color.toArray(colors,i);g.setAttribute('color',new THREE.BufferAttribute(colors,3));geometries.push(g);
    }
  }
  const group=new THREE.Group();group.name='officialGreenSpaces';
  if(geometries.length){const merged=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});const mesh=new THREE.Mesh(merged,material);mesh.receiveShadow=true;group.add(mesh);}
  group.userData={basis:'generalized City green-space designations; illustrative colours',records:data.features.length};scene.add(group);return group;
}
