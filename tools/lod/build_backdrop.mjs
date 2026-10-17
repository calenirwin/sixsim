#!/usr/bin/env node
// The backdrop's far levels (docs/notes/r2-backdrop.md; tile-system.md D12, R5.2): what is visible from the city but
// outside it, L3 to L6 chunks in the persistent tier's format, from our records (client/tools/pipeline/backdrop/) and
// the far city's own generator (tools/lod/shellkit.mjs):
//   * L3 and L4: every building on its own footprint (simplified within the level's error), its height, its facade's window
//     grid at its own floor height, gabled or hipped roofs on houses; towers over 45 m as the far city's silhouettes
//     (crowns, pylons, masts by the same seeds);
//   * L5 and L6: block shells merged within the level's error, and towers over 40 / 60 m as silhouettes;
//   * the ground of tools/lod/backdrop_ground.py (terrain clipped to the backdrop's land, its texture and night map).
//
//   node --max-old-space-size=32000 tools/lod/build_backdrop.mjs --out <lod16 dir> [--ground <dir>] [--rec <dir>]
//        [--base <live lod16 dir>] [--levels 6,5,4,3] [--only L4_-3_2] [--part k/n] [--merge]
//
// Out: <out>/BD<lv>_<i>_<j>.bin (CTL1: pos Int16 x3 at 1/4 m about the chunk centre, col Uint8 x4 (sRGB albedo, lit share),
// uv Float32 x2 (the FW14 window grid), idx Uint32, bk Uint32 (keys `bd:<n>`, the building's index in the records), and the
// ground's tpos, tuv, tnrm, tidx, tsh, ttex (JPEG), tnit (JPEG)), and <out>/index.json: each chunk's entry gains
// `bd` ({ f, bytes, t, g, y0, y1 }) and new keys hold the backdrop alone. --base copies the live index and links its chunk
// files into <out>, so <out> is a whole staged set for ?lod16=1. --part k/n builds every n-th chunk from k and writes
// <out>/bd_part<k>.json; --merge folds the parts into the index.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTile } from '../../client/src/world/tiledata.js';
import { writeTile } from '../../client/tools/pipeline/binio.mjs';
import { _internal as TW } from '../../client/src/world/towers.js';
import { makeShellKit } from './shellkit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const AUX = process.env.BD_AUX || '/data0/projectnyc_aux/tiles_backdrop';
const OUT = path.resolve(opt('out', path.join(AUX, 'run1', 'lod16')));
const GROUND = path.resolve(opt('ground', path.join(path.dirname(OUT), 'ground')));
const REC = path.resolve(opt('rec', path.join(AUX, 'records')));
const BASE = opt('base');
const WANT = opt('levels', '6,5,4,3').split(',').map(Number);
const ONLY = opt('only');
const PART = opt('part');
const MERGE = opt('merge') === '1';
const SCALE = 4;

