// RG44 road gate: does the drawn road network make sense from above, or are roads tangled over each other?
//
//   node tools/pipeline/roadgate.mjs <tilesDir> [--json out.json] [--png dir] [--top 12] [--bbox x0,z0,x1,z1]
//        [--crossings 0] [--nodes 0] [--overlap 40] [--at x,z;x,z (draw these points' squares)]
//
// It reads the written tiles only (the road records and their vertices, and for the pictures the ground sections) and
// joins every road to its CSCL segment (the record's segId, data/raw/streets_N.geojson: from_level_code / to_level_code,
// the levels LION carries, 13 = grade, 9 one below, 17 one above). Two kinds of tangle:
// - CROSSINGS: two roads whose centerlines cross in plan, away from both roads' ends (CSCL ends every segment at the
//   junction it meets, so a crossing between ends is never a junction), drawn within 2.5 m of each other's height there:
//   one road laid across another on the same ground. Where CSCL puts the two at different levels (a road in a cut under a
//   street, a ramp over one) the tangle is the compile's (FLATTENED); where it does not, the records' (SAME LEVEL).
// - OVERLAPS: metres along one road where another's carriageway overlaps its own by more than 0.5 m (2 m where the two
//   run parallel: twin carriageways edge to edge read as one divided road), at a height within 1.5 m, farther than the two half widths and 3 m from both roads' ends: a ribbon drawn over another, as a ramp laid on
//   a street or two copies of one street.
// - STRAY MARKS: kerb triangles 0.6 m or more inside a carriageway, paint triangles inside the carriageways of two different roads at once,
//   away from both roads' ends (junction zones hold several legitimately): kerbs and centre lines run across lanes.
// - FLATTENED NODES: a road's end on another road (its end or its run) where CSCL puts the two at different levels at
//   that point, drawn within 2.5 m of each other's height: a ramp in a cut meeting the street it passes under, as a junction.
// Paths (class 5) and roads that are not drawn are left out. Findings are clustered in 128 m squares, ranked by
// crossings x 30 + overlap metres; --png draws the top squares from above (asphalt, walks, paint, grass, the roads'
// centerlines by height: blue below grade, red above, black at it; magenta rings on the findings).
// The set fails (exit code 1) above --crossings crossings (0) or --overlap metres of overlap in any square (40).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseTile } from '../../src/world/tiledata.js';
import { unproject, project } from '../../src/shared/geo.js';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = path.join(CLIENT, 'data', 'raw');
const TILE = 512, CELL = 32, SQ = 128;

const args = process.argv.slice(2);
const tdir = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const jsonOut = opt('--json', null), pngDir = opt('--png', null), TOP = +opt('--top', 12);
const MAX_X = +opt('--crossings', 0), MAX_N = +opt('--nodes', 0), MAX_OV = +opt('--overlap', 40);
const atPts = opt('--at', null) ? opt('--at').split(';').map((p) => p.split(',').map(Number)) : null;   // --at x,z;x,z: draw these squares
const bbox = opt('--bbox', null) ? opt('--bbox').split(',').map(Number) : null;
if (!tdir) { console.error('usage: roadgate.mjs <tilesDir> [--json f] [--png dir] [--top n] [--bbox x0,z0,x1,z1]'); process.exit(2); }

// ---- CSCL levels by segment id
const lv = new Map();
for (let b = 1; b <= 5; b++) {
  const f = path.join(RAW, `streets_${b}.geojson`);
  if (!fs.existsSync(f)) continue;
  for (const ft of JSON.parse(fs.readFileSync(f, 'utf8')).features) {
    const p = ft.properties, id = parseInt(p.physicalid || p.objectid) || 0;
    if (!id || lv.has(id) || !ft.geometry) continue;
    const g = ft.geometry, lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    const a = lines[0][0], b = lines[lines.length - 1][lines[lines.length - 1].length - 1];
    lv.set(id, [parseInt(p.from_level_code) || 13, parseInt(p.to_level_code) || 13, p.full_street_name || '', p.rw_type, project(a[0], a[1]), project(b[0], b[1])]);
  }
}

