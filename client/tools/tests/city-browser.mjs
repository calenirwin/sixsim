import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { preview } from 'vite';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
const server=await preview({configFile:'vite.config.js',preview:{host:'127.0.0.1',port:0}});
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:750}}),errors=[],requests=[];
 const base=server.resolvedUrls.local[0];
 await page.route('**/*',r=>{const u=new URL(r.request().url());requests.push(u.pathname);if(u.origin!==new URL(base).origin){errors.push('external '+u.href);return r.abort();}return r.continue();});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(base+'?city=toronto&pr=1',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__APP?.streamer.tiles.get('0_0')?.state==='ready' && window.__APP.engine.frames>3,{}, {timeout:60000});
 const first=await page.evaluate(()=>{const a=window.__APP;a.setPaused(true);a.seek(0);const P=a.traffic.pools['scheduled-trip-marker'];return {engine:a.engine.constructor.name,streamer:a.streamer.constructor.name,masses:a.streamer.tiles.get('0_0').data.records.length,actors:P.n,frame:a.replay.f,position:Array.from(P.mb.instanceMatrix.array.slice(12,15)),expected:a.tracks.frames[0].veh[0],calls:a.renderer.info.render.calls,triangles:a.renderer.info.render.triangles};});
 assert.equal(first.masses,360);assert.equal(first.actors,10);assert.ok(first.calls>0);assert.deepEqual(first.position,[first.expected.x,first.expected.y,first.expected.z]);
 await page.evaluate(()=>window.__APP.controls.target.set(0,0,-1100));
 await page.waitForFunction(()=>window.__APP.streamer.error || window.__APP.streamer.tiles.get('0_-3')?.state==='ready',{}, {timeout:90000});
 assert.equal(await page.evaluate(()=>window.__APP.streamer.error?.message||null),null);
 const context=await page.evaluate(()=>({roads:window.__APP.network.roads.length,stops:window.__APP.network.stops.length,nodes:window.__APP.network.nodes.length,lines:window.__APP.contextGroup.children.length}));
 assert.equal(context.roads,841);assert.equal(context.stops,43);assert.ok(context.nodes>100);assert.equal(context.lines,3);
 await page.evaluate(()=>window.__APP.controls.target.set(0,0,-200));
 const moved=await page.evaluate(()=>{const a=window.__APP;a.seek(60);return {frame:a.replay.f,position:Array.from(a.traffic.pools['scheduled-trip-marker'].mb.instanceMatrix.array.slice(12,15)),expected:a.tracks.frames[60].veh[0]};});
 assert.equal(moved.frame,60);assert.notDeepEqual(moved.position,first.position);assert.deepEqual(moved.position,[moved.expected.x,moved.expected.y,moved.expected.z]);
 assert.match(await page.locator('#stats').innerText(),/not live vehicles/);assert.ok(!requests.some(p=>/\/models\/|\/tiles\/|columbia|lf39|trains\.json/.test(p)),JSON.stringify(requests));assert.deepEqual(errors,[]);
 await fs.mkdir('shots',{recursive:true});const shot=await page.screenshot({path:'shots/toronto-city-runtime.png'});
 const pixels=PNG.sync.read(shot);let lit=0;
 for(let y=250;y<650;y++)for(let x=300;x<750;x++){const i=(y*pixels.width+x)*4;if(Math.max(...pixels.data.subarray(i,i+3))>85)lit++;}
 assert.ok(lit>1000,`Expected visible source geometry, got ${lit} lit pixels`);
 await page.goto(base+'?city=toronto&tiles=tiles');await page.waitForFunction(()=>document.querySelector('#loading p').textContent.includes('verified tile'));
 await page.route('**/*0_0*.bin',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.goto(base+'?city=toronto&pr=1');
 await page.waitForFunction(()=>document.querySelector('#loading p').textContent.includes('HTTP 503'));
 await page.unroute('**/*0_0*.bin');
 await page.route('**/*.atrk',async r=>{const response=await r.fetch();const body=Buffer.from(await response.body());const i=body.indexOf('toronto-queen-spadina-massing');assert.ok(i>=0);body[i]=120;await r.fulfill({response,body});});
 await page.goto(base+'?city=toronto');await page.waitForFunction(()=>document.querySelector('#loading p').textContent.includes('Actor/asset profile mismatch'));
 console.log(JSON.stringify({masses:first.masses,actors:first.actors,litPixels:lit,actorContract:'ATRK v1 / CoreReplay'}));
} finally {await browser?.close();await new Promise(r=>server.httpServer.close(r));}
