// The modern suspension bridges (the Verrazzano-Narrows, the Throgs Neck, the Bronx-Whitestone, the George Washington):
// one builder, the bridge's own spec (br/specs.js) choosing its deck, its towers' form, its cables and anchorages.
// Stations and heights come from the record's layout (tools/pipeline/bridges.mjs): the towers on their ENC piers, the
// main and side spans, the roadway's profile.
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, cableY, suspenders, block, taper, memberSO } from './parts.js';

export function buildSuspension(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const mat = {
    steel: M.paint(S.steel), steelD: M.paint(S.steelD ?? S.steel),
    // (the towers floodlit after dark)
    tower: S.towerMat === 'concrete' ? M.concrete(S.towerHex) : M.paint(S.towerHex ?? S.steel, { flood: { y0: 5, y1: S.towerTop, k: 1.25 } }),
    conc: M.concrete(S.conc ?? 0xa7a399), concD: M.concrete(S.concD ?? 0x8f8b82), asph: M.asphalt(), lw: M.lineWhite(), ly: M.lineYellow(),
    lamp: M.glow(0xffe0a8, 2.0), neck: M.glow(S.necklace ?? 0xf4f1e6, 2.6), red: M.glow(0xff2a1a, 3.0),
    cable: M.cable(S.steel, { px: 0.0003 }), hang: M.cable(S.steelD ?? S.steel, { px: 0.00008 }),
  };
  const [sA, sB] = lay.main, [anA, anB] = lay.anchorages.map((a) => a.s), towersS = [sA, sB];
  const y = (s) => F.yAt(s);
  const s0 = Math.max(0, anA), s1 = Math.min(F.L, anB);
  const D = S.deck;
  // ---- towers (the deck passes between the legs)
  for (const sT of towersS) tower(bag, F, sT, S, mat);
  // ---- the suspended deck from anchorage to anchorage
  deck(bag, F, s0, s1, D, mat, towersS, S);
  // ---- cables and suspenders
  const saddleY = S.saddle;
  for (const [i, oc] of S.cables.entries()) {
    const midY = D.top(y(lay.mid)) + (S.cableClear ?? 1.4) + i * 0.02;
    const sup = [[anA, D.anchorY(y(anA))], [sA, saddleY], [sB, saddleY], [anB, D.anchorY(y(anB))]];
    const fMain = saddleY - midY;
    const fSide = S.sideSag ?? fMain * ((anA > 0 ? sA - anA : 370) / (sB - sA)) ** 2;
    const cy = cableY(sup, [fSide, fMain, fSide]);
    for (const sg of [-1, 1]) {
      const o = sg * oc;
      bag.tube(mat.cable, F.range(anA, anB, 4).map((s) => F.P(s, o, cy(s))), S.cableR, 12);
      // cable bands and suspenders every S.hanger, to the truss's top chord (a bracket out to the cable's plane)
      for (const [a, b] of cut(anA + 8, anB - 8, towersS.map((t) => [t - S.legAlong / 2 - 3, t + S.legAlong / 2 + 3]))) {
        suspenders(bag, F, mat.hang, cy, (s) => D.top(y(s)), o, a, b, S.hanger, 0.05, mat.steel, S.cableR + 0.08);
      }
      for (let s = anA + S.neckStep / 2; s < anB; s += S.neckStep) {
        if (towersS.some((t) => Math.abs(s - t) < 6)) continue;
        const p = F.P(s, o, cy(s) + S.cableR + 0.16);
        bag.rod(mat.neck, [p[0], p[1] - 0.1, p[2]], [p[0], p[1] + 0.14, p[2]], 0.16, 6, 0.16, true);
      }
    }
  }
  // ---- anchorages, approach viaducts
  for (const [sAn, away] of [[anA, -1], [anB, 1]]) anchorage(bag, F, sAn, away, S, mat);
  const anchorLen = S.anchorage.L;
  for (const [a, b] of [[0, Math.max(0, anA - anchorLen)], [Math.min(F.L, anB + anchorLen), F.L]]) approach(bag, F, a, b, rec, S, mat);
  // the deck over the anchorages: the upper roadway carried on to the approach
  for (const [a, b] of [[Math.max(0, anA - anchorLen), anA], [anB, Math.min(F.L, anB + anchorLen)]]) roadway(bag, F, a, b, S, mat, y);
}

export function cut(s0, s1, holes) {
  let runs = [[s0, s1]];
  for (const [h0, h1] of holes) {
    const out = [];
    for (const [a, b] of runs) {
      if (h1 <= a || h0 >= b) { out.push([a, b]); continue; }
      if (h0 > a) out.push([a, h0]);
      if (h1 < b) out.push([h1, b]);
    }
    runs = out;
  }
  return runs.filter(([a, b]) => b - a > 0.5);
}

