// Boot the headless core on a compiled tile set and run it at a few places: the near ring's tiles, the traffic and walk
// graphs built from them, the cars and walkers alive after N fixed steps, and the step cost. A check that a set (a
// staging compile before its swap) loads and simulates everywhere, without a page.
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/boot_check.mjs [--tiles <dir>] [--at "name:x,z;name:x,z"] [--frames 300] [--seed 1] [--json out.json]
//
// --tiles defaults to the core's own set (VALDRADA_TILES, else client/public/tiles); --at takes world metres (x east,
// z south), each place held with the camera 30 m up looking 200 m north. One world boots once and is moved from place
// to place (the streamer loads the new ring and unloads the old one, as the page does on a teleport).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const frames = parseInt(opt('frames', '300'), 10), seed = parseInt(opt('seed', '1'), 10);
const at = (opt('at', 'columbia:744,-2733')).split(';').filter(Boolean).map((s) => {
  const [name, xz] = s.includes(':') ? s.split(':') : [s, s];
  const [x, z] = xz.split(',').map(Number);
  return { name, x, z };
});
globalThis.location = { search: '?shot=1&hud=0&life=0&clean=1' };
await import('../../core/env/shim.mjs');
const { createWorld } = await import('../../core/sim/world.mjs');
const { TILES_DIR } = await import('../../core/world/streamer.mjs');
const { unproject } = await import('../../client/src/shared/geo.js');
const tilesDir = opt('tiles') ? path.resolve(opt('tiles')) : TILES_DIR;

const t0 = performance.now();
const W = await createWorld({ seed, tilesDir });
console.log(`[boot] ${tilesDir}: world in ${(W.bootMs / 1000).toFixed(1)} s, ${Object.keys(W.streamer.manifest.tiles).length} tiles in the manifest, ${W.streamer.bridges.length} bridges (${W.streamer.bridgeRoads.length} carry traffic)`);
const rows = [];
for (const P of at) {
  const [lon, lat] = unproject(P.x, P.z), [lon2, lat2] = unproject(P.x, P.z - 200);
  W.setPath({ duration: 1e6, ease: 0, keys: [{ p: [lon, lat, 30], look: [lon2, lat2, 0] }, { p: [lon + 1e-6, lat + 1e-6, 30], look: [lon2, lat2, 0] }] });
  const s0 = { ...W.streamer.stats }, f0 = W.frame;
  const tl = performance.now();
  await W.step(0);
  const loadS = (performance.now() - tl) / 1000;
  const ring = W.streamer.stats.near;
  const ts = performance.now();
  for (let i = 0; i < frames; i++) await W.step(1 / 30);
  const stepMs = (performance.now() - ts) / frames;
  const row = {
    name: P.name, x: P.x, z: P.z, ring, loaded: W.streamer.stats.loaded - s0.loaded, unloaded: W.streamer.stats.unloaded - s0.unloaded,
    loadS: +loadS.toFixed(2), terrain: W.streamer.terrainAt(P.x, P.z), road: !!W.streamer.roadAt(P.x, P.z, 40),
    edges: W.traffic.edges.size, walkEdges: W.peds ? W.peds.walkEdges.length : 0, signals: W.traffic.signals.size,
    cars: W.traffic.cars.length, walkers: W.peds ? W.peds.peds.length : 0, stepMs: +stepMs.toFixed(2), frames: W.frame - f0,
  };
  rows.push(row);
  console.log(`[boot] ${P.name} (${P.x}, ${P.z}): ring ${row.ring} tiles (${row.loaded} loaded, ${row.unloaded} unloaded) in ${row.loadS} s; terrain ${row.terrain === null ? 'none' : row.terrain.toFixed(2)}, a road within 40 m: ${row.road}; traffic edges ${row.edges}, signals ${row.signals}, walk edges ${row.walkEdges}; after ${frames} steps ${row.cars} cars, ${row.walkers} walkers, ${row.stepMs} ms a step`);
}
console.log(`[boot] done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify({ tilesDir, seed, frames, rows }, null, 1));
process.exit(0);
