// One fixed extra dwell; downstream travel times are unchanged, with no recovery.
export function applyTransitScenario(schedule,serviceDay,input=null) {
  if(input===null)return {schedule,scenario:null,deviations:[]};
  const keys=['version','serviceDay','tripId','stopOccurrence','stopId','extraDwellSeconds'];
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!keys.includes(k))||input.version!==1||input.serviceDay!==serviceDay||typeof input.tripId!=='string'||!Number.isSafeInteger(input.stopOccurrence)||input.stopOccurrence<0||typeof input.stopId!=='string'||![0,60].includes(input.extraDwellSeconds))throw new Error('Invalid fixed-dwell scenario');
  const trip=schedule.trips.find(t=>t.trip_id===input.tripId),target=trip?.times[input.stopOccurrence];
  if(!trip?.shape||!target||target.stop_id!==input.stopId)throw new Error('Invalid dwell target');
  const scenario=Object.freeze({...input}),deviations=Object.freeze(trip.times.map((t,i)=>Object.freeze({stopOccurrence:i,stopId:t.stop_id,scheduledArrival:t.a,scheduledDeparture:t.b,arrivalDelaySeconds:i>scenario.stopOccurrence?scenario.extraDwellSeconds:0,departureDelaySeconds:i>=scenario.stopOccurrence?scenario.extraDwellSeconds:0})));
  const times=trip.times.map((t,i)=>({...t,a:t.a+deviations[i].arrivalDelaySeconds,b:t.b+deviations[i].departureDelaySeconds}));
  return {scenario,deviations,schedule:{...schedule,trips:schedule.trips.map(t=>t===trip?{...trip,times}:t)}};
}
