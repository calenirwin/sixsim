// Symbols written by the inherited CoreReplay instance-pool contract; not a TTC vehicle model.
import * as THREE from 'three';
export function scheduledMarkerPool(scene, capacity) {
  const geometry=new THREE.CylinderGeometry(3,3,2,12).translate(0,1,0);
  const material=new THREE.MeshBasicMaterial({color:0xffffff});
  const mb=new THREE.InstancedMesh(geometry,material,capacity);
  const md=new THREE.InstancedMesh(geometry,material,capacity);md.visible=false;
  mb.count=md.count=0;mb.frustumCulled=false;scene.add(mb);
  return {pools:{'scheduled-trip-marker':{mb,md,mx:[],n:0,cap:capacity}},cars:[],parked:{},parkedRecs:new Map(),
    dispose(){scene.remove(mb);geometry.dispose();material.dispose();}};
}
