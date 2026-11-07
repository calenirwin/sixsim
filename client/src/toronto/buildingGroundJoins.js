// Visual plinths only: preserve source footprints, roof heights and original geometry.
export function buildingGroundJoins(rings,baseY,sample,{maxVertices=100000,maxDrop=6,spacing=2}={}){
 if(!Number.isFinite(baseY)||typeof sample!=='function'||!Number.isSafeInteger(maxVertices)||maxVertices<0||maxVertices>100000||!Number.isFinite(maxDrop)||maxDrop<=0||maxDrop>6||!Number.isFinite(spacing)||spacing<.5||spacing>2)throw Error('Invalid building join policy');
 const positions=[],stats={segments:0,missing:0,excessive:0,budget:0};
 for(const ring of rings){if(!Array.isArray(ring)||ring.length<3||!ring.every(p=>p.length===2&&p.every(Number.isFinite)))throw Error('Invalid building join ring');
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>1000)throw Error('Building join edge budget');const n=Math.ceil(length/spacing);
   for(let j=0;j<n;j++){const p=a.map((v,k)=>v+(b[k]-v)*j/n),q=a.map((v,k)=>v+(b[k]-v)*(j+1)/n),hp=sample(...p),hq=sample(...q);
    if(!Number.isFinite(hp)||!Number.isFinite(hq)){stats.missing++;continue;}
    if(baseY-Math.min(hp,hq)>maxDrop){stats.excessive++;continue;}
    if(Math.min(hp,hq)>=baseY)continue;
    if(positions.length/3+6>maxVertices){stats.budget++;continue;}
    const A=[p[0],baseY+.01,p[1]],B=[q[0],baseY+.01,q[1]],C=[p[0],Math.min(baseY,hp)-.05,p[1]],D=[q[0],Math.min(baseY,hq)-.05,q[1]];
    positions.push(...A,...C,...B,...B,...C,...D);stats.segments++;
   }
  }
 }
 return {positions,stats};
}
