// The Williamsburg Bridge (Leffert L. Buck, 1903), from its published dimensions and the record's layout
// (tools/pipeline/bridges.mjs: both towers' piers from the NOAA ENC, the roadway's profile).
// Facts used (Wikipedia, "Williamsburg Bridge"; STRUCTURE magazine, "Williamsburg Bridge"): main span 1,600 ft (487.7 m),
// suspended from four cables of 18.5 in (0.47 m) over two towers 335 ft (102 m) high; the side spans (596 ft) are
// trusses on intermediate towers and draw nothing from the cables, which run straight to the anchorages. Deck 118 ft
// (36 m) wide: the two subway tracks in the middle, the inner roadways beside them (the old trolley tracks), the outer
// roadways (20 ft each) outside the stiffening trusses, which are 40 ft (12.2 m) deep and 67 ft (20.4 m) apart on floor
// beams 5 ft deep; the walk and bike paths on an upper level. Each tower is two steel legs of braced columns, 40 ft along
// the bridge at the roadway and 20 ft at the top, battered across; the tracks pass between the legs and each side's
// roadways between a leg's columns. A pair of cables 22 ft apart over each leg converges to 4 ft at mid-span (34 ft
// apart at the anchorages). Anchorages of granite about 150 x 180 ft and 75 ft high. Form details from photographs,
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';

const C = { steel: 0x8c969e, steelD: 0x6f7880, stone: 0xa09a8e, stoneD: 0x878176, lamp: 0xffe2b0, conc: 0xa29e95 };
const O_T = 10.2, DEPTH = 12.2, PANEL = 6.1;     // the stiffening trusses' plane, depth and panel
const TRACK = 3.4, ROAD_IN = [3.7, 9.6], ROAD_OUT = [10.8, 16.9], EDGE = 17.6;
const PATH_UP = 5.6, PATH = [3.55, 9.75];          // the walk and bike paths over the inner roadways
const PED = 12.0, TOP = 101.0, SADDLE = 100.0;   // the legs' pedestals, top, the cables' saddles
const LEG_O = [3.5, 17.0], LEG_TOP_O = [7.0, 13.4];   // a leg's columns across at the roadway and at the top
const LEG_S = [6.1, 3.05];                            // a leg's half length along the bridge at the roadway / top

