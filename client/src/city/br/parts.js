// The bridge kit's parts, laid out in a bridge's frame (br/frame.js: station s along the centre line, offset o across it,
// positive to the left, heights y absolute over mean high water). Each part writes into a GeoBag (br/geom.js).
import * as THREE from 'three';
import { V } from './geom.js';
import { webOf } from './mats.js';

// a member between two frame points (s, o, y), rectangular section w (across the member, horizontal) x h
export function memberSO(bag, F, mat, s0, o0, y0, s1, o1, y1, w, h, up) {
  bag.beam(mat, F.P(s0, o0, y0), F.P(s1, o1, y1), w, h, up);
}

// a slab between o0 and o1 (o0 < o1) whose top follows ytop(s), `thick` deep, from s0 to s1 in steps; the ends capped
export function slab(bag, F, mat, s0, s1, o0, o1, ytop, thick, step = 4, o = {}) {
  const ss = F.range(s0, s1, step);
  const T = (s) => ytop(s), B = (s) => ytop(s) - thick;
  for (let i = 0; i + 1 < ss.length; i++) {
    const a = ss[i], b = ss[i + 1];
    if (o.top !== false) bag.quad(mat, F.P(a, o0, T(a)), F.P(b, o0, T(b)), F.P(b, o1, T(b)), F.P(a, o1, T(a)), [0, 1, 0]);
    if (o.bottom !== false) bag.quad(mat, F.P(a, o0, B(a)), F.P(a, o1, B(a)), F.P(b, o1, B(b)), F.P(b, o0, B(b)), [0, -1, 0]);
    if (o.sides !== false) for (const [oo, sg] of [[o0, -1], [o1, 1]]) {
      const n = F.at((a + b) / 2).n;
      bag.quad(mat, F.P(a, oo, B(a)), F.P(b, oo, B(b)), F.P(b, oo, T(b)), F.P(a, oo, T(a)), [n[0] * sg, 0, n[2] * sg]);
    }
  }
  if (o.caps !== false) for (const [s, sg] of [[s0, -1], [s1, 1]]) {
    const t = F.at(s).t;
    bag.quad(mat, F.P(s, o0, B(s)), F.P(s, o1, B(s)), F.P(s, o1, T(s)), F.P(s, o0, T(s)), [t[0] * sg, 0, t[2] * sg]);
  }
}

// lane lines on a roadway: `lines` = [{ o, w, dash: [on, off] | null, yellow }] at ytop(s) + lift
export function laneLines(bag, F, matW, matY, s0, s1, ytop, lines, lift = 0.012) {
  if (bag.lod) return;
  for (const L of lines) {
    const mat = L.yellow ? matY : matW;
    const segs = [];
    if (!L.dash) segs.push([s0, s1]);
    else for (let s = s0 + (L.phase || 0); s < s1; s += L.dash[0] + L.dash[1]) segs.push([s, Math.min(s1, s + L.dash[0])]);
    for (const [a, b] of segs) {
      const ss = F.range(a, b, 6);
      for (let i = 0; i + 1 < ss.length; i++) {
        const p = ss[i], q = ss[i + 1], y = (s) => ytop(s) + lift;
        bag.quad(mat, F.P(p, L.o - L.w / 2, y(p)), F.P(q, L.o - L.w / 2, y(q)), F.P(q, L.o + L.w / 2, y(q)), F.P(p, L.o + L.w / 2, y(p)), [0, 1, 0]);
      }
    }
  }
}