// the backdrop's levels: the far city's errors; towers by level; L3 (1,024 m) is new for the waterfront across the rivers
const LEVELS = {
  3: { size: 1024, cell: 1, band: 1.25, tol: 0.6, towerH: 45, err: 1.25, mastW: 0.5, minA: 12, holeA: 50 },
  4: { size: 2048, cell: 2, band: 2.5, tol: 1.25, towerH: 45, err: 2.5, mastW: 0.8, minA: 40, holeA: 200 },
  // (L5, L6: a house or shed under `smallH` m and `smallA` m2 is a few pixels at these levels' distances: it stays in the
  // ground texture's roofs (backdrop_ground.py) and out of the shells, which keeps the persistent tier's triangle budget)
  5: { size: 4096, cell: 4, band: 5, tol: 2.5, towerH: 40, err: 5, mastW: 1.5, smallH: 10, smallA: 150 },
  6: { size: 8192, cell: 8, band: 10, tol: 6.0, towerH: 60, err: 10, mastW: 3.0, smallH: 12, smallA: 600 },
};
const t0 = Date.now();
const log = (...a) => console.log(`[backdrop ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readCTL = (f) => { const b = fs.readFileSync(f); return parseTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------------------------------------ index helpers
function levelsMeta() {
  const o = {};
  for (const lv of [3, 4, 5, 6]) { const P = LEVELS[lv]; o[lv] = { size: P.size, cell: P.cell, band: P.band, err: P.err, towerH: P.towerH }; }
  return o;
}
function mergeIndex(results) {
  const idxFile = path.join(OUT, 'index.json');
  let index = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : { v: 1, scale: 1 / SCALE, levels: {}, chunks: {} };
  index.levels = index.levels || {};
  for (const [lv, m] of Object.entries(levelsMeta())) if (!index.levels[lv]) index.levels[lv] = m;
  index.chunks = index.chunks || {};
  let n = 0;
  for (const r of results) {
    const lv = String(r.level), ck = `${r.ci}_${r.cj}`;
    const C = (index.chunks[lv] = index.chunks[lv] || {});
    const S = LEVELS[r.level].size;
    const e = C[ck] || { t: 0, ts: 0, g: 0, tw: 0, bytes: 0, b: [r.ci * S, r.cj * S, (r.ci + 1) * S, (r.cj + 1) * S, 0, 10] };
    const prevBd = e.bd ? e.bd.bytes : 0;
    e.bd = { f: r.file, bytes: r.bytes, t: r.tris, g: r.gtris, y0: r.y0, y1: r.y1, n: r.buildings, tw: r.towers };
    e.bytes = (e.bytes || 0) - prevBd + r.bytes;
    e.b[4] = +Math.min(e.b[4], r.y0).toFixed(1); e.b[5] = +Math.max(e.b[5], r.y1).toFixed(1);
    C[ck] = e;
    n++;
  }
  index.backdrop = { built: new Date().toISOString(), landmarks: fs.existsSync(path.join(OUT, 'landmarks_bd.json')) ? 'landmarks_bd.json' : null,
    chunks: Object.values(index.chunks).reduce((a, C) => a + Object.values(C).filter((e) => e.bd).length, 0),
    sources: ['OpenStreetMap (ODbL)', 'Microsoft Global ML Building Footprints (ODbL)', 'USGS 3DEP (public domain)', 'NOAA ENC (public domain)'] };
  const tmp = `${idxFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, idxFile);
  log(`index: ${n} backdrop entries merged -> ${idxFile}`);
}
let MERGE_PARTS = null;
if (MERGE) MERGE_PARTS = fs.readdirSync(OUT).filter((f) => /^bd_part\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));

// ------------------------------------------------------------------------------------------------ the staged set's base
if (BASE && !PART) {
  const b = path.resolve(BASE);
  const idx = JSON.parse(fs.readFileSync(path.join(b, 'index.json'), 'utf8'));
  let n = 0;
  for (const f of fs.readdirSync(b)) {
    if (!/^L\d_-?\d+_-?\d+\.bin$/.test(f) && f !== 'landmarks_l6.bin') continue;
    const dst = path.join(OUT, f);
    if (!fs.existsSync(dst)) { fs.symlinkSync(path.join(b, f), dst); n++; }
  }
  for (const C of Object.values(idx.chunks || {})) for (const e of Object.values(C)) delete e.bd;
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(idx));
  log(`base: ${n} chunk files linked from ${b}, index copied`);
}

