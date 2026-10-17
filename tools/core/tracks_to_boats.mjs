// A core take's boats on the Lake as part tracks for the export's moving-set file: the rowing fleet with its rowers,
// passengers and oars (city/cpLakeside.js lsBuildFleet over cpLandmarks.js's courses and water level) and the boats tied
// up at the Loeb Boathouse's landing (city/cpLandmarksKit.js buildBoathouse, which places them with buildMooredBoats).
// The page's own builders run as they are on a bare group, stepped on the take's sim clock (ENV.time = the header's
// simTime per frame, the clock their closed-form motion reads) with the lens of each frame; every instance matrix is
// read back per frame, one track per instance, as harvest.mjs records the page's instanced movers. The rowers hold the
// level of detail of the take's nearest approach as the page does while recording (FP37: window.__FP37 from the take's
// path, 65 points of its curve as main.js publishes them). tools/core/tracks_to_mov.py --boats matches each part set to
// an earlier harvest's mover of the same name and vertex count, which carries the geometry.
//
// The page builds the boats with the tile that holds Bow Bridge (the fleet) and the Loeb Boathouse (the moored boats);
// here a set is written when the take's lens comes within the near ring (1000 m) of that point.
//
//   node tools/core/tracks_to_boats.mjs --tracks <take>/tracks.atrk --out <file.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const { readTracks } = await import('../../core/tracks/format.mjs');
const T = readTracks(path.resolve(opt('tracks')));
const H = T.header;
globalThis.location = { search: H.query || '?record=1' };
globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
await import('../../core/env/shim.mjs');
const THREE = await import('three');
const { ENV } = await import('../../client/src/world/materials.js');
const { project } = await import('../../client/src/shared/geo.js');
const { R1D_LAKE } = await import('../../client/src/city/cpLandmarks.js');
const { BOW, BOATHOUSE, buildBoathouse, buildRowboats } = await import('../../client/src/city/cpLandmarksKit.js');
const { CP33L, lsBuildFleet } = await import('../../client/src/city/cpLakeside.js');
const RING = 1000;
const rows = H.camera.rows;
const near = (x, z) => rows.some((r) => Math.hypot(r[0] - x, r[2] - z) < RING);

// the take's path as main.js publishes it while recording (FP37): 65 points of the camera curve, over the terrain unless
// `abs`; a shot over the terrain takes the lens positions of the take instead (the terrain is not loaded here)
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const P = { name: H.shot, ...(SH.shots[H.shot] || SH.probes?.[H.shot] || {}) };
if (P.take) { const { expandTake } = await import('../ad/takes.mjs'); expandTake(P, ROOT); }
let fpPts;
if (P.keys && P.abs) {
  const pts = P.keys.map((k) => { const [x, z] = project(k.p[0], k.p[1]); return new THREE.Vector3(x, k.p[2], z); });
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', P.tension ?? 0.5), N = 64;
  fpPts = new Float64Array((N + 1) * 3);
  for (let i = 0; i <= N; i++) { const q = curve.getPointAt(i / N); fpPts[i * 3] = q.x; fpPts[i * 3 + 1] = q.y; fpPts[i * 3 + 2] = q.z; }
} else fpPts = Float64Array.from(rows.flatMap((r) => [r[0], r[1], r[2]]));
let y0 = Infinity, y1 = -Infinity;
for (let i = 1; i < fpPts.length; i += 3) { y0 = Math.min(y0, fpPts[i]); y1 = Math.max(y1, fpPts[i]); }

const group = new THREE.Group();
group.name = 'core:lake';
const built = [];
ENV.time.value = H.simTime[0];
const waterAt = (x, z) => R1D_LAKE.waterY('lake', 17.0, x, z);
let fleet = null;
if (near(BOW.C[0], BOW.C[1])) {
  fleet = (CP33L ? lsBuildFleet : buildRowboats)(group, R1D_LAKE.COURSES, waterAt);
  built.push(`fleet ${fleet.boats} boats, ${fleet.people} people`);
}
if (near(BOATHOUSE.C[0], BOATHOUSE.C[1])) {
  const W = R1D_LAKE.waterY('lake', 17.0, 178, 880);
  const parts = buildBoathouse(group, W, W);   // (the ground east only seats the building; the moored boats stand on W)
  built.push(`moored ${(parts.find(([n]) => n === 'moored') || [0, 0])[1]} boats on the Lake at ${W.toFixed(2)}`);
}
// the people layer waits for the crowd's texture arrays and the baked people (fetched): the arrays only reach the
// people's shader, so stand-ins serve; the take's path for the rowers' level of detail
globalThis.window = globalThis.window || globalThis;
window.__CROWD = window.__CROWD || { A: { arrays: { albedo: {}, normal: {}, orm: {}, hair: {} } } };
window.__FP37 = { v: 1, pts: fpPts, y0, y1 };
const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 20000);
if (fleet && CP33L) {
  for (let k = 0; k < 400 && !group.children.some((o) => /^cp33l:person:/.test(o.name)); k++) { await new Promise((r) => setTimeout(r, 25)); fleet.update(null); }
  if (!group.children.some((o) => /^cp33l:person:/.test(o.name))) console.warn('[boats] the rowers did not load: boats and oars only');
}
const sets = new Map();   // mesh name -> { name, vtx, castShadow, tracks: Map(index -> {id, f0, m}) }
const movers = [];
group.traverse((o) => { if (o.isInstancedMesh && /^cp33l:|^cp32m:moored:/.test(o.name)) movers.push(o); });
const moored = movers.find((o) => o.name === 'cp32m:moored:hull');
for (let f = 0; f < rows.length; f++) {
  const r = rows[f];
  ENV.time.value = H.simTime[f];
  cam.position.set(r[0], r[1], r[2]); cam.quaternion.set(r[3], r[4], r[5], r[6]); cam.fov = r[7]; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  if (fleet) fleet.update(cam);
  if (moored && moored.onBeforeRender) moored.onBeforeRender(null, null, cam);
  group.updateMatrixWorld(true);
  for (const o of movers) {
    let S = sets.get(o.name);
    if (!S) sets.set(o.name, (S = { name: o.name, vtx: o.geometry.getAttribute('position').count, castShadow: o.castShadow, tracks: new Map() }));
    const a = o.instanceMatrix.array, n = o.count;
    for (let i = 0; i < n; i++) {
      const e = a.subarray(i * 16, i * 16 + 16);
      const m12 = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]].map((v) => Math.round(v * 1e5) / 1e5);
      let tr = S.tracks.get(i);
      if (!tr) S.tracks.set(i, (tr = { id: String(i), f0: f, m: [] }));
      while (tr.f0 + tr.m.length < f) tr.m.push(tr.m[tr.m.length - 1]);   // a frame it was not drawn in holds its pose
      tr.m.push(m12);
    }
  }
}
const outSets = [...sets.values()].filter((S) => S.tracks.size).map((S) => ({ name: `${S.name} < ${group.name}`, vtx: S.vtx, castShadow: S.castShadow, tracks: [...S.tracks.values()] }));
fs.writeFileSync(path.resolve(opt('out')), JSON.stringify({ shot: H.shot, built, sets: outSets }));
console.log(`[boats] ${H.shot}: ${built.join('; ') || 'no boats in range'}; ${outSets.length} part sets, ${outSets.reduce((s, x) => s + x.tracks.length, 0)} part tracks -> ${opt('out')}`);
