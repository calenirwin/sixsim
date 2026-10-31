import * as THREE from 'three';
import {roadProbe} from './roadProbe.js';
import source from '../../fixtures/toronto/road-corridor.json' with {type:'json'};
// Replay the same core experiment in the existing recording group, not a separate simulator.
export function addRoadProbe(scene,tracks){
 const h=tracks.header;if(h.roadProbe===undefined&&h.roadProbeFrames===undefined){const group=new THREE.Group();group.name='constrainedRoadProbe';scene.add(group);return {group,current:null,update(){},dispose(){group.removeFromParent();}};}if(JSON.stringify(h.roadProbe)!==JSON.stringify(source))throw Error('Road corridor replay source mismatch');
 const probe=roadProbe(h.roadProbe);if(!Array.isArray(h.roadProbeFrames)||h.roadProbeFrames.length!==tracks.frames.length||h.simTime?.length!==tracks.frames.length)throw Error('Incomplete road probe replay');
 for(let i=0;i<h.roadProbeFrames.length;i++)if(JSON.stringify(h.roadProbeFrames[i])!==JSON.stringify(probe.at(h.simTime[i])))throw Error('Road probe replay state mismatch');
 const group=new THREE.Group();group.name='constrainedRoadProbe';const lineMaterial=new THREE.LineBasicMaterial({color:0xc3a0ed});
 // Only the bounded movement segment is emphasized; remaining source corridor has no traversal permission.
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(probe.lines[0].points.map(([x,z])=>new THREE.Vector3(x,.7,z))),lineMaterial);group.add(line);
 const marker=new THREE.Mesh(new THREE.OctahedronGeometry(4),new THREE.MeshBasicMaterial({color:0xc3a0ed}));group.add(marker);scene.add(group);
 const state={group,marker,frame:0,current:null,update(index){if(!Number.isSafeInteger(index)||index<0||index>=h.roadProbeFrames.length)throw Error('Invalid road probe replay frame');state.frame=index;state.current={...h.roadProbeFrames[index]};marker.position.set(state.current.x,5,state.current.z);},dispose(){line.geometry.dispose();lineMaterial.dispose();marker.geometry.dispose();marker.material.dispose();group.removeFromParent();}};state.update(0);return state;
}
