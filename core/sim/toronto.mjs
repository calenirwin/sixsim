// Toronto dataset assembly for the inherited headless world and API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createWorld } from './world.mjs';
import { scheduledTransit } from './scheduledTransit.mjs';
import { compileBlock } from '../../client/tools/toronto/compile.mjs';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function torontoWorld({ startSeconds = 28800, seed = 1 } = {}) {
  const tilesDir = path.join(root, 'client/.generated/toronto');
  compileBlock(JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/toronto/block.geojson'))), tilesDir);
  const bytes = fs.readFileSync(path.join(root, 'client/fixtures/transit/510-20261022.json'));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/transit/provenance.json')));
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.subset_sha256) throw new Error('GTFS provenance hash mismatch');
  const transit = scheduledTransit(JSON.parse(bytes), { geoOrigin: PROFILE.geoOrigin, startSeconds });
  transit.provenance = provenance;
  const world = await createWorld({ seed, tilesDir, traffic: false, peds: false, trains: false, cityOverrides: false, transit });
  world.camera.position.set(128, 100, 128);
  await world.step(0);
  return { world, provenance };
}
