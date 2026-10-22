import dataUrl from '../../fixtures/transit/510-20261022.json?url';
import provenanceUrl from '../../fixtures/transit/provenance.json?url';
import {prepare,position,clock} from './transit.js';
import {localFrame} from '../shared/localFrame.js';
import {PROFILE} from './profile.js';
const $=s=>document.querySelector(s), project=localFrame(PROFILE.geoOrigin).project;
$('#download').href=dataUrl;$('#provenance').href=provenanceUrl;
const svg=$('#map'), ns='http://www.w3.org/2000/svg';
function node(tag,attrs,parent=svg){const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;}
try {
 const response=await fetch(dataUrl,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const data=await response.json(), model=prepare(data);
 const points=[...model.shapes.values()].flat().map(p=>project(p.lon,p.lat));
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const x=Math.min(...xs)-100,y=Math.min(...ys)-100,w=Math.max(...xs)-x+100,h=Math.max(...ys)-y+100;
 svg.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);
 for(const ps of model.shapes.values())node('polyline',{points:ps.map(p=>project(p.lon,p.lat).join(',')).join(' '),fill:'none',stroke:'#a0abb1','stroke-width':5});
 for(const s of model.stops.values()){const [cx,cy]=project(+s.stop_lon,+s.stop_lat);node('title',{},node('circle',{cx,cy,r:12,fill:'white',stroke:'#175d8c','stroke-width':4})).textContent=s.stop_name;}
 const a=project(-79.3965,43.6498),b=project(-79.3948,43.6484);
 node('rect',{x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1],fill:'none',stroke:'#833f9b','stroke-width':8});
 const actors=node('g',{}), time=$('#time');time.min=Math.min(...model.trips.map(t=>t.times[0].a));time.max=Math.max(...model.trips.map(t=>t.times.at(-1).b));time.value=8*3600;
 const unavailable=model.trips.filter(t=>!t.shape).length;
 $('#coverage').textContent=`Service day ${data.service_day} · ${data.timezone} · ${data.trips.length} scheduled trips · ${data.stops.length} stops · ${model.shapes.size} shapes. Pinned historical snapshot; not today's service.`;
 function draw(){actors.replaceChildren();let n=0;for(const t of model.trips){if($('#direction').value!=='all'&&t.direction_id!==$('#direction').value)continue;const p=position(t,+time.value);if(!p)continue;const[cx,cy]=project(...p);node('title',{},node('circle',{cx,cy,r:18,fill:'#bf571d'},actors)).textContent=t.trip_headsign+' · '+t.trip_id;n++;}$('#clock').textContent=clock(+time.value)+' America/Toronto';$('#status').textContent=`${n} scheduled trips at this time · ${unavailable} trips omitted from playback for missing/invalid shape distances`;window.__CORRIDOR={data,model,active:n,seconds:+time.value};}
 time.disabled=false;$('#direction').disabled=false;$('#play').disabled=false;time.oninput=()=>{cursor=+time.value;draw();};$('#direction').onchange=draw;
 let playing=false,last,cursor=+time.value;$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'Pause':'Play ×60';last=undefined;cursor=+time.value;};
 function frame(now){if(playing&&last!==undefined){cursor=Math.min(+time.max,cursor+(now-last)*0.06);time.value=cursor;if(+time.value>=+time.max){playing=false;$('#play').textContent='Play ×60';}draw();}last=now;requestAnimationFrame(frame);}draw();requestAnimationFrame(frame);
}catch(error){$('#status').textContent=`Schedule unavailable: ${error.message}. Reload or use the source download.`;$('#retry').hidden=false;}