// the roadway(s) of a deck between a and b on ytop(s): slab, lines, barriers and a central median barrier
function roadway(bag, F, a, b, S, mat, ytop) {
  const D = S.deck, half = D.road;
  slab(bag, F, mat.asph, a, b, -half, half, ytop, 0.3, 6);
  const lanes = D.lanes, lw = (half - 0.8) / lanes, lines = [];
  for (const sg of [-1, 1]) {
    lines.push({ o: sg * 0.75, w: 0.12, yellow: true }, { o: sg * (half - 0.4), w: 0.12 });
    for (let k = 1; k < lanes; k++) lines.push({ o: sg * (0.6 + k * lw), w: 0.11, dash: [3.05, 9.15] });
  }
  laneLines(bag, F, mat.lw, mat.ly, a, b, ytop, lines);
  for (const sg of [-1, 1]) railing(bag, F, mat.steelD, a, b, sg * (half + 0.1), ytop, 1.07, 2.4, 0.09);
  // the median: a concrete safety-shape barrier
  if (!bag.lod) slab(bag, F, mat.conc, a, b, -0.3, 0.3, (s) => ytop(s) + 0.81, 0.82, 6);
  // roadway lights on the median every 36 m, a pair of arms over both roadways (their heads lit after dark; the coarse
  // level keeps the heads, which make the deck's line of lights from afar)
  for (let s = a + 18; s < b - 6; s += 36) {
    const p = F.P(s, 0, ytop(s) + 0.82);
    if (!bag.lod) bag.rod(mat.steelD, p, [p[0], p[1] + 9.0, p[2]], 0.11, 6, 0.08, true);
    for (const sg of [-1, 1]) {
      const h = F.P(s, sg * 2.6, ytop(s) + 9.6);
      if (!bag.lod) bag.rod(mat.steelD, [p[0], p[1] + 9.0, p[2]], h, 0.06, 4);
      bag.rod(mat.lamp, [h[0], h[1] - 0.15, h[2]], [h[0], h[1] + 0.05, h[2]], 0.28, 6, 0.28, true);
    }
  }
}

// the suspended deck: S.deck.kind 'double' (roadways at the stiffening trusses' top and bottom chords, the trusses at the
// edges), 'under' (one roadway over trusses under it) or 'girder' (one roadway on plate girders with fairings)
function deck(bag, F, s0, s1, D, mat, towersS, S) {
  const y = (s) => F.yAt(s);
  const runs = [[s0, s1]];   // the deck runs on between the legs of each tower
  if (D.kind === 'double') {
    const top = (s) => y(s) - 0.35, bot = (s) => y(s) - 0.35 - D.depth;
    for (const [a, b] of runs) for (const sg of [-1, 1]) truss(bag, F, mat.steel, a, b, sg * D.truss, top, bot, D.panel, 'warrenV', { chord: [0.9, 1.0], vert: [0.55, 0.55], diag: [0.55, 0.65] });
    for (const [a, b] of runs) {
      roadway(bag, F, a, b, S, mat, y);
      roadway(bag, F, a, b, S, mat, (s) => y(s) - D.depth + 0.6);
      crossBeams(bag, F, mat.steelD, a, b, D.panel / 2, -D.truss, D.truss, (s) => y(s) - 0.3, 0.4, 1.4);
      crossBeams(bag, F, mat.steelD, a, b, D.panel / 2, -D.truss, D.truss, (s) => y(s) - D.depth + 0.3, 0.45, 1.6);
      lateralX(bag, F, mat.steelD, a, b, D.panel * 2, -D.truss, D.truss, (s) => bot(s) - 0.6, 0.3);
      // sway frames between the decks every other panel, clear of the lower roadway's lanes (at its edges)
      if (!bag.lod) for (const s of F.range(a, b, D.panel * 2)) for (const sg of [-1, 1]) memberSO(bag, F, mat.steelD, s, sg * D.truss, bot(s) + 1.2, s, sg * (D.road + 0.2), top(s) - 1.0, 0.3, 0.35);
      // the deck's fascia: the floor's edge stringer along each side (it closes the deck's silhouette)
      for (const sg of [-1, 1]) for (const yy of [(s) => y(s) - 0.9, (s) => y(s) - D.depth - 0.1]) slab(bag, F, mat.steel, a, b, sg > 0 ? D.truss + 0.5 : -D.truss - 0.9, sg > 0 ? D.truss + 0.9 : -D.truss - 0.5, yy, 1.1, 8);
    }
  } else if (D.kind === 'under') {
    const top = (s) => y(s) - 0.5, bot = (s) => y(s) - 0.5 - D.depth;
    for (const [a, b] of runs) {
      for (const sg of [-1, 1]) truss(bag, F, mat.steel, a, b, sg * D.truss, top, bot, D.panel, 'warrenV', { chord: [0.8, 0.9], vert: [0.5, 0.5], diag: [0.5, 0.55] });
      roadway(bag, F, a, b, S, mat, y);
      crossBeams(bag, F, mat.steelD, a, b, D.panel, -D.truss, D.truss, (s) => y(s) - 0.35, 0.45, 1.5);
      crossBeams(bag, F, mat.steelD, a, b, D.panel, -D.truss, D.truss, (s) => bot(s) + 0.6, 0.4, 0.8);
      lateralX(bag, F, mat.steelD, a, b, D.panel * 2, -D.truss, D.truss, (s) => bot(s) + 0.4, 0.3);
      lateralX(bag, F, mat.steelD, a, b, D.panel * 2, -D.truss, D.truss, (s) => top(s) - 1.6, 0.25);
      // the cross frames (a K in each panel)
      if (!bag.lod) for (const s of F.range(a, b, D.panel)) { memberSO(bag, F, mat.steelD, s, -D.truss, bot(s) + 0.8, s, 0, top(s) - 1.6, 0.25, 0.3); memberSO(bag, F, mat.steelD, s, D.truss, bot(s) + 0.8, s, 0, top(s) - 1.6, 0.25, 0.3); }
      // the deck's overhang: the slab out past the trusses to the cable planes, its edge beam
      for (const sg of [-1, 1]) slab(bag, F, mat.steel, a, b, sg > 0 ? D.road : -D.road - 0.6, sg > 0 ? D.road + 0.6 : -D.road, (s) => y(s) - 0.1, 1.2, 8);
    }
  } else {   // 'girder'
    for (const [a, b] of runs) {
      roadway(bag, F, a, b, S, mat, y);
      for (const sg of [-1, 1]) {
        const o = sg * D.truss;
        // the plate girder (a web 3.4 m deep with its flanges) and the triangular fairing outside it
        slab(bag, F, mat.steel, a, b, o - 0.25, o + 0.25, (s) => y(s) - 0.2, D.depth, 6);
        slab(bag, F, mat.steel, a, b, o - 0.55, o + 0.55, (s) => y(s) - 0.2, 0.45, 6, { sides: true });
        slab(bag, F, mat.steel, a, b, o - 0.55, o + 0.55, (s) => y(s) - 0.2 - D.depth + 0.45, 0.45, 6);
        if (D.fairing) for (const [fa, fb] of cut(a, b, towersS.map((t) => [t - S.legAlong / 2 - 1.5, t + S.legAlong / 2 + 1.5]))) fairing(bag, F, mat.steel, fa, fb, o, sg, y, D);
      }
      crossBeams(bag, F, mat.steelD, a, b, 5.0, -D.truss, D.truss, (s) => y(s) - 0.3, 0.4, 1.6);
      lateralX(bag, F, mat.steelD, a, b, 10, -D.truss, D.truss, (s) => y(s) - 2.4, 0.25);
    }
  }
}
// the Bronx-Whitestone's fairing: a triangular nose outside each girder (fibreglass panels, 2003)
function fairing(bag, F, mat, a, b, o, sg, y, D) {
  const ss = F.range(a, b, 6);
  const top = (s) => y(s) - 0.15, mid = (s) => y(s) - D.depth * 0.55, low = (s) => y(s) - D.depth + 0.1, tip = o + sg * 3.2;
  for (let i = 0; i + 1 < ss.length; i++) {
    const p = ss[i], q = ss[i + 1];
    bag.quad(mat, F.P(p, o, top(p)), F.P(q, o, top(q)), F.P(q, tip, mid(q)), F.P(p, tip, mid(p)), null);
    bag.quad(mat, F.P(p, tip, mid(p)), F.P(q, tip, mid(q)), F.P(q, o, low(q)), F.P(p, o, low(p)), null);
  }
}

