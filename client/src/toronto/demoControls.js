// Presentation controls for the existing world recording; no alternate simulator.
export function addDemoControls({seek,setPaused,duration,geoFrame,controls,engine,header}) {
  const help=document.querySelector('#help');
  const row=document.createElement('div');row.className='toronto-demo-controls';
  row.innerHTML='<button id="focus-district">Queen &amp; Spadina</button> <button id="about-demo">About &amp; sources</button><br><label for="playback-time">Playback time </label><input id="playback-time" type="range" min="0" step="1" aria-label="Playback time in seconds"><output id="playback-offset"></output>';
  help.append(row);
  const slider=row.querySelector('input');slider.max=String(duration);slider.value='0';
  slider.addEventListener('input',()=>{setPaused(true);seek(Number(slider.value));engine.wake();});
  document.querySelector('#focus-district').onclick=()=>{
    const [x,z]=geoFrame.project(-79.3963,43.6488);controls.target.set(x,0,z);engine.camera.position.set(x+550,800,z+1000);controls.update();engine.wake();
  };
  const dialog=document.createElement('dialog');dialog.id='demo-details';
  dialog.innerHTML=`<h2>Toronto: buildings, streets and scheduled transit</h2>
<p>Explore the Spadina district using City building massing and centreline records, with TTC 510 scheduled-trip symbols on the same simulation clock.</p>
<p><strong>Try it:</strong> focus Queen &amp; Spadina, pause, then move the time slider to see which directed service links are occupied. Drag to orbit; right-drag or use two fingers to pan; scroll or pinch to zoom.</p>
<p><strong>What is measured?</strong> Source footprints, heights, centrelines, GTFS stops and paths. Orange symbols move from published times; teal links show scheduled occupancy. These are not observed vehicles or interacting road traffic. Ground elevation is assumed flat.</p>
<p>The recording covers five minutes of the pinned 2026-10-22 service day (America/Toronto). It stops at the end; Restart returns to its beginning. Buildings cover about 2.15 km²; route geometry continues beyond that crop.</p>
<p id="demo-scenario"></p>
<p>Contains information licensed under the <a href="https://open.toronto.ca/open-data-licence/" target="_blank" rel="noopener">Open Government Licence – Toronto</a>. Framework: <a href="https://github.com/mkturkcan/valdrada" target="_blank" rel="noopener">Valdrada</a>, Mehmet Kerem Turkcan (MIT). SixSim is a working name.</p>
<p><a href="https://github.com/calenirwin/sixsim" target="_blank" rel="noopener">Source and documentation</a> · <a href="https://github.com/calenirwin/sixsim/blob/main/docs/toronto/data-sources.md" target="_blank" rel="noopener">Data-source register</a></p>
<form method="dialog"><button>Close</button></form>`;
  dialog.querySelector('#demo-scenario').textContent=header.transitScenario?.extraDwellSeconds?'This recording includes an explicitly modeled +60-second dwell at one stop, propagated downstream without recovery. It is a what-if experiment, not an observed delay.':'This recording follows the published timetable. The shared runtime also supports a fixed extra-dwell experiment.';
  document.body.append(dialog);
  document.querySelector('#about-demo').onclick=()=>dialog.showModal();
  return {update(seconds){slider.value=String(Math.round(seconds));row.querySelector('output').textContent=`${Math.round(seconds)} / ${duration}s`;}};
}
