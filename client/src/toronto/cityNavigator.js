// A locator derived from the same municipal elevation grid, not a street basemap.
export function locatorTransform(meta, width=280, height=170) {
 const scale=Math.min(width/((meta.width-1)*meta.step),height/((meta.height-1)*meta.step));
 const left=(width-(meta.width-1)*meta.step*scale)/2,top=(height-(meta.height-1)*meta.step*scale)/2;
 return {scale,toPixel:(x,z)=>[left+(x-meta.origin[0])*scale,top+(z-meta.origin[1])*scale],fromPixel:(x,y)=>[meta.origin[0]+(x-left)/scale,meta.origin[1]+(y-top)/scale]};
}
export function cityNavigator({parent,grid,frame,controls,focus}) {
 const box=document.createElement('details');box.id='city-navigator';box.open=true;
 const summary=document.createElement('summary');summary.textContent='Find a place · Toronto';box.append(summary);
 const canvas=document.createElement('canvas');canvas.id='city-locator';canvas.width=280;canvas.height=170;canvas.tabIndex=0;canvas.setAttribute('role','application');canvas.setAttribute('aria-label','Toronto locator. Tap to explore. Arrow keys move one kilometre north, south, east or west.');box.append(canvas);
 const note=document.createElement('div');note.textContent='N ↑ · Tap land to explore · Arrow keys move 1 km';box.append(note);
 const position=document.createElement('div');position.id='city-position';box.append(position);
 const notice=document.createElement('div');notice.id='city-navigation-notice';notice.setAttribute('role','status');box.append(notice);parent.append(box);
 const tx=locatorTransform(grid.meta),background=document.createElement('canvas');background.width=280;background.height=170;const bg=background.getContext('2d');bg.fillStyle='#152935';bg.fillRect(0,0,280,170);bg.fillStyle='#8caa92';
 for(let j=0;j<grid.meta.height-1;j+=4)for(let i=0;i<grid.meta.width-1;i+=4){if(!Number.isFinite(grid.at(i,j)))continue;const [x,y]=tx.toPixel(grid.meta.origin[0]+i*grid.meta.step,grid.meta.origin[1]+j*grid.meta.step);bg.fillRect(x,y,4*grid.meta.step*tx.scale,4*grid.meta.step*tx.scale);}
 const go=(x,z)=>{if(grid.sample(x,z)===null){notice.textContent='No terrain at this point. Choose land inside Toronto.';return;}notice.textContent='';const [lon,lat]=frame.unproject(x,z);focus(lon,lat);};
 canvas.addEventListener('click',e=>{const r=canvas.getBoundingClientRect();go(...tx.fromPixel((e.clientX-r.left)*280/r.width,(e.clientY-r.top)*170/r.height));});
 canvas.addEventListener('keydown',e=>{const delta={ArrowUp:[0,-1000],ArrowDown:[0,1000],ArrowLeft:[-1000,0],ArrowRight:[1000,0]}[e.key];if(!delta)return;e.preventDefault();e.stopPropagation();go(controls.target.x+delta[0],controls.target.z+delta[1]);});
 let previous='';return {box,update(){const {x,z}=controls.target,key=`${x.toFixed(1)}:${z.toFixed(1)}`;if(key===previous)return;previous=key;const ctx=canvas.getContext('2d');ctx.drawImage(background,0,0);const [px,py]=tx.toPixel(x,z);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ffcc64';ctx.fillRect(px-2,py-2,4,4);const [lon,lat]=frame.unproject(x,z);position.textContent=`View centre: ${lat.toFixed(4)}° N, ${Math.abs(lon).toFixed(4)}° W`;}};
}
