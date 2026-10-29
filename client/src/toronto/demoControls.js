import { clock } from './transit.js';
// Presentation controls for the existing world recording; no alternate simulator.
export function addDemoControls({seek,setPaused,duration,geoFrame,controls,engine,header,mode,selectRecording,comparisonState,comparisonStart}) {
  const help=document.querySelector('#help');
  const row=document.createElement('div');row.className='toronto-demo-controls';
  row.innerHTML='<button id="focus-district">Queen &amp; Spadina</button> <button id="about-demo">About &amp; sources</button><br><label for="playback-time">Playback time </label><input id="playback-time" type="range" min="0" step="1" aria-label="Playback time in seconds"><output id="playback-offset"></output>';
  help.append(row);
  const variants=document.createElement('div');
  variants.innerHTML='<label for="recording-mode">Recording </label><select id="recording-mode"><option value="baseline">Published timetable</option><option value="dwell">+60s dwell experiment</option></select><span id="recording-status" role="status"></span>';
  row.prepend(variants);
  const inspect=document.createElement('button');inspect.id='focus-comparison';inspect.textContent='Focus comparison trip';variants.append(inspect);
  const detail=document.createElement('div');detail.id='comparison-detail';variants.append(detail);
  inspect.onclick=()=>{const {vehicle:v}=comparisonState();if(!v)return;setPaused(true);controls.target.set(v.x,0,v.z);engine.camera.position.set(v.x+550,800,v.z+1000);controls.update();engine.wake();};
  const select=variants.querySelector('select'),status=variants.querySelector('span');
  if(mode==='custom')select.add(new Option('Build scenario','custom'));
  select.value=mode;
  select.onchange=async()=>{
    select.disabled=true;status.textContent=' Loading recording…';
    try{await selectRecording(select.value);mode=select.value;status.textContent=' Recording ready.';}
    catch(error){select.value=mode;status.textContent=` Unable to switch: ${error.message}. Previous recording retained.`;}
    finally{select.disabled=false;}
  };
  const slider=row.querySelector('input');slider.max=String(duration);slider.value='0';
  slider.addEventListener('input',()=>{setPaused(true);seek(Number(slider.value));engine.wake();});
  document.querySelector('#focus-district').onclick=()=>{
    const [x,z]=geoFrame.project(-79.3963,43.6488);controls.target.set(x,0,z);engine.camera.position.set(x+550,800,z+1000);controls.update();engine.wake();
  };
  const departures=document.createElement('details');departures.id='departure-comparison';
  departures.innerHTML='<summary>Downstream departures &amp; gaps</summary><p>Fixed service-day events, independent of the playback cursor. First three stops from the experiment. Timetable → selected recording, in Toronto service-day time. Target gap: seconds from the preceding trip. Following gap: seconds from target to its next departure on the same pattern/stop occurrence. These are time gaps, not distances or route-wide headways. Following IDs are recomputed in each recording; a smaller gap does not imply a delayed following trip. Equal departures are ordered by trip ID. — means no adjacent departure in this service day.</p><div style="overflow:auto;max-height:180px"><table><thead><tr><th>Stop / trip</th><th>Departure</th><th>Gap (s)</th></tr></thead><tbody></tbody></table></div>';
  row.append(departures);
  const renderDepartures=()=>{
    const body=departures.querySelector('tbody');body.replaceChildren();
    const rows=header.transitDepartures?.rows.slice(comparisonStart,comparisonStart+3)||[];
    departures.hidden=!rows.length;
    for(const r of rows){
      const tr=document.createElement('tr');
      const values=[`${r.stopOccurrence}: ${r.stopName} · Target ${header.transitDepartures.tripId}`,`${clock(r.baseline.departure)} → ${clock(r.selected.departure)}`,`${r.baseline.gapSeconds??'—'} → ${r.selected.gapSeconds??'—'}`];
      for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
      const previous=document.createElement('small');previous.style.display='block';previous.textContent=`Preceding trip: ${r.baseline.previous?.tripId??'none'} → ${r.selected.previous?.tripId??'none'}`;tr.lastChild.append(previous);body.append(tr);
      if(header.transitDepartures.version>=2){
        const next=document.createElement('tr');next.className='following-departure';
        const b=r.baseline.following,a=r.selected.following;
        const fields=[`Following ${b?.tripId??'none'} → ${a?.tripId??'none'}`,`${b?clock(b.departure):'—'} → ${a?clock(a.departure):'—'}`,`${r.baseline.followingGapSeconds??'—'} → ${r.selected.followingGapSeconds??'—'}`];
        for(const value of fields){const td=document.createElement('td');td.textContent=value;next.append(td);}body.append(next);
      }
    }
  };
  const dialog=document.createElement('dialog');dialog.id='demo-details';
  dialog.innerHTML=`<h2>Toronto: buildings, streets and scheduled transit</h2>
<p>Explore the Spadina district using City building massing and centreline records, with TTC 510 scheduled-trip symbols on the same simulation clock.</p>
<p><strong>Try it:</strong> focus Queen &amp; Spadina, pause, then move the time slider to see which directed service links are occupied. Drag to orbit; right-drag or use two fingers to pan; scroll or pinch to zoom.</p>
<p><strong>What comes from sources?</strong> Source footprints, heights, centrelines, GTFS stops and paths. Orange symbols move from published times; teal links show scheduled occupancy. These are not observed vehicles or interacting road traffic. Ground elevation is assumed flat.</p>
<p>The recording covers five minutes of the pinned 2026-10-22 service day (America/Toronto). It stops at the end; Restart returns to its beginning. Buildings cover about 2.15 km²; route geometry continues beyond that crop.</p>
<p id="demo-scenario"></p>
<p>Contains information licensed under the <a href="https://open.toronto.ca/open-data-licence/" target="_blank" rel="noopener">Open Government Licence – Toronto</a>. Framework: <a href="https://github.com/mkturkcan/valdrada" target="_blank" rel="noopener">Valdrada</a>, Mehmet Kerem Turkcan (MIT). SixSim is a working name.</p>
<p><a href="https://github.com/calenirwin/sixsim" target="_blank" rel="noopener">Source and documentation</a> · <a href="https://github.com/calenirwin/sixsim/blob/main/docs/toronto/data-sources.md" target="_blank" rel="noopener">Data-source register</a></p>
<form method="dialog"><button>Close</button></form>`;
  const setHeader=value=>{header=value;renderDepartures();dialog.querySelector('#demo-scenario').textContent=header.transitScenario?.extraDwellSeconds?'This recording includes an explicitly modeled +60-second dwell at one stop, propagated downstream without recovery. It is a what-if experiment, not an observed delay.':'This recording follows the published timetable. Choose the +60s dwell experiment to compare at the same time.';};
  setHeader(header);
  document.body.append(dialog);
  document.querySelector('#about-demo').onclick=()=>dialog.showModal();
  return {setHeader,update(seconds){const state=comparisonState();inspect.disabled=!state.vehicle;detail.textContent=`Trip ${state.tripId}: ${state.phase} · departure deviation +${state.delay}s`;slider.value=String(Math.round(seconds));row.querySelector('output').textContent=`${Math.round(seconds)} / ${duration}s`;}};
}
