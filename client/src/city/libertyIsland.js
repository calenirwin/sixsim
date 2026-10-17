// Liberty Island round the Statue of Liberty: its ground, lawns and gardens, the paved plaza and walks, the hedges,
// retaining walls and fences, the granite seawall and its promenade railing, the ferry pier and its canopy, the island's
// buildings (the Statue of Liberty Museum with its green roof, the cafe, the pavilions, the service buildings), the
// flagpole, the lamps and the 277 trees, all on OpenStreetMap's geometry (city/libertyIslandData.js). World metres about
// the pedestal's axis (the group stands there), the island's ground at 3.5 m (the compiled land's height). The compiled
// footprints on the island are replaced by nothing (shared/landmarkSpec.js id 68), the compiled ground hidden under these
// surfaces.
import * as THREE from 'three';
import { GeoBag } from './br/geom.js';
import * as KM from './br/mats.js';
import { pbrMaterial } from './mat/pbrLib.js';
import { ENV, applyLightTrim, applyCityAO } from '../world/materials.js';
import { grassField } from './cpFloraKit.js';
import { COAST, LAWNS, GARDENS, BEDS, PLAZAS, WALKS, HEDGES, WALLS, FENCES, BUILDINGS, LOCKERS, PIERS, CANOPIES, TREES, FLAGPOLE } from './libertyIslandData.js';

export const GROUND = 3.5;
const AX = -6181.2, AZ = 10429.4;
const once = new Map();
const one = (k, f) => { if (!once.has(k)) once.set(k, f()); return once.get(k); };
const W = { mapping: 'world' };

// ---------------------------------------------------------------- materials
// the ground's layers each pulled forward in depth by a step, so they never fight at a distance
const layer = (m, k) => { m.polygonOffset = true; m.polygonOffsetFactor = -k; m.polygonOffsetUnits = -k; return m; };
const paving = () => one('pave', () => layer(pbrMaterial('sidewalk_concrete', { ...W, tint: '#c9c3b8', seed: 67 }), 1));
const plaza = () => one('plaza', () => layer(pbrMaterial('granite_grey_flamed', { ...W, tint: '#c4b9ad', seed: 67 }), 4));
const walkM = () => one('walk', () => layer(pbrMaterial('sidewalk_concrete', { ...W, tint: '#d2ccc1', seed: 68 }), 5));
const mulch = () => one('mulch', () => layer(pbrMaterial('mulch', { ...W, seed: 67 }), 3));
// the lawn: a generated turf (greens mottled with drier and lusher patches, a fine speckle), world-mapped (4 m), the grass
// blades over it near the lens (city/cpFloraKit.js grassField)
function turfTexture() {
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  const hv = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vn = (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (a, b) => hv(((a % p) + p) % p, ((b % p) + p) % p);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = vn(x / 64, y / 64, 8) * 0.5 + vn(x / 16, y / 16, 32) * 0.3 + vn(x / 4, y / 4, 128) * 0.2, sp = hv(x * 1.37, y * 2.11);
    const dry = Math.max(0, m - 0.62) * 2.2;
    const r = 0.30 + 0.10 * m + 0.16 * dry + 0.05 * (sp - 0.5), gg = 0.43 + 0.10 * m + 0.05 * dry + 0.06 * (sp - 0.5), b = 0.19 + 0.04 * m + 0.02 * dry;
    const i = (y * N + x) * 4;
    d[i] = Math.round(Math.min(1, r) * 255); d[i + 1] = Math.round(Math.min(1, gg) * 255); d[i + 2] = Math.round(Math.min(1, b) * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export const turf = () => one('turf', () => {
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: 0xffffff, map: typeof document !== 'undefined' ? turfTexture() : null, roughness: 0.95, metalness: 0 })));
  m.name = 'lb:turf';
  m.userData.brBase = { r: 0.33, g: 0.45, b: 0.21 };
  m.userData.pbr = { name: 'grass_lawn', opts: {} };
  return layer(m, 2);
});
// a planted mass (a hedge, a shrub): dark leafy greens, its leaves' clumps as a world-mapped texture
const leafy = (hex, k) => one('leafy' + hex, () => {
  const N = 256, cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let map = null;
  if (cv) {
    cv.width = cv.height = N;
    const g = cv.getContext('2d'), c = new THREE.Color(hex);
    g.fillStyle = `rgb(${c.r * 200 | 0},${c.g * 200 | 0},${c.b * 200 | 0})`; g.fillRect(0, 0, N, N);
    let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * N, y = rnd() * N, r = 2 + rnd() * 6, l = 0.55 + rnd() * 0.75;
      g.fillStyle = `rgb(${Math.min(255, c.r * 255 * l) | 0},${Math.min(255, c.g * 255 * l) | 0},${Math.min(255, c.b * 255 * l) | 0})`;
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, rnd() * 3.14, 0, Math.PI * 2); g.fill();
    }
    map = new THREE.CanvasTexture(cv); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
  }
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.9, metalness: 0 })));
  m.name = 'lb:leafy:' + k;
  m.userData.brBase = { r: new THREE.Color(hex).r, g: new THREE.Color(hex).g, b: new THREE.Color(hex).b };
  return m;
});
const steel = () => KM.paint(0x2a302c, { rough: 0.55, metal: 0.55 });
const seawallStone = () => KM.ashlar(0x9a958c, 1.5, { style: 'rock', wl: 0.6, sub: 2.0, seed: 21 });
const copingStone = () => KM.ashlar(0xaaa499, 1.0, { style: 'dressed', wl: 0.6, sub: 2.0, seed: 22 });
const wallStone = () => KM.ashlar(0xa8a196, 0.8, { style: 'dressed', sub: 2.0, seed: 23 });
const bstone = () => one('bstone', () => pbrMaterial('stone_lime_ashlar', { ...W, tint: '#c8c0b2', seed: 67 }));
const bbrick = () => one('bbrick', () => pbrMaterial('brick_red', { ...W, seed: 67 }));
const bglass = () => one('bglass', () => pbrMaterial('glass_tower_grey', { seed: 67 }));
const broof = () => one('broof', () => pbrMaterial('roof_membrane', { ...W, tint: '#b9b6ae', seed: 67 }));
const bmetal = () => KM.paint(0x5e6467, { rough: 0.45, metal: 0.7 });
const lamp = () => KM.glow(0xffe1b0, 2.4, 0.0008);

