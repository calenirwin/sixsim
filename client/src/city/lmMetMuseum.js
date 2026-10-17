// lmMetMuseum.js (LM16, 2026-10-16): the Metropolitan Museum of Art as a 'replace' landmark (shared/landmarkSpec.js id 44 and
// its read-time override), the owner: the buildings in Central Park, the Met first, "too basic"; landmarks "as detailed as
// possible", no tiled painted facades. The compiled record is one 63-sided ring at 26.8 m; the builder draws the museum's own
// walls and roofs on a plan read off the overhead and oblique references, in the avenue grid's frame:
//   gx along the streets toward Fifth Avenue, gn along the avenues toward the north, metres about the world point C0.
// The plan is a set of blocks (rectangles, the Lehman Wing's half-hexagon), each with its eave height, the facade of its
// outside walls and its roof: the Fifth Avenue front (the central pavilion's three arches between paired columns, the
// wings' pilasters and arched windows, the north and south wings' engaged columns), the glazed ridge-and-furrow roofs of the
// north and south wings, the American Wing's glass court and glass tent, the 1880 building's arcade under its gable, the
// gallery lanterns, the tile hips of the Fifth Avenue wings and the Great Hall, the lead hip and glass pyramid of the north
// pavilion, the south pavilion's tile hip round its glass court, the park side's lean-to glazing, the Lehman Wing's glass
// pyramid, the low south-west wing's glass skirt and the roof garden. Every surface is a kit set (surfMat / partMat /
// cwGlassMat, which Unreal binds to its PBR masters), every detail geometry; one mesh per material base.
import * as THREE from 'three';
import { Sink, Frame, poly, quadW, quadU, quadY, box as kbox, extrude, flatRing, wallWithHoles, reveal, paneW } from './fk/kitGeom.js';
import { surfMat, partMat, cwGlassMat } from './tk/tkMats.js';
import { kitMat } from './fk/kitMats.js';
import { LM_GLASS } from './tk/tkParams.js';

const GE = [0.8746, 0.4848], GN = [0.4848, -0.8746];   // the grid's street (east) and avenue (north) axes, world x z
const C0 = [646, 401.4];                                // the plan's origin (world metres)
const BBX = [-95.9, 94.3], BBN = [-154.3, 153.3];       // the compiled ring's extent on the grid about C0 (the plan's fit)
const ONE3 = [1, 1, 1];

// ---------------------------------------------------------------- materials (kit sets; created per build: the PBR library loads async)
function mats() {
  return {
    ashlar: surfMat('stone_lime_ashlar', '#d6cdb9'),
    dressed: surfMat('stone_lime', '#ddd5c3'),
    rustic: surfMat('stone_lime_rusticated', '#cfc6b1'),
    inner: surfMat('stone_lime_ashlar', '#cbc2ae'),
    modern: surfMat('stone_lime_ashlar', '#d9d2c2'),
    granite: surfMat('granite_grey', '#8e8b85'),
    stepG: surfMat('granite_grey_flamed', '#a9a59c'),
    brick: surfMat('brick_buff', '#c7ad86'),
    tile: surfMat('terracotta_cream', '#b28063'),
    tile2: surfMat('terracotta_cream', '#a37257'),
    tileG: surfMat('terracotta_cream', '#a8907c'),   // the Great Hall's weathered hip, greyer than the wings'
    tileW: surfMat('terracotta_cream', '#b18c72'),   // the Fifth Avenue wings' hips
    lead: surfMat('panel_grey', '#a4a8a8'),
    slate: surfMat('panel_grey', '#857565'),
    deck: surfMat('roof_membrane', '#bfbcb5'),
    deckWarm: surfMat('roof_gravel', '#b88a6c'),
    gravel: surfMat('roof_gravel', '#9a958b'),
    gravel2: surfMat('roof_gravel', '#a8a397'),
    deck2: surfMat('roof_membrane', '#cbc8c0'),
    pavers: surfMat('stone_lime_ashlar', '#cdc5b6'),
    mulch: surfMat('mulch'),
    hedge: kitMat('plain', { tint: '#435c2d', rough: 0.95 }),
    conc: surfMat('concrete_smooth', '#b7b3aa'),
    hvac: surfMat('panel_grey', '#8f9395'),
    frame: partMat('alu_white', '#dcdedc'),
    frameDk: partMat('alu_black'),
    bronze: partMat('alu_bronze'),
    steel: partMat('steel_galvanized'),
    sky: cwGlassMat(LM_GLASS.SILVERW),
    glass: cwGlassMat(LM_GLASS.CLEARG),
    dark: cwGlassMat(LM_GLASS.BLACKG),
  };
}

// ---------------------------------------------------------------- output: one sink per material base (the tower kit's rule)
class Out {
  constructor(we) { this.sinks = new Map(); this.we = we; }
  s(mat, we) {
    const base = (mat.userData && mat.userData.fkBase) || mat;
    let e = this.sinks.get(base);
    if (!e) this.sinks.set(base, (e = { mat: base, S: new Sink() }));
    e.S.we = we === undefined ? this.we : we;
    e.S.tr = (mat.userData && mat.userData.fkTr) || (base.userData && base.userData.fkBaseHex ? ONE3 : null);
    return e.S;
  }
}

// ---------------------------------------------------------------- primitives (local coordinates: the group sits at the ring's (cx, groundY, cz))
// a planar polygon of 3D points, wound counter-clockwise as seen from its front; uv in metres (walls: along x y; flat: x z)
function face(K, mat, pts, tilt) {
  const n = pts.length;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-6) return;
  nx /= L; ny /= L; nz /= L;
  const S = K.s(mat);
  const b0 = S.n;
  const flat = Math.abs(ny) > 0.97;
  const hl = Math.hypot(nx, nz) || 1, tx = -nz / hl, tz = nx / hl, sl = Math.sqrt(Math.max(0.05, 1 - ny * ny));
  let tnx = nx, tny = ny, tnz = nz;
  if (tilt) { tnx += tilt[0]; tny += tilt[1]; tnz += tilt[2]; const l2 = Math.hypot(tnx, tny, tnz); tnx /= l2; tny /= l2; tnz /= l2; }
  for (const p of pts) {
    const tu = flat ? p[0] + K.ox : p[0] * tx + p[2] * tz + K.ox * tx + K.oz * tz;
    const tv = flat ? p[2] + K.oz : p[1] / sl;
    S.v(p[0], p[1], p[2], tnx, tny, tnz, tu, tv, 0);
  }
  for (let i = 1; i + 1 < n; i++) S.tri(b0, b0 + i, b0 + i + 1);
}
// a straight member of square section t from a to b (3D)
function bar(K, mat, a, b, t) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
  if (L < 1e-4) return;
  const u = d.map((v) => v / L);
  const r = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let n1 = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]];
  const l1 = Math.hypot(...n1); n1 = n1.map((v) => v / l1);
  const n2 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
  const h = t / 2, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const P = (o, s1, s2) => [o[0] + (n1[0] * s1 + n2[0] * s2) * h, o[1] + (n1[1] * s1 + n2[1] * s2) * h, o[2] + (n1[2] * s1 + n2[2] * s2) * h];
  for (let k = 0; k < 4; k++) {
    const [a1, b1] = C[k], [a2, b2] = C[(k + 1) % 4];
    // (the side between corners k and k+1, its outward normal (n1 (a1+a2) + n2 (b1+b2)) / 2; wound counter-clockwise from outside)
    const q = [P(a, a1, b1), P(b, a1, b1), P(b, a2, b2), P(a, a2, b2)];
    const on = [n1[0] * (a1 + a2) + n2[0] * (b1 + b2), n1[1] * (a1 + a2) + n2[1] * (b1 + b2), n1[2] * (a1 + a2) + n2[2] * (b1 + b2)];
    const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    face(K, mat, cr[0] * on[0] + cr[1] * on[1] + cr[2] * on[2] >= 0 ? q : q.slice().reverse());
  }
}
// a vertical cylinder (n facets) about local (x, z), radius r0 at y0 to r1 at y1, with a lid
function cyl(K, mat, x, z, r0, r1, y0, y1, n = 14, lid = true, a0 = 0, a1 = Math.PI * 2) {
  const full = a1 - a0 > 6.28;
  // the side smooth-shaded (radial vertex normals leaning with the taper), uv in metres round and up
  const S = K.s(mat), sl = (r0 - r1) / Math.max(1e-3, y1 - y0), nl = Math.hypot(1, sl);
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n, b0 = S.n;
    for (const [t, rr, yy] of [[t0, r0, y0], [t0, r1, y1], [t1, r1, y1], [t1, r0, y0]])
      S.v(x + Math.cos(t) * rr, yy, z + Math.sin(t) * rr, Math.cos(t) / nl, sl / nl, Math.sin(t) / nl, t * r0 + K.ox * 0, yy, 0);
    S.tri(b0, b0 + 1, b0 + 2); S.tri(b0, b0 + 2, b0 + 3);
  }
  if (lid && full && r1 > 0.01) {
    const top = []; for (let i = n - 1; i >= 0; i--) { const t = a0 + ((a1 - a0) * i) / n; top.push([x + Math.cos(t) * r1, y1, z + Math.sin(t) * r1]); }
    face(K, mat, top);
  }
}
const hsh = (a, b = 0) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- the plan's frame
function planFrame(ctx) {
  const cx = ctx.cx || 0, cz = ctx.cz || 0;
  // fit: the compiled ring's extent on the grid against the plan's (a recompiled ring a metre or two off moves the plan with it)
  let x0 = 1e9, x1 = -1e9, n0 = 1e9, n1 = -1e9;
  for (const [lx, lz] of ctx.footprint) {
    const dx = lx + cx - C0[0], dz = lz + cz - C0[1];
    const gx = dx * GE[0] + dz * GE[1], gn = dx * GN[0] + dz * GN[1];
    x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); n0 = Math.min(n0, gn); n1 = Math.max(n1, gn);
  }
  let sx = (x0 + x1) / 2 - (BBX[0] + BBX[1]) / 2, sn = (n0 + n1) / 2 - (BBN[0] + BBN[1]) / 2;
  if (Math.hypot(sx, sn) > 25) { sx = 0; sn = 0; }   // (not the Met's ring: keep the anchor)
  const ox = C0[0] - cx, oz = C0[1] - cz;
  const P = (gx, gn) => [ox + (gx + sx) * GE[0] + (gn + sn) * GN[0], oz + (gx + sx) * GE[1] + (gn + sn) * GN[1]];
  const G3 = (gx, gn, y) => { const p = P(gx, gn); return [p[0], y, p[1]]; };
  return { P, G3 };
}

