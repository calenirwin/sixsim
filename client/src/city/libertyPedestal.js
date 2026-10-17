// The Statue of Liberty's pedestal (Richard Morris Hunt, 1886) and Fort Wood (1811) under it, from the Historic American
// Engineering Record's measured drawings (HAER NY-138: the south pedestal elevation, sheet 21, and the south fort
// elevation, sheet 20, both 1:128; Library of Congress, public domain) and Fort Wood's eleven-pointed star from
// OpenStreetMap (city/libertyData.js FORT). Drawn in the statue's frame (+x her left, +z her front) at the drawings'
// heights, metres over their datum (the ground at the fort's entrance; the island's ground stands 1.9 m over it at the
// fort's foot, sheet 20). The four faces of the pedestal are alike (each has its loggia and its door); the courses are
// Stony Creek granite, rock-faced on the corner piers, dressed elsewhere (the bridge kit's stone: generated coursed maps,
// weathering), floodlit from the fort after dark.
import * as THREE from 'three';
import * as KM from './br/mats.js';
import { FORT } from './libertyData.js';

// ---------------------------------------------------------------- materials (the kit's stone, floodlit; dark recesses)
const lit = { y0: 3.0, y1: 55, k: 0.8, col: 0xfff0dc, wl: -6, sub: 2.2, ledges: [] };   // (world heights: the root stands at the datum, 1.6 m)
export const pedMats = () => ({
  rock: KM.ashlarLit(0xbaa898, 1.25, { ...lit, style: 'rock', seed: 11 }),
  dressed: KM.ashlarLit(0xc2b2a2, 1.25, { ...lit, style: 'dressed', seed: 12 }),
  trim: KM.ashlarLit(0xcab9a8, 0.8, { ...lit, style: 'dressed', seed: 13 }),
  fort: KM.ashlarLit(0xa29b91, 1.6, { ...lit, style: 'dressed', seed: 14, y1: 20 }),
  fortTop: KM.granite(0xb3aca2),
  dark: KM.paint(0x26231f, { rough: 0.92, metal: 0 }),
  bronze: KM.paint(0x5a4630, { rough: 0.42, metal: 0.85 }),
  glass: KM.paint(0x1d2226, { rough: 0.15, metal: 0.5 }),
  grille: KM.web(0x2a2724, 0.55),
});

// ---------------------------------------------------------------- helpers in the statue's frame
// face f: 0 her front (+z), 1 her left (+x), 2 her back (-z), 3 her right (-x); a point (t along the face, n out of it)
const FACE = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];   // [tx, tz, nx, nz]
const fp = (f, t, n) => { const [tx, tz, nx, nz] = FACE[f]; return [t * tx + n * nx, t * tz + n * nz]; };
// a box in face f's frame: t0..t1 along, n0..n1 out, y0..y1 (axis-aligned in the statue's frame, since the faces are)
function fbox(bag, mat, f, t0, t1, n0, n1, y0, y1, skip) {
  const a = fp(f, t0, n0), b = fp(f, t1, n1);
  bag.aabb(mat, Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y1, Math.max(a[1], b[1]), skip);
}
// a square band round the axis (half width hw) from y0 to y1, its top and sides (its underside where `under`)
function band(bag, mat, hw, y0, y1, under = false) {
  bag.aabb(mat, -hw, y0, -hw, hw, y1, hw, under ? null : new Set(['-y']));
}
// a square frustum round the axis: half width hw0 at y0 to hw1 at y1 (a cove, a batter, a splayed cornice), its four faces
function frustum(bag, mat, y0, y1, hw0, hw1, top = false) {
  for (let f = 0; f < 4; f++) {
    const a = fp(f, -hw0, hw0), b = fp(f, hw0, hw0), c = fp(f, hw1, hw1), d = fp(f, -hw1, hw1);
    const [, , nx, nz] = FACE[f], sl = (hw1 - hw0) / Math.max(0.01, y1 - y0), l = Math.hypot(1, sl);
    bag.quad(mat, [a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]], [nx / l, -sl / l, nz / l]);
  }
  if (top) bag.aabb(mat, -hw1, y1 - 0.01, -hw1, hw1, y1, hw1, new Set(['-y', '+x', '-x', '+z', '-z']));
}
// a triangular prism on face f: base t0..t1 at y0, apex at y1, n0..n1 deep (a gablet, a pediment)
function gable(bag, mat, f, t0, t1, n0, n1, y0, y1) {
  const tm = (t0 + t1) / 2, P = (t, n, y) => { const q = fp(f, t, n); return [q[0], y, q[1]]; };
  const [, , nx, nz] = FACE[f];
  for (const [n, s] of [[n1, 1], [n0, -1]]) bag.poly(mat, [P(t0, n, y0), P(t1, n, y0), P(tm, n, y1)], [nx * s, 0, nz * s]);
  const hl = Math.hypot((t1 - t0) / 2, y1 - y0) || 1;
  const [tx, tz] = FACE[f];
  bag.quad(mat, P(t0, n0, y0), P(t0, n1, y0), P(tm, n1, y1), P(tm, n0, y1), [-tx * (y1 - y0) / hl, ((t1 - t0) / 2) / hl, -tz * (y1 - y0) / hl]);
  bag.quad(mat, P(t1, n1, y0), P(t1, n0, y0), P(tm, n0, y1), P(tm, n1, y1), [tx * (y1 - y0) / hl, ((t1 - t0) / 2) / hl, tz * (y1 - y0) / hl]);
}
// a disc (a short cylinder) standing out of face f at (t, y): radius r, from n0 to n1
function disc(bag, mat, f, t, y, r, n0, n1, sides = 16) {
  const a = fp(f, t, n0), b = fp(f, t, n1);
  bag.rod(mat, [a[0], y, a[1]], [b[0], y, b[1]], r, sides, r, true);
}

