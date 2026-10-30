// Toronto dataset assembly for the inherited headless world and API.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { TORONTO_RENDERING } from './renderCapabilities.mjs';
import { createWorld } from './world.mjs';
import { scheduledTransit } from './scheduledTransit.mjs';
import { compileDistrict } from '../../client/tools/toronto/compile.mjs';
import { sourceNetwork } from '../../client/src/toronto/sourceNetwork.js';
import {decodeLandCover} from '../../client/src/toronto/landCover.js';
import { validateGreenSpaces } from '../../client/src/toronto/greenSpaces.js';
import { PROFILE } from '../../client/src/toronto/profile.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function environmentScenario() {
  const file=process.env.TORONTO_TRANSIT_SCENARIO;
  return file?JSON.parse(fs.readFileSync(path.resolve(root,file))):null;
}
export async function torontoWorld({ startSeconds = 28800, seed = 1, scenario = environmentScenario() } = {}) {
  const tilesDir = path.join(root, 'client/.generated/toronto');
  const massing=fs.readFileSync(path.join(root,'client/fixtures/toronto/district.geojson'));
  const massingProvenance=JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/district-provenance.json')));
  if(createHash('sha256').update(massing).digest('hex')!==massingProvenance.subset_sha256)throw new Error('Massing provenance hash mismatch');
  compileDistrict(JSON.parse(massing),tilesDir);
  const networkBytes=fs.readFileSync(path.join(root,'client/fixtures/toronto/district-network.json'));
  const networkProvenance=JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/network-provenance.json')));
  if(createHash('sha256').update(networkBytes).digest('hex')!==networkProvenance.subset_sha256)throw new Error('Network provenance hash mismatch');
  const network={...sourceNetwork(JSON.parse(networkBytes)),provenance:networkProvenance};
  const greenBytes=fs.readFileSync(path.join(root,'client/fixtures/toronto/green-spaces.geojson'));
  const greenProvenance=JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/green-spaces-provenance.json')));
  if(createHash('sha256').update(greenBytes).digest('hex')!==greenProvenance.subset_sha256)throw new Error('Green-space provenance hash mismatch');
  network.greenSpaces={...validateGreenSpaces(JSON.parse(greenBytes)),provenance:greenProvenance};
  const coverBytes=fs.readFileSync(path.join(root,'client/fixtures/toronto/land-cover-2018.json'));
  const coverProvenance=JSON.parse(fs.readFileSync(path.join(root,'client/fixtures/toronto/land-cover-provenance.json')));
  if(createHash('sha256').update(coverBytes).digest('hex')!==coverProvenance.subset_sha256)throw Error('Land-cover provenance hash mismatch');
  const cover=JSON.parse(coverBytes);decodeLandCover(cover);network.landCover={...cover,provenance:coverProvenance};
  fs.writeFileSync(path.join(tilesDir,'network.json'),JSON.stringify(network));
  const bytes = fs.readFileSync(path.join(root, 'client/fixtures/transit/510-20261022.json'));
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'client/fixtures/transit/provenance.json')));
  if (createHash('sha256').update(bytes).digest('hex') !== provenance.subset_sha256) throw new Error('GTFS provenance hash mismatch');
  const transit = scheduledTransit(JSON.parse(bytes), { geoOrigin: PROFILE.geoOrigin, startSeconds, scenario });
  transit.provenance = provenance;
  const world = await createWorld({ seed, tilesDir, renderCapabilities: TORONTO_RENDERING, traffic: false, peds: false, trains: false, cityOverrides: false, transit });
  world.sourceNetwork=network;
  world.camera.position.set(128, 100, 128);
  await world.step(0);
  return { world, provenance };
}
