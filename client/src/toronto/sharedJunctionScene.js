import {validateNextNodeAccess} from './nextNodeAccess.js';
import * as THREE from 'three';import {sharedJunction} from './sharedJunction.js';import {localFrame} from '../shared/localFrame.js';import source from '../../fixtures/toronto/shared-junction.json' with {type:'json'};
export function addSharedJunction(scene,tracks){
 const h=tracks.header,group=new THREE.Group();group.name='sharedJunctionExperiment';
 if(h.sharedJunction===undefined&&h.sharedJunctionFrames===undefined){scene.add(group);return {group,current:null,update(){},dispose(){group.removeFromParent();}};}
 if(JSON.stringify(h.sharedJunction?.definition)!==JSON.stringify(source))throw Error('Shared junction replay source mismatch');
 const access=h.sharedJunction.nextNodeAccess===undefined?null:validateNextNodeAccess(h.sharedJunction.nextNodeAccess);
 if(access&&h.sharedJunction.policy?.version!==4)throw Error('Next-node access requires downstream travel');
 const model=sharedJunction(h.sharedJunction.definition,h.sharedJunction.policy),frames=h.sharedJunctionFrames;
 if(JSON.stringify(h.sharedJunction.reservations)!==JSON.stringify(model.reservations)||!Array.isArray(frames)||frames.length!==tracks.frames.length||frames.length<1||h.simTime?.length!==frames.length)throw Error('Incomplete shared junction replay');
 for(let n=0;n<frames.length;n++)if(JSON.stringify(frames[n])!==JSON.stringify(model.at(h.simTime[n])))throw Error('Shared junction replay state mismatch');
 const frame=localFrame(source.geoOrigin),markers=new Map(),colours=[0x75cfc4,0xe7a5e7];
 for(const [index,path] of source.paths.entries()){const a=source.edges.find(e=>e.id===path.incoming),b=source.edges.find(e=>e.id===path.outgoing),points=[...a.points,...b.points.slice(1)].map(p=>{const [x,z]=frame.project(...p);return new THREE.Vector3(x,.8,z);});group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:colours[index]})));}
 for(const probe of model.at(0).probes){const index=source.paths.findIndex(p=>p.id===(probe.pathId??probe.id));const marker=new THREE.Mesh(new THREE.OctahedronGeometry(4),new THREE.MeshBasicMaterial({color:colours[index]}));group.add(marker);markers.set(probe.id,marker);}
 scene.add(group);const result={group,access,current:null,markers,update(index){if(!Number.isSafeInteger(index)||index<0||index>=frames.length)throw Error('Invalid shared junction replay frame');result.current=structuredClone(frames[index]);for(const a of result.current.probes){const marker=markers.get(a.id);marker.visible=a.present;marker.position.set(a.x,5,a.z);}},dispose(){for(const o of group.children){o.geometry.dispose();o.material.dispose();}group.removeFromParent();}};result.update(0);return result;
}
