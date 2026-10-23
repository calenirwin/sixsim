// Offline schedule interpolation only. No realtime observations or vehicle identities.
// CSV blanks, nulls and booleans are not numeric zero. Missing optional distances
// remain NaN so the associated geometry/trip can be omitted without fabrication.
function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}
const sequence = value => Number.isSafeInteger(value) && value >= 0;
const coordinate = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit;

export function serviceSeconds(value) {
  if (!/^\d+:\d{2}:\d{2}$/.test(value)) throw new Error('Invalid service time');
  const [h,m,s] = value.split(':').map(Number);
  if (m>59 || s>59 || !Number.isSafeInteger(h*3600+m*60+s)) throw new Error('Invalid service time');
  return h*3600+m*60+s;
}
export function clock(seconds) {
  const h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60), s=Math.floor(seconds%60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
export function prepare(data) {
  if (data.version!==1 || data.timezone!=='America/Toronto') throw new Error('Unsupported schedule');
  const shapes=new Map(), times=new Map(), stops=new Map(data.stops.map(s=>[s.stop_id,s]));
  for (const stop of stops.values()) {
    if (!coordinate(numeric(stop.stop_lon),180) || !coordinate(numeric(stop.stop_lat),90)) throw new Error('Invalid stop coordinates');
  }
  for (const p of data.shapes) {
    const list=shapes.get(p.shape_id)||[];
    list.push({d:numeric(p.shape_dist_traveled),lon:numeric(p.shape_pt_lon),lat:numeric(p.shape_pt_lat),seq:numeric(p.shape_pt_sequence)});shapes.set(p.shape_id,list);
  }
  for (const [id, points] of shapes) {
    points.sort((a,b)=>a.seq-b.seq);
    // Omit the entire malformed shape: dropping individual points would invent a path.
    if(points.some((p,i)=>!Number.isFinite(p.d) || p.d<0 || !coordinate(p.lon,180) || !coordinate(p.lat,90) || !sequence(p.seq) || (i&&(p.d<points[i-1].d || p.seq<=points[i-1].seq)))) shapes.delete(id);
  }
  for (const r of data.stop_times) {
    if(!stops.has(r.stop_id)) throw new Error('Missing stop');
    const list=times.get(r.trip_id)||[];
    list.push({...r, a:serviceSeconds(r.arrival_time),b:serviceSeconds(r.departure_time),d:numeric(r.shape_dist_traveled),seq:numeric(r.stop_sequence)});times.set(r.trip_id,list);
  }
  const trips=data.trips.map(t=>{
    const ts=(times.get(t.trip_id)||[]).sort((a,b)=>a.seq-b.seq);
    if(ts.length<2 || ts.some((s,i)=>!sequence(s.seq) || s.a>s.b || (i&&(s.a<ts[i-1].b || s.seq<=ts[i-1].seq)))) throw new Error('Invalid trip times');
    const shape=shapes.get(t.shape_id);
    const usable=shape?.length>1 && ts.every((s,i)=>Number.isFinite(s.d) && s.d>=shape[0].d && s.d<=shape.at(-1).d && (!i||s.d>=ts[i-1].d));
    return {...t,times:ts,shape:usable?shape:null};
  });
  return {trips,shapes,stops};
}
export function position(trip,seconds) {
  const ts=trip.times;
  if(!Number.isFinite(seconds) || !trip.shape || seconds<ts[0].a || seconds>ts.at(-1).b) return null;
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
