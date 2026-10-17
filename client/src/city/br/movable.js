// The movable bridges: swing spans (the Harlem River's), vertical lifts and bascules, from each bridge's spec and the
// record's layout (tools/pipeline/bridges.mjs layoutMovable: the pivot or the towers from the ENC, the roadway level).
// A swing span is a through truss on a centre pivot pier, deepest over the pivot (a camelback top chord) and shallowest
// at its ends, with its fender (the long protection pier the open span rests along, the ENC footprint), its rest piers
// at the channel's sides, the operator's house over the pivot, and steel approach spans on piers to the shores.
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';

export function buildSwing(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), stone = M.ashlar(S.stone ?? 0x9e988c, 1.3), conc = M.concrete();
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), timber = M.planks(0x4a3d30), lamp = M.glow(0xffe0a8, 2.0);
  const sP = lay.piers[0], half = lay.span / 2, a = sP - half, b = sP + half, y = (s) => F.yAt(s);
  const W = S.width / 2, oT = W + 0.4;
  // ---- the swing span's trusses: the top chord a polygon highest over the pivot
  const top = (s) => y(s) + 1.4 + S.hEnd + (S.hPivot - S.hEnd) * Math.pow(Math.max(0, 1 - Math.abs(s - sP) / half), S.camel ?? 1.6);
  const bot = (s) => y(s) - 1.2;
  for (const sg of [-1, 1]) truss(bag, F, steel, a, b, sg * oT, top, bot, S.panel ?? 8, S.pattern ?? 'pratt', { chord: [0.55, 0.75], vert: [0.42, 0.45], diag: [0.32, 0.38] });
  // portals at the ends and over the pivot, top laterals and struts
  for (const s of [a + 0.3, b - 0.3, sP]) memberSO(bag, F, steelD, s, -oT, top(s) - 0.6, s, oT, top(s) - 0.6, 0.5, 0.9);
  lateralX(bag, F, steelD, a, b, (S.panel ?? 8) * 2, -oT, oT, (s) => top(s) - 0.5, 0.18);
  crossBeams(bag, F, steelD, a, b, (S.panel ?? 8) / 2, -oT, oT, (s) => y(s) - 0.35, 0.35, 1.1);
  // the deck: roadway and the sidewalks on brackets outside the trusses
  road(bag, F, asph, lw, ly, steelD, a, b, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? oT + 0.5 : -oT - 0.5 - S.walk, o1 = sg > 0 ? oT + 0.5 + S.walk : -oT - 0.5;
    slab(bag, F, conc, a, b, o0, o1, (s) => y(s) + 0.15, 0.3, 6);
    railing(bag, F, steelD, a, b, sg * (oT + 0.5 + S.walk), (s) => y(s) + 0.15, 1.2, 2.4, 0.07);
  }
  // the operator's house over the pivot, up on the top chords
  const yh = top(sP) + 0.2;
  block(bag, F, steelD, sP - 3.2, sP + 3.2, -3.0, 3.0, yh, yh + 3.4);
  block(bag, F, steel, sP - 3.6, sP + 3.6, -3.4, 3.4, yh + 3.4, yh + 3.8);
  // ---- the pivot pier (a drum) and its fender (the ENC footprint: long across the bridge, along the channel)
  const wy = 0;
  taper(bag, F, stone, sP, 0, -3, bot(sP) - 1.2, 7.5, 7.5, 7.0, 7.0);
  const FL = S.fender?.[0] ?? 110, FW = S.fender?.[1] ?? 22;
  for (const sg of [-1, 1]) {
    // the fender's long walls, low over the water, with a rounded nose at each end
    block(bag, F, timber, sP - FW / 2, sP - FW / 2 + 1.2, -FL / 2, FL / 2, wy - 1.5, wy + 2.2);
    block(bag, F, timber, sP + FW / 2 - 1.2, sP + FW / 2, -FL / 2, FL / 2, wy - 1.5, wy + 2.2);
    taper(bag, F, timber, sP, sg * (FL / 2), wy - 1.5, wy + 2.2, FW / 2, 3.0, FW / 2 - 0.5, 2.5);
  }
  if (!bag.lod) for (let o = -FL / 2 + 4; o < FL / 2 - 3; o += 6) memberSO(bag, F, timber, sP - FW / 2 + 0.6, o, wy + 1.8, sP + FW / 2 - 0.6, o, wy + 1.8, 0.4, 0.5);
  // the rest piers at the span's ends
  for (const s of [a, b]) {
    const g = F.groundAt(s), base = g === null ? -3 : g - 0.5;
    taper(bag, F, stone, s, 0, base, bot(s) - 1.2, 3.2, W + 3.0, 2.8, W + 2.6);
  }
  // ---- the approaches: deck girders on piers every ~25 m from the rest piers to the ends
  approach(bag, F, rec, 0, a, S, steel, steelD, stone, asph, lw, ly, conc);
  approach(bag, F, rec, b, F.L, S, steel, steelD, stone, asph, lw, ly, conc);
  // lamps along the span
  if (!bag.lod) for (let s = a + 8; s < b - 4; s += 24) for (const sg of [-1, 1]) {
    const p = F.P(s, sg * (oT + 0.5), y(s) + 0.15);
    bag.rod(steelD, p, [p[0], p[1] + 6, p[2]], 0.07, 6, 0.05, true);
    bag.rod(lamp, [p[0], p[1] + 6, p[2]], [p[0], p[1] + 6.25, p[2]], 0.22, 8, 0.22, true);
  }
}

