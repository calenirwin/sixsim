// The cable-stayed bridges (the Goethals' twin spans, the Kosciuszko's), from each bridge's spec and the record's
// layout (tools/pipeline/bridges.mjs: this deck's pylons from OpenStreetMap's supports, the twin deck's offset).
// Each deck: steel edge girders under a concrete slab, the roadway; its pylons H frames of concrete (two legs outside
// the deck's edges, a strut under the deck and one at the head); the stays a semi-fan in two planes, anchored down the
// pylon's head to the deck's edges either side; the approaches on concrete piers.
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, crossBeams, railing, block, taper, memberSO } from './parts.js';

export function buildStayed(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const conc = M.concrete(S.conc ?? 0xb9b6ae), concD = M.concrete(S.concD ?? 0x9a978f), steel = M.paint(S.steel), asph = M.asphalt();
  const lw = M.lineWhite(), ly = M.lineYellow(), stay = M.cable(S.stayHex ?? 0xe4e4df, { px: 0.0001 }), red = M.glow(0xff2a1a, 3.0), lamp = M.glow(0xffe0a8, 2.0);
  const litConc = M.paint(S.conc ?? 0xb9b6ae, { flood: { y0: 5, y1: S.pylonH, k: 1.1 }, rough: 0.85, metal: 0 });
  const y = (s) => F.yAt(s), half = S.width / 2, decks = [0, ...(lay.twin ? [lay.twin] : [])];
  const pyl = lay.towers.map((t) => t.s);
  for (const oc of decks) {
    const o = (v) => oc + v;
    // the deck: edge girders, floor beams, the slab and roadway, barriers, lamps
    for (const sg of [-1, 1]) slab(bag, F, steel, 0, F.L, o(sg * (half - 0.4)) - 0.4, o(sg * (half - 0.4)) + 0.4, (s) => y(s) - 0.3, 2.4, 8, { top: false });
    crossBeams(bag, F, steel, 0, F.L, 4.6, o(-half + 0.3), o(half - 0.3), (s) => y(s) - 0.3, 0.35, 1.6);
    slab(bag, F, conc, 0, F.L, o(-half), o(half), (s) => y(s) - 0.05, 0.3, 6, { top: false });
    slab(bag, F, asph, 0, F.L, o(-half + 0.6), o(half - 0.6), y, 0.06, 6, { bottom: false });
    const lanes = S.lanes, lw0 = (2 * half - 2.4) / lanes, lines = [{ o: o(-half + 0.9), w: 0.12, yellow: true }, { o: o(half - 0.9), w: 0.12 }];
    for (let k = 1; k < lanes; k++) lines.push({ o: o(-half + 1.2 + k * lw0), w: 0.11, dash: [3.05, 9.15] });
    laneLines(bag, F, lw, ly, 0, F.L, y, lines);
    for (const sg of [-1, 1]) slab(bag, F, conc, 0, F.L, o(sg * half) - (sg > 0 ? 0.55 : 0), o(sg * half) + (sg > 0 ? 0 : 0.55), (s) => y(s) + 0.85, 0.9, 6);
    if (!bag.lod) for (let s = 20; s < F.L - 10; s += 40) { const p = F.P(s, o(half - 0.3), y(s) + 0.85); bag.rod(steel, p, [p[0], p[1] + 9, p[2]], 0.1, 6, 0.07, true); bag.rod(lamp, [p[0], p[1] + 9, p[2]], [p[0], p[1] + 9.25, p[2]], 0.26, 8, 0.26, true); }
    // the pylons and their stays
    for (const sp of pyl) {
      const g = F.groundAt(sp), base = g === null ? -3 : g - 0.5, yH = S.pylonH;
      if (g === null) taper(bag, F, concD, sp, o(0), base, 3.0, 9, half + 6, 8.5, half + 5.5);
      for (const sg of [-1, 1]) taper(bag, F, litConc, sp, o(sg * (half + 1.8)), 3.0, yH, 2.6, 1.6, 1.6, 1.0);
      block(bag, F, concD, sp - 2.2, sp + 2.2, o(-half - 2.6), o(half + 2.6), y(sp) - 4.2, y(sp) - 1.6);
      if (S.headStrut !== false) block(bag, F, concD, sp - 1.4, sp + 1.4, o(-half - 2.2), o(half + 2.2), yH - 9, yH - 6.5);
      for (const sg of [-1, 1]) { const p = F.P(sp, o(sg * (half + 1.8)), yH); bag.rod(red, p, [p[0], p[1] + 0.5, p[2]], 0.3, 8, 0.3, true); }
      // the stays: S.stays a side of each pylon, anchored 1.4 m apart down the head, landing every S.stayStep
      for (const dir of [-1, 1]) for (let k = 1; k <= S.stays; k++) {
        const sd = sp + dir * (8 + k * S.stayStep);
        if (sd < 2 || sd > F.L - 2) continue;
        const yA = yH - 2.5 - (S.stays - k) * 1.4;
        for (const sg of [-1, 1]) bag.rod(stay, F.P(sp + dir * 0.6, o(sg * (half + 1.8)), yA), F.P(sd, o(sg * (half - 0.2)), y(sd) + 0.6), 0.09, 6);
      }
    }
    // the approach piers: two columns and a cap every 45 m off the main span, out of the streets
    const under = (rec.under || []).filter((u) => u[2] < 0.5), free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
    const s0 = Math.min(...pyl) - S.back, s1 = Math.max(...pyl) + S.back;
    for (let s = 15; s < F.L - 5; s += 45) {
      if (s > s0 && s < s1) continue;
      if (!free(s)) continue;
      const g = F.groundAt(s), base = g === null ? -3 : g - 0.5, top = y(s) - 2.8;
      if (top - base < 2.5) continue;
      for (const sg of [-1, 1]) taper(bag, F, conc, s, o(sg * half * 0.55), base, top, 1.3, 1.3, 1.1, 1.1);
      block(bag, F, conc, s - 1.4, s + 1.4, o(-half + 0.5), o(half - 0.5), top - 1.4, top);
    }
    // the main span's end piers (the back spans' anchor piers)
    for (const s of [s0, s1]) {
      if (s < 2 || s > F.L - 2) continue;
      const g = F.groundAt(s), base = g === null ? -3 : g - 0.5;
      block(bag, F, conc, s - 2.5, s + 2.5, o(-half), o(half), base, y(s) - 2.7);
    }
    void railing;
  }
}

// the Goethals Bridge (2017): twin cable-stayed spans, 900 ft (274 m) between pylons of 272 ft (83 m) (OSM's supports, a
// pair a pylon line, 31 m apart), three lanes each; 135 ft of clearance
export const buildGoethals = (rec, bag) => buildStayed(rec, bag, { steel: 0x8a9095, conc: 0xbdbab2, width: 18.0, lanes: 3, pylonH: 83, stays: 18, stayStep: 7.0, back: 90 });
// the Kosciuszko Bridge (2017, 2019): two parallel cable-stayed spans of ~600 ft (183 m) between towers of ~287 ft (87.5 m)
// (each span its own pair, the record's twin deck 28 m across), each tower two slender concrete legs outside its deck's edges
export const buildKosciuszko = (rec, bag) => buildStayed(rec, bag, { steel: 0x8d9398, conc: 0xc9c6bf, concD: 0xaaa79f, width: 24.0, lanes: 4, pylonH: 91, stays: 15, stayStep: 5.6, back: 91, headStrut: false });