// a truss in the vertical plane at offset o, chords at top(s) and bot(s), panel points every `panel` from s0 to s1:
// pattern 'X' (verticals and crossed diagonals), 'warren' (alternating diagonals), 'warrenV' (alternating diagonals
// with verticals), 'pratt' (verticals, diagonals falling to mid-span), 'lattice' (double-intersection diagonals);
// sizes: chord [w, h], vert [w, h], diag [w, h]
export function truss(bag, F, mat, s0, s1, o, top, bot, panel, pattern, sz) {
  const coarse = bag.lod > 0;   // the coarse level: chords and verticals only
  const n = Math.max(1, Math.round((s1 - s0) / panel)), dp = (s1 - s0) / n;
  const S = (i) => s0 + i * dp;
  const ch = sz.chord, vt = sz.vert, dg = sz.diag;
  // chords, one member per panel (following the profile)
  for (let i = 0; i < n; i++) {
    const a = S(i), b = S(i + 1);
    memberSO(bag, F, mat, a, o, top(a) - ch[1] / 2, b, o, top(b) - ch[1] / 2, ch[0], ch[1]);
    memberSO(bag, F, mat, a, o, bot(a) + ch[1] / 2, b, o, bot(b) + ch[1] / 2, ch[0], ch[1]);
  }
  const mid = (s0 + s1) / 2;
  // the coarse level: the web as a panel between the chords at the cover of its members
  if (coarse && sz.web !== false) for (let i = 0; i < n; i++) {
    const a = S(i), b = S(i + 1);
    bag.quad(webOf(mat, sz.cover ?? 0.42), F.P(a, o, bot(a) + ch[1]), F.P(b, o, bot(b) + ch[1]), F.P(b, o, top(b) - ch[1]), F.P(a, o, top(a) - ch[1]), null);
  }
  for (let i = 0; i <= n; i++) {
    const a = S(i);
    const vert = pattern === 'X' || pattern === 'warrenV' || pattern === 'pratt' || i === 0 || i === n;
    if (vert || (coarse && i % 2 === 0)) memberSO(bag, F, mat, a, o, bot(a) + ch[1], a, o, top(a) - ch[1], vt[0], vt[1]);
    if (i === n || coarse) continue;
    const b = S(i + 1);
    const yb = (s) => bot(s) + ch[1], yt = (s) => top(s) - ch[1];
    if (pattern === 'X' || pattern === 'lattice') {
      memberSO(bag, F, mat, a, o, yb(a), b, o, yt(b), dg[0], dg[1]);
      memberSO(bag, F, mat, a, o, yt(a), b, o, yb(b), dg[0], dg[1]);
    } else if (pattern === 'warren' || pattern === 'warrenV') {
      if (i % 2 === 0) memberSO(bag, F, mat, a, o, yb(a), b, o, yt(b), dg[0], dg[1]);
      else memberSO(bag, F, mat, a, o, yt(a), b, o, yb(b), dg[0], dg[1]);
    } else if (pattern === 'pratt') {
      if (b <= mid) memberSO(bag, F, mat, a, o, yt(a), b, o, yb(b), dg[0], dg[1]);
      else memberSO(bag, F, mat, a, o, yb(a), b, o, yt(b), dg[0], dg[1]);
    }
  }
}

// transverse beams every `step` from s0 to s1, spanning o0..o1 with their top at ytop(s), w along x h deep
export function crossBeams(bag, F, mat, s0, s1, step, o0, o1, ytop, w, h) {
  if (bag.lod && h < 1.2) return;
  for (const s of F.range(s0, s1, step)) memberSO(bag, F, mat, s, o0, ytop(s) - h / 2, s, o1, ytop(s) - h / 2, w, h);
}
// crossed bracing in a horizontal plane at y(s) between o0 and o1, one X per `step`
export function lateralX(bag, F, mat, s0, s1, step, o0, o1, y, w) {
  if (bag.lod) return;
  const ss = F.range(s0, s1, step);
  for (let i = 0; i + 1 < ss.length; i++) {
    const a = ss[i], b = ss[i + 1];
    memberSO(bag, F, mat, a, o0, y(a), b, o1, y(b), w, w);
    memberSO(bag, F, mat, a, o1, y(a), b, o0, y(b), w, w);
  }
}
// a railing at offset o on ybase(s): posts every `post`, a top rail at h, a mid rail
export function railing(bag, F, mat, s0, s1, o, ybase, h = 1.1, post = 2.4, sz = 0.07) {
  if (bag.lod) return;
  const ss = F.range(s0, s1, post);
  for (const s of ss) memberSO(bag, F, mat, s, o, ybase(s), s, o, ybase(s) + h, sz, sz);
  for (let i = 0; i + 1 < ss.length; i++) {
    const a = ss[i], b = ss[i + 1];
    memberSO(bag, F, mat, a, o, ybase(a) + h, b, o, ybase(b) + h, sz * 1.6, sz * 1.2);
    memberSO(bag, F, mat, a, o, ybase(a) + h * 0.45, b, o, ybase(b) + h * 0.45, sz * 0.8, sz * 0.8);
  }
}

