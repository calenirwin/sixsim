// Actor tracks for many shots at once: tools/core/take.mjs per shot, in parallel processes (one CPU core each).
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/takes.mjs --act trailerUE [--jobs 16] [--seed 1] [--root shots/core/<act>]
//   node tools/core/takes.mjs --shots tuApolloSweep,t7ArchTrack
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const act = opt('act');
const names = opt('shots') ? opt('shots').split(',') : Object.entries(SH.shots).filter(([, v]) => v.act === act).map(([k]) => k);
if (!names.length) { console.error('no shots'); process.exit(2); }
const jobs = parseInt(opt('jobs', '16'), 10), seed = opt('seed', '1');
const root = path.resolve(opt('root', path.join(ROOT, 'shots/core', act || 'set')));
fs.mkdirSync(root, { recursive: true });
const t0 = Date.now();
const results = [];
let next = 0;
async function worker() {
  while (next < names.length) {
    const name = names[next++];
    const out = path.join(root, `${name}_s${seed}`);
    const ts = Date.now();
    const code = await new Promise((res) => {
      const p = spawn(process.execPath, [path.join(ROOT, 'tools/core/take.mjs'), '--shot', name, '--seed', seed, '--out', out, '--stats-every', '0'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('exit', (c) => { if (c) console.log(`  ${name}: exit ${c} ${err.split('\n').filter((l) => /Error|at /.test(l)).slice(0, 3).join(' | ')}`); res(c); });
    });
    let S = null;
    try { S = JSON.parse(fs.readFileSync(path.join(out, 'stats.json'), 'utf8')); } catch { /* failed */ }
    results.push({ name, code, s: (Date.now() - ts) / 1000, frames: S?.frames, actors: S?.actors, bytes: S?.tracks?.bytes, msPerStep: S?.msPerStep });
    console.log(`  ${name}: ${code ? 'FAILED' : `${S.frames} frames, ${S.actors.vehicles} vehicles, ${S.actors.walkers} walkers, ${S.actors.trainCars} train cars, ${(S.tracks.bytes / 1e6).toFixed(1)} MB`} in ${((Date.now() - ts) / 1000).toFixed(0)} s`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));
const wall = (Date.now() - t0) / 1000;
const frames = results.reduce((a, r) => a + (r.frames || 0), 0);
fs.writeFileSync(path.join(root, 'takes.json'), JSON.stringify({ act, seed, jobs, wall, frames, results }, null, 1));
console.log(`[core] ${results.filter((r) => !r.code).length}/${names.length} takes, ${frames} frames in ${wall.toFixed(0)} s wall with ${jobs} jobs -> ${path.relative(ROOT, root)}`);