// a tower: its pier, two legs (box legs tapering, or lattice legs) battered so the deck passes between them, the struts
// (with arched soffits where the spec says), the saddles over the legs' tops, red aviation lights on the top
function tower(bag, F, sT, S, mat) {
  const T = S.towerForm, yDeck = F.yAt(sT);
  const g = F.groundAt(sT), base = g === null ? 0 : g;
  // the pier (a caisson's top with rounded ends at the water, a plinth on land)
  if (g === null) {
    taper(bag, F, mat.concD, sT, 0, -4, 1.5, S.pier.along / 2, S.pier.across / 2 - S.pier.along / 4, S.pier.along / 2 - 0.4, S.pier.across / 2 - S.pier.along / 4 - 0.4);
    for (const sg of [-1, 1]) taper(bag, F, mat.concD, sT, sg * (S.pier.across / 2 - S.pier.along / 4), -4, 1.5, S.pier.along * 0.36, S.pier.along / 4, S.pier.along * 0.33, S.pier.along / 4 - 0.4);
  }
  const y0 = (g === null ? 1.5 : base - 0.5), yTop = S.towerTop;
  // the legs: their footprint (along x across) tapers with height; the centre line leans so the leg stands over its
  // cable plane at the top (oTop) and clears the deck's truss by 0.7 m at the roadway
  const size = (yy) => {
    const f = Math.max(0, Math.min(1, (yy - T.plinthTop) / (yTop - T.plinthTop)));
    return [T.along0 + (T.along1 - T.along0) * f, T.across0 + (T.across1 - T.across0) * f];
  };
  const D = S.deck, edge = D.kind === 'girder' ? D.truss + 0.6 : D.kind === 'under' ? Math.max(D.truss + 0.45, D.road + 0.6) : D.truss + 0.9;
  const oDeck = edge + 0.5 + size(yDeck)[1] / 2;
  const leg = (yy) => {
    const [along, across] = size(yy);
    return { along, across, o: T.oTop + ((oDeck - T.oTop) * (yTop - yy)) / (yTop - yDeck) };
  };
  for (const sg of [-1, 1]) for (const lp of legPlinth(T, S, leg)) taper(bag, F, mat.concD, sT, sg * lp.o, y0, T.plinthTop, lp.a, lp.b, lp.a - 0.3, lp.b - 0.3);
  if (T.kind === 'box') {
    const N = 10;
    for (const sg of [-1, 1]) for (let i = 0; i < N; i++) {
      const ya = T.plinthTop + ((yTop - T.plinthTop) * i) / N, yb = T.plinthTop + ((yTop - T.plinthTop) * (i + 1)) / N;
      const la = leg(ya), lb = leg(yb);
      taperO(bag, F, mat.tower, sT, sg * la.o, sg * lb.o, ya, yb, la.along / 2, la.across / 2, lb.along / 2, lb.across / 2);
      // the legs' flutes: a recessed groove line up the outer face as a slim proud rib each side of it
      if (!bag.lod) for (const k of [-1, 1]) block(bag, F, mat.tower, sT + k * (la.along / 2 - 1.1) - 0.15, sT + k * (la.along / 2 - 1.1) + 0.15, sg * (la.o + la.across / 2) - (sg > 0 ? 0 : 0.18), sg * (la.o + la.across / 2) + (sg > 0 ? 0.18 : 0), ya, yb);
    }
  } else {   // 'lattice' (the George Washington): each leg four chords laced on every face
    for (const sg of [-1, 1]) latticeLeg(bag, F, mat, sT, sg, T, leg, yTop);
  }
  // struts: [y0, y1, arch?] across between the legs' inner faces (solid, or a laced portal for a lattice tower)
  for (const st of T.struts) {
    if (st.band || st.posts) {
      // the RFK's towers: a band of X lattice between chords (n panels a face, on both faces of the tower), with an arched
      // rib under it (st.arch: its rise, springing from the legs' inner faces); or a row of n slim posts between two
      // bands, with a tie across at st.tie
      const lA = leg(st.y0), lB = leg(st.y1), hA = lA.o - lA.across / 2 + 0.3, hB = lB.o - lB.across / 2 + 0.3;
      const fs = [-1, 1].map((f) => sT + f * (Math.min(lA.along, lB.along) / 2 - 0.6));
      const O = (h, i, n) => -h + (2 * h * i) / n;
      for (const s of fs) {
        if (st.band) {
          for (const [yy, h] of [[st.y0 + 0.45, hA], [st.y1 - 0.45, hB]]) memberSO(bag, F, mat.tower, s, -h, yy, s, h, yy, 0.9, 1.0);
          for (let i = 0; i < st.n; i++) {
            const a0 = O(hA, i, st.n), a1 = O(hA, i + 1, st.n), b0 = O(hB, i, st.n), b1 = O(hB, i + 1, st.n);
            memberSO(bag, F, mat.tower, s, a0, st.y0 + 0.9, s, b1, st.y1 - 0.9, 0.55, 0.6);
            memberSO(bag, F, mat.tower, s, a1, st.y0 + 0.9, s, b0, st.y1 - 0.9, 0.55, 0.6);
            if (i) memberSO(bag, F, mat.tower, s, a0, st.y0 + 0.9, s, b0, st.y1 - 0.9, 0.4, 0.5);
          }
          if (st.arch) {
            const N = 16, ys = st.y0 - st.arch;
            let prev = null;
            for (let k = 0; k <= N; k++) {
              const a = Math.PI - (Math.PI * k) / N, o = hA * Math.cos(a), yy = ys + st.arch * Math.sin(a) - 0.45;
              if (prev) memberSO(bag, F, mat.tower, s, prev[0], prev[1], s, o, yy, 0.9, 0.8);
              prev = [o, yy];
            }
          }
        } else {
          for (let i = 1; i <= st.n; i++) { const oa = O(hA, i, st.n + 1), ob = O(hB, i, st.n + 1); memberSO(bag, F, mat.tower, s, oa, st.y0, s, ob, st.y1, 0.45, 0.6); }
          if (st.tie) { const lt = leg(st.tie), ht = lt.o - lt.across / 2 + 0.3; memberSO(bag, F, mat.tower, s, -ht, st.tie, s, ht, st.tie, 0.4, 0.55); }
        }
      }
      // the bands' cross ties through the tower's thickness at the chords
      if (st.band) for (const [yy, h] of [[st.y0 + 0.45, hA], [st.y1 - 0.45, hB]]) for (let i = 0; i <= st.n; i++) { const o = O(h, i, st.n); memberSO(bag, F, mat.steelD, fs[0], o, yy, fs[1], o, yy, 0.35, 0.4); }
      continue;
    }
    if (st.x) {   // a panel of simple cross bracing between the legs (the RFK's towers), struts at its top and bottom
      const lA = leg(st.y0), lB = leg(st.y1), hA = lA.o - lA.across / 2 + 0.4, hB = lB.o - lB.across / 2 + 0.4;
      for (const f of [-1, 1]) {
        const s = sT + f * (Math.min(lA.along, lB.along) / 2 - 0.8);
        memberSO(bag, F, mat.tower, s, -hA, st.y0, s, hB, st.y1, 1.0, 1.2);
        memberSO(bag, F, mat.tower, s, hA, st.y0, s, -hB, st.y1, 1.0, 1.2);
      }
      for (const [yy, h] of [[st.y0, hA], [st.y1, hB]]) block(bag, F, mat.tower, sT - lA.along / 2 + 0.8, sT + lA.along / 2 - 0.8, -h, h, yy - 1.0, yy + 1.0);
      continue;
    }
    if (st.lattice) {
      const yy0 = st.y0, yy1 = st.y1, l = leg((yy0 + yy1) / 2), half = l.o - l.across / 2 + 0.6;
      latticePortal(bag, F, mat, sT, half, yy0, yy1, st.arch || 0, l.along - 2.0);
      continue;
    }
    const yy0 = st.y0 === 'deck' ? yDeck - S.deck.depth - 6 : st.y0, yy1 = st.y1 === 'deck' ? yDeck - S.deck.depth - 1.5 : st.y1;
    const l = leg((yy0 + yy1) / 2), half = l.o - l.across / 2 + 0.6;
    block(bag, F, mat.tower, sT - l.along / 2 + 0.6, sT + l.along / 2 - 0.6, -half, half, yy0, yy1);
    if (st.arch) archSoffit(bag, F, mat.tower, sT, half, yy0, st.arch, l.along - 1.2);
  }
  // saddle housings and the aviation lights on the legs' tops
  for (const sg of [-1, 1]) {
    const l = leg(yTop);
    block(bag, F, mat.steelD, sT - l.along / 2 + 0.3, sT + l.along / 2 - 0.3, sg * l.o - l.across / 2 - 0.2, sg * l.o + l.across / 2 + 0.2, yTop, yTop + 1.2);
    for (const oc of S.cables) block(bag, F, mat.steelD, sT - 3.5, sT + 3.5, sg * oc - 1.2, sg * oc + 1.2, yTop + 1.2, S.saddle + 0.4);
    const p = F.P(sT, sg * l.o, yTop + 1.2);
    if (S.lantern) {   // the RFK's Art Deco lanterns over the saddles (30 ft), red lights in their heads
      bag.rod(mat.steelD, p, [p[0], p[1] + 6.0, p[2]], 1.2, 8, 0.9, true);
      bag.rod(mat.lamp, [p[0], p[1] + 6.0, p[2]], [p[0], p[1] + 7.6, p[2]], 0.8, 8, 0.8, true);
      bag.rod(mat.steelD, [p[0], p[1] + 7.6, p[2]], [p[0], p[1] + 9.0, p[2]], 1.0, 8, 0.1, true);
      bag.rod(mat.red, [p[0], p[1] + 9.0, p[2]], [p[0], p[1] + 9.5, p[2]], 0.3, 8, 0.3, true);
    } else {
      bag.rod(mat.steelD, p, [p[0], p[1] + 2.5, p[2]], 0.12, 6);
      bag.rod(mat.red, [p[0], p[1] + 2.5, p[2]], [p[0], p[1] + 3.0, p[2]], 0.3, 8, 0.3, true);
    }
  }
}
function legPlinth(T, S, leg) { void S; const l = leg(T.plinthTop); return [{ o: l.o, a: l.along / 2 + 1.0, b: l.across / 2 + 1.0 }]; }
// a tapering block whose centre moves across (o0 at y0 to o1 at y1)
function taperO(bag, F, mat, s, o0, o1, y0, y1, a0, b0, a1, b1) {
  const fr = F.at(s), t = fr.t, n = fr.n, c0 = F.P(s, o0, 0), c1 = F.P(s, o1, 0);
  const P = (c, a, b, yy) => [c[0] + t[0] * a + n[0] * b, yy, c[2] + t[2] * a + n[2] * b];
  const lo = [P(c0, -a0, -b0, y0), P(c0, a0, -b0, y0), P(c0, a0, b0, y0), P(c0, -a0, b0, y0)];
  const hi = [P(c1, -a1, -b1, y1), P(c1, a1, -b1, y1), P(c1, a1, b1, y1), P(c1, -a1, b1, y1)];
  const cx = (c0[0] + c1[0]) / 2, cz = (c0[2] + c1[2]) / 2;
  bag.hold([cx, (y0 + y1) / 2, cz], () => {
    bag.poly(mat, hi, [0, 1, 0]);
    bag.poly(mat, lo.slice().reverse(), [0, -1, 0]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mx = (lo[i][0] + lo[j][0] + hi[i][0] + hi[j][0]) / 4 - cx, mz = (lo[i][2] + lo[j][2] + hi[i][2] + hi[j][2]) / 4 - cz;
      const e = [lo[j][0] - lo[i][0], lo[j][1] - lo[i][1], lo[j][2] - lo[i][2]], up = [hi[i][0] - lo[i][0], hi[i][1] - lo[i][1], hi[i][2] - lo[i][2]];
      let nn = [e[1] * up[2] - e[2] * up[1], e[2] * up[0] - e[0] * up[2], e[0] * up[1] - e[1] * up[0]];
      const l = Math.hypot(...nn) || 1; nn = nn.map((v) => v / l);
      if (nn[0] * mx + nn[2] * mz < 0) nn = nn.map((v) => -v);
      bag.quad(mat, lo[i], lo[j], hi[j], hi[i], nn);
    }
  });
}
// a strut's arched soffit: the haunches under a strut spanning +-half, a semicircle of radius `rise`... drawn as an
// extruded quarter-round fillet at each end (the opening between them stays open)
function archSoffit(bag, F, mat, sT, half, yStrut, rise, depth) {
  const fr = F.at(sT), m = new THREE.Matrix4();
  m.makeBasis(new THREE.Vector3(...fr.n), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...fr.t));
  const p = F.P(sT, 0, 0);
  m.setPosition(p[0] - fr.t[0] * depth / 2, 0, p[2] - fr.t[2] * depth / 2);
  const sh = new THREE.Shape();
  const R = half, ys = yStrut - rise;   // a half ellipse springing `rise` under the strut, its crown 0.3 m under it
  sh.moveTo(-half, yStrut);
  sh.lineTo(-half, ys);
  const N = 18;
  for (let i = 0; i <= N; i++) { const a = Math.PI - (Math.PI * i) / N; sh.lineTo(R * Math.cos(a), ys + (rise - 0.3) * Math.sin(a)); }
  sh.lineTo(half, yStrut);
  sh.lineTo(-half, yStrut);
  // the filled part is between the arch and the strut: the shape above the curve
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 4 });
  bag.addGeometry(mat, g, m);
}
// a laced portal between the legs (the George Washington Bridge's top): a grid of chords and posts every ~6 m crossed
// with X bracing, on both faces of the tower, the cells inside the arch left open, the arch's rib round its opening
function latticePortal(bag, F, mat, sT, half, y0, y1, rise, depth) {
  const nx = Math.max(2, Math.round((2 * half) / 6.2)), ny = Math.max(1, Math.round((y1 - y0) / 6.2));
  const ys = y0, R = half;   // the arch springs at y0 from the legs' inner faces, its crown at y0 + rise
  const inArch = (o, yy) => rise > 0 && yy < ys + rise * Math.sqrt(Math.max(0, 1 - (o / R) ** 2)) - 0.4;
  for (const f of [-1, 1]) {
    const s = sT + f * (depth / 2);
    const O = (i) => -half + (2 * half * i) / nx, Y = (j) => y0 + ((y1 - y0) * j) / ny;
    for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const oa = O(i), ob = O(i + 1), yy = Y(j);
      if (inArch(oa, yy) && inArch(ob, yy)) continue;
      memberSO(bag, F, mat.tower, s, oa, yy, s, ob, yy, 0.8, 0.9);
    }
    for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) {
      const o = O(i), ya = Y(j), yb = Y(j + 1);
      if (inArch(o, ya) && inArch(o, yb)) continue;
      memberSO(bag, F, mat.tower, s, o, inArch(o, ya) ? ys + rise * Math.sqrt(Math.max(0, 1 - (o / R) ** 2)) : ya, s, o, yb, 0.75, 0.75);
    }
    if (!bag.lod) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const oa = O(i), ob = O(i + 1), ya = Y(j), yb = Y(j + 1);
      if (inArch((oa + ob) / 2, (ya + yb) / 2) || inArch(oa, ya) || inArch(ob, ya)) continue;
      memberSO(bag, F, mat.steelD, s, oa, ya, s, ob, yb, 0.4, 0.45);
      memberSO(bag, F, mat.steelD, s, ob, ya, s, oa, yb, 0.4, 0.45);
    }
    // the arch's rib
    if (rise > 0) {
      const N = 20;
      for (let k = 0; k < N; k++) {
        const a0 = Math.PI - (Math.PI * k) / N, a1 = Math.PI - (Math.PI * (k + 1)) / N;
        memberSO(bag, F, mat.tower, s, R * Math.cos(a0), ys + rise * Math.sin(a0), s, R * Math.cos(a1), ys + rise * Math.sin(a1), 1.1, 1.4);
      }
    }
  }
  // the two faces tied across the tower's depth at the top chord
  for (let i = 0; i <= nx; i++) { const o = -half + (2 * half * i) / nx; memberSO(bag, F, mat.tower, sT - depth / 2, o, y1, sT + depth / 2, o, y1, 0.7, 0.8); }
}
// a lattice leg (George Washington Bridge): four chords following the leg's taper, laced in X on all four faces
function latticeLeg(bag, F, mat, sT, sg, T, leg, yTop) {
  const levels = [];
  for (let yy = T.plinthTop; yy < yTop - 0.1; yy += T.panel) levels.push(yy);
  levels.push(yTop);
  const P = (yy, i, j) => { const l = leg(yy); return [sT + j * (l.along / 2 - 0.7), sg * (l.o + i * (l.across / 2 - 0.7)), yy]; };
  for (let k = 0; k + 1 < levels.length; k++) {
    const ya = levels[k], yb = levels[k + 1];
    for (const i of [-1, 1]) for (const j of [-1, 1]) { const a = P(ya, i, j), b = P(yb, i, j); memberSO(bag, F, mat.tower, a[0], a[1], a[2], b[0], b[1], b[2], 1.4, 1.4); }
    if (bag.lod) continue;
    for (const [i0, j0, i1, j1] of [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]]) {
      const a0 = P(ya, i0, j0), a1 = P(ya, i1, j1), b0 = P(yb, i0, j0), b1 = P(yb, i1, j1);
      memberSO(bag, F, mat.steelD, a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], 0.45, 0.5);
      memberSO(bag, F, mat.steelD, a1[0], a1[1], a1[2], b0[0], b0[1], b0[2], 0.45, 0.5);
      memberSO(bag, F, mat.tower, b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], 0.6, 0.7);
    }
  }
}