function road(bag, F, asph, lw, ly, steelD, a, b, o0, o1, y, lanes) {
  slab(bag, F, asph, a, b, o0, o1, y, 0.3, 6);
  const c = (o0 + o1) / 2, lw0 = (o1 - o0) / (2 * lanes), lines = [{ o: c - 0.12, w: 0.11, yellow: true }, { o: c + 0.12, w: 0.11, yellow: true }, { o: o0 + 0.3, w: 0.12 }, { o: o1 - 0.3, w: 0.12 }];
  for (let k = 1; k < lanes; k++) lines.push({ o: o0 + k * lw0, w: 0.11, dash: [3.05, 9.15] }, { o: o1 - k * lw0, w: 0.11, dash: [3.05, 9.15] });
  laneLines(bag, F, lw, ly, a, b, y, lines);
}

// approach spans from a to b: steel deck girders on piers (stone in the water, steel bents on land) every ~25 m, kept out
// of the streets under the deck; where the deck runs within 2.5 m of the ground, a filled ramp between walls
function approach(bag, F, rec, a, b, S, steel, steelD, stone, asph, lw, ly, conc) {
  if (b - a < 3) return;
  const y = (s) => F.yAt(s), g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  const W = S.width / 2;
  road(bag, F, asph, lw, ly, steelD, a, b, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? W + 0.3 : -W - 0.3 - S.walk, o1 = sg > 0 ? W + 0.3 + S.walk : -W - 0.3;
    slab(bag, F, conc, a, b, o0, o1, (s) => y(s) + 0.15, 0.3, 6);
    railing(bag, F, steelD, a, b, sg * (W + 0.3 + S.walk), (s) => y(s) + 0.15, 1.1, 2.4, 0.07);
    for (const o of [sg * (W - 1.5), sg * 2.5]) { const ss = F.range(a, b, 8); for (let i = 0; i + 1 < ss.length; i++) if (y(ss[i]) - g(ss[i]) > 2.4) bag.beam(steel, F.P(ss[i], o, y(ss[i]) - 1.15), F.P(ss[i + 1], o, y(ss[i + 1]) - 1.15), 0.45, 1.7); }
  }
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (let s = a + 12; s < b - 3; s += 25) {
    let ss = s;
    for (let k = 0; k < 6 && !free(ss); k++) ss += k % 2 ? -k * 4 : k * 4;
    if (!free(ss)) continue;
    const gy = F.groundAt(ss), base = gy === null ? -3 : gy - 0.4, h = y(ss) - 2.0 - base;
    if (h < 1.0) continue;
    if (gy === null) taper(bag, F, stone, ss, 0, base, y(ss) - 2.0, 2.2, W + 2.0, 1.9, W + 1.7);
    else {
      for (const o of [-(W - 1.5), W - 1.5]) taper(bag, F, steel, ss, o, base, y(ss) - 2.0, 0.55, 0.45, 0.45, 0.4);
      memberSO(bag, F, steelD, ss, -W - 0.5, y(ss) - 2.4, ss, W + 0.5, y(ss) - 2.4, 0.7, 0.8);
    }
  }
  // the low ends on fill between walls
  const ss = F.range(a, b, 4);
  for (let i = 0; i + 1 < ss.length; i++) {
    const p = ss[i], q = ss[i + 1];
    if (y(p) - g(p) > 2.5 || F.groundAt(p) === null) continue;
    block(bag, F, conc, p, q, -W - S.walk - 0.4, W + S.walk + 0.4, g(p) - 0.3, Math.min(y(p), y(q)) - 0.32, new Set(['+y']));
  }
}

