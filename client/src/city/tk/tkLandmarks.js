// Tower kit landmarks (TW): the towers that hold the skyline from Central Park and the air, on their compiled lots, built
// with the tower kit's own walls and parts (city/tk/tkBuild.js) on massing of their own: the podiums, shafts, setbacks
// and crowns the records do not carry (a record is one prism per footprint). A spec is data: masses in the lot's grid
// frame (gx along the streets toward the East River, gn along the avenues toward the north, metres from the footprint's
// centroid), each a stack of tiers; the facade parameters over the kit's (towerParams); the roof of each tier; a crown.
// They are 'replace' landmarks (shared/landmarkSpec.js, landmarks.js BUILDERS): the group comes back in the lot's own
// frame and assemble.js places it at the centroid on the ground.
import * as THREE from 'three';
import { Sink, edgeFrame, flatRing, quadW, quadY, quadU, poly, box as kbox } from '../fk/kitGeom.js';
import { towerParams, rng, LM_GLASS } from './tkParams.js';
import { buildTowerKit, tkGlassAttrs } from './tkBuild.js';
import { surfMat, partMat, cwGlassMat, holdNight } from './tkMats.js';

const GE = [0.8746, 0.4848], GN = [0.4848, -0.8746];   // the Manhattan grid's street (east) and avenue (north) axes, world x z

// ---------------------------------------------------------------- the lot's frame
const ONE3 = [1, 1, 1];
function lot(ctx) {
  const cx = ctx.cx, cz = ctx.cz;
  const W = (gx, gn) => [cx + gx * GE[0] + gn * GN[0], cz + gx * GE[1] + gn * GN[1]];
  const pos = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? r : r.slice().reverse(); };
  // the footprint's area centroid as a grid offset from (cx, cz), the mean of the ring's vertices: the vertex mean moves
  // with the ring's vertex count (30 Rockefeller Plaza's 13-vertex ring and the 12-vertex one of runs 7-9: 6.4 m), the
  // area centroid does not (1.8 m)
  let A2 = 0, ax = 0, az = 0;
  const F = ctx.footprint;
  for (let i = 0; i < F.length; i++) { const p = F[i], q = F[(i + 1) % F.length], c = p[0] * q[1] - q[0] * p[1]; A2 += c; ax += (p[0] + q[0]) * c; az += (p[1] + q[1]) * c; }
  ax = Math.abs(A2) > 1e-6 ? ax / (3 * A2) : 0; az = Math.abs(A2) > 1e-6 ? az / (3 * A2) : 0;
  const ga = [ax * GE[0] + az * GE[1], ax * GN[0] + az * GN[1]];
  return {
    cx, cz, y0: ctx.groundY, H: ctx.height,
    ring: pos(ctx.footprint.map(([x, z]) => [x + cx, z + cz])),
    // a rectangle gx0..gx1 x gn0..gn1
    rect: (gx0, gx1, gn0, gn1) => pos([W(gx0, gn0), W(gx1, gn0), W(gx1, gn1), W(gx0, gn1)]),
    // the same about the area centroid
    rectA: (gx0, gx1, gn0, gn1) => pos([W(gx0 + ga[0], gn0 + ga[1]), W(gx1 + ga[0], gn0 + ga[1]), W(gx1 + ga[0], gn1 + ga[1]), W(gx0 + ga[0], gn1 + ga[1])]),
    // a polygon of grid points
    poly: (pts) => pos(pts.map(([a, b]) => W(a, b))),
    // a rectangle with its corners cut by c (45 degrees)
    chamf: (gx0, gx1, gn0, gn1, c) => pos([W(gx0 + c, gn0), W(gx1 - c, gn0), W(gx1, gn0 + c), W(gx1, gn1 - c), W(gx1 - c, gn1), W(gx0 + c, gn1), W(gx0, gn1 - c), W(gx0, gn0 + c)]),
    W, pos,
  };
}

// ---------------------------------------------------------------- one landmark from its spec
// spec: { P: facade overrides, masses: (L) => [{ P, tiers: [{ ring, y1 (m above the ground), roof }], base }], crown(L, put) }
function buildSpec(key, spec, ctx) {
  const L = lot(ctx);
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(-L.cx, -L.y0, -L.cz);   // everything below is in world coordinates
  g.add(inner);
  const org = [Math.round(L.cx), Math.round(L.cz)];
  const sinks = new Map();
  const sinkOf = (mat, we) => {
    const base = (mat.userData && mat.userData.fkBase) || mat;
    let e = sinks.get(base);
    if (!e) sinks.set(base, (e = { mat: base, S: new Sink() }));
    // (a shared kit set drawn at its own tint is the base itself: its writer still gives aFkTr, at 1, as every mesh of a
    // shared base must; without it Unreal's binder multiplied the albedo by the uv channels it reads the tint from: the
    // roof decks came out pale green)
    e.S.we = we || null; e.S.tr = (mat.userData && mat.userData.fkTr) || (base.userData && base.userData.fkBaseHex ? ONE3 : null);
    return e.S;
  };
  const meshes = (out) => {
    for (const { mat, S } of out.sinks.values()) {
      const geo = S.build();
      if (!geo) continue;
      const gl = out.glass && out.glass.get(mat);
      if (gl) tkGlassAttrs(geo, gl);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(out.org[0], 0, out.org[1]);
      inner.add(m);
      if (mat.userData && mat.userData.tkNightOnly) holdNight(m);   // the packages' night windows: drawn for the baker only
    }
    for (const e of out.inst.values()) {
      const n = e.M.length / 16;
      const im = new THREE.InstancedMesh(e.geo, e.mat, n);
      im.instanceMatrix.array.set(e.M);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = !!e.shadow;
      im.name = 'tw:' + key + ':' + e.geo.userData.tkProto;
      inner.add(im);
    }
  };
  const masses = spec.masses(L);
  const base = { style: spec.style ?? 11, color: spec.color || [120, 130, 140], floorH: spec.P.floorH || 3.8, winW: spec.P.winW || 1.6,
    storeH: 0, flags: 0, colorVar: spec.seed ?? 0.37, lit: 0.55 };
  let mi = 0;
  for (const M of masses) {
    const tiers = [];
    let y = L.y0 + (M.y0 || 0);
    for (const t of M.tiers) { tiers.push({ ring: t.ring, y0: y, y1: L.y0 + t.y1, blind: 0, store: false, roof: t.roof }); y = L.y0 + t.y1; }
    const H = y - L.y0;
    const rec = { ...base, ...(M.rec || {}), key: key + ':' + mi, tiers, baseY: L.y0 + (M.y0 || 0), height: H - (M.y0 || 0), cx: L.cx, cz: L.cz, ring: tiers[0].ring, doorI: -1, doorPack: 0 };
    const P = Object.assign(towerParams(rec, null), spec.P, M.P || {});
    if (M.y0) P.lobbyH = 0;
    P.nightQuads = true;   // (held hidden: holdNight)
    const out = buildTowerKit(rec, P);
    meshes(out);
    // the roofs: a deck on each tier's top, a parapet on its edge (the next tier stands on the deck)
    for (let ti = 0; ti < tiers.length; ti++) {
      const T = tiers[ti], R = T.roof || M.roof || spec.roof || {};
      if (R.none) continue;
      const deck = surfMat(R.deck || 'roof_membrane', R.deckTint || null);
      flatRing(sinkOf(deck), T.ring, T.y1 + 0.02, org);
      // the parapet, but not along an edge the next tier rises from (its wall would stand in the parapet's plane)
      const next = tiers[ti + 1] ? tiers[ti + 1].ring : null;
      if (R.parapet !== 0) parapet(sinkOf(surfMat(R.set || P.trimSet || 'stone_lime', R.tint || null)), T.ring, T.y1, R.parapet ?? 1.1, R.depth ?? 0.35, org, next);
    }
    mi++;
  }
  if (spec.crown) spec.crown(L, { sinkOf, org, inner, partMat, surfMat, cwGlassMat });
  for (const { mat, S } of sinks.values()) {
    const geo = S.build();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(org[0], 0, org[1]);
    inner.add(m);
  }
  g.userData.tw = key;
  return g;
}