export function buildWilliamsburg(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.5), stoneD = M.ashlar(C.stoneD, 1.5, { style: 'dressed' });
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), lamp = M.glow(C.lamp, 2.0), conc = M.concrete(C.conc);
  const cab = M.cable(C.steel, { px: 0.0003 }), hang = M.cable(C.steelD, { px: 0.00008 });
  const [sA, sB] = lay.main, [anA, anB] = lay.anchorages.map((a) => a.s), towersS = [sA, sB];
  const y = (s) => F.yAt(s);
  const s0 = Math.max(0, anA), s1 = Math.min(F.L, anB);

  const lit = M.paint(C.steel, { flood: { y0: 10, y1: 103, k: 1.3 } }), litD = M.paint(C.steelD, { flood: { y0: 10, y1: 103, k: 1.3 } });
  for (const sT of towersS) tower(bag, F, sT, lit, litD, stone, stoneD);

  // ---- stiffening trusses from anchorage to anchorage (continuous through the legs), floors, roadways, tracks, paths
  const top = (s) => y(s) + DEPTH - 1.4, bot = (s) => y(s) - 1.4;
  for (const sg of [-1, 1]) truss(bag, F, steel, s0, s1, sg * O_T, top, bot, PANEL, 'X', { chord: [0.75, 0.9], vert: [0.5, 0.55], diag: [0.32, 0.4] });
  // top laterals and sway frames between the trusses (over the tracks and the inner roadways, clear of traffic)
  lateralX(bag, F, steelD, s0, s1, PANEL * 2, -O_T, O_T, (s) => top(s) - 0.4, 0.22);
  crossBeams(bag, F, steelD, s0, s1, PANEL * 2, -O_T, O_T, (s) => top(s) - 0.2, 0.35, 0.6);
  crossBeams(bag, F, steelD, s0, s1, PANEL, -EDGE + 0.2, EDGE - 0.2, (s) => y(s) - 0.3, 0.4, 1.5);
  lateralX(bag, F, steelD, s0, s1, PANEL * 2, -O_T, O_T, (s) => y(s) - 1.6, 0.16);
  for (const sg of [-1, 1]) {
    const [i0, i1] = sg > 0 ? ROAD_IN : [-ROAD_IN[1], -ROAD_IN[0]], [u0, u1] = sg > 0 ? ROAD_OUT : [-ROAD_OUT[1], -ROAD_OUT[0]];
    slab(bag, F, asph, s0, s1, i0, i1, y, 0.3, 6);
    slab(bag, F, asph, s0, s1, u0, u1, y, 0.3, 6);
    for (const [o0, o1] of [[i0, i1], [u0, u1]]) laneLines(bag, F, lw, ly, s0, s1, y, [{ o: (o0 + o1) / 2, w: 0.11, dash: [3.05, 9.15] }, { o: o0 + 0.25, w: 0.12 }, { o: o1 - 0.25, w: 0.12 }]);
    railing(bag, F, steelD, s0, s1, sg * EDGE, y, 1.1, 2.4, 0.08);
    // the path on its upper level, on posts from the floor
    const [p0, p1] = sg > 0 ? PATH : [-PATH[1], -PATH[0]], py = (s) => y(s) + PATH_UP;
    slab(bag, F, conc, s0, s1, p0, p1, py, 0.25, 6);
    for (const o of [p0, p1]) railing(bag, F, steelD, s0, s1, o, py, 2.4, 2.4, 0.06);   // the tall fences
    // posts at the path's edges only: beside the track bed and against the truss, clear of the inner roadway's lanes
    for (const s of F.range(s0, s1, PANEL)) for (const o of [sg * (TRACK + 0.2), sg * (O_T - 0.55)]) memberSO(bag, F, steelD, s, o, y(s) + 0.05, s, o, py(s) - 0.25, 0.25, 0.25);
    for (let s = s0 + 15; s < s1 - 10; s += 30) lampHead(bag, F, steelD, lamp, s, sg * (ROAD_OUT[1] + 0.3), y);
  }
  slab(bag, F, conc, s0, s1, -TRACK, TRACK, (s) => y(s) - 0.2, 0.4, 8);
  for (const t of [-1.68, 1.68]) for (const r of [-0.72, 0.72]) for (const [a, b] of pairs(F.range(s0, s1, 12))) bag.beam(steelD, F.P(a, t + r, y(a) + 0.05), F.P(b, t + r, y(b) + 0.05), 0.08, 0.15);

  // ---- cables: two pairs, each pair 34 ft apart at the anchorage, 22 ft at the tower, 4 ft at mid-span, centred on the
  // truss plane; suspended over the main span only (straight with their own small sag over the side spans)
  const sup = [[anA, y(anA) + 1.5], [sA, SADDLE], [sB, SADDLE], [anB, y(anB) + 1.5]];
  const mid = lay.mid, midY = top(mid) + 1.3;
  const fMain = SADDLE - midY;
  const cyMain = (s) => { const t = (s - sA) / (sB - sA); return SADDLE - 4 * fMain * t * (1 - t); };
  const cy = (s) => (s < sA ? sup[0][1] + ((SADDLE - sup[0][1]) * (s - anA)) / (sA - anA) - 4 * 1.4 * ((s - anA) / (sA - anA)) * (1 - (s - anA) / (sA - anA))
    : s > sB ? SADDLE + ((sup[3][1] - SADDLE) * (s - sB)) / (anB - sB) - 4 * 1.4 * ((s - sB) / (anB - sB)) * (1 - (s - sB) / (anB - sB)) : cyMain(s));
  const half = (s) => {   // the pair's half spacing along the bridge
    if (s < sA) return 5.18 + (3.35 - 5.18) * ((s - anA) / (sA - anA));
    if (s > sB) return 3.35 + (5.18 - 3.35) * ((s - sB) / (anB - sB));
    const u = Math.abs((s - mid) / (sB - mid));
    return 0.61 + (3.35 - 0.61) * u;
  };
  for (const sg of [-1, 1]) for (const k of [-1, 1]) {
    const oc = (s) => sg * (O_T + k * half(s));
    const pts = F.range(anA, anB, 3).map((s) => F.P(s, oc(s), cy(s)));
    bag.tube(cab, pts, 0.235, 10);
    // suspenders over the main span, inclined from the cable to the truss's top chord
    for (const s of F.range(sA + 8, sB - 8, PANEL)) {
      const c = F.P(s, oc(s), cy(s)), b = F.P(s, sg * O_T, top(s));
      if (cy(s) - top(s) > 0.8) bag.rod(hang, b, [c[0], c[1] - 0.3, c[2]], 0.04, 4);
    }
    for (let s = anA + 7.5; s < anB; s += 15) { const p = F.P(s, oc(s), cy(s) + 0.38); bag.rod(lamp, [p[0], p[1] - 0.1, p[2]], [p[0], p[1] + 0.12, p[2]], 0.13, 6, 0.13, true); }
  }

  // ---- side span bents (two between each tower and anchorage), anchorages, approaches
  for (const [ta, tb] of [[anA, sA], [sB, anB]]) for (const f of [1 / 3, 2 / 3]) bent(bag, F, ta + (tb - ta) * f, steel, steelD, stone);
  for (const [sAn, away] of [[anA, -1], [anB, 1]]) anchorage(bag, F, sAn, away, stone, stoneD);
  for (const [a, b] of [[0, Math.max(0, anA - 45.7)], [Math.min(F.L, anB + 45.7), F.L]]) approach(bag, F, a, b, rec, steel, steelD, asph, lw);
  for (const [a, b] of [[Math.max(0, anA - 45.7), anA], [anB, Math.min(F.L, anB + 45.7)]]) {
    for (const sg of [-1, 1]) {
      slab(bag, F, asph, a, b, sg > 0 ? 0.3 : -EDGE + 0.6, sg > 0 ? EDGE - 0.6 : -0.3, y, 0.4, 6);
      railing(bag, F, steelD, a, b, sg * (EDGE - 0.5), y, 1.1, 2.4, 0.08);
    }
  }

}
function pairs(ss) { const out = []; for (let i = 0; i + 1 < ss.length; i++) out.push([ss[i], ss[i + 1]]); return out; }
function lampHead(bag, F, post, lamp, s, o, ybase) {
  if (bag.lod) return;
  const y0 = ybase(s);
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 6.0), 0.08, 6, 0.06, true);
  bag.rod(lamp, F.P(s, o - Math.sign(o) * 0.6, y0 + 6.0), F.P(s, o - Math.sign(o) * 0.6, y0 + 6.25), 0.22, 8, 0.22, true);
}