// ---------------------------------------------------------------- the pedestal (sheet 21: heights over the datum)
export function pedestal(bag, M) {
  const lod = bag.lod;
  // ---- the base: the fort's terrace block (40.2 m square) with its top course, the second step and its coping
  band(bag, M.dressed, 20.1, 9.7, 11.9);
  band(bag, M.trim, 20.0, 11.9, 13.0);
  band(bag, M.dressed, 12.9, 13.0, 15.0);
  band(bag, M.trim, 12.75, 15.0, 16.1);
  // ---- the shaft's battered base with the door (16.1-19.5), the string course, the band of discs (19.9-21.65), its
  // projecting course, the gablets' course, two set-back courses up to the shaft
  frustum(bag, M.dressed, 16.1, 19.5, 9.3, 9.08);
  band(bag, M.trim, 9.0, 19.5, 19.9);
  band(bag, M.dressed, 8.6, 19.9, 21.65);
  band(bag, M.trim, 8.85, 21.65, 22.9);
  band(bag, M.dressed, 8.3, 22.9, 23.75);
  band(bag, M.trim, 8.13, 23.75, 24.7);
  band(bag, M.trim, 7.8, 24.7, 25.0);
  // ---- the shaft: dressed between the corner piers; the piers rock-faced and proud (25.0-34.7), broken by the string course
  band(bag, M.dressed, 7.45, 25.0, 28.7);
  band(bag, M.trim, 7.75, 28.7, 29.1);
  band(bag, M.dark, 6.55, 29.1, 34.55);   // (the loggias' back walls, in shadow)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const [y0, y1] of [[25.0, 28.7], [29.1, 34.55]]) bag.aabb(M.rock, sx > 0 ? 4.8 : -7.62, y0, sz > 0 ? 4.8 : -7.62, sx > 0 ? 7.62 : -4.8, y1, sz > 0 ? 7.62 : -4.8);
  }
  // ---- the cornice over the loggias: the architrave, the cove flaring out, the balcony's floor, its parapet with posts
  band(bag, M.trim, 7.58, 34.55, 35.08);
  frustum(bag, M.trim, 35.08, 35.9, 7.07, 7.58);
  band(bag, M.trim, 8.08, 35.9, 36.96, true);
  // ---- the attic (38.15-40.94) on its base step, the cornice's cove (40.94-41.6) and band, the statue's die (42.05-43.49)
  band(bag, M.dressed, 6.77, 36.96, 39.2);
  band(bag, M.dressed, 6.26, 39.2, 40.94);
  frustum(bag, M.trim, 40.94, 41.6, 6.26, 6.73);
  band(bag, M.trim, 6.62, 41.6, 42.05, true);
  band(bag, M.dressed, 6.0, 42.05, 43.49);
  for (let f = 0; f < 4; f++) {
    // the balcony parapet's wall segments between the posts (36.96-37.95) and the posts (to 38.4, round-topped)
    fbox(bag, M.trim, f, -8.18, 8.18, 7.72, 8.18, 36.96, 37.95);
    if (lod < 2) for (const t of [-8.0, -4.7, -1.55, 1.55, 4.7, 8.0]) {
      fbox(bag, M.trim, f, t - 0.3, t + 0.3, 7.7, 8.25, 36.96, 38.15);
      const a = fp(f, t, 7.68), b = fp(f, t, 8.27);
      bag.rod(M.trim, [a[0], 38.15, a[1]], [b[0], 38.15, b[1]], 0.3, 10, 0.3, true);
    }
    if (lod > 1) continue;
    // ---- the loggia: four fluted Doric columns (1.3 m) on their bases, capitals under the architrave; the balcony's
    // rail between them; the door in the back wall
    for (const t of [-4.24, -1.43, 1.43, 4.24]) {
      const p = fp(f, t, 7.0);
      bag.rod(M.trim, [p[0], 29.45, p[1]], [p[0], 34.2, p[1]], 0.6, lod ? 8 : 20, 0.55, false);
      fbox(bag, M.trim, f, t - 0.68, t + 0.68, 6.32, 7.68, 29.1, 29.45);
      fbox(bag, M.trim, f, t - 0.72, t + 0.72, 6.28, 7.72, 34.2, 34.55);
      if (!lod) for (let k = 0; k < 10; k++) {   // (the flutes' arrises: thin ribs round the shaft)
        const a = (k / 10) * Math.PI * 2, q = [p[0] + Math.cos(a) * 0.6, p[1] + Math.sin(a) * 0.6];
        bag.rod(M.trim, [q[0], 29.5, q[1]], [q[0], 34.15, q[1]], 0.045, 4, 0.04, false);
      }
    }
    fbox(bag, M.trim, f, -4.8, 4.8, 7.12, 7.5, 29.1, 30.45);
    fbox(bag, M.trim, f, -4.8, 4.8, 7.05, 7.57, 30.45, 30.62);
    fbox(bag, M.dark, f, -0.7, 0.7, 6.55, 6.62, 30.62, 31.7);
    fbox(bag, M.trim, f, -0.85, 0.85, 6.55, 6.7, 31.7, 31.85);
    // ---- the panel between the piers below the loggia (25.2-28.3): its moulded frame
    for (const [t0, t1, y0, y1] of [[-3.74, 3.74, 25.15, 25.35], [-3.74, 3.74, 28.15, 28.35], [-3.74, -3.54, 25.15, 28.35], [3.54, 3.74, 25.15, 28.35]]) fbox(bag, M.trim, f, t0, t1, 7.45, 7.6, y0, y1);
    // ---- the band's ten discs (r 0.67 m) and the eight gablets on the course over it
    for (let k = 0; k < 10; k++) disc(bag, M.trim, f, -7.65 + 1.7 * k, 20.78, 0.64, 8.55, 8.72, lod ? 10 : 20);
    for (let k = 0; k < 8; k++) gable(bag, M.trim, f, -7.0 + 2.0 * k - 0.45, -7.0 + 2.0 * k + 0.45, 8.0, 8.42, 23.75, 24.3);
    // ---- the door at the shaft's foot: its opening, the pilasters with their roundels, the cornice and the pediment
    fbox(bag, M.dark, f, -0.6, 0.6, 9.2, 9.32, 16.1, 17.3);
    for (const s of [-1, 1]) {
      fbox(bag, M.trim, f, s * 1.0, s * 1.9, 9.18, 9.42, 16.1, 18.4);
      disc(bag, M.trim, f, s * 1.45, 16.75, 0.42, 9.38, 9.5, 14);
    }
    fbox(bag, M.trim, f, -2.1, 2.1, 9.12, 9.5, 18.4, 18.62);
    gable(bag, M.trim, f, -2.07, 2.07, 9.1, 9.45, 18.62, 19.28);
    // ---- the attic's pedimented window and the base's vents and slit windows
    fbox(bag, M.dark, f, -0.55, 0.55, 6.72, 6.8, 38.3, 39.7);
    fbox(bag, M.trim, f, -1.15, 1.15, 6.7, 6.95, 39.7, 39.86);
    gable(bag, M.trim, f, -1.15, 1.15, 6.7, 6.92, 39.86, 40.4);
    for (const t of [-17.2, -15.05, 15.05, 17.2]) fbox(bag, M.grille, f, t - 0.65, t + 0.65, 20.1, 20.16, 9.8, 11.1);
    for (const t of [-11.7, 11.7]) fbox(bag, M.dark, f, t - 0.18, t + 0.18, 12.9, 12.96, 13.2, 14.6);
  }
  // the dedication: a bronze tablet on the panel of the north face (her back: the face toward the island's dock and the
  // museum, where the visitors' way comes up)
  if (lod < 2) fbox(bag, M.bronze, 2, -2.2, 2.2, 7.45, 7.55, 25.7, 27.7);
}

