// TW39 tower gate: does a compiled set draw every tall building of the footprint data it was compiled from?
//
//   node tools/pipeline/towergate.mjs <tilesDir> [--min 60] [--json out.json] [--live]
//
// The footprints are the exports the compile reads (data/raw/footprints/latest/ when it exists, else data/raw/; FOOTPRINTS_DIR
// overrides, as in compile.mjs). Every footprint with a roof over --min metres (60) that the compile would load (its largest
// ring, not a sliver) must be drawn: a compiled building record (or an LF39 building of the set's overlays, when its entry
// applies) whose ring holds the footprint's centroid, or whose centroid the footprint's ring holds, at 90 % of the
// footprint's height or within 6 m of it. A footprint with no such record is MISSING, one under that height LOW; the exit
// code is 1 when any is. --live also asks the live dataset (5zhs-2jue) how many footprints over --min each borough's box
// holds, against the export's count (a stale export shows here; it needs the network).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseTile, buildingsOf } from '../../src/world/tiledata.js';
import { project } from '../../src/shared/geo.js';
import { pointInPoly, signedArea, centroid } from './geom.mjs';
import { tileContentKey } from '../../src/shared/overlay.js';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = path.join(CLIENT, 'data', 'raw');
const FT = 0.3048;
const BBOX = { 1: [40.678, -74.05, 40.888, -73.9], 2: [40.783, -73.94, 40.92, -73.746], 3: [40.55, -74.045, 40.741, -73.83], 4: [40.535, -73.97, 40.812, -73.695], 5: [40.49, -74.26, 40.66, -74.04] };
const NAMES = { 1: 'Manhattan', 2: 'Bronx', 3: 'Brooklyn', 4: 'Queens', 5: 'Staten Island' };

// up to ~24 points inside a ring (a grid over its box, the cells' centres that fall inside), at least one
function interior(ring, area) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const st = Math.max(1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 24)), out = [];
  for (let z = z0 + st / 2; z < z1; z += st) for (let x = x0 + st / 2; x < x1; x += st) if (pointInPoly(x, z, ring)) out.push([x, z]);
  if (!out.length) out.push(centroid(ring));
  return out;
}
export function footDir() {
  return process.env.FOOTPRINTS_DIR ?? (fs.existsSync(path.join(RAW, 'footprints', 'latest')) ? path.join('footprints', 'latest') : '');
}