// an anchorage: a battered concrete mass from its river face (sAn) away from the water, the deck on its top, a sloping
// back; the cable bents (the splay saddles' housings) on its river face
function anchorage(bag, F, sAn, away, S, mat) {
  const A = S.anchorage, sc = sAn + (away * A.L) / 2, yD = F.yAt(sc) - S.deck.depth - 1.2;
  const g = Math.max(0, F.groundAt(sc) ?? 3.2);
  taper(bag, F, mat.conc, sc, 0, g - 1, yD * 0.72, A.L / 2, A.W / 2, A.L / 2 - 2.5, A.W / 2 - 1.5);
  taper(bag, F, mat.conc, sc - away * A.L * 0.12, 0, yD * 0.72, yD, A.L * 0.38, A.W / 2 - 1.5, A.L * 0.3, A.W / 2 - 2.5);
  // the river face's cable housings: a raised block under each cable plane
  for (const sg of [-1, 1]) for (const oc of S.cables) block(bag, F, mat.concD, sAn + away * 0.5 - 4, sAn + away * 0.5 + 4, sg * oc - 2.2, sg * oc + 2.2, yD - 8, yD + 2.5);
}

// an approach viaduct: the roadway on girders on concrete piers every ~35 m (two columns and a cap), none in the streets
// under the deck; where the deck is low, a filled embankment between walls
function approach(bag, F, a, b, rec, S, mat) {
  if (b - a < 4) return;
  const y = (s) => F.yAt(s), g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  roadway(bag, F, a, b, S, mat, y);
  const half = S.deck.road + 0.4;
  for (const o of [-half + 2, -half / 3, half / 3, half - 2]) for (const [p, q] of pairsOf(F.range(a, b, 8))) bag.beam(mat.steel, F.P(p, o, y(p) - 1.4), F.P(q, o, y(q) - 1.4), 0.6, 2.2);
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (let s = a + 15; s < b - 2; s += 35) {
    let ss = s;
    for (let k = 0; k < 6 && !free(ss); k++) ss += k % 2 ? -k * 4 : k * 4;
    if (!free(ss) || ss < a + 2 || ss > b - 2) continue;
    const h = y(ss) - 2.6 - g(ss);
    if (h < 2.5) continue;
    const cols = S.approachCols || 2;
    for (let c = 0; c < cols; c++) { const o = -half * 0.62 + (1.24 * half * c) / Math.max(1, cols - 1); taper(bag, F, mat.conc, ss, o, g(ss) - 0.5, y(ss) - 2.6, 1.3, 1.3, 1.1, 1.1); }
    block(bag, F, mat.conc, ss - 1.4, ss + 1.4, -half + 0.6, half - 0.6, y(ss) - 4.0, y(ss) - 2.5);
  }
}
function pairsOf(ss) { const out = []; for (let i = 0; i + 1 < ss.length; i++) out.push([ss[i], ss[i + 1]]); return out; }

