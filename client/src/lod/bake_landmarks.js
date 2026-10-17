// The landmark registry's L6 silhouettes, drawn by OUR builders (city/landmarks.js on the compiled footprint records;
// city/bridgeKit.js on the compiled bridge decks) and simplified with meshoptimizer to at most LIMIT triangles.
// Served by Vite as src/lod/bake_landmarks.html and driven by tools/lod/bake_landmarks.mjs, which writes
// client/public/data/landmarks.json and data/lod16/landmarks_l6.bin.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { LANDMARKS } from '../shared/landmarkSpec.js';
import { project, TILE } from '../shared/geo.js';
import { parseTile, buildingsOf } from '../world/tiledata.js';
import { BUILDERS } from '../city/landmarks.js';
import { buildBridges } from '../city/bridgeKit.js';
import { _internal as TW } from '../world/towers.js';

const LIMIT = 2000;
// the first registry: the skyline towers, the civic and campus landmarks, the bridges in our data
const BUILDINGS = [
  ['empireState', 1], ['chrysler', 1], ['oneWTC', 1], ['thirtyRock', 1], ['metLife', 1], ['woolworth', 1], ['oneVanderbilt', 1],
  ['p432park', 1], ['cpTower', 1], ['steinway', 1], ['one57', 1], ['hearst', 1], ['citigroup', 1], ['p30hudson', 1], ['boaTower', 1],
  ['p56leonard', 1], ['p8spruce', 1], ['p40wall', 1], ['p70pine', 1], ['municipalBldg', 1], ['unSecretariat', 1], ['seagram', 2],
  ['oneTimesSquare', 2], ['flatiron', 2], ['grandCentral', 2], ['nypl', 2], ['stPatricks', 2], ['stJohnDivine', 2],
  ['riversideChurch', 2], ['lowLibrary', 2], ['grantsTomb', 2], ['apolloTheater', 2],
];
// ==== BR38: every bridge the kit builds (the five boroughs' and the New Jersey crossings), so each keeps its silhouette in
// the persistent tier (verrazzano and the New Jersey crossings: five-borough sets)
const BRIDGES = ['brooklyn', 'manhattanBr', 'williamsburg', 'queensboro', 'gwb', 'hellgate', 'verrazzano', 'rfk', 'whitestone', 'throgs',
  'bayonne', 'goethals', 'outerbridge', 'henryHudson', 'washingtonBr', 'hamiltonBr', 'highBr', 'macombs', 'br145', 'madisonAv', 'thirdAv',
  'willis', 'universityHts', 'broadwayBr', 'rooseveltBr', 'wardsFoot'];
// night lighting facts carried by the registry for the renderers (crowns, cables); the persistent tier uses the lit share
const NIGHT = {
  empireState: { crown: 'floodlit tiers, colour programme', mast: 'red beacon' }, chrysler: { crown: 'chevron lights' },
  oneWTC: { spire: 'white beacon' }, brooklyn: { cables: 'necklace lamps' }, manhattanBr: { cables: 'necklace lamps' },
  williamsburg: { cables: 'necklace lamps' }, queensboro: { cables: 'necklace lamps' }, gwb: { cables: 'necklace lamps', towers: 'floodlit' },
  verrazzano: { cables: 'necklace lamps' }, whitestone: { cables: 'necklace lamps' }, throgs: { cables: 'necklace lamps' },
  rfk: { cables: 'necklace lamps', towers: 'lanterns' }, hellgate: { towers: 'floodlit' },
  apolloTheater: { marquee: 'lit marquee and blade sign' },
};