export async function towerGate(tilesDir, { minH = 60, live = false, footprints = null } = {}) {
  const man = JSON.parse(fs.readFileSync(path.join(tilesDir, 'manifest.json'), 'utf8'));
  // ---- the compiled records (+ the LF39 buildings the page would add), in a 64 m grid by bbox
  const CELL = 64, grid = new Map();
  const add = (rec) => {
    for (let gz = Math.floor(rec.bb[1] / CELL); gz <= Math.floor(rec.bb[3] / CELL); gz++)
      for (let gx = Math.floor(rec.bb[0] / CELL); gx <= Math.floor(rec.bb[2] / CELL); gx++) {
        const k = gx + '_' + gz; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(rec);
      }
  };
  const mkRec = (ring, h, src) => {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const [cx, cz] = centroid(ring);
    return { ring, h, bb: [x0, z0, x1, z1], cx, cz, src };
  };
  let lf = null;
  for (const f of [path.join(tilesDir, 'overlays', 'lf39.json'), path.join(CLIENT, 'public', 'data', 'lf39', 'lf39.json')]) if (!lf && fs.existsSync(f)) lf = JSON.parse(fs.readFileSync(f, 'utf8'));
  let nRec = 0, nLf = 0;
  const absurd = [];   // compiled records over 500 m
  for (const [key, ent] of Object.entries(man.tiles)) {
    const b0 = fs.readFileSync(path.join(tilesDir, ent.f));
    const t = parseTile(b0.buffer.slice(b0.byteOffset, b0.byteOffset + b0.byteLength));
    if (!t.S.bldg || !t.S.bldg.byteLength) continue;
    const [ox, oz] = t.header.origin, XZ = t.S.bldgXZ;
    const e = lf && lf.tiles && lf.tiles[key];
    if (e && e.b && e.b.length && (e.ckey ? e.ckey === tileContentKey(t) : e.bytes === b0.byteLength)) {
      for (const b of e.b) { add(mkRec(b.ring.map(([x, z]) => [x + ox, z + oz]), b.h, 'lf39')); nLf++; }
    }
    for (const b of buildingsOf(t)) {
      if (b.height > 500) absurd.push({ tile: key, i: b.i, h: +b.height.toFixed(1) });   // the city's tallest roof is 472 m
      if (b.height < minH * 0.5) continue;   // a record this low cannot hold a tall footprint; the low parts stay out of the index
      const ring = []; for (let i = 0; i < b.len; i++) ring.push([XZ[(b.start + i) * 2] + ox, XZ[(b.start + i) * 2 + 1] + oz]);
      if (ring.length >= 3) { add(mkRec(ring, b.height, key + ':' + b.i)); nRec++; }
    }
  }
  // ---- the footprints, as compile.mjs loads them
  const FD = footprints ?? footDir();   // compile.mjs passes the folder it read (latest/ may appear while a compile runs)
  const per = {}, fails = [], seen = new Set(), badData = [];
  for (const b of [1, 2, 3, 4, 5]) {
    const f = path.join(RAW, FD, `buildings_${b}.geojson`);
    if (!fs.existsSync(f)) continue;
    const fc = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const feat of fc.features) {
      const p = feat.properties, g = feat.geometry;
      if (!g || String(p.feature_code) === '1003') continue;   // the compile skips placeholders
      const bin = p.bin || p.doitt_id;
      if (seen.has(bin)) continue;
      seen.add(bin);
      const h = (parseFloat(p.height_roof) || 0) * FT;
      if (h < minH) continue;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      let best = null, bestA = 0;
      for (const poly of polys) { const r = poly[0].map(([lon, lat]) => project(lon, lat)); const a = Math.abs(signedArea(r)); if (a > bestA) { bestA = a; best = r; } }
      if (!best || bestA < 12) continue;   // the compile's sliver rules (a tall record under 12 m2 is dropped)
      let perim = 0; for (let i = 0; i < best.length; i++) { const a = best[i], c = best[(i + 1) % best.length]; perim += Math.hypot(c[0] - a[0], c[1] - a[1]); }
      if (perim > 0 && (2 * bestA) / perim < 1.6) continue;
      // the compile reads a height no building has as unknown (over 500 m, or 50 times the mean width): not a tower
      const meanW = perim > 0 ? (2 * bestA) / perim : 0;
      if (h > 500 || (meanW > 0 && h / meanW > 50)) { badData.push({ bin, h: +h.toFixed(1), meanW: +meanW.toFixed(1) }); continue; }
      const [cx, cz] = centroid(best);
      // the tile range of this set: a footprint outside every tile is out of scope (a partial compile)
      if (!man.tiles[Math.floor(cx / 512) + '_' + Math.floor(cz / 512)]) continue;
      const boro = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }[String(p.base_bbl || p.mappluto_bbl || '').charAt(0)] || b;
      const P = (per[boro] ||= { name: NAMES[boro], tall: 0, ok: 0, low: 0, missing: 0, viaLf39: 0 });
      P.tall++;
      // points inside the footprint (its centroid lies in the court of a U: the Majestic, the Eldorado), on a grid of about 24
      let hit = 0, via = null;
      const pts = interior(best, bestA);
      const cands = new Set();
      for (const [px, pz] of pts) for (const r of grid.get(Math.floor(px / CELL) + '_' + Math.floor(pz / CELL)) || []) cands.add(r);
      for (const r of cands) {
        if (r.h <= hit) continue;
        if (pts.some(([px, pz]) => px >= r.bb[0] && px <= r.bb[2] && pz >= r.bb[1] && pz <= r.bb[3] && pointInPoly(px, pz, r.ring)) || pointInPoly(r.cx, r.cz, best)) { hit = r.h; via = r.src; }
      }
      const okH = hit >= h * 0.9 || hit >= h - 6;
      if (okH) { P.ok++; if (via === 'lf39') P.viaLf39++; continue; }
      if (hit > 0) P.low++; else P.missing++;
      fails.push({ bin, boro, h: +h.toFixed(1), drawn: +hit.toFixed(1), status: hit > 0 ? 'low' : 'missing', record: via, year: p.construction_year || null, x: +cx.toFixed(1), z: +cz.toFixed(1) });
    }
  }
  const out = { tilesDir, footprints: FD || 'data/raw', minH, records: nRec, lf39Buildings: nLf, boroughs: per, badFootprintHeights: badData, absurdRecords: absurd, failures: fails.length + absurd.length, list: fails };
  if (live) {
    const UA = 'valdrada-research/0.1 (project contact: github.com/mkturkcan/valdrada)';
    out.live = {};
    for (const b of Object.keys(per)) {
      const [la1, lo1, la2, lo2] = BBOX[b];
      const w = `within_box(the_geom,${la1},${lo1},${la2},${lo2}) AND height_roof >= ${(minH / FT).toFixed(2)}`;
      try {
        const r = await fetch(`https://data.cityofnewyork.us/resource/5zhs-2jue.json?$select=count(*)&$where=${encodeURIComponent(w)}`, { headers: { 'User-Agent': UA } });
        out.live[b] = +(await r.json())[0].count;
      } catch (e) { out.live[b] = String(e.message || e); }
    }
  }
  return out;
}

export function towerLine(r) {
  return Object.entries(r.boroughs).map(([b, P]) => `${P.name} ${P.ok}/${P.tall}` + (P.low || P.missing ? ` (${P.missing} missing, ${P.low} low)` : '') + (P.viaLf39 ? ` [${P.viaLf39} by LF39]` : '')).join(', ')
    + ` | footprints over ${r.minH} m from ${r.footprints}` + (r.badFootprintHeights.length ? ` | ${r.badFootprintHeights.length} footprint heights no building has (read as unknown)` : '')
    + (r.absurdRecords.length ? ` | ${r.absurdRecords.length} RECORDS OVER 500 m ${JSON.stringify(r.absurdRecords)}` : '') + (r.live ? ' | live counts ' + JSON.stringify(r.live) : '');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--json', '--min'].includes(args[i - 1]));
  if (!dir) { console.log('usage: node tools/pipeline/towergate.mjs <tilesDir> [--min 60] [--json out.json] [--live]'); process.exit(2); }
  const r = await towerGate(path.resolve(dir), { minH: +(opt('--min') || 60), live: args.includes('--live') });
  console.log(`tower gate: ${towerLine(r)}`);
  for (const f of r.list.slice(0, 25)) console.log('  ', JSON.stringify(f));
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(r, null, 1));
  if (r.failures) { console.log(`TOWER GATE FAILED: ${r.list.length} footprints over ${r.minH} m not drawn at their height, ${r.absurdRecords.length} records over 500 m`); process.exit(1); }
}
