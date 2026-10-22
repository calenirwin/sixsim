// Kinematic actors driven by a pinned service day, stepped by the inherited world clock.
// No observed vehicles, collision response, speed calibration or inferred track elevation.
import { prepare, position } from '../../client/src/toronto/transit.js';
import { localFrame } from '../../client/src/shared/localFrame.js';
export function scheduledTransit(data, { geoOrigin, startSeconds = 28800 } = {}) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('Invalid service start');
  const schedule = prepare(data), frame = localFrame(geoOrigin);
  const ids = new Set();
  for (const t of schedule.trips) {
    if (!t.trip_id || ids.has(t.trip_id)) throw new Error('Missing or duplicate trip ID');
    ids.add(t.trip_id);
  }
  const model = {
    basis: 'schedule-derived', serviceDay: data.service_day, timezone: data.timezone,
    omittedTrips: schedule.trips.filter(t => !t.shape).map(t => t.trip_id),
    actors: [], serviceSeconds: startSeconds,
    update(elapsed) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid elapsed time');
      const seconds = startSeconds + elapsed;
      model.serviceSeconds = seconds;
      model.actors = schedule.trips.flatMap(t => {
        const p = position(t, seconds);
        if (!p) return [];
        const [x, z] = frame.project(...p);
        return [{ id: `${data.service_day}:${t.trip_id}`, tripId: t.trip_id,
          routeId: t.route_id, shapeId: t.shape_id, x, y: 0, z,
          basis: 'schedule-derived', elevation: 'assumed-flat' }];
      });
      return model.actors;
    },
  };
  model.update(0);
  return model;
}