// ---------------------------------------------------------------- geometry helpers (world offsets from the axis)
const area2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; a += x1 * z2 - x2 * z1; } return a; };
const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
// a flat polygon (a ring of [x, z]) at height y, its triangles (ShapeUtils' ear clipping), uvs from the world
function flat(ring, y, holes = []) {
  const v2 = (r) => r.map(([x, z]) => new THREE.Vector2(x, z));
  const contour = v2(ring), H = holes.map(v2);
  const tris = THREE.ShapeUtils.triangulateShape(contour, H);
  const all = [...contour, ...H.flat()], pos = [], nrm = [], uv = [];
  for (const t of tris) {
    // (wound to face up: x, z counter-clockwise seen from above is clockwise in x-z, so a negative area flips)
    const [a, b, c] = t, A = all[a], B = all[b], C = all[c];
    const cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    for (const P of cr > 0 ? [A, C, B] : [A, B, C]) { pos.push(P.x, y, P.y); nrm.push(0, 1, 0); uv.push((P.x + AX) / 4, (P.y + AZ) / 4); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// a strip along a polyline, w wide, at height y (the walks), its corners mitred
function strip(pts, w, y) {
  const pos = [], nrm = [], uv = [], idx = [];
  const n = pts.length;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i > 0) run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    for (const s of [-1, 1]) { pos.push(p[0] + nx * s * w / 2, y, p[1] + nz * s * w / 2); nrm.push(0, 1, 0); uv.push((p[0] + nx * s * w / 2 + AX) / 4, (p[1] + nz * s * w / 2 + AZ) / 4); }
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k + 1, k - 2, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // (faces up whichever way the line runs)
  const a0 = new THREE.Vector3(...pos.slice(0, 3)), b0 = new THREE.Vector3(...pos.slice(3, 6)), c0 = new THREE.Vector3(...pos.slice(9, 12));
  if (pos.length >= 12 && new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3().subVectors(c0, a0)).y < 0) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } }
  return g;
}
function meshOf(geos, mat, name, shadow = true) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const g = list.length === 1 ? list[0] : mergeAll(list);
  const m = new THREE.Mesh(g, mat);
  m.name = name; m.receiveShadow = true; m.castShadow = shadow;
  return m;
}
function mergeAll(list) {
  // (non-indexed merge of position, normal, uv)
  const pos = [], nrm = [], uv = [];
  for (const g of list) {
    const G = g.index ? g.toNonIndexed() : g;
    pos.push(...G.attributes.position.array); nrm.push(...G.attributes.normal.array); uv.push(...(G.attributes.uv ? G.attributes.uv.array : new Float32Array(G.attributes.position.count * 2)));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------- the ground, planting and walks
function groundParts(group) {
  const add = (m) => m && group.add(m);
  // the island paved by default (its walks and forecourts), the lawns, gardens and beds, the plazas and the walks over them
  add(meshOf([flat(COAST, GROUND + 0.06)], paving(), 'liberty:ground:paving', false));
  add(meshOf(LAWNS.map((r) => flat(r, GROUND + 0.085)), turf(), 'liberty:ground:lawn', false));
  add(meshOf([...GARDENS, ...BEDS].map((r) => flat(r, GROUND + 0.1)), mulch(), 'liberty:ground:beds', false));
  add(meshOf(PLAZAS.map((r) => flat(r, GROUND + 0.11)), plaza(), 'liberty:ground:plaza', false));
  add(meshOf(WALKS.filter((w) => w.kind !== 'steps' && w.pts.length > 1).map((w) => strip(w.pts, w.w, GROUND + 0.12 + (w.w > 5 ? 0.005 : 0))), walkM(), 'liberty:ground:walks', false));
}
// the gardens' shrubs and the beds' low planting: rounded masses scattered over them (instanced), seeded
function shrubs(group, lod) {
  if (lod) return;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const recs = [];
  let s = 31; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const r of GARDENS) {
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    const A = Math.abs(area2(r)) / 2, nTry = Math.min(600, Math.round(A / 2.2));
    for (let k = 0; k < nTry; k++) {
      const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
      if (!inside(r, x, z)) continue;
      const sc = 0.45 + rnd() * 0.55;
      recs.push([x, z, sc, rnd()]);
    }
  }
  const m = new THREE.InstancedMesh(geo, leafy(0x3f5a2c, 'shrub'), Math.max(1, recs.length));
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  recs.forEach(([x, z, sc, r], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28); M4.compose(new THREE.Vector3(x, GROUND + 0.1 + sc * 0.45, z), q, new THREE.Vector3(sc * 1.1, sc * 0.75, sc * 1.1)); m.setMatrixAt(i, M4); });
  m.count = recs.length; m.name = 'liberty:shrubs'; m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}