// ---- the roads
const man = JSON.parse(fs.readFileSync(path.join(tdir, 'manifest.json'), 'utf8'));
const roads = [];
const tileKeys = Object.keys(man.tiles).filter((k) => {
  if (!bbox) return true;
  const [tx, tz] = k.split('_').map(Number);
  return tx * TILE < bbox[2] + 64 && (tx + 1) * TILE > bbox[0] - 64 && tz * TILE < bbox[3] + 64 && (tz + 1) * TILE > bbox[1] - 64;
});
const readTile = (k) => {
  const b = fs.readFileSync(path.join(tdir, man.tiles[k].f));
  return parseTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
for (const k of tileKeys) {
  const t = readTile(k), meta = t.S.roads, V = t.S.roadVerts;
  if (!meta || !V) continue;
  const [ox, oz] = t.header.origin, names = t.header.names || [];
  const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  for (let i = 0; i < meta.byteLength / 24; i++) {
    const o = i * 24, start = dv.getUint32(o, true), len = dv.getUint16(o + 4, true), rc = dv.getUint8(o + 6) & 0x7f;
    if (rc === 5 || len < 2) continue;
    const P = [];
    for (let j = 0; j < len; j++) P.push([V[(start + j) * 3] + ox, V[(start + j) * 3 + 1], V[(start + j) * 3 + 2] + oz]);
    roads.push({ id: roads.length, tile: k, rc, w: dv.getFloat32(o + 8, true), level: dv.getUint8(o + 14), name: names[dv.getUint16(o + 16, true)] || '?', seg: dv.getUint32(o + 20, true), P });
  }
}

// ---- segment grid
const grid = new Map();
const key = (cx, cz) => cx + ',' + cz;
for (const r of roads) for (let i = 1; i < r.P.length; i++) {
  const a = r.P[i - 1], b = r.P[i];
  const pad = r.w / 2 + 1;
  for (let cx = Math.floor((Math.min(a[0], b[0]) - pad) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + pad) / CELL); cx++)
    for (let cz = Math.floor((Math.min(a[2], b[2]) - pad) / CELL); cz <= Math.floor((Math.max(a[2], b[2]) + pad) / CELL); cz++) {
      const kk = key(cx, cz); let L = grid.get(kk); if (!L) grid.set(kk, (L = [])); L.push([r.id, i]);
    }
}
const distSeg = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz || 1;
  const s = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2));
  return [Math.hypot(x - a[0] - dx * s, z - a[2] - dz * s), a[1] + (b[1] - a[1]) * s];
};
const ends = (r) => [r.P[0], r.P[r.P.length - 1]];
const distEnds = (r, x, z) => Math.min(...ends(r).map((e) => Math.hypot(e[0] - x, e[2] - z)));
// shared endpoints: two records of one road split at a tile edge, or legs of one junction
const touching = (A, B) => ends(A).some((e) => ends(B).some((f) => Math.hypot(e[0] - f[0], e[2] - f[2]) < 2.5));
const levels = (r) => lv.get(r.seg) || null;
const sepInSource = (A, B) => {
  const a = levels(A), b = levels(B);
  if (!a || !b) return false;
  const ma = Math.min(a[0], a[1]), xa = Math.max(a[0], a[1]), mb = Math.min(b[0], b[1]), xb = Math.max(b[0], b[1]);
  return xa < mb || xb < ma || (ma !== 13 || xa !== 13) !== (mb !== 13 || xb !== 13);
};

// the CSCL level at a point of a road: its from or to level at the matching end (within 4 m), else null
const levelAt = (r, x, z) => {
  const L = levels(r);
  if (!L) return null;
  const dA = Math.hypot(L[4][0] - x, L[4][1] - z), dB = Math.hypot(L[5][0] - x, L[5][1] - z);
  if (Math.min(dA, dB) > 4) return L[0] === L[1] ? L[0] : null;
  return dA < dB ? L[0] : L[1];
};

