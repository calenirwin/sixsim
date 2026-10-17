#!/usr/bin/env node
// The persistent tier (L6 8 km, L5 4 km chunks) and the L4 2 km chunks for ?lod16=1 (client/src/lod/), drawn from OUR
// records: the compiled near tiles' building records (client/public/tiles/t_*.bin, with the LF39 lot fixes applied as
// the client applies them) and the macro terrain grids (far_*.bin `terr`). Nothing is decimated: every level is drawn
// again from the records at its own error.
//
//   node --max-old-space-size=24000 tools/lod/build_persistent.mjs [--tiles client/public/tiles]
//        [--out client/public/data/lod16] [--levels 6,5,4] [--only 6:1_0] [--nolm]
//
// Per chunk, every non-landmark building below the tower height is rasterised (cell centre inside the footprint) onto
// a 1024 x 1024 grid as its absolute roof height rounded to the level's band; 4-connected cells of one band are a
// region (a merged block shell). Region boundaries are traced on the grid, cut into segments at every corner where
// three labels meet (or two meet diagonally), and each segment is simplified ONCE in a canonical direction, so the two
// regions on either side get the identical polyline (no cracks). Walls are extruded only where a region stands above
// its neighbour (from the neighbour's roof, or from the region's lowest base where the neighbour is open ground);
// nothing is drawn along a chunk's border, where the neighbouring chunk continues the same regions. Roofs are the
// regions' simplified rings, triangulated with earcut.
//
// Towers over the level's tower height stay out of the shells and are drawn as their own silhouettes: the simplified
// footprint, the near tiles' 1916-zoning setback tiers (world/towers.js buildSetbacks) and the era crown, pylon and
// mast rules of buildTower, with the same seeds (colorVar), so the far skyline has the near tiles' proportions.
// Landmarks listed in client/public/data/landmarks.json are left out entirely (the registry draws them; --nolm keeps
// them in the shells).
//
// Vertex format per chunk (client/src/lod/chunks.js reads it): position Int16 x3 (x, z relative to the chunk centre,
// y absolute; 1/4 m units), colour Uint8 x4 (albedo as sRGB bytes; alpha = the lit share, the night windows), uv
// Float32 x2 (the FW14 far window grid: along the wall in metres from the world origin / 12, height / 15.2; roofs on
// the white texel), index Uint32, bk Uint32 (the vertex's building key: an index into the header's `bkeys`, each
// `<tile>:<index>` of the client's record; a tower's own, a merged region's largest building; 0xffffffff none). The L6 files carry the ground (`gpos`, `gidx`): the macro terrain grids, 0.5 m low
// as the streamer drew them, flat land merged into rectangles, open water left to the water plane.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTile, buildingsOf } from '../../client/src/world/tiledata.js';
import { lf39Apply } from '../../client/src/world/lotfix39.js';
import { writeTile } from '../../client/tools/pipeline/binio.mjs';
import { MACRO } from '../../client/src/shared/geo.js';
import { makeShellKit } from './shellkit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const TILES = path.resolve(root, opt('tiles', 'client/public/tiles'));
const OUT = path.resolve(root, opt('out', 'client/public/data/lod16'));
const WANT = opt('levels', '6,5,4').split(',').map(Number);
const ONLY = opt('only');   // "6:1_0" builds one chunk (a test); BD40: a comma list ("3:-2_4,3:-2_5") builds those
const ONLYS = ONLY ? new Set(ONLY.split(',')) : null;
const NOLM = opt('nolm') === '1';
const SCALE = 4;            // position units per metre
const N = 1024;             // grid cells per chunk side

