import places from '../../fixtures/toronto/discovery/places.json' with {type:'json'};
export const discovery=places;
const fold=s=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function findPlaces(query='',group='') {
 const terms=fold(query).trim().split(/\s+/).filter(Boolean);
 if(!terms.length&&!group)return [];
 return places.pois.filter(p=>(!group||p.group===group)&&terms.every(t=>fold(`${p.name} ${p.neighbourhood}`).includes(t))).sort((a,b)=>a.name.localeCompare(b.name,'en')||a.id.localeCompare(b.id,'en'));
}
export function destination(id,grid,frame){
 const p=[...places.starts,...places.pois].find(p=>p.id===id);if(!p)return null;
 const [x,z]=frame.project(...p.coordinate),y=grid.sample(x,z);return y===null?null:{place:p,x,y,z};
}
export function addDiscovery({parent,grid,frame,focus}) {
 const box=document.createElement('details');box.id='city-discovery';box.open=true;
 const title=document.createElement('summary');title.textContent='Neighbourhoods & landmarks';box.append(title);
 const label=document.createElement('label');label.textContent='Neighbourhood starting point ';const select=document.createElement('select');select.id='discovery-neighbourhood';label.append(select);box.append(label);
 const all=document.createElement('option');all.value='';all.textContent='All Toronto';select.append(all);
 for(const p of [...places.starts].sort((a,b)=>a.name.localeCompare(b.name,'en'))){const o=document.createElement('option');o.value=p.group;o.textContent=p.name;select.append(o);}
 const searchLabel=document.createElement('label');searchLabel.textContent='Find a landmark ';const input=document.createElement('input');input.id='discovery-search';input.type='search';input.placeholder='Park, museum, public art…';input.maxLength=120;searchLabel.append(input);box.append(searchLabel);
 const selected=document.createElement('div');selected.id='discovery-selected';selected.setAttribute('role','status');box.append(selected);
 const status=document.createElement('div');status.id='discovery-results-status';status.setAttribute('role','status');box.append(status);const list=document.createElement('ul');list.id='discovery-results';box.append(list);
 const prev=document.createElement('button'),next=document.createElement('button');prev.textContent='Previous places';next.textContent='More places';box.append(prev,next);
 const source=document.createElement('a');source.href='https://open.toronto.ca/dataset/strollto/';source.target='_blank';source.rel='noopener noreferrer';source.textContent='City of Toronto · StrollTO';box.append(source);
 const note=document.createElement('div');note.textContent='Source locations, not entrances or directions. Buildings are source massing, not landmark-specific models.';box.append(note);parent.insertBefore(box,parent.children[1]);
 let offset=0;
 const go=id=>{const d=destination(id,grid,frame);if(!d){selected.textContent='Terrain unavailable at this source point; view retained.';return;}focus(...d.place.coordinate);selected.textContent=`Selected: ${d.place.name} · ${d.place.neighbourhood}`;};
 function render(){const rows=findPlaces(input.value,select.value);status.textContent=rows.length?`${offset+1}–${Math.min(offset+8,rows.length)} of ${rows.length} places`:input.value||select.value?'No matching places. Try another name or All Toronto.':'Choose a neighbourhood or search across Toronto.';list.replaceChildren();for(const p of rows.slice(offset,offset+8)){const li=document.createElement('li'),b=document.createElement('button');b.textContent=`${p.name} · ${p.neighbourhood}`;b.dataset.discoveryId=p.id;b.onclick=()=>go(p.id);li.append(b);list.append(li);}prev.hidden=offset===0;next.hidden=offset+8>=rows.length;}
 input.oninput=()=>{offset=0;render();};select.onchange=()=>{offset=0;input.value='';if(select.value)go(places.starts.find(p=>p.group===select.value).id);render();};prev.onclick=()=>{offset=Math.max(0,offset-8);render();};next.onclick=()=>{offset+=8;render();};render();
 return box;
}
