// The Hell Gate Bridge (Gustav Lindenthal, engineer; Henry Hornbostel, architect; 1916) and its elevated approaches, from
// its published dimensions and the record (tools/pipeline/bridges.mjs: the planimetric railroad lines coded elevated
// and viaduct, the arch's towers from OpenStreetMap).
// Facts used (Wikipedia, "Hell Gate Bridge"; HAER NY-180): a steel two-hinged spandrel-braced through arch of 1,017 ft
// (310 m) between masonry towers of granite-faced concrete (~250 ft), the arch's top 305 ft (93 m) over the water and
// 135 ft (41 m) of clearance under the deck; the two arch trusses 60 ft (18.3 m) apart; the lower chord springing from
// the towers' feet, the upper chord meeting the towers high up, the spandrel bracing deep at the ends and shallow at the
// crown; the deck hung from the arch in the middle and carried through the towers' portals; four tracks laid (three in
// use); ~5 km of approach viaducts of steel spans on concrete piers. Paint: "Hell Gate red". Form details (the towers'
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';

const C = { steel: 0x9a3b30, steelD: 0x772d25, stone: 0x9d978b, stoneD: 0x847e73, conc: 0xa29d93, ballast: 0x5b554d };
const O_R = 9.15, DECK_HALF = 9.0, TOWER_L = 26.0, TOWER_W = 44.0, TOWER_H = 76.0;

export function buildHellGate(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.5, { style: 'dressed' }), stoneD = M.ashlar(C.stoneD, 1.5, { style: 'dressed' });
  const conc = M.concrete(C.conc), ballast = M.concrete(C.ballast), rail = M.galv(), hang = M.cable(C.steelD, { px: 0.00008 });
  const [sA, sB] = lay.main, y = (s) => F.yAt(s);
  const a0 = sA + TOWER_L / 2, a1 = sB - TOWER_L / 2, am = (a0 + a1) / 2, ah = (a1 - a0) / 2;
  // the arch: the lower chord from 6 m at the towers' feet to 82 m at the crown, the upper from 70 m at the towers to
  // 93 m; between them the spandrel bracing
  const ySpring = 6, yCrownB = 82, yEndT = 70, yCrownT = 93;
  const lowC = (s) => { const u = (s - am) / ah; return ySpring + (yCrownB - ySpring) * (1 - u * u); };
  const topC = (s) => { const u = (s - am) / ah; return yEndT + (yCrownT - yEndT) * (1 - u * u); };
  const N = 22, S = (i) => a0 + ((a1 - a0) * i) / N;
  for (const sg of [-1, 1]) {
    const o = sg * O_R;
    for (let i = 0; i < N; i++) {
      const p = S(i), q = S(i + 1);
      memberSO(bag, F, steel, p, o, lowC(p), q, o, lowC(q), 1.6, 2.4);
      memberSO(bag, F, steel, p, o, topC(p), q, o, topC(q), 1.3, 1.8);
      // spandrel bracing: a post at each panel point and the diagonals (a Warren with posts)
      if (!bag.lod || i % 2 === 0) memberSO(bag, F, steelD, p, o, lowC(p) + 1.0, p, o, topC(p) - 0.8, 0.8, 0.9);
      if (!bag.lod) memberSO(bag, F, steelD, p, o, i < N / 2 ? topC(p) - 0.8 : lowC(p) + 1.0, q, o, i < N / 2 ? lowC(q) + 1.0 : topC(q) - 0.8, 0.6, 0.7);
    }
    // the hangers where the deck runs under the lower chord, the posts where it runs over it
    for (let i = 1; i < N; i++) {
      const p = S(i), yd = y(p) - 2.2;
      if (lowC(p) > yd + 2) bag.rod(hang, F.P(p, o, yd), F.P(p, o, lowC(p) - 1.0), 0.18, 6);
      else memberSO(bag, F, steelD, p, o, lowC(p) + 1.0, p, o, yd, 0.6, 0.6);
    }
  }
  // the ribs tied across: struts at the panel points, laterals in the upper and lower chords' planes
  for (let i = 0; i <= N; i++) { const p = S(i); memberSO(bag, F, steelD, p, -O_R, topC(p), p, O_R, topC(p), 0.6, 0.8); if (lowC(p) > y(p) + 6) memberSO(bag, F, steelD, p, -O_R, lowC(p), p, O_R, lowC(p), 0.6, 0.8); }
  if (!bag.lod) for (let i = 0; i < N; i++) {
    const p = S(i), q = S(i + 1);
    memberSO(bag, F, steelD, p, -O_R, topC(p), q, O_R, topC(q), 0.4, 0.4);
    memberSO(bag, F, steelD, p, O_R, topC(p), q, -O_R, topC(q), 0.4, 0.4);
  }

  // ---- the deck, the whole length: a steel floor (stringers on floor beams) on plate girders, ballast and four tracks
  deck(bag, F, 0, F.L, steel, steelD, ballast, rail, y);
  // ---- the towers (the deck through their portals) and the viaducts' piers
  for (const [sT, out] of [[sA, -1], [sB, 1]]) tower(bag, F, sT, out, stone, stoneD, y(sT));
  piers(bag, F, rec, 0, sA - TOWER_L / 2 - 2, conc, y);
  piers(bag, F, rec, sB + TOWER_L / 2 + 2, F.L, conc, y);
}

