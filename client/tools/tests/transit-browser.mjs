import {chromium} from 'playwright';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist-toronto');
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname.replace(/^\/sixsim\//,'/');const file=path.resolve(root,'.'+p);if(!file.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.html')?'text/html':'application/json');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const prefix of ['/','/sixsim/']){
  await page.route('**/*',route=>{const u=new URL(route.request().url());assert.equal(u.origin,origin);assert.ok(u.pathname.startsWith(prefix));return route.continue();});
  await page.goto(origin+prefix+'corridor.html');await page.waitForFunction(()=>window.__CORRIDOR?.active>0);
  assert.match(await page.locator('#coverage').innerText(),/378 scheduled trips/);
  await page.locator('#time').evaluate(el=>{el.value=90000;el.dispatchEvent(new Event('input'));});
  assert.match(await page.locator('#clock').innerText(),/25:00:00 America\/Toronto/);assert.ok(await page.evaluate(()=>window.__CORRIDOR.active)>0);
  await page.locator('#direction').selectOption('1');assert.ok(await page.evaluate(()=>window.__CORRIDOR.active)>=0);
  await page.locator('#play').click();await page.waitForFunction(()=>window.__CORRIDOR.seconds>90000);await page.locator('#play').click();
  await page.locator('#time').evaluate(el=>{el.value=28800;el.dispatchEvent(new Event('input'));});
  await page.locator('#direction').selectOption('all');
  await fs.mkdir('shots',{recursive:true});await page.screenshot({path:'shots/toronto-510-schedule.png',fullPage:true});
  await page.unroute('**/*');
 }
 await page.route('**/assets/510-*.json',route=>route.fulfill({status:404,body:'missing'}));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('HTTP 404'));assert.equal(await page.locator('#retry').isVisible(),true);assert.equal(await page.locator('#play').isDisabled(),true);
 await page.unroute('**/assets/510-*.json');await page.locator('#retry').click();await page.waitForFunction(()=>window.__CORRIDOR?.active>0);
 const malformed=await page.evaluate(()=>window.__CORRIDOR.data);
 const invalidShape=malformed.shapes[0].shape_id;
 malformed.shapes[0].shape_dist_traveled=' ';
 await page.route('**/assets/510-*.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(malformed)}));
 await page.reload();await page.waitForFunction(()=>window.__CORRIDOR?.model.shapes.size===6);
 assert.equal(await page.evaluate(id=>window.__CORRIDOR.model.trips.filter(t=>t.shape_id===id).every(t=>t.shape===null),invalidShape),true);
 assert.match(await page.locator('#status').innerText(),/[1-9]\d* trips omitted/);
 assert.equal(await page.locator('#play').isEnabled(),true);
 await page.unroute('**/assets/510-*.json');
 malformed.shapes=[];
 await page.route('**/assets/510-*.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(malformed)}));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('No valid route shapes'));
 assert.equal(await page.locator('#play').isDisabled(),true);
 assert.equal(await page.locator('#retry').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('Corridor: root/subpath, service midnight, playback, direction, failure/recovery, malformed-shape omission and screenshot passed');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