// ---------------------------------------------------------------- Fort Wood
// the star's walls of grey granite from below the ground to the terreplein (9.7 m over the datum), battered (0.55 m in
// over the height), a coping proud of the face, a low parapet round the walk on top; the walk paved; the entrance passage
// on the north (the screening building's side)
export function fortWood(bag, M, ROT) {
  const c = Math.cos(-ROT), s = Math.sin(-ROT);
  const pts = FORT.map(([x, z]) => [x * c + z * s, -x * s + z * c]);   // (into the statue's frame)
  const n = pts.length, cx = pts.reduce((a, p) => a + p[0], 0) / n, cz = pts.reduce((a, p) => a + p[1], 0) / n;
  const Y0 = 0.4, TOP = 9.7, BAT = 0.55, COP = 0.35;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    let nx = dz / l, nz = -dx / l;
    if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    if (l < 0.05) continue;
    const sl = BAT / (TOP - Y0), ln = Math.hypot(1, sl);
    // the battered face: the foot out by the batter
    bag.quad(M.fort, [a[0] + nx * BAT, Y0, a[1] + nz * BAT], [b[0] + nx * BAT, Y0, b[1] + nz * BAT], [b[0], TOP, b[1]], [a[0], TOP, a[1]], [nx / ln, sl / ln, nz / ln]);
    // the coping: proud by 0.15 m, 0.35 m deep
    bag.quad(M.fort, [a[0] + nx * 0.15, TOP, a[1] + nz * 0.15], [b[0] + nx * 0.15, TOP, b[1] + nz * 0.15], [b[0] + nx * 0.15, TOP + COP, b[1] + nz * 0.15], [a[0] + nx * 0.15, TOP + COP, a[1] + nz * 0.15], [nx, 0, nz]);
    bag.quad(M.fort, [a[0], TOP, a[1]], [b[0], TOP, b[1]], [b[0] + nx * 0.15, TOP, b[1] + nz * 0.15], [a[0] + nx * 0.15, TOP, a[1] + nz * 0.15], [0, -1, 0]);
    // the parapet round the walk: 0.55 m thick, 0.95 m over the walk, its top
    const pi = 0.55;
    bag.quad(M.fort, [a[0] + nx * 0.15, TOP + COP, a[1] + nz * 0.15], [b[0] + nx * 0.15, TOP + COP, b[1] + nz * 0.15], [b[0] + nx * 0.15, TOP + 1.3, b[1] + nz * 0.15], [a[0] + nx * 0.15, TOP + 1.3, a[1] + nz * 0.15], [nx, 0, nz]);
    bag.quad(M.fort, [a[0] + nx * 0.15, TOP + 1.3, a[1] + nz * 0.15], [b[0] + nx * 0.15, TOP + 1.3, b[1] + nz * 0.15], [b[0] - nx * pi, TOP + 1.3, b[1] - nz * pi], [a[0] - nx * pi, TOP + 1.3, a[1] - nz * pi], [0, 1, 0]);
    bag.quad(M.fort, [b[0] - nx * pi, TOP + COP, b[1] - nz * pi], [a[0] - nx * pi, TOP + COP, a[1] - nz * pi], [a[0] - nx * pi, TOP + 1.3, a[1] - nz * pi], [b[0] - nx * pi, TOP + 1.3, b[1] - nz * pi], [-nx, 0, -nz]);
  }
  // the walk on top: the star, fanned from its centre, at the coping's top (under the terrace block in the middle)
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; bag.poly(M.fortTop, [[cx, TOP + COP, cz], [a[0], TOP + COP, a[1]], [b[0], TOP + COP, b[1]]], [0, 1, 0]); }
  // the entrance passage on the north: a dark opening (3.2 x 4.2 m) in the wall facing the screening building
  const dir = (() => { const wx = 0.34, wz = -0.94; return [wx * c + wz * s, -wx * s + wz * c]; })();   // world north-north-east, into the frame
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 6) continue;
    const sc = (mx - cx) * dir[0] + (mz - cz) * dir[1];
    if (!best || sc > best.sc) best = { sc, a, b, mx, mz, l };
  }
  if (best && bag.lod < 2) {
    const { a, b, mx, mz, l } = best, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    let nx = tz, nz = -tx;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
    const P = (t, nn, y) => [mx + tx * t + nx * nn, y, mz + tz * t + nz * nn];
    bag.quad(M.dark, P(-1.6, BAT * 0.9 + 0.03, 1.9), P(1.6, BAT * 0.9 + 0.03, 1.9), P(1.6, BAT * 0.55 + 0.03, 6.1), P(-1.6, BAT * 0.55 + 0.03, 6.1), [nx, 0, nz]);
    // its granite surround
    for (const [t0, t1, y0, y1] of [[-2.1, -1.6, 1.9, 6.6], [1.6, 2.1, 1.9, 6.6], [-2.1, 2.1, 6.1, 6.6]]) {
      bag.quad(M.trim, P(t0, BAT * 0.9 + 0.12, y0), P(t1, BAT * 0.9 + 0.12, y0), P(t1, BAT * 0.5 + 0.12, y1), P(t0, BAT * 0.5 + 0.12, y1), [nx, 0, nz]);
    }
  }
}
