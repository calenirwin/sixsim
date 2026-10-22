// No server, browser, downloaded city archive or fleet models required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createWorld } from '../../core/sim/world.mjs';
import { scheduledTransit } from '../../core/sim/scheduledTransit.mjs';
import { compileBlock } from '../../client/tools/toronto/compile.mjs';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function torontoWorld({ startSeconds = 28800 } = {}) {
  const tilesDir = path.join(root, 'client/.generated/toronto');
  compileBlock(JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/toronto/block.geojson'))), tilesDir);
  const bytes = fs.readFileSync(path.join(root, 'client/fixtures/transit/510-20261022.json'));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/transit/provenance.json')));
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.subset_sha256) throw new Error('GTFS provenance hash mismatch');
  const transit = scheduledTransit(JSON.parse(bytes), { geoOrigin: PROFILE.geoOrigin, startSeconds });
  const world = await createWorld({ tilesDir, traffic: false, peds: false, trains: false, cityOverrides: false, transit });
  world.camera.position.set(128, 100, 128);
  await world.step(0);
  return { world, provenance };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { world: W, provenance } = await torontoWorld();
  const frames = [];
  for (let i = 0; i <= 60; i++) {
    if (i) await W.step(1);
    frames.push({ frame: W.frame, elapsed: W.simTime, serviceSeconds: W.transit.serviceSeconds, actors: W.transit.actors });
  }
  console.log(JSON.stringify({ version: 1, basis: 'schedule-derived', profile: PROFILE,
    serviceDay: W.transit.serviceDay, timezone: W.transit.timezone, provenance,
    massingProvenance: JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/toronto/provenance.json'))),
    omittedTrips: W.transit.omittedTrips, loadedTiles: [...W.streamer.tiles.keys()], frames }, null, 2));
}
