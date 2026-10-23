import * as THREE from 'three';
import { localFrame } from '../shared/localFrame.js';
// Thin cartographic lines: widths, lanes and rail locations are not inferred.
export function addSourceNetwork(scene,network,profile) {
  const frame=localFrame(profile.geoOrigin), group=new THREE.Group();group.name='sourceNetwork';
  const xyz=(p,y)=>{const [x,z]=frame.project(...p);return [x,y,z];};
  function lines(paths,color,y,name){
    const vertices=[];
    for(const line of paths)for(let i=1;i<line.length;i++)vertices.push(...xyz(line[i-1],y),...xyz(line[i],y));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const mesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color}));mesh.name=name;group.add(mesh);
  }
  lines(network.roads.flatMap(r=>r.geometry.type==='LineString'?[r.geometry.coordinates]:r.geometry.coordinates),0x708591,.15,'officialCentrelines');
  lines(network.shapes.flatMap(s=>s.lines),0xbb8840,.3,'gtfsServicePaths');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(network.stops.flatMap(s=>xyz([Number(s.stop_lon),Number(s.stop_lat)],.6)),3));
  const stops=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x63c6d2,size:5,sizeAttenuation:false}));stops.name='gtfsStops';group.add(stops);
  scene.add(group);return group;
}
