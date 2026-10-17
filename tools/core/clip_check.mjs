// Walkers standing inside street furniture: every walker position of a take (tracks.atrk, or the page's actors_f<i>.json
// dumps) tested against the obstacle boxes of tools/core/obstacles.mjs (each pool's footprint below head height, at
// every live instance), with the walker's body as a 0.2 m disc. The rate a renderer would show as a person through a
// hydrant, a pole, a tree guard or a bench.
//
//   node tools/core/clip_check.mjs --obstacles shots/core/obstacles --take shots/core/<take>[,<take>...] [--page shots/core/<page run>]
//        [--summary] (one line over every take given)
import fs from 'node:fs';
import path from 'node:path';
import { readTracks } from '../../core/tracks/format.mjs';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const dir = opt('obstacles', 'shots/core/obstacles');
const foot = {};
for (const f of fs.readdirSync(dir).filter((f) => /^foot.*\.json$/.test(f))) Object.assign(foot, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const C = 4, G = new Map(), boxes = [];
for (const f of fs.readdirSync(dir)) {
  if (!/^t_.*\.json$/.test(f)) continue;
  const D = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [name, list] of Object.entries(D.pools)) {
    const F = foot[name];
    if (!F) continue;
    for (const m of list) {
      const sx = Math.hypot(m[0], m[1], m[2]), sz = Math.hypot(m[8], m[9], m[10]);
      if (sx < 0.02 || sz < 0.02) continue;
      for (const [x0, x1, z0, z1, y0, y1] of F) {
        const lcx = (x0 + x1) / 2, lcz = (z0 + z1) / 2;
        const b = { x: m[0] * lcx + m[8] * lcz + m[12], z: m[2] * lcx + m[10] * lcz + m[14], ux: m[0] / sx, uz: m[2] / sx, vx: m[8] / sz, vz: m[10] / sz,
          hx: ((x1 - x0) / 2) * sx, hz: ((z1 - z0) / 2) * sz, y0: m[13] + y0, y1: m[13] + y1, n: name };
        const r = Math.hypot(b.hx, b.hz), i = boxes.length;
        boxes.push(b);
        for (let gx = Math.floor((b.x - r) / C); gx <= Math.floor((b.x + r) / C); gx++) for (let gz = Math.floor((b.z - r) / C); gz <= Math.floor((b.z + r) / C); gz++) {
          const k = gx * 100003 + gz; let a = G.get(k); if (!a) G.set(k, (a = [])); a.push(i);
        }
      }
    }
  }
}
const R = 0.2;
const inside = (x, y, z) => {
  for (const i of G.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) || []) {
    const b = boxes[i];
    if (y !== null && (y + 1.6 < b.y0 || y > b.y1)) continue;
    const dx = x - b.x, dz = z - b.z, u = dx * b.ux + dz * b.uz, v = dx * b.vx + dz * b.vz;
    if (Math.abs(u) < b.hx + R && Math.abs(v) < b.hz + R) return b.n;
  }
  return null;
};
const quiet = argv.includes('--summary');
const TOT = { n: 0, hit: 0, by: {} };
const report = (label, frames, total = false) => {
  let n = 0, hit = 0;
  const by = {};
  for (const W of frames) for (const [x, y, z] of W) { n++; const k = inside(x, y, z); if (k) { hit++; by[k] = (by[k] || 0) + 1; } }
  if (total) { TOT.n += n; TOT.hit += hit; for (const [k, v] of Object.entries(by)) TOT.by[k] = (TOT.by[k] || 0) + v; }
  if (!quiet) console.log(`${label}: ${hit} of ${n} walker positions inside furniture (${((100 * hit) / Math.max(1, n)).toFixed(2)} %) ${JSON.stringify(Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6)))}`);
};
console.log(`${boxes.length} obstacle boxes`);
for (const t of (opt('take') || '').split(',').filter(Boolean)) {
  const T = readTracks(path.join(t, 'tracks.atrk'));
  const all = T.frames.map((F) => F.walk.filter((w) => w.pose === 0).map((w) => [w.x, w.y, w.z]));
  report(`${path.basename(t)} all frames`, all, true);
  if (!quiet) report(`${path.basename(t)} frames 0, 54, 107`, [0, 54, 107].map((i) => all[i]).filter(Boolean));
}
if (quiet) console.log(`all takes: ${TOT.hit} of ${TOT.n} walker positions inside furniture (${((100 * TOT.hit) / Math.max(1, TOT.n)).toFixed(2)} %) ${JSON.stringify(Object.fromEntries(Object.entries(TOT.by).sort((a, b) => b[1] - a[1]).slice(0, 6)))}`);
for (const p of (opt('page') || '').split(',').filter(Boolean)) {
  const fr = [];
  for (const i of [0, 54, 107]) { const f = path.join(p, `actors_f${i}.json`); if (fs.existsSync(f)) fr.push(JSON.parse(fs.readFileSync(f, 'utf8')).walk.map(([x, z]) => [x, null, z])); }
  report(`${path.basename(p)} frames 0, 54, 107`, fr);
}