// ---------------------------------------------------------------- the specs
const swing = (o) => (rec, bag) => buildSwing(rec, bag, o);
// (colours: the Harlem River swing bridges' current paint, from photographs)
export const buildMacombs = swing({ steel: 0xd8dcd8, steelD: 0xb6bab6, width: 18.3, walk: 2.6, lanes: 2, hPivot: 22, hEnd: 9, camel: 1.4, panel: 9.0, fender: [151, 20] });
export const build145 = swing({ steel: 0x8ea2b2, steelD: 0x70838f, width: 15.2, walk: 2.4, lanes: 2, hPivot: 15, hEnd: 8, camel: 1.5, panel: 7.6, fender: [114, 25] });
export const buildMadison = swing({ steel: 0xc4c9cc, steelD: 0xa2a7aa, width: 15.2, walk: 2.4, lanes: 2, hPivot: 18, hEnd: 8, camel: 1.4, panel: 7.6, fender: [121, 23] });
export const buildThirdAv = swing({ steel: 0xc2c7ca, steelD: 0xa0a5a8, width: 21.3, walk: 2.6, lanes: 3, hPivot: 16, hEnd: 10, camel: 2.0, panel: 8.9, pattern: 'warrenV', fender: [127, 26] });
export const buildWillis = swing({ steel: 0xb4b8b6, steelD: 0x939795, width: 20.5, walk: 2.8, lanes: 2, hPivot: 19.8, hEnd: 10, camel: 1.8, panel: 8.9, pattern: 'warrenV', fender: [138, 26] });
export const buildUnivHts = swing({ steel: 0xd0d4d2, steelD: 0xaeb2b0, width: 13.4, walk: 2.2, lanes: 2, hPivot: 14, hEnd: 7, camel: 1.4, panel: 6.7, fender: [98, 21] });