// ---- flattened nodes: a road's end on another road (its end or its run) where CSCL puts the two at different levels,
// drawn within 2.5 m of each other's height (a ramp in a cut meeting the street it passes under, drawn as a junction)
const flatNodes = [];
{
  const seenN = new Set();
  for (const A of roads) for (const e of ends(A)) {
    const la = levelAt(A, e[0], e[2]);
    if (la == null) continue;
    const L = grid.get(key(Math.floor(e[0] / CELL), Math.floor(e[2] / CELL)));
    if (!L) continue;
    for (const [ib, sb] of L) {
      if (ib === A.id) continue;
      const B = roads[ib];
      if (B.seg && B.seg === A.seg) continue;
      const [dd, yb] = distSeg(e[0], e[2], B.P[sb - 1], B.P[sb]);
      if (dd > 1.5 || Math.abs(yb - e[1]) > 2.5) continue;
      const lb = levelAt(B, e[0], e[2]);
      if (lb == null || lb === la) continue;
      const nk = Math.round(e[0]) + ':' + Math.round(e[2]) + ':' + Math.min(A.id, ib) + ':' + Math.max(A.id, ib);
      if (seenN.has(nk)) continue;
      seenN.add(nk);
      flatNodes.push({ kind: 'node', x: e[0], z: e[2], a: A.id, b: ib, la, lb, flattened: true });
    }
  }
}

// ---- crossings
const findings = [];
const seenPair = new Set();
for (const [, L] of grid) for (let p = 0; p < L.length; p++) for (let q = p + 1; q < L.length; q++) {
  const [ia, sa] = L[p], [ib, sb] = L[q];
  if (ia === ib) continue;
  const A = roads[ia], B = roads[ib];
  if (A.seg && A.seg === B.seg) continue;
  const a0 = A.P[sa - 1], a1 = A.P[sa], b0 = B.P[sb - 1], b1 = B.P[sb];
  const d = (a1[0] - a0[0]) * (b1[2] - b0[2]) - (a1[2] - a0[2]) * (b1[0] - b0[0]);
  if (Math.abs(d) < 1e-9) continue;
  const t = ((b0[0] - a0[0]) * (b1[2] - b0[2]) - (b0[2] - a0[2]) * (b1[0] - b0[0])) / d;
  const u = ((b0[0] - a0[0]) * (a1[2] - a0[2]) - (b0[2] - a0[2]) * (a1[0] - a0[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) continue;
  const x = a0[0] + (a1[0] - a0[0]) * t, z = a0[2] + (a1[2] - a0[2]) * t;
  const ya = a0[1] + (a1[1] - a0[1]) * t, yb = b0[1] + (b1[1] - b0[1]) * u;
  if (Math.abs(ya - yb) > 2.5) continue;
  if (distEnds(A, x, z) < A.w / 2 + B.w / 2 + 2 || distEnds(B, x, z) < A.w / 2 + B.w / 2 + 2) continue;
  const pk = Math.min(ia, ib) + ':' + Math.max(ia, ib) + ':' + Math.round(x) + ':' + Math.round(z);
  if (seenPair.has(pk)) continue;
  seenPair.add(pk);
  findings.push({ kind: 'crossing', x, z, y: ya, a: A.id, b: B.id, flattened: sepInSource(A, B) });
}

// ---- overlaps (sampled every 2 m along each centerline)
const ovPair = new Map();
for (const A of roads) {
  if (A.rc === 5) continue;
  for (let i = 1; i < A.P.length; i++) {
    const a = A.P[i - 1], b = A.P[i], l = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.round(l / 2));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n, x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f, y = a[1] + (b[1] - a[1]) * f;
      const L = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!L) continue;
      const hit = new Set();
      for (const [ib, sb] of L) {
        if (ib === A.id || hit.has(ib)) continue;
        const B = roads[ib];
        if (B.seg && B.seg === A.seg) continue;
        const [dd, yb] = distSeg(x, z, B.P[sb - 1], B.P[sb]);
        if (dd > (A.w + B.w) / 2 - 0.5 || Math.abs(yb - y) > 1.5) continue;
        // twin carriageways: parallel ribbons overlapping by under 2 m read as one divided road, not a tangle
        const bx = B.P[sb][0] - B.P[sb - 1][0], bz = B.P[sb][2] - B.P[sb - 1][2], ax = b[0] - a[0], az = b[2] - a[2];
        const sin = Math.abs(ax * bz - az * bx) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
        if (sin < 0.26 && dd > (A.w + B.w) / 2 - 2) continue;
        const clear = A.w / 2 + B.w / 2 + 3;
        if (distEnds(A, x, z) < clear || distEnds(B, x, z) < clear) continue;
        if (touching(A, B) && (distEnds(A, x, z) < clear + 6 || distEnds(B, x, z) < clear + 6)) continue;
        hit.add(ib);
        const pk = Math.min(A.id, ib) + ':' + Math.max(A.id, ib);
        let o = ovPair.get(pk);
        if (!o) ovPair.set(pk, (o = { m: 0, x: 0, z: 0, n: 0, a: A.id, b: ib }));
        o.m += l / n; o.x += x; o.z += z; o.n++;
      }
    }
  }
}
for (const o of ovPair.values()) {
  const m = o.m / 2;   // each pair is seen from both roads when both lie inside the other
  if (m < 4) continue;
  findings.push({ kind: 'overlap', x: o.x / o.n, z: o.z / o.n, m: +m.toFixed(1), a: o.a, b: o.b, flattened: sepInSource(roads[o.a], roads[o.b]) });
}

