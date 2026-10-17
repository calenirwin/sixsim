// The far city's geometry kit (docs/notes/tile-system.md section 4; R5.2): the block shells and tower silhouettes of
// tools/lod/build_persistent.mjs as a module, so the persistent tier's builder and the backdrop's builder
// (tools/lod/build_backdrop.mjs) draw buildings with the same generator, the same seeds and the same vertex format.
//
//   const K = makeShellKit({ B, LEVELS })   B: building records ({ ring Float64Array [x, z...], x0, z0, x1, z1, cx, cz,
//                                           baseY, h, r, g, b, style, flags, lit, lm, cv, area, roofKind, floorH, ... });
//                                           LEVELS: { <level>: { size, cell, band, tol, towerH, err, mastW } }
//   K.shells(lv, ci, cj, ids, mesh)         merged block shells of the buildings `ids` over chunk (ci, cj) of level lv
//   K.tower(mesh, b, LEVELS[lv], bi)        one tower's silhouette (setback tiers, crown, pylon, mast)
//   K.Mesh, K.wall, K.roof, K.prismRing ... the vertex format and the primitives
//   K.aoPass(mesh, ids, size)               BD40: each vertex's open-sky share (Uint8) from the building tops round the chunk
// Vertex format: position Int16 x3 (x, z about the mesh origin, y absolute; 1/SCALE m), colour Uint8 x4 (sRGB albedo,
// alpha the lit share), uv Float32 x2 (the FW14 window grid), index Uint32, bk Uint32 (the building key's index).
import earcut from '../../client/node_modules/earcut/src/earcut.js';
import { crownKind, _internal as TW } from '../../client/src/world/towers.js';
import { BF } from '../../client/src/shared/geo.js';

export const hash1 = (x) => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };   // world/towers.js

