#!/usr/bin/env node
// The load set per frame of a shot (docs/specs/load-set.md): what a renderer must hold and draw at each frame of a take,
// from the single streaming manager (core/streaming/stream.mjs) the three.js client runs, at a tier (cinematic by
// default), so Unreal, Blender and three.js load the identical city by construction; plus the union to preload before
// frame 0 (nothing streams during a take).
//
//   node tools/core/loadsets.mjs <shot> [--tier cinematic] [--warm 60] [--take <dir>] [--out <file>] [--size 2560x1440]
//
// The camera per frame is the take's own (lane D's tracks.atrk in /data0/projectnyc_aux/cellcache/takes/<shot>/, the
// header's camera rows) when the take exists; else the shot's path (tools/ad/shots.json) through the headless PathCam
// (core/sim/pathcam.mjs) over the compiled tiles' terrain, frame 0 at dt = 0, one 1/fps step a frame, as the recorder.
// Indexes: the LOD packages (/data0/projectnyc_aux/cellcache/lod16/index.json), lane A's cells
// (/data0/projectnyc_aux/cellcache/index.json), the landmarks (the packages index). Residency is immediate (the union is
// preloaded), so the set depends only on the cameras and the tier. Before frame 0 the manager runs `--warm` steps on
// frame 0's camera, so frame 0 starts settled (no fade in flight).
// Writes <take dir>/loadset.json (beside the take; lane D's files are not touched).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamManager, normalizeLod, normalizeCells, normalizeLandmarks, tierParams, FADE_S, HYSTERESIS } from '../../core/streaming/stream.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const shot = argv[0] && !argv[0].startsWith('--') ? argv[0] : opt('shot');
if (!shot || shot.startsWith('--')) { console.error('usage: node tools/core/loadsets.mjs <shot> [--tier cinematic]'); process.exit(2); }
const CACHE = process.env.CELLCACHE || '/data0/projectnyc_aux/cellcache';   // (BD40: CELLCACHE as tools/ue/render_take.py reads it, for a staged set)
const takeDir = path.resolve(opt('take', path.join(CACHE, 'takes', shot)));
const outFile = path.resolve(opt('out', path.join(takeDir, 'loadset.json')));
const tierName = opt('tier', 'cinematic');
const warm = parseInt(opt('warm', '60'), 10);
const t0 = Date.now();
const log = (...a) => console.log(`[loadsets ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- the shot, its frame rate and viewport
const SH = readJSON(path.join(ROOT, 'tools/ad/shots.json'));
// (BD40: a take another branch made, whose shot this checkout does not list, runs on its own camera rows)
const spec = SH.shots[shot] || SH.probes?.[shot] || (fs.existsSync(path.join(takeDir, 'tracks.atrk')) ? {} : null);
if (!spec) { console.error('no shot', shot); process.exit(2); }
const fps = SH._meta?.fps || 30, dt = 1 / fps;
const [W, H] = String(opt('size', SH._meta?.size || '2560x1440')).split('x').map(Number);

// ---- the cameras: the take's own rows, or the path
let cams, camSource;
const atrk = path.join(takeDir, 'tracks.atrk');
if (fs.existsSync(atrk)) {
  const { readTracks } = await import('../../core/tracks/format.mjs');
  const T = readTracks(atrk);
  const F = T.header.camera.fields, ix = (n) => F.indexOf(n);
  cams = T.header.camera.rows.map((r) => ({ x: r[ix('x')], y: r[ix('y')], z: r[ix('z')], fovV: r[ix('fovV')] ?? spec.fov ?? 58, q: [r[ix('qx')], r[ix('qy')], r[ix('qz')], r[ix('qw')]] }));
  // the camera rows' own hash (not the file's: the actors may change while the camera does not), so the file is identical
  // whenever the camera and the city are
  camSource = { kind: 'take', file: path.relative(CACHE, atrk), cameraSha256: sha(JSON.stringify(T.header.camera)).slice(0, 24), frames: cams.length };
} else {
  // the path through the headless PathCam over the tiles' terrain (the recorder's procedure: frame 0 at dt 0)
  globalThis.location = { search: '' };
  const THREE = await import('three');
  const { PathCam } = await import('../../core/sim/pathcam.mjs');
  const { parseTile } = await import('../../client/src/world/tiledata.js');
  const tilesDir = path.join(ROOT, 'client/public/tiles'), man = readJSON(path.join(tilesDir, 'manifest.json'));
  const grids = new Map();
  const terrainAt = (x, z) => {
    const key = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`;
    if (!grids.has(key)) {
      let g = null;
      if (man.tiles[key]) { const b = fs.readFileSync(path.join(tilesDir, man.tiles[key].f)); const t = parseTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); g = { grid: Float32Array.from(t.S.terrain), res: t.header.res, ox: t.header.origin[0], oz: t.header.origin[1] }; }
      grids.set(key, g);
    }
    const t = grids.get(key);
    if (!t) return null;
    const n = t.res + 1, fx = Math.min(t.res - 0.001, Math.max(0, ((x - t.ox) / 512) * t.res)), fz = Math.min(t.res - 0.001, Math.max(0, ((z - t.oz) / 512) * t.res));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const y00 = t.grid[j * n + i], y10 = t.grid[j * n + i + 1], y01 = t.grid[(j + 1) * n + i], y11 = t.grid[(j + 1) * n + i + 1];
    return u >= v ? y00 + u * (y10 - y00) + v * (y11 - y10) : y00 + v * (y01 - y00) + u * (y11 - y01);
  };
  const cam = new THREE.PerspectiveCamera(spec.fov || 58, W / H, 0.4, 60000);
  const pc = new PathCam(cam, { terrainAt });
  pc.setPath({ name: shot, ...spec });
  const total = Math.round(spec.duration * fps);
  cams = [];
  for (let i = 0; i < total; i++) { const p = pc.update(i ? dt : 0); const q = cam.quaternion; cams.push({ x: p.x, y: p.y, z: p.z, fovV: cam.fov, q: [q.x, q.y, q.z, q.w] }); }   // (GB43: the view, for viewFar)
  camSource = { kind: 'path', file: 'tools/ad/shots.json', frames: cams.length, note: 'no take: the path over the compiled terrain (core/sim/pathcam.mjs)' };
}

