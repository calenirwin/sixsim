// The Queensboro Bridge (Gustav Lindenthal, engineer; Henry Hornbostel, architect; 1909), from its published dimensions
// and the record's layout (tools/pipeline/bridges.mjs: the four piers, the anchor arms, the roadway's profile).
// Facts used (Wikipedia, "Queensboro Bridge"): five cantilever truss spans, 469.5 / 1,182 / 630 / 984 / 459 ft, on two
// lines of trusses 60 ft (18.3 m) apart whose height runs from 45 ft (13.7 m) at mid-span to 118 ft (36 m) over the
// piers; towers rising 185 ft (56 m) over the lower chords, crowned with finials; two levels: the upper 67 ft (20.4 m)
// wide with four lanes, the lower 86 ft (26.2 m) with four lanes inside the trusses and the outer roadways outside them;
// piers of Maine granite, each two masonry towers under the truss lines joined by an elliptical arch 50 ft (15.2 m) wide;
// 130 ft (40 m) of clearance. Form details (the eyebar top chords' curve, the posts' lattice, the finials, the piers'
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';

const C = { steel: 0xbcab88, steelD: 0x9a8b6d, stone: 0xa49f94, stoneD: 0x8b867b, lamp: 0xffe4b0 };
const O_T = 9.15, UP = 8.2, LOWER_HALF = 13.1, UPPER_HALF = 10.2;
const H_MID = 13.7, H_PIER = 36.0, H_POST = 56.0, PANEL = 9.1;

