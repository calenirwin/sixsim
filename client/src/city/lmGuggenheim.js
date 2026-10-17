// lmGuggenheim.js (LM16, landmarks round 2026-10-16): the Solomon R. Guggenheim Museum (Frank Lloyd Wright, 1959; the
// tower by Gwathmey Siegel, 1992) on its compiled ring (tile 2_0 #3), modelled from the reference views (from the park,
// overhead) in the kit's material sets: painted concrete as smooth off-white, the skylights in landmark glass.
//   - the rotunda: an inverted spiral of four bands widening upward (each band leaning out, its top edge crisp), the
//     recessed clerestory slots between them, the glazed ground storey, the long horizontal band at the second storey that
//     runs north along Fifth Avenue to the monitor; on top the roof ring, the ring of glazing and the twelve-sided ribbed
//     skylight dome with its small cupola;
//   - the monitor (the small rotunda at the 89th Street end) with its own bands and lobed skylight;
//   - the tower behind (ten storeys, a limestone-coloured grid of square panels with ribbon windows) and the annex.
// Grid frame: origin the rotunda's centre, world (1028.85, 19.98) (the circle the ring's curved corner fits, r 17.4 m);
// gx along the streets (east), gn along Fifth Avenue (north). The Fifth Avenue front line is gx -12.3.
import { LB, GE, GN, opening, courses, mould, PROF, lathe, ribW } from './lmStoneKit.js';
import { quadW, quadU, quadY, poly, box as kbox, wallWithHoles, Frame } from './fk/kitGeom.js';
import { surfMat, partMat, cwGlassMat, winGlassMat } from './tk/tkMats.js';
import { LM_GLASS } from './tk/tkParams.js';

const O = [1028.85, 19.98];
const TAU = Math.PI * 2;

function M() {
  return {
    white: surfMat('concrete_smooth', '#eeece5'),   // the painted concrete
    whiteS: surfMat('concrete_smooth', '#dcd9d0'),  // its soffits and the shaded returns
    stone: surfMat('stone_lime', '#d8d1c3'),        // the tower's grid
    stoneD: surfMat('stone_lime', '#c4bcae'),
    roof: surfMat('roof_membrane', '#b9bab6'),
    mull: partMat('alu_clear'),
    dark: partMat('alu_black'),
    glass: cwGlassMat(LM_GLASS.CLEARG),
    sky: cwGlassMat(LM_GLASS.SILVERW),
    win: winGlassMat(),
  };
}

