// The Brooklyn Bridge (John A. and Washington Roebling, 1883), from its published dimensions and the record's layout
// (tools/pipeline/bridges.mjs: tower stations from the NOAA ENC pier, the roadway's profile).
// Facts used (Wikipedia, "Brooklyn Bridge", and the HAER record NY-18): main span 1,595.5 ft (486.3 m), side spans 930 ft
// (283.5 m); deck 85 ft (25.9 m) wide: two roadways of three lanes outside, the elevated promenade (10-17 ft wide, 18 ft
// over the roadways) in the middle; four main cables 15.75 in (0.40 m) thick over the towers, ~1,520 suspenders and 400
// diagonal stays (138-449 ft long) radiating from the tower tops; four stiffening trusses (the outer pair at the deck's
// edges, the inner pair under the promenade's edges). Towers of granite and limestone ashlar, 278 ft (84.8 m) over mean
// high water, 140 x 59 ft (42.7 x 18 m) at the waterline, each pierced by two pointed arches 117 ft (35.7 m) high and
// 33.75 ft (10.29 m) wide whose floor, the roadway, is 119.25 ft (36.35 m) over the water; the top 159 ft over the arch
// floor. Anchorages 129 x 119 ft (39.3 x 36.3 m) at the base, 117 x 104 ft at the top. Steel in "Brooklyn Bridge tan".
// Form details (the arch orders, pilasters, cornice, saddle housings, the promenade's lattice rail and lamps) from
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, latticeRail, cableY, cablePts, suspenders, block, taper } from './parts.js';

const C = {
  steel: 0xc6b694,    // Brooklyn Bridge tan
  steelD: 0xa39373,
  stone: 0xb3a996,    // the towers' granite and limestone, weathered
  stoneD: 0x9b917f,
  wood: 0x7b6650,
  lamp: 0xffd9a0,
};
const W = 25.9, O_OUT = 12.45, O_IN = 3.05;          // deck width; the outer and inner truss and cable planes
const ROAD = [3.45, 12.05];                           // a roadway's inner and outer edge (|o|)
const PROM = 2.55, PROM_UP = 5.5;                     // the promenade's half width and its height over the roadway
const PANEL = 4.572;                                  // the trusses' panel, 15 ft (the stays' spacing on the deck)
const T_TOP = 84.8, T_W = 41.6, T_T = 16.4, BASE_W = 42.7, BASE_T = 18.0;
const ARCH_W = 10.29, ARCH_APEX = 72.0, PIER_HALF = 2.6;   // the openings |o| 2.6 .. 12.89
const CABLE_TOP = 85.3;                               // the cables' centre over the saddles, at the towers' top edge