// ------------------------------------------------------------------------------------------------ records
const R = readCTL(path.join(REC, 'buildings.ctl'));
const S_ = R.S;
const NB = R.header.count;
const B = new Array(NB);
{
  const xz = S_.xz, rs = S_.rs, rn = S_.rn, br = S_.br, bn = S_.bn;
  for (let k = 0; k < NB; k++) {
    const r0 = br[k], st = rs[r0], len = rn[r0];
    const ring = new Float64Array(len * 2);
    let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12, cx = 0, cz = 0, a2 = 0;
    for (let v = 0; v < len; v++) {
      const x = xz[(st + v) * 2], z = xz[(st + v) * 2 + 1];
      ring[v * 2] = x; ring[v * 2 + 1] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      cx += x; cz += z;
    }
    for (let v = 0, w = len - 1; v < len; w = v++) a2 += ring[w * 2] * ring[v * 2 + 1] - ring[v * 2] * ring[w * 2 + 1];
    const holes = [];
    for (let q = 1; q < bn[k]; q++) holes.push([rs[r0 + q], rn[r0 + q]]);
    const base = S_.base[k], minh = S_.minh[k], h = S_.h[k];
    B[k] = {
      ring, x0, z0, x1, z1, cx: cx / len, cz: cz / len, baseY: base + minh, h: Math.max(0.5, h - minh), top: base + h, ground: base,
      r: S_.col[k * 4], g: S_.col[k * 4 + 1], b: S_.col[k * 4 + 2], lit: S_.col[k * 4 + 3] / 255,
      rc: [S_.rcol[k * 4], S_.rcol[k * 4 + 1], S_.rcol[k * 4 + 2]], roofKind: S_.rcol[k * 4 + 3], rh: S_.rh[k],
      style: S_.sty[k], flags: 0, lm: 0, cv: S_.seed[k], area: Math.abs(a2) / 2, floorH: S_.fh[k], src: S_.src[k], holes, tile: 'bd', ti: k,
    };
  }
}
log(`records: ${NB} buildings (${JSON.stringify(R.header.heights)})`);
const K = makeShellKit({ B, LEVELS, keyOf: (b) => `bd:${b.ti}` });
// buckets of 1,024 m by bbox
const BK = 1024;
const bucket = new Map();
// (the records' `dry` flag, buildings.py: a footprint off the land (ships and barges at anchor the Microsoft set traced) is
// not drawn; records without it draw every building)
const DRY = S_.dry || null;
if (DRY) log(`records: ${NB - DRY.reduce((n, v) => n + v, 0)} buildings off the land left out`);
for (let k = 0; k < NB; k++) {
  if (DRY && !DRY[k]) continue;
  const b = B[k];
  for (let j = Math.floor(b.z0 / BK); j <= Math.floor(b.z1 / BK); j++) for (let i = Math.floor(b.x0 / BK); i <= Math.floor(b.x1 / BK); i++) {
    const key = `${i}_${j}`;
    let a = bucket.get(key);
    if (!a) bucket.set(key, (a = []));
    a.push(k);
  }
}
// (BD40: every building within the AO margin of a chunk, the occluders of its vertices)
function nearChunk(lv, ci, cj) {
  const S = LEVELS[lv].size, M = K.AO_MARGIN, seen = new Set(), out = [];
  const p0 = Math.floor((ci * S - M) / BK), p1 = Math.floor(((ci + 1) * S + M) / BK), q0 = Math.floor((cj * S - M) / BK), q1 = Math.floor(((cj + 1) * S + M) / BK);
  for (let q = q0; q <= q1; q++) for (let p = p0; p <= p1; p++) for (const k of bucket.get(`${p}_${q}`) || []) { if (!seen.has(k)) { seen.add(k); out.push(k); } }
  return out;
}
function inChunk(lv, ci, cj) {
  const S = LEVELS[lv].size, m = S / BK, seen = new Set(), out = [];
  for (let q = 0; q < m; q++) for (let p = 0; p < m; p++) for (const k of bucket.get(`${ci * m + p}_${cj * m + q}`) || []) { if (!seen.has(k)) { seen.add(k); out.push(k); } }
  return out;
}