// ---------------------------------------------------------------- roofs
// a hipped roof over the grid rectangle r = [gx0, gx1, gn0, gn1] from y0 at the eave, pitch (deg), the run up to runMax
// (a ridge when it reaches half the narrower side); o.course: tile courses (a stepped surface), o.seam: standing seams;
// o.top(rect, y): what fills a flat top; o.cap: ridge-cap material
function hipRoof(K, PF, mat, r, y0, pitch, runMax, o = {}) {
  const [gx0, gx1, gn0, gn1] = r, W = gx1 - gx0, D = gn1 - gn0;
  const run = Math.min(runMax, W / 2, D / 2), t = Math.tan((pitch * Math.PI) / 180), rise = run * t;
  const C = (k, s) => [[gx0 + s, gn0 + s], [gx1 - s, gn0 + s], [gx1 - s, gn1 - s], [gx0 + s, gn1 - s]][k];
  const slope = run / Math.cos((pitch * Math.PI) / 180);
  const nC = o.course ? Math.max(1, Math.round(slope / o.course)) : 1, lift = o.course ? 0.035 : 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (let k = 0; k < nC; k++) {
      const s0 = (run * k) / nC, s1 = (run * (k + 1)) / nC, ya = y0 + s0 * t, yb = y0 + s1 * t;
      const a0 = C(i, s0), b0 = C(j, s0), a1 = C(i, s1), b1 = C(j, s1);
      face(K, k % 7 === 3 && o.mat2 ? o.mat2 : mat, [PF.G3(a0[0], a0[1], ya + lift), PF.G3(b0[0], b0[1], ya + lift), PF.G3(b1[0], b1[1], yb), PF.G3(a1[0], a1[1], yb)]);
      if (lift) face(K, mat, [PF.G3(a0[0], a0[1], ya), PF.G3(b0[0], b0[1], ya), PF.G3(b0[0], b0[1], ya + lift), PF.G3(a0[0], a0[1], ya + lift)]);
    }
    if (o.seam) {   // standing seams up the slope from the eave to the hip line
      const A = C(i, 0), B = C(j, 0), Lo = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / Lo, un = (B[1] - A[1]) / Lo;
      const inx = -un, inn = ux;   // into the roof (the rectangle is counter-clockwise)
      for (let u = o.seam; u < Lo - 0.05; u += o.seam) {
        const s = Math.min(u, Lo - u, run);
        if (s < 0.3) continue;
        const p0 = [A[0] + ux * u, A[1] + un * u], p1 = [p0[0] + inx * s, p0[1] + inn * s];
        bar(K, o.seamMat || mat, PF.G3(p0[0], p0[1], y0 + 0.04), PF.G3(p1[0], p1[1], y0 + s * t + 0.04), 0.07);
      }
    }
    // the hip's cap
    const h0 = C(i, 0), h1 = C(i, run);
    bar(K, o.cap || mat, PF.G3(h0[0], h0[1], y0 + 0.08), PF.G3(h1[0], h1[1], y0 + rise + 0.08), 0.26);
  }
  const T = C(0, run), T2 = C(2, run);
  if (T2[0] - T[0] > 0.05 && T2[1] - T[1] > 0.05) {
    if (o.top) o.top([T[0], T2[0], T[1], T2[1]], y0 + rise);
    else face(K, o.topMat || mat, [PF.G3(T[0], T[1], y0 + rise), PF.G3(T2[0], T[1], y0 + rise), PF.G3(T2[0], T2[1], y0 + rise), PF.G3(T[0], T2[1], y0 + rise)]);
  } else {   // the ridge's cap
    bar(K, o.cap || mat, PF.G3(T[0], T[1], y0 + rise + 0.1), PF.G3(T2[0], T2[1], y0 + rise + 0.1), 0.3);
  }
  return y0 + rise;
}
// a gabled roof over r, the ridge along gn (axis 'n') or gx ('x'); gable ends in matG; o.seam / o.course as hipRoof
function gableRoof(K, PF, mat, matG, r, y0, rise, axis, o = {}) {
  const [gx0, gx1, gn0, gn1] = r;
  // in (a, b): a across the ridge, b along it
  const Q = axis === 'n' ? (a, b, y) => PF.G3(a, b, y) : (a, b, y) => PF.G3(b, a, y);
  const [a0, a1, b0, b1] = axis === 'n' ? [gx0, gx1, gn0, gn1] : [gn0, gn1, gx0, gx1];
  const am = (a0 + a1) / 2, half = (a1 - a0) / 2, ov = 0.5;
  const sgn = axis === 'n' ? 1 : -1;   // (the swap of axes mirrors the winding)
  const F = (pts) => face(K, mat, sgn > 0 ? pts : pts.slice().reverse());
  const nC = o.course ? Math.max(1, Math.round(Math.hypot(half, rise) / o.course)) : 1, lift = o.course ? 0.035 : 0;
  for (let k = 0; k < nC; k++) {
    const f0 = k / nC, f1 = (k + 1) / nC;
    // the low side a0 (its slope faces -a) and the high side a1 (faces +a)
    const yA = y0 + rise * f0, yB = y0 + rise * f1;
    F([Q(a0 + half * f0, b1 + ov, yA + lift), Q(a0 + half * f0, b0 - ov, yA + lift), Q(a0 + half * f1, b0 - ov, yB), Q(a0 + half * f1, b1 + ov, yB)]);
    F([Q(a1 - half * f0, b0 - ov, yA + lift), Q(a1 - half * f0, b1 + ov, yA + lift), Q(a1 - half * f1, b1 + ov, yB), Q(a1 - half * f1, b0 - ov, yB)]);
    if (lift) {
      F([Q(a0 + half * f0, b1 + ov, yA), Q(a0 + half * f0, b0 - ov, yA), Q(a0 + half * f0, b0 - ov, yA + lift), Q(a0 + half * f0, b1 + ov, yA + lift)]);
      F([Q(a1 - half * f0, b0 - ov, yA), Q(a1 - half * f0, b1 + ov, yA), Q(a1 - half * f0, b1 + ov, yA + lift), Q(a1 - half * f0, b0 - ov, yA + lift)]);
    }
  }
  if (o.seam) for (let b = b0 - ov + o.seam; b < b1 + ov; b += o.seam) for (const [ae, sg] of [[a0, 1], [a1, -1]]) bar(K, mat, Q(ae, b, y0 + 0.05), Q(am, b, y0 + rise + 0.03), 0.07);
  bar(K, o.cap || mat, Q(am, b0 - ov, y0 + rise + 0.08), Q(am, b1 + ov, y0 + rise + 0.08), 0.3);
  // the gable ends (stone triangles, the coping along their rakes)
  const GF = (pts) => face(K, matG, sgn > 0 ? pts : pts.slice().reverse());
  GF([Q(a0, b0, y0), Q(a1, b0, y0), Q(am, b0, y0 + rise)]);
  GF([Q(a0, b1, y0), Q(a1, b1, y0), Q(am, b1, y0 + rise)].reverse());
  for (const b of [b0, b1]) {
    bar(K, o.coping || matG, Q(a0 - 0.1, b, y0 + 0.1), Q(am, b, y0 + rise + 0.25), 0.5);
    bar(K, o.coping || matG, Q(a1 + 0.1, b, y0 + 0.1), Q(am, b, y0 + rise + 0.25), 0.5);
  }
  return y0 + rise;
}
// glazing: a quad of glass split into panes `pw` wide between bars along its rafters (a -> d and b -> c the rafters' ends:
// a b at the eave, d c at the top), purlins every `pp` up the slope; each pane its own small tilt (the reflections vary)
function glazed(K, M, a, b, c, d, o = {}) {
  const pw = o.pw || 1.6, pp = o.pp || 2.4, seed = o.seed || 0;
  const Lab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Lad = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  const nu = Math.max(1, Math.round(Lab / pw)), nv = Math.max(1, Math.round(Lad / pp));
  const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const at = (s, t) => L(L(a, b, s), L(d, c, s), t);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const h1 = hsh(seed + i * 7.1, j * 3.3) - 0.5, h2 = hsh(seed + i * 1.9, j * 5.7 + 2) - 0.5;
    face(K, o.glass || M.sky, [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)], [h1 * 0.03, 0, h2 * 0.03]);
  }
  if (o.bars === false) return;
  const fr = o.frame || M.frame, t = o.bt || 0.09, lift = (p) => [p[0], p[1] + 0.03, p[2]];
  for (let i = 0; i <= nu; i++) bar(K, fr, lift(at(i / nu, 0)), lift(at(i / nu, 1)), i === 0 || i === nu ? t * 1.4 : t);
  for (let j = 0; j <= nv; j++) bar(K, fr, lift(at(0, j / nv)), lift(at(1, j / nv)), j === 0 || j === nv ? t * 1.4 : t * 0.8);
}
// ridge-and-furrow glazing over r: nb bays across, the ridges along gn (axis 'n') or gx ('x'), `rise` above a curb of 0.6 m
function ridges(K, PF, M, r, y0, axis, nb, rise, o = {}) {
  const [gx0, gx1, gn0, gn1] = r;
  const Q = axis === 'n' ? (a, b, y) => PF.G3(a, b, y) : (a, b, y) => PF.G3(b, a, y);
  const flip = axis === 'n' ? (p) => p : (p) => p.slice().reverse();
  const [a0, a1, b0, b1] = axis === 'n' ? [gx0, gx1, gn0, gn1] : [gn0, gn1, gx0, gx1];
  const bw = (a1 - a0) / nb, yc = y0 + (o.curb ?? 0.6), gw = 0.3;
  // the curb round the field, the gutters between the bays
  curbRing(K, PF, o.curbMat || M.deck, r, y0, yc);
  for (let i = 0; i < nb; i++) {
    const s0 = a0 + i * bw + gw / 2, s1 = a0 + (i + 1) * bw - gw / 2, sm = (s0 + s1) / 2, yr = yc + rise;
    const sd = i * 13 + (o.seed || 0);
    // the two slopes (each wound to face up and out), the gable ends
    const A = flip([Q(s0, b0, yc), Q(sm, b0, yr), Q(sm, b1, yr), Q(s0, b1, yc)]);
    const B = flip([Q(sm, b0, yr), Q(s1, b0, yc), Q(s1, b1, yc), Q(sm, b1, yr)]);
    if (axis === 'n') { glazed(K, M, Q(s0, b1, yc), Q(s0, b0, yc), Q(sm, b0, yr), Q(sm, b1, yr), { pw: 1.5, pp: 2.2, seed: sd }); glazed(K, M, Q(s1, b0, yc), Q(s1, b1, yc), Q(sm, b1, yr), Q(sm, b0, yr), { pw: 1.5, pp: 2.2, seed: sd + 5 }); }
    else { glazed(K, M, Q(s0, b0, yc), Q(s0, b1, yc), Q(sm, b1, yr), Q(sm, b0, yr), { pw: 1.5, pp: 2.2, seed: sd }); glazed(K, M, Q(s1, b1, yc), Q(s1, b0, yc), Q(sm, b0, yr), Q(sm, b1, yr), { pw: 1.5, pp: 2.2, seed: sd + 5 }); }
    void A; void B;
    const endM = o.endMat || M.sky;
    face(K, endM, flip([Q(s0, b0, yc), Q(s1, b0, yc), Q(sm, b0, yr)]));
    face(K, endM, flip([Q(s0, b1, yc), Q(s1, b1, yc), Q(sm, b1, yr)]).reverse());
    bar(K, M.frame, Q(sm, b0, yr + 0.06), Q(sm, b1, yr + 0.06), 0.16);
    if (i > 0) { // the gutter between this bay and the last
      const g0 = a0 + i * bw - gw / 2, g1 = g0 + gw;
      face(K, M.lead, flip([Q(g0, b0, yc - 0.06), Q(g1, b0, yc - 0.06), Q(g1, b1, yc - 0.06), Q(g0, b1, yc - 0.06)]));   // (over the curb's deck at -0.12)
    }
  }
  // the margin gutters inside the curb
  face(K, M.lead, flip([Q(a0, b0, yc - 0.06), Q(a0 + gw / 2, b0, yc - 0.06), Q(a0 + gw / 2, b1, yc - 0.06), Q(a0, b1, yc - 0.06)]));
  face(K, M.lead, flip([Q(a1 - gw / 2, b0, yc - 0.06), Q(a1, b0, yc - 0.06), Q(a1, b1, yc - 0.06), Q(a1 - gw / 2, b1, yc - 0.06)]));
  return yc + rise;
}
// a curb (an upstand of h1 - h0) round the rectangle r and a deck under it
function curbRing(K, PF, mat, r, h0, h1, deck = true) {
  const [gx0, gx1, gn0, gn1] = r, c = [[gx0, gn0], [gx1, gn0], [gx1, gn1], [gx0, gn1]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    face(K, mat, [PF.G3(a[0], a[1], h0), PF.G3(b[0], b[1], h0), PF.G3(b[0], b[1], h1), PF.G3(a[0], a[1], h1)]);
  }
  if (deck) face(K, mat, [PF.G3(gx0, gn0, h1 - 0.12), PF.G3(gx1, gn0, h1 - 0.12), PF.G3(gx1, gn1, h1 - 0.12), PF.G3(gx0, gn1, h1 - 0.12)]);
}
// a glass hip (or pyramid when the run reaches half the narrower side) over r from y0: glazed faces between bars, a flat
// glass top (pitched 4 degrees, never level: the kit's glass takes its room frame from the normal) when the run stops short
function glassHip(K, PF, M, r, y0, run, pitch, o = {}) {
  const [gx0, gx1, gn0, gn1] = r, W = gx1 - gx0, D = gn1 - gn0;
  run = Math.min(run, W / 2, D / 2);
  const t = Math.tan((pitch * Math.PI) / 180), y1 = y0 + run * t;
  const C = (k, s) => [[gx0 + s, gn0 + s], [gx1 - s, gn0 + s], [gx1 - s, gn1 - s], [gx0 + s, gn1 - s]][k];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, a = C(i, 0), b = C(j, 0), c = C(j, run), d = C(i, run);
    glazed(K, M, PF.G3(a[0], a[1], y0), PF.G3(b[0], b[1], y0), PF.G3(c[0], c[1], y1), PF.G3(d[0], d[1], y1), { pw: o.pw || 1.4, pp: o.pp || 1.8, seed: (o.seed || 0) + i * 3, glass: o.glass });
    bar(K, o.hipMat || M.frame, PF.G3(a[0], a[1], y0 + 0.05), PF.G3(d[0], d[1], y1 + 0.05), 0.16);
  }
  const T = C(0, run), T2 = C(2, run);
  if (T2[0] - T[0] > 0.1 && T2[1] - T[1] > 0.1) {
    const m = (T[0] + T2[0]) / 2, tt = Math.tan((4 * Math.PI) / 180) * (T2[0] - T[0]) / 2;
    glazed(K, M, PF.G3(T[0], T[1], y1), PF.G3(m, T[1], y1 + tt), PF.G3(m, T2[1], y1 + tt), PF.G3(T[0], T2[1], y1), { pw: 1.6, pp: 1.6, seed: (o.seed || 0) + 20, glass: o.glass });
    glazed(K, M, PF.G3(m, T[1], y1 + tt), PF.G3(T2[0], T[1], y1), PF.G3(T2[0], T2[1], y1), PF.G3(m, T2[1], y1 + tt), { pw: 1.6, pp: 1.6, seed: (o.seed || 0) + 21, glass: o.glass });
  } else bar(K, M.frame, PF.G3(T[0], T[1], y1 + 0.06), PF.G3(T2[0], T2[1], y1 + 0.06), 0.18);
  return y1;
}
// a gallery lantern: a curb box (lead) and a glass hip on it
function lantern(K, PF, M, r, y0, curb, pitch, o = {}) {
  const [gx0, gx1, gn0, gn1] = r;
  const c = [[gx0, gn0], [gx1, gn0], [gx1, gn1], [gx0, gn1]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    face(K, o.curbMat || M.lead, [PF.G3(a[0], a[1], y0), PF.G3(b[0], b[1], y0), PF.G3(b[0], b[1], y0 + curb), PF.G3(a[0], a[1], y0 + curb)]);
    bar(K, M.frame, PF.G3(a[0], a[1], y0 + curb), PF.G3(b[0], b[1], y0 + curb), 0.14);
  }
  return glassHip(K, PF, M, r, y0 + curb, o.run ?? 99, pitch, o);
}
// a lean-to of glass over r from yLow on the `low` side (one of 'w' 'e' 's' 'n') up to yHigh on the opposite one, with glass
// end triangles and a gutter on the low eave
function leanTo(K, PF, M, r, yLow, yHigh, low, o = {}) {
  const [gx0, gx1, gn0, gn1] = r;
  // (a across from the low side to the high one, b along it), wound by hand per side
  let lo0, lo1, hi0, hi1;
  if (low === 'w') { lo0 = [gx0, gn1]; lo1 = [gx0, gn0]; hi0 = [gx1, gn1]; hi1 = [gx1, gn0]; }
  else if (low === 'e') { lo0 = [gx1, gn0]; lo1 = [gx1, gn1]; hi0 = [gx0, gn0]; hi1 = [gx0, gn1]; }
  else if (low === 's') { lo0 = [gx0, gn0]; lo1 = [gx1, gn0]; hi0 = [gx0, gn1]; hi1 = [gx1, gn1]; }
  else { lo0 = [gx1, gn1]; lo1 = [gx0, gn1]; hi0 = [gx1, gn0]; hi1 = [gx0, gn0]; }
  const A = PF.G3(lo0[0], lo0[1], yLow), B = PF.G3(lo1[0], lo1[1], yLow), Cc = PF.G3(hi1[0], hi1[1], yHigh), D = PF.G3(hi0[0], hi0[1], yHigh);
  glazed(K, M, A, B, Cc, D, { pw: o.pw || 1.6, pp: o.pp || 2.0, seed: o.seed || 0, glass: o.glass });
  // the end triangles: under the slope at each end, glass
  face(K, o.endMat || M.sky, [PF.G3(lo1[0], lo1[1], yLow), PF.G3(hi1[0], hi1[1], yLow), PF.G3(hi1[0], hi1[1], yHigh)]);
  face(K, o.endMat || M.sky, [PF.G3(hi0[0], hi0[1], yLow), PF.G3(lo0[0], lo0[1], yLow), PF.G3(hi0[0], hi0[1], yHigh)]);
  bar(K, M.lead, PF.G3(lo0[0], lo0[1], yLow), PF.G3(lo1[0], lo1[1], yLow), 0.35);
}
// a convex polygon (grid points, counter-clockwise) offset inward by d (mitred)
function insetPoly(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const e1 = [c[0] - p[0], c[1] - p[1]], e2 = [q[0] - c[0], q[1] - c[1]], l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];   // inward normals of a counter-clockwise ring
    const m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(...m), k = d / Math.max(0.2, (m[0] * n1[0] + m[1] * n1[1]) / ml);
    out.push([c[0] + (m[0] / ml) * k, c[1] + (m[1] / ml) * k]);
  }
  return out;
}
// a lofted glass roof over a convex polygon: levels [{ d (inset), y }], ribs along the corners, glazing between
function glassLoft(K, PF, M, pts, levels, o = {}) {
  const rings = levels.map((l) => ({ r: insetPoly(pts, l.d), y: l.y }));
  for (let L = 0; L + 1 < rings.length; L++) {
    const R0 = rings[L], R1 = rings[L + 1], n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = PF.G3(R0.r[i][0], R0.r[i][1], R0.y), b = PF.G3(R0.r[j][0], R0.r[j][1], R0.y), c = PF.G3(R1.r[j][0], R1.r[j][1], R1.y), d = PF.G3(R1.r[i][0], R1.r[i][1], R1.y);
      glazed(K, M, a, b, c, d, { pw: 1.5, pp: 1.7, seed: L * 31 + i * 5, glass: o.glass });
      bar(K, M.frame, [a[0], a[1] + 0.05, a[2]], [d[0], d[1] + 0.05, d[2]], 0.2);
    }
  }
  const top = rings[rings.length - 1];
  const cg = top.r.reduce((s, p) => [s[0] + p[0] / top.r.length, s[1] + p[1] / top.r.length], [0, 0]);
  const yA = top.y + (o.apex ?? 1.2);
  for (let i = 0; i < top.r.length; i++) {
    const j = (i + 1) % top.r.length;
    face(K, o.capMat || M.lead, [PF.G3(top.r[i][0], top.r[i][1], top.y), PF.G3(top.r[j][0], top.r[j][1], top.y), PF.G3(cg[0], cg[1], yA)]);
  }
}
// rooftop plant: a cabinet with louvres and fans on its top, or a cooling tower; dims in metres on the grid (axis-aligned)
function hvac(K, PF, M, gx, gn, w, d, h, y0, kind = 0) {
  const r = [gx - w / 2, gx + w / 2, gn - d / 2, gn + d / 2];
  const c = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    face(K, M.hvac, [PF.G3(a[0], a[1], y0), PF.G3(b[0], b[1], y0), PF.G3(b[0], b[1], y0 + h), PF.G3(a[0], a[1], y0 + h)]);
    // louvre lines on the long sides
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 2.5) for (let y = y0 + 0.4; y < y0 + h - 0.3; y += 0.35) {
      const nx = (b[1] - a[1]), nn = -(b[0] - a[0]), nl = Math.hypot(nx, nn), ox = (nx / nl) * 0.04, on = (nn / nl) * 0.04;
      bar(K, M.steel, PF.G3(a[0] + ox + (b[0] - a[0]) * 0.06, a[1] + on + (b[1] - a[1]) * 0.06, y), PF.G3(b[0] + ox - (b[0] - a[0]) * 0.06, b[1] + on - (b[1] - a[1]) * 0.06, y), 0.06);
    }
  }
  face(K, M.hvac, [PF.G3(r[0], r[2], y0 + h), PF.G3(r[1], r[2], y0 + h), PF.G3(r[1], r[3], y0 + h), PF.G3(r[0], r[3], y0 + h)]);
  // fans along the longer axis
  const along = w >= d, n = Math.max(1, Math.floor((along ? w : d) / 2.2));
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n;
    const p = PF.P(along ? r[0] + w * f : gx, along ? gn : r[2] + d * f);
    const rr = Math.min(0.85, (along ? d : w) * 0.36);
    cyl(K, kind ? M.steel : M.hvac, p[0], p[1], rr, rr, y0 + h, y0 + h + 0.45, 12, false);
    cyl(K, M.frameDk, p[0], p[1], rr * 0.92, rr * 0.92, y0 + h + 0.3, y0 + h + 0.32, 12, true);
  }
}