// the rotunda: bands of radii R[k] at their tops (each leaning out 0.4 m over its height), slots between
function rotunda(B, K) {
  const [cx, cz] = B.W(0, 0);
  const n = 96;
  const y1 = 4.0;                       // the ground storey's head
  // the ground storey: glass on mullions, set back under the second-storey band
  lathe(B, K.whiteS, cx, cz, [[11.6, 0], [11.6, 0.25], [11.4, 0.25]], n);
  const rg = 11.4;
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU, b = (i + 1) / 48 * TAU;
    const pa = [cx + Math.cos(a) * rg, cz + Math.sin(a) * rg], pb = [cx + Math.cos(b) * rg, cz + Math.sin(b) * rg];
    let F = new Frame(pa, pb, B.y0, B.org);
    if (F.nx * Math.cos((a + b) / 2) + F.nz * Math.sin((a + b) / 2) < 0) F = new Frame(pb, pa, B.y0, B.org);
    B.pane(K.glass, F, [[0, 0.25], [F.L, 0.25], [F.L, y1], [0, y1]], 0, { cu: i, cv: 0, ws: 40, fh: 4.5, sill: 0.1 });
    kbox(B.S(K.dark), F, -0.04, 0.04, 0.25, y1, 0, 0.12, 0, 16);
    kbox(B.S(K.dark), F, 0, F.L, 2.6, 2.66, 0, 0.08, 0, 16);
  }
  // the second-storey band (a solid parapet ring) and the four bands of the spiral above it
  const bands = [
    { y0: 4.0, h: 2.6, r: 13.2, lean: 0.25 },
    { y0: 7.5, h: 4.4, r: 14.3, lean: 0.4 },
    { y0: 12.8, h: 4.4, r: 15.3, lean: 0.4 },
    { y0: 18.1, h: 4.4, r: 16.3, lean: 0.4 },
    { y0: 23.4, h: 4.0, r: 17.35, lean: 0.4 },
  ];
  let rPrev = rg;
  for (let k = 0; k < bands.length; k++) {
    const b = bands[k], rb = b.r - b.lean, yt = b.y0 + b.h;
    // the soffit from the slot (or the ground glass) out to the band's foot, the face leaning out, a crisp top with a
    // slight drip, then the top going in to the next slot
    const rIn = k === 0 ? rg : rPrev;
    lathe(B, K.whiteS, cx, cz, [[rIn - 0.05, b.y0], [rb, b.y0]], n);
    lathe(B, K.white, cx, cz, [[rb, b.y0], [rb + 0.04, b.y0 + 0.12], [b.r - 0.05, yt - 0.15], [b.r, yt - 0.05], [b.r - 0.02, yt]], n);
    const next = bands[k + 1];
    const rSlot = next ? b.r - 0.9 : b.r - 0.6;
    lathe(B, K.white, cx, cz, [[b.r - 0.02, yt], [rSlot, yt]], n);
    if (next) {
      // the slot: a recessed band of glazing between this band's top and the next band's soffit
      const ys0 = yt, ys1 = next.y0;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, c = (i + 1) / n * TAU;
        const pa = [cx + Math.cos(a) * rSlot, cz + Math.sin(a) * rSlot], pb = [cx + Math.cos(c) * rSlot, cz + Math.sin(c) * rSlot];
        let F = new Frame(pa, pb, B.y0, B.org);
        if (F.nx * Math.cos((a + c) / 2) + F.nz * Math.sin((a + c) / 2) < 0) F = new Frame(pb, pa, B.y0, B.org);
        B.pane(K.glass, F, [[0, ys0], [F.L, ys0], [F.L, ys1], [0, ys1]], 0, { cu: i, cv: k + 1, ws: 41 + k, fh: 5, sill: 0.1 });
        if (i % 4 === 0) kbox(B.S(K.dark), F, -0.03, 0.03, ys0, ys1, 0, 0.08, 0, 16);
      }
    }
    rPrev = rSlot;
  }
  // the roof: the top band's deck, a ring of glazing on twelve ribs rising to the dome's curb, the ribbed dome, the cupola
  const yR = 27.4, rD = 10.6;
  lathe(B, K.roof, cx, cz, [[17.35 - 0.6, yR], [15.4, yR + 0.05]], n);
  lathe(B, K.white, cx, cz, [[15.4, yR - 0.1], [15.4, yR + 0.55], [15.2, yR + 0.55]], n);
  const a0 = Math.atan2(GE[1], GE[0]);
  // the glazed ring (a shallow cone of glass between the curbs)
  lathe(B, K.sky, cx, cz, [[15.2, yR + 0.55], [rD + 0.3, yR + 1.6]], 48, a0, a0 + TAU);
  lathe(B, K.white, cx, cz, [[rD + 0.3, yR + 1.6], [rD + 0.3, yR + 2.1], [rD, yR + 2.1]], n);
  // the dome: twelve facets in three tiers, glass between white ribs
  const yD = yR + 2.1, tiers = [[rD, yD], [rD * 0.8, yD + 1.7], [rD * 0.5, yD + 3.0], [1.8, yD + 3.6]];
  lathe(B, K.sky, cx, cz, tiers, 12, a0, a0 + TAU);
  for (let i = 0; i < 12; i++) {
    const a = a0 + i / 12 * TAU, c = Math.cos(a), s = Math.sin(a);
    for (let t = 0; t + 1 < tiers.length; t++) {
      const [ra, ya] = tiers[t], [rb, yb] = tiers[t + 1];
      ribW(B, B.S(K.white), [cx + c * ra, B.y0 + ya + 0.08, cz + s * ra], [cx + c * rb, B.y0 + yb + 0.08, cz + s * rb], 0.28);
    }
    ribW(B, B.S(K.white), [cx + c * 15.2, B.y0 + yR + 0.6, cz + s * 15.2], [cx + c * (rD + 0.3), B.y0 + yR + 1.65, cz + s * (rD + 0.3)], 0.22);
  }
  for (const [r, y] of tiers.slice(1, 3)) lathe(B, K.white, cx, cz, [[r - 0.12, y - 0.05], [r + 0.12, y - 0.05], [r + 0.12, y + 0.15], [r - 0.12, y + 0.15]], 12, a0, a0 + TAU);
  // the cupola
  lathe(B, K.white, cx, cz, [[1.9, yD + 3.55], [1.9, yD + 3.9], [1.5, yD + 3.9]], 24);
  lathe(B, K.sky, cx, cz, [[1.5, yD + 3.9], [1.5, yD + 4.5], [0.0, yD + 4.9]], 24);
  B.collide(-17.4, 17.4, -17.4, 17.4, 0, yR);
}