// hedges (1.1 m x 0.85 m), retaining walls (granite, their tagged heights), fences and railings (steel, posts and rails),
// stone walls
function edges(bag, lod) {
  const hedge = leafy(0x354f26, 'hedge');
  for (const pts of HEDGES) for (let i = 0; i + 1 < pts.length; i++) seg(bag, hedge, pts[i], pts[i + 1], GROUND, GROUND + 1.1, 0.85);
  for (const w of WALLS) for (let i = 0; i + 1 < w.pts.length; i++) seg(bag, wallStone(), w.pts[i], w.pts[i + 1], GROUND - 0.4, GROUND + Math.min(4, w.h), 0.4);
  if (lod) return;
  const st = steel();
  for (const f of FENCES) {
    if (f.kind === 'wall') { for (let i = 0; i + 1 < f.pts.length; i++) seg(bag, wallStone(), f.pts[i], f.pts[i + 1], GROUND - 0.3, GROUND + Math.min(4, f.h), 0.45); continue; }
    const h = Math.min(2.4, f.h || 1.1);
    railingAlong(bag, st, f.pts, GROUND + 0.1, h);
  }
}
function seg(bag, mat, a, b, y0, y1, w) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
  if (l < 0.05) return;
  const ez = [dx / l, 0, dz / l], ex = [-dz / l, 0, dx / l];
  bag.obox(mat, [(a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2], ex, [0, 1, 0], ez, w / 2, (y1 - y0) / 2, l / 2 + w * 0.3);
}
function railingAlong(bag, mat, pts, y, h) {
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.05) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    for (let d = carry; d < l; d += 2.4) { const x = a[0] + ux * d, z = a[1] + uz * d; bag.rod(mat, [x, y, z], [x, y + h, z], 0.035, 6, 0.035, true); }
    carry = (carry - l) % 2.4; if (carry < 0) carry += 2.4;
    for (const f of [1, 0.5, 0.12]) bag.beam(mat, [a[0], y + h * f, a[1]], [b[0], y + h * f, b[1]], 0.05, 0.05);
  }
}

