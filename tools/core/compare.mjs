// A core take next to the page's own simulation of the same shot: per-frame statistics from tools/core/take.mjs and
// tools/core/page_take.mjs (both measured with core/tracks/stats.mjs), as mean [min, max] over the take's frames.
//
//   node tools/core/compare.mjs --shot tuApolloSweep [--core shots/core/<shot>_s1] [--page shots/core/<shot>_page]
//        [--core2 shots/core/<shot>_s2]   (a second seed: the spread between two seeds of the same model)
//        [--runs name=dir,name=dir,...]   (any set of runs instead)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const shot = opt('shot', 'tuApolloSweep');
// --runs name=dir,name=dir... replaces the default set
const runList = opt('runs') ? opt('runs').split(',').map((r) => r.split('=')) : [['core', opt('core', `shots/core/${shot}_s1`)], ['core seed 2', opt('core2', null)], ['page', opt('page', `shots/core/${shot}_page`)]];
const runs = runList
  .filter(([, d]) => d && fs.existsSync(path.join(ROOT, d, 'stats.json')))
  .map(([name, d]) => [name, JSON.parse(fs.readFileSync(path.join(ROOT, d, 'stats.json'), 'utf8'))]);
if (!runs.length) { console.error('no stats.json found'); process.exit(2); }

const get = (f, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), f);
const agg = (S, key) => {
  const v = S.perFrame.map((f) => get(f, key)).filter((x) => typeof x === 'number');
  if (!v.length) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean: m, min: Math.min(...v), max: Math.max(...v), n: v.length, frames: v.filter((x) => x > 0).length };
};
const rows = [
  ['vehicles within 250 m of the lens path', 'inRegion.veh'], ['walkers within 250 m of the lens path', 'inRegion.walk'],
  ['cars within 50 m', 'cars.50'], ['cars within 100 m', 'cars.100'], ['cars within 250 m', 'cars.250'],
  ['moving cars within 100 m (v > 0.5)', 'moving.100'], ['moving cars within 250 m', 'moving.250'],
  ['mean speed of moving cars within 100 m (m/s)', 'meanV.100'], ['mean speed of moving cars within 250 m (m/s)', 'meanV.250'],
  ['parked within 100 m', 'parked.100'], ['parked within 250 m', 'parked.250'],
  ['walkers within 50 m', 'walkers.50'], ['walkers within 100 m', 'walkers.100'], ['walkers within 250 m', 'walkers.250'],
  ['walking within 100 m', 'walking.100'], ['mean walking speed within 100 m (m/s)', 'meanWalkV.100'],
  ['bodies inside each other on screen (pairs)', 'overlaps'], ['parked pairs inside each other on screen', 'overlapsParked'],
  ['vehicles with a wheel off the road on screen', 'offRoad'],
  ['cars in the whole sim', 'total.cars'], ['walkers in the whole sim', 'total.walkers'],
];
const fmt = (a, frames = false) => (a ? `${a.mean.toFixed(a.mean < 10 ? 2 : 1)} [${+a.min.toFixed(2)}, ${+a.max.toFixed(2)}]${frames ? ` (${a.frames}/${a.n} frames)` : ''}` : '-');
const table = [`| ${shot} | ${runs.map(([n]) => n).join(' | ')} |`, `|---|${runs.map(() => '---').join('|')}|`];
const out = { shot, runs: runs.map(([n, S]) => ({ name: n, frames: S.perFrame.length, warm: S.warm, query: S.query })), rows: {} };
for (const [label, key] of rows) {
  const A = runs.map(([, S]) => agg(S, key));
  out.rows[key] = A;
  const flag = /overlaps|offRoad/.test(key);
  table.push(`| ${label} | ${A.map((a) => fmt(a, flag)).join(' | ')} |`);
}
// kinds within 250 m, summed over the frames, as shares
const kindShares = runs.map(([, S]) => {
  const tot = {};
  for (const f of S.perFrame) for (const [k, n] of Object.entries(f.kinds || {})) tot[k] = (tot[k] || 0) + n;
  const all = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, +(n / all).toFixed(3)]));
});
out.kinds = kindShares;
const topKinds = [...new Set(kindShares.flatMap((s) => Object.keys(s).slice(0, 8)))];
table.push(`| kind shares within 250 m | ${kindShares.map((s) => topKinds.map((k) => `${k} ${((s[k] || 0) * 100).toFixed(0)}%`).join(', ')).join(' | ')} |`);
console.log(table.join('\n'));
const dst = path.join(ROOT, 'shots/core', `${shot}_compare.json`);
fs.writeFileSync(dst, JSON.stringify(out, null, 1));
console.log(`\n-> ${path.relative(ROOT, dst)}`);
