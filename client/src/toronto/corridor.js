import dataUrl from '../../fixtures/transit/510-20261022.json?url';
import provenanceUrl from '../../fixtures/transit/provenance.json?url';
import {prepare,position,clock} from './transit.js';
import {localFrame} from '../shared/localFrame.js';
import {PROFILE} from './profile.js';
import {applyIdentity} from './identity.js';
applyIdentity('510 Spadina schedule study');
const $=s=>document.querySelector(s), project=localFrame(PROFILE.geoOrigin).project;
$('#download').href=dataUrl;$('#provenance').href=provenanceUrl;
const svg=$('#map'), ns='http://www.w3.org/2000/svg';
function node(tag,attrs,parent=svg){const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;}
try {
 const response=await fetch(dataUrl,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 const data=await response.json(), model=prepare(data);
 const points=[...model.shapes.values()].flat().map(p=>project(p.lon,p.lat));
 if(!points.length) throw new Error('No valid route shapes available for playback');
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const x=Math.min(...xs)-100,y=Math.min(...ys)-100,w=Math.max(...xs)-x+100,h=Math.max(...ys)-y+100;
 const fullBounds=`${x} ${y} ${w} ${h}`;
 svg.setAttribute('viewBox',fullBounds);
 $('#full-route').onclick=()=>svg.setAttribute('viewBox',fullBounds);
 $('#focus-crop').onclick=()=>{const [cx,cy]=project(-79.3963,43.6488);svg.setAttribute('viewBox',`${cx-350} ${cy-400} 700 800`);};
 for(const ps of model.shapes.values())node('polyline',{points:ps.map(p=>project(p.lon,p.lat).join(',')).join(' '),fill:'none',stroke:'#a0abb1','stroke-width':5});
 const stopMarks=new Map(), stopSelect=$('#stop');
 function selectStop(id){
  stopSelect.value=id;
  for(const [key,mark] of stopMarks){mark.setAttribute('fill',key===id?'#175d8c':'white');mark.setAttribute('r',key===id?24:12);}
  const stop=model.stops.get(id);
  $('#stop-detail').textContent=stop?`${stop.stop_name} · ${stop.location_type==='1'?'Parent station':'Scheduled stop'} · TTC ID ${stop.stop_id}`:'Choose a stop here or tap a blue ring on the map.';
 }
 for(const stop of [...model.stops.values()].sort((a,b)=>a.stop_name.localeCompare(b.stop_name))){
  const option=document.createElement('option');option.value=stop.stop_id;option.textContent=stop.stop_name;stopSelect.append(option);
  const [cx,cy]=project(+stop.stop_lon,+stop.stop_lat);
  const group=node('g',{'aria-label':stop.stop_name});
  node('circle',{cx,cy,r:30,fill:'transparent',style:'cursor:pointer'},group).onclick=()=>selectStop(stop.stop_id);
  const mark=node('circle',{cx,cy,r:12,fill:'white',stroke:'#175d8c','stroke-width':4,style:'pointer-events:none'},group);
  node('title',{},group).textContent=stop.stop_name;stopMarks.set(stop.stop_id,mark);
 }
 stopSelect.onchange=()=>selectStop(stopSelect.value);
 for(const option of $('#direction').options){
  if(option.value==='all')continue;
  const headings=[...new Set(model.trips.filter(t=>t.direction_id===option.value).map(t=>t.trip_headsign.split(' - ')[0]))];
  if(headings.length===1&&['North','South','East','West'].includes(headings[0]))option.textContent=`${headings[0]}bound`;
 }

 const a=project(-79.3965,43.6498),b=project(-79.3948,43.6484);
 node('rect',{x:a[0],y:a[1],width:b[0]-a[0],height:b[1]-a[1],fill:'none',stroke:'#833f9b','stroke-width':8});
 const actors=node('g',{'pointer-events':'none'}), time=$('#time');time.min=Math.min(...model.trips.map(t=>t.times[0].a));time.max=Math.max(...model.trips.map(t=>t.times.at(-1).b));time.value=8*3600;
 const unavailable=model.trips.filter(t=>!t.shape).length;
 const serviceDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${data.service_day.slice(0,4)}-${data.service_day.slice(4,6)}-${data.service_day.slice(6,8)}T00:00:00Z`));
 $('#coverage').textContent=`${serviceDate} · ${data.trips.length} scheduled trips · pinned TTC snapshot.`;
 function draw(){actors.replaceChildren();let n=0;for(const t of model.trips){if($('#direction').value!=='all'&&t.direction_id!==$('#direction').value)continue;const p=position(t,+time.value);if(!p)continue;const[cx,cy]=project(...p);node('title',{},node('circle',{cx,cy,r:18,fill:'#bf571d'},actors)).textContent=t.trip_headsign+' · '+t.trip_id;n++;}$('#clock').textContent=clock(+time.value)+' America/Toronto';const summary=`${n} scheduled trips at this time · ${unavailable} trips omitted from playback for missing/invalid shape distances`;if($('#status').textContent!==summary)$('#status').textContent=summary;window.__CORRIDOR={data,model,active:n,seconds:+time.value};}
 time.disabled=false;$('#direction').disabled=false;$('#play').disabled=false;time.oninput=()=>{cursor=+time.value;draw();};$('#direction').onchange=draw;
 let playing=false,last,cursor=+time.value;
 for(const [id,seconds]of [['#morning',28800],['#late',90000]])$(id).onclick=()=>{cursor=Math.min(+time.max,Math.max(+time.min,seconds));time.value=cursor;draw();};
 for(const id of ['#morning','#late','#stop','#full-route','#focus-crop'])$(id).disabled=false;$('#play').onclick=()=>{playing=!playing;$('#play').textContent=playing?'Pause':'Play ×60';last=undefined;cursor=+time.value;};
 function frame(now){if(playing&&last!==undefined){cursor=Math.min(+time.max,cursor+(now-last)*0.06);time.value=cursor;if(+time.value>=+time.max){playing=false;$('#play').textContent='Play ×60';}draw();}last=now;requestAnimationFrame(frame);}draw();requestAnimationFrame(frame);
}catch(error){$('#status').textContent=`Schedule unavailable: ${error.message}. Reload or use the source download.`;$('#retry').hidden=false;}
