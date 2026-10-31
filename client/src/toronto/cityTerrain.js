import * as THREE from 'three';
export function terrainGrid(meta,buffer) {
 const {width:w,height:h,step,origin}=meta||{};
 if(meta?.version!==1||meta.verticalDatum!=='CGVD2013'||meta.units!=='metres'||!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w*h>500000||step!==64||!Array.isArray(origin)||origin.length!==2||origin.some(x=>!Number.isFinite(x))||buffer.byteLength!==w*h*4)throw Error('Invalid city terrain grid');
 const view=new DataView(buffer),heights=new Float32Array(w*h);for(let i=0;i<heights.length;i++){const v=view.getFloat32(i*4,true);if(!Number.isNaN(v)&&(!Number.isFinite(v)||v<=-10||v>=400))throw Error('Invalid terrain height');heights[i]=v;}
 const at=(i,j)=>i<0||j<0||i>=w||j>=h?NaN:heights[j*w+i];
 const sample=(x,z)=>{const u=(x-origin[0])/step,v=(z-origin[1])/step,i=Math.floor(u),j=Math.floor(v),a=at(i,j),b=at(i+1,j),c=at(i,j+1),d=at(i+1,j+1);if(![a,b,c,d].every(Number.isFinite))return null;const fx=u-i,fz=v-j;return (a*(1-fx)+b*fx)*(1-fz)+(c*(1-fx)+d*fx)*fz;};
 return {meta,heights,at,sample};
}
export function terrainPatch(grid,i0,j0,cells,stride=1) {
 const {meta:m,at}=grid,positions=[],colors=[],indices=[];
 for(let j=0;j<=cells;j++)for(let i=0;i<=cells;i++){const x=i0+i*stride,z=j0+j*stride,y=at(x,z);positions.push(m.origin[0]+x*m.step,Number.isFinite(y)?y:0,m.origin[1]+z*m.step);const t=Math.max(0,Math.min(1,(y-70)/150));const color=new THREE.Color().lerpColors(new THREE.Color(0x607d65),new THREE.Color(0xb5ac8b),Number.isFinite(t)?t:0);colors.push(color.r,color.g,color.b);}
 for(let j=0;j<cells;j++)for(let i=0;i<cells;i++){
  // Never bridge missing data, even at coarse resolution.
  let valid=true;for(let b=0;b<=stride&&valid;b++)for(let a=0;a<=stride;a++)if(!Number.isFinite(at(i0+i*stride+a,j0+j*stride+b))){valid=false;break;}
  if(valid){const a=j*(cells+1)+i,b=a+1,c=a+cells+1,d=c+1;indices.push(a,c,b,b,c,d);}
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function terrainRenderer(scene,grid) {
 const group=new THREE.Group();group.name='municipalTerrain2023';scene.add(group);const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});let previous='';
 function clear(){for(const mesh of [...group.children]){group.remove(mesh);mesh.geometry.dispose();}}
 return {group,grid,update(target,distance){
  const m=grid.meta,i=Math.floor((target.x-m.origin[0])/1024),j=Math.floor((target.z-m.origin[1])/1024),overview=distance>5000,key=overview?'overview':`${i}:${j}`;if(key===previous)return;previous=key;clear();
  if(overview){for(let y=0;y<m.height-1;y+=128)for(let x=0;x<m.width-1;x+=128){const mesh=new THREE.Mesh(terrainPatch(grid,x,y,16,8),material);group.add(mesh);}}
  else for(let y=j-2;y<=j+2;y++)for(let x=i-2;x<=i+2;x++){if(x<0||y<0||x*16>=m.width-1||y*16>=m.height-1)continue;group.add(new THREE.Mesh(terrainPatch(grid,x*16,y*16,16),material));}
  group.userData={mode:overview?'512 m overview':'64 m near terrain',meshes:group.children.length,triangles:group.children.reduce((n,m)=>n+m.geometry.index.count/3,0)};
 },dispose(){clear();material.dispose();scene.remove(group);}};
}