findings.push(...flatNodes);
// ---- stray marks: kerb pieces standing 0.6 m or more inside a carriageway (a record's centreline can sit ~0.4 m off its
// drawn ribbon), paint inside two carriageways at once (both
// away from the roads' ends: junction boxes legitimately hold several), at the carriageways' height
const inside = (x, z, y, inset) => {
  const L = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  const hit = new Set();
  if (!L) return hit;
  for (const [ib, sb] of L) {
    if (hit.has(ib)) continue;
    const B = roads[ib], [dd, yb] = distSeg(x, z, B.P[sb - 1], B.P[sb]);
    if (dd > B.w / 2 - inset || Math.abs(yb - y) > 0.6) continue;
    if (distEnds(B, x, z) < B.w / 2 + 12) return new Set([-1]);   // a junction's zone: not counted
    hit.add(ib);
  }
  return hit;
};
const stray = [];
for (const k of tileKeys) {
  const t = readTile(k), [ox, oz] = t.header.origin;
  for (const [name, need, inset] of [['curb', 1, 0.6], ['paintY', 2, 0.3], ['paintW', 2, 0.3]]) {
    const A = t.S[name]; if (!A) continue;
    for (let i = 0; i + 8 < A.length; i += 9) {
      const x = (A[i] + A[i + 3] + A[i + 6]) / 3 + ox, y = Math.min(A[i + 1], A[i + 4], A[i + 7]), z = (A[i + 2] + A[i + 5] + A[i + 8]) / 3 + oz;
      const h = inside(x, z, y, inset);
      if (h.has(-1) || h.size < need) continue;
      if (need === 2 && new Set([...h].map((i) => roads[i].name)).size < 2) continue;   // (one road's twin carriageways: parallel lines)
      const ar = Math.abs((A[i + 3] - A[i]) * (A[i + 8] - A[i + 2]) - (A[i + 6] - A[i]) * (A[i + 5] - A[i + 2])) / 2;
      if (name === 'curb' && ar < 1e-3) continue;   // (a kerb's vertical face: its top is counted)
      stray.push({ kind: 'stray', x, z, m: 0, mark: name, a: [...h][0], b: [...h][h.size - 1], flattened: false });
    }
  }
}
findings.push(...stray);
// ---- squares
const sq = new Map();
for (const f of findings) {
  const k = Math.floor(f.x / SQ) + '_' + Math.floor(f.z / SQ);
  let s = sq.get(k);
  if (!s) sq.set(k, (s = { k, x: (Math.floor(f.x / SQ) + 0.5) * SQ, z: (Math.floor(f.z / SQ) + 0.5) * SQ, crossings: 0, nodes: 0, stray: 0, flattened: 0, overlap: 0, roads: new Set(), f: [] }));
  if (f.kind === 'crossing') s.crossings++; else if (f.kind === 'node') s.nodes++; else if (f.kind === 'stray') s.stray++; else s.overlap += f.m;
  if (f.flattened) s.flattened++;
  s.roads.add(roads[f.a].name); s.roads.add(roads[f.b].name);
  s.f.push(f);
}
const ranked = [...sq.values()].map((s) => ({ ...s, score: s.crossings * 30 + s.nodes * 20 + s.stray * 0.5 + s.overlap })).sort((a, b) => b.score - a.score);
const nN = flatNodes.length, nX = findings.filter((f) => f.kind === 'crossing').length, nXf = findings.filter((f) => f.kind === 'crossing' && f.flattened).length;
const ovTot = findings.filter((f) => f.kind === 'overlap').reduce((s, f) => s + f.m, 0);
const failSq = ranked.filter((s) => s.overlap > MAX_OV);
console.log(`roads ${roads.length} in ${tileKeys.length} tiles | crossings ${nX} (${nXf} grade-separated in CSCL, drawn on one level) | flattened nodes ${nN} | stray kerb/paint triangles ${stray.length} (kerb ${stray.filter((f) => f.mark === 'curb').length}) | overlaps ${findings.filter((f) => f.kind === 'overlap').length} pairs, ${ovTot.toFixed(0)} m | squares with findings ${ranked.length}, over ${MAX_OV} m of overlap ${failSq.length}`);
for (const s of ranked.slice(0, TOP)) {
  const [lon, lat] = unproject(s.x, s.z);
  console.log(`  ${s.k.padEnd(9)} (${s.x.toFixed(0)},${s.z.toFixed(0)}) ${lat.toFixed(5)},${lon.toFixed(5)}  score ${s.score.toFixed(0).padStart(5)}  crossings ${s.crossings}  flattened nodes ${s.nodes}  stray ${s.stray}  overlap ${s.overlap.toFixed(0)} m  ${[...s.roads].slice(0, 5).join(' / ')}`);
}