// ---------------------------------------------------------------- the seawall and the promenade's edge
function seawall(bag, lod) {
  const ring = COAST, n = ring.length, ccw = area2(ring) > 0;
  const top = GROUND + 0.42, foot = -2.2, st = seawallStone(), cp = copingStone();
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.05) continue;
    // outward: to the right of travel for a counter-clockwise ring in x-z (z south)
    let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
    if (!ccw) { nx = -nx; nz = -nz; }
    bag.quad(st, [a[0], foot, a[1]], [b[0], foot, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], [nx, 0, nz]);
    // the coping: a granite cap 0.65 m deep over the wall, proud of its face by 0.1 m
    bag.quad(cp, [a[0] + nx * 0.1, top, a[1] + nz * 0.1], [b[0] + nx * 0.1, top, b[1] + nz * 0.1], [b[0] + nx * 0.1, top + 0.22, b[1] + nz * 0.1], [a[0] + nx * 0.1, top + 0.22, a[1] + nz * 0.1], [nx, 0, nz]);
    bag.quad(cp, [a[0] + nx * 0.1, top + 0.22, a[1] + nz * 0.1], [b[0] + nx * 0.1, top + 0.22, b[1] + nz * 0.1], [b[0] - nx * 0.55, top + 0.22, b[1] - nz * 0.55], [a[0] - nx * 0.55, top + 0.22, a[1] - nz * 0.55], [0, 1, 0]);
    bag.quad(cp, [b[0] - nx * 0.55, GROUND, b[1] - nz * 0.55], [a[0] - nx * 0.55, GROUND, a[1] - nz * 0.55], [a[0] - nx * 0.55, top + 0.22, a[1] - nz * 0.55], [b[0] - nx * 0.55, top + 0.22, b[1] - nz * 0.55], [-nx, 0, -nz]);
  }
  void lod;
}

// ---------------------------------------------------------------- piers and canopies
function piers(bag, lod) {
  const deck = KM.concrete(0xa9a49a), pile = KM.paint(0x3b3631, { rough: 0.9, metal: 0 });
  for (const P of PIERS) {
    const ring = P.closed ? P.ring : null;
    if (!ring || ring.length < 3) continue;
    const y = GROUND - 0.4;
    // the deck: its top, its edges down 0.7 m
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) bag.poly(deck, [[ring[i][0], y, ring[i][1]], [ring[j][0], y, ring[j][1]], [ring[k][0], y, ring[k][1]]], [0, 1, 0]);
    const ccw = area2(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.05) continue;
      let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
      if (!ccw) { nx = -nx; nz = -nz; }
      bag.quad(deck, [a[0], y - 0.7, a[1]], [b[0], y - 0.7, b[1]], [b[0], y, b[1]], [a[0], y, a[1]], [nx, 0, nz]);
      if (!lod) for (let d = 1.5; d < l - 0.5; d += 4.0) { const x = a[0] + (b[0] - a[0]) * (d / l) - nx * 0.6, z = a[1] + (b[1] - a[1]) * (d / l) - nz * 0.6; bag.rod(pile, [x, -2.0, z], [x, y - 0.7, z], 0.28, 8, 0.28, false); }
    }
    if (!lod) railingAlong(bag, steel(), [...ring, ring[0]], y, 1.1);
  }
  for (const C of CANOPIES) canopy(bag, C.ring, GROUND - 0.4, 4.6, lod);
  if (LOCKERS.length) for (const r of LOCKERS) canopy(bag, r, GROUND, 3.0, lod);
}
function canopy(bag, ring, y, h, lod) {
  if (!ring || ring.length < 3) return;
  const roof = bmetal(), col = steel();
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) {
    bag.poly(roof, [[ring[i][0], y + h + 0.25, ring[i][1]], [ring[j][0], y + h + 0.25, ring[j][1]], [ring[k][0], y + h + 0.25, ring[k][1]]], [0, 1, 0]);
    bag.poly(roof, [[ring[i][0], y + h, ring[i][1]], [ring[j][0], y + h, ring[j][1]], [ring[k][0], y + h, ring[k][1]]], [0, -1, 0]);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    bag.quad(roof, [a[0], y + h, a[1]], [b[0], y + h, b[1]], [b[0], y + h + 0.25, b[1]], [a[0], y + h + 0.25, a[1]], null);
    if (!lod && i % 2 === 0) { const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length; const x = a[0] + (cx - a[0]) * 0.08, z = a[1] + (cz - a[1]) * 0.08; bag.rod(col, [x, y, z], [x, y + h, z], 0.12, 8, 0.12, false); }
  }
}

