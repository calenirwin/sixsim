import {canopyGeometry} from '../../src/toronto/vegetation.js';
import assert from 'node:assert/strict';import fs from 'node:fs';import {preview} from 'vite';import {chromium} from 'playwright';
// Opt in to historical before/after pairs when diagnosing a visual regression:
// WATERFRONT_DIAGNOSTIC_SHOTS=1 npm --prefix client run test:waterfront
// Optional matched vegetation review; default remains six captures.
const vegetationShots=process.env.WATERFRONT_VEGETATION_SHOTS==='1';
const diagnosticShots=process.env.WATERFRONT_DIAGNOSTIC_SHOTS==='1';
const server=await preview({configFile:'vite.publish.config.js',preview:{host:'127.0.0.1',port:0}});let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1200,height:800},hasTouch:true}),base=server.resolvedUrls.local[0],errors=[];let expected=false;
 // Keep all rendering/state checks in both modes; only omit redundant image encoding.
 let captures=0,skippedCaptures=0,captureMs=0;
 const capture=async(path,diagnostic=false)=>{
  if(diagnostic&&!diagnosticShots){skippedCaptures++;return;}
  const started=performance.now();await page.screenshot({path,timeout:60000});captureMs+=performance.now()-started;captures++;
 };
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Shader Error|WebGLProgram/.test(m.text()))errors.push(m.text());});page.on('response',r=>{if(r.status()>=400&&!expected)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base);await page.waitForFunction(()=>window.__APP?.streamer.tiles.get('0_0')?.state==='ready',{},{timeout:90000});await page.evaluate(()=>{window.__APP.setPaused(true);window.__APP.seek(60);});
 await page.locator('#toggle-city-terrain').click({noWaitAfter:true,timeout:60000});await page.waitForFunction(()=>window.__APP.cityTerrain.active,{},{timeout:90000});console.log('Municipal mode ready');const before=await page.evaluate(()=>({p:window.__APP.engine.camera.position.toArray(),t:window.__APP.controls.target.toArray(),f:window.__APP.replay.f}));
 expected=true;await page.route('**/scene-*.json',r=>r.fulfill({status:503,body:'unavailable'}));await page.locator('#walk-waterfront').click({noWaitAfter:true,timeout:60000});await page.waitForFunction(()=>document.querySelector('#waterfront-status').textContent.includes('HTTP 503'));assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.active),false);assert.deepEqual(await page.evaluate(()=>({p:window.__APP.engine.camera.position.toArray(),t:window.__APP.controls.target.toArray(),f:window.__APP.replay.f})),before);await page.unroute('**/scene-*.json');expected=false;console.log('Scene load failure retains city');
 let release;const gate=new Promise(r=>{release=r;});await page.route('**/scene-*.json',async r=>{await gate;await r.continue().catch(()=>{});});await page.locator('#walk-waterfront').click({noWaitAfter:true,timeout:60000});await page.locator('#toggle-city-terrain').click({noWaitAfter:true,timeout:60000});release();await page.waitForFunction(()=>!document.querySelector('#walk-waterfront').disabled,{},{timeout:90000});assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.active||window.__APP.cityTerrain.waterfront.active),false);await page.unroute('**/scene-*.json');await page.locator('#toggle-city-terrain').click({noWaitAfter:true,timeout:60000});await page.waitForFunction(()=>window.__APP.cityTerrain.active);console.log('Late scene load cannot re-enter exited city mode');
 await page.locator('#walk-waterfront').click({noWaitAfter:true,timeout:60000});await page.waitForFunction(()=>window.__APP.cityTerrain.waterfront.active,{},{timeout:90000});
 await page.waitForFunction(()=>{const b=window.__APP.cityTerrain.buildings;return b.state.pending===0&&b.state.parts>0;},{},{timeout:90000});
 const state=()=>page.evaluate(()=>{const a=window.__APP;return {walk:a.cityTerrain.waterfront.state,p:a.engine.camera.position.toArray(),t:a.controls.target.toArray(),near:a.engine.camera.near,orbit:a.controls.enabled,terrain:a.cityTerrain.terrain.group.visible,frame:a.replay.f};});
 assert.ok(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.group.getObjectByName('terrainDrapedSidewalks')?.geometry.attributes.position.count>1000));
 assert.ok(await page.evaluate(()=>window.__APP.cityTerrain.buildings.state.joinVertices>0&&window.__APP.cityTerrain.buildings.state.joinVertices<=100000));
 assert.ok(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.group.getObjectByName('terrainDrapedRoads')?.geometry.attributes.position.count>1000));
 assert.ok(await page.evaluate(()=>[...window.__APP.cityTerrain.buildings.tiles.values()].every(t=>t.data.group.children[0].material.userData.streetDetail.value===1)));
 console.log('Terrain-draped streets and walking frontage detail loaded');const start=await state();assert.equal(start.walk.distance,0);assert.equal(start.orbit,false);assert.equal(start.terrain,false);assert.equal(start.near,.4);assert.equal(start.frame,60);
 assert.equal(await page.locator('#waterfront-more').getAttribute('aria-expanded'),'false');await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});
 await page.locator('#walk-forward').click({noWaitAfter:true,timeout:60000});assert.equal((await state()).walk.distance,10);await page.locator('#walk-left').click({noWaitAfter:true,timeout:60000});const turned=await state();assert.equal(turned.walk.distance,10);assert.notDeepEqual(turned.t,start.t);await page.locator('#walk-face').click({noWaitAfter:true,timeout:60000});assert.equal((await state()).walk.yaw,0);
 await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.__APP.cityTerrain.waterfront.state.distance>10);await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.keyboard.up('KeyW');const interrupted=(await state()).walk.distance;await page.waitForTimeout(150);assert.equal((await state()).walk.distance,interrupted);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.active),false);await page.locator('#walk-waterfront').click({noWaitAfter:true,timeout:60000});assert.equal((await state()).walk.distance,0);assert.equal((await state()).frame,60);assert.equal(await page.locator('#waterfront-more').getAttribute('aria-expanded'),'false');await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});
 assert.ok(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.group.getObjectByName('terrainDrapedCrossings').geometry.attributes.position.count>0));
 fs.mkdirSync('shots',{recursive:true});
 for(const [name,distance,yaw] of [['crossing-after',330,0],['street',420,0],['shoreline',1100,0]]){
  await page.locator('#waterfront-distance').evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));},distance);if(yaw)for(let i=0;i<3;i++)await page.locator('#walk-right').click({noWaitAfter:true,timeout:60000});
  await page.waitForFunction(()=>{const b=window.__APP.cityTerrain.buildings;return b.state.pending===0&&b.state.errors.length===0;},{},{timeout:90000});await capture(`shots/toronto-waterfront-${name}.png`);console.log('Captured',name);
  if(name==='shoreline'){
   assert.deepEqual(await page.evaluate(()=>{const g=window.__APP.cityTerrain.waterfront.group,c=g.getObjectByName('illustrativeTreeCrowns'),t=g.getObjectByName('illustrativeTreeTrunks');return [c.count,t.count,c.geometry.index.count/3,c.geometry.attributes.position.count];}),[729,729,80,42]);
   if(vegetationShots){
    await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});
    for(const [layout,width,height] of [['desktop',1200,800],['mobile',390,844]]){
     await page.setViewportSize({width,height});await page.waitForFunction(r=>Math.abs(window.__APP.engine.camera.aspect-r)<.01,width/height);
     for(const shaped of [false,true]){
      const geo=canopyGeometry({shaped}),payload={shaped,positions:Array.from(geo.attributes.position.array),normals:Array.from(geo.attributes.normal.array)};geo.dispose();
      await page.evaluate(async ({shaped,positions,normals})=>{const a=window.__APP,c=a.cityTerrain.waterfront.group.getObjectByName('illustrativeTreeCrowns'),g=c.geometry;
       if(!shaped){window.__crownMatrices=c.instanceMatrix.array.slice();for(let i=0;i<c.count;i++){const m=c.instanceMatrix.array,k=i*16,r=Math.hypot(m[k],m[k+2]);m[k]=r;m[k+2]=0;m[k+8]=0;m[k+10]=r;}}else{c.instanceMatrix.array.set(window.__crownMatrices);delete window.__crownMatrices;}
       c.instanceMatrix.needsUpdate=true;g.attributes.position.array.set(positions);g.attributes.normal.array.set(normals);g.attributes.position.needsUpdate=true;g.attributes.normal.needsUpdate=true;g.computeBoundingSphere();c.computeBoundingSphere();a.engine.wake();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      },payload);
      await capture(`shots/toronto-waterfront-vegetation-${layout}-${shaped?'after':'before'}.png`);
     }
    }
    await page.setViewportSize({width:1200,height:800});await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});
   }

   await page.locator('#walk-right').click({noWaitAfter:true,timeout:60000});
   await page.locator('#walk-right').click({noWaitAfter:true,timeout:60000});
   for(const [layout,width,height] of [['desktop',1200,800],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.waitForFunction(r=>Math.abs(window.__APP.engine.camera.aspect-r)<.01,width/height);
    for(const enabled of [false,true]){await page.evaluate(async enabled=>{const a=window.__APP,e=a.cityTerrain.waterfront.group.getObjectByName('illustrativeShorelineClosure');if(e.geometry.attributes.position.count!==4728)throw Error('Missing shoreline closure');e.visible=enabled;a.engine.wake();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},enabled);await capture(`shots/toronto-waterfront-edge-${layout}-${enabled?'after':'before'}.png`,true);}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }
   for(const [layout,width,height] of [['desktop',1200,800],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.waitForFunction(r=>Math.abs(window.__APP.engine.camera.aspect-r)<.01,width/height);
    const poseBefore=await state();await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});assert.equal(await page.locator('#waterfront-options').isVisible(),false);assert.deepEqual(await state(),poseBefore);
    for(const id of ['walk-waterfront','waterfront-more','walk-back','walk-forward','walk-left','walk-right']){const b=await page.locator(`#${id}`).boundingBox();assert.ok(b.height>=44&&b.width>=44,`${id} touch target`);}
    if(layout==='mobile'){const b=await page.locator('#city-terrain-controls').boundingBox();assert.ok(b.height<190&&b.y>height/2&&b.y+b.height<=height-60,'Compact controls leave scene unobstructed');}
    await capture(`shots/toronto-waterfront-controls-${layout}-after.png`);
    const lightBefore=await page.evaluate(()=>{const e=window.__APP.engine;return {sun:e.sun.intensity,hemi:e.hemi.intensity,exposure:e.renderer.toneMappingExposure};});
    for(const enabled of [false,true]){await page.evaluate(async enabled=>{const a=window.__APP,fill=a.cityTerrain.waterfront.group.getObjectByName('waterfrontDaylightFill');if(!fill?.isHemisphereLight||fill.intensity!==.85)throw Error('Missing daylight fill');fill.visible=enabled;a.engine.wake();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},enabled);await capture(`shots/toronto-waterfront-light-${layout}-${enabled?'after':'before'}.png`,true);}
    assert.deepEqual(await page.evaluate(()=>{const e=window.__APP.engine;return {sun:e.sun.intensity,hemi:e.hemi.intensity,exposure:e.renderer.toneMappingExposure};}),lightBefore);
    for(const enabled of [false,true]){await page.evaluate(async enabled=>{const a=window.__APP,m=a.cityTerrain.waterfront.group.getObjectByName('terrainDrapedSidewalks').material;m.userData.filteredJoints.value=enabled?1:0;a.engine.wake();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},enabled);await capture(`shots/toronto-waterfront-paving-${layout}-${enabled?'after':'before'}.png`,true);}


    await page.locator('#waterfront-more').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#waterfront-options').isVisible(),true);
    await page.locator('#waterfront-distance').focus();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.active),false);assert.equal(await page.evaluate(()=>{let lit=false;window.__APP.engine.scene.traverseVisible(o=>{if(o.name==='waterfrontDaylightFill')lit=true;});return lit;}),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'walk-waterfront');
    await page.locator('#walk-waterfront').click({noWaitAfter:true,timeout:60000});assert.equal(await page.locator('#waterfront-more').getAttribute('aria-expanded'),'false');assert.equal((await state()).walk.distance,0);
    await page.locator('#waterfront-more').click({noWaitAfter:true,timeout:60000});await page.locator('#waterfront-distance').evaluate(e=>{e.value='1100';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#walk-right').click({noWaitAfter:true,timeout:60000});await page.locator('#walk-right').click({noWaitAfter:true,timeout:60000});
   }
   await page.setViewportSize({width:1200,height:800});await page.locator('#walk-face').click({noWaitAfter:true,timeout:60000});
  }
  if(name==='street'){
   for(const [layout,width,height] of [['desktop',1200,800],['mobile',390,844]]){
    await page.setViewportSize({width,height});await page.waitForFunction(r=>Math.abs(window.__APP.engine.camera.aspect-r)<.01,width/height);
    for(const enabled of [false,true]){await page.evaluate(async enabled=>{const a=window.__APP;for(const t of a.cityTerrain.buildings.tiles.values())t.data.group.children[0].material.userData.streetDetail.value=enabled?1:0;a.engine.wake();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},enabled);await capture(`shots/toronto-waterfront-frontage-${layout}-${enabled?'after':'before'}.png`,true);}
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }
   await page.setViewportSize({width:1200,height:800});
  }

 }
 await page.locator('#waterfront-distance').evaluate(e=>{e.value=e.max;e.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#walk-forward').click({noWaitAfter:true,timeout:60000});const end=await state();assert.equal(end.walk.distance,end.walk.lengthM);
 await page.setViewportSize({width:390,height:844});await page.locator('#walk-back').tap();assert.equal((await state()).walk.distance,end.walk.lengthM-10);await page.locator('#walk-face').tap();assert.equal((await state()).walk.yaw,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture('shots/toronto-waterfront-mobile.png');
 await page.locator('#walk-waterfront').tap();assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.active),false);assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.buildings.state.joinVertices),0);assert.ok(await page.evaluate(()=>[...window.__APP.cityTerrain.buildings.tiles.values()].every(t=>t.data.group.children[0].material.userData.streetDetail.value===0)));const after=await page.evaluate(()=>({p:window.__APP.engine.camera.position.toArray(),t:window.__APP.controls.target.toArray(),f:window.__APP.replay.f}));for(const key of ['p','t'])assert.ok(after[key].every((v,i)=>Math.abs(v-before[key][i])<1e-6));assert.equal(after.f,before.f);
 await page.locator('#walk-waterfront').tap();await page.waitForFunction(()=>window.__APP.cityTerrain.waterfront.active);await page.locator('#waterfront-more').tap();await page.locator('#toggle-city-terrain').tap();assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.active),false);assert.equal(await page.evaluate(()=>window.__APP.cityTerrain.waterfront.active),false);assert.equal(await page.locator('#walk-waterfront').isVisible(),false);assert.equal(await page.evaluate(()=>window.__APP.replay.f),60);assert.equal(await page.locator('#recording-mode').isEnabled(),true);assert.deepEqual(errors,[]);console.log('Waterfront source scene, load recovery, walking bounds, mobile controls and transit restoration passed');console.log('Waterfront screenshot work',JSON.stringify({diagnosticShots,captures,skippedCaptures,captureMs:Math.round(captureMs)}));
}finally{await browser?.close();await server.httpServer.close();}