// ---------------------------------------------------------------- vertical lifts
// a lift span between two towers (the record's two piers): steel towers of four braced legs standing on piers, the
// counterweights hung in them, the sheaves' machinery houses on top; the span a through truss; approaches as above
export function buildLift(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), stone = M.ashlar(S.stone ?? 0x9e988c, 1.3), conc = M.concrete();
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), red = M.glow(0xff2a1a, 3.0);
  const lit = M.paint(S.steel, { flood: { y0: 4, y1: S.towerH, k: 1.2 } });
  // (four piers: the towers on the inner two, through trusses with curved top chords over the flanking spans to the outer
  // two: the Marine Parkway Bridge)
  const PS = lay.piers, [sA, sB] = PS.length >= 4 ? [PS[1], PS[2]] : PS, y = (s) => F.yAt(s), W = S.width / 2, oT = W + 0.4;
  const a = sA + S.towerL / 2 + 0.6, b = sB - S.towerL / 2 - 0.6;
  // the lift span
  const top = (s) => y(s) + 1.2 + S.spanH, bot = (s) => y(s) - 1.2;
  for (const sg of [-1, 1]) truss(bag, F, steel, a, b, sg * oT, top, bot, S.panel ?? 8, 'warrenV', { chord: [0.6, 0.8], vert: [0.45, 0.5], diag: [0.38, 0.42] });
  lateralX(bag, F, steelD, a, b, (S.panel ?? 8) * 2, -oT, oT, (s) => top(s) - 0.5, 0.2);
  for (const s of [a + 0.3, b - 0.3]) memberSO(bag, F, steelD, s, -oT, top(s) - 0.7, s, oT, top(s) - 0.7, 0.6, 1.0);
  crossBeams(bag, F, steelD, a, b, (S.panel ?? 8) / 2, -oT, oT, (s) => y(s) - 0.35, 0.35, 1.0);
  road(bag, F, asph, lw, ly, steelD, a, b, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
  if (S.upper) {   // a second deck over the roadway (the Broadway Bridge's subway level)
    const yu = (s) => y(s) + S.upper;
    slab(bag, F, conc, a, b, -W + 0.4, W - 0.4, yu, 0.5, 6);
    for (const t of [-1.9, 1.9]) for (const r of [-0.72, 0.72]) { const ss = F.range(a, b, 12); for (let i = 0; i + 1 < ss.length; i++) bag.beam(steelD, F.P(ss[i], t + r, yu(ss[i]) + 0.15), F.P(ss[i + 1], t + r, yu(ss[i + 1]) + 0.15), 0.08, 0.15); }
  }
  for (const sg of [-1, 1]) railing(bag, F, steelD, a, b, sg * (W - 0.1), y, 1.1, 2.4, 0.07);
  // the towers
  for (const sT of [sA, sB]) {
    const g = F.groundAt(sT), base = g === null ? -3 : g - 0.5, yPier = g === null ? 3.0 : g + 0.5;
    taper(bag, F, stone, sT, 0, base, yPier, S.towerL / 2 + 2.0, oT + 3.0, S.towerL / 2 + 1.6, oT + 2.6);
    const legs = [];
    for (const f of [-1, 1]) for (const sg of [-1, 1]) legs.push([sT + f * (S.towerL / 2 - 0.6), sg * (oT + 1.0)]);
    for (const [s, o] of legs) memberSO(bag, F, lit, s, o, yPier, s, o, S.towerH - 1.0, 1.1, 1.1);
    // bracing on the four faces (X per ~8 m), none across the roadway under the span's clearance
    const yClear = y(sT) + (S.upper ?? 0) + 6.5;
    if (!bag.lod) for (let yy = yPier + 1; yy < S.towerH - 6; yy += 8) {
      const y1 = Math.min(yy + 8, S.towerH - 6);
      for (const sg of [-1, 1]) {
        const o = sg * (oT + 1.0);
        memberSO(bag, F, steelD, sT - S.towerL / 2 + 0.6, o, yy, sT + S.towerL / 2 - 0.6, o, y1, 0.3, 0.35);
        memberSO(bag, F, steelD, sT + S.towerL / 2 - 0.6, o, yy, sT - S.towerL / 2 + 0.6, o, y1, 0.3, 0.35);
      }
      if (yy > yClear) for (const f of [-1, 1]) {
        const s = sT + f * (S.towerL / 2 - 0.6);
        memberSO(bag, F, steelD, s, -oT - 1.0, yy, s, oT + 1.0, y1, 0.3, 0.35);
        memberSO(bag, F, steelD, s, oT + 1.0, yy, s, -oT - 1.0, y1, 0.3, 0.35);
      }
    }
    // struts across over the clearance, the counterweights (when the span is down they hang high), the machinery house
    memberSO(bag, F, lit, sT, -oT - 1.0, Math.max(yClear + 2, S.towerH - 18), sT, oT + 1.0, Math.max(yClear + 2, S.towerH - 18), 1.0, 1.4);
    for (const sg of [-1, 1]) block(bag, F, conc, sT - S.towerL / 2 + 1.4, sT + S.towerL / 2 - 1.4, sg * (oT + 1.0) - 1.2, sg * (oT + 1.0) + 1.2, S.towerH - 15, S.towerH - 7);
    block(bag, F, steel, sT - S.towerL / 2 - 0.6, sT + S.towerL / 2 + 0.6, -oT - 2.0, oT + 2.0, S.towerH - 1.0, S.towerH + 4.0);
    block(bag, F, steelD, sT - S.towerL / 2 - 0.9, sT + S.towerL / 2 + 0.9, -oT - 2.3, oT + 2.3, S.towerH + 4.0, S.towerH + 4.6);
    for (const sg of [-1, 1]) { const p = F.P(sT, sg * (oT + 2.0), S.towerH + 4.6); bag.rod(red, p, [p[0], p[1] + 0.5, p[2]], 0.3, 8, 0.3, true); }
  }
  if (PS.length >= 4 && S.side) {
    for (const [p, q, sP] of [[PS[0] + 1.5, sA - S.towerL / 2 - 0.6, PS[0]], [sB + S.towerL / 2 + 0.6, PS[3] - 1.5, PS[3]]]) {
      const topS = (s) => y(s) + 1.2 + S.side.hEnd + (S.side.hMid - S.side.hEnd) * Math.sin(Math.PI * Math.max(0, Math.min(1, (s - p) / (q - p))));
      for (const sg of [-1, 1]) truss(bag, F, steel, p, q, sg * oT, topS, bot, S.panel ?? 8, 'warrenV', { chord: [0.6, 0.8], vert: [0.45, 0.5], diag: [0.38, 0.42] });
      lateralX(bag, F, steelD, p, q, (S.panel ?? 8) * 2, -oT, oT, (s) => topS(s) - 0.5, 0.2);
      crossBeams(bag, F, steelD, p, q, (S.panel ?? 8) / 2, -oT, oT, (s) => y(s) - 0.35, 0.35, 1.0);
      road(bag, F, asph, lw, ly, steelD, p, q, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
      for (const sg of [-1, 1]) railing(bag, F, steelD, p, q, sg * (W - 0.1), y, 1.1, 2.4, 0.07);
      const g = F.groundAt(sP), base = g === null ? -3.5 : g - 0.5;
      taper(bag, F, stone, sP, 0, base, y(sP) - 1.4, 3.2, oT + 2.4, 2.8, oT + 2.0);
    }
    approach(bag, F, rec, 0, PS[0] - 1.5, S, steel, steelD, stone, asph, lw, ly, conc);
    approach(bag, F, rec, PS[3] + 1.5, F.L, S, steel, steelD, stone, asph, lw, ly, conc);
    return;
  }
  approach(bag, F, rec, 0, sA - S.towerL / 2 - 0.6, S, steel, steelD, stone, asph, lw, ly, conc);
  approach(bag, F, rec, sB + S.towerL / 2 + 0.6, F.L, S, steel, steelD, stone, asph, lw, ly, conc);
}
const lift = (o) => (rec, bag) => buildLift(rec, bag, o);
// the Marine Parkway-Gil Hodges Memorial Bridge (1937): a 540 ft (164.6 m) lift span between lattice towers (~65 m), 55 ft
// (16.7 m, ENC VERCCL) of clearance closed and 150 ft open, flanked by through trusses with curved top chords to the
// outer piers (ENC: four bridge piers); four lanes and a walk; green paint
export const buildMarinePkwy = lift({ steel: 0x6f9f94, steelD: 0x557d74, width: 17.0, walk: 2.4, lanes: 2, spanH: 15, towerL: 10, towerH: 66, panel: 9.0,
  side: { hEnd: 6, hMid: 18 } });
// the Broadway Bridge (1962): a 304 ft (92.7 m) lift span, the 1 train on its upper level over the roadway; towers to
// ~56 m (135 ft of clearance open, ENC VERCOP 41.1 m)
export const buildBroadway = lift({ steel: 0xaab3b8, steelD: 0x8a9398, width: 16.0, walk: 2.0, lanes: 2, spanH: 12.5, upper: 7.0, towerL: 9, towerH: 58, panel: 7.7 });
// the Roosevelt Island Bridge (1955): a 418 ft (127.4 m) lift span; the Wards Island footbridge (1951): 312 ft (95 m)
export const buildRoosevelt = lift({ steel: 0x9a3a2e, steelD: 0x7a2d24, width: 11.0, walk: 1.8, lanes: 2, spanH: 11, towerL: 8, towerH: 45, panel: 8.0 });
export const buildWardsFoot = lift({ steel: 0x7fb0a4, steelD: 0x63907f, width: 4.0, walk: 0.6, lanes: 1, spanH: 9, towerL: 6, towerH: 40, panel: 6.8 });

// ---------------------------------------------------------------- bascules
// a double-leaf bascule (the Pulaski Bridge, 1954): two leaves of deck girders meeting over the channel's middle, each
// pivoting on its pier's trunnion with its counterweight inside the pier; the piers concrete, each with its operator's
// tower at the downstream corner (one with a lantern); the leaves' and the approaches' girders in the bridge's red; the
// approaches on steel bents as the other movable bridges'
export function buildBascule(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), stone = M.ashlar(S.stone ?? 0xa9a59b, 1.2, { style: 'dressed' });
  const conc = M.concrete(S.conc ?? 0xb3afa6), concDk = M.concrete(S.concD ?? 0x9a968d), asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), red = M.glow(0xff2a1a, 3.0);
  const lamp = M.glow(0xffe0a8, 2.0), roof = M.paint(S.roof ?? 0x55605a, { rough: 0.75, metal: 0.15 }), glass = M.paint(0x2c3438, { rough: 0.2, metal: 0.4 });
  const [sA, sB] = lay.piers, y = (s) => F.yAt(s), W = S.width / 2, PL = S.pierL;
  const a = sA + PL / 2, b = sB - PL / 2, mid = (a + b) / 2;
  // the leaves: girders under the edges and between the lanes, deepest at the trunnions, shallow at the tips; floor
  // beams; the roadway and walks; the open joint at mid-span
  const depth = (s) => { const t = Math.min(Math.abs(s - a), Math.abs(b - s)) / Math.max(1, (b - a) / 2); return S.girderD0 + (S.girderD1 - S.girderD0) * Math.min(1, t); };
  const lines = [-(W + 0.25), -W / 3, W / 3, W + 0.25];
  for (const [p, q] of [[a - 1.5, mid - 0.12], [mid + 0.12, b + 1.5]]) {
    const ss = F.range(p, q, 3);
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i], s1 = ss[i + 1], sm = (s0 + s1) / 2, d = depth(sm);
      for (const o of lines) block(bag, F, steel, s0, s1, o - 0.22, o + 0.22, y(sm) - 0.3 - d, y(sm) - 0.3);
    }
    crossBeams(bag, F, steelD, p, q, 4.0, -W - 0.2, W + 0.2, (s) => y(s) - 0.35, 0.3, 0.8);
    road(bag, F, asph, lw, ly, steelD, p, q, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? W + 0.3 : -W - 0.3 - S.walk, o1 = sg > 0 ? W + 0.3 + S.walk : -W - 0.3;
      slab(bag, F, conc, p, q, o0, o1, (s) => y(s) + 0.15, 0.3, 4);
      railing(bag, F, steelD, p, q, sg * (W + 0.3 + S.walk), (s) => y(s) + 0.15, 1.1, 2.4, 0.07);
    }
  }
  // the piers: from the channel bed (a plinth at the water) to the deck, the trunnion girders across, the operators' towers
  for (const [sP, k] of [[sA, 0], [sB, 1]]) {
    const g = F.groundAt(sP), base = g === null ? -3.5 : g - 0.5, top = y(sP) - 0.3;
    if (g === null) taper(bag, F, conc, sP, 0, base, 1.2, PL / 2 + 1.2, W + S.walk + 3.2, PL / 2 + 1.0, W + S.walk + 3.0);
    taper(bag, F, stone, sP, 0, g === null ? 1.2 : base, top - S.girderD0, PL / 2, W + S.walk + 2.4, PL / 2 - 0.3, W + S.walk + 2.1);
    block(bag, F, steelD, sP - 2.0, sP + 2.0, -W - 0.6, W + 0.6, top - S.girderD0, top - 0.2);   // (the trunnion girder)
    // the deck over the pier, its walks and railings
    road(bag, F, asph, lw, ly, steelD, sP - PL / 2, sP + PL / 2, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? W + 0.3 : -W - 0.3 - S.walk, o1 = sg > 0 ? W + 0.3 + S.walk : -W - 0.3;
      slab(bag, F, conc, sP - PL / 2, sP + PL / 2, o0, o1, (s) => y(s) + 0.15, 0.3, 4);
    }
    // the operator's tower on the downstream walk's outer side: two storeys of concrete with a band of windows, a hipped
    // roof, on the first pier a lantern
    const side = S.towerSide ?? 1, o0 = side * (W + S.walk + 0.6), o1 = side * (W + S.walk + 5.6), oc = (o0 + o1) / 2;
    const sc = sP + (k ? -1 : 1) * (PL / 2 - 3.0), yb = y(sP) + 0.15, yt = yb + S.towerH;
    block(bag, F, conc, sc - 2.5, sc + 2.5, Math.min(o0, o1), Math.max(o0, o1), g === null ? 1.2 : base, yt);
    for (const yy of [yb + 2.0, yb + S.towerH - 2.6]) block(bag, F, glass, sc - 2.55, sc + 2.55, Math.min(o0, o1) - 0.05, Math.max(o0, o1) + 0.05, yy, yy + 1.3);
    block(bag, F, concDk, sc - 2.8, sc + 2.8, Math.min(o0, o1) - 0.3, Math.max(o0, o1) + 0.3, yt, yt + 0.4);
    const c = F.P(sc, oc, yt + 0.4), fr = F.at(sc);
    const P = (ds, dO, dy) => [c[0] + fr.t[0] * ds + fr.n[0] * dO, c[1] + dy, c[2] + fr.t[2] * ds + fr.n[2] * dO];
    const r0 = [P(-2.8, -2.8, 0), P(2.8, -2.8, 0), P(2.8, 2.8, 0), P(-2.8, 2.8, 0)], ap = P(0, 0, 2.2);
    for (let i = 0; i < 4; i++) bag.poly(roof, [r0[i], r0[(i + 1) % 4], ap]);
    if (k === 0) { bag.rod(roof, ap, [ap[0], ap[1] + 1.4, ap[2]], 0.5, 8, 0.5, true); bag.rod(lamp, [ap[0], ap[1] + 1.4, ap[2]], [ap[0], ap[1] + 1.9, ap[2]], 0.45, 8, 0.2, true); }
    for (const sg of [-1, 1]) { const p = F.P(sP, sg * (W + S.walk + 0.4), yb + 1.2); bag.rod(red, p, [p[0], p[1] + 0.35, p[2]], 0.25, 8, 0.25, true); }   // (the channel's span lights)
  }
  approach(bag, F, rec, 0, sA - PL / 2, S, steel, steelD, stone, asph, lw, ly, conc);
  approach(bag, F, rec, sB + PL / 2, F.L, S, steel, steelD, stone, asph, lw, ly, conc);
}
const bascule = (o) => (rec, bag) => buildBascule(rec, bag, o);
// the Pulaski Bridge (1954): a double-leaf bascule over Newtown Creek, its leaves 176 ft (53.6 m) between the trunnions
// (OSM's two piers), 39 ft (11.9 m) of clearance closed; six lanes, a walk and the protected bike lane; red paint
export const buildPulaski = bascule({ steel: 0xa1342c, steelD: 0x7f2822, width: 21.0, walk: 2.4, lanes: 3, pierL: 15, girderD0: 3.4, girderD1: 1.5, towerH: 7.5, towerSide: 1 });