// ---------------------------------------------------------------- the bridges' specs
// the Verrazzano-Narrows Bridge (Othmar Ammann, 1964; MTA Bridges and Tunnels, HAER NY-303): towers 693 ft (211 m), two
// tapering steel box legs each, joined by a strut with an arched soffit at the top and one under the deck; four cables of
// 36 in (two a side) on 52 ft panels of suspenders; the double deck between Warren stiffening trusses 24 ft (7.3 m)
// deep at its edges, six lanes on each level; the towers' caissons 91 x 62 m (ENC); a pale green-grey paint; necklace lights
// (2016) along the cables
export const VERRAZZANO = {
  steel: 0xbfc9c2, steelD: 0x9ca69f, towerHex: 0xc5cfc8, conc: 0xaba79d, concD: 0x938f86, necklace: 0xf6f2e2,
  deck: { kind: 'double', truss: 16.4, depth: 7.3, panel: 7.62, road: 15.0, lanes: 3, top: (yy) => yy - 0.35, anchorY: (yy) => yy - 3.0 },
  cables: [15.55, 17.25], cableR: 0.457, hanger: 15.85, neckStep: 15.85, cableClear: 1.6,
  saddle: 212.6, towerTop: 211.0, legAlong: 11.5,
  towerForm: { kind: 'box', plinthTop: 7.0, along0: 11.5, along1: 7.2, across0: 7.4, across1: 4.8, oTop: 16.4,
    struts: [{ y0: 192.0, y1: 210.0, arch: 14 }, { y0: 'deck', y1: 'deck' }] },
  pier: { along: 61.6, across: 91.4 },
  anchorage: { L: 92, W: 72 },
};
// the Throgs Neck Bridge (Othmar Ammann, 1961): towers 346 ft (105.5 m), closed boxes with arched struts at the top; two
// cables; two three-lane roadways of 37 ft and a 4 ft barrier over 28 ft (8.5 m) stiffening trusses; anchorages
// 250 x 350 ft
export const THROGS = {
  steel: 0xb9c3c8, steelD: 0x97a1a6, towerHex: 0xc0cace, necklace: 0xf6f2e2,
  deck: { kind: 'under', truss: 11.2, depth: 8.5, panel: 7.62, road: 12.2, lanes: 3, top: (yy) => yy - 0.1, anchorY: (yy) => yy - 4.5 },
  cables: [13.2], cableR: 0.34, hanger: 15.24, neckStep: 15.24, cableClear: 1.8,
  saddle: 106.8, towerTop: 105.5, legAlong: 8.5,
  towerForm: { kind: 'box', plinthTop: 6.0, along0: 8.5, along1: 5.8, across0: 6.0, across1: 4.2, oTop: 13.2,
    struts: [{ y0: 93.0, y1: 105.0, arch: 9 }, { y0: 'deck', y1: 'deck' }] },
  pier: { along: 28.4, across: 74.5 },
  anchorage: { L: 107, W: 76 },
};
// the Bronx-Whitestone Bridge (Othmar Ammann, 1939): towers 377 ft (115 m), two cables 74 ft (22.6 m) apart, the deck on
// 11 ft (3.4 m) plate girders with triangular fairings (2003), six lanes; concrete anchorages 180 x 110 ft
export const WHITESTONE = {
  steel: 0xbcc3c6, steelD: 0x9aa1a4, towerHex: 0xc6cdd0, necklace: 0xf6f2e2,
  deck: { kind: 'girder', truss: 11.3, depth: 3.4, panel: 6.1, road: 10.6, lanes: 3, fairing: true, top: (yy) => yy - 0.2, anchorY: (yy) => yy - 2.0 },
  cables: [11.3], cableR: 0.31, hanger: 9.14, neckStep: 18.3, cableClear: 1.5,
  saddle: 116.2, towerTop: 115.0, legAlong: 9.0,
  towerForm: { kind: 'box', plinthTop: 5.0, along0: 9.0, along1: 6.4, across0: 6.4, across1: 4.4, oTop: 11.3,
    struts: [{ y0: 100.0, y1: 114.5, arch: 11 }, { y0: 'deck', y1: 'deck' }] },
  pier: { along: 14, across: 36 },
  anchorage: { L: 55, W: 34 },
};
export const buildVerrazzano = (rec, bag) => buildSuspension(rec, bag, VERRAZZANO);
export const buildThrogs = (rec, bag) => buildSuspension(rec, bag, THROGS);
export const buildWhitestone = (rec, bag) => buildSuspension(rec, bag, WHITESTONE);

