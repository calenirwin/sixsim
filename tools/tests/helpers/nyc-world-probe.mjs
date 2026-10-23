import { externalAttempts } from './offline-fetch.mjs';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { createWorld } = await import(pathToFileURL(process.argv[2]));
const W = await createWorld({ tilesDir: process.argv[3], seed: 41 }); // all NYC model defaults enabled
const snapshots = [], hooks = [];
W.hooks = { pre: dt => hooks.push(['pre', dt, W.ENV.time.value]), post: dt => hooks.push(['post', dt, W.traffic.time]) };
W.camera.position.set(256, 20, 256);
await W.step(0);
for (const dt of [1/30, 1/30, 0, 0.1, 1]) {
  await W.step(dt);
  snapshots.push({ frame: W.frame, time: W.simTime, env: W.ENV.time.value, trafficTime: W.traffic.time,
    models: [!!W.traffic, !!W.peds, !!W.trains], loaded: [...W.streamer.tiles.keys()],
    camera: W.camera.position.toArray(), signals: W.signals(),
    roads: [...W.streamer.tiles.values()].map(t => t.data.roads),
    terrain: W.streamer.terrainAt(128,128),
    cars: W.traffic.cars.length, pedestrians: W.peds.peds.length,
    trains: W.trains.carsAt(W.ENV.time.value), fleetKinds: W.fleetKinds });
}
fs.writeFileSync(process.argv[4], JSON.stringify({ snapshots, hooks, externalAttempts, random: Array.from({ length: 8 }, () => Math.random()) }));
// Inherited renderer-related polling timers outlive the completed headless probe.
process.exit(0);