// ---------------------------------------------------------------- fixed through trusses
// a fixed through truss between two piers (the RFK Bridge's Bronx Kill crossing): a Warren truss with verticals whose top
// chord rises from the ends to the middle, the portals' struts and the top laterals over the clearance, the floor, the
// roadway and walks; the piers concrete; the approaches on steel bents as the movable bridges'
export function buildFixedTruss(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), stone = M.ashlar(S.stone ?? 0xa7a397, 1.2, { style: 'dressed' }), conc = M.concrete();
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow();
  const [sA, sB] = lay.piers, y = (s) => F.yAt(s), W = S.width / 2, oT = W + 0.4;
  const a = sA + 1.5, b = sB - 1.5;
  const top = (s) => y(s) + 1.2 + S.hEnd + (S.hMid - S.hEnd) * Math.sin(Math.PI * Math.max(0, Math.min(1, (s - a) / (b - a)))), bot = (s) => y(s) - 1.2;
  for (const sg of [-1, 1]) truss(bag, F, steel, a, b, sg * oT, top, bot, S.panel ?? 9, 'warrenV', { chord: [0.7, 0.9], vert: [0.5, 0.55], diag: [0.42, 0.46] });
  lateralX(bag, F, steelD, a, b, (S.panel ?? 9) * 2, -oT, oT, (s) => top(s) - 0.5, 0.22);
  for (const s of [a + 0.3, b - 0.3]) memberSO(bag, F, steelD, s, -oT, top(s) - 0.8, s, oT, top(s) - 0.8, 0.7, 1.2);
  crossBeams(bag, F, steelD, a, b, (S.panel ?? 9) / 2, -oT, oT, (s) => y(s) - 0.35, 0.35, 1.0);
  road(bag, F, asph, lw, ly, steelD, a, b, -W + 0.2, W - 0.2, y, S.lanes ?? 2);
  for (const sg of [-1, 1]) railing(bag, F, steelD, a, b, sg * (W - 0.1), y, 1.1, 2.4, 0.07);
  for (const sP of [sA, sB]) {
    const g = F.groundAt(sP), base = g === null ? -3.5 : g - 0.5;
    taper(bag, F, stone, sP, 0, base, y(sP) - 1.4, 3.0, oT + 2.2, 2.6, oT + 1.8);
  }
  approach(bag, F, rec, 0, sA - 1.5, S, steel, steelD, stone, asph, lw, ly, conc);
  approach(bag, F, rec, sB + 1.5, F.L, S, steel, steelD, stone, asph, lw, ly, conc);
}
// the RFK Bridge's Bronx Kill crossing (1936): a fixed through truss of 383 ft (117 m), 55 ft (17 m) of clearance, its
// approaches 1,217 ft; the suspension span's pale green
export const buildRfkBronxKill = (rec, bag) => buildFixedTruss(rec, bag, { steel: 0xa9c3bf, steelD: 0x89a39f, width: 26.0, walk: 3.0, lanes: 3, hEnd: 9, hMid: 15, panel: 9.75 });

