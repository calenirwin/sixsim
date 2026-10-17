// lmCPW.js: the twin- and multi-tower apartment houses of Central Park West, built on their compiled footprint rings.
// The city's footprint of each is one ring at the towers' height, so the tile drew a 90-110 m block (with a crown on top
// of it: the box the Space lane found over the Majestic, 2026-10-11). Each footprint is the same U: a bar along the park
// front, a wing along each side street and a court open to the west. These builders put back the base with its setbacks
// and the towers on the park end of the wings, at San Remo quality (lmSanRemo.js; the same facade kit).
//   The Majestic, 115 CPW (Irwin S. Chanin, 1931): a 19-storey base filling the lot round a west court, setbacks from the
//     14th, two towers on the eastern part of the base above the 19th (the north one slightly wider) to the 30th, corner
//     solariums, horizontal tan and brown brick bands, square-headed ornaments on the east tops and round ones (the
//     "dynamo") on the west.
//   The Century, 25 CPW (Chanin, 1931): the same scheme, ochre stone below, tan brick with rust-coloured spandrels, the
//     wings stepping down in four tiers, a water tower with vertical buttresses over each tower, grooved slabs beside it.
//   The Eldorado, 300 CPW (Margon & Holder with Emery Roth, 1931): a 17-storey base, two towers of 12 storeys six bays wide
//     on the park, tan brick with brown vertical bands, a stepped top and the finials.
//   The Beresford, 211 CPW (Emery Roth, 1929): a 22-storey U, rusticated limestone below, beige brick, setbacks at the
//     14th, 16th, 18th and 20th, and three octagonal towers (north-east, south-east, south-west) with pyramidal copper
//     roofs and copper-and-glass lanterns.
// Facts from the buildings' landmark designation reports as summarised on their encyclopedia pages; the plan is the
// compiled ring, the height the compiled record's.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, wallRing, capRing, loft, box, cyl, lathe, facadeTex, facadeMat, punchedPainter, addMeshes, triCount, rgbs, speckle, streaks } from './lmFacadeKit.js';

const { mat } = KIT;

/* ------------------------------------------------------------------ the frame */
// Central Park West's bearing (29 degrees east of north) in world x, z, and the normal out of the park front (east)
const AV = [0.4848, -0.8746], SV = [0.8746, 0.4848];
// u along the avenue (positive north), v out of the park front (0 on the front line, negative inside the building)
export function parkFrame(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 20 || Math.abs((ex * AV[0] + ez * AV[1]) / L) < 0.97) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, east = mx * SV[0] + mz * SV[1];
    if (!best || east > best.east) best = { mx, mz, L, east };
  }
  if (!best) return null;
  const M = [best.mx, best.mz];
  const P = (u, v) => [M[0] + AV[0] * u + SV[0] * v, M[1] + AV[1] * u + SV[1] * v];
  const U = (p) => [(p[0] - M[0]) * AV[0] + (p[1] - M[1]) * AV[1], (p[0] - M[0]) * SV[0] + (p[1] - M[1]) * SV[1]];
  let s0 = 0;
  for (const p of ring) s0 = Math.min(s0, U(p)[1]);
  // rot: the frame's yaw for box() (box() turns its local x by `rot` about +y; local x must run along the avenue)
  return { M, P, U, uS: -best.L / 2, uN: best.L / 2, L: best.L, s0, rot: Math.atan2(-AV[1], AV[0]) };
}
export const frameRect = (F, u0, u1, v0, v1) => [F.P(u0, v0), F.P(u1, v0), F.P(u1, v1), F.P(u0, v1)];
// the ring clipped to a convex window of the frame (Sutherland-Hodgman, one half-plane at a time); half-planes are
// [axis, sign, value]: keep points with sign * (coordinate - value) >= 0, axis 0 = u, 1 = v. A U clipped across its two
// arms stays one polygon (the cut closes each arm), which is every use here.
export function clipFrame(ring, F, planes) {
  let pts = ring.map((p) => F.U(p));
  for (const [ax, sg, val] of planes) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const da = sg * (a[ax] - val), db = sg * (b[ax] - val);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    pts = out;
    if (pts.length < 3) return null;
  }
  // drop repeated points
  const clean = [];
  for (const p of pts) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) clean.push(p); }
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 0.05) clean.pop();
  return clean.length >= 3 ? clean.map(([u, v]) => F.P(u, v)) : null;
}
// a regular octagon in the frame (four wide faces on the grid, four narrow ones on the diagonals): centre (u, v), width w
function octagon(F, u, v, w, chamferK = 0.29) {
  const h = w / 2, c = w * chamferK;
  return [[h - c, -h], [h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c], [-h + c, -h]].map(([a, b]) => F.P(u + a, v + b));
}