// the monitor: a small rotunda of three bands with a lobed skylight
function monitor(B, K) {
  const [cx, cz] = B.W(-4.0, 28.6), n = 64;
  const rg = 6.6;
  lathe(B, K.whiteS, cx, cz, [[rg + 0.2, 0], [rg + 0.2, 0.25], [rg, 0.25]], n);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * TAU, b = (i + 1) / 28 * TAU;
    let F = new Frame([cx + Math.cos(a) * rg, cz + Math.sin(a) * rg], [cx + Math.cos(b) * rg, cz + Math.sin(b) * rg], B.y0, B.org);
    if (F.nx * Math.cos((a + b) / 2) + F.nz * Math.sin((a + b) / 2) < 0) F = new Frame([cx + Math.cos(b) * rg, cz + Math.sin(b) * rg], [cx + Math.cos(a) * rg, cz + Math.sin(a) * rg], B.y0, B.org);
    B.pane(K.glass, F, [[0, 0.25], [F.L, 0.25], [F.L, 4.0], [0, 4.0]], 0, { cu: i, cv: 0, ws: 60, fh: 4.5 });
    kbox(B.S(K.dark), F, -0.04, 0.04, 0.25, 4.0, 0, 0.12, 0, 16);
  }
  const bands = [{ y0: 4.0, h: 2.6, r: 8.4 }, { y0: 7.3, h: 2.6, r: 8.4 }, { y0: 10.6, h: 2.2, r: 8.6 }];
  let rIn = rg;
  for (let k = 0; k < bands.length; k++) {
    const b = bands[k], yt = b.y0 + b.h;
    lathe(B, K.whiteS, cx, cz, [[rIn - 0.05, b.y0], [b.r - 0.2, b.y0]], n);
    lathe(B, K.white, cx, cz, [[b.r - 0.2, b.y0], [b.r, yt - 0.05], [b.r - 0.02, yt]], n);
    const rS = b.r - 0.8;
    lathe(B, K.white, cx, cz, [[b.r - 0.02, yt], [rS, yt]], n);
    const nx = bands[k + 1];
    if (nx) for (let i = 0; i < n; i++) {
      const a = i / n * TAU, c = (i + 1) / n * TAU;
      let F = new Frame([cx + Math.cos(a) * rS, cz + Math.sin(a) * rS], [cx + Math.cos(c) * rS, cz + Math.sin(c) * rS], B.y0, B.org);
      if (F.nx * Math.cos((a + c) / 2) + F.nz * Math.sin((a + c) / 2) < 0) F = new Frame([cx + Math.cos(c) * rS, cz + Math.sin(c) * rS], [cx + Math.cos(a) * rS, cz + Math.sin(a) * rS], B.y0, B.org);
      B.pane(K.glass, F, [[0, yt], [F.L, yt], [F.L, nx.y0], [0, nx.y0]], 0, { cu: i, cv: k + 1, ws: 61, fh: 3.5 });
    }
    rIn = rS;
  }
  // the roof and the lobed skylight (three lobes of glass on a white curb)
  const yR = 12.8;
  lathe(B, K.roof, cx, cz, [[7.8, yR], [0, yR + 0.02]], n);
  for (let l = 0; l < 3; l++) {
    const a = l / 3 * TAU + 0.5, lx = cx + Math.cos(a) * 2.3, lz = cz + Math.sin(a) * 2.3;
    lathe(B, K.white, lx, lz, [[2.6, yR], [2.6, yR + 0.5], [2.4, yR + 0.5]], 32);
    lathe(B, K.sky, lx, lz, [[2.4, yR + 0.5], [1.6, yR + 1.2], [0, yR + 1.5]], 32);
  }
  B.collide(-12.6, 4.6, 20, 37, 0, yR);
}

