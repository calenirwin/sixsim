// Gaps are between trips on the same directed GTFS pattern/stop occurrence.
// They are service-day seconds, not observations or route-wide headways.
export function departureComparison(baseline,current,graph,tripId) {
  const pattern=graph.patterns.find(p=>p.tripIds.includes(tripId));
  if(!pattern)throw new Error('Departure target unavailable');
  const before=new Map(baseline.trips.map(t=>[t.trip_id,t])),after=new Map(current.trips.map(t=>[t.trip_id,t]));
  const target=before.get(tripId);
  const event=(trips,i)=>{
    const ordered=pattern.tripIds.map(id=>({tripId:id,departure:trips.get(id).times[i].b})).sort((a,b)=>a.departure-b.departure||a.tripId.localeCompare(b.tripId));
    const index=ordered.findIndex(e=>e.tripId===tripId),e=ordered[index],previous=ordered[index-1]||null;
    return {departure:e.departure,previous,gapSeconds:previous?e.departure-previous.departure:null};
  };
  return {version:1,timezone:'America/Toronto',tripId,patternId:pattern.id,serviceDay:graph.serviceDay,basis:'same-pattern-scheduled-departures',rows:target.times.map((t,i)=>({stopOccurrence:i,stopId:t.stop_id,stopName:baseline.stops.get(t.stop_id)?.stop_name||t.stop_id,baseline:event(before,i),selected:event(after,i)}))};
}
export function validateDepartures(value,header) {
  if(value==null)return; // Legacy ATRK recordings remain readable.
  const fail=()=>{throw new Error('Invalid departure comparison replay');};
  const p=header.transitGraph?.patterns.find(p=>p.id===value.patternId),nodes=new Map(header.transitGraph?.nodes.map(n=>[n.id,n]));
  if(value.version!==1||value.timezone!==header.timezone||value.basis!=='same-pattern-scheduled-departures'||value.serviceDay!==header.serviceDay||!p?.tripIds.includes(value.tripId)||!Array.isArray(value.rows)||value.rows.length!==p.nodeIds.length)fail();
  for(const [i,row] of value.rows.entries()) {
    if(row.stopOccurrence!==i||row.stopId!==nodes.get(p.nodeIds[i])?.stopId||typeof row.stopName!=='string')fail();
    for(const key of ['baseline','selected']) {
      const e=row[key];if(!e||!Number.isSafeInteger(e.departure)||e.departure<0)fail();
      if(e.previous===null){if(e.gapSeconds!==null)fail();}
      else if(!e.previous||!p.tripIds.includes(e.previous.tripId)||e.previous.tripId===value.tripId||!Number.isSafeInteger(e.previous.departure)||e.previous.departure<0||e.previous.departure>e.departure||e.gapSeconds!==e.departure-e.previous.departure)fail();
      if(i&&e.departure<=value.rows[i-1][key].departure)fail();
    }
    const s=header.transitScenario,delay=s?.tripId===value.tripId&&i>=s.stopOccurrence?s.extraDwellSeconds:0;
    if(row.selected.departure!==row.baseline.departure+delay)fail();
    if(!s?.extraDwellSeconds&&JSON.stringify(row.selected)!==JSON.stringify(row.baseline))fail();
    if(row.selected.previous&&row.selected.previous.tripId===row.baseline.previous?.tripId){
      const predecessorDelay=s?.tripId===row.selected.previous.tripId&&i>=s.stopOccurrence?s.extraDwellSeconds:0;
      if(row.selected.previous.departure!==row.baseline.previous.departure+predecessorDelay)fail();
    }
    if(s?.tripId===value.tripId&&header.transitDeviations[i].scheduledDeparture!==row.baseline.departure)fail();
  }
}