// a parapet on a ring: the outer face flush with the kit's walls, the coping, the inner face
function onRing(r, x, z, tol = 0.15) {
  for (let i = 0; i < r.length; i++) {
    const A = r[i], B = r[(i + 1) % r.length], ex = B[0] - A[0], ez = B[1] - A[1], L2 = ex * ex + ez * ez;
    const t = L2 ? Math.max(0, Math.min(1, ((x - A[0]) * ex + (z - A[1]) * ez) / L2)) : 0;
    if (Math.hypot(x - (A[0] + ex * t), z - (A[1] + ez * t)) < tol) return true;
  }
  return false;
}
function parapet(S, ring, y, h, d, org, next = null) {
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 0.05) continue;
    if (next && onRing(next, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2)) continue;
    const F = edgeFrame(ring, i, 0, org);
    quadW(S, F, -0.03, L + 0.03, y, y + h, 0.03);
    quadY(S, F, -0.03, L + 0.03, y + h, -d, 0.06, 1);
    quadW(S, F, 0.03 + d * 0, L - 0.03, y, y + h, -d, true);
  }
}

// a curved step (One57's cascade): over edge i of a lower tier's ring, a quarter ellipse from the wall's top (vertical
// tangent) up and in to the next tier's face `depth` metres back and `hc` metres higher (horizontal tangent), with its ends
// closed; it covers the terrace deck and the foot of the wall behind it
function sweep(S, ring, i, y, depth, hc, org, segs = 10) {
  const A = ring[i], B = ring[(i + 1) % ring.length];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const F = edgeFrame(ring, i, 0, org);
  const V = (u, w, yy, nw, ny, tu, tv) => S.v(F.ox + u * F.ux + w * F.nx, F.y0 + yy, F.oz + u * F.uz + w * F.nz, nw * F.nx, ny, nw * F.nz, tu, tv, 0);
  const prof = [];
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * Math.PI / 2;
    const w = -depth * (1 - Math.cos(a)), yy = y + hc * Math.sin(a);
    const tw = depth * Math.sin(a), ty = hc * Math.cos(a), tl = Math.hypot(tw, ty) || 1;   // the tangent (inward, up)
    prof.push([w, yy, ty / tl, tw / tl]);                                                   // the normal (outward, up)
  }
  let arc = 0;
  for (let k = 0; k < segs; k++) {
    const [w0, y0, nw0, ny0] = prof[k], [w1, y1, nw1, ny1] = prof[k + 1];
    const d = Math.hypot(w1 - w0, y1 - y0);
    const b = S.n;
    V(-0.03, w0 + 0.03, y0, nw0, ny0, 0, arc); V(L + 0.03, w0 + 0.03, y0, nw0, ny0, L, arc);
    V(L + 0.03, w1 + 0.03, y1, nw1, ny1, L, arc + d); V(-0.03, w1 + 0.03, y1, nw1, ny1, 0, arc + d);
    S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3);
    arc += d;
  }
  // the ends: a fan from the back corner (w = -depth, y) to the profile, facing -u and +u
  for (const [u, sg] of [[-0.03, -1], [L + 0.03, 1]]) {
    const b = S.n;
    const nx = F.ux * sg, nz = F.uz * sg;
    S.v(F.ox + u * F.ux + (-depth) * F.nx, y, F.oz + u * F.uz + (-depth) * F.nz, nx, 0, nz, 0, 0, 0);
    for (const [w, yy] of prof) S.v(F.ox + u * F.ux + (w + 0.03) * F.nx, yy, F.oz + u * F.uz + (w + 0.03) * F.nz, nx, 0, nz, w, yy - y, 0);
    for (let k = 0; k < segs; k++) { if (sg > 0) S.tri(b, b + 1 + k, b + 2 + k); else S.tri(b, b + 2 + k, b + 1 + k); }
  }
}