// ---------------------------------------------------------------- facades (a face frame F: u along the edge, w out of it)
const P3 = (F, u, y, w) => F.world(u, y, w);
function cornice(K, mat, F, u0, u1, y, proj, m0 = 0, m1 = 0) {
  // a classical crown: fillet, cyma (stepped), corona, bed mould; proj = its projection; the larger ones carry dentils
  // under the corona and modillions (brackets) every 0.9 m
  const p = proj;
  extrude(K.s(mat), F, [[0, y - 0.9], [0.12 * p, y - 0.9], [0.18 * p, y - 0.72], [0.35 * p, y - 0.62], [0.42 * p, y - 0.5], [0.9 * p, y - 0.42], [0.92 * p, y - 0.18], [p, y - 0.1], [p, y], [0, y]], u0, u1, { m0, m1 });
  if (p < 0.9) return;
  const S = K.s(mat);
  for (let u = u0 + 0.3; u < u1 - 0.2; u += 0.32) kbox(S, F, u, u + 0.16, y - 0.72 - 0.16, y - 0.72 + 0.02, 0.18 * p, 0.18 * p + 0.16);
  for (let u = u0 + 0.6; u < u1 - 0.4; u += 0.9) kbox(S, F, u, u + 0.24, y - 0.62, y - 0.42, 0.42 * p, 0.86 * p, 0.02);
}
function band(K, mat, F, u0, u1, y0, y1, proj, m0 = 0, m1 = 0) {
  extrude(K.s(mat), F, [[0, y0], [proj, y0 + 0.04], [proj, y1], [0, y1 + 0.02]], u0, u1, { m0, m1 });
}
// a rectangular window: hole in the wall built by the caller (holes list), the reveal, the glass, a mullion cross, a sill
function windowRect(K, M, F, u0, u1, y0, y1, d, o = {}) {
  reveal(K.s(o.rev || M.dressed), F, { u0, u1, y0, y1 }, d);
  paneW(K.s(o.glass || M.glass), F, u0, u1, y0, y1, -d, (u0 * 7.3 + y0) % 97, 0.02);
  const fr = o.frame || M.bronze;
  const um = (u0 + u1) / 2;
  kbox(K.s(fr), F, um - 0.05, um + 0.05, y0, y1, -d, -d + 0.08);
  for (let y = y0 + (o.tr || 1.6); y < y1 - 0.4; y += o.tr || 1.6) kbox(K.s(fr), F, u0, u1, y - 0.04, y + 0.04, -d, -d + 0.07);
  if (o.sill !== false) kbox(K.s(o.rev || M.dressed), F, u0 - 0.15, u1 + 0.15, y0 - 0.22, y0, -0.02, 0.18, 0.02);
}
// a round-headed opening: jambs from yb to the springing ys, a semicircular head of radius (u1 - u0) / 2; returns the hole
// rectangle for wallWithHoles and fills the spandrels itself; reveal d deep, glass at the back, a fanlight's radial bars
function archOpening(K, M, F, u0, u1, yb, ys, d, wallMat, o = {}) {
  const r = (u1 - u0) / 2, uc = (u0 + u1) / 2, n = o.seg || 12;
  const arc = [];
  for (let i = 0; i <= n; i++) { const a = (Math.PI * i) / n; arc.push([uc + Math.cos(a) * r, ys + Math.sin(a) * r]); }
  // spandrels in the wall plane (the hole's box above the springing, outside the arc): fans from the box's top corners
  const S = K.s(wallMat);
  const half = n / 2;
  // (fans from the box's outer top corners, which see the whole quarter arc)
  poly(S, F, [[u1, ys + r, 0], ...arc.slice(0, half + 1).reverse().map(([u, y]) => [u, y, 0])], 0, 0, 1);
  poly(S, F, [[u0, ys + r, 0], ...arc.slice(half).reverse().map(([u, y]) => [u, y, 0])], 0, 0, 1);
  // the reveal: jambs, sill, intrados
  const R = K.s(o.rev || M.dressed);
  quadU(R, F, u0, yb, ys, -d, 0, 1); quadU(R, F, u1, yb, ys, -d, 0, -1);
  quadY(R, F, u0, u1, yb, -d, 0, 1);
  for (let i = 0; i < n; i++) {
    const [ua, ya] = arc[i], [ub, yb2] = arc[i + 1];
    const mx = (ua + ub) / 2 - uc, my = (ya + yb2) / 2 - ys, ml = Math.hypot(mx, my) || 1;
    poly(R, F, [[ua, ya, 0], [ub, yb2, 0], [ub, yb2, -d], [ua, ya, -d]], -mx / ml, -my / ml, 0);
  }
  // the archivolt: a moulded ring standing 0.12 proud round the head, a keystone
  if (o.archivolt !== false) {
    const av = o.av || 0.45, AV = K.s(o.avMat || M.dressed);
    for (let i = 0; i < n; i++) {
      const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n;
      const p = (a, rr) => [uc + Math.cos(a) * rr, ys + Math.sin(a) * rr];
      const [q0, q1, q2, q3] = [p(a0, r), p(a1, r), p(a1, r + av), p(a0, r + av)];
      poly(AV, F, [[q0[0], q0[1], 0.12], [q1[0], q1[1], 0.12], [q2[0], q2[1], 0.12], [q3[0], q3[1], 0.12]], 0, 0, 1);
      poly(AV, F, [[q3[0], q3[1], 0], [q2[0], q2[1], 0], [q2[0], q2[1], 0.12], [q3[0], q3[1], 0.12]], Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0);
      poly(AV, F, [[q0[0], q0[1], 0.12], [q1[0], q1[1], 0.12], [q1[0], q1[1], 0], [q0[0], q0[1], 0]], -Math.cos((a0 + a1) / 2), -Math.sin((a0 + a1) / 2), 0);
    }
    kbox(AV, F, uc - 0.45, uc + 0.45, ys + r - 0.15, ys + r + av + 0.35, 0, 0.25, 0.02);
    // the impost blocks at the springing
    kbox(AV, F, u0 - 0.35, u0 + 0.05, ys - 0.35, ys, 0, 0.18, 0.02); kbox(AV, F, u1 - 0.05, u1 + 0.35, ys - 0.35, ys, 0, 0.18, 0.02);
  }
  // the glass at the back of the reveal and its frame
  const G = K.s(o.glass || M.glass);
  paneW(G, F, u0, u1, yb, ys, -d, uc * 3.1, 0.015);
  poly(G, F, arc.map(([u, y]) => [u, y, -d]), 0, 0, 1);
  const fr = o.frame || M.bronze, FR = K.s(fr);
  const nm = o.mull ?? Math.max(1, Math.round((u1 - u0) / 1.6));
  for (let k = 1; k < nm; k++) { const u = u0 + ((u1 - u0) * k) / nm; kbox(FR, F, u - 0.05, u + 0.05, yb, ys + Math.sqrt(Math.max(0, r * r - (u - uc) * (u - uc))), -d, -d + 0.08); }
  for (let y = yb + (o.tr || 2.2); y < ys - 0.3; y += o.tr || 2.2) kbox(FR, F, u0, u1, y - 0.05, y + 0.05, -d, -d + 0.08);
  kbox(FR, F, u0, u1, ys - 0.06, ys + 0.06, -d, -d + 0.09);
  for (let k = 1; k < 4; k++) {   // the fanlight's radial bars
    const a = (Math.PI * k) / 4;
    bar(K, fr, P3(F, uc, ys, -d + 0.05), P3(F, uc + Math.cos(a) * r, ys + Math.sin(a) * r, -d + 0.05), 0.08);
  }
  return { u0, u1, y0: yb, y1: ys + r };
}
// a fluted column shaft (engaged when w0 > 0 puts its axis near the wall), base and capital, in the face frame
function column(K, M, F, u, w, r, y0, y1, o = {}) {
  const [x, , z] = P3(F, u, 0, w);
  const mat = o.mat || M.dressed;
  // the base: plinth and torus
  const pl = r * 1.35;
  kbox(K.s(mat), F, u - pl, u + pl, y0, y0 + 0.35, w - pl, w + pl, 0.02);
  cyl(K, mat, x, z, r * 1.2, r * 1.12, y0 + 0.35, y0 + 0.6, 16, false);
  // the shaft, tapering a sixth, in 20 flutes
  cyl(K, mat, x, z, r, r * 0.86, y0 + 0.6, y1 - 1.25, 20, false);
  // the capital: necking, bell (Corinthian, as a flared drum), abacus
  cyl(K, mat, x, z, r * 0.9, r * 0.9, y1 - 1.25, y1 - 1.15, 16, false);
  cyl(K, mat, x, z, r * 0.88, r * 1.18, y1 - 1.15, y1 - 0.3, 16, false);
  // the Corinthian bell's two rows of acanthus (leaves curling out from the bell) and the corner volutes under the abacus
  for (let k = 0; k < 16; k++) {
    const row = k & 1, a = ((k >> 1) / 8) * Math.PI * 2 + row * (Math.PI / 8) + Math.PI / 16;
    const ya = y1 - 1.15 + row * 0.3, yb2 = ya + 0.42, r0 = r * (0.9 + row * 0.08), r1 = r * (1.2 + row * 0.08);
    bar(K, mat, [x + Math.cos(a) * r0, ya, z + Math.sin(a) * r0], [x + Math.cos(a) * r1, yb2, z + Math.sin(a) * r1], r * 0.26);
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.atan2(F.nz, F.nx) + Math.PI / 4 + (k * Math.PI) / 2;
    bar(K, mat, [x + Math.cos(a) * r * 1.0, y1 - 0.62, z + Math.sin(a) * r * 1.0], [x + Math.cos(a) * r * 1.62, y1 - 0.3, z + Math.sin(a) * r * 1.62], r * 0.3);
  }
  const ab = r * 1.4;
  kbox(K.s(mat), F, u - ab, u + ab, y1 - 0.3, y1, w - ab, w + ab, 0.03);
}