// ---------------------------------------------------------------- the buildings
// the museum's parts (FXCollaborative, 2019): granite walls glazed in bands, the green roof; the pavilions: glass between
// stone piers under a flat roof with an overhang; the service buildings: brick; heights from the map (untagged: 4.5 m)
const MUSEUM = new Set(['888758560', '888758561', '888758570', '1251815341', '1251815342', '1251815343', '1251815344', '1251815345']);
const SERVICE = new Set(['32965688', '112275343', '888758629', '576021856', '253854783']);
// the Administration Building (HAER NY-138-A, sheet 4): limestone panels on its south front with four tall windows and
// the double door up three steps, brick on the other sides with small windows, the roof slab at 4.9 m under a parapet to
// 5.5 m, two brick chimneys to 7.4 m; the Concessions Building (NY-138-B, ca. 1930, sheet 4): stone panels, the roof at
// 4.3 m under a parapet to 5.3 m, the glazed bay of four double doors on its east front, a chimney to 7.0 m
const ADMIN = '32965687', CONCESSION = '32965685';
function edgeFacing(ring, dir) {
  const ccw = area2(ring) > 0;
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 3) continue;
    let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
    if (!ccw) { nx = -nx; nz = -nz; }
    const sc = (nx * dir[0] + nz * dir[1]) * Math.sqrt(l);
    if (!best || sc > best.sc) best = { sc, a, b, l, nx, nz };
  }
  return best;
}
// openings on a wall: [u0, u1, y0, y1] in metres along the edge and over the ground; dark glass with a frame
function openings(bag, E, list, glass, frame) {
  const P = (u, y, o) => [E.a[0] + ((E.b[0] - E.a[0]) * u) / E.l + E.nx * o, y, E.a[1] + ((E.b[1] - E.a[1]) * u) / E.l + E.nz * o];
  for (const [u0, u1, y0, y1] of list) {
    bag.quad(glass, P(u0, GROUND + y0, 0.04), P(u1, GROUND + y0, 0.04), P(u1, GROUND + y1, 0.04), P(u0, GROUND + y1, 0.04), [E.nx, 0, E.nz]);
    for (const [a, b, c, d] of [[u0 - 0.1, u1 + 0.1, y0 - 0.1, y0], [u0 - 0.1, u1 + 0.1, y1, y1 + 0.1], [u0 - 0.1, u0, y0, y1], [u1, u1 + 0.1, y0, y1]])
      bag.quad(frame, P(a, GROUND + c, 0.07), P(b, GROUND + c, 0.07), P(b, GROUND + d, 0.07), P(a, GROUND + d, 0.07), [E.nx, 0, E.nz]);
  }
}
function chimney(bag, ring, k, h) {
  const cx = ring.reduce((s2, p) => s2 + p[0], 0) / ring.length, cz = ring.reduce((s2, p) => s2 + p[1], 0) / ring.length;
  const a = ring[0], d = Math.hypot(a[0] - cx, a[1] - cz) || 1;
  const x = cx + ((a[0] - cx) / d) * k, z = cz + ((a[1] - cz) / d) * k;
  bag.aabb(bbrick(), x - 0.5, GROUND + h - 2.6, z - 0.5, x + 0.5, GROUND + h, z + 0.5);
  bag.aabb(bstone(), x - 0.58, GROUND + h, z - 0.58, x + 0.58, GROUND + h + 0.15, z + 0.58);
}
function heritage(bag, B, lod) {
  const ring = B.ring, admin = B.id === ADMIN, top = admin ? 5.5 : 5.3, slab = admin ? 4.9 : 4.3;
  const front = edgeFacing(ring, admin ? [0, 1] : [1, 0]);   // (the admin's south front, the concession's east front)
  const ccw = area2(ring) > 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.05) continue;
    let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
    if (!ccw) { nx = -nx; nz = -nz; }
    const isFront = front && a === front.a;
    const m = admin && !isFront ? bbrick() : bstone();
    bag.quad(m, [a[0], GROUND - 0.3, a[1]], [b[0], GROUND - 0.3, b[1]], [b[0], GROUND + top, b[1]], [a[0], GROUND + top, a[1]], [nx, 0, nz]);
    if (lod) continue;
    const E = { a, b, l, nx, nz };
    if (isFront && admin) {   // four tall windows and the door between them
      const c = l / 2, list = [[c - 0.95, c + 0.95, 0.3, 3.1]];
      for (const du of [-6.6, -3.3, 3.3, 6.6]) if (Math.abs(du) < c - 0.8) list.push([c + du - 0.55, c + du + 0.55, 0.35, 3.75]);
      openings(bag, E, list, bglass(), bmetal());
      bag.quad(bstone(), [a[0] + ((b[0] - a[0]) * (c - 2.6)) / l + nx * 1.2, GROUND + 0.3, a[1] + ((b[1] - a[1]) * (c - 2.6)) / l + nz * 1.2], [a[0] + ((b[0] - a[0]) * (c + 2.6)) / l + nx * 1.2, GROUND + 0.3, a[1] + ((b[1] - a[1]) * (c + 2.6)) / l + nz * 1.2],
        [a[0] + ((b[0] - a[0]) * (c + 2.6)) / l, GROUND + 0.3, a[1] + ((b[1] - a[1]) * (c + 2.6)) / l], [a[0] + ((b[0] - a[0]) * (c - 2.6)) / l, GROUND + 0.3, a[1] + ((b[1] - a[1]) * (c - 2.6)) / l], [0, 1, 0]);
    } else if (isFront) {     // the glazed bay
      const u0 = l * 0.38, u1 = l * 0.88, n = 6, list = [];
      for (let k = 0; k < n; k++) list.push([u0 + ((u1 - u0) * k) / n + 0.06, u0 + ((u1 - u0) * (k + 1)) / n - 0.06, 0.05, 3.0]);
      openings(bag, E, list, bglass(), bmetal());
    } else if (l > 5) {       // small windows round the other sides
      const n = Math.max(1, Math.floor(l / 4.5)), list = [];
      for (let k = 0; k < n; k++) { const u = ((k + 0.5) * l) / n; list.push([u - 0.45, u + 0.45, 1.2, 2.8]); }
      openings(bag, E, list, bglass(), bmetal());
    }
  }
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) bag.poly(broof(), [[ring[i][0], GROUND + slab + 0.2, ring[i][1]], [ring[j][0], GROUND + slab + 0.2, ring[j][1]], [ring[k][0], GROUND + slab + 0.2, ring[k][1]]], [0, 1, 0]);
  // the parapet's coping
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; seg(bag, bstone(), a, b, GROUND + top - 0.12, GROUND + top + 0.05, 0.4); }
  chimney(bag, ring, 3.0, admin ? 7.4 : 7.0);
  if (admin) chimney(bag, [...ring.slice(Math.floor(ring.length / 2)), ...ring.slice(0, Math.floor(ring.length / 2))], 3.0, 7.4);
}
function buildings(bag, lod) {
  for (const B of BUILDINGS) {
    const ring = B.ring;
    if (!ring || ring.length < 3) continue;
    if (B.id === ADMIN || B.id === CONCESSION) { heritage(bag, B, lod); continue; }
    const museum = MUSEUM.has(B.id), service = SERVICE.has(B.id);
    const h = B.h > 0 ? B.h : museum ? 5.0 : B.id === '888758634' ? 5.0 : B.name === 'Crown Cafe' ? 4.8 : 3.2;
    const y0 = GROUND - 0.3, y1 = GROUND + h;
    const wallM = service ? bbrick() : bstone();
    const ccw = area2(ring) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.05) continue;
      let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;
      if (!ccw) { nx = -nx; nz = -nz; }
      bag.quad(wallM, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz]);
      // glazing: the pavilions' walls glass between stone piers, the museum's in tall bands
      if (!service && !lod && l > 2.5) {
        const g0 = museum ? 0.6 : 0.35, g1 = museum ? Math.min(h - 1.2, 9.5) : h - 0.6, inset = museum ? 1.6 : 0.9;
        const n2 = Math.max(1, Math.round((l - 2 * inset) / (museum ? 6 : 3.2)));
        for (let k = 0; k < n2; k++) {
          const u0 = inset + ((l - 2 * inset) * k) / n2 + 0.25, u1 = inset + ((l - 2 * inset) * (k + 1)) / n2 - 0.25;
          const P = (u, y) => [a[0] + ((b[0] - a[0]) * u) / l + nx * 0.03, y, a[1] + ((b[1] - a[1]) * u) / l + nz * 0.03];
          bag.quad(bglass(), P(u0, GROUND + g0), P(u1, GROUND + g0), P(u1, GROUND + g1), P(u0, GROUND + g1), [nx, 0, nz]);
        }
      }
    }
    // the roof: the museum's green, the others' membrane with a parapet (the pavilions an overhang)
    const roofM = museum && B.id !== '888758570' ? turf() : broof();
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) bag.poly(roofM, [[ring[i][0], y1, ring[i][1]], [ring[j][0], y1, ring[j][1]], [ring[k][0], y1, ring[k][1]]], [0, 1, 0]);
    if (!museum && !service && !lod) {   // the pavilions' roof slab overhanging by 0.9 m
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const grow = ring.map(([x, z]) => { const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1; return [x + (dx / d) * 0.9, z + (dz / d) * 0.9]; });
      for (const [i, j, k] of tris) {
        bag.poly(broof(), [[grow[i][0], y1 + 0.32, grow[i][1]], [grow[j][0], y1 + 0.32, grow[j][1]], [grow[k][0], y1 + 0.32, grow[k][1]]], [0, 1, 0]);
        bag.poly(bmetal(), [[grow[i][0], y1 + 0.02, grow[i][1]], [grow[j][0], y1 + 0.02, grow[j][1]], [grow[k][0], y1 + 0.02, grow[k][1]]], [0, -1, 0]);
      }
      for (let i = 0; i < grow.length; i++) { const a = grow[i], b = grow[(i + 1) % grow.length]; bag.quad(bmetal(), [a[0], y1 + 0.02, a[1]], [b[0], y1 + 0.02, b[1]], [b[0], y1 + 0.32, b[1]], [a[0], y1 + 0.32, a[1]], null); }
    }
  }
}