// ---- indexes and the tier
const lodIdxFile = path.join(CACHE, 'lod16/index.json'), cellIdxFile = path.join(CACHE, 'index.json');
const lodIdx = readJSON(lodIdxFile), cellIdx = fs.existsSync(cellIdxFile) ? readJSON(cellIdxFile) : null;
const tiersDoc = readJSON(path.join(ROOT, 'client/public/data/tiers.json'));
const tier = tierParams(tiersDoc.tiers[tierName] ? { name: tierName, ...tiersDoc.tiers[tierName] } : null, tierName);
const lod = normalizeLod(lodIdx);
const cells = normalizeCells(cellIdx);
const landmarks = normalizeLandmarks(lodIdx);
// (BD40: the finest level the index holds, as the three.js manager takes it: L3 with the backdrop, L4 without)
const finestLv = lod.chunks.length ? Math.max(3, Math.min(...lod.chunks.map((c) => c.level))) : 4;
const sm = new StreamManager({ lod, cells, landmarks, tier, finest: finestLv });
const camOf = (c) => ({ x: c.x, y: c.y, z: c.z, fovV: c.fovV, heightPx: H, q: c.q });

// ---- warm on frame 0's camera, then one step a frame
for (let i = 0; i < warm; i++) sm.update({ cameras: [camOf(cams[0])], dt });
const frames = [];
const uChunks = new Set(), uCells = new Set(), uMissing = new Set();
let maxFading = 0;
for (let f = 0; f < cams.length; f++) {
  const out = sm.update({ cameras: [camOf(cams[f])], dt: f ? dt : 0 });
  const steady = [], fading = [];
  for (const [k, a, m] of out.chunks) { uChunks.add(k); if (a >= 1 && m === 0) steady.push(k); else fading.push([k, +a.toFixed(4), m]); }
  for (const k of out.cells.baked) uCells.add(k);
  for (const k of out.cells.missing) uMissing.add(k);
  maxFading = Math.max(maxFading, fading.length);
  frames.push({ f, cam: [+cams[f].x.toFixed(2), +cams[f].y.toFixed(2), +cams[f].z.toFixed(2)], chunks: steady, fading, cells: out.cells.baked });
}
const persistent = sm.persistentKeys();
for (const k of persistent) uChunks.add(k);
const chunkBytes = [...uChunks].reduce((s, k) => s + (lodIdx.chunks[k]?.bytes?.glb || 0), 0);
const cellBytes = [...uCells].reduce((s, k) => s + (cells.cells.get(k)?.bytes || 0), 0);
const lmBytes = landmarks.reduce((s, l) => s + (lodIdx.landmarks[l.key]?.bytes?.glb || 0), 0);