// ---------------------------------------------------------------- the plan
// blocks: r [gx0, gx1, gn0, gn1] (or pts, a convex counter-clockwise polygon), h (wall top), ext (the outside walls' facade),
// side { e, n, w, s }: per-side facade overrides, roof(K, B): the roof, flat: a parapet round the deck
function plan() {
  const B = [];
  const add = (o) => { B.push(o); return o; };
  // the Fifth Avenue front
  add({ id: 'pavN', r: [50, 93.2, 88.4, 151], h: 24, ext: 'mmw', roof: 'pavN' });
  add({ id: 'huntNe', r: [70, 82, 30.6, 88.4], h: 22, ext: 'hunt', roof: 'tileHipN' });
  add({ id: 'huntNw', r: [50, 70, 30.6, 88.4], h: 21.5, ext: 'lime', roof: 'flatWarmN', flat: true });
  add({ id: 'hall', r: [50, 83.3, -33.5, 30.6], h: 27, ext: 'pavilion', roof: 'hall' });
  add({ id: 'huntSe', r: [70, 82, -90.3, -33.5], h: 22, ext: 'hunt', roof: 'tileHipS' });
  add({ id: 'huntSw', r: [50, 70, -90.3, -33.5], h: 21.5, ext: 'lime', roof: 'flatWarmS', flat: true });
  add({ id: 'pavS', r: [48, 94, -152.8, -90.3], h: 24, ext: 'mmw', roof: 'pavS' });
  // the north: the glazed wing, the American Wing (the glass court, the glass tent, the plant), the 1880 building
  add({ id: 'northGlass', r: [-18, 50, 98, 141], h: 22, ext: 'glass', side: { n: 'none' }, roof: 'ridgesN' });
  add({ id: 'amTent', r: [-77, -41, 87.6, 139], h: 9, ext: 'lime', roof: 'tent' });
  add({ id: 'amPlant', r: [-41, -18, 87.6, 139], h: 24, ext: 'lime', roof: 'plantN', flat: true });
  add({ id: 'amCourt', r: [-52, -18, 46, 87.6], h: 20, ext: 'lime', roof: 'court' });
  add({ id: 'midN', r: [-18, -8, 46, 98], h: 22, ext: 'lime', roof: 'midN', flat: true });
  add({ id: 'vaux', r: [-8, 8, 46, 98], h: 27.5, ext: 'brick', step: 'brick', side: { e: 'arcade', w: 'arcade' }, roof: 'vaux' });
  add({ id: 'eastN', r: [8, 50, 46, 98], h: 21, ext: 'lime', roof: 'plantE', flat: true });
  // the middle: the paintings galleries, the warm decks east of them, the plant south of them
  add({ id: 'paint', r: [-52, 15, -50, 46], h: 23, ext: 'lime', roof: 'paint', flat: true });
  add({ id: 'warm', r: [15, 50, -50, 46], h: 23, ext: 'lime', roof: 'warm', flat: true });
  add({ id: 'midS', r: [-52, 15, -90.3, -50], h: 22, ext: 'lime', roof: 'plantS', flat: true });
  add({ id: 'eastS', r: [15, 50, -90.3, -50], h: 22.5, ext: 'lime', roof: 'plantSE', flat: true });
  // the park side: the lean-to glazing, the Lehman Wing and its link
  add({ id: 'leanN', r: [-60, -52, 14.3, 87.6], h: 9, ext: 'glass', roof: 'leanN' });
  add({ id: 'leanS', r: [-60, -52, -90.3, -16.7], h: 9, ext: 'glass', roof: 'leanS' });
  add({ id: 'link', r: [-60, -52, -16.7, 14.3], h: 13, ext: 'lime', roof: 'link', flat: true });
  add({ id: 'lehman', pts: [[-60, -29.6], [-60, 27.1], [-73, 27.1], [-95.8, 4.2], [-95.9, -6.5], [-72.2, -29.6]], h: 11, ext: 'lime', roof: 'lehman' });
  // the south: the glazed wing, the low south-west wing (its glass skirt), the roof garden
  add({ id: 'southGlass', r: [-18, 48, -147.6, -90.3], h: 21, ext: 'glass', roof: 'ridgesS' });
  add({ id: 'swLow', r: [-76, -50, -142.4, -90.3], h: 15, ext: 'skirt', roof: 'swLow', flat: true });
  add({ id: 'garden', r: [-50, -18, -142.4, -90.3], h: 22, ext: 'lime', roof: 'garden', flat: true });
  for (const b of B) if (!b.pts) { const [x0, x1, n0, n1] = b.r; b.pts = [[x0, n0], [x1, n0], [x1, n1], [x0, n1]]; }
  return B;
}
function inPoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
// the highest wall top of another block at a grid point (-Infinity: outside the museum)
function hAt(B, self, x, y) {
  let h = -Infinity;
  for (const b of B) if (b !== self && b.h > h && inPoly(b.pts, x, y)) h = b.h;
  return h;
}
const sideOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 'n' : 's');