export function buildQueensboro(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.4), stoneD = M.ashlar(C.stoneD, 1.4, { style: 'dressed' });
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), lamp = M.glow(C.lamp, 2.2), neck = M.glow(0xfff0d0, 2.6), conc = M.concrete();
  const piers = lay.piers || lay.towers.map((t) => t.s), [anA, anB] = lay.anchorages.map((a) => a.s);
  const y = (s) => F.yAt(s), bot = (s) => y(s) - UP - 1.0;   // the lower chords under the lower level
  const sup = [anA, ...piers, anB];   // every support, the anchorages at the ends
  // the trusses' height over the lower chord: 36 m over each pier falling to 13.7 m at each span's middle, the anchor
  // arms falling to 13.7 m at their anchorages; the top chord a polygon of eyebar links (straight between panel points)
  const height = (s) => {
    let k = 0;
    while (k < sup.length - 2 && s > sup[k + 1]) k++;
    const a = sup[k], b = sup[k + 1], isPier = (v) => piers.some((p) => Math.abs(p - v) < 0.5);
    const ha = isPier(a) ? H_PIER : H_MID, hb = isPier(b) ? H_PIER : H_MID;
    const t = Math.max(0, Math.min(1, (s - a) / Math.max(1, b - a)));
    if (isPier(a) && isPier(b)) { const u = Math.abs(2 * t - 1); return H_MID + (H_PIER - H_MID) * Math.pow(u, 1.7); }
    const u = isPier(a) ? 1 - t : t;   // the anchor arm: from the pier down to the anchorage
    return H_MID + (Math.max(ha, hb) - H_MID) * Math.pow(u, 1.25);
  };
  const top = (s) => bot(s) + height(s);

  // ---- the two truss lines, panel by panel from anchorage to anchorage
  const n = Math.round((anB - anA) / PANEL), dp = (anB - anA) / n, S = (i) => anA + i * dp;
  for (const sg of [-1, 1]) {
    const o = sg * O_T;
    for (let i = 0; i < n; i++) {
      const a = S(i), b = S(i + 1);
      memberSO(bag, F, steel, a, o, bot(a) + 0.5, b, o, bot(b) + 0.5, 1.0, 1.1);              // lower chord
      memberSO(bag, F, steel, a, o, top(a) - 0.5, b, o, top(b) - 0.5, 0.9, 1.0);              // top chord (eyebar links)
      memberSO(bag, F, steel, a, o, y(a) - 0.6, b, o, y(b) - 0.6, 0.7, 0.8);                  // the upper floor's chord
      if (!bag.lod) {
        memberSO(bag, F, steelD, a, o, bot(a) + 1.0, b, o, top(b) - 1.0, 0.45, 0.55);
        memberSO(bag, F, steelD, a, o, top(a) - 1.0, b, o, bot(b) + 1.0, 0.45, 0.55);
      }
    }
    for (let i = 0; i <= n; i++) { const a = S(i); memberSO(bag, F, steel, a, o, bot(a) + 1.0, a, o, top(a) - 1.0, 0.65, 0.7); }
    if (bag.lod) for (let i = 0; i < n; i++) { const a = S(i), b = S(i + 1); bag.quad(M.webOf(steel, 0.38), F.P(a, o, bot(a) + 1.0), F.P(b, o, bot(b) + 1.0), F.P(b, o, top(b) - 1.0), F.P(a, o, top(a) - 1.0), null); }
    // the necklace along the top chords (steady lamps after dark)
    for (let i = 0; i <= n; i++) { const a = S(i), p = F.P(a, o, top(a) + 0.35); bag.rod(neck, [p[0], p[1] - 0.1, p[2]], [p[0], p[1] + 0.15, p[2]], 0.15, 6, 0.15, true); }
  }
  // the top laterals and sway frames between the trusses, clear of the upper roadway (6 m over it)
  for (const s of F.range(anA, anB, PANEL)) if (top(s) - y(s) > 7.5) memberSO(bag, F, steelD, s, -O_T, top(s) - 1.2, s, O_T, top(s) - 1.2, 0.5, 0.7);
  lateralX(bag, F, steelD, anA, anB, PANEL * 2, -O_T, O_T, (s) => Math.max(top(s) - 1.4, y(s) + 6.5), 0.28);
  // ---- floors: the upper roadway (two roadways of two lanes) between the trusses, the lower level inside and outside
  crossBeams(bag, F, steelD, anA, anB, PANEL / 2, -O_T, O_T, (s) => y(s) - 0.3, 0.35, 1.1);
  crossBeams(bag, F, steelD, anA, anB, PANEL / 2, -LOWER_HALF, LOWER_HALF, (s) => bot(s) + 1.4, 0.4, 1.3);
  lateralX(bag, F, steelD, anA, anB, PANEL * 2, -O_T, O_T, (s) => bot(s) + 0.3, 0.22);
  roadway(bag, F, asph, lw, ly, steelD, anA, anB, -UPPER_HALF + 0.6, UPPER_HALF - 0.6, y, 2, true);
  roadway(bag, F, asph, lw, ly, steelD, anA, anB, -O_T + 0.7, O_T - 0.7, (s) => y(s) - UP, 2, true);
  for (const sg of [-1, 1]) {
    const [o0, o1] = sg > 0 ? [O_T + 0.7, LOWER_HALF] : [-LOWER_HALF, -O_T - 0.7];
    slab(bag, F, sg > 0 ? asph : conc, anA, anB, o0, o1, (s) => y(s) - UP, 0.3, 6);
    railing(bag, F, steelD, anA, anB, sg * LOWER_HALF, (s) => y(s) - UP, 1.2, 2.4, 0.08);
    for (let s = anA + 18; s < anB - 10; s += 36) lampPost(bag, F, steelD, lamp, s, sg * (LOWER_HALF - 0.4), (ss) => y(ss) - UP);
  }

  // ---- towers over the piers: posts over each truss line rising to 56 m over the lower chord, laced, a portal across,
  // finials; the granite piers under them
  for (const sp of piers) {
    for (const sg of [-1, 1]) {
      const o = sg * O_T, yb = bot(sp), yt = yb + H_POST;
      for (const f of [-1, 1]) memberSO(bag, F, steel, sp + f * 2.2, o, yb, sp + f * 1.2, o, yt - 2.0, 1.2, 1.3);
      if (!bag.lod) for (let yy = yb + 4; yy < yt - 6; yy += 4.5) {
        memberSO(bag, F, steelD, sp - 2.0, o, yy, sp + 2.0, o, yy + 4.5, 0.3, 0.35);
        memberSO(bag, F, steelD, sp + 2.0, o, yy, sp - 2.0, o, yy + 4.5, 0.3, 0.35);
      }
      // the finials: a pair of spires on each post's cap
      block(bag, F, steelD, sp - 2.0, sp + 2.0, o - 1.0, o + 1.0, yt - 2.0, yt - 0.5);
      for (const f of [-1, 1]) {
        const p = F.P(sp + f * 1.2, o, yt - 0.5);
        bag.rod(steelD, p, [p[0], p[1] + 2.8, p[2]], 0.45, 8, 0.3, true);
        bag.rod(steelD, [p[0], p[1] + 2.8, p[2]], [p[0], p[1] + 7.0, p[2]], 0.28, 8, 0.02, false);
        bag.rod(steelD, [p[0], p[1] + 3.4, p[2]], [p[0], p[1] + 3.9, p[2]], 0.6, 8, 0.6, true);
      }
    }
    // the portal over the upper roadway between the posts, and its arched brace
    const yb = bot(sp);
    for (const yy of [yb + H_POST - 4.0, yb + H_POST - 12.0]) memberSO(bag, F, steel, sp, -O_T, yy, sp, O_T, yy, 1.0, 1.2);
    for (let k = 0; k < 8; k++) {
      const a0 = Math.PI - (Math.PI * k) / 8, a1 = Math.PI - (Math.PI * (k + 1)) / 8, ys = yb + H_POST - 18.0;
      memberSO(bag, F, steelD, sp, O_T * Math.cos(a0), ys + 5.5 * Math.sin(a0), sp, O_T * Math.cos(a1), ys + 5.5 * Math.sin(a1), 0.5, 0.6);
    }
    pier(bag, F, sp, stone, stoneD, bot(sp));
  }
  // ---- anchorages (masonry piers like the towers' under the trusses' ends) and the approaches on masonry arches
  for (const sAn of [anA, anB]) pier(bag, F, sAn, stone, stoneD, bot(sAn) + 0.5, true);
  for (const [a, b] of [[0, Math.max(0, anA - 1)], [Math.min(F.L, anB + 1), F.L]]) approach(bag, F, a, b, rec, stone, stoneD, asph, lw, ly, steelD);
}

