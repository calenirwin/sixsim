// A cantilever truss bridge of one level (the Outerbridge Crossing), from its spec and the record's multi-span layout
// (tools/pipeline/bridges.mjs layoutSpans: the main piers and the anchor piers from OpenStreetMap's supports).
// Two lines of trusses through which the roadway runs: deepest over the main piers, shallowest at the main span's middle
// (the suspended span) and at the anchor piers; the deck between them on floor beams; concrete piers; steel approaches.
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, crossBeams, lateralX, railing, taper, memberSO, portalPier } from './parts.js';

export function buildCantilever(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), conc = M.concrete(), asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow();
  const lamp = M.glow(0xffe0a8, 2.0), red = M.glow(0xff2a1a, 3.0);
  const piers = lay.piers || lay.towers.map((t) => t.s), [anA, anB] = lay.anchorages.map((a) => a.s);
  const y = (s) => F.yAt(s), bot = (s) => y(s) - 1.6, half = S.width / 2, oT = half + 0.6;
  const sup = [anA, ...piers, anB];
  const isPier = (v) => piers.some((p) => Math.abs(p - v) < 0.5);
  const height = (s) => {
    let k = 0;
    while (k < sup.length - 2 && s > sup[k + 1]) k++;
    const a = sup[k], b = sup[k + 1], t = Math.max(0, Math.min(1, (s - a) / Math.max(1, b - a)));
    if (isPier(a) && isPier(b)) return S.hMid + (S.hPier - S.hMid) * Math.pow(Math.abs(2 * t - 1), 1.6);
    const u = isPier(a) ? 1 - t : t;
    return S.hEnd + (S.hPier - S.hEnd) * Math.pow(u, 1.3);
  };
  const top = (s) => bot(s) + height(s);
  const n = Math.round((anB - anA) / S.panel), dp = (anB - anA) / n, P = (i) => anA + i * dp;
  for (const sg of [-1, 1]) {
    const o = sg * oT;
    for (let i = 0; i < n; i++) {
      const a = P(i), b = P(i + 1);
      memberSO(bag, F, steel, a, o, bot(a) + 0.5, b, o, bot(b) + 0.5, 0.9, 1.0);
      memberSO(bag, F, steel, a, o, top(a) - 0.5, b, o, top(b) - 0.5, 0.85, 0.95);
      if (!bag.lod) memberSO(bag, F, steelD, a, o, i % 2 ? top(a) - 1 : bot(a) + 1, b, o, i % 2 ? bot(b) + 1 : top(b) - 1, 0.5, 0.6);
      if (bag.lod) bag.quad(M.webOf(steel, 0.36), F.P(a, o, bot(a) + 1), F.P(b, o, bot(b) + 1), F.P(b, o, top(b) - 1), F.P(a, o, top(a) - 1), null);
    }
    for (let i = 0; i <= n; i++) { const a = P(i); memberSO(bag, F, steel, a, o, bot(a) + 1, a, o, top(a) - 1, 0.6, 0.65); }
  }
  // the top bracing over the roadway's clearance (struts and an X per panel), floor beams and the bottom laterals
  for (let i = 0; i <= n; i++) { const a = P(i); if (top(a) - y(a) > 7) memberSO(bag, F, steelD, a, -oT, top(a) - 0.8, a, oT, top(a) - 0.8, 0.45, 0.7); }
  lateralX(bag, F, steelD, anA, anB, S.panel * 2, -oT, oT, (s) => Math.max(top(s) - 1.0, y(s) + 6.8), 0.25);
  crossBeams(bag, F, steelD, anA, anB, S.panel / 2, -oT, oT, (s) => y(s) - 0.35, 0.35, 1.2);
  lateralX(bag, F, steelD, anA, anB, S.panel * 2, -oT, oT, (s) => bot(s) + 0.3, 0.2);
  // the roadway the whole length; the approaches' girders and piers beyond the anchor piers
  slab(bag, F, asph, 0, F.L, -half, half, y, 0.3, 6);
  const lanes = S.lanes, lw0 = half / lanes, lines = [{ o: -0.12, w: 0.11, yellow: true }, { o: 0.12, w: 0.11, yellow: true }, { o: -half + 0.3, w: 0.12 }, { o: half - 0.3, w: 0.12 }];
  for (let k = 1; k < lanes; k++) lines.push({ o: -half + k * lw0, w: 0.11, dash: [3.05, 9.15] }, { o: half - k * lw0, w: 0.11, dash: [3.05, 9.15] });
  laneLines(bag, F, lw, ly, 0, F.L, y, lines);
  for (const sg of [-1, 1]) railing(bag, F, steelD, 0, F.L, sg * (half + 0.15), y, 1.1, 2.4, 0.08);
  for (const [a, b] of [[0, anA - 1], [anB + 1, F.L]]) for (const o of [-half + 1.2, -half / 3, half / 3, half - 1.2]) { const ss = F.range(a, b, 8); for (let i = 0; i + 1 < ss.length; i++) bag.beam(steel, F.P(ss[i], o, y(ss[i]) - 1.3), F.P(ss[i + 1], o, y(ss[i + 1]) - 1.3), 0.5, 2.0); }
  const under = (rec.under || []).filter((u) => u[2] < 0.5), free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (let s = 12; s < F.L - 4; s += 32) {
    if (s > anA - 4 && s < anB + 4) continue;
    if (!free(s)) continue;
    const g = F.groundAt(s), base = g === null ? -3 : g - 0.5, topP = y(s) - 2.6;
    if (topP - base < 2.5) continue;
    portalPier(bag, F, conc, s, half - 1.6, base, topP, 1.1, 1.3, 1.4, Math.min(half - 2.9, (topP - base) * 0.3));
  }
  // the main and anchor piers (concrete, the main ones with cutwaters at the water)
  for (const s of sup) {
    const g = F.groundAt(s), base = g === null ? -3 : g - 0.5, t = bot(s) - 0.4;
    // portals under both truss lines: tall legs and a round arch (the main piers' footings at the water a solid plinth)
    if (g === null) taper(bag, F, conc, s, 0, base, 2.0, isPier(s) ? 6.2 : 4.2, oT + 3.2, isPier(s) ? 6.0 : 4.0, oT + 3.0);
    portalPier(bag, F, conc, s, oT, g === null ? 2.0 : base, t, isPier(s) ? 4.6 : 3.0, 2.2, 3.0, oT - 2.2);
    if (isPier(s)) for (const sg of [-1, 1]) { const p = F.P(s, sg * oT, top(s) + 0.2); bag.rod(red, p, [p[0], p[1] + 0.5, p[2]], 0.3, 8, 0.3, true); }
  }
  if (!bag.lod) for (let s = 20; s < F.L - 10; s += 40) { const p = F.P(s, half + 0.15, y(s)); bag.rod(steelD, p, [p[0], p[1] + 7, p[2]], 0.08, 6, 0.06, true); bag.rod(lamp, [p[0], p[1] + 7, p[2]], [p[0], p[1] + 7.25, p[2]], 0.22, 8, 0.22, true); }
}

// the Outerbridge Crossing (John Alexander Low Waddell, 1928): a cantilever truss of 750 ft (228.6 m) main span and
// 375 ft anchor arms over the Arthur Kill, 135 ft (41 m) of clearance, four lanes; grey paint
export const buildOuterbridge = (rec, bag) => buildCantilever(rec, bag, { steel: 0x9fa8a6, steelD: 0x7f8886, width: 18.5, lanes: 2, hMid: 12, hPier: 30, hEnd: 10, panel: 9.5 });