// a tower: on a granite pier, two legs, each four columns (two across, either side of a side's roadways, two along)
// battered across above the roadway and tapering along, laced in every face; a lattice girder across the top, an arched
// portal under the deck between the legs, the saddles
function tower(bag, F, sT, steel, steelD, stone, stoneD) {
  const yDeck = F.yAt(sT), yR = yDeck + 6.0;   // over the roadway the legs batter in
  taper(bag, F, stoneD, sT, 0, -3, 2.0, 11.2, 23.0, 11.0, 22.8);   // (the ENC pier: 44-47 m across, 20-22 m along)
  taper(bag, F, stone, sT, 0, 2.0, PED, 10.6, 22.2, 10.0, 21.6);
  const colAt = (yy, sg, i, j) => {   // column i (0 inner, 1 outer) of leg sg, j along (-1 / 1), at height yy
    const f = yy <= yR ? 0 : (yy - yR) / (TOP - yR);
    const o = LEG_O[i] + (LEG_TOP_O[i] - LEG_O[i]) * f;
    const sh = LEG_S[0] + (LEG_S[1] - LEG_S[0]) * Math.max(0, (yy - PED) / (TOP - PED));
    return [sT + j * sh, sg * o, yy];
  };
  const levels = [];
  for (let yy = PED; yy < TOP - 0.1; yy += 7.2) levels.push(yy);
  levels.push(TOP);
  for (const sg of [-1, 1]) {
    // columns (built-up boxes) as members between levels
    for (const i of [0, 1]) for (const j of [-1, 1]) for (let k = 0; k + 1 < levels.length; k++) {
      const a = colAt(levels[k], sg, i, j), b = colAt(levels[k + 1], sg, i, j);
      memberSO(bag, F, steel, a[0], a[1], a[2], b[0], b[1], b[2], 1.15, 1.15);
    }
    // lacing: X in the two faces along the bridge (each column pair across); X in the faces across (but not through the
    // roadway clearance between the deck and 5.5 m over it)
    for (let k = 0; k + 1 < levels.length; k++) {
      const y0 = levels[k], y1 = levels[k + 1];
      const clear = y1 > yDeck - 1.6 && y0 < yDeck + 5.8;
      for (const j of [-1, 1]) {
        if (!clear) {
          const a0 = colAt(y0, sg, 0, j), a1 = colAt(y1, sg, 0, j), b0 = colAt(y0, sg, 1, j), b1 = colAt(y1, sg, 1, j);
          memberSO(bag, F, steelD, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], 0.35, 0.4);
          memberSO(bag, F, steelD, b0[0], b0[1], b0[2], a1[0], a1[1], a1[2], 0.35, 0.4);
          memberSO(bag, F, steelD, a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], 0.45, 0.5);
        }
      }
      for (const i of [0, 1]) {
        const a0 = colAt(y0, sg, i, -1), a1 = colAt(y1, sg, i, -1), b0 = colAt(y0, sg, i, 1), b1 = colAt(y1, sg, i, 1);
        memberSO(bag, F, steelD, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], 0.35, 0.4);
        memberSO(bag, F, steelD, b0[0], b0[1], b0[2], a1[0], a1[1], a1[2], 0.35, 0.4);
        memberSO(bag, F, steelD, a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], 0.45, 0.5);
      }
    }
    // the cap and the saddles of the leg's cable pair
    const c = colAt(TOP, sg, 0, 0), d = colAt(TOP, sg, 1, 0);
    block(bag, F, steelD, sT - LEG_S[1] - 0.6, sT + LEG_S[1] + 0.6, Math.min(c[1], d[1]) - 0.8, Math.max(c[1], d[1]) + 0.8, TOP - 0.2, TOP + 1.2);
    for (const k of [-1, 1]) block(bag, F, steelD, sT - 2.9, sT + 2.9, sg * (O_T + k * 3.35) - 0.9, sg * (O_T + k * 3.35) + 0.9, TOP + 1.2, SADDLE + 0.9);
  }
  // the top girder across both legs (a lattice: two chords and a zigzag), and the arched portal under the deck
  for (const j of [-1, 1]) {
    const s = sT + j * (LEG_S[1] - 0.5);
    memberSO(bag, F, steel, s, -LEG_TOP_O[0], TOP - 1.0, s, LEG_TOP_O[0], TOP - 1.0, 0.9, 1.2);
    memberSO(bag, F, steel, s, -LEG_TOP_O[0], TOP - 6.5, s, LEG_TOP_O[0], TOP - 6.5, 0.7, 0.9);
    for (let k = 0; k < 6; k++) {
      const o0 = -LEG_TOP_O[0] + (2 * LEG_TOP_O[0] * k) / 6, o1 = -LEG_TOP_O[0] + (2 * LEG_TOP_O[0] * (k + 1)) / 6;
      memberSO(bag, F, steelD, s, o0, k % 2 ? TOP - 1.0 : TOP - 6.5, s, o1, k % 2 ? TOP - 6.5 : TOP - 1.0, 0.35, 0.4);
    }
    const yS = yDeck - 14, R = LEG_O[0] + 0.6, pts = [];
    for (let k = 0; k <= 12; k++) { const a = Math.PI - (Math.PI * k) / 12; pts.push([R * Math.cos(a), yS + R * 1.1 * Math.sin(a)]); }
    for (let k = 0; k + 1 < pts.length; k++) memberSO(bag, F, steel, s, pts[k][0], pts[k][1], s, pts[k + 1][0], pts[k + 1][1], 0.7, 0.9);
    for (let k = 1; k < 12; k++) memberSO(bag, F, steelD, s, pts[k][0], pts[k][1], s, pts[k][0], yDeck - 1.8, 0.25, 0.3);
    memberSO(bag, F, steel, s, -LEG_O[1], yDeck - 1.8, s, LEG_O[1], yDeck - 1.8, 0.8, 1.0);
  }
}