// ------------------------------------------------------------------------------------------------ a building on its own (L3, L4)
const clamp255 = K.clamp255;
const ROOF_UV = K.ROOF_UV;
// a face from 3-D points, wound so its normal points along `want` (three's front face: (b - a) x (c - a), counter-clockwise)
function face(m, pts, col, lit, want, uv = null) {
  const base = m.nv;
  for (let k = 0; k < pts.length; k++) { const [x, y, z] = pts[k]; m.v(x, y, z, col, lit, uv ? uv[k][0] : ROOF_UV[0], uv ? uv[k][1] : ROOF_UV[1]); }
  for (let k = 1; k + 1 < pts.length; k++) {
    const a = pts[0], b = pts[k], c = pts[k + 1];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) m.t(base, base + k, base + k + 1); else m.t(base, base + k + 1, base + k);
  }
}
function pitched(m, b, P, col, lit, rcol) {
  // the oriented box of the footprint: walls to the eaves, a gable (1) or hip (2, 3) roof to the top
  let ring = [];
  for (let k = 0; k < b.ring.length; k += 2) ring.push([b.ring[k], b.ring[k + 1]]);
  const o = TW.ringOBB(ring);
  if (o.w < 3 || o.h < 3 || b.area / (o.w * o.h) < 0.8) return false;
  const eave = b.top - b.rh, top = b.top;
  if (eave - b.ground < 2.2) return false;
  const c = Math.cos(o.ang), s = Math.sin(o.ang), [cx, cz] = o.center;
  const P2 = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
  const hw = o.w / 2, hh = o.h / 2;
  const rect = K.ccw([P2(-hw, -hh), P2(hw, -hh), P2(hw, hh), P2(-hw, hh)]);
  K.prismRing(m, rect, b.ground - 0.5, eave, col, lit, b.floorH, 3.0);
  const A = (lx, lz, y) => { const [x, z] = P2(lx, lz); return [x, y, z]; };
  const up = [0, 1, 0];
  const outN = (lx, lz) => { const [x, z] = P2(lx, lz); return [x - cx, 0, z - cz]; };
  if (b.roofKind === 1) {
    face(m, [A(-hw, -hh, eave), A(hw, -hh, eave), A(hw, 0, top), A(-hw, 0, top)], rcol, 0, [outN(0, -1)[0], 1, outN(0, -1)[2]]);
    face(m, [A(-hw, hh, eave), A(hw, hh, eave), A(hw, 0, top), A(-hw, 0, top)], rcol, 0, [outN(0, 1)[0], 1, outN(0, 1)[2]]);
    face(m, [A(-hw, -hh, eave), A(-hw, hh, eave), A(-hw, 0, top)], col, 0, outN(-1, 0));
    face(m, [A(hw, -hh, eave), A(hw, hh, eave), A(hw, 0, top)], col, 0, outN(1, 0));
  } else {
    const rl = Math.max(0, hw - hh);
    face(m, [A(-hw, -hh, eave), A(hw, -hh, eave), A(rl, 0, top), A(-rl, 0, top)], rcol, 0, [outN(0, -1)[0], 1, outN(0, -1)[2]]);
    face(m, [A(-hw, hh, eave), A(hw, hh, eave), A(rl, 0, top), A(-rl, 0, top)], rcol, 0, [outN(0, 1)[0], 1, outN(0, 1)[2]]);
    face(m, [A(-hw, -hh, eave), A(-hw, hh, eave), A(-rl, 0, top)], rcol, 0, [outN(-1, 0)[0], 1, outN(-1, 0)[2]]);
    face(m, [A(hw, -hh, eave), A(hw, hh, eave), A(rl, 0, top)], rcol, 0, [outN(1, 0)[0], 1, outN(1, 0)[2]]);
  }
  void up;
  return true;
}
function single(m, b, bi, P) {
  m.key(bi);
  const col = [b.r, b.g, b.b], lit = clamp255(b.lit * 255);
  if (b.roofKind && b.rh > 0.8 && pitched(m, b, P, col, lit, b.rc)) return 1;
  let ring = [];
  for (let k = 0; k < b.ring.length; k += 2) ring.push([b.ring[k], b.ring[k + 1]]);
  ring = K.ccw(K.dpRing(K.ccw(ring), P.tol));
  if (ring.length < 3 || Math.abs(K.shoelace(ring)) < P.minA) return 0;
  const yb = b.src === 1 && b.baseY > b.ground + 0.5 ? b.baseY : b.ground - 0.5;
  const yt = b.roofKind ? b.top - b.rh * 0.5 : b.top;
  K.prismRing(m, ring, yb, yt, col, lit, b.floorH, 3.0);
  // courtyards: walls facing in, the roof around them
  const holes = [];
  for (const [st, len] of b.holes) {
    let h = [];
    for (let v = 0; v < len; v++) h.push([S_.xz[(st + v) * 2], S_.xz[(st + v) * 2 + 1]]);
    h = K.ccw(h);
    if (Math.abs(K.shoelace(h)) < P.holeA) continue;
    const hs = K.dpRing(h, P.tol);
    if (hs.length < 3) continue;
    K.prismRing(m, hs.slice().reverse(), yb, yt, col, lit, b.floorH, 3.0);
    holes.push(hs.slice().reverse());
  }
  const rc = b.roofKind ? b.rc : K.roofColour(col);
  K.roof(m, ring, holes, yt, rc, 0);
  return 1;
}