if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({
  tiles: tileKeys.length, roads: roads.length, flattenedNodes: nN, stray: stray.length, crossings: nX, crossingsFlattened: nXf, overlapM: +ovTot.toFixed(1),
  squares: ranked.map((s) => ({ k: s.k, x: s.x, z: s.z, score: +s.score.toFixed(1), crossings: s.crossings, nodes: s.nodes, stray: s.stray, flattened: s.flattened, overlap: +s.overlap.toFixed(1), roads: [...s.roads],
    findings: s.f.map((f) => ({ kind: f.kind, x: +f.x.toFixed(1), z: +f.z.toFixed(1), m: f.m, la: f.la, lb: f.lb, flattened: f.flattened, a: roads[f.a].name, b: roads[f.b].name, segA: roads[f.a].seg, segB: roads[f.b].seg })) })),
}, null, 1));

// ---- pictures of the worst squares
if (pngDir) {
  fs.mkdirSync(pngDir, { recursive: true });
  const R = 1.0, HALF = 160, N = Math.round((2 * HALF) / R);
  const tileCache = new Map();
  const tileAt = (k) => { if (!tileCache.has(k)) tileCache.set(k, man.tiles[k] ? readTile(k) : null); return tileCache.get(k); };
  const COL = [['terrain', [196, 186, 160]], ['grass', [118, 150, 84]], ['sidewalk', [205, 203, 196]], ['curb', [160, 160, 160]], ['gutter', [120, 120, 120]],
    ['asphalt', [70, 72, 76]], ['busred', [150, 60, 50]], ['paintW', [245, 245, 245]], ['paintY', [230, 190, 40]], ['rwall', [140, 120, 100]], ['rtop', [90, 80, 70]]];
  const drawList = atPts ? atPts.map(([x, z]) => ({ k: `at_${Math.round(x)}_${Math.round(z)}`, x, z, f: findings.filter((f) => Math.abs(f.x - x) < 160 && Math.abs(f.z - z) < 160) })) : ranked.slice(0, TOP);
  for (const s of drawList) {
    const img = new Uint8Array(N * N * 3).fill(30);
    const X0 = s.x - HALF, Z0 = s.z - HALF;
    const put = (px, pz, c) => { if (px < 0 || pz < 0 || px >= N || pz >= N) return; const o = (pz * N + px) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
    const tri = (ax, az, bx, bz, cx, cz, c) => {
      const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minz = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxz = Math.min(N - 1, Math.ceil(Math.max(az, bz, cz)));
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) return;
      for (let pz = minz; pz <= maxz; pz++) for (let px = minx; px <= maxx; px++) {
        const x = px + 0.5, z = pz + 0.5, l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        if (l0 >= 0 && l1 >= 0 && l0 + l1 <= 1) put(px, pz, c);
      }
    };
    const ks = new Set();
    for (let tx = Math.floor(X0 / TILE); tx <= Math.floor((X0 + 2 * HALF) / TILE); tx++) for (let tz = Math.floor(Z0 / TILE); tz <= Math.floor((Z0 + 2 * HALF) / TILE); tz++) ks.add(tx + '_' + tz);
    for (const [name, c] of COL) for (const k of ks) {
      const t = tileAt(k); if (!t) continue;
      const [ox, oz] = t.header.origin;
      if (name === 'terrain') { // the drawn grid: the whole tile, less the cuts (not drawn here)
        tri((ox - X0) / R, (oz - Z0) / R, (ox + TILE - X0) / R, (oz - Z0) / R, (ox + TILE - X0) / R, (oz + TILE - Z0) / R, c);
        tri((ox - X0) / R, (oz - Z0) / R, (ox + TILE - X0) / R, (oz + TILE - Z0) / R, (ox - X0) / R, (oz + TILE - Z0) / R, c);
        continue;
      }
      const A = t.S[name]; if (!A) continue;
      for (let i = 0; i + 8 < A.length; i += 9) tri((A[i] + ox - X0) / R, (A[i + 2] + oz - Z0) / R, (A[i + 3] + ox - X0) / R, (A[i + 5] + oz - Z0) / R, (A[i + 6] + ox - X0) / R, (A[i + 8] + oz - Z0) / R, c);
    }
    // centerlines by height, then the findings
    for (const r of roads) for (let i = 1; i < r.P.length; i++) {
      const a = r.P[i - 1], b = r.P[i], l = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.ceil(l / (R * 0.5));
      for (let k = 0; k <= n; k++) {
        const f = k / n, y = a[1] + (b[1] - a[1]) * f - 3.6;
        const c = y < -1 ? [40, 110, 255] : y > 1.5 ? [235, 50, 40] : [0, 0, 0];
        put(Math.floor((a[0] + (b[0] - a[0]) * f - X0) / R), Math.floor((a[2] + (b[2] - a[2]) * f - Z0) / R), c);
      }
    }
    for (const f of s.f) if (f.kind !== 'stray') for (let k = 0; k < 64; k++) {
      const an = (k / 64) * Math.PI * 2;
      for (const rr of [5, 6]) put(Math.floor((f.x - X0) / R + Math.cos(an) * rr), Math.floor((f.z - Z0) / R + Math.sin(an) * rr), [255, 0, 220]);
    }
    fs.writeFileSync(path.join(pngDir, `rg_${s.k}.png`), png(N, N, img));
  }
}
process.exit(nX > MAX_X || nN > MAX_N || failSq.length ? 1 : 0);

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