// a pyramid (or a tapered cap) over a ring: to `apex` height, optionally truncated at a top ring scaled by `topK`
function pyramid(S, ring, y0, y1, org, topK = 0) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const ox = org[0], oz = org[1];
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const At = [cx + (A[0] - cx) * topK, cz + (A[1] - cz) * topK], Bt = [cx + (B[0] - cx) * topK, cz + (B[1] - cz) * topK];
    const ex = B[0] - A[0], ez = B[1] - A[1], el = Math.hypot(ex, ez) || 1;
    const nx = ez / el, nz = -ex / el;
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, run = Math.hypot(mx - cx, mz - cz) * (1 - topK) || 1;
    const rise = y1 - y0, nl = Math.hypot(rise, run) || 1;
    const N = [nx * rise / nl, run / nl, nz * rise / nl];
    const b = S.n;
    S.v(A[0] - ox, y0, A[1] - oz, ...N, 0, 0, 0); S.v(B[0] - ox, y0, B[1] - oz, ...N, el, 0, 0);
    S.v(Bt[0] - ox, y1, Bt[1] - oz, ...N, el, rise, 0); S.v(At[0] - ox, y1, At[1] - oz, ...N, 0, rise, 0);
    S.tri(b, b + 2, b + 1); S.tri(b, b + 3, b + 2);   // a positive ring: (B - A) x (Bt - A) points in, so the other way round
  }
  if (topK > 0) flatRing(S, ring.map(([x, z]) => [cx + (x - cx) * topK, cz + (z - cz) * topK]), y1, org);
}
// S125 (2026-10-16): fluted piers standing out of face i of a ring (the face frame's u along it, w out of it), one every
// `pitch` m between the corners, `wid` wide, their fronts at depth d(y, k) (k the pier's index), sampled every `step` m of
// height from y0 to y1 (world y): the front and both cheeks, each a strip whose normal leans with the front's slope
function ribPiers(S, ring, i, org, y0, y1, o) {
  const F = edgeFrame(ring, i, 0, org);
  const L = F.L, n = Math.max(1, Math.round((L - o.wid) / o.pitch)), pitch = (L - o.wid) / n;
  const ys = [];
  for (let y = y0; y < y1 - 1e-3; y += o.step) ys.push(y);
  ys.push(y1);
  for (let k = 0; k <= n; k++) {
    const u0 = k * pitch, u1 = u0 + o.wid;
    for (let j = 0; j + 1 < ys.length; j++) {
      const ya = ys[j], yb = ys[j + 1], wa = o.d(ya, k, n), wb = o.d(yb, k, n);
      const sl = (wb - wa) / Math.max(yb - ya, 1e-3), nl = Math.hypot(1, sl);
      poly(S, F, [[u0, ya, wa], [u1, ya, wa], [u1, yb, wb], [u0, yb, wb]], 0, -sl / nl, 1 / nl);
      poly(S, F, [[u0, ya, 0.01], [u0, ya, wa], [u0, yb, wb], [u0, yb, 0.01]], -1, 0, 0);
      poly(S, F, [[u1, ya, 0.01], [u1, yb, 0.01], [u1, yb, wb], [u1, ya, wa]], 1, 0, 0);
      if (o.flutes) {   // two shallow grooves down the front (a darker strip of the same glaze, set back 4 cm)
        for (const f of [0.33, 0.67]) {
          const c = u0 + o.wid * f;
          poly(o.flutes, F, [[c - 0.035, ya, wa + 0.004], [c + 0.035, ya, wa + 0.004], [c + 0.035, yb, wb + 0.004], [c - 0.035, yb, wb + 0.004]], 0, -sl / nl, 1 / nl);
        }
      }
    }
    if (o.cap) {   // the pier's top
      const w = o.d(y1, k, n);
      poly(S, F, [[u0, y1, 0.01], [u1, y1, 0.01], [u1, y1, w], [u0, y1, w]], 0, 1, 0);
    }
  }
  return n + 1;
}
// a straight member of square section from (x0, y0, z0) to (x1, y1, z1) (world), its four sides
function rib(S, x0, y0, z0, x1, y1, z1, t, org) {
  const d = [x1 - x0, y1 - y0, z1 - z0], L = Math.hypot(...d), u = d.map((v) => v / L);
  const a = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n1 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]], l1 = Math.hypot(...n1);
  for (let i = 0; i < 3; i++) n1[i] /= l1;
  const n2 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
  const h = t / 2, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const P = (o, s1, s2) => [o[0] + (n1[0] * s1 + n2[0] * s2) * h - org[0], o[1] + (n1[1] * s1 + n2[1] * s2) * h, o[2] + (n1[2] * s1 + n2[2] * s2) * h - org[1]];
  for (let k = 0; k < 4; k++) {
    const [a1, b1] = C[k], [a2, b2] = C[(k + 1) % 4];
    const nx = (n1[0] * (a1 + a2) + n2[0] * (b1 + b2)) / 2, ny = (n1[1] * (a1 + a2) + n2[1] * (b1 + b2)) / 2, nz = (n1[2] * (a1 + a2) + n2[2] * (b1 + b2)) / 2, nl = Math.hypot(nx, ny, nz);
    const p = [P([x0, y0, z0], a1, b1), P([x0, y0, z0], a2, b2), P([x1, y1, z1], a2, b2), P([x1, y1, z1], a1, b1)];
    const b = S.n;
    for (const q of p) S.v(q[0], q[1], q[2], nx / nl, ny / nl, nz / nl, 0, 0, 0);
    // (wound outward: the cross of the first two edges against the side's normal)
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * nx + cy * ny + cz * nz >= 0) { S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3); } else { S.tri(b, b + 2, b + 1); S.tri(b, b + 3, b + 2); }
  }
}
// a drum: the side of a truncated cone of n facets about (cx, cz) world, radii r0 at y0 to r1 at y1 (world y), and its lid
function drum(S, cx, cz, r0, r1, y0, y1, org, n = 16, lid = true) {
  const ox = org[0], oz = org[1];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const slope = (r0 - r1) / Math.max(1e-3, y1 - y0), nl = Math.hypot(1, slope);
    const N = [Math.cos(am) / nl, slope / nl, Math.sin(am) / nl];
    const b = S.n;
    S.v(cx + Math.cos(a0) * r0 - ox, y0, cz + Math.sin(a0) * r0 - oz, ...N, a0 * r0, 0, 0);
    S.v(cx + Math.cos(a0) * r1 - ox, y1, cz + Math.sin(a0) * r1 - oz, ...N, a0 * r1, y1 - y0, 0);
    S.v(cx + Math.cos(a1) * r1 - ox, y1, cz + Math.sin(a1) * r1 - oz, ...N, a1 * r1, y1 - y0, 0);
    S.v(cx + Math.cos(a1) * r0 - ox, y0, cz + Math.sin(a1) * r0 - oz, ...N, a1 * r0, 0, 0);
    S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3);   // (v1 - v0) x (v2 - v0) points out of the axis
  }
  if (lid && r1 > 0.01) {
    const ring = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); }
    let A = 0; for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
    flatRing(S, A > 0 ? ring : ring.slice().reverse(), y1, org);
  }
}
const shrink = (ring, k) => {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
};

const { COBALT, SKYBLUE, SILVERW, CLEARG, BLACKG, GOLDG, BRONZEK } = LM_GLASS;

// 111 West 57th's tiers in the lot's grid frame: the hall on the 57th Street end, the tower's south face stepping north
function SW_TIERS(L) {
  let x0 = 1e9, x1 = -1e9, n0 = 1e9, n1 = -1e9;
  for (const [x, z] of L.ring) {
    const dx = x - L.cx, dz = z - L.cz, gx = dx * GE[0] + dz * GE[1], gn = dx * GN[0] + dz * GN[1];
    x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); n0 = Math.min(n0, gn); n1 = Math.max(n1, gn);
  }
  const ce = (x0 + x1) / 2, hn = n0 + 27.5, tn1 = n1 - 1.0;
  const e0 = ce - 9.2, e1 = ce + 9.2;
  // [top of the tier, the south face's set-back from the hall's back wall]
  const S = [[258, 0], [287, 3.0], [314, 6.0], [338, 9.0], [360, 12.0], [380, 15.0], [397, 18.0], [411, 20.5], [424, 23.0], [435, 25.0]];
  return { x0, x1, n0, n1, hn, tn1, e0, e1, tiers: S.map(([y, b]) => ({ y, s: hn + b })) };
}