function roadway(bag, F, asph, lw, ly, steelD, a, b, o0, o1, ytop, lanesEach, rails) {
  slab(bag, F, asph, a, b, o0, o1, ytop, 0.3, 6);
  const c = (o0 + o1) / 2, lw0 = (o1 - o0) / (2 * lanesEach);
  const lines = [{ o: c - 0.12, w: 0.11, yellow: true }, { o: c + 0.12, w: 0.11, yellow: true }, { o: o0 + 0.3, w: 0.12 }, { o: o1 - 0.3, w: 0.12 }];
  for (let k = 1; k < lanesEach; k++) lines.push({ o: o0 + k * lw0, w: 0.11, dash: [3.05, 9.15] }, { o: o1 - k * lw0, w: 0.11, dash: [3.05, 9.15] });
  laneLines(bag, F, lw, ly, a, b, ytop, lines);
  if (rails) for (const o of [o0, o1]) railing(bag, F, steelD, a, b, o, ytop, 1.05, 2.4, 0.08);
}
function lampPost(bag, F, post, lamp, s, o, ybase) {
  if (bag.lod) return;
  const y0 = ybase(s);
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 5.0), 0.08, 6, 0.06, true);
  bag.rod(lamp, F.P(s, o, y0 + 5.0), F.P(s, o, y0 + 5.3), 0.22, 8, 0.22, true);
}