// ---------------------------------------------------------------- the flagpole and its flag, the lamps
function flagTexture() {
  const cv = document.createElement('canvas'); cv.width = 380; cv.height = 200;
  const g = cv.getContext('2d');
  for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, (k * 200) / 13, 380, 200 / 13 + 0.5); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 152, (7 * 200) / 13);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) { g.beginPath(); g.arc(12 + c * 25.3 + (r % 2 ? 12.6 : 0), 10 + r * 11.7, 3.2, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flagpole(group, bag) {
  if (!FLAGPOLE) return;
  const [x, z, h] = FLAGPOLE, white = KM.paint(0xe8e6e0, { rough: 0.35, metal: 0.3 }), gold = KM.paint(0xd4a742, { rough: 0.25, metal: 1 });
  bag.rod(white, [x, GROUND, z], [x, GROUND + h, z], 0.16, 12, 0.07, true);
  bag.rod(gold, [x, GROUND + h, z], [x, GROUND + h + 0.5, z], 0.25, 10, 0.25, true);
  bag.rod(KM.concrete(0xb3aea4), [x, GROUND - 0.2, z], [x, GROUND + 0.6, z], 1.2, 12, 1.0, true);
  if (typeof document === 'undefined') return;
  const fw = 4.6, fh = 2.4, geo = new THREE.PlaneGeometry(fw, fh, 12, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + fw / 2) / fw; p.setZ(i, Math.sin(u * 5.5) * 0.18 * u); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8 }));
  m.position.set(x + fw / 2 + 0.12, GROUND + h - fh / 2 - 0.4, z); m.rotation.y = 0.6; m.name = 'liberty:flag'; m.castShadow = true;
  group.add(m);
}
function lamps(bag, lod) {
  if (lod) return;
  const post = KM.paint(0x23302a, { rough: 0.5, metal: 0.6 }), L = lamp();
  for (const w of WALKS) {
    if (w.kind !== 'footway' || w.w < 2.4 || w.pts.length < 2) continue;
    let carry = 8;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const a = w.pts[i], b = w.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.1) continue;
      const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l, off = w.w / 2 + 0.5;
      for (let d = carry; d < l; d += 26) {
        const x = a[0] + ux * d - uz * off, z = a[1] + uz * d + ux * off;
        bag.rod(post, [x, GROUND, z], [x, GROUND + 3.9, z], 0.09, 8, 0.06, false);
        bag.rod(post, [x, GROUND + 3.9, z], [x, GROUND + 4.05, z], 0.22, 8, 0.22, true);
        bag.rod(L, [x, GROUND + 4.05, z], [x, GROUND + 4.55, z], 0.2, 8, 0.15, true);
        bag.rod(post, [x, GROUND + 4.55, z], [x, GROUND + 4.75, z], 0.24, 8, 0.05, true);
      }
      carry = (((carry - l) % 26) + 26) % 26;
    }
  }
}