// a lattice rail (the Brooklyn Bridge's promenade): top and bottom rails, posts every `post`, and a diamond lattice of
// flat bars between them at `pitch` (each bar two quads, one a side)
export function latticeRail(bag, F, mat, s0, s1, o, ybase, h = 1.25, post = 2.29, pitch = 0.9, side = 1) {
  if (bag.lod) return;
  railing(bag, F, mat, s0, s1, o, ybase, h, post, 0.07);
  const y0 = (s) => ybase(s) + 0.12, y1 = (s) => ybase(s) + h - 0.06, n = F.at((s0 + s1) / 2).n, nn = [n[0] * side, 0, n[2] * side];
  const bar = (a, ya, b, yb) => {
    const A = F.P(a, o, ya), B = F.P(b, o, yb), w = 0.022;
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L = Math.hypot(dx, dy, dz) || 1;
    // the bar's width runs across its length in the rail's plane
    const t = F.at(a).t, ux = (t[0] * dy) / L, uz = (t[2] * dy) / L, uy = -(dx * t[0] + dz * t[2]) / L;
    const q = [[A[0] - ux * w, A[1] - uy * w, A[2] - uz * w], [B[0] - ux * w, B[1] - uy * w, B[2] - uz * w], [B[0] + ux * w, B[1] + uy * w, B[2] + uz * w], [A[0] + ux * w, A[1] + uy * w, A[2] + uz * w]];
    bag.quad(mat, q[0], q[1], q[2], q[3], nn);
    bag.quad(mat, q[0], q[3], q[2], q[1], [-nn[0], 0, -nn[2]]);
  };
  for (let s = s0; s + pitch <= s1; s += pitch) {
    bar(s, y0(s), s + pitch, y1(s + pitch));
    bar(s, y1(s), s + pitch, y0(s + pitch));
  }
}

// ---------------------------------------------------------------- cables
// a cable's height along s: parabolic segments between supports [[s, y], ...] with a sag `f` at each segment's middle
// (measured below the chord); returns y(s)
export function cableY(supports, sags) {
  return (s) => {
    let k = 0;
    while (k < supports.length - 2 && s > supports[k + 1][0]) k++;
    const [sa, ya] = supports[k], [sb, yb] = supports[k + 1];
    const t = Math.max(0, Math.min(1, (s - sa) / Math.max(1e-6, sb - sa)));
    return ya + (yb - ya) * t - 4 * sags[k] * t * (1 - t);
  };
}
// the cable's points at offset o from s0 to s1 (dense near the supports where it bends)
export function cablePts(F, y, o, s0, s1, step = 3) {
  return F.range(s0, s1, step).map((s) => F.P(s, o, y(s)));
}
// vertical suspenders at offset o every `step` from s0 to s1, from the cable y(s) down to yb(s); a band at the top
export function suspenders(bag, F, mat, y, yb, o, s0, s1, step, r, bandMat = null, bandR = 0) {
  if (bag.lod) return;
  const n = Math.max(1, Math.round((s1 - s0) / step));
  for (let i = 1; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, top = y(s), bot = yb(s);
    if (top - bot < 0.6) continue;
    bag.rod(mat, F.P(s, o, bot), F.P(s, o, top - (bandR || 0)), r, 4);
    if (bandMat && bandR) bag.rod(bandMat, F.P(s - bandR * 1.4, o, top), F.P(s + bandR * 1.4, o, top), bandR, 6, bandR, true);
  }
}

