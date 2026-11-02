// Validate explicit experiment metadata; it is a model input, never an observation.
export function validateScenarioReplay(header,patterns,nodes) {
  const s=header.transitScenario,d=header.transitDeviations||[];
  if(s==null){if(d.length)throw new Error('Unexpected transit deviations');return;}
  const fail=()=>{throw new Error('Invalid transit dwell scenario replay');};
  const p=[...patterns.values()].find(p=>p.tripIds.includes(s.tripId));
  if(s.version!==1||s.serviceDay!==header.transitGraph.serviceDay||![0,60].includes(s.extraDwellSeconds)||!Number.isSafeInteger(s.stopOccurrence)||s.stopOccurrence<0||!p||nodes.get(p.nodeIds[s.stopOccurrence])?.stopId!==s.stopId||!Array.isArray(d)||d.length!==p.nodeIds.length)fail();
  d.forEach((row,i)=>{
    if(row.stopOccurrence!==i||row.stopId!==nodes.get(p.nodeIds[i]).stopId||!Number.isFinite(row.scheduledArrival)||!Number.isFinite(row.scheduledDeparture)||row.scheduledArrival<0||row.scheduledDeparture<row.scheduledArrival||i&&row.scheduledArrival<=d[i-1].scheduledDeparture||row.arrivalDelaySeconds!==(i>s.stopOccurrence?s.extraDwellSeconds:0)||row.departureDelaySeconds!==(i>=s.stopOccurrence?s.extraDwellSeconds:0))fail();
  });
}