// ---------------------------------------------------------------- the specs
export const TW_SPECS = {
  // One57 (157 W 57th St; Christian de Portzamparc, 2014; 306 m, 75 floors): a curtain wall of vertical stripes in two
  // blues, the hotel base on 57th Street, the tower's top falling toward the park in curved steps
  one57: {
    style: 11, color: [70, 100, 150], seed: 0.61,
    P: { arch: 'cwSuper', floorH: 4.05, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.12, spandrelH: 0.35, spandrelHex: '#2b3a52',
      glassOf: (f, c) => ((Math.floor(c / 2) * 7 + f * 3) % 5 < 2 ? SKYBLUE : COBALT) },
    masses: (L) => [
      // the hotel base on 57th Street (east wing)
      { tiers: [{ ring: L.poly([[0, -30.1], [30.6, -30.1], [30.6, -8.7], [10.6, -8.6], [10.6, 0.5], [0, 0.5]]), y1: 68 }],
        P: { arch: 'cwGrid', famObj: COBALT } },
      // the tower: the lot's west strip from 57th to 58th, its top stepping down to the north in curved steps
      { tiers: [
        { ring: L.poly([[-18, -29.9], [0, -29.9], [0, 31.3], [-23.0, 31.0], [-23.5, 7.0], [-18.0, 7.1]]), y1: 196 },
        { ring: L.rect(-23, 0, -29.9, 21), y1: 232 },
        { ring: L.rect(-23, 0, -29.9, 11), y1: 262 },
        { ring: L.rect(-23, 0, -26, 1), y1: 288 },
        { ring: L.rect(-21, -2, -22, -8), y1: 306 },
      ], roof: { parapet: 0, deck: 'roof_membrane' } },
    ],
    crown: (L, K) => {
      const S = K.sinkOf(K.cwGlassMat(COBALT));
      // over each step the next one rises from, the north face curves up and back to it
      const T = [[L.rect(-23, 0, -29.9, 31.0), 196], [L.rect(-23, 0, -29.9, 21), 232], [L.rect(-23, 0, -29.9, 11), 262], [L.rect(-23, 0, -26, 1), 288]];
      const back = [10.0, 10.0, 10.0, 9.0];
      for (let t = 0; t < T.length; t++) {
        const [r, y] = T[t];
        for (let i = 0; i < r.length; i++) {
          const A = r[i], B = r[(i + 1) % r.length], ex = B[0] - A[0], ez = B[1] - A[1], el = Math.hypot(ex, ez);
          const nx = ez / el, nz = -ex / el;
          if (nx * GN[0] + nz * GN[1] > 0.9) sweep(S, r, i, L.y0 + y, back[t], Math.min(back[t] * 1.1, 14), K.org);
        }
      }
    },
  },

  // 220 Central Park South (Robert A.M. Stern, 2019; 290 m, 70 floors): a limestone tower on the park front, the 18-storey
  // villa on 58th Street, setbacks under a crown of corner pavilions and arched lanterns
  tw220cps: {
    style: 1, color: [214, 205, 186], seed: 0.43,
    P: { arch: 'masonry', wallSet: 'stone_lime_ashlar', hex: '#d9d0bc', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 4.12, winW: 2.25, bayFit: true, reveal: 0.30, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 0,
      cell: { x0: 0.16, x1: 0.84, y0: 0.22, y1: 0.86 } },
    masses: (L) => [
      { tiers: [{ ring: L.poly([[-32.6, -30.3], [27.8, -30.0], [27.8, -12.5], [5.0, -12.5], [5.0, 0.0], [-32.8, -0.1]]), y1: 72 }],
        P: { floorH: 3.95 } },
      { tiers: [
        { ring: L.rect(5.0, 27.6, -12.5, 30.1), y1: 214 },
        { ring: L.rect(6.4, 26.2, -11.0, 28.7), y1: 246 },
        { ring: L.rect(7.9, 24.7, -9.4, 27.2), y1: 266 },
      ] },
    ],
    crown: (L, K) => {
      const stone = K.surfMat('stone_lime', '#d6cdb9'), S = K.sinkOf(stone);
      const dark = K.sinkOf(K.cwGlassMat(BLACKG));
      // corner pavilions (lanterns) and the central crown with arched openings
      const pav = (gx, gn) => {
        const r = L.rect(gx - 2.6, gx + 2.6, gn - 2.6, gn + 2.6);
        for (let i = 0; i < 4; i++) {
          const A = r[i], B = r[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
          const F = edgeFrame(r, i, 0, K.org);
          quadW(S, F, 0, el, L.y0 + 266, L.y0 + 268.5, 0.02);
          quadW(dark, F, 0.9, el - 0.9, L.y0 + 268.5, L.y0 + 276.5, -0.25);
          quadW(S, F, 0, 0.9, L.y0 + 268.5, L.y0 + 276.5, 0.02); quadW(S, F, el - 0.9, el, L.y0 + 268.5, L.y0 + 276.5, 0.02);
          quadW(S, F, 0, el, L.y0 + 276.5, L.y0 + 279, 0.02);
        }
        pyramid(S, shrink(r, 1.08), L.y0 + 279, L.y0 + 282, K.org, 0.15);
      };
      pav(9.6, -7.6); pav(23.0, -7.6); pav(9.6, 25.4); pav(23.0, 25.4);
      const c = L.rect(11.5, 21.1, -4.5, 22.3);
      for (let i = 0; i < 4; i++) {
        const A = c[i], B = c[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const F = edgeFrame(c, i, 0, K.org);
        quadW(S, F, 0, el, L.y0 + 266, L.y0 + 270, 0.02);
        const n = Math.max(2, Math.round(el / 3.2));
        for (let k = 0; k < n; k++) {
          const u0 = (k / n) * el, u1 = ((k + 1) / n) * el;
          quadW(S, F, u0, u0 + 0.6, L.y0 + 270, L.y0 + 282, 0.02); quadW(S, F, u1 - 0.6, u1, L.y0 + 270, L.y0 + 282, 0.02);
          quadW(dark, F, u0 + 0.6, u1 - 0.6, L.y0 + 270, L.y0 + 282, -0.3);
        }
        quadW(S, F, 0, el, L.y0 + 282, L.y0 + 285, 0.02);
      }
      flatRing(S, c, L.y0 + 285, K.org);
      pyramid(S, shrink(c, 0.7), L.y0 + 285, L.y0 + 290.2, K.org, 0.4);
    },
  },

  // Central Park Tower (217 W 57th St; Adrian Smith + Gordon Gill, 2020; 472 m, 98 floors): the Nordstrom base, the shaft
  // in pale glass with stainless fins, the east cantilever over the Art Students League from the 30th floor
  // 111 West 57th Street (SHoP Architects, 2021; 435 m, 84 floors, 1:24; S125, 2026-10-16, in the kit's own walls and parts
  // instead of the CP33 painted faces of lmSteinway.js, which tiled in Unreal): Steinway Hall's limestone on 57th Street
  // (Warren & Wetmore, 1925; 16 floors); behind it the tower, 18 m across, its east and west faces terracotta piers in a
  // pale glaze whose fronts ripple up the height (the faces' wave), bronze between them, its north and south faces glass in
  // bronze mullions, the south face feathering back in setbacks toward the top, the piers running on past the roof
  steinway: {
    style: 11, color: [214, 200, 178], seed: 0.57,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 5.18, winW: 1.55, bayFit: true, finish: 'alu_bronze', mullW: 0.1, mullD: 0.32, spandrelH: 0.55, spandrelHex: '#3a2f25' },
    masses: (L) => {
      const T = SW_TIERS(L);
      return [
        { tiers: [{ ring: L.rect(T.x0, T.x1, T.n0, T.hn), y1: 58.5 }],
          P: { arch: 'masonry', glass: false, wallSet: 'stone_lime_ashlar', hex: '#d6ccb8', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
            floorH: 3.66, winW: 2.7, bayFit: true, reveal: 0.32, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 1, cell: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.85 } },
          roof: { parapet: 1.2, set: 'stone_lime' } },
        { tiers: T.tiers.map((t) => ({ ring: L.rect(T.e0, T.e1, t.s, T.tn1), y1: t.y })), roof: { parapet: 0 } },
      ];
    },
    crown: (L, K) => {
      const T = SW_TIERS(L);
      // (the glaze as a pale limestone: the kit's 'terracotta' set read as orange clay in Unreal, the first still at 09:42)
      const terra = K.sinkOf(K.surfMat('stone_lime', '#e6dccb'));
      const groove = K.sinkOf(K.surfMat('stone_lime', '#b5a892'));
      const bronze = K.sinkOf(K.partMat('alu_bronze'));
      let y = L.y0;
      for (let ti = 0; ti < T.tiers.length; ti++) {
        const t = T.tiers[ti], r = L.rect(T.e0, T.e1, t.s, T.tn1), top = L.y0 + t.y, last = ti === T.tiers.length - 1;
        for (let i = 0; i < r.length; i++) {
          const F = edgeFrame(r, i, 0, K.org), ge = F.nx * GE[0] + F.nz * GE[1];
          if (Math.abs(ge) < 0.9) continue;
          // the wave: each pier's front 0.22 to 0.78 m out, one swell every 26 m of height, its phase running across the face
          const d = (yy, k, n) => 0.22 + 0.56 * (0.5 + 0.5 * Math.sin(((yy - L.y0) / 26) * 2 * Math.PI + (k / Math.max(n, 1)) * Math.PI * 1.6 + (ge > 0 ? 0 : 1.1)));
          // (each column ends at its setback in a short finial: SHoP's pilasters step with the south face; the tower's top is flat)
          ribPiers(terra, r, i, K.org, Math.max(y, L.y0 + 0.6), top + 1.2, { pitch: 1.55, wid: 0.46, step: 1.3, d, flutes: groove, cap: true });
          // the bronze filigree: a slim band at every floor line between the piers
          for (let yy = Math.ceil((y - L.y0) / 5.18) * 5.18; L.y0 + yy < top - 0.5; yy += 5.18) quadW(bronze, F, 0, F.L, L.y0 + yy - 0.18, L.y0 + yy + 0.18, 0.14);
        }
        y = top;
      }
      // the crown: a bronze band flush with the last tier's faces round the mechanical penthouse, level all round (S125,
      // 2026-10-16, the owner: the first build's piers ran 7.5 m past the roof with bronze blades between them, two "ears")
      const t = T.tiers[T.tiers.length - 1], r = L.rect(T.e0, T.e1, t.s, T.tn1), top = L.y0 + t.y;
      for (let i = 0; i < r.length; i++) {
        const F = edgeFrame(r, i, 0, K.org);
        quadW(bronze, F, -0.05, F.L + 0.05, top, top + 2.4, 0.06);
        quadW(bronze, F, 0.05, F.L - 0.05, top, top + 2.4, -0.25, true);
      }
    },
  },

  cpTower: {
    style: 11, color: [190, 198, 205], seed: 0.29,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.55, winW: 1.55, bayFit: true, finish: 'stainless', mullW: 0.08, mullD: 0.36, spandrelH: 0.55, spandrelHex: '#c9ced2' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 41 }], P: { arch: 'cwGrid', famObj: CLEARG, mullD: 0.2, spandrelH: 1.2, spandrelHex: '#d8dadb' } },
      { y0: 41, tiers: [
        { ring: L.rect(-14.0, 28.6, -12.0, 32.2), y1: 89 },
        { ring: L.rect(-14.0, 37.1, -12.0, 32.2), y1: 440 },
        { ring: L.rect(-11.5, 34.6, -9.5, 29.7), y1: 458 },
        { ring: L.rect(-8.0, 31.1, -6.0, 26.2), y1: 472 },
      ], roof: { parapet: 1.4, set: 'alu_clear' } },
    ],
  },

  // 432 Park Avenue (Rafael Vinoly, 2015; 426 m): a 28.5 m square tube of white concrete, six 3.05 m windows a face a
  // floor on 4.75 m bays, every twelfth floor pair open to the wind
  p432park: {
    style: 1, color: [232, 230, 224], seed: 0.52,
    P: { arch: 'pm', wallSet: 'concrete_smooth', hex: '#e8e6e0', trimSet: 'concrete_smooth', baseSet: 'concrete_smooth', lobbySet: 'granite_black',
      floorH: 4.72, winW: 4.75, bayFit: true, reveal: 0.42, sash: 'fixed', finish: 'alu_clear', belts: false, cornice: 0,
      cell: { x0: 0.18, x1: 0.82, y0: 0.17, y1: 0.82 }, mechEvery: 12 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 22 }], P: { arch: 'cwGrid', famObj: CLEARG, spandrelH: 1.0, spandrelHex: '#d0cfca', floorH: 5.5 } },
      { y0: 22, tiers: [{ ring: L.rect(-36.3, -7.8, -12.5, 16.0), y1: 425.5 }], roof: { parapet: 1.6, set: 'concrete_smooth' } },
    ],
  },

  // Deutsche Bank Center (the Time Warner Center; SOM, 2004; 229 m): two glass towers on a podium round Columbus Circle
  twTimeWarner: {
    style: 11, color: [150, 165, 175], seed: 0.71,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 3.9, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.07, mullD: 0.22, spandrelH: 0.6, spandrelHex: '#9aa6ad' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 46 }], P: { arch: 'cwGrid', spandrelH: 1.4, floorH: 5.6 } },
      { y0: 46, tiers: [{ ring: L.poly([[-44, 49], [6, 49], [16, 79], [-44, 79]]), y1: 229 }], roof: { parapet: 3.5, set: 'alu_clear' } },
      { y0: 46, tiers: [{ ring: L.poly([[-44, -41], [26, -41], [16, -11], [-44, -11]]), y1: 229 }], roof: { parapet: 3.5, set: 'alu_clear' } },
    ],
  },

  // the General Motors Building (767 Fifth Ave; Edward Durell Stone, 1968; 215 m, 50 floors): white marble piers the
  // whole height, black glass and spandrels between them, on a low base round the plaza
  twGM: {
    style: 3, color: [238, 236, 230], seed: 0.13,
    P: { arch: 'cwPier', famObj: BLACKG, floorH: 4.18, winW: 1.62, bayFit: true, finish: 'alu_black', pierW: 0.62, pierD: 0.55, pierSet: 'stone_lime', spandrelH: 1.1, spandrelHex: '#1c1d1f', mullD: 0.1 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 22 }], P: { famObj: BLACKG } },   // (the whole lot: a replace landmark leaves no ground under it)
      { y0: 22, tiers: [{ ring: L.rect(-12.0, 45.0, -22.0, 22.0), y1: 215 }], roof: { parapet: 2.2, set: 'stone_lime', tint: '#ece9e2' } },
    ],
  },

  // the Sherry-Netherland (781 Fifth Ave; Schultze & Weaver, 1927; 172 m): a brick and limestone tower over a broad base,
  // its copper spire
  twSherry: {
    style: 1, color: [198, 160, 128], seed: 0.83,
    P: { arch: 'masonry', wallSet: 'brick_buff', hex: '#c9a586', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 3.55, winW: 2.1, bayFit: true, reveal: 0.2, sash: 'dh', finish: 'alu_white', belts: true, cornice: 1 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 64 }] },
      { y0: 64, tiers: [{ ring: L.rect(-10.5, 10.5, -9.5, 9.5), y1: 130 }, { ring: L.rect(-8.6, 8.6, -7.6, 7.6), y1: 140 }] },
    ],
    crown: (L, K) => {
      const cu = K.sinkOf(K.surfMat('panel_alu', '#5d8a74'));
      pyramid(cu, L.rect(-8.0, 8.0, -7.0, 7.0), L.y0 + 140.2, L.y0 + 166, K.org, 0.06);
      const fin = K.sinkOf(K.partMat('alu_bronze'));
      pyramid(fin, L.rect(-0.35, 0.35, -0.35, 0.35), L.y0 + 166, L.y0 + 172, K.org, 0.1);
    },
  },

  // 30 Rockefeller Plaza (Raymond Hood, 1933; 259 m, 70 floors): an Indiana limestone slab of continuous piers, the
  // windows recessed between them over aluminium spandrels, stepping in toward its top, on its lower wings
  thirtyRock: {
    style: 4, color: [214, 204, 182], seed: 0.47,
    P: { arch: 'deco', wallSet: 'stone_lime_ashlar', hex: '#d6cbb2', trimSet: 'stone_lime', baseSet: 'stone_lime', lobbySet: 'granite_black',
      floorH: 3.66, winW: 1.72, bayFit: true, reveal: 0.22, sash: 'dh', finish: 'alu_clear', piers: true, belts: false, cornice: 0,
      spandrel: { set: 'panel_alu', tint: '#7d7f7c' },   // the aluminium spandrels, the windows and panels one strip between the piers
      cell: { x0: 0.22, x1: 0.78, y0: 0.26, y1: 0.86 } },
    // about the area centroid: the complex's ring differs in its vertices between tile sets
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 33 }] },
      { y0: 33, tiers: [
        { ring: L.rectA(-34.5, 60.5, -15.6, 16.4), y1: 200 },
        { ring: L.rectA(-27.5, 56.5, -14.6, 15.4), y1: 222 },
        { ring: L.rectA(-19.5, 50.5, -13.1, 13.9), y1: 240 },
        { ring: L.rectA(-7.5, 40.5, -11.6, 12.4), y1: 259 },
      ], roof: { parapet: 1.2, set: 'stone_lime', tint: '#d6cbb2' } },
    ],
  },

  // the Hearst Tower (Foster + Partners, 2006, on Joseph Urban's 1928 base; 182 m): a glass tower in a stainless diagrid
  // of four-storey diamonds, its corners cut back, over the six-storey cast-stone base
  hearst: {
    style: 11, color: [180, 190, 196], seed: 0.66,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 4.05, winW: 1.5, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.1, spandrelH: 0.4, spandrelHex: '#9aa3a8',
      diagrid: { floors: 4, span: 10.5, w: 0.75, d: 0.55, set: 'stainless' } },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 30 }], P: { arch: 'masonry', glass: false, wallSet: 'cast_stone', hex: '#d3c8b2', trimSet: 'cast_stone', baseSet: 'cast_stone',
        lobbySet: 'cast_stone', floorH: 5.0, winW: 3.2, bayFit: true, reveal: 0.35, sash: 'case', finish: 'alu_black', belts: true, cornice: 1, diagrid: null,
        cell: { x0: 0.18, x1: 0.82, y0: 0.2, y1: 0.86 } } },
      { y0: 30, tiers: [{ ring: L.chamf(-29, 14, -14, 29.5, 5.5), y1: 182 }], roof: { parapet: 1.5, set: 'stainless' } },
    ],
  },

  // 53 West 53rd (Jean Nouvel, 2019; 320 m): a tapering faceted tower in clear glass behind an exposed concrete diagrid,
  // on the MoMA gallery floors; the taper here is a run of tiers, each a diamond of the diagrid high
  tw53w53: {
    style: 11, color: [170, 178, 182], seed: 0.57,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 3.9, winW: 1.5, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.1, spandrelH: 0.45, spandrelHex: '#a7aeb1',
      diagrid: { floors: 5, span: 8.5, w: 0.95, d: 0.65, set: 'concrete_smooth' } },
    masses: (L) => {
      const tiers = [];
      const n = 13, y0 = 32, y1 = 300;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n, yt = y0 + (y1 - y0) * t;
        const k = Math.pow(1 - t * 0.82, 1.15);
        tiers.push({ ring: L.rect(-4 - 16 * k, -4 + 16 * k, -3 - 27 * k, -3 + 27 * k + 4 * (1 - k)), y1: yt });
      }
      return [
        { tiers: [{ ring: L.ring, y1: 32 }], P: { arch: 'cwGrid', diagrid: null, spandrelH: 1.6, floorH: 6.4 } },
        { y0: 32, tiers, roof: { parapet: 0.6, set: 'concrete_smooth' } },
      ];
    },
    // S125: the top as the tower's three glass peaks (to 320, 311 and 305 m) over the last tier, edged in the diagrid's concrete
    crown: (L, K) => {
      const k = Math.pow(1 - 0.82, 1.15), gx0 = -4 - 16 * k, gx1 = -4 + 16 * k, gn0 = -3 - 27 * k, gn1 = -3 + 27 * k + 4 * (1 - k);
      const gl = K.sinkOf(K.cwGlassMat(CLEARG)), cs = K.sinkOf(K.surfMat('concrete_smooth', '#c9c6bf'));
      const gm = (gx0 + gx1) / 2, w = gx1 - gx0, d = gn1 - gn0;
      for (const [a, b, c, e, y] of [[gx0, gm + w * 0.1, gn0, gn0 + d * 0.55, 320], [gm - w * 0.15, gx1, gn0 + d * 0.3, gn1, 311], [gx0, gm, gn0 + d * 0.5, gn1, 305]]) {
        const r = L.rect(a, b, c, e);
        pyramid(gl, r, L.y0 + 300, L.y0 + y, K.org, 0);
        for (let i = 0; i < 4; i++) {   // the peak's edges, the diagrid's members carried up to the point
          const p = r[i], cx = (r[0][0] + r[2][0]) / 2, cz = (r[0][1] + r[2][1]) / 2;
          rib(cs, p[0], L.y0 + 300, p[1], cx, L.y0 + y, cz, 0.45, K.org);
        }
      }
    },
  },

  // 520 Park Avenue (Robert A.M. Stern, 2018; 238 m): a slender limestone tower, its top stepping in under corner
  // finials and a lantern
  tw520park: {
    style: 1, color: [214, 205, 188], seed: 0.34,
    P: { arch: 'masonry', wallSet: 'stone_lime_ashlar', hex: '#d8cfbc', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 4.6, winW: 2.1, bayFit: true, reveal: 0.3, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 0,
      cell: { x0: 0.17, x1: 0.83, y0: 0.22, y1: 0.86 } },
    masses: (L) => [
      { tiers: [
        { ring: L.ring, y1: 196 },
        { ring: L.rect(-7.8, 7.9, -9.1, 9.3), y1: 212 },
        { ring: L.rect(-6.3, 6.4, -7.6, 7.8), y1: 224 },
      ] },
    ],
    crown: (L, K) => {
      const S = K.sinkOf(K.surfMat('stone_lime', '#d8cfbc')), dark = K.sinkOf(K.cwGlassMat(BLACKG));
      const c = L.rect(-4.6, 4.7, -5.6, 5.8);
      for (let i = 0; i < 4; i++) {
        const A = c[i], B = c[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const F = edgeFrame(c, i, 0, K.org);
        quadW(S, F, 0, el, L.y0 + 224, L.y0 + 226, 0.02);
        quadW(dark, F, 0.8, el - 0.8, L.y0 + 226, L.y0 + 232, -0.3);
        quadW(S, F, 0, 0.8, L.y0 + 226, L.y0 + 232, 0.02); quadW(S, F, el - 0.8, el, L.y0 + 226, L.y0 + 232, 0.02);
        quadW(S, F, 0, el, L.y0 + 232, L.y0 + 233.5, 0.02);
      }
      flatRing(S, c, L.y0 + 233.5, K.org);
      for (const [gx, gn] of [[-7.0, -8.3], [7.1, -8.3], [-7.0, 8.5], [7.1, 8.5]]) pyramid(S, L.rect(gx - 0.6, gx + 0.6, gn - 0.6, gn + 0.6), L.y0 + 224, L.y0 + 236, K.org, 0.05);
      pyramid(S, L.rect(-1.2, 1.3, -1.2, 1.4), L.y0 + 233.5, L.y0 + 238, K.org, 0.08);
    },
  },

  // 270 Park Avenue (JPMorgan Chase, Foster + Partners, 2025; 423 m): a full-block tower on fan columns, stepping in
  // three times toward its top, in silver glass between stainless fins
  tw270park: {
    style: 11, color: [190, 198, 204], seed: 0.77,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.3, winW: 1.55, bayFit: true, finish: 'stainless', mullW: 0.08, mullD: 0.42, spandrelH: 0.5, spandrelHex: '#c3c8cb' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 24 }], P: { arch: 'cwGrid', famObj: CLEARG, spandrelH: 0.8, floorH: 6.0 } },
      { y0: 24, tiers: [
        { ring: L.rect(-54.5, 54.5, -27.5, 27.5), y1: 205 },
        { ring: L.rect(-50, 50, -22, 22), y1: 285 },
        { ring: L.rect(-44, 44, -16.5, 16.5), y1: 355 },
        { ring: L.rect(-36, 36, -11.5, 11.5), y1: 405 },
      ], roof: { parapet: 2.5, set: 'stainless' } },
    ],
    crown: (L, K) => {
      // the fan columns: three diagonal pairs a face under the overhang
      const st = K.sinkOf(K.partMat('stainless'));
      const mast = L.rect(-0.9, 0.9, -0.9, 0.9);
      pyramid(st, mast, L.y0 + 405, L.y0 + 423, K.org, 0.3);
    },
  },

  // the Empire State Building (Shreve, Lamb & Harmon, 1931; 381 m to the roof, 443 m with the antenna): Indiana limestone in
  // continuous piers, the windows in vertical strips over aluminium spandrels, a five-storey base on the whole lot, the
  // setbacks at the 6th, 25th, 30th, 72nd, 81st and 85th floors, the 86th-floor observatory, the mooring mast and the antenna
  empireState: {
    style: 4, color: [214, 204, 176], seed: 0.19,
    P: { arch: 'deco', wallSet: 'stone_lime_ashlar', hex: '#d8ccaa', trimSet: 'stone_lime', baseSet: 'stone_lime', lobbySet: 'granite_black',
      floorH: 3.66, winW: 1.62, bayFit: true, reveal: 0.2, sash: 'dh', finish: 'alu_clear', piers: true, belts: false, cornice: 0,
      spandrel: { set: 'panel_alu', tint: '#8f9290' },   // the cast aluminium spandrels between the limestone piers
      cell: { x0: 0.25, x1: 0.75, y0: 0.24, y1: 0.86 } },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 23 }] },
      { y0: 23, tiers: [
        { ring: L.rect(-4, 92, -18, 24), y1: 86 },
        { ring: L.rect(4, 84, -14.5, 20.5), y1: 106 },
        { ring: L.rect(14, 74, -11, 17), y1: 266 },
        { ring: L.rect(20, 68, -8, 14), y1: 298 },
        { ring: L.rect(27, 61, -5, 11), y1: 312 },
        { ring: L.rect(31, 57, -3, 9), y1: 320 },
      ], roof: { parapet: 1.3, set: 'stone_lime', tint: '#d8ccaa' } },
    ],
    crown: (L, K) => {
      const stone = K.sinkOf(K.surfMat('stone_lime', '#d8ccaa'));
      const nickel = K.sinkOf(K.partMat('stainless'));
      const glass = K.sinkOf(K.cwGlassMat(BLACKG));
      const [cx, cz] = L.W(44, 3);
      // the observatory deck's glazed drum and its crown, the mast's stepped drums with their ribs, the antenna
      drum(glass, cx, cz, 8.6, 8.6, L.y0 + 320, L.y0 + 326, K.org, 16, false);
      drum(stone, cx, cz, 9.2, 8.2, L.y0 + 326, L.y0 + 330, K.org, 16);
      drum(stone, cx, cz, 7.2, 6.6, L.y0 + 330, L.y0 + 346, K.org, 16);
      drum(nickel, cx, cz, 6.9, 6.1, L.y0 + 346, L.y0 + 352, K.org, 16);
      drum(stone, cx, cz, 5.9, 5.0, L.y0 + 352, L.y0 + 366, K.org, 12);
      drum(nickel, cx, cz, 5.0, 3.6, L.y0 + 366, L.y0 + 374, K.org, 12);
      drum(nickel, cx, cz, 3.0, 2.2, L.y0 + 374, L.y0 + 381, K.org, 12);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = cx + Math.cos(a) * 6.4, z = cz + Math.sin(a) * 6.4;
        drum(nickel, x, z, 0.35, 0.3, L.y0 + 330, L.y0 + 352, K.org, 4);
      }
      drum(nickel, cx, cz, 1.2, 0.5, L.y0 + 381, L.y0 + 410, K.org, 8);
      drum(nickel, cx, cz, 0.45, 0.18, L.y0 + 410, L.y0 + 443, K.org, 6);
    },
  },

  // One Vanderbilt (Kohn Pedersen Fox, 2020; 427 m): four interlocking volumes that taper as they rise, glass between
  // terracotta spandrels and fins, a stepped glass crown and its spire; here the taper is a run of tiers, each pair of
  // opposite faces stepping in in turn
  oneVanderbilt: {
    style: 11, color: [196, 190, 176], seed: 0.27,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 4.4, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.09, mullD: 0.34, spandrelH: 0.9, spandrelHex: '#c9bfa8' },
    masses: (L) => {
      const T = [];
      const steps = [[0, 0, 0, 0, 92], [3.5, 0, 0, 0, 160], [3.5, 0, 3.5, 0, 220], [3.5, 3.5, 3.5, 0, 270], [3.5, 3.5, 3.5, 3.5, 310],
        [7, 3.5, 3.5, 3.5, 340], [7, 3.5, 7, 3.5, 362], [7, 7, 7, 3.5, 380], [10, 7, 7, 7, 392]];
      for (const [w, e, s, n, y] of steps) T.push({ ring: L.rect(-32.8 + w, 32.8 - e, -30.6 + s, 30.6 - n), y1: y });
      return [
        { tiers: [{ ring: L.ring, y1: 26 }], P: { arch: 'cwGrid', spandrelH: 1.4, floorH: 6.5 } },
        { y0: 26, tiers: T, roof: { parapet: 2.0, set: 'alu_clear' } },
      ];
    },
    crown: (L, K) => {
      const g = K.sinkOf(K.cwGlassMat(CLEARG)), st = K.sinkOf(K.partMat('stainless'));
      pyramid(g, L.rect(-22.8, 25.8, -20.6, 23.6), L.y0 + 392, L.y0 + 404, K.org, 0.62);
      pyramid(g, L.rect(-14.5, 17.5, -12.5, 15.5), L.y0 + 404, L.y0 + 412, K.org, 0.45);
      pyramid(st, L.rect(-0.8, 0.8, -0.8, 0.8), L.y0 + 412, L.y0 + 427, K.org, 0.15);
    },
  },

  // the Bank of America Tower (Cook + Fox, 2009; 288 m to the roof, 366 m to the spire): a glass tower whose faces fold
  // at their corners, on a podium that fills the block, its spire
  boaTower: {
    style: 11, color: [180, 190, 196], seed: 0.31,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.6, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.07, mullD: 0.18, spandrelH: 0.5, spandrelHex: '#b9c1c6' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 30 }], P: { arch: 'cwGrid', spandrelH: 1.2, floorH: 6.0 } },
      { y0: 30, tiers: [
        { ring: L.chamf(-30, 32, -12, 30, 7), y1: 205 },
        { ring: L.chamf(-27, 30, -9, 27, 8), y1: 252 },
        { ring: L.chamf(-22, 26, -5, 23, 8), y1: 280 },
        { ring: L.chamf(-15, 19, 0, 18, 6), y1: 288 },
      ], roof: { parapet: 3.0, set: 'alu_clear' } },
    ],
    crown: (L, K) => {
      const st = K.sinkOf(K.partMat('stainless'));
      const [cx, cz] = L.W(2, 9);
      drum(st, cx, cz, 1.6, 0.9, L.y0 + 288, L.y0 + 330, K.org, 8);
      drum(st, cx, cz, 0.9, 0.2, L.y0 + 330, L.y0 + 366, K.org, 6);
    },
  },

  // the Seagram Building (Mies van der Rohe, 1958; 157 m): a bronze slab of five bays by three behind its plaza on Park
  // Avenue, bronze I-beam mullions every sixth of a bay, bronze-tinted glass to the spandrels, the bustle behind
  seagram: {
    style: 3, color: [74, 58, 44], seed: 0.41,
    P: { arch: 'cwGrid', famObj: BRONZEK, floorH: 3.85, winW: 1.41, bayFit: true, finish: 'alu_bronze', mullW: 0.12, mullD: 0.3, spandrelH: 1.15, spandrelHex: '#3a2c22' },
    masses: (L) => [
      { tiers: [{ ring: L.rect(-29.0, 4.0, -30.4, 30.1), y1: 0.6 }], P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', trimSet: 'granite_pink', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } },
        roof: { deck: 'granite_pink', parapet: 0 } },
      { tiers: [{ ring: L.rect(17.0, 31.6, -30.4, 30.1), y1: 40 }] },
      { tiers: [{ ring: L.rect(4.0, 17.0, -21.2, 21.2), y1: 157 }, ], roof: { parapet: 2.2, set: 'alu_bronze' } },
      { y0: 40, tiers: [{ ring: L.rect(17.0, 29.6, -21.2, 21.2), y1: 157 }], roof: { parapet: 2.2, set: 'alu_bronze' } },
      { tiers: [{ ring: L.rect(4.0, 17.0, -30.4, -21.2), y1: 0.6 }, ], roof: { deck: 'granite_pink', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { tiers: [{ ring: L.rect(4.0, 17.0, 21.2, 30.1), y1: 0.6 }, ], roof: { deck: 'granite_pink', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
    ],
  },

  // Citigroup Center (Hugh Stubbins, 1977; 279 m): a 48 m square tower in bands of aluminium and glass, raised on four 35 m
  // stilts at the middle of its sides and its core, its roof cut at 45 degrees to the south, over St. Peter's and the plaza
  citigroup: {
    style: 3, color: [200, 204, 206], seed: 0.53,
    P: { arch: 'cwRibbon', famObj: CLEARG, floorH: 3.75, winW: 1.5, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.1, spandrelH: 1.55, spandrelHex: '#c8cdd0',
      ribbonSet: 'panel_alu' },
    masses: (L) => [
      { tiers: [{ ring: L.rect(4.0, 78.5, -40.0, 21.4), y1: 26 }], P: { arch: 'cwGrid', spandrelH: 1.2, floorH: 5.2 } },
      { tiers: [{ ring: L.rect(-45.3, 4.0, -40.0, -27.0), y1: 0.5 }], roof: { deck: 'granite_grey', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_grey', hex: '#9a9a96', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { tiers: [{ ring: L.rect(-45.3, 4.0, -27.0, 21.4), y1: 0.5 }], roof: { deck: 'granite_grey', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_grey', hex: '#9a9a96', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { y0: 35, tiers: [{ ring: L.rect(-44.0, 4.0, -27.0, 21.0), y1: 248 }], roof: { parapet: 0 } },
      // the core and the four stilts
      { tiers: [{ ring: L.rect(-29.0, -11.0, -12.0, 6.0), y1: 35 }], P: { arch: 'pm', glass: false, wallSet: 'concrete_precast', hex: '#c9c8c2', cell: { x0: 0.45, x1: 0.55, y0: 0.45, y1: 0.55 } }, roof: { none: true } },
      ...[[-20, -27], [-20, 21], [-44, -3], [4, -3]].map(([gx, gn]) => ({ tiers: [{ ring: L.rect(gx - 3.4 + (gx === -44 ? 3.4 : gx === 4 ? -3.4 : 0), gx + 3.4 + (gx === -44 ? 3.4 : gx === 4 ? -3.4 : 0), gn - 3.4 + (gn === -27 ? 3.4 : gn === 21 ? -3.4 : 0), gn + 3.4 + (gn === -27 ? 3.4 : gn === 21 ? -3.4 : 0)), y1: 35 }],
        P: { arch: 'pm', glass: false, wallSet: 'panel_alu', hex: '#c8cdd0', cell: { x0: 0.45, x1: 0.55, y0: 0.45, y1: 0.55 } }, roof: { none: true } })),
    ],
    crown: (L, K) => {
      // the roof cut at 45 degrees, rising to the north: a wedge over the tower, its sloped face in the bands' aluminium
      const al = K.sinkOf(K.partMat('alu_clear')), S = K.sinkOf(K.surfMat('panel_alu', '#c8cdd0'));
      const r = L.rect(-44.0, 4.0, -27.0, 21.0);
      const y0 = L.y0 + 248, y1 = L.y0 + 279;
      const [a, b, c, d] = r;   // positive ring: a (gx0, gn0) south-west, b south-east, c north-east, d north-west
      const P = (p, y) => [p[0] - K.org[0], y, p[1] - K.org[1]];
      const quad = (S2, A, B, C, D, n) => { const i = S2.n; for (const v of [A, B, C, D]) S2.v(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0, 0); S2.tri(i, i + 1, i + 2); S2.tri(i, i + 2, i + 3); };
      const nl = Math.SQRT1_2;
      quad(S, P(a, y0), P(b, y0), P(c, y1), P(d, y1), [-GN[0] * nl, nl, -GN[1] * nl]);
      // the north face up to the ridge and the two side triangles
      quad(S, P(c, y0), P(d, y0), P(d, y1), P(c, y1), [GN[0], 0, GN[1]]);
      for (const [p0, p1, sg] of [[b, c, 1], [d, a, -1]]) {
        const i = S.n, n = [GE[0] * sg, 0, GE[1] * sg];
        S.v(...P(p0, y0), ...n, 0, 0, 0); S.v(...P(p1, y0), ...n, 0, 0, 0); S.v(...P(p1, y1), ...n, 0, 0, 0);
        S.tri(i, i + 1, i + 2);
      }
    },
  },

  // 1 Central Park West (Trump International; re-clad 1997 in gold-tinted glass; 177 m)
  twTrumpIntl: {
    style: 3, color: [150, 120, 80], seed: 0.22,
    P: { arch: 'cwGrid', famObj: GOLDG, floorH: 3.9, winW: 1.55, bayFit: true, finish: 'alu_bronze', mullD: 0.18, spandrelH: 0.95, spandrelHex: '#5a4630' },
    masses: (L) => [{ tiers: [{ ring: L.ring, y1: 171 }], roof: { parapet: 1.8, set: 'alu_bronze' } }],
  },
};

// the builders, by landmark key (landmarks.js asks here first; `?twlm=0` keeps the old ones)
export const TW_BUILDERS = {};
for (const k of Object.keys(TW_SPECS)) TW_BUILDERS[k] = (ctx) => buildSpec(k, TW_SPECS[k], ctx);
