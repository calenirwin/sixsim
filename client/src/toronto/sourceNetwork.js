// Source connectivity only: no lanes, inferred junctions, transfer walks or routing rules.
export function sourceNetwork(data) {
  if(data.coordinates!=='EPSG:4326' || data.roads.length>5000)throw new Error('Unsupported source network');
  const nodes=new Map(), ids=new Set();
  const point=p=>{if(p.length<2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0])>180 || Math.abs(p[1])>90)throw new Error('Invalid network coordinate');};
  for(const road of data.roads) {
    if(typeof road.id!=='string' || ids.has(road.id))throw new Error('Duplicate/missing centreline ID');ids.add(road.id);
    const lines=road.geometry.type==='LineString'?[road.geometry.coordinates]:road.geometry.type==='MultiLineString'?road.geometry.coordinates:null;
    if(!lines?.length)throw new Error('Invalid centreline geometry');
    for(const line of lines){if(line.length<2)throw new Error('Empty centreline');line.forEach(point);}
    for(const key of ['FROM_INTERSECTION_ID','TO_INTERSECTION_ID']) {
      const id=road.properties[key];if(id===null)continue;
      if(!Number.isSafeInteger(id))throw new Error('Invalid intersection ID');
      const edges=nodes.get(id)||new Set();edges.add(road.id);nodes.set(id,edges);
    }
  }
  for(const shape of data.shapes)for(const line of shape.lines)line.forEach(point);
  for(const stop of data.stops){
    if([stop.stop_lon,stop.stop_lat].some(v=>typeof v!=='string' || !v.trim()))throw new Error('Missing stop coordinate');
    point([Number(stop.stop_lon),Number(stop.stop_lat)]);
  }
  return {...data,basis:'source-centrelines-and-GTFS-context',routing:false,nodes:[...nodes].sort(([a],[b])=>a-b).map(([id,edges])=>({id,edge_ids:[...edges].sort()}))};
}