/* ------------------------------------------------------------------ facades */
// Art Deco brick bay: tan brick coursing, a darker spandrel band across the whole cell under and over the window (the
// Chanin bands), or darker brick piers either side of it (the Eldorado's vertical lines); a wide recessed window with a
// mullion and a transom, curtains and blinds
function decoPainter(o) {
  const O = Object.assign({ wall: [208, 184, 146], band: null, pier: null, win: [0.56, 0.56], winY: 0.2, glass: [34, 44, 54], brick: 5, tone: 0.045 }, o);
  return (g, gb, x, y, w, h, i, j, r) => {
    const tone = 1 + (r() - 0.5) * 2 * O.tone;
    g.fillStyle = rgbs(O.wall, tone); g.fillRect(x, y, w, h);
    const ww = w * O.win[0], wh = h * O.win[1], wx = x + (w - ww) / 2, wy = y + h * (1 - O.winY) - wh;
    if (O.band) {   // spandrel bands: from the sill to the next lintel
      g.fillStyle = rgbs(O.band, 1 + (r() - 0.5) * 0.05);
      g.fillRect(x, wy + wh, w, y + h - (wy + wh)); g.fillRect(x, y, w, Math.max(0, wy - y - h * 0.035));
      gb.fillStyle = 'rgb(150,150,150)'; gb.fillRect(x, wy + wh, w, y + h - (wy + wh));
    }
    if (O.pier) {   // brick piers: full height either side of the window
      const pw = w * 0.11;
      g.fillStyle = rgbs(O.pier, 1 + (r() - 0.5) * 0.05); g.fillRect(x, y, pw, h); g.fillRect(x + w - pw, y, pw, h);
      gb.fillStyle = 'rgb(176,176,176)'; gb.fillRect(x, y, pw, h); gb.fillRect(x + w - pw, y, pw, h);
    }
    if (O.brick) {
      for (let yy = 0; yy < h; yy += O.brick) {
        g.fillStyle = `rgba(20,14,8,${0.06 + r() * 0.05})`; g.fillRect(x, y + yy, w, 1);
        gb.fillStyle = 'rgb(122,122,122)'; gb.fillRect(x, y + yy, w, 1);
      }
      for (let k = 0; k < 22; k++) {
        const bx = x + r() * w, by = y + Math.floor(r() * (h / O.brick)) * O.brick;
        g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.04 + r() * 0.05})` : `rgba(255,240,215,${0.04 + r() * 0.05})`;
        g.fillRect(bx, by, O.brick * (2 + r() * 3), O.brick - 1);
      }
    }
    speckle(g, x, y, w, h, r, Math.round(w * h / 90), 0.06);
    // the recessed window
    const gl = g.createLinearGradient(0, wy, 0, wy + wh);
    gl.addColorStop(0, rgbs([O.glass[0] + 40, O.glass[1] + 46, O.glass[2] + 52])); gl.addColorStop(0.55, rgbs(O.glass)); gl.addColorStop(1, rgbs(O.glass, 0.72));
    g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
    gb.fillStyle = 'rgb(30,30,30)'; gb.fillRect(wx, wy, ww, wh);
    const c = r();
    if (c < 0.22) { g.fillStyle = rgbs([198, 188, 160], 0.82 + r() * 0.2, 0.9); g.fillRect(wx + ww * 0.06, wy + wh * 0.08, ww * 0.88, wh * (0.3 + r() * 0.5)); }
    else if (c < 0.36) { g.fillStyle = rgbs([172, 162, 142], 0.9, 0.85); g.fillRect(wx, wy, ww, wh * (0.25 + r() * 0.3)); }
    else if (c < 0.40) { g.fillStyle = 'rgba(255,214,150,0.55)'; g.fillRect(wx, wy, ww, wh); }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(wx, wy, ww, Math.max(3, wh * 0.07)); g.fillRect(wx, wy, Math.max(3, ww * 0.05), wh);
    g.fillStyle = 'rgba(214,206,190,0.95)';
    g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.3 - 1.5, ww, 3);
    gb.fillStyle = 'rgb(150,150,150)'; gb.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    // a cast-stone sill
    g.fillStyle = 'rgba(222,214,196,1)'; g.fillRect(wx - w * 0.03, wy + wh, ww + w * 0.06, h * 0.035);
    gb.fillStyle = 'rgb(220,220,220)'; gb.fillRect(wx - w * 0.03, wy + wh, ww + w * 0.06, h * 0.035);
    streaks(g, x, y, w, h, r, 3, 0.06);
  };
}
const PROF = {
  water: [[0, -2.0], [0.3, -2.0], [0.3, 0], [0, 0]],
  band: [[0, 0], [0.18, 0], [0.18, 0.12], [0.3, 0.12], [0.3, 0.5], [0, 0.5]],
  cornice: [[0, 0], [0.25, 0], [0.25, 0.14], [0.55, 0.14], [0.55, 0.3], [0.85, 0.3], [0.85, 0.55], [1.0, 0.62], [1.0, 0.9], [0.75, 0.9], [0.75, 1.02], [0, 1.02]],
  deco: [[0, 0], [0.12, 0], [0.12, 0.3], [0.32, 0.3], [0.32, 0.62], [0.12, 0.62], [0.12, 0.9], [0, 0.9]],
  parapet: [[0, 0], [0, 1.1], [-0.38, 1.1], [-0.38, 0]],
  cap: [[0.1, 0], [0.1, 0.14], [-0.48, 0.14], [-0.48, 0]],
  balus: [[0, 0], [0, 0.95], [-0.28, 0.95], [-0.28, 0]],
};

const _M = new Map();
function mats(key, P) {
  if (_M.has(key)) return _M.get(key);
  const up = facadeTex(key + '-up', { nx: 4, ny: 4, cw: 160, ch: 176, seed: P.seed, base: P.wall, paint: decoPainter(P.upper) });
  const lo = facadeTex(key + '-lo', { nx: 4, ny: 3, cw: 160, ch: 184, seed: P.seed + 3, base: P.stoneCol,
    paint: punchedPainter({ wall: P.stoneCol, trim: P.trimCol, win: [0.5, 0.6], winY: 0.12, bars: 'tri', brick: 0, rustic: P.rustic || 0, tone: 0.03 }) });
  const stone = { set: 'climestone', amt: 0.5, nrm: 0.55, rgh: 0.3, ashlar: 0.6 };
  const M = {
    up, lo,
    wallUp: facadeMat(key + '-up', up, { rough: 0.88, bump: 2.0 }),
    wallLo: facadeMat(key + '-lo', lo, { rough: 0.86, bump: 2.2 }),
    trim: mat(P.trimHex, { rough: 0.84, flat: false, stone }),
    dark: mat(P.darkHex ?? 0x7a6a58, { rough: 0.9, flat: false }),
    roof: mat(0x47484c, { rough: 0.92, flat: false }),
    granite: mat(0x8c7f7a, { rough: 0.6, flat: false }),
    glass: mat(0x3a4a58, { rough: 0.22, metal: 0.3, flat: true, skyGlass: { f0: 0.12, rough: 0.06, tint: [0.95, 0.99, 1.03], aureole: 1.5, mullion: 1 } }),
    copper: mat(0x6c9a86, { rough: 0.55, metal: 0.35, flat: false }),
    gilt: mat(0xb89a5c, { rough: 0.45, metal: 0.55, flat: false }),
  };
  _M.set(key, M);
  return M;
}

/* --------------------------------------------------------- shared massing */
// floors: y of the top of floor f (1-based) with a taller ground floor
const floorY = (f, FL, GF) => (f <= 0 ? 0 : GF + (f - 1) * FL);

// the corner solariums: glass wrapping a corner on every floor, 2.4 m along each face (Chanin's corner windows)
function solariums(A, F, corner, du, dv, f0, f1, FL, GF) {
  const [u, v] = corner;   // du, dv: +1 / -1, the faces run from the corner toward +du along u and +dv along v
  for (let f = f0; f <= f1; f++) {
    const y0 = floorY(f - 1, FL, GF) + FL * 0.22, h = FL * 0.56;
    const [ax, az] = F.P(u + du * 1.25, v + dv * 0.04), [bx, bz] = F.P(u + du * 0.04, v + dv * 1.25);
    box(A, ax, y0, az, 2.5, h, 0.12, F.rot);
    box(A, bx, y0, bz, 0.12, h, 2.5, F.rot);
  }
}

function finish(g, F, layers, colliders) {
  addMeshes(g, layers);
  g.userData.colliderBoxes = colliders;
  g.userData.tris = triCount(layers);
  return g;
}
const fallbackRing = (ctx) => { const w = (ctx.obb?.w || 60) / 2, d = (ctx.obb?.h || 60) / 2; return [[-w, -d], [w, -d], [w, d], [-w, d]]; };

/* ------------------------------------------------- the Majestic and the Century */
// Chanin's pair: a 19-storey U round a west court, the wings stepping down to the west, two towers over the park end of
// the wings to the 30th. variant 'majestic': square-headed ornaments on the east tops, round "dynamo" drums on the west;
// 'century': a water tower with vertical buttresses over each tower and grooved slabs beside it
function chanin(ctx, variant) {
  const ring = ctx.footprint && ctx.footprint.length >= 4 ? ctx.footprint : fallbackRing(ctx);
  const F = parkFrame(ring);
  if (!F) return null;
  const maj = variant === 'majestic';
  const P = maj
    ? { seed: 31, wall: [218, 198, 162], stoneCol: [198, 194, 184], trimCol: [224, 218, 204], trimHex: 0xd8d2c4, darkHex: 0x8a6c50,
      upper: { wall: [218, 198, 162], band: [184, 150, 114], win: [0.6, 0.54], winY: 0.22 } }
    : { seed: 47, wall: [220, 200, 162], stoneCol: [210, 184, 134], trimCol: [228, 210, 166], trimHex: 0xdac6a0, darkHex: 0x9a6248,
      upper: { wall: [220, 200, 162], band: [184, 128, 98], win: [0.6, 0.52], winY: 0.22 } };
  const M = mats(variant, P);
  const H = Math.max(80, ctx.height || 105);
  const top30 = maj ? H - 4.6 : H - 7.4;                   // the 30th floor's roof: the crown (the Majestic) / water tower (the Century) above
  const GF = 4.8, FL = (top30 - GF) / 29;
  const y = (f) => floorY(f, FL, GF);
  const W = { up: new Acc(), lo: new Acc() }, T = new Acc(), D = new Acc(), R = new Acc(), G = new Acc(), GL = new Acc();
  const colliders = [];
  // the base: the whole U to the 12th, the wings stepping back from the west lot line (four tiers), the front block to the
  // 19th; cast stone (the Majestic grey, the Century ochre) to the 3rd floor over a granite water table
  const s0 = F.s0;
  loft(G, ring, 0, PROF.water, false);
  wallRing(W.lo, ring, 0, y(3), M.lo, { bayW: 3.2, floorH: (y(3)) / 3, vRef: 0 });
  wallRing(W.up, ring, y(3), y(12), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
  loft(T, ring, y(3), PROF.band, false);
  const tiers = [[12, 14, s0 * 0.78], [14, 16, s0 * 0.62], [16, 19, Math.max(s0 * 0.45, -26)]];
  let prev = ring;
  for (const [f0, f1, vMin] of tiers) {
    const r = clipFrame(ring, F, [[1, 1, vMin]]);
    if (!r) continue;
    capRing(R, prev, y(f0) + 0.02);
    loft(T, prev, y(f0), PROF.balus, false);
    wallRing(W.up, r, y(f0), y(f1), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
    prev = r;
  }
  loft(T, prev, y(19), PROF.cornice, false);
  loft(T, prev, y(19) + 1.02, PROF.parapet, false);
  capRing(R, prev, y(19) + 0.05);
  // the corner solariums of the base on the park front (to the 17th)
  solariums(GL, F, [F.uS, 0], 1, -1, 4, 17, FL, GF);
  solariums(GL, F, [F.uN, 0], -1, -1, 4, 17, FL, GF);
  // the towers: over the park end of each wing, the north one slightly wider (the Majestic), 20th to 30th
  const dT = Math.min(24, -s0 * 0.42);
  const towers = maj ? [[F.uS, F.uS + 17.2], [F.uN - 18.6, F.uN]] : [[F.uS, F.uS + 16.4], [F.uN - 16.8, F.uN]];
  for (const [u0, u1] of towers) {
    const tr = frameRect(F, u0 + 0.6, u1 - 0.6, -dT, -0.6);
    wallRing(W.up, tr, y(19), y(30), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
    for (const f of [22, 25, 28]) loft(T, tr, y(f) - 0.25, PROF.band, false);
    solariums(GL, F, [u0 + 0.6, -0.6], 1, -1, 20, 30, FL, GF);
    solariums(GL, F, [u1 - 0.6, -0.6], -1, -1, 20, 30, FL, GF);
    solariums(GL, F, [u0 + 0.6, -dT], 1, 1, 20, 30, FL, GF);
    solariums(GL, F, [u1 - 0.6, -dT], -1, 1, 20, 30, FL, GF);
    loft(T, tr, y(30), PROF.deco, false);
    loft(T, tr, y(30) + 0.9, PROF.parapet, false);
    loft(T, tr, y(30) + 2.0, PROF.cap, false);
    capRing(R, tr, y(30) + 0.05);
    const uc = (u0 + u1) / 2, vc = -dT / 2 - 0.3, wT = u1 - u0 - 1.2;
    if (maj) {
      // east tops: square-headed piers stepping up across the park face; west tops: round stone drums (the "dynamo")
      for (const [k, hh] of [[-0.3, 3.2], [0, 4.4], [0.3, 3.2]]) {
        const [px, pz] = F.P(uc + k * wT, -0.9);
        box(T, px, y(30), pz, 1.6, hh, 0.9, F.rot);
        box(T, px, y(30) + hh, pz, 2.1, 0.45, 1.2, F.rot);
      }
      for (const k of [-0.3, 0.3]) {
        const [px, pz] = F.P(uc + k * wT, -dT + 2.0);
        cyl(T, px, y(30), pz, 1.55, 1.55, 3.0, 20);
        lathe(T, px, y(30) + 3.0, pz, [[1.75, 0], [1.75, 0.35], [1.2, 0.9], [0.5, 1.25], [0, 1.3]], 20);
      }
      // the stair and tank house behind the crown
      const [hx, hz] = F.P(uc, vc - 2);
      box(D, hx, y(30), hz, Math.min(8, wT * 0.5), 4.0, 6.0, F.rot);
    } else {
      // the water tower: a buttressed enclosure, a grooved slab either side
      const ew = Math.min(9, wT * 0.55), ed = Math.min(7, dT * 0.36), eh = 7.2;
      const [ex, ez] = F.P(uc, vc);
      box(D, ex, y(30), ez, ew, eh, ed, F.rot);
      for (let k = -1; k <= 1; k++) for (const sv of [-1, 1]) {
        const [bx, bz] = F.P(uc + k * ew * 0.33, vc + sv * (ed / 2 + 0.45));
        box(D, bx, y(30), bz, 0.7, eh - 0.6, 0.9, F.rot);
      }
      for (const su of [-1, 1]) {
        const [sx, sz] = F.P(uc + su * (ew / 2 + 1.6), vc);
        box(T, sx, y(30), sz, 0.8, 5.6, ed + 1.2, F.rot);
        for (let gq = -1; gq <= 1; gq++) { const [qx, qz] = F.P(uc + su * (ew / 2 + 2.05), vc + gq * (ed + 1.2) * 0.3); box(D, qx, y(30) + 0.4, qz, 0.12, 4.8, 0.25, F.rot); }
      }
    }
    const [cx2, cz2] = F.P(uc, -dT / 2);
    colliders.push({ x: cx2, y: (y(19) + y(30)) / 2, z: cz2, w: u1 - u0, h: y(30) - y(19), d: dT, rotY: F.rot });
  }
  const [bx, bz] = F.P((F.uS + F.uN) / 2, s0 / 2);
  colliders.push({ x: bx, y: y(12) / 2, z: bz, w: F.L, h: y(12), d: -s0, rotY: F.rot });
  return finish(new THREE.Group(), F, [
    [G, M.granite, variant + '-water'], [W.lo, M.wallLo, variant + '-stone'], [W.up, M.wallUp, variant + '-brick'], [T, M.trim, variant + '-trim'],
    [D, M.dark, variant + '-dark'], [R, M.roof, variant + '-deck'], [GL, M.glass, variant + '-solarium'],
  ], colliders);
}
export const buildMajestic = (ctx) => chanin(ctx, 'majestic');
export const buildCentury = (ctx) => chanin(ctx, 'century');

/* --------------------------------------------------------------- the Eldorado */
export function buildEldorado(ctx) {
  const ring = ctx.footprint && ctx.footprint.length >= 4 ? ctx.footprint : fallbackRing(ctx);
  const F = parkFrame(ring);
  if (!F) return null;
  const P = { seed: 59, wall: [206, 186, 152], stoneCol: [214, 198, 154], trimCol: [226, 212, 176], trimHex: 0xd6c69c, darkHex: 0x8c6a4c,
    upper: { wall: [206, 186, 152], pier: [162, 128, 98], win: [0.56, 0.6], winY: 0.18 } };
  const M = mats('eldorado', P);
  const H = Math.max(80, ctx.height || 104);
  const GF = 4.8, FL = (H - 1.2 - GF) / 28, y = (f) => floorY(f, FL, GF);
  const W = { up: new Acc(), lo: new Acc() }, T = new Acc(), D = new Acc(), R = new Acc(), G = new Acc(), Au = new Acc();
  const colliders = [];
  const s0 = F.s0;
  loft(G, ring, 0, PROF.water, false);
  wallRing(W.lo, ring, 0, y(3), M.lo, { bayW: 3.2, floorH: y(3) / 3, vRef: 0 });
  wallRing(W.up, ring, y(3), y(13), M.up, { bayW: 2.9, floorH: FL, vRef: y(3) });
  loft(T, ring, y(3), PROF.band, false);
  // small setbacks over the 13th to the 17th (the angular balconies), the wings shortening
  let prev = ring;
  for (const [f0, f1, vMin] of [[13, 15, s0 * 0.75], [15, 17, Math.max(s0 * 0.5, -28)]]) {
    const r = clipFrame(ring, F, [[1, 1, vMin]]);
    if (!r) continue;
    capRing(R, prev, y(f0) + 0.02);
    loft(T, prev, y(f0), PROF.balus, false);
    wallRing(W.up, r, y(f0), y(f1), M.up, { bayW: 2.9, floorH: FL, vRef: y(3) });
    prev = r;
  }
  loft(T, prev, y(17), PROF.cornice, false);
  capRing(R, prev, y(17) + 0.05);
  // the towers: six bays on the park, 18th to the 29th, a stepped top, the finials
  const dT = Math.min(22, -s0 * 0.42), wT = 17.6;
  for (const [u0, u1] of [[F.uS, F.uS + wT], [F.uN - wT, F.uN]]) {
    const t1 = frameRect(F, u0 + 0.5, u1 - 0.5, -dT, -0.5);
    wallRing(W.up, t1, y(17), y(26), M.up, { bayW: 2.9, floorH: FL, vRef: y(3) });
    loft(T, t1, y(26), PROF.deco, false);
    capRing(R, t1, y(26) + 0.05);
    const t2 = frameRect(F, u0 + 1.9, u1 - 1.9, -dT + 1.4, -1.9);
    wallRing(W.up, t2, y(26), y(28), M.up, { bayW: 2.9, floorH: FL, vRef: y(3) });
    loft(T, t2, y(28), PROF.deco, false);
    capRing(R, t2, y(28) + 0.05);
    const t3 = frameRect(F, u0 + 3.4, u1 - 3.4, -dT + 2.9, -3.4);
    wallRing(W.up, t3, y(28), H, M.up, { bayW: 2.9, floorH: FL, vRef: y(3) });
    loft(T, t3, H, PROF.parapet, false);
    loft(T, t3, H + 1.1, PROF.cap, false);
    capRing(R, t3, H + 0.05);
    // the finials: a stepped plinth, a fluted shaft between four fins, a pointed head; corner pinnacles
    const uc = (u0 + u1) / 2, vc = -dT / 2 - 0.4;
    const [cx, cz] = F.P(uc, vc);
    box(T, cx, H, cz, 6.4, 1.6, 6.4, F.rot);
    box(T, cx, H + 1.6, cz, 4.8, 1.4, 4.8, F.rot);
    box(Au, cx, H + 3.0, cz, 3.0, 6.5, 3.0, F.rot);
    for (const [fu, fv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [fx, fz] = F.P(uc + fu * 2.0, vc + fv * 2.0);
      box(T, fx, H + 3.0, fz, fu ? 1.4 : 0.32, 7.5, fv ? 1.4 : 0.32, F.rot);
      const [gx, gz] = F.P(uc + fu * 1.6, vc + fv * 1.6);
      box(T, gx, H + 10.5, gz, fu ? 0.9 : 0.28, 2.2, fv ? 0.9 : 0.28, F.rot);
    }
    cyl(Au, cx, H + 9.5, cz, 0.05, 1.9, 5.4, 4, Math.PI / 4 - F.rot);
    lathe(Au, cx, H + 14.9, cz, [[0.22, 0], [0.32, 0.25], [0.12, 0.6], [0.06, 1.6], [0, 1.8]], 8);
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const [px, pz] = F.P(uc + su * (wT / 2 - 4.2), vc + sv * (dT / 2 - 4.2));
      box(T, px, H + 1.1, pz, 1.1, 2.4, 1.1, F.rot);
      cyl(T, px, H + 3.5, pz, 0.05, 0.75, 2.6, 4, Math.PI / 4 - F.rot);
    }
    const [kx, kz] = F.P(uc, -dT / 2);
    colliders.push({ x: kx, y: (y(17) + H) / 2, z: kz, w: wT, h: H - y(17), d: dT, rotY: F.rot });
  }
  const [bx, bz] = F.P(0, s0 / 2);
  colliders.push({ x: bx, y: y(13) / 2, z: bz, w: F.L, h: y(13), d: -s0, rotY: F.rot });
  return finish(new THREE.Group(), F, [
    [G, M.granite, 'eld-water'], [W.lo, M.wallLo, 'eld-stone'], [W.up, M.wallUp, 'eld-brick'], [T, M.trim, 'eld-trim'],
    [D, M.dark, 'eld-dark'], [R, M.roof, 'eld-deck'], [Au, M.gilt, 'eld-finial'],
  ], colliders);
}

/* --------------------------------------------------------------- the Beresford */
export function buildBeresford(ctx) {
  const ring = ctx.footprint && ctx.footprint.length >= 4 ? ctx.footprint : fallbackRing(ctx);
  const F = parkFrame(ring);
  if (!F) return null;
  const P = { seed: 71, wall: [206, 182, 146], stoneCol: [214, 206, 186], trimCol: [232, 220, 196], trimHex: 0xe2d6bc, darkHex: 0x7e6a54, rustic: 30,
    upper: { wall: [206, 182, 146], win: [0.46, 0.56], winY: 0.18 } };
  const M = mats('beresford', P);
  const H = Math.max(70, ctx.height || 90);
  const GF = 4.8, FL = (H - 17.4 - GF) / 21, y = (f) => floorY(f, FL, GF);
  const W = { up: new Acc(), lo: new Acc() }, T = new Acc(), D = new Acc(), R = new Acc(), G = new Acc(), CU = new Acc(), GL = new Acc();
  const colliders = [];
  const s0 = F.s0, sT = 13.6;   // the corner pavilions: 13.6 m square
  const pav = [[F.uN - sT, F.uN, -sT, 0], [F.uS, F.uS + sT, -sT, 0], [F.uS, F.uS + sT, s0, s0 + sT]];   // north-east, south-east, south-west
  loft(G, ring, 0, PROF.water, false);
  wallRing(W.lo, ring, 0, y(3), M.lo, { bayW: 3.2, floorH: y(3) / 3, vRef: 0 });
  loft(T, ring, y(3), PROF.cornice, false);
  wallRing(W.up, ring, y(3), y(14), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
  // setbacks at the 14th, 16th, 18th and 20th behind balustrades: the U steps in from the streets and back from the west
  let prev = ring;
  const tiers = [[14, 16, 1.8, s0 * 0.86], [16, 18, 3.6, s0 * 0.66], [18, 20, 5.4, Math.max(s0 * 0.45, -24)]];
  for (const [f0, f1, inset, vMin] of tiers) {
    const r = clipFrame(ring, F, [[1, 1, vMin], [1, -1, -inset], [0, 1, F.uS + inset], [0, -1, F.uN - inset]]);
    if (!r) continue;
    capRing(R, prev, y(f0) + 0.02);
    loft(T, prev, y(f0), PROF.balus, false);
    wallRing(W.up, r, y(f0), y(f1), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
    prev = r;
  }
  loft(T, prev, y(20), PROF.cornice, false);
  capRing(R, prev, y(20) + 0.05);
  // the corner pavilions rise sheer to the 20th, then the octagonal towers to the 22nd, the pyramidal copper roofs and the
  // copper-and-glass lanterns
  for (const [u0, u1, v0, v1] of pav) {
    const pr = frameRect(F, u0, u1, v0, v1);
    wallRing(W.up, pr, y(14), y(20), M.up, { bayW: 3.0, floorH: FL, vRef: y(3) });
    loft(T, pr, y(20), PROF.cornice, false);
    capRing(R, pr, y(20) + 0.05);
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, wO = sT - 2.2;
    const oc = octagon(F, uc, vc, wO);
    wallRing(W.up, oc, y(20) + 1.0, y(22), M.up, { bayW: 2.6, floorH: FL, vRef: y(3) });
    loft(T, oc, y(20), [[0, 0], [0.4, 0], [0.4, 1.0], [0, 1.0]], false);
    loft(T, oc, y(22), PROF.cornice, false);
    // broken pediments on the four wide faces: two raking halves and an oval light
    for (const [fu, fv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [px, pz] = F.P(uc + fu * (wO / 2 + 0.2), vc + fv * (wO / 2 + 0.2));
      const along = fu ? F.rot + Math.PI / 2 : F.rot;
      box(T, px, y(22) + 1.0, pz, 4.2, 0.5, 0.5, along);
      for (const side of [-1, 1]) {
        const [qx, qz] = F.P(uc + fu * (wO / 2 + 0.2) + (fv ? side * 1.4 : 0), vc + fv * (wO / 2 + 0.2) + (fu ? side * 1.4 : 0));
        box(T, qx, y(22) + 1.5, qz, 1.7, 0.45, 0.45, along, side * 0.38);
      }
      cyl(D, px, y(22) + 1.55, pz, 0.45, 0.45, 0.9, 10);
    }
    // the pyramid: eight faces from the cornice to the lantern's curb
    const oc2 = octagon(F, uc, vc, wO + 0.6), rt = 2.1;
    const yR0 = y(22) + 1.02, yR1 = yR0 + 6.0;
    const cxz = F.P(uc, vc);
    for (let i = 0; i < 8; i++) {
      const a = oc2[i], b = oc2[(i + 1) % 8];
      const ta = [cxz[0] + (a[0] - cxz[0]) * rt / (wO / 2), cxz[1] + (a[1] - cxz[1]) * rt / (wO / 2)];
      const tb = [cxz[0] + (b[0] - cxz[0]) * rt / (wO / 2), cxz[1] + (b[1] - cxz[1]) * rt / (wO / 2)];
      // the face looks out from the tower's axis and up by the pyramid's pitch
      const mxo = (a[0] + b[0]) / 2 - cxz[0], mzo = (a[1] + b[1]) / 2 - cxz[1], ml = Math.hypot(mxo, mzo) || 1;
      const run = Math.max(0.5, ml - rt), rise = yR1 - yR0, nl = Math.hypot(rise, run);
      CU.quad([a[0], yR0, a[1]], [b[0], yR0, b[1]], [tb[0], yR1, tb[1]], [ta[0], yR1, ta[1]], [(mxo / ml) * rise / nl, run / nl, (mzo / ml) * rise / nl]);
    }
    // the lantern: a glazed octagonal drum between copper posts, a copper cap and a finial
    const lan = octagon(F, uc, vc, rt * 2);
    wallRing(GL, lan, yR1, yR1 + 3.0, M.up, { bayW: 1.0, floorH: 3, vRef: 0 });
    for (const p of lan) cyl(CU, p[0], yR1, p[1], 0.14, 0.14, 3.0, 6);
    lathe(CU, cxz[0], yR1 + 3.0, cxz[1], [[rt + 0.35, 0], [rt + 0.35, 0.3], [rt * 0.7, 1.4], [0.4, 2.3], [0.4, 2.6], [0, 2.7]], 8, Math.PI / 8 - F.rot);
    lathe(CU, cxz[0], yR1 + 5.7, cxz[1], [[0.25, 0], [0.36, 0.3], [0.16, 0.8], [0.08, 2.0], [0, 2.2]], 8);
    // urns on the octagon's corners
    for (const p of oc) { cyl(T, p[0], y(22) + 1.02, p[1], 0.32, 0.22, 0.7, 8); cyl(T, p[0], y(22) + 1.72, p[1], 0.05, 0.36, 0.6, 8); }
    const [kx, kz] = F.P(uc, vc);
    colliders.push({ x: kx, y: (y(14) + yR1) / 2, z: kz, w: sT, h: yR1 - y(14), d: sT, rotY: F.rot });
  }
  const [bx, bz] = F.P(0, s0 / 2);
  colliders.push({ x: bx, y: y(14) / 2, z: bz, w: F.L, h: y(14), d: -s0, rotY: F.rot });
  return finish(new THREE.Group(), F, [
    [G, M.granite, 'ber-water'], [W.lo, M.wallLo, 'ber-stone'], [W.up, M.wallUp, 'ber-brick'], [T, M.trim, 'ber-trim'],
    [D, M.dark, 'ber-dark'], [R, M.roof, 'ber-deck'], [CU, M.copper, 'ber-copper'], [GL, M.glass, 'ber-lantern'],
  ], colliders);
}