// every output carries the version of the code that made it (a content hash of the manager and this tool)
const code = sha(Buffer.concat([fs.readFileSync(path.join(ROOT, 'core/streaming/stream.mjs')), fs.readFileSync(fileURLToPath(import.meta.url))])).slice(0, 24);
const doc = {
  schema: 'valdrada.loadset/0',
  shot, title: spec.title || '', time: spec.time || 'day', tier: tier.name, fps, frames: frames.length, viewport: [W, H],
  rules: { sse: tier.sse, hysteresis: HYSTERESIS, fadeS: FADE_S, grid: tier.grid, cellSize: cells.size, finest: sm.finest, persistentLevel: 6, warmFrames: warm, residency: 'immediate (the union is preloaded before frame 0)' },
  sources: {
    camera: camSource,
    lod: { index: path.relative(CACHE, lodIdxFile), generator: lodIdx.generator, sha256: sha(fs.readFileSync(lodIdxFile)).slice(0, 24) },
    cells: cellIdx ? { index: path.relative(CACHE, cellIdxFile), regions: Object.keys(cellIdx.regions || {}).sort() } : null,
    landmarks: { index: path.relative(CACHE, lodIdxFile), count: landmarks.length },
    tiers: 'client/public/data/tiers.json',
  },
  made: { by: 'tools/core/loadsets.mjs', code },   // no time or commit stamp: the same inputs give the same bytes (the build graph's cutoff)
  persistent: { chunks: persistent, landmarks: landmarks.map((l) => l.key) },
  union: {
    chunks: [...uChunks].sort(), cells: [...uCells].sort(), cellsMissing: [...uMissing].sort(), landmarks: landmarks.map((l) => l.key),
    drawnBy: Object.fromEntries(landmarks.filter((l) => l.drawnBy).map((l) => [l.key, l.drawnBy])),
    bytes: { chunks: chunkBytes, cells: cellBytes, landmarks: lmBytes },
    files: {
      chunks: Object.fromEntries([...uChunks].sort().map((k) => [k, `lod16/${lodIdx.chunks[k]?.file}`])),
      cells: Object.fromEntries([...uCells].sort().map((k) => [k, `${cells.cells.get(k).hash}/cell.glb`])),
      landmarks: Object.fromEntries(landmarks.map((l) => [l.key, `lod16/${lodIdx.landmarks[l.key]?.file}`])),
    },
  },
  stats: { maxFading, levelsInUnion: [...uChunks].reduce((m, k) => { const lv = k.split('_')[0]; m[lv] = (m[lv] || 0) + 1; return m; }, {}) },
  frames,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const tmp = `${outFile}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(doc));
fs.renameSync(tmp, outFile);
log(`${shot}: ${frames.length} frames at ${tier.name} (${tier.sse} px at ${W}x${H}); union ${uChunks.size} chunks (${JSON.stringify(doc.stats.levelsInUnion)}), ${uCells.size} baked cells + ${uMissing.size} missing, ${landmarks.length} landmarks; ${((chunkBytes + cellBytes + lmBytes) / 1048576).toFixed(1)} MB to preload; at most ${maxFading} chunks fading in a frame -> ${outFile}`);