// the long second-storey band on Fifth Avenue from the rotunda to the monitor, the infill behind it
function fifthBand(B, K) {
  const gx0 = -12.3, gx1 = -6.5, gn0 = 9.0, gn1 = 22.0;
  const F = B.rectFaces(gx0, gx1, gn0, gn1);
  // the band: solid from 4.0 to 6.6 on the street face, glazing under it, the infill above set back
  const Fw = F[3];
  quadW(B.S(K.white), Fw, 0, Fw.L, 4.0, 6.6, 0);
  quadY(B.S(K.whiteS), Fw, 0, Fw.L, 4.0, -1.6, 0, -1);
  quadY(B.S(K.white), Fw, 0, Fw.L, 6.6, -1.6, 0, 1);
  B.pane(K.glass, Fw, [[0, 0.2], [Fw.L, 0.2], [Fw.L, 4.0], [0, 4.0]], -1.6, { ws: 70 });
  quadW(B.S(K.white), Fw, 0, Fw.L, 6.6, 11.5, -1.6);
  B.deck(K.roof, B.rect(gx0 + 1.6, gx1 + 4, gn0, gn1), 11.5);
  // the band continues as a ring segment round the rotunda's foot (lathe arc toward Fifth Avenue) and the monitor's
  const [cx, cz] = B.W(0, 0);
  void cx; void cz;
}

