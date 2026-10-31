// Kinematic actors driven by a pinned service day, stepped by the inherited world clock.
// No observed vehicles, collision response, speed calibration or inferred track elevation.
import { departureComparison } from '../../client/src/toronto/departures.js';
import { applyTransitScenario } from './transitScenario.mjs';
import { prepare } from '../../client/src/toronto/transit.js';
import { buildServiceGraph, graphPosition } from '../../client/src/toronto/serviceGraph.js';
import { localFrame } from '../../client/src/shared/localFrame.js';
export function scheduledTransit(data, { geoOrigin, startSeconds = 28800, scenario: scenarioInput = null } = {}) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('Invalid service start');
  const baseline=prepare(data);
  const {schedule,scenario,deviations} = applyTransitScenario(baseline,data.service_day,scenarioInput), frame = localFrame(geoOrigin);
  const ids = new Set();
  for (const t of schedule.trips) {
    if (!t.trip_id || ids.has(t.trip_id)) throw new Error('Missing or duplicate trip ID');
    ids.add(t.trip_id);
  }
  const compiled=buildServiceGraph(schedule,{geoOrigin,serviceDay:data.service_day,sourceSha256:data.source_sha256});
  if(scenario && !compiled.bindings.has(scenario.tripId))throw new Error('Dwell target omitted from service graph');
  const model = {
    scenario, deviations,
    departures: tripId=>departureComparison(baseline,schedule,compiled.graph,tripId),
    graph: compiled.graph, omissions: compiled.omissions, occupancy: {edges:[],nodes:[]},
    basis: 'schedule-derived', serviceDay: data.service_day, timezone: data.timezone,
    omittedTrips: compiled.omissions.map(t => t.tripId),
    actors: [], serviceSeconds: startSeconds,
    update(elapsed) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid elapsed time');
      const seconds = startSeconds + elapsed;
      model.serviceSeconds = seconds;
      model.actors = schedule.trips.flatMap(t => {
        const p = graphPosition(compiled,t.trip_id,seconds);
        if (!p) return [];
        const occurrence=p.nodeId?compiled.nodeMap.get(p.nodeId).occurrence:compiled.nodeMap.get(compiled.edgeMap.get(p.edgeId).from).occurrence;
        const deviation=scenario?.extraDwellSeconds && t.trip_id===scenario.tripId?deviations[occurrence]:null;
        const [x, z] = frame.project(p.lon,p.lat);
        return [{ id: `${data.service_day}:${t.trip_id}`, tripId: t.trip_id,
          routeId: t.route_id, shapeId: t.shape_id, x, y: 0, z,
          scheduleDeviation: deviation, basis: 'schedule-derived', elevation: 'assumed-flat',
          graph: {patternId:p.patternId,phase:p.phase,nodeId:p.nodeId,edgeId:p.edgeId,progress:p.progress} }];
      });
      const occupied=key=>{const groups=new Map();for(const a of model.actors){const id=a.graph[key];if(id){const ids=groups.get(id)||[];ids.push(a.id);groups.set(id,ids);}}return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,actorIds])=>({id,actorIds:actorIds.sort()}));};
      model.occupancy={edges:occupied('edgeId'),nodes:occupied('nodeId')};
      return model.actors;
    },
  };
  model.update(0);
  return model;
}
