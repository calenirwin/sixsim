// A take's actor tracks from the headless core, the recorder's procedure without a page (tools/ad/record.mjs):
// the camera held on the shot's key 0 while the tiles load, the crowd emptied and the warm-up run (spawning in view
// allowed), then the shot's path installed, the spawn guard on, and one fixed step per frame (frame 0 at dt = 0).
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/take.mjs --shot tuApolloSweep [--seed 1] [--warm N] [--radius 250] [--frames N] [--out dir]
//        [--json] (also a JSON copy of the tracks) [--stats-every 30]
//        [--prefill N] (dt = 0 updates until N cars exist before the warm-up: the page's boot leaves 20-190 there)
//        [--boot-frames K] [--zero-frames N] (experiments: dt = 0 updates before the warm-up / between captured steps)
//        [--flags q] [--extra q] (the page query's base flags, default the film's from shots.json; extra flags appended)
//        [--obstacles dir|none] (the walkers' street-furniture obstacles written by tools/core/obstacles.mjs; default
//        /data0/projectnyc_aux/cache/core/obstacles, the same for every checkout, else shots/core/obstacles)
//
// Writes <out>/tracks.atrk (docs/specs/actor-tracks.md) and <out>/stats.json (per-frame counts and speeds near the lens).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);

const shotName = opt('shot', 'tuApolloSweep');
const seed = parseInt(opt('seed', '1'), 10);
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const spec = SH.shots[shotName] || SH.probes?.[shotName];
if (!spec) { console.error('no shot', shotName); process.exit(2); }
const P = { name: shotName, ...spec };
// a player take (shots.json `take`): its keys, duration and frames from the recorded run (tools/ad/takes.mjs)
if (P.take) { const { expandTake } = await import('../ad/takes.mjs'); expandTake(P, ROOT); }
const FPS = SH._meta?.fps || 30, dt = 1 / FPS;
const total = parseInt(opt('frames', String(Math.round(P.duration * FPS))), 10);
let warm = parseInt(opt('warm', String(P.warm || 300)), 10);
const radius = parseFloat(opt('radius', '250'));
const out = path.resolve(opt('out', path.join(ROOT, 'shots/core', `${shotName}_s${seed}`)));
fs.mkdirSync(out, { recursive: true });
const statsEvery = parseInt(opt('stats-every', '30'), 10);
// the recorder's page query (tools/ad/record.mjs: shot, record, the film's base flags, the shot's own flags), set as
// `location` BEFORE the sim modules load, so every ?flag they read at import is the page's (pedtarget=640, record=1 ...)
const BASE_FLAGS = opt('flags', SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1');
const query = `?shot=1&record=1&${BASE_FLAGS}&time=${P.time || 'day'}${P.flags ? '&' + P.flags : ''}${opt('extra') ? '&' + opt('extra') : ''}`;
globalThis.location = { search: query };
await import('../../core/env/shim.mjs');
const { createWorld, NIGHT_OF } = await import('../../core/sim/world.mjs');
const { holdOf, holdAt, midKey } = await import('../../core/sim/pathcam.mjs');
const { TrackRecorder } = await import('../../core/tracks/recorder.mjs');
const { writeTracks } = await import('../../core/tracks/format.mjs');
const { lensStats } = await import('../../core/tracks/stats.mjs');
const night = NIGHT_OF[P.time] ?? 0;

const t0 = performance.now();
// --obstacles <dir>: the walkers' street-furniture obstacles from tools/core/obstacles.mjs files; by default the shared
// cache outside any checkout (a worktree has no shots/: a take made there without them differs), else
// shots/core/obstacles, `--obstacles none` for none (the header records which)
const OBS_SHARED = '/data0/projectnyc_aux/cache/core/obstacles';
const obsOpt = opt('obstacles', fs.existsSync(OBS_SHARED) ? OBS_SHARED : fs.existsSync(path.join(ROOT, 'shots/core/obstacles')) ? path.join(ROOT, 'shots/core/obstacles') : 'none');
if (obsOpt === 'none' && !opt('obstacles')) console.warn('[core] no walker obstacles found: this take differs from one made with them');
const obstaclesDir = obsOpt && obsOpt !== 'none' ? path.resolve(obsOpt) : null;
const W = await createWorld({ seed, fov: P.fov || 58, obstaclesDir, night });
console.log(`[core] ${shotName} seed ${seed}: boot ${(W.bootMs / 1000).toFixed(2)} s, ${W.fleetKinds.length} vehicle kinds`);
// 1. the camera on key 0, the ring loaded (record.mjs: setPath(holdOf) + settleWorld)
W.setPath(holdOf(P));
await W.step(0);
console.log(`[core] tiles ${W.streamer.stats.near} (${(W.streamer.stats.bytes / 1e6).toFixed(1)} MB) in ${(W.streamer.stats.loadMs / 1000).toFixed(1)} s; traffic edges ${W.traffic.edges.size}, walk edges ${W.peds?.walkEdges.length ?? 0}, signals ${W.traffic.signals.size}${W.streamer.obstaclesDir ? `, walker obstacles ${W.streamer.stats.obstacles}` : ''}`);
// 1b. FP26 (record.mjs, filmlod=1): the whole path pre-streamed before the warm-up, the streamer growing (it loads, never
// unloads), back on key 0; it freezes for the capture (step 3), so no tile arrives or leaves inside a take
const filmlod = /(^|[?&])filmlod=1(&|$)/.test(query);
if (filmlod && !has('noprestream')) {
  W.streamer.hold = 'grow';
  const pts = [];
  for (let k = 1; k < P.keys.length; k++) pts.push(midKey(P.keys[k - 1], P.keys[k]), P.keys[k]);
  for (const q of P.prestream || []) pts.push({ p: q, look: [q[0], q[1] + 0.002, 0] });
  for (const K of pts) { W.setPath(holdAt(P, K)); await W.step(0); }
  W.setPath(holdOf(P));
  await W.step(0);
  console.log(`[core] pre-streamed ${pts.length} path points: tiles ${W.streamer.stats.near}`);
}
// (experiments: --boot-frames K dt = 0 updates before the warm-up, as the page's frame loop runs between the sims' creation
// and the recorder's first step; --zero-frames N dt = 0 updates between the capture's steps, as the page's frame loop
// runs between the recorder's calls)
const bootFrames = parseInt(opt('boot-frames', '0'), 10), zeroFrames = parseInt(opt('zero-frames', '0'), 10);
for (let i = 0; i < bootFrames; i++) await W.step(0);
// --prefill N: dt = 0 updates until N cars exist (the page's warm-up starts with what its boot frames spawned)
const prefill = parseInt(opt('prefill', '0'), 10);
for (let i = 0; i < 4000 && W.traffic.cars.length < prefill; i++) await W.step(0);
if (prefill) console.log(`[core] prefilled: cars ${W.traffic.cars.length}, walkers ${W.peds?.peds.length ?? 0}`);
if (bootFrames) console.log(`[core] ${bootFrames} dt = 0 frames before the warm-up: cars ${W.traffic.cars.length}, walkers ${W.peds?.peds.length ?? 0}`);
// 2. the crowd emptied around the settled lens, spawning in view allowed, the warm-up
const carsAtWarm = W.traffic.cars.length;
W.reseed(1);   // the warm-up and the take draw from a stream that the tile loading above does not shift
W.resetPeds();
W.setSpawnGuard(false);
if (P.phase !== undefined) { const c = (((P.phase - (W.traffic.time + warm / FPS)) % 40) + 40) % 40; warm += Math.round(c * FPS); }
const tw = performance.now();
for (let i = 0; i < warm; i++) {
  await W.step(dt);
  if (statsEvery && (i + 1) % (statsEvery * 5) === 0) console.log(`  warm ${i + 1}/${warm}: cars ${W.traffic.cars.length}, walkers ${W.peds?.peds.length ?? 0}`);
}
const warmMs = performance.now() - tw;
// 3. the real path, the spawn guard on, the capture
const cueT = performance.now();
const cue = W.setPath(P);
if (cue) console.log(`[core] trains cued for the path in ${(performance.now() - cueT).toFixed(0)} ms: ${JSON.stringify(Object.fromEntries(Object.entries(cue.res || {}).filter(([k]) => k !== 'rays').map(([k, v]) => [k, v.d])))}`);
const pathPts = [];
for (let i = 0; i <= 32; i++) { const q = W.cam.curve.getPointAt(i / 32); pathPts.push([q.x, q.z]); }
W.setSpawnGuard(true);
if (filmlod && !has('noprestream')) W.streamer.hold = 'freeze';
const rec = new TrackRecorder(W, { radius, pathPts, night, dt });
const stats = [];
const tc = performance.now();
for (let i = 0; i < total; i++) {
  const step = i > 0 ? dt : 0;
  if (i > 0) for (let z = 0; z < zeroFrames; z++) await W.step(0);
  await W.step(step);
  const c = rec.capture(step);
  const s = lensStats(W, { radii: [50, 100, 250] });
  stats.push({ i, t: +W.traffic.time.toFixed(4), inRegion: c, ...s });
  if (statsEvery && i % statsEvery === 0) console.log(`  frame ${i}: region veh ${c.veh} walk ${c.walk} | within 100 m: cars ${s.cars[100]} (moving ${s.moving[100]}, mean ${s.meanV[100]} m/s) walkers ${s.walkers[100]}`);
}
const capMs = performance.now() - tc;
// every output carries the versions of the code that made it
let git = null;
try { git = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() + (execSync('git status --porcelain client/src/sim core', { cwd: ROOT }).toString().trim() ? '+dirty' : ''); } catch { /* not a repository */ }
const srcHash = crypto.createHash('sha256');
// the code that made the tracks: the page's sim modules the core runs and every core module
const coreFiles = [];
const walkDir = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walkDir(p); else if (/\.mjs$/.test(e.name)) coreFiles.push(p); } };
walkDir('core');
for (const f of ['client/src/sim/traffic.js', 'client/src/sim/peds.js', 'client/src/sim/signals.js', 'client/src/sim/fleet24.js', 'client/src/sim/trains.js', 'client/src/game/control.js', ...coreFiles]) srcHash.update(fs.readFileSync(path.join(ROOT, f)));
const header = rec.header({
  shot: shotName, title: P.title || '', time: P.time || 'day', night, seed, fps: FPS, dt, warm, query,
  region: { radius, path: pathPts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]) },
  obstacles: W.streamer.obstaclesDir ? { dir: path.relative(ROOT, W.streamer.obstaclesDir), instances: W.streamer.stats.obstacles } : null,
  made: { by: 'core', git, code: srcHash.digest('hex').slice(0, 16) },
});
const bytes = writeTracks(path.join(out, 'tracks.atrk'), header, rec.frames);
// the region's graphs for plots (tools/core/plot_take.py): traffic edges and walk edges near the path, x z polylines
{
  const R2 = (radius + 60) ** 2, nearPt = (x, z) => pathPts.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 <= R2);
  const line = (pts) => pts.map((q) => [+q[0].toFixed(1), +q[2].toFixed(1)]);
  const roads = [...W.traffic.edges.values()].filter((e) => e.pts.some((q) => nearPt(q[0], q[2]))).map((e) => ({ id: e.id, lanes: e.lanes, oneway: e.oneway, rclass: e.rclass, pts: line(e.pts) }));
  const walks = (W.peds?.walkEdges || []).filter((e) => e.pts.some((q) => nearPt(q[0], q[2]))).map((e) => ({ kind: e.kind, pts: line(e.pts) }));
  fs.writeFileSync(path.join(out, 'map.json'), JSON.stringify({ shot: shotName, radius, path: pathPts, roads, walks, signals: header.signals.list }));
}
// the per-frame light the core owns: the headlamp beams (tools/core/light_bake.mjs adds the exposure and bloom)
fs.writeFileSync(path.join(out, 'light_frames.json'), JSON.stringify(rec.lightFrames));
if (has('json')) fs.writeFileSync(path.join(out, 'tracks.json'), JSON.stringify({ header, frames: rec.frames.map((F) => ({ veh: F.veh, walk: F.walk, sig: [...F.sig] })) }));
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'tracks.atrk'))).digest('hex');
const summary = {
  shot: shotName, seed, frames: total, warm, radius, query, bootFrames, zeroFrames, prefill, carsAtWarm, obstacles: W.streamer.stats.obstacles ?? null,
  ms: { boot: Math.round(W.bootMs), load: Math.round(W.streamer.stats.loadMs), warm: Math.round(warmMs), capture: Math.round(capMs), total: Math.round(performance.now() - t0) },
  msPerStep: +((warmMs + capMs) / (warm + total)).toFixed(2),
  prof: Object.fromEntries(Object.entries(W.prof).map(([k, v]) => [k, Math.round(v)])),
  tiles: W.streamer.stats.near, edges: W.traffic.edges.size, walkEdges: W.peds?.walkEdges.length ?? 0,
  cars: W.traffic.cars.length, walkers: W.peds?.peds.length ?? 0,
  actors: { vehicles: header.actors.filter((a) => a.type === 'vehicle').length, walkers: header.actors.filter((a) => a.type === 'walker').length, trainCars: header.actors.filter((a) => a.type === 'train').length, parked: header.parked.length, signals: header.signals.list.length },
  tracks: { bytes, sha256: sha },
  perFrame: stats,
};
fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(summary, null, 1));
console.log(`[core] ${total} frames, ${summary.actors.vehicles} vehicles + ${summary.actors.walkers} walkers + ${summary.actors.trainCars} train cars tracked, ${summary.actors.parked} parked, ${summary.actors.signals} signals; ${(bytes / 1e6).toFixed(2)} MB; sha256 ${sha.slice(0, 16)}`);
console.log(`[core] ${summary.msPerStep} ms a step (warm ${(warmMs / 1000).toFixed(1)} s, capture ${(capMs / 1000).toFixed(1)} s); total ${(summary.ms.total / 1000).toFixed(1)} s -> ${out}`);
