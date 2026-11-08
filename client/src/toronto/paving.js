import * as THREE from 'three';
// Original illustrative 1.5 m grid, not surveyed paving dimensions.
export function pavingMaterial(){
 const material=new THREE.MeshStandardMaterial({color:0xb7b3a5,roughness:1,side:THREE.DoubleSide});
 const filtered={value:1};material.userData.filteredJoints=filtered;
 material.customProgramCacheKey=()=> 'waterfront-paving-coverage-1';
 material.onBeforeCompile=s=>{
  s.uniforms.pavingFiltered=filtered;
  s.vertexShader='varying vec3 pavingPoint;\n'+s.vertexShader;
  s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npavingPoint=position;');
  s.fragmentShader=`varying vec3 pavingPoint;
   uniform float pavingFiltered;
   float jointIntegral(float t){return floor(t)*.03+max(fract(t)-.97,0.);}
   float jointCoverage(float phase,float footprint){
    // Integrate one periodic pulse over the pixel footprint. Once a pixel spans
    // a whole cell, use the mean rather than retaining unresolved repetitions.
    if(footprint>=1.)return .03;
    float w=max(footprint,.0001),p=fract(phase);
    return clamp((jointIntegral(p+w*.5)-jointIntegral(p-w*.5))/w,0.,1.);
   }
  `+s.fragmentShader;
  s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   vec2 cell=pavingPoint.xz/1.5,footprint=fwidth(cell);
   vec2 joints=vec2(jointCoverage(cell.x,footprint.x),jointCoverage(cell.y,footprint.y));
   float coverage=1.-(1.-joints.x)*(1.-joints.y);
   if(pavingFiltered<.5){vec2 legacy=step(vec2(.97),fract(cell));coverage=max(legacy.x,legacy.y);}
   diffuseColor.rgb*=1.-.15*coverage;
  `);
 };
 return material;
}