// ---------------------------------------------------------------- masonry
// a vertical-sided block in the frame: s0..s1 along, o0..o1 across, y0..y1
export function block(bag, F, mat, s0, s1, o0, o1, y0, y1, skip) {
  const sm = (s0 + s1) / 2, c = F.P(sm, (o0 + o1) / 2, (y0 + y1) / 2), fr = F.at(sm);
  bag.obox(mat, c, fr.n, [0, 1, 0], V.cross(fr.n, [0, 1, 0]), (o1 - o0) / 2, (y1 - y0) / 2, (s1 - s0) / 2, skip);
}
// a tapering block (a battered pier): the footprint at y0 (half lengths a0 along, b0 across) shrinking to (a1, b1) at y1
export function taper(bag, F, mat, s, o, y0, y1, a0, b0, a1, b1) {
  const fr = F.at(s), t = fr.t, n = fr.n, c = F.P(s, o, 0);
  const P = (a, b, y) => [c[0] + t[0] * a + n[0] * b, y, c[2] + t[2] * a + n[2] * b];
  const lo = [P(-a0, -b0, y0), P(a0, -b0, y0), P(a0, b0, y0), P(-a0, b0, y0)];
  const hi = [P(-a1, -b1, y1), P(a1, -b1, y1), P(a1, b1, y1), P(-a1, b1, y1)];
  bag.poly(mat, hi, [0, 1, 0]);
  bag.poly(mat, lo.slice().reverse(), [0, -1, 0]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, mx = (lo[i][0] + lo[j][0] + hi[i][0] + hi[j][0]) / 4 - c[0], mz = (lo[i][2] + lo[j][2] + hi[i][2] + hi[j][2]) / 4 - c[2];
    const e = V.sub(lo[j], lo[i]), up = V.sub(hi[i], lo[i]);
    let nn = V.norm(V.cross(e, up));
    if (nn[0] * mx + nn[2] * mz < 0) nn = V.mul(nn, -1);
    bag.quad(mat, lo[i], lo[j], hi[j], hi[i], nn);
  }
}

// a portal pier (the Outerbridge Crossing's): two battered legs at +-o (half `legA` along the deck, `legB` across) joined
// under a cap `capH` deep by a round arch springing from the legs' inner faces (rise `rise`), from `base` to `top`
export function portalPier(bag, F, mat, s, o, base, top, legA, legB, capH, rise) {
  const yc = top - capH, inner = o - legB;
  for (const sg of [-1, 1]) taper(bag, F, mat, s, sg * o, base, yc, legA * 1.08, legB * 1.08, legA, legB);
  block(bag, F, mat, s - legA - 0.15, s + legA + 0.15, -o - legB - 0.3, o + legB + 0.3, yc, top);
  if (inner > 0.5 && rise > 0.3 && yc - rise > base + 1) {
    const fr = F.at(s), m = new THREE.Matrix4(), p = F.P(s, 0, 0);
    m.makeBasis(new THREE.Vector3(...fr.n), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...fr.t));
    m.setPosition(p[0] - fr.t[0] * legA, 0, p[2] - fr.t[2] * legA);
    const sh = new THREE.Shape(), ys = yc - rise;
    sh.moveTo(-inner, yc); sh.lineTo(-inner, ys);
    for (let i = 1; i < 16; i++) { const a = Math.PI - (Math.PI * i) / 16; sh.lineTo(inner * Math.cos(a), ys + rise * Math.sin(a)); }
    sh.lineTo(inner, ys); sh.lineTo(inner, yc); sh.lineTo(-inner, yc);
    bag.addGeometry(mat, new THREE.ExtrudeGeometry(sh, { depth: 2 * legA, bevelEnabled: false, curveSegments: 4 }), m);
  }
}