// ---------------------------------------------------------------- one exposed run of a block's wall
function wallRun(K, M, B, F, u0, u1, ya, style, top) {
  const yb = top;
  if (u1 - u0 < 0.05 || yb - ya < 0.05) return;
  if (style === 'none') return;
  if (style === 'mmw') return facMMW(K, M, F, u0, u1, ya, yb);
  if (style === 'hunt') return facHunt(K, M, F, u0, u1, ya, yb);
  if (style === 'pavilion') return facPavilion(K, M, F, u0, u1, ya, yb);
  if (style === 'glass') return facGlass(K, M, F, u0, u1, ya, yb, B);
  if (style === 'skirt') return facSkirt(K, M, F, u0, u1, ya, yb);
  if (style === 'arcade') return facArcade(K, M, F, u0, u1, ya, yb);
  if (style === 'brick') return facPlain(K, M, F, u0, u1, ya, yb, M.brick, B);
  if (style === 'inner') return facPlain(K, M, F, u0, u1, ya, yb, M.inner, B);
  return facLime(K, M, F, u0, u1, ya, yb, B);
}
// the parapet's coping or the eave's cornice at the wall's top
function wallTop(K, M, F, u0, u1, yb, B, mat) {
  if (B.flat) {
    quadW(K.s(mat), F, u0, u1, yb, yb + 0.9, 0);
    quadW(K.s(mat), F, u0, u1, yb, yb + 0.9, -0.35, true);
    extrude(K.s(M.dressed), F, [[-0.45, yb + 0.9], [0.06, yb + 0.9], [0.06, yb + 1.05], [-0.45, yb + 1.05]], u0, u1, {});
  } else extrude(K.s(M.dressed), F, [[0, yb - 0.5], [0.25, yb - 0.45], [0.35, yb - 0.2], [0.55, yb], [0, yb]], u0, u1, {});
}
function facPlain(K, M, F, u0, u1, ya, yb, mat, B) {
  quadW(K.s(mat), F, u0, u1, ya, yb, 0);
  band(K, M.dressed, F, u0, u1, ya, ya + 0.3, 0.06);
  wallTop(K, M, F, u0, u1, yb, B, mat);
}
// the 1970s-2000s additions' limestone: a granite water table, ashlar, shadow joints every 9 m, a deep coping
function facLime(K, M, F, u0, u1, ya, yb, B) {
  const ext = ya < 0;
  const g1 = ext ? 1.1 : ya;
  if (ext) kbox(K.s(M.granite), F, u0, u1, ya, g1, -0.2, 0.08, 0.02);
  const L = u1 - u0, n = Math.max(1, Math.round(L / 9));
  for (let k = 0; k < n; k++) {
    const a = u0 + (L * k) / n + (k ? 0.12 : 0), b = u0 + (L * (k + 1)) / n - (k < n - 1 ? 0.12 : 0);
    quadW(K.s(ext ? M.modern : M.inner), F, a, b, g1, yb, 0);
    if (k < n - 1) { const c = u0 + (L * (k + 1)) / n; quadW(K.s(M.inner), F, c - 0.12, c + 0.12, g1, yb, -0.15); quadU(K.s(M.inner), F, c - 0.12, g1, yb, -0.15, 0, 1); quadU(K.s(M.inner), F, c + 0.12, g1, yb, -0.15, 0, -1); }
  }
  wallTop(K, M, F, u0, u1, yb, B, ext ? M.modern : M.inner);
}
// curtain glass: a stone sill, mullions every 1.6 m, transoms every 3.3 m, a fascia
function facGlass(K, M, F, u0, u1, ya, yb, B) {
  const g0 = Math.max(ya, 0.9), f0 = yb - 1.1;
  if (ya < 0) kbox(K.s(M.granite), F, u0, u1, ya, 0.9, -0.3, 0.1, 0.02);
  const L = u1 - u0, n = Math.max(1, Math.round(L / 1.6));
  for (let k = 0; k < n; k++) {
    const a = u0 + (L * k) / n, b = u0 + (L * (k + 1)) / n;
    for (let y = g0; y < f0 - 0.05; y += 3.3) paneW(K.s(M.glass), F, a, b, y, Math.min(f0, y + 3.3), -0.15, a * 1.3 + y, 0.02);
    kbox(K.s(M.frame), F, b - 0.05, b + 0.05, g0, f0, -0.15, 0.12);
  }
  for (let y = g0 + 3.3; y < f0 - 0.2; y += 3.3) kbox(K.s(M.frame), F, u0, u1, y - 0.05, y + 0.05, -0.15, 0.06);
  kbox(K.s(M.lead), F, u0, u1, f0, yb, -0.2, 0.15, 0.02);
  if (B.flat) wallTop(K, M, F, u0, u1, yb, B, M.modern);
}
// the south-west wing's glass skirt: sloped glazing from the ground (2.6 m out) back to the wall at 9 m, ashlar above
function facSkirt(K, M, F, u0, u1, ya, yb) {
  const yt = Math.min(9, yb - 1), out = 2.6, L = u1 - u0, n = Math.max(1, Math.round(L / 1.6));
  kbox(K.s(M.granite), F, u0, u1, ya, 0.5, -0.2, out + 0.25, 0.02);
  const sl = yt - 0.5, nw = sl / Math.hypot(sl, out), ny = out / Math.hypot(sl, out);
  for (let k = 0; k < n; k++) {
    const a = u0 + (L * k) / n, b = u0 + (L * (k + 1)) / n;
    poly(K.s(M.glass), F, [[a, 0.5, out], [b, 0.5, out], [b, yt, 0], [a, yt, 0]], 0, ny, nw);
    bar(K, M.frame, P3(F, b, 0.5, out + 0.05), P3(F, b, yt, 0.05), 0.12);
  }
  for (const f of [0.33, 0.66]) bar(K, M.frame, P3(F, u0, 0.5 + sl * f, out * (1 - f) + 0.05), P3(F, u1, 0.5 + sl * f, out * (1 - f) + 0.05), 0.1);
  // the end cheeks (triangles of glass)
  poly(K.s(M.glass), F, [[u0, 0.5, 0], [u0, 0.5, out], [u0, yt, 0]], -1, 0, 0);
  poly(K.s(M.glass), F, [[u1, 0.5, out], [u1, 0.5, 0], [u1, yt, 0]], 1, 0, 0);
  quadW(K.s(M.modern), F, u0, u1, yt, yb, 0);
  band(K, M.dressed, F, u0, u1, yt, yt + 0.4, 0.15);
  wallTop(K, M, F, u0, u1, yb, { flat: true }, M.modern);
}
// the 1880 building's clerestory: round-arched windows in buff brick with stone archivolts, between brick piers
function facArcade(K, M, F, u0, u1, ya, yb) {
  if (u1 - u0 < 6) return facPlain(K, M, F, u0, u1, ya, yb, M.brick, { flat: false });
  const L = u1 - u0, n = Math.max(1, Math.round(L / 8.6)), pitch = L / n, holes = [];
  const yb0 = ya + 0.6, ow = Math.min(4.8, pitch - 2.4), r = ow / 2, ys = Math.min(yb - r - 0.9, yb0 + 3.2);
  for (let k = 0; k < n; k++) {
    const c = u0 + pitch * (k + 0.5);
    holes.push(archOpening(K, M, F, c - r, c + r, yb0, ys, 0.6, M.brick, { av: 0.4, seg: 12, tr: 1.6 }));
    // the pilaster strips between the bays
    if (k > 0) kbox(K.s(M.brick), F, u0 + pitch * k - 0.6, u0 + pitch * k + 0.6, ya, yb - 0.8, 0, 0.25, 0.02);
  }
  wallWithHoles(K.s(M.brick), F, u0, u1, ya, yb, holes, 0);
  band(K, M.dressed, F, u0, u1, ya, ya + 0.5, 0.12);
  band(K, M.dressed, F, u0, u1, ys - 0.2, ys, 0.06);
  cornice(K, M.dressed, F, u0, u1, yb, 0.7);
}
// a short return of a classical front: granite, a rusticated base, ashlar, the entablature's band and the crown
function facReturn(K, M, F, u0, u1, ya, yb, yEnt, yCor) {
  kbox(K.s(M.granite), F, u0, u1, ya, 1.0, -0.1, 0.12, 0.02);
  quadW(K.s(M.rustic), F, u0, u1, 1.0, 7.0, 0.1);
  quadW(K.s(M.ashlar), F, u0, u1, 7.0, yb, 0);
  band(K, M.dressed, F, u0, u1, 7.0, 7.6, 0.35);
  band(K, M.dressed, F, u0, u1, yEnt, yEnt + 0.8, 0.3);
  cornice(K, M.dressed, F, u0, u1, yCor, 1.0);
  cornice(K, M.dressed, F, u0, u1, yb, 0.45);
}
// the north and south wings on Fifth Avenue (1911-26): a rusticated base with square windows, the giant order of engaged
// columns between tall windows with pedimented hoods, an entablature breaking forward over the columns, an attic, a cornice
function facMMW(K, M, F, u0, u1, ya, yb) {
  const L = u1 - u0;
  const yBase = 7.0, yOrd = 7.6, yEnt = 18.6, yFr = 19.4, yCor = 20.8;
  if (L < 14) {   // a short return: rusticated base, plain ashlar, the crown
    kbox(K.s(M.granite), F, u0, u1, ya, 1.0, -0.1, 0.12, 0.02);
    quadW(K.s(M.rustic), F, u0, u1, 1.0, yBase, 0.1);
    quadW(K.s(M.ashlar), F, u0, u1, yBase, yb, 0);
    band(K, M.dressed, F, u0, u1, yBase, yOrd, 0.35);
    band(K, M.dressed, F, u0, u1, yEnt, yFr, 0.3);
    cornice(K, M.dressed, F, u0, u1, yCor, 1.0);
    cornice(K, M.dressed, F, u0, u1, yb, 0.45);
    return;
  }
  const endW = 3.2, nb = Math.max(1, Math.round((L - 2 * endW) / 7.4)), pitch = (L - 2 * endW) / nb;
  const baseHoles = [], mainHoles = [], atticHoles = [];
  for (let k = 0; k < nb; k++) {
    const c = u0 + endW + pitch * (k + 0.5);
    baseHoles.push({ u0: c - 0.9, u1: c + 0.9, y0: 2.4, y1: 5.0 });
    mainHoles.push({ u0: c - 1.3, u1: c + 1.3, y0: 9.4, y1: 15.8 });
    atticHoles.push({ u0: c - 0.8, u1: c + 0.8, y0: 21.6, y1: 22.9 });
  }
  kbox(K.s(M.granite), F, u0, u1, ya, 1.0, -0.1, 0.22, 0.02);
  wallWithHoles(K.s(M.rustic), F, u0, u1, 1.0, yBase, baseHoles, 0.1);
  wallWithHoles(K.s(M.ashlar), F, u0, u1, yOrd, yEnt, mainHoles, 0);
  wallWithHoles(K.s(M.ashlar), F, u0, u1, yCor, yb, atticHoles, 0);
  quadW(K.s(M.dressed), F, u0, u1, yBase, yOrd, 0);
  band(K, M.dressed, F, u0, u1, yBase, yOrd, 0.4);
  for (const h of baseHoles) { windowRect(K, M, F, h.u0, h.u1, h.y0, h.y1, 0.45, { tr: 1.3 }); kbox(K.s(M.dressed), F, (h.u0 + h.u1) / 2 - 0.35, (h.u0 + h.u1) / 2 + 0.35, h.y1, h.y1 + 0.7, 0.1, 0.32, 0.02); }
  for (const h of mainHoles) {
    windowRect(K, M, F, h.u0, h.u1, h.y0, h.y1, 0.5, { tr: 2.1 });
    // the architrave round the window, the hood on consoles, the panel under the sill
    kbox(K.s(M.dressed), F, h.u0 - 0.35, h.u0, h.y0, h.y1, 0, 0.14); kbox(K.s(M.dressed), F, h.u1, h.u1 + 0.35, h.y0, h.y1, 0, 0.14);
    kbox(K.s(M.dressed), F, h.u0 - 0.35, h.u1 + 0.35, h.y1, h.y1 + 0.35, 0, 0.14);
    kbox(K.s(M.dressed), F, h.u0 - 0.6, h.u1 + 0.6, h.y1 + 1.0, h.y1 + 1.3, 0, 0.45, 0.03);
    const um = (h.u0 + h.u1) / 2;
    poly(K.s(M.dressed), F, [[h.u0 - 0.6, h.y1 + 1.3, 0.45], [h.u1 + 0.6, h.y1 + 1.3, 0.45], [um, h.y1 + 2.2, 0.45]], 0, 0, 1);
    poly(K.s(M.dressed), F, [[h.u1 + 0.6, h.y1 + 1.3, 0], [h.u1 + 0.6, h.y1 + 1.3, 0.45], [um, h.y1 + 2.2, 0.45], [um, h.y1 + 2.2, 0]], 0.7, 0.7, 0);
    poly(K.s(M.dressed), F, [[um, h.y1 + 2.2, 0], [um, h.y1 + 2.2, 0.45], [h.u0 - 0.6, h.y1 + 1.3, 0.45], [h.u0 - 0.6, h.y1 + 1.3, 0]], -0.7, 0.7, 0);
    for (const s of [h.u0 - 0.55, h.u1 + 0.25]) kbox(K.s(M.dressed), F, s, s + 0.3, h.y1 + 0.35, h.y1 + 1.0, 0, 0.35, 0.02);
    kbox(K.s(M.dressed), F, h.u0, h.u1, h.y0 - 1.6, h.y0 - 0.25, 0, 0.08, 0.02);
  }
  for (const h of atticHoles) windowRect(K, M, F, h.u0, h.u1, h.y0, h.y1, 0.3, { tr: 9, sill: false });
  // the giant order: engaged columns at the bay lines, pilasters at the ends
  for (let k = 0; k <= nb; k++) {
    const u = u0 + endW + pitch * k;
    kbox(K.s(M.dressed), F, u - 1.0, u + 1.0, yOrd, yOrd + 1.0, 0, 1.25, 0.03);
    column(K, M, F, u, 0.5, 0.72, yOrd + 1.0, yEnt);
    kbox(K.s(M.dressed), F, u - 1.1, u + 1.1, yEnt, yCor - 0.9, 0, 1.0, 0.03);   // the entablature breaking forward
  }
  for (const [a, b] of [[u0, u0 + endW - 1.2], [u1 - endW + 1.2, u1]]) {
    kbox(K.s(M.ashlar), F, a, b, yOrd, yEnt, 0, 0.35, 0.02);
    for (let y = yOrd + 0.6; y < yEnt - 0.3; y += 0.9) kbox(K.s(M.ashlar), F, a, b, y - 0.03, y + 0.03, 0.3, 0.4);
  }
  quadW(K.s(M.dressed), F, u0, u1, yEnt, yCor, 0);
  band(K, M.dressed, F, u0, u1, yEnt, yFr, 0.25);
  cornice(K, M.dressed, F, u0, u1, yCor, 1.15);
  // the attic's balustraded parapet over the cornice's line: dies over the columns, balusters between
  cornice(K, M.dressed, F, u0, u1, yb, 0.5);
  balustrade(K, M, F, u0, u1, yb, 0.3, nb, endW, pitch);
}
function balustrade(K, M, F, u0, u1, y, w, nb, endW, pitch) {
  const yt = y + 1.1;
  kbox(K.s(M.dressed), F, u0, u1, y, y + 0.2, w - 0.25, w + 0.25, 0.02);
  kbox(K.s(M.dressed), F, u0, u1, yt - 0.18, yt, w - 0.28, w + 0.28, 0.02);
  for (let k = 0; k <= nb; k++) { const u = u0 + endW + pitch * k; kbox(K.s(M.dressed), F, u - 0.45, u + 0.45, y, yt + 0.05, w - 0.3, w + 0.3, 0.02); }
  for (const u of [u0 + 0.45, u1 - 0.45]) kbox(K.s(M.dressed), F, u - 0.45, u + 0.45, y, yt + 0.05, w - 0.3, w + 0.3, 0.02);
  for (let u = u0 + 1.2; u < u1 - 1.0; u += 0.42) {
    const [x, , z] = P3(F, u, 0, w);
    cyl(K, M.dressed, x, z, 0.09, 0.14, y + 0.2, y + 0.55, 6, false);
    cyl(K, M.dressed, x, z, 0.14, 0.08, y + 0.55, yt - 0.18, 6, false);
  }
}
// Hunt's wings beside the central pavilion: a rusticated base, the piano nobile's round-headed windows between paired
// pilasters, the entablature, an attic with panels, a cornice
function facHunt(K, M, F, u0, u1, ya, yb) {
  const L = u1 - u0, yBase = 7.6, yEnt = 17.8, yCor = 19.6;
  if (L < 5) return facReturn(K, M, F, u0, u1, ya, yb, yEnt, yCor);
  const nb = Math.max(1, Math.round(L / 6.8)), pitch = L / nb, holes = [], baseHoles = [];
  kbox(K.s(M.granite), F, u0, u1, ya, 1.0, -0.1, 0.25, 0.02);
  for (let k = 0; k < nb; k++) {
    const c = u0 + pitch * (k + 0.5);
    baseHoles.push({ u0: c - 1.0, u1: c + 1.0, y0: 2.2, y1: 5.4 });
  }
  wallWithHoles(K.s(M.rustic), F, u0, u1, 1.0, yBase, baseHoles, 0.12);
  for (const h of baseHoles) { windowRect(K, M, F, h.u0, h.u1, h.y0, h.y1, 0.45, { tr: 1.6 }); kbox(K.s(M.dressed), F, (h.u0 + h.u1) / 2 - 0.4, (h.u0 + h.u1) / 2 + 0.4, h.y1, h.y1 + 0.9, 0.12, 0.36, 0.02); }
  band(K, M.dressed, F, u0, u1, yBase, yBase + 0.6, 0.4);
  for (let k = 0; k < nb; k++) {
    const c = u0 + pitch * (k + 0.5);
    holes.push(archOpening(K, M, F, c - 1.45, c + 1.45, 9.6, 14.3, 0.55, M.ashlar, { av: 0.4, tr: 2.2 }));
    kbox(K.s(M.dressed), F, c - 1.75, c + 1.75, 9.15, 9.6, 0, 0.3, 0.02);   // the balcony sill
  }
  wallWithHoles(K.s(M.ashlar), F, u0, u1, yBase + 0.6, yEnt, holes, 0);
  for (let k = 0; k <= nb; k++) {   // paired pilasters at the bay lines
    const u = u0 + pitch * k;
    for (const d of [-0.95, 0.95]) {
      const a = Math.max(u0, u + d - 0.42), b = Math.min(u1, u + d + 0.42);
      if (b - a < 0.2) continue;
      kbox(K.s(M.dressed), F, a, b, yBase + 0.6, yEnt - 1.0, 0, 0.3, 0.02);
      kbox(K.s(M.dressed), F, a - 0.08, b + 0.08, yEnt - 1.0, yEnt, 0, 0.42, 0.02);   // the capital block
    }
  }
  quadW(K.s(M.dressed), F, u0, u1, yEnt, yCor, 0);
  band(K, M.dressed, F, u0, u1, yEnt, yEnt + 0.7, 0.2);
  cornice(K, M.dressed, F, u0, u1, yCor, 1.0);
  quadW(K.s(M.ashlar), F, u0, u1, yCor, yb, 0);
  for (let k = 0; k < nb; k++) { const c = u0 + pitch * (k + 0.5); kbox(K.s(M.dressed), F, c - 1.6, c + 1.6, yCor + 0.5, yb - 0.6, 0, 0.1, 0.02); }
  cornice(K, M.dressed, F, u0, u1, yb, 0.4);
}
// the central pavilion (Richard Morris Hunt, 1902): three great arched entrances between four pairs of free-standing
// Corinthian columns on pedestals, the entablature breaking forward over each pair, the uncarved sculpture blocks on top,
// plain end bays with niches, the attic and its cornice; the front steps are drawn with the plan (frontSteps)
function facPavilion(K, M, F, u0, u1, ya, yb) {
  const L = u1 - u0, c = (u0 + u1) / 2, yE = 2.4;
  const yEnt = 19.6, yCor = 22.2;
  if (L < 44) return facReturn(K, M, F, u0, u1, ya, yb, yEnt, yCor);
  const arches = [-11.4, 0, 11.4].map((d) => c + d), pairs = [-17.1, -5.7, 5.7, 17.1].map((d) => c + d);
  const holes = [];
  kbox(K.s(M.granite), F, u0, u1, ya, yE, -0.1, 0.3, 0.02);
  for (const a of arches) {
    holes.push(archOpening(K, M, F, a - 4.0, a + 4.0, yE, 13.4, 1.6, M.ashlar, { av: 0.7, seg: 16, tr: 3.0, mull: 4 }));
    // three pairs of bronze doors under a transom bar, in front of the glass
    kbox(K.s(M.bronze), F, a - 4.0, a + 4.0, yE + 4.6, yE + 5.1, -1.6, -1.35, 0.02);
    for (const d of [-2.6, 0, 2.6]) {
      kbox(K.s(M.bronze), F, a + d - 1.15, a + d + 1.15, yE, yE + 4.6, -1.62, -1.48, 0.02);
      for (const yy of [yE + 1.2, yE + 3.0]) kbox(K.s(M.bronze), F, a + d - 1.0, a + d + 1.0, yy, yy + 0.08, -1.48, -1.42);
      kbox(K.s(M.bronze), F, a + d - 0.03, a + d + 0.03, yE, yE + 4.6, -1.48, -1.42);
    }
  }
  // the end bays' niches (shallow round-headed recesses)
  const ends = [[u0, c - 20.4], [c + 20.4, u1]];
  for (const [a, b] of ends) {
    if (b - a < 4) continue;
    const m = (a + b) / 2;
    holes.push(archOpening(K, M, F, m - 1.5, m + 1.5, 8.0, 13.0, 0.9, M.ashlar, { av: 0.35, glass: M.ashlar, frame: M.dressed, mull: 1, tr: 99 }));
    kbox(K.s(M.dressed), F, m - 2.0, m + 2.0, 7.4, 8.0, 0, 0.45, 0.02);
    holes.push({ u0: m - 1.1, u1: m + 1.1, y0: 3.4, y1: 5.8 });
    windowRect(K, M, F, m - 1.1, m + 1.1, 3.4, 5.8, 0.4, { tr: 1.2 });
  }
  // the end bays rusticated, the arcade's wall ashlar
  wallWithHoles(K.s(M.rustic), F, u0, c - 20.4, yE, yEnt, holes, 0);
  wallWithHoles(K.s(M.ashlar), F, c - 20.4, c + 20.4, yE, yEnt, holes, 0);
  wallWithHoles(K.s(M.rustic), F, c + 20.4, u1, yE, yEnt, holes, 0);
  for (const e of [c - 20.4, c + 20.4]) kbox(K.s(M.dressed), F, e - 0.6, e + 0.6, yE, yEnt, 0, 0.3, 0.02);
  // the pairs: pedestal, column, the entablature's ressaut, the block on top
  for (const p of pairs) {
    kbox(K.s(M.dressed), F, p - 2.4, p + 2.4, yE, yE + 3.4, 0, 3.2, 0.04);
    kbox(K.s(M.dressed), F, p - 2.55, p + 2.55, yE + 3.0, yE + 3.4, 0, 3.35, 0.03);
    for (const d of [-1.2, 1.2]) column(K, M, F, p + d, 1.75, 0.82, yE + 3.4, yEnt);
    kbox(K.s(M.ashlar), F, p - 2.0, p + 2.0, yE + 3.4, yEnt, 0, 0.35, 0.02);   // the pilasters behind
    kbox(K.s(M.dressed), F, p - 2.5, p + 2.5, yEnt, yCor - 0.9, 0, 2.9, 0.03);
    extrude(K.s(M.dressed), F, [[0, yCor - 0.9], [2.9, yCor - 0.9], [3.1, yCor - 0.6], [3.4, yCor - 0.25], [3.4, yCor], [0, yCor]], p - 2.7, p + 2.7, {});
    kbox(K.s(M.dressed), F, p - 2.0, p + 2.0, yCor, yCor + 3.8, 0.3, 2.9, 0.06);   // the sculpture block
    kbox(K.s(M.dressed), F, p - 2.2, p + 2.2, yCor + 3.8, yCor + 4.2, 0.1, 3.1, 0.04);
  }
  quadW(K.s(M.dressed), F, u0, u1, yEnt, yCor, 0);
  band(K, M.dressed, F, u0, u1, yEnt, yEnt + 0.8, 0.3);
  cornice(K, M.dressed, F, u0, u1, yCor, 1.2);
  // the attic: ashlar with recessed panels over the arches, its crown
  quadW(K.s(M.ashlar), F, u0, u1, yCor, yb, 0);
  for (const a of arches) { kbox(K.s(M.dressed), F, a - 4.2, a + 4.2, yCor + 0.6, yb - 1.0, 0, 0.12, 0.02); kbox(K.s(M.ashlar), F, a - 3.7, a + 3.7, yCor + 1.0, yb - 1.4, 0.12, 0.16); }
  cornice(K, M.dressed, F, u0, u1, yb, 0.6);
}