const tileCache = new Map();
async function tile(key) {
  if (tileCache.has(key)) return tileCache.get(key);
  let t = null;
  try { const r = await fetch(`/tiles/t_${key}.bin`); if (r.ok && (r.headers.get('content-type') || '').indexOf('html') < 0) t = parseTile(await r.arrayBuffer()); } catch { t = null; }
  tileCache.set(key, t);
  return t;
}
async function findRecord(spec) {
  const [px, pz] = project(spec.lon, spec.lat);
  const tx = Math.floor(px / TILE), tz = Math.floor(pz / TILE);
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const key = `${tx + dx}_${tz + dz}`;
    const t = await tile(key);
    if (!t) continue;
    const [ox, oz] = t.header.origin;
    for (const b of buildingsOf(t)) {
      if (Math.abs(b.landmarkId) !== spec.id) continue;
      const ring = [];
      for (let i = 0; i < b.len; i++) ring.push([t.S.bldgXZ[(b.start + i) * 2] + ox, t.S.bldgXZ[(b.start + i) * 2 + 1] + oz]);
      return { b, ring, tileKey: key };
    }
  }
  return null;
}
const lin2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
// every visible mesh of a group as world triangles with sRGB vertex colours
function harvest(root) {
  root.updateMatrixWorld(true);
  const P = [], C = [];
  const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), im = new THREE.Matrix4();
  // (BR38: a THREE.LOD gives only its coarsest level: the bridge kit builds each bridge as LOD pieces, full and coarse)
  const visit = (o, f) => { f(o); const ch = o.isLOD && o.levels && o.levels.length ? [o.levels[o.levels.length - 1].object] : o.children; for (const c of ch) visit(c, f); };
  visit(root, (o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const g = o.geometry, pos = g.attributes.position, col = g.attributes.color, idx = g.index;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((mt) => !mt || mt.visible === false || (mt.transparent && mt.opacity < 0.3))) return;
    const groups = g.groups && g.groups.length && Array.isArray(o.material) ? g.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    const nInst = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < nInst; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); m4.multiplyMatrices(o.matrixWorld, im); } else m4.copy(o.matrixWorld);
      for (const gr of groups) {
        const mt = mats[gr.materialIndex] || mats[0];
        if (!mt || mt.visible === false) continue;
        const bc = mt.userData && mt.userData.brBase ? mt.userData.brBase : mt.color;   // (BR38: the kit's stone: its builder's colour, not the colour scaled for its maps)
        const base = bc ? [lin2s(bc.r), lin2s(bc.g), lin2s(bc.b)] : [0.7, 0.7, 0.7];
        const end = Math.min(gr.start + gr.count, idx ? idx.count : pos.count);
        for (let q = gr.start; q + 2 < end; q += 3) {
          for (let w = 0; w < 3; w++) {
            const vi = idx ? idx.getX(q + w) : q + w;
            v.fromBufferAttribute(pos, vi).applyMatrix4(m4);
            P.push(v.x, v.y, v.z);
            let r = base[0], gg = base[1], bb = base[2];
            if (col && mt.vertexColors) { r *= lin2s(col.getX(vi)); gg *= lin2s(col.getY(vi)); bb *= lin2s(col.getZ(vi)); }
            C.push(r, gg, bb);
          }
        }
      }
    }
  });
  return { P, C };
}
// weld (1 cm), simplify to the limit (exact first, then sloppy clustering for kits of disconnected parts), unweld per face
function simplifyTo(P, C, limit, target = 0.02, flags = ['Prune']) {
  const map = new Map(), wp = [], wc = [], ind = [];
  for (let i = 0; i < P.length / 3; i++) {
    const key = `${Math.round(P[i * 3] * 100)},${Math.round(P[i * 3 + 1] * 100)},${Math.round(P[i * 3 + 2] * 100)}`;
    let id = map.get(key);
    if (id === undefined) { id = wp.length / 3; map.set(key, id); wp.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); wc.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]); }
    ind.push(id);
  }
  // drop degenerate triangles
  const I0 = [];
  for (let t = 0; t < ind.length; t += 3) if (ind[t] !== ind[t + 1] && ind[t + 1] !== ind[t + 2] && ind[t] !== ind[t + 2]) I0.push(ind[t], ind[t + 1], ind[t + 2]);
  const pos = new Float32Array(wp);
  let I = new Uint32Array(I0), err = 0, how = 'none';
  if (I.length / 3 > limit) {
    const [s1, e1] = MeshoptSimplifier.simplify(I, pos, 3, limit * 3, target, flags);
    I = s1; err = e1; how = 'simplify';
    let tries = 0, te = 0.004;
    while (I.length / 3 > limit && tries++ < 12) {
      const [s2, e2] = MeshoptSimplifier.simplifySloppy(new Uint32Array(I0), pos, 3, null, limit * 3, te);
      I = s2; err = e2; how = 'sloppy'; te *= 1.6;
      if (I.length / 3 <= limit) break;
    }
  }
  return { pos, col: wc, I, err, how };
}
function pack(name, s, extra) {
  // per-face vertices (flat shading by derivatives, uv per face): FW14 window grid on walls, the white texel on roofs
  const { pos, col, I } = s;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let k = 0; k < I.length; k++) { const i = I[k]; x0 = Math.min(x0, pos[i * 3]); x1 = Math.max(x1, pos[i * 3]); y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
  const origin = [(x0 + x1) / 2, Math.floor(y0), (z0 + z1) / 2];
  const P = [], Cc = [], U = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const r = (col[a * 3] + col[b * 3] + col[c * 3]) / 3, g = (col[a * 3 + 1] + col[b * 3 + 1] + col[c * 3 + 1]) / 3, bb = (col[a * 3 + 2] + col[b * 3 + 2] + col[c * 3 + 2]) / 3;
    for (const i of [a, b, c]) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      P.push(Math.round((x - origin[0]) * 8), Math.round((y - origin[1]) * 8), Math.round((z - origin[2]) * 8));
      Cc.push(Math.round(r * 255), Math.round(g * 255), Math.round(bb * 255), extra.lit);
      if (Math.abs(ny) > 0.7) U.push(0.06, 0.24);
      else { const tl = Math.hypot(nx, nz) || 1, tx = -nz / tl, tz = nx / tl; U.push((x * tx + z * tz) / 12, y / 15.2); }
    }
  }
  return { origin, P, C: Cc, U, nv: P.length / 3, bbox: [x0, y0, z0, x1, y1, z1] };
}
function prismGroup(ring, y0, y1, rgb) {
  const g = new THREE.Group();
  const flat = [];
  const pts = [];
  for (const [x, z] of ring) { flat.push(x, z); pts.push(new THREE.Vector2(x, -z)); }
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace) }));
  g.add(m);
  return g;
}