// the tower (gx 4.5..18, gn 12..43): ten storeys of a square stone grid with ribbon windows; the annex south of it
function tower(B, K) {
  const gx0 = 4.5, gx1 = 18.0, gn0 = 12.0, gn1 = 43.0, yT = 41.0;
  const faces = B.rectFaces(gx0, gx1, gn0, gn1);
  faces.forEach((F, i) => {
    const L = F.L, holes = [], fh = 3.9;
    // ribbon windows on every other storey (the gallery storeys are blind), a tall window strip on the north and west faces
    for (let f = 0; f < 10; f++) {
      const y0 = 0.6 + f * fh;
      if (f % 3 === 1 || (i === 3 && f === 8)) {
        const u0 = 1.0, u1 = L - 1.0;
        holes.push({ u0, u1, y0: y0 + 0.9, y1: y0 + 2.4 });
      }
    }
    // the grid: square panels proud of the joints
    courses(B, F, K.stone, 0, L, 0, yT - 0.8, 1.52, holes, 0.02, 0.012, 1.52, 90 + i);
    for (const h of holes) {
      B.pane(K.glass, F, [[h.u0, h.y0], [h.u1, h.y0], [h.u1, h.y1], [h.u0, h.y1]], -0.3, { cu: i, cv: Math.round(h.y0), ws: 80 + i, fh: 3.9 });
      quadY(B.S(K.stoneD), F, h.u0, h.u1, h.y1, -0.3, 0, -1); quadY(B.S(K.stoneD), F, h.u0, h.u1, h.y0, -0.3, 0, 1);
      quadU(B.S(K.stoneD), F, h.u0, h.y0, h.y1, -0.3, 0, 1); quadU(B.S(K.stoneD), F, h.u1, h.y0, h.y1, -0.3, 0, -1);
      for (let u = h.u0 + 1.52; u < h.u1 - 0.2; u += 1.52) kbox(B.S(K.dark), F, u - 0.04, u + 0.04, h.y0, h.y1, -0.3, -0.2, 0, 16);
    }
    mould(B, F, K.stoneD, PROF.coping(yT - 0.8, 0.12, 0.8), 0, L, 1, 1);
  });
  B.deck(K.roof, B.rect(gx0, gx1, gn0, gn1), yT - 0.05);
  // roof plant
  const pf = B.rectFaces(8, 15, 20, 34);
  for (const F of pf) quadW(B.S(K.stoneD), F, 0, F.L, yT - 0.1, yT + 3.2, 0);
  B.deck(K.roof, B.rect(8, 15, 20, 34), yT + 3.2);
  B.collide(gx0, gx1, gn0, gn1, 0, yT);
  // the annex (gx 12..22.5, gn -6..13.4): four storeys, white, square windows
  const a0 = 12.0, a1 = 22.5, b0 = -6.1, b1 = 13.4, yA = 16.5;
  B.rectFaces(a0, a1, b0, b1).forEach((F, i) => {
    const holes = [], ops = [];
    if (i === 1 || i === 0) for (let f = 0; f < 4; f++) for (let u = 1.4; u < F.L - 2.0; u += 3.2) {
      holes.push({ u0: u, u1: u + 1.5, y0: 1.2 + f * 3.9, y1: 3.0 + f * 3.9 });
      ops.push({ u0: u, u1: u + 1.5, y0: 1.2 + f * 3.9, ys: 3.0 + f * 3.9, arch: null, d: 0.25, wall: K.white, trim: K.whiteS, glass: K.win, frame: K.dark, lintel: false, sill: false, info: { ws: 90 + i, cv: f } });
    }
    wallWithHoles(B.S(K.white), F, 0, F.L, 0, yA, holes, 0);
    for (const o of ops) opening(B, F, o);
    mould(B, F, K.white, PROF.coping(yA, 0.08, 0.4), 0, F.L, 1, 1);
  });
  B.deck(K.roof, B.rect(a0, a1, b0, b1), yA);
  // the link between the rotunda and the tower (gx 9..14, gn 8..14) and the service block on 89th Street (gx -10..4.5, gn 37..43.6)
  B.rectFaces(9, 14, 8, 14).forEach((F) => quadW(B.S(K.white), F, 0, F.L, 0, 22, 0));
  B.deck(K.roof, B.rect(9, 14, 8, 14), 22);
  B.rectFaces(-12.2, 4.5, 37.5, 43.5).forEach((F, i) => {
    const holes = i === 2 ? [{ u0: 2, u1: F.L - 2, y0: 0.3, y1: 3.4 }] : [];
    wallWithHoles(B.S(K.white), F, 0, F.L, 0, 14, holes, 0);
    if (holes.length) B.pane(K.glass, F, [[2, 0.3], [F.L - 2, 0.3], [F.L - 2, 3.4], [2, 3.4]], -0.2, { ws: 95 });
  });
  B.deck(K.roof, B.rect(-12.2, 4.5, 37.5, 43.5), 14);
}

export function buildGuggenheim(ctx) {
  const B = new LB(ctx, O), K = M();
  B.we = [0.61, B.y0, B.y0 + 41];
  if (ctx.footprint && ctx.footprint.length >= 3) B.deck(surfMat('granite_grey', '#b4b0a8'), ctx.footprint.map(([x, z]) => [x + B.cx, z + B.cz]), 0.12);
  rotunda(B, K);
  monitor(B, K);
  fifthBand(B, K);
  tower(B, K);
  return B.group('guggenheim');
}