// ---------------------------------------------------------------- the roofs of the plan
function roofs(K, PF, M, B, b) {
  const [gx0, gx1, gn0, gn1] = b.r || [0, 0, 0, 0], h = b.h;
  const deck = (mat, r = b.r, y = h) => face(K, mat, [PF.G3(r[0], r[2], y), PF.G3(r[1], r[2], y), PF.G3(r[1], r[3], y), PF.G3(r[0], r[3], y)]);
  switch (b.roof) {
    case 'pavN': {   // the north pavilion: a lead hip round a deck, the glass pyramid, a frosted skylight
      hipRoof(K, PF, M.lead, b.r, h, 28, 6, {
        seam: 0.75, cap: M.lead,
        top: (t, y) => {
          deck(M.deck, t, y);
          lantern(K, PF, M, [57, 74, 107, 129], y, 0.8, 32, { seed: 3 });
          curbRing(K, PF, M.lead, [58, 79, 132, 141], y, y + 0.7);
          glazed(K, M, PF.G3(58.3, 132.3, y + 0.75), PF.G3(78.7, 132.3, y + 0.75), PF.G3(78.7, 140.7, y + 1.3), PF.G3(58.3, 140.7, y + 1.3), { pw: 1.4, pp: 1.4, seed: 9, glass: M.sky });
          hvac(K, PF, M, 82, 116, 4, 7, 2.2, y);
        },
      });
      break;
    }
    case 'tileHipN': case 'tileHipS':
      hipRoof(K, PF, M.tileW, b.r, h, 24, 99, { course: 0.36, mat2: M.tile2, cap: M.tile2 });
      break;
    case 'flatWarmN': case 'flatWarmS': {
      deck(M.deckWarm); joints(K, PF, M, b.r, h, 2.4);
      if (b.roof === 'flatWarmN') {
        lantern(K, PF, M, [56, 66, 48, 80], h, 0.9, 30, { seed: 5 });
        // the lead pyramid over the room north of the Great Hall
        hipRoof(K, PF, M.lead, [52, 68, 31.5, 45.5], h, 30, 99, { seam: 0.7, cap: M.lead });
        hvac(K, PF, M, 62, 84, 6, 3, 2.0, h);
      } else {
        lantern(K, PF, M, [58, 66, -84, -54], h, 0.9, 30, { seed: 6 });
        glassHip(K, PF, M, [52, 69, -49, -35], h + 0.6, 99, 28, { seed: 7 });
        curbRing(K, PF, M.lead, [52, 69, -49, -35], h, h + 0.6, false);
      }
      break;
    }
    case 'hall': {   // the Great Hall: a tile hip over the pavilion, its deck carrying the three oculi of the saucer domes
      hipRoof(K, PF, M.tileG, [50, 81.5, -33.5, 30.6], h, 22, 9, {
        course: 0.36, mat2: M.tileW, cap: M.lead,
        top: (t, y) => {
          deck(M.lead, t, y);
          for (const n of [-17, 0, 17]) {
            const p = PF.P(67, n);
            cyl(K, M.lead, p[0], p[1], 3.8, 3.1, y, y + 0.8, 24, false);
            cyl(K, M.frame, p[0], p[1], 3.1, 3.1, y + 0.8, y + 1.0, 24, false);
            // the oculus' glass cone over the dome's eye, its ribs
            for (let i = 0; i < 12; i++) {
              const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
              face(K, M.sky, [[p[0] + Math.cos(a0) * 3.0, y + 1.0, p[1] + Math.sin(a0) * 3.0], [p[0], y + 2.0, p[1]], [p[0] + Math.cos(a1) * 3.0, y + 1.0, p[1] + Math.sin(a1) * 3.0]]);
              bar(K, M.frame, [p[0] + Math.cos(a0) * 3.0, y + 1.05, p[1] + Math.sin(a0) * 3.0], [p[0], y + 2.05, p[1]], 0.1);
            }
          }
        },
      });
      deck(M.lead, [81.5, 83.3, -33.5, 30.6], h);   // the strip behind the attic's crown
      break;
    }
    case 'pavS': {   // the south pavilion: a tile hip rising to a flat ring round a sunk court with its own glass hip
      const court = [57, 85, -136, -106];
      hipRoof(K, PF, M.tile, b.r, h, 24, 6.5, {
        course: 0.36, mat2: M.tile2, cap: M.tile2,
        top: (t, y) => {
          // the ring deck with the court cut out, the court's walls down to its glass
          const S = K.s(M.deckWarm);
          const ring = [[t[0], t[2]], [t[1], t[2]], [t[1], t[3]], [t[0], t[3]]].map(([a, c]) => PF.P(a, c));
          const hole = [[court[0], court[2]], [court[0], court[3]], [court[1], court[3]], [court[1], court[2]]].map(([a, c]) => PF.P(a, c));
          flatRing(S, ring, y, [0, 0], false, [hole]);
          const yc = y - 6.5;
          const cc = [[court[0], court[2]], [court[1], court[2]], [court[1], court[3]], [court[0], court[3]]];
          for (let i = 0; i < 4; i++) {
            const a = cc[i], bb = cc[(i + 1) % 4];
            face(K, M.ashlar, [PF.G3(bb[0], bb[1], yc), PF.G3(a[0], a[1], yc), PF.G3(a[0], a[1], y), PF.G3(bb[0], bb[1], y)]);
            // the court's coping
            bar(K, M.dressed, PF.G3(a[0], a[1], y + 0.15), PF.G3(bb[0], bb[1], y + 0.15), 0.4);
          }
          glassHip(K, PF, M, [court[0] + 0.5, court[1] - 0.5, court[2] + 0.5, court[3] - 0.5], yc, 3.5, 25, { seed: 11 });
          deck(M.lead, [court[0], court[1], court[2], court[3]], yc - 0.05);
        },
      });
      break;
    }
    case 'ridgesN': {
      ridges(K, PF, M, b.r, h, 'n', 10, 2.8, { seed: 1 });
      // the sloped glass wall over the park: from a granite curb at the ring's line (5 m out) up to the roof's edge
      const yb = 1.0, yt = h + 0.6;
      gbox(K, PF, M.granite, gx0 - 0.4, gx1 + 0.4, gn1 + 4.6, gn1 + 5.6, -6, yb);
      glazed(K, M, PF.G3(gx1, gn1 + 5, yb), PF.G3(gx0, gn1 + 5, yb), PF.G3(gx0, gn1, yt), PF.G3(gx1, gn1, yt), { pw: 1.7, pp: 3.0, seed: 51, glass: M.glass, bt: 0.12 });
      for (const [gx, sg] of [[gx0, -1], [gx1, 1]]) {
        const tri = [PF.G3(gx, gn1, yb), PF.G3(gx, gn1 + 5, yb), PF.G3(gx, gn1, yt)];
        // (seen from the east the ring's south end is on the left: these orders face +gx; the west end turns them)
        face(K, M.glass, sg > 0 ? tri : tri.reverse());
        const q = [PF.G3(gx, gn1, -6), PF.G3(gx, gn1 + 5, -6), PF.G3(gx, gn1 + 5, yb), PF.G3(gx, gn1, yb)];
        face(K, M.modern, sg > 0 ? q : q.reverse());
      }
      bar(K, M.lead, PF.G3(gx0, gn1, yt + 0.1), PF.G3(gx1, gn1, yt + 0.1), 0.45);
      break;
    }
    case 'ridgesS': ridges(K, PF, M, b.r, h, 'n', 14, 2.2, { seed: 2 }); break;
    case 'court': {   // the American Wing's garden court: glass ridges over the court, a sawtooth on its east side
      ridges(K, PF, M, [gx0, gx1 - 6, gn0, gn1], h, 'n', 5, 3.0, { seed: 4 });
      deck(M.lead, [gx1 - 6, gx1, gn0, gn1], h);
      for (let n = gn0 + 1; n < gn1 - 4; n += 5) glassHip(K, PF, M, [gx1 - 5.5, gx1 - 0.5, n, n + 4.2], h + 0.3, 99, 35, { seed: n });
      break;
    }
    case 'tent': {   // the American Wing's glass tent: steep glazing from the stone base up to a ridged glass top
      glassHip(K, PF, M, b.r, h, 11, 49, { seed: 13, pw: 1.5, pp: 2.0 });
      break;
    }
    case 'plantN': case 'plantE': case 'plantS': case 'plantSE': case 'midN': case 'link': case 'swLow': {
      const rnd = (k) => hsh(gx0 * 3.1 + gn0 * 1.7, k);
      deck(b.roof === 'link' || b.roof === 'swLow' ? M.deck : rnd(41) < 0.5 ? M.gravel : M.gravel2);
      const W = gx1 - gx0, D = gn1 - gn0;
      if (W > 14 && D > 14 && b.roof !== 'link' && b.roof !== 'swLow') {   // the maintenance walks: paver strips across the gravel
        const xm = gx0 + W * (0.35 + rnd(43) * 0.3), nm = gn0 + D * (0.35 + rnd(44) * 0.3);
        gbox(K, PF, M.pavers, xm - 0.6, xm + 0.6, gn0 + 0.5, gn1 - 0.5, h, h + 0.06);
        gbox(K, PF, M.pavers, gx0 + 0.5, gx1 - 0.5, nm - 0.6, nm + 0.6, h, h + 0.07);
      }
      if (b.roof === 'swLow') {   // long strip skylights over the galleries
        for (const x of [-72.5, -66.5, -57.5]) lantern(K, PF, M, [x, x + 3.2, gn0 + 6, gn1 - 6], h, 0.7, 34, { seed: x });
        break;
      }
      if (b.roof === 'link') { lantern(K, PF, M, [gx0 + 1.5, gx1 - 1.5, gn0 + 3, gn1 - 3], h, 0.6, 30, { seed: 17 }); break; }
      // plant: cabinets, a cooling tower or two, a stair penthouse
      const n = Math.max(2, Math.round((W * D) / 260));
      const units = [];
      for (let k = 0; k < n; k++) {
        const w = 3 + rnd(k) * 5, d = 2.2 + rnd(k + 9) * 3, x = gx0 + 3 + w / 2 + rnd(k + 3) * Math.max(0.1, W - 6 - w), y = gn0 + 3 + d / 2 + rnd(k + 5) * Math.max(0.1, D - 6 - d);
        hvac(K, PF, M, x, y, w, d, 1.6 + rnd(k + 7) * 1.4, h, k % 3 === 0 ? 1 : 0);
        units.push([x, y]);
      }
      // the ducts between the units (L-shaped runs on stands), exhaust stacks, a roof hatch
      for (let k = 0; k + 1 < units.length; k++) {
        const [xa, ya] = units[k], [xb, yb] = units[k + 1], yd = h + 0.9;
        bar(K, M.steel, PF.G3(xa, ya, yd), PF.G3(xb, ya, yd), 0.7);
        bar(K, M.steel, PF.G3(xb, ya, yd), PF.G3(xb, yb, yd), 0.7);
        for (const [sx, sy] of [[(xa + xb) / 2, ya], [xb, (ya + yb) / 2]]) bar(K, M.frameDk, PF.G3(sx, sy, h), PF.G3(sx, sy, yd - 0.35), 0.12);
      }
      for (let k = 0; k < 3; k++) {
        const p = PF.P(gx0 + 2 + rnd(k + 60) * (W - 4), gn0 + 2 + rnd(k + 70) * (D - 4));
        cyl(K, M.steel, p[0], p[1], 0.32, 0.32, h, h + 2.6 + rnd(k + 80) * 1.5, 10, false);
        cyl(K, M.frameDk, p[0], p[1], 0.55, 0.2, h + 2.6 + rnd(k + 80) * 1.5, h + 3.0 + rnd(k + 80) * 1.5, 10, true);
      }
      gbox(K, PF, M.hvac, gx1 - 5, gx1 - 3.6, gn0 + 3, gn0 + 4.4, h, h + 0.9);
      gbox(K, PF, M.inner, gx0 + 2, gx0 + 6.5, gn1 - 7, gn1 - 2, h, h + 3.6);
      cornerCap(K, PF, M, [gx0 + 2, gx0 + 6.5, gn1 - 7, gn1 - 2], h + 3.6);
      break;
    }
    case 'vaux':   // the 1880 building's gable (slate, standing seams), its brick gable ends
      gableRoof(K, PF, M.slate, M.brick, b.r, h, 4.2, 'n', { seam: 0.6, coping: M.dressed });
      break;
    case 'paint': {   // the paintings galleries: lanterns over the rooms, two sunk courts under glass, the courts' pitched glass
      deckHoles(K, PF, M.deck2, b.r, h, [[-40, -22, -30, 30], [-12, 12, 4, 30]]);
      for (let x = gx0 + 3; x < gx1 - 7; x += 7.4) {
        lantern(K, PF, M, [x, x + 5.0, 37, 44], h, 0.8, 30, { seed: x });
        lantern(K, PF, M, [x, x + 5.0, -47, -40], h, 0.8, 30, { seed: x + 1 });
      }
      lantern(K, PF, M, [-50.5, -43.0, -36, 34], h, 0.9, 34, { seed: 19, pw: 1.5, pp: 1.6 });
      sunkCourt(K, PF, M, [-40, -22, -30, 30], h, 5.0, 21);
      sunkCourt(K, PF, M, [-12, 12, 4, 30], h, 5.0, 23);
      // the south court: a pitched roof in warm lead over the court's glass
      gableRoof(K, PF, M.deckWarm, M.ashlar, [-14, 10, -30, -8], h, 3.2, 'x', { seam: 0.7, coping: M.dressed });
      glassHip(K, PF, M, [-18, -14, -30, -8], h + 0.4, 99, 30, { seed: 25 });
      glassHip(K, PF, M, [10, 13, -30, -8], h + 0.4, 99, 30, { seed: 26 });
      break;
    }
    case 'warm': {   // the warm decks east of the paintings: tan pavers, a row of lanterns, a light well
      deck(M.deckWarm); joints(K, PF, M, b.r, h, 2.4);
      for (let n = gn0 + 4; n < gn1 - 8; n += 9.5) lantern(K, PF, M, [gx0 + 4, gx0 + 9, n, n + 6], h, 0.8, 30, { seed: n * 3 });
      for (let n = gn0 + 8; n < gn1 - 8; n += 16) hvac(K, PF, M, gx1 - 9, n, 3.2, 5.0, 1.8, h);
      lantern(K, PF, M, [gx0 + 14, gx0 + 26, -8, 8], h, 1.0, 26, { seed: 33 });
      break;
    }
    case 'leanN': leanTo(K, PF, M, b.r, h, 20.5, 'w', { seed: 41 }); break;
    case 'leanS': leanTo(K, PF, M, b.r, h, 20.5, 'w', { seed: 43 }); break;
    case 'lehman': {   // the Lehman Wing: its glass pyramid in two pitches over the stone base
      glassLoft(K, PF, M, b.pts, [{ d: 0.4, y: h }, { d: 6.5, y: h + 6.5 }, { d: 14.5, y: h + 11.5 }], { apex: 0.8 });
      // the base's coping
      for (let i = 0; i < b.pts.length; i++) {
        const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
        bar(K, M.dressed, PF.G3(a[0], a[1], h - 0.1), PF.G3(c[0], c[1], h - 0.1), 0.7);
      }
      break;
    }
    case 'garden': {   // the roof garden: stone pavers, planters with hedges round the edge, a pergola, the elevator house
      deck(M.pavers); joints(K, PF, M, b.r, h, 1.2, M.inner);
      rails(K, PF, M, b.r, h + 1.05);
      const pl = (r, hh) => { gbox(K, PF, M.dressed, r[0], r[1], r[2], r[3], h, h + 0.7); face(K, M.mulch, [PF.G3(r[0] + 0.2, r[2] + 0.2, h + 0.62), PF.G3(r[1] - 0.2, r[2] + 0.2, h + 0.62), PF.G3(r[1] - 0.2, r[3] - 0.2, h + 0.62), PF.G3(r[0] + 0.2, r[3] - 0.2, h + 0.62)]); gbox(K, PF, M.hedge, r[0] + 0.3, r[1] - 0.3, r[2] + 0.3, r[3] - 0.3, h + 0.6, h + 0.6 + hh); };
      pl([gx0 + 1, gx0 + 2.4, gn0 + 1, gn1 - 1], 1.1);
      pl([gx0 + 1, gx1 - 1, gn0 + 1, gn0 + 2.4], 1.1);
      pl([gx0 + 1, gx1 - 12, gn1 - 2.4, gn1 - 1], 1.1);
      pl([gx0 + 8, gx0 + 16, gn1 - 20, gn1 - 4], 1.6);
      pl([gx0 + 20, gx0 + 23, gn1 - 18, gn1 - 4], 1.3);
      // the pergola over the bar
      for (let x = gx0 + 6; x <= gx0 + 18; x += 3) for (const n of [gn0 + 8, gn0 + 16]) { const p = PF.P(x, n); cyl(K, M.frameDk, p[0], p[1], 0.12, 0.12, h, h + 3.0, 8, true); }
      for (let x = gx0 + 6; x <= gx0 + 18; x += 3) bar(K, M.frameDk, PF.G3(x, gn0 + 7.5, h + 3.1), PF.G3(x, gn0 + 16.5, h + 3.1), 0.16);
      for (let n = gn0 + 8; n <= gn0 + 16; n += 0.8) bar(K, M.frameDk, PF.G3(gx0 + 5.5, n, h + 3.3), PF.G3(gx0 + 18.5, n, h + 3.3), 0.08);
      gbox(K, PF, M.modern, gx1 - 11, gx1 - 2, gn0 + 20, gn0 + 31, h, h + 4.2);
      cornerCap(K, PF, M, [gx1 - 11, gx1 - 2, gn0 + 20, gn0 + 31], h + 4.2);
      break;
    }
    default: deck(M.deck);
  }
}
// a deck over r with rectangular holes
function deckHoles(K, PF, mat, r, y, holes) {
  const ring = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([a, c]) => PF.P(a, c));
  const hs = holes.map((h) => [[h[0], h[2]], [h[0], h[3]], [h[1], h[3]], [h[1], h[2]]].map(([a, c]) => PF.P(a, c)));
  flatRing(K.s(mat), ring, y, [0, 0], false, hs);
}
// a court sunk `d` m into a roof: its white walls, a coping, a glass hip over the court's floor
function sunkCourt(K, PF, M, c, y, d, seed) {
  const cc = [[c[0], c[2]], [c[1], c[2]], [c[1], c[3]], [c[0], c[3]]], yc = y - d;
  for (let i = 0; i < 4; i++) {
    const a = cc[i], b = cc[(i + 1) % 4];
    face(K, M.modern, [PF.G3(b[0], b[1], yc), PF.G3(a[0], a[1], yc), PF.G3(a[0], a[1], y), PF.G3(b[0], b[1], y)]);
    bar(K, M.dressed, PF.G3(a[0], a[1], y + 0.12), PF.G3(b[0], b[1], y + 0.12), 0.36);
  }
  face(K, M.lead, [PF.G3(c[0], c[2], yc), PF.G3(c[1], c[2], yc), PF.G3(c[1], c[3], yc), PF.G3(c[0], c[3], yc)]);
  glassHip(K, PF, M, [c[0] + 0.6, c[1] - 0.6, c[2] + 0.6, c[3] - 0.6], yc, 3.0, 26, { seed });
}
// paver joints: a grid of slightly raised dark lines every `step` m over r (the deck's pattern read from the air)
function joints(K, PF, M, r, y, step, mat) {
  const [gx0, gx1, gn0, gn1] = r, m = mat || M.tile2;
  for (let x = gx0 + step; x < gx1 - 0.3; x += step) bar(K, m, PF.G3(x, gn0 + 0.4, y), PF.G3(x, gn1 - 0.4, y), 0.06);
  for (let n = gn0 + step; n < gn1 - 0.3; n += step) bar(K, m, PF.G3(gx0 + 0.4, n, y), PF.G3(gx1 - 0.4, n, y), 0.06);
}
// a guard rail on the parapet: posts every 1.8 m, a top rail, a mid rail
function rails(K, PF, M, r, y) {
  const [gx0, gx1, gn0, gn1] = r, c = [[gx0 + 0.25, gn0 + 0.25], [gx1 - 0.25, gn0 + 0.25], [gx1 - 0.25, gn1 - 0.25], [gx0 + 0.25, gn1 - 0.25]];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 1.8));
    bar(K, M.frameDk, PF.G3(a[0], a[1], y + 1.0), PF.G3(b[0], b[1], y + 1.0), 0.06);
    bar(K, M.frameDk, PF.G3(a[0], a[1], y + 0.5), PF.G3(b[0], b[1], y + 0.5), 0.03);
    for (let k = 0; k < n; k++) { const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; bar(K, M.frameDk, PF.G3(x, z, y), PF.G3(x, z, y + 1.0), 0.05); }
  }
}
// an axis-aligned box on the grid
function gbox(K, PF, mat, gx0, gx1, gn0, gn1, y0, y1) {
  const c = [[gx0, gn0], [gx1, gn0], [gx1, gn1], [gx0, gn1]];
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; face(K, mat, [PF.G3(a[0], a[1], y0), PF.G3(b[0], b[1], y0), PF.G3(b[0], b[1], y1), PF.G3(a[0], a[1], y1)]); }
  face(K, mat, [PF.G3(gx0, gn0, y1), PF.G3(gx1, gn0, y1), PF.G3(gx1, gn1, y1), PF.G3(gx0, gn1, y1)]);
}
function cornerCap(K, PF, M, r, y) {
  const c = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]];
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; bar(K, M.dressed, PF.G3(a[0], a[1], y + 0.1), PF.G3(b[0], b[1], y + 0.1), 0.3); }
}
// the front steps: the grand staircase before the central pavilion, granite, with its cheek walls
function frontSteps(K, PF, M) {
  const x0 = 83.3, x1 = 92.0, n0 = -24, n1 = 24, nR = 13, rise = 2.4 / nR, run = (x1 - x0) / nR;
  for (let k = 0; k < nR; k++) {
    const xa = x1 - run * k, y = rise * (k + 1);
    gbox(K, PF, M.stepG, x0, xa, n0, n1, -1.5 + 0 * y, y);
  }
  for (const [a, b] of [[n0 - 2.2, n0], [n1, n1 + 2.2]]) { gbox(K, PF, M.ashlar, x0, x1 + 0.3, a, b, -1.5, 3.0); cornerCap(K, PF, M, [x0, x1 + 0.3, a, b], 3.0); }
}