// ------------------------------------------------------------------------------------------------ landmarks
// The backdrop's towers over LM_H as landmark entries (tile-system.md section 5: never merged into chunks, never
// evicted): a tower and the parts beside it (within LM_JOIN m) are one entry, drawn by its own silhouette (the far city's
// tower at L3's error, at most about 2,000 triangles) from <out>/landmarks_bd.bin and listed in <out>/landmarks_bd.json
// (the format of client/public/data/landmarks.json and lod16/landmarks_l6.bin: pos Int16 x3 at 1/8 m about each
// entry's origin, col, uv, idx relative to the entry's first vertex); the chunks leave those buildings out.
const LM_H = Number(opt('lmh', '120')), LM_JOIN = 45;
const lmOf = new Int32Array(NB).fill(-1);
const LMS = [];
{
  const tall = [];
  for (let k = 0; k < NB; k++) if (B[k].top - B[k].ground >= LM_H && (!DRY || DRY[k])) tall.push(k);
  tall.sort((a, b) => (B[b].top - B[b].ground) - (B[a].top - B[a].ground));
  for (const k of tall) {
    if (lmOf[k] >= 0) continue;
    const id = LMS.length, b0 = B[k];
    const members = [];
    // the tower's parts and the buildings it stands on or beside: every building whose centroid lies within LM_JOIN m and
    // that rises above a third of the tower (a podium joins; a neighbouring house does not)
    for (const j of inChunk(3, Math.floor(b0.cx / 1024), Math.floor(b0.cz / 1024))) {
      const bj = B[j];
      if (lmOf[j] >= 0 || Math.hypot(bj.cx - b0.cx, bj.cz - b0.cz) > LM_JOIN) continue;
      if (bj.top - bj.ground < (b0.top - b0.ground) / 3) continue;
      lmOf[j] = id; members.push(j);
    }
    LMS.push({ id, members, top: b0.top, cx: b0.cx, cz: b0.cz });
  }
}
function writeLandmarks() {
  const out = [];
  const P = [], Cc = [], U = [], I = [];
  let nv = 0;
  const NAMES = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(REC, 'buildings.json'), 'utf8')); return j.tallest || []; } catch { return []; } })();
  for (const L of LMS) {
    const ox = L.cx, oz = L.cz;
    let m = new K.Mesh(ox, oz);
    for (const j of L.members) K.tower(m, B[j], LEVELS[3], j);
    if (m.tris > 2000) { m = new K.Mesh(ox, oz); for (const j of L.members) K.tower(m, B[j], LEVELS[4], j); }
    const v0 = nv, i0 = I.length;
    // positions from the kit's 1/4 m units about (ox, oz) to the registry's 1/8 m
    for (let q = 0; q < m.p.length; q += 3) P.push(m.p[q] * 2, m.p[q + 1] * 2, m.p[q + 2] * 2);
    for (const c of m.c) Cc.push(c);
    for (const u of m.u) U.push(u);
    for (const ix of m.i) I.push(ix);
    nv += m.nv;
    const nm = NAMES.find((t) => Math.hypot(t.x - ox, t.z - oz) < 30 && t.name);
    let rad = 0;
    for (const j of L.members) for (let q = 0; q < B[j].ring.length; q += 2) rad = Math.max(rad, Math.hypot(B[j].ring[q] - ox, B[j].ring[q + 1] - oz));
    out.push({ key: `bd_${Math.round(ox)}_${Math.round(oz)}`, name: nm ? nm.name : null, kind: 'tower', backdrop: true, bkeys: L.members.map((j) => `bd:${j}`),
      priority: 3, night: null, center: [+ox.toFixed(1), +((B[L.members[0]].ground + L.top) / 2).toFixed(1), +oz.toFixed(1)], radius: +rad.toFixed(1), top: +L.top.toFixed(1),
      l6: { origin: [+ox.toFixed(2), 0, +oz.toFixed(2)], v0, nv: m.nv, i0, ni: m.i.length, tris: m.tris, from: m.tris, how: 'kit tower at L3', err: LEVELS[3].err } });
  }
  writeTile(path.join(OUT, 'landmarks_bd.bin'), { v: 1, kind: 'backdrop.landmarks', scale: 0.125, count: out.length },
    [{ name: 'pos', array: Int16Array.from(P) }, { name: 'col', array: Uint8Array.from(Cc) }, { name: 'uv', array: Float32Array.from(U) }, { name: 'idx', array: Uint32Array.from(I) }]);
  fs.writeFileSync(path.join(OUT, 'landmarks_bd.json'), JSON.stringify({ v: 1, built: new Date().toISOString(), file: `${path.basename(OUT)}/landmarks_bd.bin`, levels: 1, limitTris: 2000,
    note: 'The backdrop\'s landmark towers (tools/lod/build_backdrop.mjs): every tower over ' + LM_H + ' m outside the city with its parts, from our records and the far city\'s tower generator.', landmarks: out }, null, 1));
  log(`landmarks: ${out.length} towers over ${LM_H} m -> landmarks_bd.json, ${I.length / 3} triangles`);
  return out.length;
}
log(`landmarks: ${LMS.length} entries over ${LM_H} m (${LMS.reduce((a, L) => a + L.members.length, 0)} buildings left out of the chunks)`);