// ---------------------------------------------------------------- the trees: the city's tree pools (the instancer)
export function plantTrees(instancer) {
  if (!instancer || !instancer.pools) return 0;
  const tv = instancer.pools.has('treePTrunk');
  const forms = tv ? ['treeP', 'treeP2', 'treeM', 'treeQ', 'treeP', 'treeM'] : ['treeA', 'treeA2', 'treeA3', 'treeB'];
  let n = 0;
  for (const [x, z] of TREES) {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, r = h - Math.floor(h);
    const pool = forms[Math.floor(r * forms.length) % forms.length];
    const s = 0.85 + 0.3 * ((r * 7.13) % 1), rot = ((r * 13.7) % 1) * Math.PI * 2;
    const idT = instancer.claim(pool + 'Trunk', AX + x, GROUND, AZ + z, rot, s, s, s);
    const idC = instancer.claim(pool + 'Crown', AX + x, GROUND, AZ + z, rot, s, s, s, tv ? 0xffffff : 0x3f6d2e);
    if (idT >= 0 || idC >= 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------- the island's levels
export function islandGroup(lod) {
  const g = new THREE.Group();
  g.name = 'liberty:island:' + lod;
  groundParts(g);
  shrubs(g, lod);
  const bag = new GeoBag({ lod });
  edges(bag, lod);
  seawall(bag, lod);
  piers(bag, lod);
  buildings(bag, lod);
  lamps(bag, lod);
  flagpole(lod ? new THREE.Group() : g, bag);
  for (const [, L] of bag.flushChunks('liberty:island', {})) { L.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(L.group); }
  return g;
}
// the grass blades over the lawns near the lens (the park kit's field, one per tile the island touches)
export function islandGrass() {
  const R = 1.0, x0 = -230, z0 = -210, NX = 330, NZ = 300, mask = new Uint8Array(NX * NZ);
  for (const ring of LAWNS) {
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    for (let i = Math.max(0, Math.floor(Math.min(...xs) - x0)); i < Math.min(NX, Math.ceil(Math.max(...xs) - x0)); i++)
      for (let j = Math.max(0, Math.floor(Math.min(...zs) - z0)); j < Math.min(NZ, Math.ceil(Math.max(...zs) - z0)); j++)
        if (inside(ring, x0 + i + 0.5, z0 + j + 0.5)) mask[j * NX + i] = 1;
  }
  // (the walks cross the lawns: no blades on them)
  for (const w of WALKS) for (let i = 0; i + 1 < w.pts.length; i++) {
    const a = w.pts[i], b = w.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d <= l; d += 0.5) for (let o = -w.w / 2 - 0.3; o <= w.w / 2 + 0.3; o += 0.5) {
      const x = a[0] + ((b[0] - a[0]) * d) / l - ((b[1] - a[1]) / l) * o, z = a[1] + ((b[1] - a[1]) * d) / l + ((b[0] - a[0]) / l) * o;
      const ii = Math.floor(x - x0), jj = Math.floor(z - z0);
      if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ) mask[jj * NX + ii] = 0;
    }
  }
  const lawnY = (wx, wz) => { const i = Math.floor(wx - AX - x0), j = Math.floor(wz - AZ - z0); return i >= 0 && j >= 0 && i < NX && j < NZ && mask[j * NX + i] ? GROUND + 0.085 : null; };
  void R;
  const out = new THREE.Group();
  out.name = 'liberty:grass';
  for (const [tx, tz] of [[-13, 19], [-13, 20], [-12, 19], [-12, 20]]) out.add(grassField(`liberty:grass:${tx}_${tz}`, tx * 512, tz * 512, lawnY));
  return out;
}
export const ISLAND = { AX, AZ };