function deck(bag, F, a, b, steel, steelD, ballast, rail, y) {
  // plate girders under each pair of tracks, the floor and the ballast troughs, the tracks, the walkway rails
  for (const o of [-7.2, -2.4, 2.4, 7.2]) slab(bag, F, steel, a, b, o - 0.3, o + 0.3, (s) => y(s) - 0.9, 2.6, 8, { top: false });
  slab(bag, F, steelD, a, b, -DECK_HALF, DECK_HALF, (s) => y(s) - 0.6, 0.35, 8);
  slab(bag, F, ballast, a, b, -DECK_HALF + 0.7, DECK_HALF - 0.7, (s) => y(s) - 0.25, 0.35, 8, { bottom: false });
  for (const sg of [-1, 1]) slab(bag, F, steel, a, b, sg > 0 ? DECK_HALF - 0.6 : -DECK_HALF, sg > 0 ? DECK_HALF : -DECK_HALF + 0.6, (s) => y(s) + 0.5, 1.4, 8);   // the deck's parapet girders
  crossBeams(bag, F, steelD, a, b, 6.0, -DECK_HALF, DECK_HALF, (s) => y(s) - 0.95, 0.4, 1.4);
  lateralX(bag, F, steelD, a, b, 12, -7.2, 7.2, (s) => y(s) - 3.3, 0.2);
  if (!bag.lod) for (const t of [-5.7, -1.9, 1.9, 5.7]) for (const r of [-0.72, 0.72]) {
    const ss = F.range(a, b, 12);
    for (let i = 0; i + 1 < ss.length; i++) bag.beam(rail, F.P(ss[i], t + r, y(ss[i]) + 0.12), F.P(ss[i + 1], t + r, y(ss[i + 1]) + 0.12), 0.075, 0.15);
  }
  for (const sg of [-1, 1]) railing(bag, F, steelD, a, b, sg * (DECK_HALF - 0.3), (s) => y(s) + 1.2, 1.0, 3.0, 0.07);
}

