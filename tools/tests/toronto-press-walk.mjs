import test from 'node:test';import assert from 'node:assert/strict';
import {pressToWalk} from '../../client/src/toronto/pressToWalk.js';
class Button extends EventTarget{
 captured=null;
 setPointerCapture(id){this.captured=id;}
 hasPointerCapture(id){return this.captured===id;}
 releasePointerCapture(id){this.captured=null;this.send('lostpointercapture',{pointerId:id});}
 send(type,props={}){this.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:1,isPrimary:true,button:0,detail:1,...props}));}
}
test('Tap and keyboard activation step once; held release never adds a ten metre jump',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=new Button(),held=[];let steps=0;
 pressToWalk(b,{step:()=>steps++,setHeld:v=>held.push(v)});
 b.send('pointerdown');t.mock.timers.tick(100);b.send('pointerup');b.send('click');assert.equal(steps,1);assert.deepEqual(held,[false]);
 b.send('pointerdown');t.mock.timers.tick(300);assert.equal(held.at(-1),true);b.send('pointerup');b.send('click');assert.equal(steps,1);assert.equal(held.at(-1),false);assert.equal(b.captured,null);
 b.send('click',{detail:0});assert.equal(steps,2);
});
test('Cancellation clears delayed starts and sustained movement; secondary pointers are ignored',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=new Button(),held=[];let steps=0;
 const cancel=pressToWalk(b,{step:()=>steps++,setHeld:v=>held.push(v)});
 b.send('pointerdown',{button:2});b.send('pointerdown',{isPrimary:false});t.mock.timers.tick(500);assert.deepEqual(held,[]);
 b.send('pointerdown');cancel();t.mock.timers.tick(500);assert.deepEqual(held,[false]);b.send('click');assert.equal(steps,0);
 for(const event of ['pointercancel','lostpointercapture']){b.send('pointerdown');t.mock.timers.tick(300);b.send(event);assert.equal(held.at(-1),false);b.send('click');assert.equal(steps,0);}
 b.send('pointerdown');b.send('pointerup');b.send('click');assert.equal(steps,1,'fresh tap works after cancellation');
});
