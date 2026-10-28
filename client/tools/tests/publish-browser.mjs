import assert from 'node:assert/strict';
import { localFrame } from '../../src/shared/localFrame.js';
import fs from 'node:fs';
fs.mkdirSync('shots',{recursive:true});
import { preview } from 'vite';
import { chromium } from 'playwright';
const live=process.env.PUBLISHED_URL,space=process.env.STATIC_SPACE==='1',dist=space?'dist-space':'dist-publish';
const server=live?null:await preview({configFile:space?'vite.space.config.js':'vite.publish.config.js',preview:{host:'127.0.0.1',port:0}});
const base=live||server.resolvedUrls.local[0];
let browser;
try {
 if(!live){
   const files=fs.readdirSync(dist,{recursive:true}).filter(f=>fs.statSync(`${dist}/${f}`).isFile());
   assert.ok(files.reduce((n,f)=>n+fs.statSync(`${dist}/${f}`).size,0)<=18_000_000,'Publication byte budget');
   assert.ok(files.filter(f=>f.endsWith('.bin')).reduce((n,f)=>n+fs.statSync(`${dist}/${f}`).size,0)<=1_500_000,'Building tile byte budget');
 }
 const initialHtml=await(await fetch(base)).text();
 assert.doesNotMatch(initialHtml,/New York City|inherited NYC scene|NYC Open Data/);
 assert.match(initialHtml,/Loading city data/);
 if(space)assert.doesNotMatch(initialHtml,/(?:src|href)="\/sixsim\//);
 const meta=await(await fetch(new URL('deployment.json',base))).json();
 assert.equal(meta.city,'toronto');assert.equal(meta.mode,'scheduled-playback');
 if(process.env.EXPECTED_SHA)assert.equal(meta.commit,process.env.EXPECTED_SHA);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:750},hasTouch:true}),errors=[];
 page.setDefaultTimeout(30000);
 if(!live)await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(base).origin){errors.push('Unexpected external asset '+r.request().url());return r.abort();}return r.continue();});
 let expectedRecordingFailure=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!expectedRecordingFailure)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__APP?.streamer.tiles.get('0_0')?.state==='ready' && window.__APP.engine.frames>3,{}, {timeout:90000});
 console.log('Loaded publication geometry');
 const result=await page.evaluate(()=>{const a=window.__APP;a.setPaused(true);a.seek(0);const initial=Array.from(a.traffic.pools['scheduled-trip-marker'].mb.instanceMatrix.array);a.seek(60);const changed=Array.from(a.traffic.pools['scheduled-trip-marker'].mb.instanceMatrix.array).some((v,i)=>v!==initial[i]);return {masses:a.streamer.tiles.get('0_0').data.records.length,actors:a.traffic.cars.length,changed,frame:a.replay.f,commitProfile:a.profile.id};});
 assert.equal(result.masses,360);assert.ok(result.actors>0);assert.equal(result.changed,true);assert.equal(result.frame,60);
 console.log('Verified playback');
 await page.evaluate(()=>{window.__APP.setPaused(true);window.__APP.seek(70);});
 const recordingState=()=>page.evaluate(()=>{const a=window.__APP;return {frame:a.replay.f,camera:a.engine.camera.position.toArray(),target:a.controls.target.toArray(),actors:a.tracks.frames[a.replay.f].veh.map(v=>({tripId:a.tracks.header.actors.find(r=>r.id===v.id).tripId,x:v.x,z:v.z})).sort((a,b)=>a.tripId.localeCompare(b.tripId)),groups:a.scene.children.filter(g=>g.name==='scheduledRecording').length};});
 const baseline=await recordingState();
 expectedRecordingFailure=true;
 await page.route('**/*tracks-dwell*.atrk',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.locator('#recording-mode').selectOption('dwell');
 await page.waitForFunction(()=>document.querySelector('#recording-status').textContent.includes('HTTP 503'));
 assert.deepEqual(await recordingState(),baseline);assert.equal(await page.locator('#recording-mode').inputValue(),'baseline');
 await page.unroute('**/*tracks-dwell*.atrk');expectedRecordingFailure=false;
 await page.locator('#recording-mode').selectOption('dwell');
 await page.waitForFunction(()=>window.__APP.tracks.header.transitScenario?.extraDwellSeconds===60 && !document.querySelector('#recording-mode').disabled);
 const delayed=await recordingState();assert.equal(delayed.frame,70);assert.deepEqual(delayed.camera,baseline.camera);assert.deepEqual(delayed.target,baseline.target);assert.equal(delayed.groups,1);
 assert.deepEqual(delayed.actors.filter(a=>a.tripId!=='122948020'),baseline.actors.filter(a=>a.tripId!=='122948020'));
 assert.notDeepEqual(delayed.actors.find(a=>a.tripId==='122948020'),baseline.actors.find(a=>a.tripId==='122948020'));
 assert.match(await page.locator('#comparison-detail').innerText(),/at stop.*\+60s/);
 await page.locator('#recording-mode').selectOption('baseline');await page.waitForFunction(()=>!window.__APP.tracks.header.transitScenario && !document.querySelector('#recording-mode').disabled);
 assert.deepEqual(await recordingState(),baseline);
 await page.locator('#focus-comparison').click({noWaitAfter:true,timeout:60000});
 const comparisonTarget=await page.evaluate(()=>window.__APP.controls.target.toArray()),vehicle=baseline.actors.find(a=>a.tripId==='122948020');
 assert.ok(Math.hypot(comparisonTarget[0]-vehicle.x,comparisonTarget[2]-vehicle.z)<.001);
 console.log('Verified baseline/dwell comparison, retained state on failure, and trip focus');

 await page.locator('#playback-time').evaluate(e=>{e.value='120';e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>window.__APP.replay.f),120);
 assert.equal(await page.locator('#pause-playback').innerText(),'Play');
 await page.locator('#playback-time').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.__APP.replay.f),121);
 await page.locator('#about-demo').click();await page.waitForFunction(()=>document.querySelector('#demo-details').open);
 assert.match(await page.locator('#demo-details').innerText(),/not observed vehicles/);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#about-demo').evaluate(e=>e===document.activeElement),true);
 const pose=()=>page.evaluate(()=>({target:window.__APP.controls.target.toArray(),camera:window.__APP.engine.camera.position.toArray(),origin:window.__APP.profile.geoOrigin}));
 const beforeFocus=await pose();
 // This local camera action does not navigate. noWaitAfter avoids Playwright's
 // navigation wait; it is not a rendering-performance optimization.
 await page.locator('#focus-district').click({noWaitAfter:true,timeout:60000});
 const focused=await pose();
 assert.ok(Math.hypot(...focused.target.map((v,i)=>v-beforeFocus.target[i]))>100,'Shortcut must move the target');
 assert.ok(Math.hypot(...focused.camera.map((v,i)=>v-beforeFocus.camera[i]))>100,'Shortcut must move the camera');
 const [lon,lat]=localFrame(focused.origin).unproject(focused.target[0],focused.target[2]);
 assert.ok(Math.abs(lon-(-79.3963))<1e-8 && Math.abs(lat-43.6488)<1e-8,'Target must be Queen/Spadina');
 assert.equal(focused.target[1],0);
 [550,800,1000].forEach((offset,i)=>assert.ok(Math.abs(focused.camera[i]-focused.target[i]-offset)<1e-6,'Camera must retain the district framing offset'));

 if(space){const card=await(await fetch(new URL('README.md',base))).text();assert.match(card,/sdk: static/);assert.match(card,/app_file: index.html/);}

 const before=await page.evaluate(()=>window.__APP.engine.camera.position.toArray());
 await page.mouse.move(600,350);await page.mouse.down();await page.mouse.move(700,400,{steps:1});await page.mouse.up();
 assert.notDeepEqual(await page.evaluate(()=>window.__APP.engine.camera.position.toArray()),before);
 console.log('Verified orbit');
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>Math.abs(window.__APP.engine.camera.aspect-390/844)<0.01);
 assert.equal(await page.evaluate(()=>window.__APP.renderer.getContext().isContextLost()),false);
 console.log('Resized to mobile');
 const layout=await page.evaluate(()=>{const box=id=>document.querySelector(id).getBoundingClientRect();return {topClear:box('#help').top>=box('#loc').bottom,bottomClear:box('#stats').bottom<=box('#credits').top};});
 assert.deepEqual(layout,{topClear:true,bottomClear:true});
 console.log('Verified mobile layout');
 const restart=await page.locator('#restart-playback').boundingBox();await page.touchscreen.tap(restart.x+restart.width/2,restart.y+restart.height/2);
 assert.equal(await page.evaluate(()=>window.__APP.replay.f),0);
 await page.locator('#pause-playback').click();await page.locator('#pause-playback').click();
 console.log('Verified mobile playback controls');
 await page.screenshot({path:live?'/tmp/toronto-live-mobile.png':'shots/toronto-publish-mobile.png',timeout:30000});
 await page.setViewportSize({width:1100,height:750});await page.screenshot({path:live?'/tmp/toronto-live-desktop.png':'shots/toronto-publish-desktop.png',timeout:30000});
 if(!live)await page.screenshot({path:'shots/toronto-demo.jpg',type:'jpeg',quality:80});
 assert.deepEqual(errors,[]);
 assert.equal((await fetch(new URL('LICENSE.txt',base))).status,200);
 assert.equal((await fetch(new URL('DATA_SOURCES.json',base))).status,200);
 await page.goto(new URL('?city=nyc',base).href);await page.waitForFunction(()=>document.querySelector('#loading p').textContent.includes('Toronto profile only'));
 assert.equal(await page.locator('#loc span').textContent(),'City data');
 console.log(JSON.stringify({url:base,commit:meta.commit,...result,mobile:'passed',navigation:'passed'}));
} finally {await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));}
