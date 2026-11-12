// Visual closure of existing terrain at mapped water edges, not surveyed quay walls.
export function shorelineClosure(data){
 const edges=new Map(),v=data.groundVertices,key=p=>p.map(n=>n.toFixed(4)).join(',');
 for(let i=0;i<v.length;i+=9){const t=[0,3,6].map(j=>v.slice(i+j,i+j+3));for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],k=[key(a),key(b)].sort().join('|');if(edges.has(k))edges.get(k).count++;else edges.set(k,{a,b,count:1});}}
 const segments=data.water.flatMap(w=>w.rings.flatMap(r=>r.slice(1).map((b,i)=>[r[i],b])));
 const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;if(!length)return Infinity;const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[1])*dz)/length));return Math.hypot(p[0]-a[0]-t*dx,p[2]-a[1]-t*dz);};
 const positions=[];let omitted=0;
 for(const {a,b,count} of edges.values()){
  // Both endpoints must lie on one mapped water segment. Never fill inland holes,
  // crop edges or unmatched terrain using nearest-edge guesses.
  if(count!==1||!segments.some(([c,d])=>distance(a,c,d)<.001&&distance(b,c,d)<.001))continue;
  const drops=[a[1]-data.waterLevel,b[1]-data.waterLevel];
  if(drops.some(h=>!Number.isFinite(h)||h<=0||h>4)||positions.length+18>90000){omitted++;continue;}
  const c=[a[0],data.waterLevel,a[2]],d=[b[0],data.waterLevel,b[2]];
  positions.push(...a,...b,...c,...b,...d,...c);
 }
 return {positions,omitted};
}