// an intermediate tower of a side span: a lattice bent of four columns under the trusses' planes and the deck's edges
function bent(bag, F, s, steel, steelD, stone) {
  const yD = F.yAt(s) - 1.6, g = F.groundAt(s);
  const yb = g === null ? 2.0 : g;
  if (g === null) taper(bag, F, stone, s, 0, -3, 2.5, 4.5, 19.5, 4.2, 19.2);
  for (const o of [-16.5, -O_T, O_T, 16.5]) taper(bag, F, steel, s, o, yb + (g === null ? 0.5 : 0), yD, 2.2, 0.8, 1.6, 0.7);
  for (let yy = yb + 4; yy < yD - 3; yy += 7) for (const [o0, o1] of [[-16.5, -O_T], [O_T, 16.5], [-O_T, O_T]]) {
    memberSO(bag, F, steelD, s, o0, yy, s, o1, Math.min(yD - 1, yy + 7), 0.3, 0.35);
    memberSO(bag, F, steelD, s, o1, yy, s, o0, Math.min(yD - 1, yy + 7), 0.3, 0.35);
  }
  memberSO(bag, F, steel, s, -17.2, yD - 0.6, s, 17.2, yD - 0.6, 1.0, 1.2);
}

// an anchorage: a granite block 45.7 m along the bridge, 54.9 m across, 22.9 m high, the deck on its top
function anchorage(bag, F, sAn, away, stone, stoneD) {
  const L = 45.7, B = 27.4, sc = sAn + (away * L) / 2, yTop = F.yAt(sc) - 2.0;
  const g = Math.max(0, F.groundAt(sc) ?? 3.2);
  taper(bag, F, stone, sc, 0, g - 1, yTop - 2, L / 2, B, L / 2 - 1.5, B - 1.5);
  block(bag, F, stoneD, sc - L / 2 + 0.8, sc + L / 2 - 0.8, -B + 0.8, B - 0.8, yTop - 2, yTop);
  for (const sg of [-1, 1]) for (let k = -2; k <= 2; k++) block(bag, F, stone, sc + k * (L / 5) - 1.5, sc + k * (L / 5) + 1.5, sg * (B + 0.3) - 0.5, sg * (B + 0.3) + 0.5, g - 1, yTop - 2);
}