// the George Washington Bridge (Othmar Ammann; Cass Gilbert, architect; 1931, the lower level 1962): main span 3,500 ft
// (1,067 m), side spans 610 ft (New Jersey) and 650 ft (New York); towers 604 ft (184 m) of exposed riveted steel
// (the cladding of concrete and granite was never built), two lattice legs each, a laced portal with a great arch at the
// top; four cables of 36 in, two a side; the double deck between stiffening trusses 29 ft (8.8 m) deep (1962), eight
// lanes over six, the walks outside the trusses; light grey paint
export const GWB = {
  steel: 0xb9bdbc, steelD: 0x979b9a, towerHex: 0xbec2c1, necklace: 0xf6f2e2,
  deck: { kind: 'double', truss: 17.2, depth: 8.8, panel: 7.62, road: 15.6, lanes: 4, top: (yy) => yy - 0.35, anchorY: (yy) => yy - 3.5 },
  cables: [16.0, 18.4], cableR: 0.457, hanger: 15.24, neckStep: 15.24, cableClear: 1.8,
  saddle: 185.6, towerTop: 184.1, legAlong: 21.0,
  towerForm: { kind: 'lattice', plinthTop: 6.0, along0: 21.0, along1: 15.0, across0: 12.4, across1: 9.0, oTop: 17.2, panel: 6.1,
    struts: [{ y0: 148.0, y1: 183.0, arch: 22.0, lattice: true }, { y0: 'deck', y1: 'deck' }] },
  pier: { along: 30, across: 72 },
  anchorage: { L: 90, W: 70 },
};
export const buildGWB = (rec, bag) => buildSuspension(rec, bag, GWB);