// a masonry tower: a battered base, the shaft with the portal the tracks run through (a round arch), tall arched openings
// high in each face, a stepped top with a cornice
function tower(bag, F, sT, out, stone, stoneD, yDeck) {
  const fr = F.at(sT), g = F.groundAt(sT), y0 = g === null ? -3 : g - 0.5;
  taper(bag, F, stoneD, sT, 0, y0, 4, TOWER_L / 2 + 1.5, TOWER_W / 2 + 1.5, TOWER_L / 2 + 1.0, TOWER_W / 2 + 1.0);
  const m = (o0, depth) => { const mm = new THREE.Matrix4(), p = F.P(sT, 0, 0); mm.makeBasis(new THREE.Vector3(...fr.n), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...fr.t)); mm.setPosition(p[0] + fr.t[0] * o0, 0, p[2] + fr.t[2] * o0); return mm; };
  // the shaft's elevation across the bridge with the portal (the deck's width, a round head) cut through it, extruded
  // along the bridge through the tower's length
  const sh = new THREE.Shape(), hw = TOWER_W / 2 - 1.0, pw = DECK_HALF + 0.8, yP = yDeck - 3.6, yPa = yDeck + 9.0;
  sh.moveTo(-hw, 4); sh.lineTo(hw, 4); sh.lineTo(hw - 1.2, TOWER_H - 6); sh.lineTo(-hw + 1.2, TOWER_H - 6); sh.lineTo(-hw, 4);
  const hole = new THREE.Path();
  hole.moveTo(-pw, yP); hole.lineTo(pw, yP); hole.lineTo(pw, yPa);
  for (let k = 1; k < 16; k++) { const a = (Math.PI * k) / 16; hole.lineTo(pw * Math.cos(a), yPa + pw * 0.9 * Math.sin(a)); }
  hole.lineTo(-pw, yPa); hole.lineTo(-pw, yP);
  sh.holes.push(hole);
  bag.addGeometry(stone, new THREE.ExtrudeGeometry(sh, { depth: TOWER_L, bevelEnabled: false, curveSegments: 4 }), m(-TOWER_L / 2, TOWER_L));
  // the tall arched openings high in each face (dark recesses), the cornice and the stepped top
  for (const f of [-1, 1]) for (const o of [-9, 9]) {
    const s = sT + f * (TOWER_L / 2 + 0.02);
    block(bag, F, stoneD, s - 0.3, s + 0.3, o - 3.2, o + 3.2, TOWER_H - 30, TOWER_H - 12);
  }
  block(bag, F, stoneD, sT - TOWER_L / 2 - 0.8, sT + TOWER_L / 2 + 0.8, -hw - 0.8, hw + 0.8, TOWER_H - 6, TOWER_H - 4);
  block(bag, F, stone, sT - TOWER_L / 2 + 1.5, sT + TOWER_L / 2 - 1.5, -hw + 2.5, hw - 2.5, TOWER_H - 4, TOWER_H);
  block(bag, F, stoneD, sT - TOWER_L / 2 + 4.0, sT + TOWER_L / 2 - 4.0, -hw + 5.0, hw - 5.0, TOWER_H, TOWER_H + 3);
  void out;
}

// the viaducts' piers: a concrete pier of two tapered columns and a cap every ~30 m (a wider one where a street passes
// under), none in the streets
function piers(bag, F, rec, a, b, conc, y) {
  if (b - a < 4) return;
  const g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (let s = a + 12; s < b - 4; s += 30) {
    let ss = s;
    for (let k = 0; k < 6 && !free(ss); k++) ss += k % 2 ? -k * 4 : k * 4;
    if (!free(ss)) continue;
    const top = y(ss) - 3.6, base = g(ss) - 0.5, h = top - base;
    if (h < 2.5) continue;
    for (const o of [-6.5, 6.5]) taper(bag, F, conc, ss, o, base, top - 1.6, 1.7, 1.5, 1.3, 1.2);
    block(bag, F, conc, ss - 1.8, ss + 1.8, -DECK_HALF - 0.3, DECK_HALF + 0.3, top - 1.6, top);
    if (h > 14) block(bag, F, conc, ss - 0.9, ss + 0.9, -6.5, 6.5, base + h * 0.45, base + h * 0.45 + 1.4);
  }
}
