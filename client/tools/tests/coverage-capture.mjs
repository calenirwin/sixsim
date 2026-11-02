// Repeatable fixed-camera visual evidence; software-renderer timings are not device FPS.
import fs from 'node:fs';
import {preview} from 'vite';
import {chromium} from 'playwright';
const label=process.env.CAPTURE_LABEL||'after';
const server=await preview({configFile:'vite.space.config.js',preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1100,height:750}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Shader Error|WebGLProgram/.test(m.text()))errors.push(m.text());});
 const began=Date.now();await page.goto(server.resolvedUrls.local[0],{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__APP?.streamer.tiles.get('0_0')?.state==='ready',{}, {timeout:90000});
 await page.evaluate(()=>{const a=window.__APP;a.setPaused(true);a.seek(70);a.controls.target.set(0,0,-200);a.engine.camera.position.set(550,800,800);a.controls.update();a.engine.wake();});
 await page.waitForFunction(()=>window.__APP.streamer.outstanding===0,{}, {timeout:90000});
 console.log('Coverage tiles ready',Date.now()-began);
 fs.mkdirSync('shots',{recursive:true});await page.screenshot({path:`shots/toronto-coverage-${label}.png`,timeout:60000});
 const stats=await page.evaluate(()=>{const a=window.__APP;return {tiles:[...a.streamer.tiles.values()].filter(t=>t.state==='ready').length,loadedTriangles:[...a.streamer.tiles.values()].filter(t=>t.state==='ready').reduce((n,t)=>n+t.data.group.children.reduce((n,m)=>n+(m.geometry?.index?.count||m.geometry?.attributes.position?.count||0)/3,0),0),geometries:a.renderer.info.memory.geometries,textures:a.renderer.info.memory.textures}});
 fs.writeFileSync(`shots/toronto-coverage-${label}.json`,JSON.stringify({...stats,loadAndCaptureMs:Date.now()-began,errors},null,2));if(errors.length)throw Error(errors.join('\n'));console.log(label,stats);
} finally{await browser.close();await server.close();}
