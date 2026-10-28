import { externalAttempts } from './helpers/offline-fetch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { torontoWorld } from '../toronto/simulate.mjs';
import { scheduledTransit } from '../../core/sim/scheduledTransit.mjs';
import { position, prepare } from '../../client/src/toronto/transit.js';
import { localFrame } from '../../client/src/shared/localFrame.js';
import { PROFILE } from '../../client/src/toronto/profile.js';
const data = JSON.parse(fs.readFileSync(new URL('../../client/fixtures/transit/510-20261022.json', import.meta.url)));
test('offline guard catches absolute fetch through the shim', async () => {
  for (const input of ['https://example.invalid/test', new URL('https://example.invalid/url'), new Request('https://example.invalid/request')]) {
    await assert.rejects(fetch(input), /Offline test blocked fetch/);
  }
  assert.equal(externalAttempts.length, 3);
  externalAttempts.length = 0;
});
test('real CTL1 tile and GTFS actors advance in inherited world before post-step hooks', async () => {
  const { world: W } = await torontoWorld();
  assert.ok(W.streamer.tiles.size>10);
  assert.ok(W.streamer.stats.bytes<2_000_000);
  assert.equal(W.sourceNetwork.roads.length,841);
  assert.equal(W.sourceNetwork.routing,false);
  assert.equal(Object.keys(W.streamer.manifest.tiles).length,19);
  assert.equal(W.traffic, null); assert.equal(W.peds, null); assert.equal(W.trains, null);
  assert.equal(W.streamer.cityOverrides, false);
  assert.deepEqual(W.fetches, []); // only local shim requests; external guard is asserted separately
  assert.equal(W.transit.actors.length, 10);
  const before = structuredClone(W.transit.actors);
  let post;
  W.hooks = { post: () => { post = W.transit.serviceSeconds; } };
  await W.step(60);
  assert.equal(post, 28860); assert.equal(W.simTime, 60); assert.equal(W.ENV.time.value, 60);
  assert.notDeepEqual(W.transit.actors, before);
  const actor = W.transit.actors[0], trip = prepare(data).trips.find(t => t.trip_id === actor.tripId);
  const expected = localFrame(PROFILE.geoOrigin).project(...position(trip, 28860));
  assert.ok(Math.hypot(actor.x-expected[0],actor.z-expected[1])<.001);
  assert.ok(actor.graph.edgeId || actor.graph.nodeId);
  assert.equal(actor.y, 0); assert.equal(actor.basis, 'schedule-derived');
  for (const dt of [-1, NaN, Infinity]) await assert.rejects(W.step(dt), /Invalid simulation step/);
  assert.equal(W.simTime, 60);
  assert.deepEqual(externalAttempts, []);
  const { world: other } = await torontoWorld();
  for (let i=0;i<60;i++) await other.step(1);
  assert.deepEqual(other.transit.actors, W.transit.actors);
  assert.deepEqual(externalAttempts, []);
});
test('service-day midnight, lifecycle, missing shapes and stable trip identities', () => {
  const model = scheduledTransit(data, { geoOrigin: PROFILE.geoOrigin, startSeconds: 90000 });
  assert.ok(model.actors.length > 0); assert.equal(model.serviceSeconds, 90000);
  assert.ok(model.actors.every(a => a.id.startsWith('20261022:')));
  model.update(10000); assert.deepEqual(model.actors, []);
  model.update(0); assert.ok(model.actors.length > 0);
  const missing = structuredClone(data); missing.shapes = [];
  const omitted = scheduledTransit(missing, { geoOrigin: PROFILE.geoOrigin });
  assert.equal(omitted.omittedTrips.length, 378); assert.deepEqual(omitted.actors, []);
  const duplicate = structuredClone(data); duplicate.trips.push(duplicate.trips[0]);
  assert.throws(() => scheduledTransit(duplicate, { geoOrigin: PROFILE.geoOrigin }), /duplicate trip ID/);
});

test('geographic camera paths use Toronto manifest origin', async () => {
  const { world: W } = await torontoWorld();
  W.setPath({duration: 10, abs: true, keys: [
    {p: [-79.397,43.65,20],look: [-79.396,43.65,0]},
    {p: [-79.396,43.65,20],look: [-79.395,43.65,0]},
  ]});
  assert.deepEqual(W.cam.startXZ(), [0,0]);
  await W.step(1);
  assert.ok(W.camera.position.x > 0 && W.camera.position.x < 100);
  assert.ok(Math.abs(W.camera.position.z) < 1e-8);
});