// a granite pier: two masonry towers under the truss lines joined by an elliptical arch (50 ft) and a deep lintel course
// up to the lower chords, turrets at its four corners; `anchor`: the shorter anchorage pier
function pier(bag, F, s, stone, stoneD, yTop, anchor = false) {
  const g = F.groundAt(s), y0 = g === null ? -3 : g - 0.5;
  const along = anchor ? 9 : 12.5, legW = 9.0, span = 15.24;
  const legO = span / 2 + legW / 2;
  if (g === null) taper(bag, F, stoneD, s, 0, -3, 1.5, along / 2 + 1.5, legO + legW / 2 + 1.5, along / 2 + 1.2, legO + legW / 2 + 1.2);
  const yArch = yTop - 12;   // the arch's crown
  for (const sg of [-1, 1]) {
    taper(bag, F, stone, s, sg * legO, y0, yTop - 0.4, along / 2 + 0.6, legW / 2 + 0.6, along / 2, legW / 2);
    // turret: a slim octagon-ish block standing proud at the outer corners, capped
    for (const f of [-1, 1]) {
      block(bag, F, stoneD, s + f * (along / 2 - 0.2) - 1.0, s + f * (along / 2 - 0.2) + 1.0, sg * (legO + legW / 2) - 1.0, sg * (legO + legW / 2) + 1.0, y0, yTop + 2.5);
      const p = F.P(s + f * (along / 2 - 0.2), sg * (legO + legW / 2), yTop + 2.5);
      bag.rod(stoneD, p, [p[0], p[1] + 2.6, p[2]], 1.1, 8, 0.15, true);
    }
  }
  // the arch: an elliptical ring of voussoir blocks between the legs, the spandrels and lintel above it
  const R = span / 2, rise = 5.5, N = 12;
  for (let k = 0; k < N; k++) {
    const a0 = Math.PI - (Math.PI * k) / N, a1 = Math.PI - (Math.PI * (k + 1)) / N;
    const o0 = R * Math.cos(a0), o1 = R * Math.cos(a1), yA = yArch - rise + rise * Math.sin(a0), yB = yArch - rise + rise * Math.sin(a1);
    const lo = Math.min(yA, yB);
    block(bag, F, stone, s - along / 2, s + along / 2, Math.min(o0, o1), Math.max(o0, o1), lo, yTop - 0.4);
  }
  block(bag, F, stoneD, s - along / 2 - 0.5, s + along / 2 + 0.5, -legO - legW / 2 - 0.5, legO + legW / 2 + 0.5, yTop - 1.6, yTop - 0.4);
}

// the approaches: the roadway on masonry arches (Manhattan's Bridgemarket vaults, the Queens viaduct), piers clear of the
// streets under the deck; low ends on fill between walls
function approach(bag, F, a, b, rec, stone, stoneD, asph, lw, ly, steelD) {
  if (b - a < 4) return;
  const y = (s) => F.yAt(s), g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  roadway(bag, F, asph, lw, ly, steelD, a, b, -UPPER_HALF + 0.6, UPPER_HALF - 0.6, y, 2, true);
  const half = UPPER_HALF + 0.2;
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 1.5 && s < u[1] + 1.5);
  for (const sg of [-1, 1]) slab(bag, F, stoneD, a, b, sg > 0 ? half - 1.0 : -half, sg > 0 ? half : -half + 1.0, (s) => y(s) + 0.9, 2.1, 6);
  for (let s = a + 4; s < b - 4; s += 16) {
    const h = y(s) - 0.5 - g(s);
    if (h < 3) continue;
    if (!free(s)) {   // a street under: a steel span over it, carried by the piers either side
      for (const o of [-half + 2, 0, half - 2]) bag.beam(steelD, F.P(s - 8, o, y(s - 8) - 1.4), F.P(s + 8, o, y(s + 8) - 1.4), 0.7, 2.4);
      continue;
    }
    block(bag, F, stone, s - 1.6, s + 1.6, -half, half, g(s) - 0.5, y(s) - 0.5);
    // the vault from this pier to the next: a segmental arch of blocks over the gap
    const s2 = s + 16;
    if (s2 < b - 4 && free(s2) && y(s2) - g(s2) > 3) {
      const crown = Math.min(y(s) - 2.0, g(s) + h * 0.75);
      for (let k = 0; k < 6; k++) {
        const f = (k + 0.5) / 6, ss = s + 1.6 + (16 - 3.2) * f, rise = Math.sin(Math.PI * f);
        const yy = g(ss) + (crown - g(ss)) * (0.6 + 0.4 * rise);
        block(bag, F, stone, s + 1.6 + (16 - 3.2) * (k / 6), s + 1.6 + (16 - 3.2) * ((k + 1) / 6), -half, half, yy, y(ss) - 0.5);
      }
    }
  }
}