export function buildBrooklyn(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  // (the granite: rock-faced, the mouldings dressed; soot under the plinth, the arch floor, the string course, the cornice
  // and the anchorages' cornices)
  const ST = { ledges: [2.4, 25.7, 35.2, 60.6, 82.8] };
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.6, ST), stoneD = M.ashlar(C.stoneD, 1.6, { ...ST, style: 'dressed' });
  const asph = M.asphalt(), wood = M.planks(C.wood), lw = M.lineWhite(), ly = M.lineYellow(), lamp = M.glow(C.lamp, 2.2);
  const cab = M.cable(C.steel, { px: 0.0003 }), hang = M.cable(C.steelD, { px: 0.00008 }), neck = M.glow(0xfff1d6, 2.8);
  const [sA, sB] = lay.main, [anA, anB] = lay.anchorages.map((a) => a.s);
  const y = (s) => F.yAt(s);
  const towersS = [sA, sB];
  const inTower = (s, pad = 0) => towersS.some((t) => Math.abs(s - t) < T_T / 2 + pad);
  // stations where the deck is carried (anchorage to anchorage: the suspended spans), and the approaches beyond
  const s0 = Math.max(0, anA), s1 = Math.min(F.L, anB);

  // ---- towers
  // (the towers floodlit after dark, warm white from their bases)
  const lit = M.ashlarLit(C.stone, 1.6, { y0: 0, y1: T_TOP + 2, k: 0.62, ...ST }), litD = M.ashlarLit(C.stoneD, 1.6, { y0: 0, y1: T_TOP + 2, k: 0.62, ...ST, style: 'dressed' });
  for (const sT of towersS) tower(bag, F, sT, lit, litD, steelD);

  // ---- the deck between the anchorages: trusses, floor, roadways, promenade
  const top = { out: (s) => y(s) + 4.4, inn: (s) => y(s) + PROM_UP - 0.15 }, bot = (s) => y(s) - 1.15;
  // (the trusses run on through the arches: both pairs lie inside the openings)
  for (const [a, b] of [[s0, s1]]) {
    for (const sg of [-1, 1]) {
      truss(bag, F, steel, a, b, sg * O_OUT, top.out, bot, PANEL, 'X', { chord: [0.45, 0.6], vert: [0.32, 0.32], diag: [0.16, 0.24] });
      truss(bag, F, steel, a, b, sg * O_IN, top.inn, bot, PANEL, 'X', { chord: [0.45, 0.6], vert: [0.32, 0.32], diag: [0.16, 0.24] });
    }
  }
  // floor beams and the bottom laterals (not through the towers' central piers), the roadway slabs and their lines
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 0.6)) {
    crossBeams(bag, F, steelD, a, b, PANEL, -O_OUT - 0.2, O_OUT + 0.2, (s) => y(s) - 0.28, 0.35, 0.95);
    lateralX(bag, F, steelD, a, b, PANEL * 2, -O_OUT, O_OUT, (s) => y(s) - 1.1, 0.14);
  }
  for (const sg of [-1, 1]) {
    const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
    slab(bag, F, asph, s0, s1, o0, o1, y, 0.28, 6);
    const lanes = (ROAD[1] - ROAD[0]) / 3;
    laneLines(bag, F, lw, ly, s0, s1, y, [
      { o: sg * (ROAD[0] + 0.25), w: 0.12, yellow: true }, { o: sg * (ROAD[1] - 0.25), w: 0.12 },
      { o: sg * (ROAD[0] + lanes), w: 0.11, dash: [3.05, 9.15] }, { o: sg * (ROAD[0] + 2 * lanes), w: 0.11, dash: [3.05, 9.15] },
    ]);
    // the roadway's outer barrier and the inner kerb wall under the promenade trusses
    railing(bag, F, steelD, s0, s1, sg * (ROAD[1] + 0.1), y, 1.05, 2.29, 0.08);
  }
  // the promenade: planks on the inner trusses, its rails, lamps; round each tower's central pier through the arches
  const promY = (s) => y(s) + PROM_UP;
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 0.05)) {
    slab(bag, F, wood, a, b, -PROM, PROM, promY, 0.18, 4);
    crossBeams(bag, F, steel, a, b, PANEL, -O_IN, O_IN, (s) => promY(s) - 0.18, 0.25, 0.45);
    for (let s = a + 13.7; s < b - 6; s += 27.4) {
      const sg = Math.round(s / 27.4) % 2 ? 1 : -1;
      lampPost(bag, F, steelD, lamp, s, sg * (PROM - 0.25), promY(s));
    }
  }
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 9)) for (const sg of [-1, 1]) latticeRail(bag, F, steel, a, b, sg * PROM, promY, 1.25, 2.29, 0.9, sg);
  for (const sT of towersS) for (const sg of [-1, 1]) {
    // the walk splits round the pier: a platform each side, in the arch over the inner lane
    const a = sT - T_T / 2 - 9, b = sT + T_T / 2 + 9, o0 = sg > 0 ? PIER_HALF + 0.05 : -4.6, o1 = sg > 0 ? 4.6 : -PIER_HALF - 0.05;
    slab(bag, F, wood, a, b, o0, o1, promY, 0.18, 3);
    latticeRail(bag, F, steel, a, b, sg * 4.6, promY, 1.25, 2.29, 0.9, sg);
  }

  // ---- cables, suspenders, stays
  const saddle = (s) => towersS.some((t) => Math.abs(s - t) < 1e-3);
  const midY = { [O_IN]: y(lay.mid) + PROM_UP + 1.35, [O_OUT]: y(lay.mid) + 4.4 + 0.75 };
  for (const oo of [O_IN, O_OUT]) {
    // the cables enter the anchorages' river faces between the trusses' chords, a metre over the roadway
    const sup = [[anA, y(anA) + 1.0], [sA, CABLE_TOP], [sB, CABLE_TOP], [anB, y(anB) + 1.0]];
    const fMain = CABLE_TOP - midY[oo];
    const fSide = fMain * (283.5 / 486.3) ** 2;
    const cy = cableY(sup, [fSide, fMain, fSide]);
    for (const sg of [-1, 1]) {
      const o = sg * oo;
      bag.tube(cab, cablePts(F, cy, o, anA, anB, 2.5), 0.2, 10);
      // suspenders every 7.5 ft from the cable to the truss's top chord (none in the towers)
      const yb = oo === O_IN ? top.inn : top.out;
      for (const [a, b] of splitAround(anA + 4, anB - 4, towersS, T_T / 2 + 2)) suspenders(bag, F, hang, cy, yb, o, a, b, 2.286, 0.035, steel, 0.11);
      // the necklace: a lamp every 12 m along the outer cables (steady, lit after dark)
      if (oo === O_OUT) for (let s = anA + 6; s < anB; s += 12) {
        if (towersS.some((t) => Math.abs(s - t) < T_T / 2 + 1)) continue;
        const p = F.P(s, o, cy(s) + 0.32);
        bag.rod(neck, [p[0], p[1] - 0.08, p[2]], [p[0], p[1] + 0.16, p[2]], 0.13, 6, 0.13, true);
      }
      // the diagonal stays: 25 a fan, from the tower top to the deck every 15 ft from 18 m out
      for (const sT of towersS) for (const dir of [-1, 1]) for (let k = 4; k < 29; k++) {
        const sd = sT + dir * k * PANEL;
        if ((dir < 0 && sd < anA + 6) || (dir > 0 && sd > anB - 6)) continue;
        const yTop = CABLE_TOP - 1.2 - (k - 4) * 0.12;
        bag.rod(hang, F.P(sT + dir * (T_T / 2 - 1.5), o, yTop), F.P(sd, o, yb(sd)), 0.045, 4);
      }
    }
  }
  void saddle;

  // ---- anchorages (the cables enter their river faces at the deck) and the masonry approaches
  for (const [sAn, away] of [[anA, -1], [anB, 1]]) anchorage(bag, F, sAn, away, stone, stoneD);
  approach(bag, F, Math.max(0, anA - 39.3 - 0.1), 0, -1, stone, stoneD, asph, steelD, lw);
  approach(bag, F, Math.min(F.L, anB + 39.3 + 0.1), F.L, 1, stone, stoneD, asph, steelD, lw);
  // the deck over each anchorage
  for (const [a, b] of [[Math.max(0, anA - 39.3), anA], [anB, Math.min(F.L, anB + 39.3)]]) {
    for (const sg of [-1, 1]) {
      const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
      slab(bag, F, asph, a, b, o0, o1, y, 0.5, 6);
      railing(bag, F, steelD, a, b, sg * (ROAD[1] + 0.1), y, 1.05, 2.29, 0.08);
    }
    slab(bag, F, stoneD, a, b, -ROAD[0], ROAD[0], (s) => y(s) + 0.9, 1.4, 6);
  }

}

