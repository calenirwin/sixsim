// Original procedural illustration, not measured facade, floor, roof or terrain data.
import * as THREE from 'three';
export function massingColor(sourceId) {
  let hash=2166136261;for(const c of sourceId)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  return new THREE.Color([0xb29b83,0x9eaaa8,0xc4bbaa,0x9b8374,0xb7b9b1,0x8e9ca5][hash%6]);
}
export function illustratedMaterial({ground=false}={}) {
  const material=new THREE.MeshStandardMaterial({color:ground?0x777b73:0xffffff,vertexColors:!ground,roughness:.94});
  material.userData.basis='original procedural illustration; not measured material';
  material.customProgramCacheKey=()=>`toronto-illustration-1-${ground}`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 torPosition; varying vec3 torNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntorPosition=position; torNormal=normal;');
    shader.fragmentShader='varying vec3 torPosition; varying vec3 torNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      ${ground?`float grain=fract(sin(dot(floor(torPosition.xz*1.5),vec2(12.9898,78.233)))*43758.5453);
      diffuseColor.rgb*=.96+.08*grain;`:`
      float side=1.0-step(.5,abs(torNormal.y));
      float horizontal=abs(torNormal.x)>abs(torNormal.z)?torPosition.z:torPosition.x;
      vec2 cells=vec2(horizontal/3.2,torPosition.y/3.4);
      vec2 edge=abs(fract(cells)-.5),aa=max(fwidth(cells),vec2(.005));
      vec2 pane=1.0-smoothstep(vec2(.26)-aa,vec2(.26)+aa,edge);
      float fade=1.0-smoothstep(.12,.45,max(aa.x,aa.y));
      float window=side*pane.x*pane.y*fade*step(2.0,torPosition.y);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.20,.29,.33),window*.65);
      diffuseColor.rgb*=mix(.70,1.0,side);`}
    `);
  };
  return material;
}
export function addIllustratedGround(scene,bounds) {
  const [x0,z0,x1,z1]=bounds,geometry=new THREE.PlaneGeometry(x1-x0,z1-z0);
  geometry.rotateX(-Math.PI/2);geometry.translate((x0+x1)/2,-.08,(z0+z1)/2);
  const mesh=new THREE.Mesh(geometry,illustratedMaterial({ground:true}));mesh.name='illustratedFlatGround';mesh.receiveShadow=true;
  scene.add(mesh);return mesh;
}