// ---------------------------------------------------------------- the build
export function buildMetMuseum(ctx) {
  if (!ctx.footprint || ctx.footprint.length < 4) return null;
  const M = mats();
  const PF = planFrame(ctx);
  const gY = ctx.groundY || 0;
  const K = new Out([0.44, gY - 1, gY + 30]);
  K.ox = ctx.cx || 0; K.oz = ctx.cz || 0;
  const B = plan();
  const stats = { runs: 0 };
  // the walls: each block's edges, sampled every metre against the other blocks; a run outside the museum takes the block's
  // facade from below the ground, a run over a lower neighbour a plain wall from the neighbour's top
  for (const b of B) {
    const n = b.pts.length;
    for (let i = 0; i < n; i++) {
      const A = b.pts[i], C = b.pts[(i + 1) % n];
      const dx = C[0] - A[0], dy = C[1] - A[1], L = Math.hypot(dx, dy);
      if (L < 0.1) continue;
      const ox = dy / L, oy = -dx / L;   // outward (counter-clockwise ring)
      const side = sideOf(ox, oy);
      const N = Math.max(1, Math.round(L));
      const samp = [];
      for (let k = 0; k < N; k++) {
        const t = (k + 0.5) / N, x = A[0] + dx * t + ox * 0.4, y = A[1] + dy * t + oy * 0.4;
        samp.push(hAt(B, b, x, y));
      }
      const F = new Frame(PF.P(A[0], A[1]), PF.P(C[0], C[1]), 0, [0, 0]);
      let k0 = 0;
      for (let k = 1; k <= N; k++) {
        if (k < N && samp[k] === samp[k0]) continue;
        const hn = samp[k0];
        if (hn < b.h - 0.01) {
          const u0 = (L * k0) / N, u1 = (L * k) / N, ext = hn === -Infinity;
          const style = (b.side && b.side[side]) || (ext ? b.ext : b.step || 'inner');
          wallRun(K, M, b, F, u0, u1, ext ? -6 : hn, style, b.h);
          stats.runs++;
        }
        k0 = k;
      }
    }
  }
  for (const b of B) roofs(K, PF, M, B, b);
  frontSteps(K, PF, M);
  // the meshes
  const g = new THREE.Group();
  let tris = 0;
  const per = {};
  for (const { mat, S } of K.sinks.values()) {
    const geo = S.build();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'met:' + (mat.name || 'mat');
    g.add(m);
    const t = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    tris += t;
    per[m.name + (mat.userData && mat.userData.pbr ? '|' + mat.userData.pbr.name : '')] = (per[m.name] || 0) + t;
  }
  g.userData.tris = tris;
  g.userData.perMat = per;
  g.userData.metRuns = stats.runs;
  g.userData.lm16 = 'met';
  return g;
}