// ------------------------------------------------------------------------------------------------ chunks
let plan = JSON.parse(fs.readFileSync(path.join(GROUND, 'plan.json'), 'utf8'));
const jobs = [];
for (const lv of WANT) for (const [ci, cj] of plan[lv] || []) jobs.push([lv, ci, cj]);
let mine = MERGE ? [] : jobs;
if (ONLY) mine = jobs.filter(([lv, ci, cj]) => ONLY.split(',').includes(`L${lv}_${ci}_${cj}`));
if (PART) { const [k, n] = PART.split('/').map(Number); mine = mine.filter((_, q) => q % n === k); }
const results = [];
for (const [lv, ci, cj] of mine) {
  const P = LEVELS[lv], S = P.size;
  const ox = ci * S + S / 2, oz = cj * S + S / 2;
  const m = new K.Mesh(ox, oz);
  const ids = inChunk(lv, ci, cj);
  let nb = 0, ntw = 0;
  const owned = (b) => Math.floor(b.cx / S) === ci && Math.floor(b.cz / S) === cj;
  if (lv <= 4) {
    for (const bi of ids) {
      const b = B[bi];
      if (!owned(b) || lmOf[bi] >= 0) continue;   // (a landmark's buildings: drawn by the registry)
      if (b.top - b.ground > P.towerH && b.area > 150 && !b.roofKind) { K.tower(m, b, P, bi); ntw++; nb++; continue; }
      nb += single(m, b, bi, P);
    }
  } else {
    const sh = [];
    for (const bi of ids) {
      const b = B[bi];
      if (lmOf[bi] >= 0) continue;   // (a landmark's buildings: drawn by the registry)
      if (b.top - b.ground > P.towerH && b.area > 150) { if (owned(b)) { K.tower(m, b, P, bi); ntw++; } continue; }
      if (b.h < 2.0) continue;
      if (b.top - b.ground < P.smallH && b.area < P.smallA) continue;
      sh.push(bi);
    }
    const shellTris0 = m.tris;
    const st = sh.length ? K.shells(lv, ci, cj, sh, m) : { regions: 0 };
    nb = sh.length + ntw;
    void shellTris0; void st;
  }
  // the ground
  const gf = path.join(GROUND, `L${lv}_${ci}_${cj}.ctl`);
  const secs = [
    { name: 'pos', array: Int16Array.from(m.p) }, { name: 'col', array: Uint8Array.from(m.c) }, { name: 'uv', array: Float32Array.from(m.u) },
    { name: 'idx', array: Uint32Array.from(m.i) }, { name: 'bk', array: Uint32Array.from(m.k) },
    { name: 'ao', array: K.aoPass(m, nearChunk(lv, ci, cj), S) },   // BD40: each vertex's open-sky share
  ];
  let gtris = 0, y0 = m.y0, y1 = m.y1;
  if (fs.existsSync(gf)) {
    const G = readCTL(gf);
    for (const nm of ['tpos', 'tuv', 'tnrm', 'tidx', 'tsh', 'ttex', 'tnit']) if (G.S[nm]) secs.push({ name: nm, array: G.S[nm].slice() });
    gtris = G.header.tris;
    y0 = Math.min(y0, G.header.y0); y1 = Math.max(y1, G.header.y1);
  }
  if (!m.tris && !gtris) continue;
  const file = `BD${lv}_${ci}_${cj}.bin`;
  try { if (fs.lstatSync(path.join(OUT, file)).isSymbolicLink()) fs.unlinkSync(path.join(OUT, file)); } catch { /* never write through a link */ }
  writeTile(path.join(OUT, file), { v: 1, kind: 'backdrop', level: lv, ci, cj, origin: [ox, oz], scale: 1 / SCALE, err: P.err, buildings: nb, towers: ntw, gtris, bkeys: m.keys }, secs);
  const bytes = fs.statSync(path.join(OUT, file)).size;
  if (!(y0 < 1e8)) y0 = 0;
  if (!(y1 > -1e8)) y1 = 10;
  results.push({ level: lv, ci, cj, file, bytes, tris: m.tris, gtris, y0: +y0.toFixed(1), y1: +y1.toFixed(1), buildings: nb, towers: ntw });
  if (results.length % 25 === 0 || mine.length < 30) log(`L${lv} ${ci}_${cj}: ${nb} buildings (${ntw} towers), ${m.tris} tris, ground ${gtris}, ${(bytes / 1048576).toFixed(2)} MB`);
}
if (MERGE_PARTS) {
  writeLandmarks();
  mergeIndex(MERGE_PARTS.flat());
} else if (PART) {
  fs.writeFileSync(path.join(OUT, `bd_part${PART.split('/')[0]}.json`), JSON.stringify(results));
  log(`part ${PART}: ${results.length} chunks`);
} else { if (!ONLY) writeLandmarks(); mergeIndex(results); }
