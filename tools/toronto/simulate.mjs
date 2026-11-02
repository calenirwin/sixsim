// No server, browser, downloaded city archive or fleet models required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { torontoWorld } from '../../core/sim/toronto.mjs';
export { torontoWorld } from '../../core/sim/toronto.mjs';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { world: W, provenance } = await torontoWorld();
  const frames = [];
  for (let i = 0; i <= 60; i++) {
    if (i) await W.step(1);
    frames.push({ frame: W.frame, elapsed: W.simTime, serviceSeconds: W.transit.serviceSeconds, actors: W.transit.actors });
  }
  console.log(JSON.stringify({ version: 1, basis: 'schedule-derived', profile: PROFILE,
    scenario: W.transit.scenario, deviations: W.transit.deviations, serviceDay: W.transit.serviceDay, timezone: W.transit.timezone, provenance,
    massingProvenance: JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/toronto/provenance.json'))),
    omittedTrips: W.transit.omittedTrips, loadedTiles: [...W.streamer.tiles.keys()], frames }, null, 2));
}