// the RFK Bridge's suspension span (Othmar Ammann, 1936): towers 315 ft (96 m), two legs with simple cross bracing,
// Art Deco saddles under 30 ft lanterns with red lights; pale green paint; two cables of 20 in; a 98 ft deck of eight lanes on Warren
// stiffening trusses; the viaducts on piers of three octagonal columns
export const RFK = {
  steel: 0xa9c3bf, steelD: 0x89a39f, towerHex: 0xb3cbc6, necklace: 0xf6f2e2, lantern: true, approachCols: 3,
  deck: { kind: 'under', truss: 13.6, depth: 5.5, panel: 7.0, road: 14.2, lanes: 4, top: (yy) => yy - 0.1, anchorY: (yy) => yy - 3.0 },
  cables: [15.0], cableR: 0.26, hanger: 9.1, neckStep: 18.2, cableClear: 1.5,
  saddle: 97.2, towerTop: 96.0, legAlong: 7.5,
  towerForm: { kind: 'box', plinthTop: 5.0, along0: 7.5, along1: 5.4, across0: 5.4, across1: 3.8, oTop: 15.0,
    // height, a second band over the roadway with an arched rib under it, a strut under the deck)
    struts: [{ band: true, y0: 89.8, y1: 96.0, n: 5 }, { posts: true, y0: 63.0, y1: 89.8, n: 4, tie: 77.3 }, { band: true, y0: 56.7, y1: 63.0, n: 5, arch: 3.7 }, { y0: 'deck', y1: 'deck' }] },
  pier: { along: 16, across: 40 },
  anchorage: { L: 60, W: 42 },
};
export const buildRFK = (rec, bag) => buildSuspension(rec, bag, RFK);
