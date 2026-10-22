// Offline schedule interpolation only. No realtime observations or vehicle identities.
export function serviceSeconds(value) {
  if (!/^\d+:\d{2}:\d{2}$/.test(value)) throw new Error('Invalid service time');
  const [h,m,s] = value.split(':').map(Number);
  if (m>59 || s>59) throw new Error('Invalid service time');
  return h*3600+m*60+s;
}
export function clock(seconds) {
  const h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60), s=Math.floor(seconds%60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
export function prepare(data) {
  if (data.version!==1 || data.timezone!=='America/Toronto') throw new Error('Unsupported schedule');
  const shapes=new Map(), times=new Map(), stops=new Map(data.stops.map(s=>[s.stop_id,s]));
  for (const p of data.shapes) {
    const list=shapes.get(p.shape_id)||[];
    list.push({d:Number(p.shape_dist_traveled),lon:Number(p.shape_pt_lon),lat:Number(p.shape_pt_lat),seq:Number(p.shape_pt_sequence)});shapes.set(p.shape_id,list);
  }
  for (const points of shapes.values()) {
    points.sort((a,b)=>a.seq-b.seq);
    if(points.some((p,i)=>!Number.isFinite(p.d+p.lon+p.lat) || (i&&p.d<points[i-1].d))) throw new Error('Invalid shape distances');
  }
  for (const r of data.stop_times) {
    if(!stops.has(r.stop_id)) throw new Error('Missing stop');
    const list=times.get(r.trip_id)||[];
    list.push({...r, a:serviceSeconds(r.arrival_time),b:serviceSeconds(r.departure_time),d:r.shape_dist_traveled===''?NaN:Number(r.shape_dist_traveled)});times.set(r.trip_id,list);
  }
  const trips=data.trips.map(t=>{
    const ts=(times.get(t.trip_id)||[]).sort((a,b)=>Number(a.stop_sequence)-Number(b.stop_sequence));
    if(ts.length<2 || ts.some((s,i)=>s.a>s.b || (i&&s.a<ts[i-1].b))) throw new Error('Invalid trip times');
    const shape=shapes.get(t.shape_id);
    const usable=shape?.length>1 && ts.every((s,i)=>Number.isFinite(s.d) && s.d>=shape[0].d && s.d<=shape.at(-1).d && (!i||s.d>=ts[i-1].d));
    return {...t,times:ts,shape:usable?shape:null};
  });
  return {trips,shapes,stops};
}
export function position(trip,seconds) {
  const ts=trip.times;
  if(!trip.shape || seconds<ts[0].a || seconds>ts.at(-1).b) return null;
  let distance=ts.at(-1).d;
  for(let i=0;i<ts.length;i++) {
    if(seconds<=ts[i].b){distance=ts[i].d;break;}
    if(i+1<ts.length && seconds<ts[i+1].a){
      distance=ts[i].d+(ts[i+1].d-ts[i].d)*(seconds-ts[i].b)/(ts[i+1].a-ts[i].b);break;
    }
  }
  const ps=trip.shape;
  for(let i=1;i<ps.length;i++) if(distance<=ps[i].d){
    const t=ps[i].d===ps[i-1].d?0:(distance-ps[i-1].d)/(ps[i].d-ps[i-1].d);
    return [ps[i-1].lon+t*(ps[i].lon-ps[i-1].lon),ps[i-1].lat+t*(ps[i].lat-ps[i-1].lat)];
  }
  return [ps.at(-1).lon,ps.at(-1).lat];
}