// error: the level's geometric error in metres (what the streaming manager's screen-space error uses)
const LEVELS = {
  6: { size: 8192, cell: 8, band: 10, tol: 6.0, towerH: 100, err: 10, mastW: 3.0 },
  5: { size: 4096, cell: 4, band: 5, tol: 2.5, towerH: 100, err: 5, mastW: 1.5 },
  4: { size: 2048, cell: 2, band: 2.5, tol: 1.25, towerH: 45, err: 2.5, mastW: 0.8 },
  // BD40: L3 (1,024 m), built only where the backdrop refines an L4 chunk the city shares (tools/lod/build_backdrop.mjs:
  // a chunk gives way only to all its children, so the city's part of such a chunk needs its own L3), --levels 3 --only
  3: { size: 1024, cell: 1, band: 1.25, tol: 0.6, towerH: 45, err: 1.25, mastW: 0.5 },
};

const t0 = Date.now();
const log = (...a) => console.log(`[lod16 ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ------------------------------------------------------------------------------------------------ records
const manifest = JSON.parse(fs.readFileSync(path.join(TILES, 'manifest.json'), 'utf8'));
let lf39 = null;
try { lf39 = JSON.parse(fs.readFileSync(path.join(root, 'client/public/data/lf39/lf39.json'), 'utf8')); } catch { log('no LF39 data'); }
// the landmarks the registry draws (client/public/data/landmarks.json, tools/lod/bake_landmarks.mjs)
const LM_DRAWN = new Set();
const LM_AREAS = [];   // registry landmarks built by area kits (no landmark id): compiled footprints within excludeR leave the shells
if (!NOLM) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(root, 'client/public/data/landmarks.json'), 'utf8'));
    for (const l of reg.landmarks || []) {
      if (l.lmId && l.l6) LM_DRAWN.add(Math.abs(l.lmId));
      else if (l.l6 && l.excludeR && l.center) LM_AREAS.push([l.center[0], l.center[2], l.excludeR]);
    }
  } catch { /* no registry yet: every building stays in the shells */ }
}
// Central Park's small structures that no park part builds (city/centralPark.js cpSkipBuilding: a footprint in the park at
// the compiler's 12 m default and under 300 m2) are dropped there, so they are dropped here too
const inPark = (x, z) => { const qx = x - 447.2, qz = z - 82.2; return Math.abs(qx * 0.4848 - qz * 0.8746) < 2084 && Math.abs(qx * 0.8746 + qz * 0.4848) < 451; };
log('landmark ids drawn by the registry:', LM_DRAWN.size, '; area landmarks:', LM_AREAS.length);

const B = [];   // buildings
let nLf = 0;
for (const [key, t] of Object.entries(manifest.tiles)) {
  const buf = fs.readFileSync(path.join(TILES, t.f));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const tile = parseTile(ab);
  if (lf39) nLf += lf39Apply(key, tile, buf.byteLength, lf39) ? 1 : 0;
  const [ox, oz] = tile.header.origin;
  const XZ = tile.S.bldgXZ;
  for (const b of buildingsOf(tile)) {
    if (b.len < 3 || !(b.height > 0)) continue;
    const ring = new Float64Array(b.len * 2);
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, cx = 0, cz = 0;
    for (let i = 0; i < b.len; i++) {
      const x = XZ[(b.start + i) * 2] + ox, z = XZ[(b.start + i) * 2 + 1] + oz;
      ring[i * 2] = x; ring[i * 2 + 1] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      cx += x; cz += z;
    }
    B.push({
      ring, x0, z0, x1, z1, cx: cx / b.len, cz: cz / b.len, baseY: b.baseY, h: b.height,
      r: b.r, g: b.g, b: b.b, style: b.style, flags: b.flags, lit: b.lit, lm: b.landmarkId, cv: b.colorVar,
      area: b.area, roofKind: b.roofKind & 7, floorH: b.floorH, tile: key, ti: b.i,
    });
  }
}
log(`buildings ${B.length} from ${Object.keys(manifest.tiles).length} tiles (LF39 applied to ${nLf})`);

// macro buckets (by bbox overlap)
const bucket = new Map();
B.forEach((b, i) => {
  for (let mz = Math.floor(b.z0 / MACRO); mz <= Math.floor(b.z1 / MACRO); mz++) {
    for (let mx = Math.floor(b.x0 / MACRO); mx <= Math.floor(b.x1 / MACRO); mx++) {
      const k = `${mx}_${mz}`;
      let a = bucket.get(k);
      if (!a) bucket.set(k, (a = []));
      a.push(i);
    }
  }
});
const isLandmark = (b) => (b.lm !== 0 && LM_DRAWN.has(Math.abs(b.lm)))
  || LM_AREAS.some(([x, z, r]) => Math.hypot(b.cx - x, b.cz - z) < r)
  || (Math.abs(b.h - 12) < 0.05 && b.area < 300 && inPark(b.cx, b.cz));

// ------------------------------------------------------------------------------------------------ the geometry kit
// (tools/lod/shellkit.mjs: the block shells, tower silhouettes and their vertex format, shared with the backdrop's builder)
const kit = makeShellKit({ B, LEVELS, N, SCALE });   // (BD40: the kit kept whole for its AO pass)
const { Mesh, shells, tower } = kit;

// ------------------------------------------------------------------------------------------------ ground (L6)
function readTerr(mx, mz) {
  const e = manifest.macros[`${mx}_${mz}`];
  if (!e) return null;
  try {
    const buf = fs.readFileSync(path.join(TILES, e.f));
    const t = parseTile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    return t.S.terr ? Float32Array.from(t.S.terr) : null;
  } catch { return null; }
}
function ground(ci, cj, g) {
  const M = LEVELS[6].size / MACRO, RES = 32, GN = M * RES;   // 128 cells a side, 64 m
  const step = MACRO / RES;
  const GBLK = Math.max(1, Math.round(128 / step));   // (BD40: cells per 128 m block)
  const H = new Float32Array((GN + 1) * (GN + 1)).fill(-3.5);
  let any = false;
  for (let q = 0; q < M; q++) for (let p = 0; p < M; p++) {
    const terr = readTerr(ci * M + p, cj * M + q);
    if (!terr) continue;
    any = true;
    for (let j = 0; j <= RES; j++) for (let i = 0; i <= RES; i++) H[(q * RES + j) * (GN + 1) + p * RES + i] = terr[j * (RES + 1) + i];
  }
  if (!any) return 0;
  const X0 = ci * LEVELS[6].size, Z0 = cj * LEVELS[6].size;
  const h = (i, j) => H[j * (GN + 1) + i];
  const used = new Uint8Array(GN * GN);
  const flat = (i, j) => { const a = h(i, j); return a > -3 && a === h(i + 1, j) && a === h(i, j + 1) && a === h(i + 1, j + 1); };
  const quad = (i0, j0, i1, j1, y00, y10, y01, y11) => {
    const xa = X0 + i0 * step, xb = X0 + i1 * step, za = Z0 + j0 * step, zb = Z0 + j1 * step;
    const v = (x, y, z) => { g.p.push(Math.round((x - g.ox) * SCALE), Math.round((y - 0.5) * SCALE), Math.round((z - g.oz) * SCALE)); return g.nv++; };
    const a = v(xa, y00, za), b2 = v(xb, y10, za), c = v(xa, y01, zb), d = v(xb, y11, zb);
    g.i.push(a, d, b2, a, c, d);   // the streamer's diagonal and winding (faces up)
  };
  let tris = 0;
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
    if (used[j * GN + i]) continue;
    const y00 = h(i, j), y10 = h(i + 1, j), y01 = h(i, j + 1), y11 = h(i + 1, j + 1);
    if (y00 <= -3 && y10 <= -3 && y01 <= -3 && y11 <= -3) continue;   // open water: the water plane
    if (!flat(i, j)) { quad(i, j, i + 1, j + 1, y00, y10, y01, y11); used[j * GN + i] = 1; tris += 2; continue; }
    // BD40: a merged rectangle stays inside its 128 m block (GBLK cells), so a renderer that masks the far ground under its
    // own 128 m cells by each triangle's centroid (tools/ue/r1c_lodprep.py) drops exactly the blocks the cells draw: a
    // rectangle merged across blocks was dropped whole for a centroid inside the cells and left the planet showing
    const bi1 = (Math.floor(i / GBLK) + 1) * GBLK, bj1 = (Math.floor(j / GBLK) + 1) * GBLK;
    let w = 1;
    while (i + w < Math.min(GN, bi1) && !used[j * GN + i + w] && flat(i + w, j) && h(i + w, j) === y00) w++;
    let hh = 1;
    for (;;) {
      if (j + hh >= Math.min(GN, bj1)) break;
      let ok = true;
      for (let k = 0; k < w && ok; k++) ok = !used[(j + hh) * GN + i + k] && flat(i + k, j + hh) && h(i + k, j + hh) === y00;
      if (!ok) break;
      hh++;
    }
    for (let q = 0; q < hh; q++) for (let k = 0; k < w; k++) used[(j + q) * GN + i + k] = 1;
    quad(i, j, i + w, j + hh, y00, y00, y00, y00);
    tris += 2;
  }
  return tris;
}

// ------------------------------------------------------------------------------------------------ chunks
fs.mkdirSync(OUT, { recursive: true });
const idxFile = path.join(OUT, 'index.json');
let index = { v: 1, scale: 1 / SCALE, levels: {}, chunks: {} };
if (ONLY) { try { index = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch { /* fresh */ } }
const bounds = manifest.bounds;   // [x0, z0, x1, z1]
const towersOf = new Map();       // `${lv}:${ci}_${cj}` -> tower building ids (by centroid)
const totals = {};
for (const lv of WANT) {
  const P = LEVELS[lv];
  index.levels[lv] = { size: P.size, cell: P.cell, band: P.band, err: P.err, towerH: P.towerH };
  index.chunks[lv] = index.chunks[lv] || {};
  const i0 = Math.floor(bounds[0] / P.size), i1 = Math.floor(bounds[2] / P.size);
  const j0 = Math.floor(bounds[1] / P.size), j1 = Math.floor(bounds[3] / P.size);
  totals[lv] = { chunks: 0, tris: 0, bytes: 0, towers: 0, gtris: 0 };
  for (let cj = j0; cj <= j1; cj++) for (let ci = i0; ci <= i1; ci++) {
    const ck = `${ci}_${cj}`;
    if (ONLYS && !ONLYS.has(`${lv}:${ck}`)) continue;
    const M = P.size / MACRO;
    const seen = new Set(), ids = [], tw = [];
    // (BD40: a chunk smaller than a macro bucket (L3) reads the one bucket that holds it)
    const mx0 = Math.floor((ci * P.size) / MACRO), mz0 = Math.floor((cj * P.size) / MACRO), MM = Math.max(1, M);
    for (let q = 0; q < MM; q++) for (let p = 0; p < MM; p++) {
      for (const bi of bucket.get(`${mx0 + p}_${mz0 + q}`) || []) {
        if (seen.has(bi)) continue;
        seen.add(bi);
        const b = B[bi];
        if (isLandmark(b)) continue;
        if (b.h > P.towerH) {
          if (Math.floor(b.cx / P.size) === ci && Math.floor(b.cz / P.size) === cj) tw.push(bi);
          continue;
        }
        if (b.h < 2.0) continue;
        ids.push(bi);
      }
    }
    const ox = ci * P.size + P.size / 2, oz = cj * P.size + P.size / 2;
    const m = new Mesh(ox, oz);
    const st = ids.length ? shells(lv, ci, cj, ids, m) : { regions: 0, walls: 0 };
    const shellTris = m.tris;
    for (const bi of tw) tower(m, B[bi], P, bi);
    const g = new Mesh(ox, oz);
    const gt = lv === 6 ? ground(ci, cj, g) : 0;
    if (!m.tris && !gt) {   // (BD40: an entry the backdrop shares keeps its backdrop part)
      const pe = index.chunks[lv][ck];
      if (pe && pe.bd) { for (const k of ['f', 't', 'ts', 'g', 'tw']) delete pe[k]; pe.bytes = pe.bd.bytes; } else delete index.chunks[lv][ck];
      continue;
    }
    const file = `L${lv}_${ck}.bin`;
    try { if (fs.lstatSync(path.join(OUT, file)).isSymbolicLink()) fs.unlinkSync(path.join(OUT, file)); } catch { /* BD40: a staged set links the live chunks; a rebuilt one must not write through the link */ }
    const secs = [
      { name: 'pos', array: Int16Array.from(m.p) },
      { name: 'col', array: Uint8Array.from(m.c) },
      { name: 'uv', array: Float32Array.from(m.u) },
      { name: 'idx', array: Uint32Array.from(m.i) },
      { name: 'bk', array: Uint32Array.from(m.k) },
    ];
    { // ==== BD40: each vertex's open-sky share (the kit's AO pass) from every building within its margin, towers included
      const am = kit.AO_MARGIN, near = new Set();
      for (let q = Math.floor((cj * P.size - am) / MACRO); q <= Math.floor(((cj + 1) * P.size + am) / MACRO); q++)
        for (let p = Math.floor((ci * P.size - am) / MACRO); p <= Math.floor(((ci + 1) * P.size + am) / MACRO); p++)
          for (const bi of bucket.get(`${p}_${q}`) || []) near.add(bi);
      secs.push({ name: 'ao', array: kit.aoPass(m, [...near], P.size) });
    } // ==== end BD40
    if (gt) secs.push({ name: 'gpos', array: Int16Array.from(g.p) }, { name: 'gidx', array: Uint32Array.from(g.i) });
    writeTile(path.join(OUT, file), { v: 1, level: lv, ci, cj, origin: [ox, oz], scale: 1 / SCALE, err: P.err, regions: st.regions, towers: tw.length, bkeys: m.keys }, secs);
    const bytes = fs.statSync(path.join(OUT, file)).size;
    const y0 = Math.min(m.y0, 0), y1 = Math.max(m.y1, 10);
    const prevE = index.chunks[lv][ck];   // (BD40: an entry's backdrop part, tools/lod/build_backdrop.mjs, is kept)
    index.chunks[lv][ck] = { f: file, t: m.tris, ts: shellTris, g: gt, tw: tw.length, bytes, b: [ci * P.size, cj * P.size, (ci + 1) * P.size, (cj + 1) * P.size, +y0.toFixed(1), +y1.toFixed(1)] };
    if (prevE && prevE.bd) { const e2 = index.chunks[lv][ck]; e2.bd = prevE.bd; e2.bytes += prevE.bd.bytes; e2.b[4] = Math.min(e2.b[4], prevE.bd.y0); e2.b[5] = Math.max(e2.b[5], prevE.bd.y1); }
    totals[lv].chunks++; totals[lv].tris += m.tris; totals[lv].bytes += bytes; totals[lv].towers += tw.length; totals[lv].gtris += gt;
    log(`L${lv} ${ck}: ${ids.length} bldgs -> ${st.regions} regions, ${shellTris} shell tris + ${m.tris - shellTris} in ${tw.length} towers, ground ${gt}, ${(bytes / 1048576).toFixed(2)} MB`);
  }
  log(`L${lv} total: ${JSON.stringify(totals[lv])}`);
}
index.built = new Date().toISOString();
index.landmarksExcluded = [...LM_DRAWN].sort((a, b) => a - b);
index.totals = { ...(index.totals || {}), ...totals };
try { if (fs.lstatSync(idxFile).isSymbolicLink()) fs.unlinkSync(idxFile); } catch { /* (BD40, as above) */ }
fs.writeFileSync(idxFile, JSON.stringify(index));
log('index written', idxFile);