// station runs from s0 to s1 cut round each tower station (half width h)
function splitAround(s0, s1, towers, h) {
  let runs = [[s0, s1]];
  for (const t of towers) {
    const out = [];
    for (const [a, b] of runs) {
      if (t + h <= a || t - h >= b) { out.push([a, b]); continue; }
      if (t - h > a) out.push([a, t - h]);
      if (t + h < b) out.push([t + h, b]);
    }
    runs = out;
  }
  return runs;
}

// a tower: the battered base to the arch floor, the shaft pierced by the two pointed arches (each opening splayed in two
// orders at the faces), pilasters, a string course at the springing, the cornice and the cable saddle housings
function tower(bag, F, sT, stone, stoneD, steelD) {
  const fr = F.at(sT), yFloor = F.yAt(sT) - 1.2;
  // base: the waterline plinth and the battered pier up to the arch floor
  taper(bag, F, stoneD, sT, 0, -3, 2.4, BASE_T / 2 + 0.8, BASE_W / 2 + 0.8, BASE_T / 2 + 0.6, BASE_W / 2 + 0.6);
  taper(bag, F, stone, sT, 0, 2.4, yFloor, BASE_T / 2, BASE_W / 2, T_T / 2 + 0.35, T_W / 2 + 0.35);
  // the shaft: an extrusion through the tower's thickness of its front elevation (the openings as notches)
  const mtx = (o0, depth) => {
    const m = new THREE.Matrix4();
    const p = F.P(sT, 0, 0);
    m.makeBasis(new THREE.Vector3(...fr.n), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...fr.t));
    m.setPosition(p[0] + fr.t[0] * o0, 0, p[2] + fr.t[2] * o0);
    return m;
  };
  const yTop = T_TOP - 3.6, ySpring = ARCH_APEX - 11.8;
  const elev = (grow) => {
    const s = new THREE.Shape();
    const h = T_W / 2;
    s.moveTo(-h, yFloor);
    for (const [a, b] of [[-PIER_HALF - ARCH_W, -PIER_HALF], [PIER_HALF, PIER_HALF + ARCH_W]]) {
      const aa = a - grow, bb = b + grow;
      s.lineTo(aa, yFloor);
      for (const p of lancet(aa, bb, ySpring, ARCH_APEX + grow)) s.lineTo(p[0], p[1]);
      s.lineTo(bb, yFloor);
    }
    s.lineTo(h, yFloor); s.lineTo(h, yTop); s.lineTo(-h, yTop); s.lineTo(-h, yFloor);
    return s;
  };
  const face = 1.1, core = T_T - 2 * face;
  const ext = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  bag.addGeometry(stone, ext(elev(0), core), mtx(-core / 2, core));
  const gFace = ext(elev(0.9), face);
  bag.addGeometry(stone, gFace, mtx(-T_T / 2, face));
  bag.addGeometry(stone, gFace, mtx(T_T / 2 - face, face));
  // the arch orders: a moulded ring round each opening on both faces
  for (const sgF of [-1, 1]) for (const [a, b] of [[-PIER_HALF - ARCH_W, -PIER_HALF], [PIER_HALF, PIER_HALF + ARCH_W]]) {
    const ring = new THREE.Shape();
    const outer = lancet(a - 1.7, b + 1.7, ySpring, ARCH_APEX + 1.7), inner = lancet(a - 0.9, b + 0.9, ySpring, ARCH_APEX + 0.9);
    ring.moveTo(a - 1.7, ySpring - 0.01);
    for (const p of outer) ring.lineTo(p[0], p[1]);
    ring.lineTo(b + 0.9, ySpring - 0.01);
    for (const p of inner.slice().reverse()) ring.lineTo(p[0], p[1]);
    ring.lineTo(a - 1.7, ySpring - 0.01);
    const g = ext(ring, 0.35);
    bag.addGeometry(stoneD, g, mtx(sgF > 0 ? T_T / 2 : -T_T / 2 - 0.35, 0.35));
  }
  // pilasters on both faces of the outer pillars and the central pier, a string course at the springing, the cornice
  const pil = (o0, o1, y0, y1) => { for (const sg of [-1, 1]) block(bag, F, stone, sT + sg * (T_T / 2 + 0.2) - 0.2, sT + sg * (T_T / 2 + 0.2) + 0.2, o0, o1, y0, y1); };
  for (const sg of [-1, 1]) {
    const o0 = sg * (PIER_HALF + ARCH_W + 0.9), o1 = sg * (T_W / 2);
    pil(Math.min(o0, o0 + sg * 1.6), Math.max(o0, o0 + sg * 1.6), yFloor, yTop);
    pil(Math.min(o1, o1 - sg * 1.8), Math.max(o1, o1 - sg * 1.8), yFloor, yTop);
  }
  pil(-1.1, 1.1, ARCH_APEX + 2.2, yTop);
  for (const [o0, o1] of [[-T_W / 2 - 0.3, -PIER_HALF - ARCH_W - 0.9], [-PIER_HALF + 0.9, PIER_HALF - 0.9], [PIER_HALF + ARCH_W + 0.9, T_W / 2 + 0.3]]) {
    for (const sg of [-1, 1]) block(bag, F, stoneD, sT + sg * (T_T / 2 + 0.25) - 0.25, sT + sg * (T_T / 2 + 0.25) + 0.25, o0, o1, ySpring - 0.6, ySpring + 0.4);
  }
  block(bag, F, stoneD, sT - T_T / 2 - 0.9, sT + T_T / 2 + 0.9, -T_W / 2 - 0.9, T_W / 2 + 0.9, yTop, yTop + 1.6);
  block(bag, F, stone, sT - T_T / 2 - 0.3, sT + T_T / 2 + 0.3, -T_W / 2 - 0.3, T_W / 2 + 0.3, yTop + 1.6, T_TOP);
  // the saddle housings the cables cross
  for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) block(bag, F, steelD, sT - 4.5, sT + 4.5, o - 1.3, o + 1.3, T_TOP - 0.2, CABLE_TOP + 0.6);
}