export function makeShellKit({ B, LEVELS, N = 1024, SCALE = 4, keyOf = (b) => `${b.tile}:${b.ti}` }) {
  // ------------------------------------------------------------------------------------------------ output buffers
  // every vertex carries the chunk-local index of its building key (`<tile>:<index in the tile>`, the client's record):
  // the tower's own, or a merged region's largest building (the label of a block shell); `cur` is set before each emit
  const NO_KEY = 0xffffffff;
  class Mesh {
    constructor(ox, oz) { this.ox = ox; this.oz = oz; this.p = []; this.c = []; this.u = []; this.i = []; this.k = []; this.nv = 0; this.y0 = 1e9; this.y1 = -1e9; this.keys = []; this.keyOf = new Map(); this.cur = NO_KEY; }
    key(bi) {
      if (bi === undefined || bi < 0) { this.cur = NO_KEY; return; }
      let k = this.keyOf.get(bi);
      if (k === undefined) { k = this.keys.length; this.keys.push(keyOf(B[bi])); this.keyOf.set(bi, k); }
      this.cur = k;
    }
    v(x, y, z, col, a, u, w) {
      this.p.push(Math.round((x - this.ox) * SCALE), Math.round(y * SCALE), Math.round((z - this.oz) * SCALE));
      this.c.push(col[0], col[1], col[2], a);
      this.u.push(u, w);
      this.k.push(this.cur);
      if (y < this.y0) this.y0 = y; if (y > this.y1) this.y1 = y;
      return this.nv++;
    }
    t(a, b, c) { this.i.push(a, b, c); }
    get tris() { return this.i.length / 3; }
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const ROOF_UV = [0.06, 0.24];
  // wall quad A -> B (the solid on the LEFT of A->B in (x, z), i.e. a shoelace-positive ring): outward faces are
  // (A_bot, A_top, B_top), (A_bot, B_top, B_bot) -- the compiler's far LoD convention
  function wall(m, ax, az, bx, bz, yb, yt, col, lit, fh = 3.8, bay = 3.0) {
    const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
    if (L < 1e-3 || yt - yb < 0.05) return;
    // FW14 window grid: along the wall from the world origin, the tangent of the outward normal (ez, -ex); a tile is 4 bays
    // by 4 floors (the far city's 3 m bays and 3.8 m floors unless the building has its own)
    const uD = bay === 3.0 ? 12.0 : 4 * bay, vD = fh === 3.8 ? 15.2 : 4 * fh;
    const nx = ez / L, nz = -ex / L, tx = -nz, tz = nx;
    const ua = (ax * tx + az * tz) / uD, ub = (bx * tx + bz * tz) / uD;
    // (BD40: a wall over 48 m is split 32 m up, so the canyon's occlusion at its foot, per vertex, stays down there)
    const ys = yt - yb > 48 ? [yb, yb + 32, yt] : [yb, yt];
    for (let q = 0; q + 1 < ys.length; q++) {
      const y0 = ys[q], y1 = ys[q + 1];
      const a0 = m.v(ax, y0, az, col, lit, ua, y0 / vD), a1 = m.v(ax, y1, az, col, lit, ua, y1 / vD);
      const b1 = m.v(bx, y1, bz, col, lit, ub, y1 / vD), b0 = m.v(bx, y0, bz, col, lit, ub, y0 / vD);
      m.t(a0, a1, b1); m.t(a0, b1, b0);
    }
  }
  // roof over a shoelace-positive outer ring and its holes, faces up
  function roof(m, outer, holes, y, col, lit) {
    const flat = [], hi = [];
    for (const [x, z] of outer) flat.push(x, z);
    for (const h of holes) { hi.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
    if (flat.length < 6) return;
    const tri = earcut(flat, hi.length ? hi : null, 2);
    const base = m.nv;
    for (let k = 0; k < flat.length; k += 2) m.v(flat[k], y, flat[k + 1], col, lit, ROOF_UV[0], ROOF_UV[1]);
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      const ny = (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]) - (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]);
      if (Math.abs(ny) < 1e-6) continue;
      if (ny > 0) m.t(base + a, base + b, base + c); else m.t(base + a, base + c, base + b);
    }
  }
  function prismRing(m, ring, yb, yt, col, lit, fh, bay) {
    for (let i = 0; i < ring.length; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length]; wall(m, ax, az, bx, bz, yb, yt, col, lit, fh, bay); }
  }
  function boxRing(cx, cz, hw, hh, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, w]) => [cx + u * c - w * s, cz + u * s + w * c]);
  }
  const shoelace = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]; a += x1 * z2 - x2 * z1; } return a / 2; };
  const ccw = (r) => (shoelace(r) < 0 ? r.slice().reverse() : r);
  function dpOpen(pts, tol) {
    const n = pts.length;
    if (n <= 2) return pts.slice();
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [0, n - 1];
    while (st.length) {
      const b = st.pop(), a = st.pop();
      const [ax, az] = pts[a], [bx, bz] = pts[b];
      const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
      let md = -1, mi = -1;
      for (let k = a + 1; k < b; k++) {
        const d = L > 1e-9 ? Math.abs((pts[k][0] - ax) * ez - (pts[k][1] - az) * ex) / L : Math.hypot(pts[k][0] - ax, pts[k][1] - az);
        if (d > md) { md = d; mi = k; }
      }
      if (md > tol) { keep[mi] = 1; st.push(a, mi, mi, b); }
    }
    const out = [];
    for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
    return out;
  }
  // closed polyline whose first point == last point: split at the farthest point from the start
  function dpClosed(pts, tol) {
    let fi = 1, fd = -1;
    for (let k = 1; k < pts.length - 1; k++) { const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]); if (d > fd) { fd = d; fi = k; } }
    const a = dpOpen(pts.slice(0, fi + 1), tol), b = dpOpen(pts.slice(fi), tol);
    return a.concat(b.slice(1));
  }
  function dpRing(ring, tol) {   // a closed ring without the repeated point
    if (ring.length <= 4) return ring.slice();
    const s = dpClosed([...ring, ring[0]], tol);
    s.pop();
    return s.length >= 3 ? s : ring.slice();
  }

  // ------------------------------------------------------------------------------------------------ block shells
  const TOP = new Float32Array(N * N), BID = new Int32Array(N * N), LAB = new Int32Array(N * N), PAR = new Int32Array(N * N);
  const FIX = new Uint8Array((N + 1) * (N + 1));
  const HEAD = new Int32Array((N + 1) * (N + 1));
  function shells(lv, ci, cj, ids, m) {
    const P = LEVELS[lv], { size, cell, tol, err } = P;
    const x0 = ci * size, z0 = cj * size;
    TOP.fill(0); BID.fill(-1);
    // ---- raster: the tallest building's absolute roof per cell (cell centre inside the footprint)
    const xs = [];
    for (const bi of ids) {
      const b = B[bi];
      const top = b.baseY + b.h;
      const jA = Math.max(0, Math.ceil((b.z0 - z0) / cell - 0.5)), jB = Math.min(N - 1, Math.floor((b.z1 - z0) / cell - 0.5));
      const R = b.ring, n = R.length / 2;
      for (let j = jA; j <= jB; j++) {
        const zc = z0 + (j + 0.5) * cell;
        xs.length = 0;
        for (let e = 0, f = n - 1; e < n; f = e++) {
          const za = R[e * 2 + 1], zb = R[f * 2 + 1];
          if ((za > zc) !== (zb > zc)) xs.push(R[e * 2] + ((zc - za) / (zb - za)) * (R[f * 2] - R[e * 2]));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let s = 0; s + 1 < xs.length; s += 2) {
          const iA = Math.max(0, Math.ceil((xs[s] - x0) / cell - 0.5)), iB = Math.min(N - 1, Math.floor((xs[s + 1] - x0) / cell - 0.5));
          for (let i = iA; i <= iB; i++) { const c = j * N + i; if (top > TOP[c]) { TOP[c] = top; BID[c] = bi; } }
        }
      }
    }
    const NN = N * N;
    // ---- one-cell gaps between buildings (side yards, alleys under two cells; never a street, which spans two or more
    // cell centres at every level) close at the lower neighbour's roof, so detached rows read as the block they form
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      if (TOP[c] !== 0) continue;
      let t = 0, bb = -1;
      if (TOP[c - 1] > 0 && TOP[c + 1] > 0) { t = Math.min(TOP[c - 1], TOP[c + 1]); bb = TOP[c - 1] <= TOP[c + 1] ? BID[c - 1] : BID[c + 1]; }
      if (TOP[c - N] > 0 && TOP[c + N] > 0) { const t2 = Math.min(TOP[c - N], TOP[c + N]); if (t2 > t) { t = t2; bb = TOP[c - N] <= TOP[c + N] ? BID[c - N] : BID[c + N]; } }
      if (bb >= 0) { TOP[c] = -t; BID[c] = bb; }
    }
    for (let c = 0; c < NN; c++) if (TOP[c] < 0) TOP[c] = -TOP[c];
    // ---- outline smoothing under the error: a notch (open cell with five or more of its eight neighbours built) fills at
    // its lowest built neighbour's roof; a lone low bump (two or fewer built neighbours, under 15 m) goes
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      let nb = 0, lo = 1e9, lb = -1;
      for (const d of [c - N - 1, c - N, c - N + 1, c - 1, c + 1, c + N - 1, c + N, c + N + 1]) {
        const t = Math.abs(TOP[d]);
        if (t > 0) { nb++; if (t < lo) { lo = t; lb = BID[d]; } }
      }
      if (TOP[c] === 0 && nb >= 5) { TOP[c] = -lo; BID[c] = lb; }
      else if (TOP[c] > 0 && nb <= 2 && TOP[c] - B[BID[c]].baseY < 15) { TOP[c] = 0; BID[c] = -1; }
    }
    for (let c = 0; c < NN; c++) if (TOP[c] < 0) TOP[c] = -TOP[c];
    for (let c = 0; c < NN; c++) PAR[c] = c;
    const find = (c) => { while (PAR[c] !== c) { PAR[c] = PAR[PAR[c]]; c = PAR[c]; } return c; };
    const unite = (a, b2) => { a = find(a); b2 = find(b2); if (a !== b2) PAR[a] = b2; };
    // ---- small enclosed open ground (light wells, courts under the level's error) joins the block around it
    const fillMax = Math.max(2, Math.round((err * err * 4) / (cell * cell)));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i;
      if (TOP[c] > 0) continue;
      if (i > 0 && TOP[c - 1] === 0) unite(c, c - 1);
      if (j > 0 && TOP[c - N] === 0) unite(c, c - N);
    }
    {
      const size0 = new Map(), border = new Set();
      for (let c = 0; c < NN; c++) {
        if (TOP[c] > 0) continue;
        const r = find(c);
        size0.set(r, (size0.get(r) || 0) + 1);
        const i = c % N, j = (c / N) | 0;
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) border.add(r);
      }
      for (let c = 0; c < NN; c++) {
        if (TOP[c] > 0) continue;
        const r = find(c);
        if (border.has(r) || size0.get(r) > fillMax) continue;
        // the tallest building cell beside it lends its roof (a court is the block's own)
        let bt = 0, bb = -1;
        const i = c % N;
        for (const d of [c - 1, c + 1, c - N, c + N]) {
          if (d < 0 || d >= NN || (d === c - 1 && i === 0) || (d === c + 1 && i === N - 1)) continue;
          if (TOP[d] > bt && BID[d] >= 0) { bt = TOP[d]; bb = BID[d]; }
        }
        if (bb >= 0) { TOP[c] = -bt; BID[c] = bb; }   // negative: filled this pass (do not chain)
      }
      for (let c = 0; c < NN; c++) if (TOP[c] < 0) TOP[c] = -TOP[c];
    }
    // ---- initial regions: 4-connected cells of one roof height (to 0.5 m)
    for (let c = 0; c < NN; c++) PAR[c] = c;
    const Q = new Int32Array(NN);
    for (let c = 0; c < NN; c++) Q[c] = TOP[c] > 0 ? Math.round(TOP[c] * 2) : 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i, q = Q[c];
      if (!q) continue;
      if (i > 0 && Q[c - 1] === q) unite(c, c - 1);
      if (j > 0 && Q[c - N] === q) unite(c, c - N);
    }
    // region stats on the roots: area, roof sum, min, max
    const rA = new Float64Array(NN), rS = new Float64Array(NN), rMin = new Float32Array(NN), rMax = new Float32Array(NN);
    for (let c = 0; c < NN; c++) {
      if (!Q[c]) continue;
      const r = find(c), t = TOP[c];
      if (!rA[r]) { rMin[r] = t; rMax[r] = t; }
      rA[r]++; rS[r] += t;
      if (t < rMin[r]) rMin[r] = t; if (t > rMax[r]) rMax[r] = t;
    }
    // ---- merged block shells: agglomerate adjacent regions, closest roofs first, while every cell stays within the
    // level's error of the merged (area-weighted) roof
    const adj = new Map();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = j * N + i;
      if (!Q[c]) continue;
      const a = find(c);
      for (const d of [i + 1 < N ? c + 1 : -1, j + 1 < N ? c + N : -1]) {
        if (d < 0 || !Q[d]) continue;
        const b2 = find(d);
        if (a === b2) continue;
        const k = a < b2 ? a * NN + b2 : b2 * NN + a;
        adj.set(k, (adj.get(k) || 0) + 1);
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const E = [];
      for (const k of adj.keys()) {
        const a = find(Math.floor(k / NN)), b2 = find(k % NN);
        if (a === b2) continue;
        E.push([Math.abs(rS[a] / rA[a] - rS[b2] / rA[b2]), a, b2]);
      }
      if (!E.length) break;
      E.sort((p, q) => p[0] - q[0]);
      let merged = 0;
      for (const [, a0, b0] of E) {
        const a = find(a0), b2 = find(b0);
        if (a === b2) continue;
        const A = rA[a] + rA[b2], S = rS[a] + rS[b2], mean = S / A;
        const mn = Math.min(rMin[a], rMin[b2]), mx = Math.max(rMax[a], rMax[b2]);
        if (mx - mean > err || mean - mn > err) continue;
        PAR[a] = b2; rA[b2] = A; rS[b2] = S; rMin[b2] = mn; rMax[b2] = mx; merged++;
      }
      if (!merged) break;
    }
    // ---- labels (a lone cell under 12 m, a shed or a garage, is under the level's error: dropped)
    const remap = new Map();
    let R = 0;
    for (let c = 0; c < NN; c++) {
      if (!Q[c]) { LAB[c] = 0; continue; }
      const r0 = find(c);
      if (rA[r0] <= 1 && TOP[c] - B[BID[c]].baseY < 12) { LAB[c] = 0; Q[c] = 0; continue; }
      let r = remap.get(r0);
      if (r === undefined) { r = ++R; remap.set(r0, r); }
      LAB[c] = r;
    }
    if (!R) return { regions: 0 };
    // region aggregates: colour (squared-sRGB mean, as the far shader decodes), lit share, lowest base, roof
    const sR = new Float64Array(R + 1), sG = new Float64Array(R + 1), sB = new Float64Array(R + 1), sL = new Float64Array(R + 1);
    const cnt = new Float64Array(R + 1), base = new Float64Array(R + 1).fill(1e9), topR = new Float64Array(R + 1);
    const rep = new Int32Array(R + 1).fill(-1);   // the region's largest building (its label)
    for (const [r0, r] of remap) topR[r] = rS[r0] / rA[r0];
    for (let c = 0; c < NN; c++) {
      const r = LAB[c];
      if (!r) continue;
      const b = B[BID[c]];
      sR[r] += b.r * b.r; sG[r] += b.g * b.g; sB[r] += b.b * b.b; sL[r] += b.lit; cnt[r]++;
      if (b.baseY < base[r]) base[r] = b.baseY;
      if (rep[r] < 0 || B[rep[r]].area < b.area) rep[r] = BID[c];
    }
    const colOf = (r) => [Math.sqrt(sR[r] / cnt[r]), Math.sqrt(sG[r] / cnt[r]), Math.sqrt(sB[r] / cnt[r])];
    // ---- fixed corners: three labels, or two meeting diagonally (OUT = -1 past the chunk's border)
    const lab = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? -1 : LAB[j * N + i]);
    const N1 = N + 1;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = lab(i - 1, j - 1), b2 = lab(i, j - 1), c = lab(i - 1, j), d = lab(i, j);
      let dist = 1;
      if (b2 !== a) dist++;
      if (c !== a && c !== b2) dist++;
      if (d !== a && d !== b2 && d !== c) dist++;
      FIX[j * N1 + i] = dist >= 3 || (a === d && b2 === c && a !== b2) ? 1 : 0;
    }
    // ---- directed boundary edges, solid on the left (shoelace-positive in (x, z))
    let cap = 1 << 16, E = 0;
    let eF = new Int32Array(cap), eT = new Int32Array(cap), eR = new Int32Array(cap), eN = new Int32Array(cap), eNx = new Int32Array(cap);
    const grow = () => {
      cap *= 2;
      const g = (a) => { const b2 = new Int32Array(cap); b2.set(a); return b2; };
      eF = g(eF); eT = g(eT); eR = g(eR); eN = g(eN); eNx = g(eNx);
    };
    HEAD.fill(-1);
    const add = (f, t, r, nb) => { if (E >= cap) grow(); eF[E] = f; eT[E] = t; eR[E] = r; eN[E] = nb; eNx[E] = HEAD[f]; HEAD[f] = E; E++; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const r = LAB[j * N + i];
      if (!r) continue;
      let nb;
      if ((nb = lab(i, j - 1)) !== r) add(j * N1 + i, j * N1 + i + 1, r, nb);                       // north side, +x
      if ((nb = lab(i + 1, j)) !== r) add(j * N1 + i + 1, (j + 1) * N1 + i + 1, r, nb);             // east side, +z
      if ((nb = lab(i, j + 1)) !== r) add((j + 1) * N1 + i + 1, (j + 1) * N1 + i, r, nb);           // south side, -x
      if ((nb = lab(i - 1, j)) !== r) add((j + 1) * N1 + i, j * N1 + i, r, nb);                     // west side, -z
    }
    // ---- rings
    const seen = new Uint8Array(E);
    const cx = (q) => x0 + (q % N1) * cell, cz = (q) => z0 + Math.floor(q / N1) * cell;
    const segCache = new Map();
    const rings = new Map();   // region -> [{pts, segs:[{pts, nb}]}]
    for (let e0 = 0; e0 < E; e0++) {
      if (seen[e0]) continue;
      const ring = [];
      let e = e0, guard = 0;
      do {
        seen[e] = 1; ring.push(e);
        const q = eT[e], r = eR[e];
        const dx1 = (q % N1) - (eF[e] % N1), dz1 = Math.floor(q / N1) - Math.floor(eF[e] / N1);
        let best = -1, bestTurn = -9;
        for (let f = HEAD[q]; f >= 0; f = eNx[f]) {
          if (eR[f] !== r) continue;
          const dx2 = (eT[f] % N1) - (q % N1), dz2 = Math.floor(eT[f] / N1) - Math.floor(q / N1);
          const turn = dx1 * dz2 - dz1 * dx2;   // > 0: left (keeps hugging the same cell at a pinch)
          if (turn > bestTurn) { bestTurn = turn; best = f; }
        }
        e = best;
        if (++guard > 8 * NN) throw new Error('ring trace runaway');
      } while (e !== e0 && e >= 0);
      const r = eR[e0];
      const n = ring.length;
      const fixedAt = [];
      for (let k = 0; k < n; k++) if (FIX[eF[ring[k]]]) fixedAt.push(k);
      // a segment's polyline runs through the MIDPOINTS of its unit edges (half the staircase of a raster boundary, so
      // the simplification straightens a rotated street line instead of keeping its steps); its fixed ends are corners
      const simplifySeg = (corners, nb, closed) => {
        const share = nb > 0;
        const rev = share && nb < r;   // canonical direction: the smaller label on the left
        let cs = rev ? corners.slice().reverse() : corners;
        let key = null;
        if (share) {
          if (closed) {   // canonical start: the smallest corner id
            let mi = 0;
            for (let k = 1; k < cs.length - 1; k++) if (cs[k] < cs[mi]) mi = k;
            cs = cs.slice(mi, cs.length - 1).concat(cs.slice(0, mi + 1));
          }
          key = `${cs[0]}_${cs[cs.length - 1]}_${cs[1]}_${Math.min(r, nb)}_${Math.max(r, nb)}`;
          const hit = segCache.get(key);
          if (hit) return rev ? hit.slice().reverse() : hit;
        }
        const pts = [];
        if (!closed) pts.push([cx(cs[0]), cz(cs[0])]);
        for (let k = 0; k + 1 < cs.length; k++) pts.push([(cx(cs[k]) + cx(cs[k + 1])) / 2, (cz(cs[k]) + cz(cs[k + 1])) / 2]);
        if (!closed) pts.push([cx(cs[cs.length - 1]), cz(cs[cs.length - 1])]);
        else pts.push(pts[0]);
        const s = (closed || cs[0] === cs[cs.length - 1]) ? dpClosed(pts, tol) : dpOpen(pts, tol);
        if (key) segCache.set(key, s);
        return rev ? s.slice().reverse() : s;
      };
      const segs = [];
      if (!fixedAt.length) {
        const corners = ring.map((ed) => eF[ed]); corners.push(eF[ring[0]]);
        segs.push({ pts: simplifySeg(corners, eN[ring[0]], true), nb: eN[ring[0]] });
      } else {
        for (let s = 0; s < fixedAt.length; s++) {
          const ka = fixedAt[s], kb = fixedAt[(s + 1) % fixedAt.length];
          const corners = [];
          let k = ka;
          do { corners.push(eF[ring[k]]); k = (k + 1) % n; } while (k !== kb);
          corners.push(eF[ring[kb]]);
          segs.push({ pts: simplifySeg(corners, eN[ring[ka]], false), nb: eN[ring[ka]] });
        }
      }
      const pts = [];
      for (const sg of segs) for (let k = 0; k < sg.pts.length - 1; k++) pts.push(sg.pts[k]);
      let a = rings.get(r);
      if (!a) rings.set(r, (a = []));
      a.push({ pts, segs });
    }
    // ---- geometry
    let walls = 0;
    for (const [r, rs] of rings) {
      const top = topR[r];
      const col = colOf(r), lit = clamp255((sL[r] / cnt[r]) * 255);
      m.key(rep[r]);
      // walls where this region stands above its neighbour; none along the chunk border
      for (const rg of rs) for (const sg of rg.segs) {
        if (sg.nb < 0) continue;
        let yb;
        if (sg.nb === 0) yb = base[r] - 1.0;
        else if (topR[sg.nb] < top) yb = topR[sg.nb];
        else continue;
        for (let k = 0; k + 1 < sg.pts.length; k++) { wall(m, sg.pts[k][0], sg.pts[k][1], sg.pts[k + 1][0], sg.pts[k + 1][1], yb, top, col, lit); walls++; }
      }
      // roof: outer rings (positive) and their holes (negative)
      const outers = [], holes = [];
      for (const rg of rs) { if (rg.pts.length < 3) continue; const A = shoelace(rg.pts); if (A > 1e-6) outers.push(rg.pts); else if (A < -1e-6) holes.push(rg.pts); }
      const rc = roofColour(col);
      if (outers.length === 1) roof(m, outers[0], holes, top, rc, 0);
      else for (const o of outers) roof(m, o, holes.filter((h) => pointInRingArr(h[0][0] + 1e-3, h[0][1] + 1e-3, o)), top, rc, 0);
    }
    return { regions: R, walls };
  }
  function pointInRingArr(x, z, ring) {
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[j];
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) ins = !ins;
    }
    return ins;
  }
  // roofs read darker and greyer than their walls from the air: membrane, tar and gravel with a share of the wall's hue
  function roofColour(col) { return [col[0] * 0.35 + 50, col[1] * 0.35 + 50, col[2] * 0.35 + 52].map(clamp255); }

  // ------------------------------------------------------------------------------------------------ tower silhouettes
  // world/towers.js at this level's error: no parapets, copings or pier caps (under a metre), the setback tiers, the crown
  // tiers, pylons, penthouses and masts kept with the same seeds; masts at least `mastW` wide so they hold a pixel
  function tower(m, b, P, bi) {
    m.key(bi);
    const tol = Math.min(P.tol, 2.0);
    let ring = [];
    for (let k = 0; k < b.ring.length; k += 2) ring.push([b.ring[k], b.ring[k + 1]]);
    ring = ccw(ring);
    let sring = dpRing(ring, tol);
    if (sring.length > 32) sring = dpRing(ring, tol * 2);
    sring = ccw(sring);
    const cx = b.cx, cz = b.cz, h = b.h, cv = b.cv, y0 = b.baseY, topY = y0 + h;
    const col = [b.r, b.g, b.b], lit = clamp255(b.lit * 255);
    const rc = roofColour(col);
    const obbT = TW.ringOBB(ring);
    const convexish = b.area / Math.max(1, obbT.w * obbT.h) > 0.72;
    let topRing = sring;
    if ((b.flags & BF.SETBACKS) && convexish && h > 40 && b.area > 300 && !(b.roofKind === 2 || b.roofKind === 3)) {
      const R = TW.meanRadius(sring, cx, cz);
      const tiers = h > 150 ? 4 : h > 90 ? 3 : 2;
      const stepM = Math.max(1.6, Math.min(9, R * 0.19));
      const frac = tiers === 4 ? [0.34, 0.50, 0.63, 1.0] : tiers === 3 ? [0.38, 0.56, 1.0] : [0.46, 1.0];
      let cur = sring, prevY = y0 - 1.0;
      for (let t = 0; t < tiers; t++) {
        const yT = t === tiers - 1 ? topY : y0 + h * frac[t];
        prismRing(m, cur, prevY, yT, col, lit);
        if (t < tiers - 1) {
          const next = TW.insetM(cur, stepM * (0.85 + hash1(cv * 97 + t * 9.1) * 0.4), cx, cz, 0.26);
          let ok = next.length >= 3 && Math.abs(shoelace(next)) < Math.abs(shoelace(cur)) * 0.97;
          for (let q = 0; ok && q < next.length; q++) if (!pointInRingArr(next[q][0], next[q][1], cur)) ok = false;
          if (!ok) { prismRing(m, cur, yT, topY, col, lit); break; }
          roof(m, cur, [next], yT, rc, 0);
          cur = next;
        }
        prevY = yT;
      }
      topRing = cur;
    } else prismRing(m, sring, y0 - 1.0, topY, col, lit);
    // crown (buildTower)
    if (h <= 45) { roof(m, topRing, [], topY, rc, 0); return; }
    const obb = TW.ringOBB(topRing);
    const rectness = b.area / Math.max(1, obbT.w * obbT.h);
    const kind = crownKind({ style: b.style, height: h });
    const r0 = hash1(cv * 617.3 + 1.7), r1 = hash1(cv * 311.7 + 5.3), r2 = hash1(cv * 907.1 + 11.9);
    const paraH = 1.05 + r0 * 1.25 + (h > 120 ? 0.5 : 0);
    const steppable = rectness > 0.58 && obb.w > 8 && obb.h > 6;
    const mR = TW.meanRadius(topRing, cx, cz);
    const mastAt = (yBase) => {
      const r = hash1(cv * 131.7 + 3.3);
      const total = Math.min(26, Math.max(7, h * (0.045 + r * 0.055)));
      const w0 = Math.max(P.mastW, Math.max(0.20, Math.min(0.80, obb.w * 0.016)));
      const [mx, mz] = obb.center;
      prismRing(m, boxRing(mx, mz, w0 * 1.6, w0 * 1.6, obb.ang), yBase - 0.5, yBase + total * 0.14, [44, 45, 47], 0);
      prismRing(m, boxRing(mx, mz, w0, w0, obb.ang), yBase + total * 0.14, yBase + total, [44, 45, 47], 0);
    };
    const boxAt = (hw, hh, off, y1, colB) => {
      const c = Math.cos(obb.ang), s = Math.sin(obb.ang);
      const bx = obb.center[0] + off * c, bz = obb.center[1] + off * s;
      const br = boxRing(bx, bz, hw, hh, obb.ang);
      prismRing(m, br, topY - 0.5, y1, colB, 0);
      roof(m, br, [], y1, colB.map((v) => v * 0.85), 0);
    };
    roof(m, topRing, [], topY, rc, 0);
    const mech = [102, 104, 110];
    if (kind === 'deco' && steppable) {
      const tiers = h > 150 ? 4 : h > 95 ? 3 : 2;
      const lite = col.map((c) => clamp255(c * (1.05 + r1 * 0.14)));
      let cur = TW.insetM(topRing, 0.35, cx, cz);
      let yy = topY + paraH + 0.22;
      prismRing(m, cur, topY - 0.5, yy, col, lit);
      const stepM = Math.max(1.4, Math.min(7.5, mR * 0.17));
      const budget = Math.min(16, Math.max(4.5, h * 0.07));
      const wSum = tiers + 0.4;
      for (let t = 0; t < tiers; t++) {
        cur = TW.insetM(cur, stepM * (0.8 + hash1(cv * 71 + t * 13.7) * 0.5), cx, cz, 0.22);
        const th = (budget / wSum) * (t === tiers - 1 ? 1.4 : 1) * (0.82 + hash1(cv * 53 + t * 7.1) * 0.36);
        prismRing(m, cur, yy - 0.3, yy + th + 0.35, lite, 0);
        roof(m, cur, [], yy + th + 0.35, rc, 0);
        yy += th + 0.35;
        if (TW.meanRadius(cur, cx, cz) < 3.2) break;
      }
      if (h > 95 && r2 < 0.65) {
        const pw = Math.min(obb.w * 0.5 * 0.9, Math.max(1.6, obb.w * 0.13)), ph = Math.min(obb.h * 0.5 * 0.9, Math.max(1.4, obb.h * 0.16));
        const pyH = Math.min(9, 2.6 + r2 * 4.5 + h * 0.012);
        const br = boxRing(obb.center[0], obb.center[1], pw, ph, obb.ang);
        prismRing(m, br, yy - 0.3, yy + pyH, lite.map((v) => clamp255(v * 0.92)), 0);
        roof(m, br, [], yy + pyH, rc, 0);
        yy += pyH;
      }
      if (h > 175 || (h > 130 && r1 < 0.16)) mastAt(yy);
    } else if (kind === 'modern') {
      const mw = Math.min(obb.w * 0.5 * 0.9, Math.max(2.4, obb.w * (0.22 + r1 * 0.14)));
      const off = Math.max(-(obb.w * 0.5 - mw), Math.min(obb.w * 0.5 - mw, (r0 - 0.5) * obb.w * 0.34));
      const mh = Math.min(obb.h * 0.5 * 0.9, Math.max(2.2, obb.h * (0.28 + r2 * 0.16)));
      const mHt = Math.max(4.2, Math.min(16, h * 0.055 + r0 * 4));
      boxAt(mw, mh, off, topY + paraH + mHt, mech);
      if (h > 185 || (h > 140 && r2 < 0.14)) mastAt(topY + paraH + mHt);
    } else if (kind === 'sculpt' && steppable) {
      const sBud = Math.min(17, Math.max(5, h * 0.075));
      const sh1 = sBud * 0.62;
      const pRing = TW.insetM(topRing, 0.35, cx, cz);
      const shoulder = TW.insetM(pRing, Math.max(1.2, mR * 0.16), cx, cz, 0.3);
      prismRing(m, shoulder, topY - 0.5, topY + paraH + 0.22 + sh1, col, lit);
      roof(m, shoulder, [], topY + paraH + 0.22 + sh1, rc, 0);
      const capR = TW.insetM(shoulder, Math.max(0.9, mR * 0.16), cx, cz, 0.2);
      const capH = sBud * 0.38;
      const yc = topY + paraH + 0.22 + sh1;
      prismRing(m, capR, yc - 0.3, yc + capH, [77, 82, 89], 0);
      roof(m, capR, [], yc + capH, [77, 82, 89], 0);
      if (h > 170 || (h > 125 && r0 < 0.18)) mastAt(yc + capH);
    } else if (kind === 'slab') {
      const mw = Math.min(obb.w * 0.5 * 0.9, Math.max(2.0, obb.w * (0.16 + r0 * 0.12)));
      const off = Math.max(-(obb.w * 0.5 - mw), Math.min(obb.w * 0.5 - mw, (r2 - 0.5) * obb.w * 0.4));
      const mh = Math.min(obb.h * 0.5 * 0.9, Math.max(1.8, obb.h * (0.30 + r1 * 0.16)));
      boxAt(mw, mh, off, topY + paraH + Math.max(3.4, 3.0 + r0 * 3.2), col.map((v) => clamp255(v * 0.95)));
    } else if (rectness > 0.5 && obb.w > 6 && obb.h > 5) {
      const mw = Math.min(obb.w * 0.5 * 0.9, Math.max(1.6, obb.w * (0.15 + r0 * 0.1)));
      const mh = Math.min(obb.h * 0.5 * 0.9, Math.max(1.5, obb.h * (0.24 + r1 * 0.14)));
      boxAt(mw, mh, 0, topY + paraH + Math.max(2.8, 2.4 + r2 * 3.0), [5, 6, 8, 12, 0, 1, 2, 4].includes(b.style) ? col.map((v) => clamp255(v * 0.92)) : mech);
    }
  }
  // ------------------------------------------------------------------------------------------------ ambient occlusion
  // BD40: each vertex's share of the open sky (1 open, down to AO_MIN in a deep canyon), from the building tops around it:
  // a 4 m height raster over the chunk and AO_MARGIN past it; from each vertex, rays over the half-space its face looks into
  // (7 about a wall's outward normal, 8 round a roof), each the highest top's elevation within AO_D metres; the share is
  // the mean of 1 - sin(elevation). Renderers take it on the indirect light only (the page's sky term, Unreal's AO input).
  const AO_CELL = 4, AO_MARGIN = 64, AO_MIN = 0.2, AO_D = [3, 7, 14, 28, 56];
  function heightRaster(ids, x0, z0, x1, z1) {
    const nx = Math.ceil((x1 - x0) / AO_CELL), nz = Math.ceil((z1 - z0) / AO_CELL);
    const H = new Float32Array(nx * nz).fill(-1e9);
    const xs = [];
    for (const bi of ids) {
      const b = B[bi];
      if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
      const top = b.top !== undefined ? b.top : b.baseY + b.h;
      const r = b.ring, n = r.length / 2;
      const j0 = Math.max(0, Math.floor((b.z0 - z0) / AO_CELL)), j1 = Math.min(nz - 1, Math.floor((b.z1 - z0) / AO_CELL));
      for (let j = j0; j <= j1; j++) {
        const zc = z0 + (j + 0.5) * AO_CELL;
        xs.length = 0;
        for (let v = 0, w = n - 1; v < n; w = v++) {
          const za = r[w * 2 + 1], zb = r[v * 2 + 1];
          if ((za <= zc) !== (zb <= zc)) xs.push(r[w * 2] + ((zc - za) / (zb - za)) * (r[v * 2] - r[w * 2]));
        }
        xs.sort((a, c) => a - c);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - x0) / AO_CELL - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / AO_CELL - 0.5));
          for (let i = i0; i <= i1; i++) if (H[j * nx + i] < top) H[j * nx + i] = top;
        }
      }
    }
    return { H, nx, nz, x0, z0 };
  }
  // per vertex of mesh m (its chunk square of side `size` about the mesh origin), from the buildings `ids` (those within
  // AO_MARGIN of the square included): Uint8 (round(share x 255), never under AO_MIN x 255; 0 means no value)
  function aoPass(m, ids, size) {
    const nv = m.nv, out = new Uint8Array(nv);
    if (!nv) return out;
    const x0 = m.ox - size / 2 - AO_MARGIN, z0 = m.oz - size / 2 - AO_MARGIN;
    const R = heightRaster(ids, x0, z0, m.ox + size / 2 + AO_MARGIN, m.oz + size / 2 + AO_MARGIN);
    const nrm = new Float32Array(nv * 3), seen = new Uint8Array(nv);
    const P = m.p, I = m.i, inv = 1 / SCALE;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ux = (P[b * 3] - P[a * 3]) * inv, uy = (P[b * 3 + 1] - P[a * 3 + 1]) * inv, uz = (P[b * 3 + 2] - P[a * 3 + 2]) * inv;
      const vx = (P[c * 3] - P[a * 3]) * inv, vy = (P[c * 3 + 1] - P[a * 3 + 1]) * inv, vz = (P[c * 3 + 2] - P[a * 3 + 2]) * inv;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      for (const q of [a, b, c]) if (!seen[q]) { seen[q] = 1; nrm[q * 3] = nx; nrm[q * 3 + 1] = ny; nrm[q * 3 + 2] = nz; }
    }
    const { H, nx: NX, nz: NZ } = R;
    for (let v = 0; v < nv; v++) {
      const x = P[v * 3] * inv + m.ox, y = P[v * 3 + 1] * inv, z = P[v * 3 + 2] * inv + m.oz;
      const fx = nrm[v * 3], fy = nrm[v * 3 + 1], fz = nrm[v * 3 + 2];
      const wallV = Math.abs(fy) < 0.7;
      const nd = wallV ? 7 : 8, a0 = wallV ? Math.atan2(fz, fx) : 0;
      let acc = 0;
      for (let d = 0; d < nd; d++) {
        const ang = wallV ? a0 + ((d - 3) * (5 * Math.PI / 12)) / 3 : (d * Math.PI) / 4;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        let tmax = 0;
        for (const r of AO_D) {
          const i = Math.floor((x + dx * r - x0) / AO_CELL), j = Math.floor((z + dz * r - z0) / AO_CELL);
          if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
          const t = (H[j * NX + i] - y) / r;
          if (t > tmax) tmax = t;
        }
        acc += 1 - tmax / Math.sqrt(1 + tmax * tmax);
      }
      out[v] = Math.round(Math.max(AO_MIN, Math.min(1, acc / nd)) * 255);
    }
    return out;
  }
  return { NO_KEY, Mesh, clamp255, ROOF_UV, wall, roof, prismRing, boxRing, shoelace, ccw, dpOpen, dpClosed, dpRing, shells, pointInRingArr, roofColour, tower, aoPass, AO_MARGIN };
}