window.__BAKE = async () => {
  await MeshoptSimplifier.ready;
  const out = [], log = [];
  for (const [key, priority] of BUILDINGS) {
    const spec = LANDMARKS.find((l) => l.key === key || (key === 'apolloTheater' && l.id === 8));
    if (!spec) { log.push(`${key}: no spec`); continue; }
    const rec = await findRecord(spec);
    if (!rec) { log.push(`${key}: no compiled footprint with landmark id ${spec.id}`); continue; }
    const { b, ring } = rec;
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    const local = ring.map(([x, z]) => [x - cx, z - cz]);
    const ctx = { footprint: local, height: b.height, floors: b.floors, floorH: b.floorH, groundY: b.baseY, obb: TW.ringOBB(local), THREE, cx, cz, padY: null };
    const root = new THREE.Group();
    let g = null;
    try { g = BUILDERS[key] ? BUILDERS[key](ctx) : null; } catch (e) { log.push(`${key}: builder threw ${e && e.message}`); }
    if (g) { g.position.set(cx, b.baseY, cz); root.add(g); }
    if (spec.mode === 'decorate' || !g) root.add(prismGroup(ring, b.baseY - 1, b.baseY + b.height, [b.r, b.g, b.b]));
    const H = harvest(root);
    const tris0 = H.P.length / 9;
    const s = simplifyTo(H.P, H.C, LIMIT);
    const pk = pack(key, s, { lit: Math.round(b.lit * 255) });
    out.push({ key, name: spec.name, kind: b.height > 100 ? 'tower' : 'building', lmId: spec.id, mode: spec.mode, tile: rec.tileKey, priority, night: NIGHT[key] || null, tris0, tris: s.I.length / 3, err: s.err, how: s.how, ...pk });
    log.push(`${key}: ${tris0} -> ${s.I.length / 3} (${s.how}, err ${s.err.toFixed(4)})`);
  }
  // LB39: the Statue of Liberty (city/liberty.js: the statue's coarsest level, the pedestal's and Fort Wood's; the island left
  // out), resident in the client like the bridges (`drawnBy`)
  try {
    const lib = await import('../city/liberty.js');
    const root = lib.buildLiberty(null, { island: false });
    await lib.LIBERTY_READY;
    const H = harvest(root);
    const tris0 = H.P.length / 9;
    const s = simplifyTo(H.P, H.C, LIMIT, 0.003, []);
    const pk = pack('statueOfLiberty', s, { lit: 0 });
    out.push({ key: 'statueOfLiberty', name: 'Statue of Liberty, pedestal and Fort Wood', kind: 'monument', lmId: 67, mode: 'replace', tile: '-13_20', priority: 1,
      night: { statue: 'floodlit', torch: 'gilded flame lit' }, drawnBy: 'liberty', tris0, tris: s.I.length / 3, err: s.err, how: s.how, ...pk });
    log.push(`statueOfLiberty: ${tris0} -> ${s.I.length / 3} (${s.how}, err ${s.err.toFixed(4)})`);
  } catch (e) { log.push('statueOfLiberty: ' + (e && e.stack)); }
  // bridges (one merged child per bridge with a deck, in bridges.json order)
  try {
    const bridges = await (await fetch(`/${new URLSearchParams(location.search).get('tiles') || 'tiles'}/bridges.json`)).json();   // (BR38: ?tiles=, a staged set)
    const grp = buildBridges(bridges, new THREE.Scene(), null);
    const withDeck = bridges.filter((br) => br.deck && br.deck.length >= 2);
    withDeck.forEach((br, k) => {
      if (!BRIDGES.includes(br.key)) return;
      const child = grp.children[k];
      if (!child) { log.push(`${br.key}: no mesh`); return; }
      const H = harvest(child);
      const tris0 = H.P.length / 9;
      // (BR38: a bridge is long and thin: an error of 2 % of its length (40 m on the Queensboro) pruned its trusses away;
      // 0.15 % and twice the triangles keep its towers, trusses and cables' lines)
      const s = simplifyTo(H.P, H.C, LIMIT * 2, 0.0015, []);
      const pk = pack(br.key, s, { lit: 0 });
      out.push({ key: br.key, name: br.name, kind: 'bridge', feature: `bridge:${br.key}`, priority: 1, night: NIGHT[br.key] || null, drawnBy: 'bridgeKit', tris0, tris: s.I.length / 3, err: s.err, how: s.how, ...pk });
      log.push(`${br.key}: ${tris0} -> ${s.I.length / 3} (${s.how}, err ${s.err.toFixed(4)})`);
    });
  } catch (e) { log.push('bridges: ' + (e && e.stack)); }
  return { out, log };
};
// live-captured landmarks (tools/lod/bake_landmarks.mjs --live harvests what the client draws, e.g. the Central Park kits'
// Bethesda Terrace and Belvedere Castle, and hands the triangles here to be simplified and packed the same way)
window.__PACK = async (P, C, lit) => {
  await MeshoptSimplifier.ready;
  const s = simplifyTo(P, C, LIMIT);
  return { tris0: P.length / 9, tris: s.I.length / 3, err: s.err, how: s.how, ...pack('', s, { lit }) };
};
window.__BAKE_READY = true;