// a pointed (lancet) arch from jamb a to jamb b springing at ys with its apex at ya: the points from the left springing
// over the apex to the right springing
function lancet(a, b, ys, ya, n = 10) {
  const w = b - a, h = ya - ys, R = (w * w / 4 + h * h) / w, c = (a + b) / 2;
  const out = [];
  const thA = Math.acos((c - (a + R)) / R);   // the apex's angle on the left arc (centred at a + R)
  for (let i = 0; i <= n; i++) { const th = Math.PI + (thA - Math.PI) * (i / n); out.push([a + R + R * Math.cos(th), ys + R * Math.sin(th)]); }
  for (let i = n - 1; i >= 0; i--) { const th = Math.PI + (thA - Math.PI) * (i / n); out.push([b - R - R * Math.cos(th), ys + R * Math.sin(th)]); }
  return out;
}

// an anchorage: a battered block of ashlar from its river face (sAn) away from the river, the cornice, pilasters at the
// corners and two arched panels a side
function anchorage(bag, F, sAn, away, stone, stoneD) {
  const L0 = 39.3, L1 = 35.7, B0 = 36.3 / 2, B1 = 31.7 / 2;
  const sc = sAn + away * L0 / 2, yTop = F.yAt(sc) - 1.4;
  taper(bag, F, stone, sc, 0, 0, yTop - 1.8, L0 / 2, B0, L1 / 2, B1);
  block(bag, F, stoneD, sc - L1 / 2 - 0.7, sc + L1 / 2 + 0.7, -B1 - 0.7, B1 + 0.7, yTop - 1.8, yTop);
  // corner pilasters and arched panels on the long sides
  for (const sg of [-1, 1]) for (const k of [-1, 0, 1]) {
    const s = sc + k * (L1 / 2 - 1.2);
    block(bag, F, stone, s - 1.2, s + 1.2, sg * (B0 + 0.35) - 0.35, sg * (B0 + 0.35) + 0.35, 0, yTop - 1.8);
  }
  for (const sg of [-1, 1]) for (const k of [-0.5, 0.5]) {
    const s = sc + k * L1 / 2;
    // a recessed window bay: three dark slits under an arch
    for (const d of [-1.4, 0, 1.4]) block(bag, F, stoneD, s + d - 0.45, s + d + 0.45, sg * (B0 - 0.2) - 0.25, sg * (B0 - 0.2) + 0.25, yTop * 0.38, yTop * 0.62);
  }
}

