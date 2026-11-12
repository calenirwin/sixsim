// Short pointer presses retain the discrete step; a held press uses the walk clock.
export function pressToWalk(button,{step,setHeld,beforeStart=()=>{},delay=300}){
 let pointer=null,timer=null,suppressClick=false;
 const finish=cancelled=>{
  if(pointer===null)return;
  clearTimeout(timer);timer=null;if(cancelled)suppressClick=true;
  const id=pointer;pointer=null;setHeld(false);
  if(button.hasPointerCapture(id))button.releasePointerCapture(id);
 };
 button.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary)return;
  beforeStart();pointer=e.pointerId;suppressClick=false;button.setPointerCapture(pointer);
  timer=setTimeout(()=>{timer=null;suppressClick=true;setHeld(true);},delay);
 });
 button.addEventListener('pointerup',e=>{if(e.pointerId===pointer)finish(false);});
 for(const type of ['pointercancel','lostpointercapture'])button.addEventListener(type,e=>{if(e.pointerId===pointer)finish(true);});
 button.addEventListener('click',e=>{
  if(suppressClick&&e.detail!==0){e.preventDefault();suppressClick=false;return;}
  step();
 });
 return ()=>finish(true);
}