// a steel approach: girders on four-column bents every ~25 m clear of the streets under it
function approach(bag, F, a, b, rec, steel, steelD, asph, lw) {
  if (b - a < 4) return;
  const y = (s) => F.yAt(s), g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (const sg of [-1, 1]) {
    slab(bag, F, asph, a, b, sg > 0 ? 0.3 : -EDGE + 0.6, sg > 0 ? EDGE - 0.6 : -0.3, y, 0.35, 5);
    railing(bag, F, steelD, a, b, sg * (EDGE - 0.5), y, 1.1, 2.4, 0.08);
    laneLines(bag, F, lw, lw, a, b, y, [{ o: sg * (EDGE - 0.9), w: 0.12 }, { o: sg * 0.5, w: 0.12 }]);
    for (const o of [sg * 4.5, sg * 10.2, sg * 16.0]) for (const [p, q] of pairs(F.range(a, b, 8))) bag.beam(steel, F.P(p, o, y(p) - 1.3), F.P(q, o, y(q) - 1.3), 0.5, 1.9);
  }
  for (let s = a + 12; s < b; s += 25) {
    let ss = s;
    for (let k = 0; k < 6 && !free(ss); k++) ss += k % 2 ? -k * 4 : k * 4;
    if (!free(ss) || ss < a + 2 || ss > b - 2) continue;
    const h = y(ss) - g(ss);
    if (h < 3.5) continue;
    for (const o of [-16.0, -5.0, 5.0, 16.0]) taper(bag, F, steel, ss, o, g(ss), y(ss) - 2.2, 0.75, 0.6, 0.6, 0.5);
    memberSO(bag, F, steelD, ss, -16.8, y(ss) - 2.7, ss, 16.8, y(ss) - 2.7, 0.8, 1.0);
  }
}