// a masonry approach from station a to b (dir = the side away from the river): arched bays on piers where the deck
// stands high, retaining walls and fill where it runs low, the roadways and barriers on top
function approach(bag, F, a, b, dir, stone, stoneD, asph, steelD, lw) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo < 4) return;
  const y = (s) => F.yAt(s);
  const ground = (s) => { const g = F.groundAt(s); return g === null ? 0 : g; };
  const halfW = W / 2 + 0.4;
  // roadway and parapets
  for (const sg of [-1, 1]) {
    const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
    slab(bag, F, asph, lo, hi, o0, o1, y, 0.4, 5);
    laneLines(bag, F, lw, lw, lo, hi, y, [{ o: sg * (ROAD[1] - 0.25), w: 0.12 }]);
  }
  const bays = [];
  const BAY = 24, PIER = 4.2;
  for (let s = lo; s < hi; s += BAY) bays.push([s, Math.min(hi, s + BAY)]);
  for (const [s0, s1] of bays) {
    const sm = (s0 + s1) / 2, h = y(sm) - ground(sm);
    // the spandrel wall and parapet over the bay, each side
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? halfW - 1.4 : -halfW, o1 = sg > 0 ? halfW : -halfW + 1.4;
      if (h > 7) {
        // the wall above the arch crown, and the arch's two haunches as stepped blocks
        const crown = ground(sm) + Math.max(4.5, h * 0.62);
        block(bag, F, stone, s0, s1, o0, o1, crown, y(sm) - 0.4);
        for (let k = 0; k < 4; k++) {
          const f = (k + 1) / 5, yy = crown - (crown - ground(sm) - h * 0.45) * (1 - Math.sqrt(1 - f * f)) - 0.6;
          const d = (s1 - s0 - PIER) / 2 * (1 - f);
          block(bag, F, stone, s0 + PIER / 2, s0 + PIER / 2 + d, o0, o1, yy, crown);
          block(bag, F, stone, s1 - PIER / 2 - d, s1 - PIER / 2, o0, o1, yy, crown);
        }
      } else {
        block(bag, F, stone, s0, s1, o0, o1, ground(sm), y(sm) - 0.4);
      }
      block(bag, F, stoneD, s0, s1, o0 - (sg > 0 ? 0 : 0.15), o1 + (sg > 0 ? 0.15 : 0), y(sm) - 0.4, y(sm) + 1.1);
    }
    if (h <= 7) block(bag, F, stoneD, s0, s1, -halfW + 1.4, halfW - 1.4, ground(sm), y(sm) - 0.45, new Set(['+y']));
    else crossBeamsUnder(bag, F, steelD, s0, s1, halfW, y);
  }
  // the piers between the bays (where the deck stands high)
  for (let s = lo; s <= hi + 1e-6; s += BAY) {
    const h = y(s) - ground(s);
    if (h <= 7) continue;
    block(bag, F, stone, s - PIER / 2, s + PIER / 2, -halfW, halfW, ground(s), y(s) - 0.45);
  }
  void dir;
}
function crossBeamsUnder(bag, F, mat, s0, s1, halfW, y) {
  crossBeams(bag, F, mat, s0 + 2.1, s1 - 2.1, 3.0, -halfW + 1.4, halfW - 1.4, (s) => y(s) - 0.4, 0.3, 0.8);
}

// a promenade lamp: a cast post with a lantern
function lampPost(bag, F, post, lamp, s, o, y0) {
  if (bag.lod) return;
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 3.6), 0.09, 8, 0.06, true);
  bag.rod(post, F.P(s, o, y0 + 3.6), F.P(s, o, y0 + 3.75), 0.16, 8, 0.16, true);
  bag.rod(lamp, F.P(s, o, y0 + 3.75), F.P(s, o, y0 + 4.35), 0.2, 8, 0.24, true);
  bag.rod(post, F.P(s, o, y0 + 4.35), F.P(s, o, y0 + 4.55), 0.26, 8, 0.05, true);
}
