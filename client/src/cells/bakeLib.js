// The page side of the cell baker (tools/cells/bake.mjs; contract docs/specs/cell-package.md, v0). Loaded into the live
// client by the baker with a dynamic import, after the city around the region has streamed in. It holds every level of
// detail at its finest over the region (the film policy's path, window.__FP37), dresses every building whose footprint
// centroid is in a baked cell, then cuts the static city into 128 m cells:
//   - meshes: every triangle goes to the cell of its plan centroid, merged per (material, attributes, flags) per cell;
//   - the dresser's buildings: whole, to the cell of the building's centroid;
//   - instanced sets (the instancer's pools, other InstancedMeshes): every instance to the cell of its position.
// The loader (cells/cellLoader.js) takes the same things out of the live city with the same tests (cells/cellRules.js).
import * as THREE from 'three';
import { CELL, cellKey, cellOrigin, skipReason, isDynamicPool, isGlowPool, DYN_UNIFORMS, triXZ, materialKey, materialSignature, SCHEMA } from './cellRules.js';
import { r1aSignText } from '../city/signText.js';
import { ENV } from '../world/materials.js';
// a uniform that holds the page's state, not the look: listed as { dynamic: true } and not read (two bakes of the same
// inputs differ in nothing else): the near mask and hide masks, the trees' dither frames, the clocks by their objects
const dynUniform = (k, u) => DYN_UNIFORMS.has(k) || /^uDith\d*$/.test(k) || (!!u && (u === ENV.windT || u === ENV.time));

const W = () => window;
const eng = () => W().__ENGINE, str = () => W().__STREAMER, ins = () => W().__INST || W().__INSTANCER, drs = () => W().__LD13;

// ---------------------------------------------------------------- classes (the segmentation tables)
let SEG = null;
async function loadSeg() {
  if (SEG) return SEG;
  const m = await import('../perception/segRender.js');
  const CID = {}; for (const c of m.CLASSES) CID[c.name] = c.id;
  SEG = { CID, classes: m.CLASSES, classifyPool: m.r1aClassifyPool || null };
  return SEG;
}
// mirrors segRender.js fallbackClass (minus its terrain-lift test, which needs the streamer: here, lift is measured below)
function meshClass(o, mat, ctx) {
  const C = SEG.CID;
  if (ctx.groundMat && mat === ctx.groundMat) return -1;                    // per vertex: the matId attribute
  if (mat && mat.userData && mat.userData.isFacade) return C.building;
  const said = o.userData && o.userData.segClass;
  if (said && C[said] != null) return C[said];
  if (/^(tf31|bp31):/.test(o.name || '')) return /:(shrub|leaf)$/.test(o.name) ? C.vegetation : o.name === 'bp31:glow' ? C.street_light : C.street_furniture;
  const n = `${o.name || ''}|${(o.parent && o.parent.name) || ''}|${(mat && mat.name) || ''}`;
  if (/bridge/i.test(o.name || '') || /bridge/i.test((o.parent && o.parent.name) || '')) return C.bridge;
  if (/sign|text|blade/i.test(n)) return C.street_sign;
  if (/tree|leaf|foliage|shrub|hedge|grass|lawn/i.test(n)) return C.vegetation;
  if (ctx.lift !== null && ctx.lift > 1.5 && !/walk|step|stair|plaza|ramp/i.test(o.name || '')) return /vk[-:]|viaduct|elevated/i.test(n) ? C.bridge : C.building;
  if (/walk|step|stair|plaza|pave|path|terrace|ramp/i.test(n)) return C.sidewalk;
  if (/wall|rail|fence|gate|lamp|urn|monument|bench|bollard/i.test(n)) return C.street_furniture;
  if (ctx.flat) return C.sidewalk;
  return C.building;
}
function poolClass(name) {
  const C = SEG.CID;
  if (SEG.classifyPool) return SEG.classifyPool(name);
  if (/^tree[A-Z]?\d*(Trunk|Crown)$/.test(name)) return C.vegetation;
  return C.street_furniture;
}

// ---------------------------------------------------------------- the bake region and the holds
let REGION = null;   // { cells: Set(key), list: [[cx, cz]], x0, z0, x1, z1 }
const inRegionCell = (x, z) => { const k = cellKey(Math.floor(x / CELL), Math.floor(z / CELL)); return REGION.cells.has(k) ? k : null; };
// (city v2, 2026-10-14: a building whose footprint reaches a baked cell, its centre in it or not. Its owner cell (the one
// under its centre) writes it whole; every cell its footprint crosses must have it built so its tile facade is hidden
// there too: with the centre alone, a building straddling two bake batches came out dressed in its owner's package and
// as the tile's massing in its neighbour's, and an overlap pass over every cell deleted the massing afterwards)
const FOOT_PAD = 1.0;
const reachesRegion = (rec) => {
  if (!rec || !rec.ring || !rec.ring.length) return !!inRegionCell(rec.cx, rec.cz);
  if (rec.__bb === undefined) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of rec.ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    rec.__bb = [x0 - FOOT_PAD, z0 - FOOT_PAD, x1 + FOOT_PAD, z1 + FOOT_PAD];
  }
  const [x0, z0, x1, z1] = rec.__bb;
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) if (REGION.cells.has(cellKey(i, j))) return true;
  return false;
};

// the cells to bake; holds the finest level over them (FP37 path: a 6 m grid at eye height over the cells, 16 m beyond)
export async function prepare({ cells, step = 6 }) {
  await loadSeg();
  const set = new Set(), list = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [cx, cz] of cells) {
    set.add(cellKey(cx, cz)); list.push([cx, cz]);
    x0 = Math.min(x0, cx * CELL); z0 = Math.min(z0, cz * CELL); x1 = Math.max(x1, (cx + 1) * CELL); z1 = Math.max(z1, (cz + 1) * CELL);
  }
  REGION = { cells: set, list, x0, z0, x1, z1 };
  const S = str(), pts = [];
  for (const [cx, cz] of list) {
    for (let z = cz * CELL - 16; z <= (cz + 1) * CELL + 16; z += step) for (let x = cx * CELL - 16; x <= (cx + 1) * CELL + 16; x += step) {
      const g = S && S.terrainAt ? S.terrainAt(x, z) : null;
      pts.push(x, (Number.isFinite(g) ? g : 3) + 1.7, z);
    }
  }
  const P = new Float64Array(pts);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 1; i < P.length; i += 3) { y0 = Math.min(y0, P[i]); y1 = Math.max(y1, P[i]); }
  W().__FP37 = { v: ((W().__FP37 && W().__FP37.v) || 0) + 1, pts: P, y0, y1 };
  // the streamer and the dresser grow and never drop (FP26's 'grow' hold)
  if (W().__DRESS_HOLD) W().__DRESS_HOLD('grow');
  return { cells: list.length, fp37: P.length / 3, bbox: [x0, z0, x1, z1] };
}

// the dresser: every dressable building whose footprint reaches a baked cell (reachesRegion), and nothing else (keep: the client's own ring
// stays as it is and the region's buildings are added to it: tools/cells/parity.mjs's liveL0 reference)
export function dressRegion({ keep = false } = {}) {
  const D = drs();
  if (!D) return { dresser: false };
  D.hold = 'grow';
  if (!keep) {
    for (const k of [...D.active.keys()]) D._undress(k);
    D.queue.length = 0; D._queued.clear(); D._evict = null;
    D._acc = -1e12;                                      // no rescans: the queue is ours
  }
  let n = 0;
  for (const t of D.tiles.values()) for (const r of t.recs) {
    if (!reachesRegion(r) || D.active.has(r.key) || D._queued.has(r.key)) continue;
    D.queue.push(r); D._queued.add(r.key); n++;
  }
  // TW (towers lane): the tower kit (world/towerKit.js) builds every tower whose footprint reaches a baked cell, full level
  const K = W().__TW_KIT;
  const tw = K ? K.setRegion((x, z, rec) => (rec ? reachesRegion(rec) : !!inRegionCell(x, z))) : 0;
  return { queued: n, towers: tw };
}
export function status() {
  const D = drs(), S = str();
  const K = W().__TW_KIT, twq = K && K.region ? K.queue.length + (K.dirty ? 1 : 0) : 0;   // TW: the tower kit's queue
  return { queue: (D ? D.queue.length : 0) + twq, active: D ? D.active.size : 0, built: D ? D.stats.built : 0, skipped: D ? D.stats.skipped : 0, towers: K ? K.active.size : 0,
    idle: S ? S.idle() : false, tiles: S ? S.tiles.size : 0, pending: S ? S.stats.pending : 0 };
}

// ---------------------------------------------------------------- export
// accumulators: one per (cell, group key); a group is one merged primitive of one material
const SKIP = {};
const skip = (why) => { SKIP[why] = (SKIP[why] || 0) + 1; };
const typeName = (a) => a instanceof Float32Array ? 'f32' : a instanceof Uint8Array ? 'u8' : a instanceof Int8Array ? 'i8' : a instanceof Uint16Array ? 'u16' : a instanceof Int16Array ? 'i16' : null;
const CTOR = { f32: Float32Array, u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array };
// an attribute's stored type: kept when it is a plain array glTF can hold, else float32 of what the shader reads
function attrType(a) {
  if (a.isInterleavedBufferAttribute) return 'f32';
  const t = typeName(a.array);
  if (!t) return 'f32';
  if (a.gpuType !== undefined && a.gpuType !== THREE.FloatType && t !== 'f32') return 'f32';   // integer attributes: as numbers
  return t;
}
// a reader of an attribute's values as stored: raw for the kept types (and plain float32), else what the shader reads
function reader(A, t) {
  const raw = !A.isInterleavedBufferAttribute && (t !== 'f32' || (A.array instanceof Float32Array && !A.normalized));
  if (raw) { const R = A.array, s = A.itemSize; return (vi, c) => R[vi * s + c]; }
  return (vi, c) => (c === 0 ? A.getX(vi) : c === 1 ? A.getY(vi) : c === 2 ? A.getZ(vi) : A.getW(vi));
}
const ACC = new Map();   // `${cell}|${gk}` -> acc
const MATS = new Map();  // material id (uuid, @tile for a tile facade) -> { m, tileKey }; keys are given at the end
const INST = new Map();  // `${cell}|${ik}` -> inst acc
function regMat(m, tileKey) {
  const id = m.uuid + (m.userData && m.userData.isFacade && tileKey ? '@' + tileKey : '');
  if (!MATS.has(id)) MATS.set(id, { m, tileKey });
  return id;
}
// the keys: a material's level-0 key, or where several materials of the export share it, the key with its files and
// sizes (level 1), or with its pixel samples (level 2) where those are shared too
function finalKeys() {
  const out = new Map();
  let shared = 0;
  const group = (ids, level) => { const g = new Map(); for (const id of ids) { const e = MATS.get(id); const k = materialKey(e.m, e.tileKey, level); if (!g.has(k)) g.set(k, []); g.get(k).push(id); } return g; };
  for (const [k0, ids0] of group([...MATS.keys()], 0)) {
    if (ids0.length === 1) { out.set(ids0[0], k0); continue; }
    shared += ids0.length;
    for (const [k1, ids1] of group(ids0, 1)) {
      if (ids1.length === 1) { out.set(ids1[0], k1); continue; }
      for (const id of ids1) { const e = MATS.get(id); out.set(id, materialKey(e.m, e.tileKey, 2)); }
    }
  }
  return { keys: out, shared };
}
// the street-name blades' text per cell (cell-package.md section 4, `cellTexture`): the page's atlas of names hands out
// its slots in the order the tiles come in, so its layout differs between two page loads. Each baked cell gets the names
// its blades show, one slot each in name order, painted as the page paints them, and the triangles' UVs moved onto that
// texture; the live meshes are hidden for the export and shown again when the next batch begins.
let SIGN_UNDO = null;
function signTextUndo() { if (SIGN_UNDO) { SIGN_UNDO(); SIGN_UNDO = null; } }
function splitSignText() {
  const R = r1aSignText, live = R && R.mat();
  if (!live || !live.map) return { cells: 0, tris: 0, lost: 0 };
  const COLS = R.AW / R.CW, byIdx = new Map();
  for (const [k, sl] of R.slots) byIdx.set(Math.round((1 - sl.v1) * R.AH / R.CH) * COLS + Math.floor(sl.uc * R.AW / R.CW), [k, sl]);
  const groups = new Map(), hidden = [], v = new THREE.Vector3();
  let lost = 0, layers = null, renderOrder = 2;
  eng().scene.traverseVisible((o) => {
    if (!o.isMesh || o.material !== live) return;
    const P = o.geometry.attributes.position, U = o.geometry.attributes.uv;
    if (!P || !U || o.geometry.index) return;
    const tp = [];
    for (let q = 0; q + 6 <= P.count; q += 6) {   // a quad: two triangles, one slot
      let mu = 0, mv = 0;
      for (let i = 0; i < 6; i++) { mu += U.getX(q + i); mv += U.getY(q + i); }
      const hit = byIdx.get(Math.floor((1 - mv / 6) * R.AH / R.CH) * COLS + Math.floor((mu / 6) * R.AW / R.CW));
      for (const t0 of [q, q + 3]) {
        const p = new Float32Array(9), uv = new Float32Array(6);
        let cx = 0, cz = 0;
        for (let i = 0; i < 3; i++) { v.fromBufferAttribute(P, t0 + i).applyMatrix4(o.matrixWorld); p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; cx += v.x; cz += v.z; uv[i * 2] = U.getX(t0 + i); uv[i * 2 + 1] = U.getY(t0 + i); }
        const cell = inRegionCell(cx / 3, cz / 3);
        if (!cell) continue;
        if (!hit) { lost++; continue; }
        tp.push([cell, { p, uv, key: hit[0], sl: hit[1] }]);
      }
    }
    if (!tp.length) return;
    for (const [cell, t] of tp) { if (!groups.has(cell)) groups.set(cell, []); groups.get(cell).push(t); }
    hidden.push(o); layers = o.layers.mask; renderOrder = o.renderOrder;
  });
  const made = [];
  let tris = 0;
  for (const [cell, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const keys = [...new Set(list.map((t) => t.key))].sort(), row = new Map(keys.map((k, i) => [k, i]));
    const W = R.CW, H = R.CH * keys.length;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    keys.forEach((k, i) => R.paint(c2, k, 0, i * R.CH));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = live.map.colorSpace; tex.anisotropy = live.map.anisotropy; tex.name = 'signText:' + cell;
    const m = live.clone(); m.map = tex; m.userData = { ...live.userData, cellTexture: cell };
    const pos = new Float32Array(list.length * 9), uv = new Float32Array(list.length * 6);
    list.forEach((t, j) => {
      const r = row.get(t.key), sl = t.sl;
      pos.set(t.p, j * 9);
      for (let i = 0; i < 3; i++) {
        uv[j * 6 + i * 2] = 0.5 + (t.uv[i * 2] - sl.uc) * R.AW / W;
        uv[j * 6 + i * 2 + 1] = (1 - (r + 1) * R.CH / H) + (t.uv[i * 2 + 1] - sl.v0) * R.AH / H;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'signText:' + cell; mesh.renderOrder = renderOrder; if (layers !== null) mesh.layers.mask = layers;
    eng().scene.add(mesh); mesh.updateMatrixWorld(true);
    made.push(mesh); tris += list.length;
  }
  for (const o of hidden) o.visible = false;
  SIGN_UNDO = () => {
    for (const o of hidden) o.visible = true;
    for (const mesh of made) { eng().scene.remove(mesh); mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose(); }
  };
  return { cells: made.length, tris, lost };
}
function acc(cell, gk, init) {
  const k = cell + '|' + gk;
  let a = ACC.get(k);
  if (!a) { a = { cell, gk, ...init, attrs: init.attrs.map((d) => ({ ...d, chunks: [] })), idx: [], nv: 0, nt: 0 }; ACC.set(k, a); }
  return a;
}
// add the triangles `tris` (flat vertex indices, 3 per triangle) of geometry g, world matrix M, to accumulator a
function addPiece(a, g, M, tris, origin, flip, consts = null) {
  const remap = new Map(), src = [];
  const out = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    let r = remap.get(v);
    if (r === undefined) { r = src.length; remap.set(v, r); src.push(v); }
    out[i] = r + a.nv;
  }
  if (flip) for (let i = 0; i < out.length; i += 3) { const t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t; }
  const e = M.elements, nm = new THREE.Matrix3().getNormalMatrix(M).elements;
  const [ox, oz] = origin;
  for (const d of a.attrs) {
    const A = g.attributes[d.name], s = d.itemSize, n = src.length;
    if (!A || (consts && d.name in consts)) { const arr = new CTOR[d.type](n * s); arr.fill(consts && d.name in consts ? consts[d.name] : 0); d.chunks.push(arr); continue; }
    const arr = new CTOR[d.type](n * s), get = reader(A, d.type);
    if (d.name === 'position') {
      for (let i = 0; i < n; i++) {
        const v = src[i], x = get(v, 0), y = get(v, 1), z = get(v, 2), o = i * 3;
        arr[o] = e[0] * x + e[4] * y + e[8] * z + e[12] - ox; arr[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; arr[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] - oz;
      }
    } else if ((d.name === 'normal' || d.name === 'tangent') && s >= 3 && d.type === 'f32') {
      const T = d.name === 'normal' ? [nm[0], nm[3], nm[6], nm[1], nm[4], nm[7], nm[2], nm[5], nm[8]] : [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
      for (let i = 0; i < n; i++) {
        const v = src[i], x0 = get(v, 0), y0 = get(v, 1), z0 = get(v, 2), o = i * s;
        const x = T[0] * x0 + T[1] * y0 + T[2] * z0, y = T[3] * x0 + T[4] * y0 + T[5] * z0, z = T[6] * x0 + T[7] * y0 + T[8] * z0;
        const l = Math.hypot(x, y, z) || 1;
        arr[o] = x / l; arr[o + 1] = y / l; arr[o + 2] = z / l; if (s > 3) arr[o + 3] = get(v, 3);
      }
    } else {
      for (let i = 0; i < n; i++) { const v = src[i], o = i * s; for (let c = 0; c < s; c++) arr[o + c] = get(v, c); }
    }
    d.chunks.push(arr);
  }
  a.idx.push(out);
  a.nv += src.length; a.nt += tris.length / 3;
}
function attrSig(g) {
  const L = [];
  for (const name of Object.keys(g.attributes).sort()) {
    const A = g.attributes[name];
    if (!A || A.isInstancedBufferAttribute || (A.data && A.data.isInstancedInterleavedBuffer)) continue;
    const t = name === 'position' || name === 'normal' || name === 'tangent' ? 'f32' : attrType(A);
    L.push({ name, type: t, itemSize: A.itemSize, normalized: !!A.normalized && t !== 'f32' });
  }
  return L;
}
const sigKey = (L) => L.map((d) => `${d.name}:${d.type}:${d.itemSize}${d.normalized ? 'n' : ''}`).join(',');
function liftAbove(o, g) {
  const S = str();
  if (!S || !S.terrainAt) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox; if (!bb) return null;
  const e = o.matrixWorld.elements; let y0 = 1e9, sx = 0, sz = 0, k = 0;
  for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13]; if (wy < y0) y0 = wy;
    sx += e[0] * x + e[4] * y + e[8] * z + e[12]; sz += e[2] * x + e[6] * y + e[10] * z + e[14]; k++;
  }
  const t = S.terrainAt(sx / k, sz / k);
  return t === null || t === undefined ? null : y0 - t;
}
// ---------------------------------------------------------------- textures: every map and shader-patch texture of the
// exported materials, read back from the GPU (any source: files, canvases, data, KTX2) by readTextures()
const TEX = new Map();   // texture uuid -> { id, t }
const TEX_DONE = new Set();   // ids read back already in this page (a later batch reads only the new ones)
function texRef(t) {
  if (!t || !t.isTexture || t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isCubeTexture) return null;
  let e = TEX.get(t.uuid);
  if (!e) { e = { id: TEX.size, t }; TEX.set(t.uuid, e); }
  return e.id;
}
const STUB = { v: '#include <common>\n#include <uv_pars_vertex>\n#include <begin_vertex>\n#include <beginnormal_vertex>\n#include <worldpos_vertex>\n#include <project_vertex>\n',
  f: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <alphamap_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <lights_fragment_begin>\n#include <opaque_fragment>\n' };
const uniVal = (v) => {
  if (v === null || v === undefined) return undefined;
  if (v.isTexture) { const id = texRef(v); return id === null ? undefined : { tex: id }; }
  if (typeof v === 'number' || typeof v === 'boolean') return +(+v).toFixed(6);
  if (v.isColor) return { color: [v.r, v.g, v.b] };
  if (v.isVector2 || v.isVector3 || v.isVector4) return { vec: v.toArray() };
  if (Array.isArray(v) && v.length <= 16 && v.every((x) => typeof x === 'number')) return { arr: v };
  return undefined;
};
// the uniforms a material's onBeforeCompile installs (the PBR library's texture sets, the kit's tints ...), read on a
// stand-in shader as the USD harvest does (the bake page is thrown away after, so whatever the patch keeps of the
// stand-in does no harm)
function obcUniforms(m) {
  const obc = m.onBeforeCompile;
  if (!obc || obc === THREE.Material.prototype.onBeforeCompile || String(obc).length <= 40) return null;
  const sh = { uniforms: {}, vertexShader: STUB.v, fragmentShader: STUB.f, defines: {} };
  try { obc.call(m, sh, undefined); } catch (e) { return { err: String(e).slice(0, 120) }; }
  const out = {};
  for (const [k, u] of Object.entries(sh.uniforms || {})) {
    if (dynUniform(k, u)) { out[k] = { dynamic: true }; continue; }   // page state, not the look
    const v = uniVal(u && typeof u === 'object' && 'value' in u ? u.value : u); if (v !== undefined) out[k] = v;
  }
  return { uni: out, attrs: [...new Set([...(sh.vertexShader || '').matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)].map((x) => x[1]))] };
}
function describeMat(m, tileKey = null) {
  const d = { type: m.type, name: m.name || '', side: m.side, transparent: !!m.transparent, alphaTest: m.alphaTest || 0, opacity: m.opacity ?? 1,
    vertexColors: !!m.vertexColors, depthWrite: m.depthWrite !== false, blending: m.blending, polygonOffset: !!m.polygonOffset,
    polygonOffsetFactor: m.polygonOffsetFactor || 0, polygonOffsetUnits: m.polygonOffsetUnits || 0, obc: !!(m.onBeforeCompile && String(m.onBeforeCompile).length > 40) };
  if (m.color && m.color.isColor) d.color = [m.color.r, m.color.g, m.color.b];
  if (m.emissive && m.emissive.isColor) d.emissive = [m.emissive.r, m.emissive.g, m.emissive.b];
  for (const k of ['roughness', 'metalness', 'emissiveIntensity', 'envMapIntensity', 'ior', 'transmission', 'clearcoat']) if (typeof m[k] === 'number') d[k] = +m[k].toFixed(5);
  d.textures = {};
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap']) {
    const t = m[k]; if (!t || !t.isTexture) continue;
    const img = t.image || (t.source && t.source.data);
    const src = img && (img.currentSrc || img.src);
    d.textures[k] = { tex: texRef(t), name: t.name || '', uri: src && !String(src).startsWith('data:') && !String(src).startsWith('blob:') ? String(src).replace(/^https?:\/\/[^/]+\//, '') : null,
      generated: !src, width: (img && (img.width || (img.image && img.image.width))) || 0, height: (img && (img.height || (img.image && img.image.height))) || 0,
      repeat: t.repeat ? [t.repeat.x, t.repeat.y] : null, offset: t.offset ? [t.offset.x, t.offset.y] : null, channel: t.channel || 0, colorSpace: t.colorSpace || '' };
  }
  const ud = {};
  for (const [k, v] of Object.entries(m.userData || {})) {
    if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') ud[k] = v;
    else if (k === 'pbr' && typeof v === 'object') { try { ud.pbr = JSON.parse(JSON.stringify(v)); } catch { /* */ } }
  }
  d.userData = ud;
  // TW (towers lane, city/tk/tkMats.js tkFacadeMat): a facade-shader glass of the tower kit as a renderer without the
  // shader should draw it (linear colour, whether the vertex colour still multiplies, roughness)
  if (typeof ud.tkExpLin === 'string') {
    const c = ud.tkExpLin.split(',').map(Number);
    if (c.length === 3 && c.every((x) => x >= 0 && x <= 1)) d.color = c;
    d.vertexColors = !!ud.tkExpVC;
    if (typeof ud.tkExpRough === 'number') d.roughness = ud.tkExpRough;
  }
  // /TW
  if (ud.cellTexture) d.cellTexture = true;   // a texture made for this cell (the blades' names): drawn from the file, never the live atlas
  if (m.uniforms) { d.uniforms = Object.keys(m.uniforms); d.uni = {}; for (const [k, u] of Object.entries(m.uniforms)) { if (dynUniform(k, u)) { d.uni[k] = { dynamic: true }; continue; } const v = uniVal(u && u.value); if (v !== undefined) d.uni[k] = v; } }

  if (m.defines) d.defines = Object.keys(m.defines);
  d.sig = materialSignature(m, 1);   // the signature with files and sizes (a renderer that misses a key can say why)
  d.keys = [0, 1, 2].map((l) => materialKey(m, tileKey, l));   // the key at each level: a renderer with several candidates picks by them
  const ob = obcUniforms(m);   // last: the patch may keep things of the stand-in on the material
  if (ob) { d.obcUni = ob.uni || null; d.obcAttrs = ob.attrs || null; if (ob.err) d.obcErr = ob.err; }
  return d;
}

// GB43 KIT: the dresser's kit instances (window.__KITREC, the page's ?kitrec=1; world/nycDress.js) as instanced sets,
// every instance to the cell of its position: its part's geometry once, its transform and tint, and for a unit box the
// merged path's values, KITA (grime, base height, cornice shadow height) and KITB (texture offset u, v, texture size m)
function exportKit() {
  const K = typeof window !== 'undefined' && window.__KITREC;
  if (!K) return;
  for (const r of K.inst.values()) {
    const e = r.m;
    if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;
    const cell = inRegionCell(e[12], e[14]);
    if (!cell) continue;
    const P = K.parts.get(r.id);
    if (!P || !P.mat) continue;
    const key = cell + '|kit:' + r.id;
    let I = INST.get(key);
    if (!I) {
      I = { cell, kind: 'kit', name: r.id.slice(0, 60), geo: P.geom, mat: regMat(P.mat, null), cls: SEG.CID.building, castShadow: P.castShadow, receiveShadow: !P.nightOnly,
        renderOrder: 0, layers: P.layers, nightOnly: P.nightOnly, M: [], C: [], X: { KITA: [], KITB: [] }, XS: { KITA: 3, KITB: 3 } };
      INST.set(key, I);
    }
    I.M.push(...e);
    I.C.push(...(r.t || [1, 1, 1]));
    const x = r.x || [0, 0, 0, 0, 0, 0];
    I.X.KITA.push(x[0], x[1], x[2]); I.X.KITB.push(x[3], x[4], x[5]);
  }
}

// the static meshes: visible objects, LOD objects at their finest level, per triangle
function exportMeshes(ctx) {
  const E = eng();
  const visit = (o, forced, tileKey) => {
    if (!o.visible && !forced) return;
    if (o.name && o.name.startsWith('tile_')) tileKey = o.name.slice(5);
    if (o.isLOD && o.levels && o.levels.length) { visit(o.levels[0].object, true, tileKey); return; }
    if (o.isMesh && !o.isInstancedMesh) takeMesh(o, ctx, tileKey);
    else if (o.isInstancedMesh) takeInstanced(o, ctx);
    for (const c of o.children) visit(c, false, tileKey);
  };
  visit(E.scene, false, null);
}
function takeMesh(o, ctx, tileKey) {
  const why = skipReason(o, ctx);
  if (why) { skip(why); return; }
  if (!o.layers.test(eng().camera.layers)) { skip('layer'); return; }
  const g = o.geometry;
  const sph = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
  if (sph.center.x + sph.radius < REGION.x0 || sph.center.x - sph.radius > REGION.x1 || sph.center.z + sph.radius < REGION.z0 || sph.center.z - sph.radius > REGION.z1) return;
  const pa = g.attributes.position, idx = g.index ? g.index.array : null;
  const nIdx = idx ? g.index.count : pa.count;
  const start = Math.max(0, g.drawRange.start), end = Math.min(nIdx, start + g.drawRange.count);
  const e = o.matrixWorld.elements;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = Array.isArray(o.material) && g.groups && g.groups.length ? g.groups : null;
  const miOf = (t) => { if (!groups) return 0; for (const q of groups) if (t >= q.start && t < q.start + q.count) return q.materialIndex ?? 0; return -1; };
  // the tile facades' hide mask: buildings the dresser rebuilt are dropped here (they come whole from the dresser)
  const bidA = g.attributes.aBid || null;
  const buckets = new Map();   // `${cell}|${mi}` -> [vertex indices]
  for (let t = start; t + 2 < end; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    const p = triXZ(pa, e, a, b, c);
    if (!p) continue;
    const cell = inRegionCell(p[0], p[1]);
    if (!cell) continue;
    const mi = miOf(t);
    if (mi < 0) continue;
    const m = mats[mi];
    if (!m || m.visible === false) continue;
    // a tile facade of a building the dresser rebuilt: kept apart (shadowOnly): the client's facade shader discards it
    // through the tile's hide mask in the colour pass, but it still casts the building's shadow
    let hid = '';
    if (bidA && m.userData && m.userData.isFacade) {
      const hd = m.userData.hideTex && m.userData.hideTex.image && m.userData.hideTex.image.data;
      if (hd && hd[Math.round(bidA.getX(a))] > 127) hid = '|h';
    }
    const k = cell + '|' + mi + hid;
    let L = buckets.get(k); if (!L) buckets.set(k, (L = [])); L.push(a, b, c);
  }
  if (!buckets.size) return;
  const det = new THREE.Matrix3().setFromMatrix4(o.matrixWorld).determinant();
  const sig = attrSig(g), sk = sigKey(sig);
  let lift = null, flat = false;
  if (!g.boundingBox) g.computeBoundingBox();
  if (g.boundingBox) { const bb = g.boundingBox; flat = bb.max.y - bb.min.y < 0.35 && Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) > 1.5; }
  for (const [k, tris] of buckets) {
    const [cell, miS, hidS] = k.split('|');
    const m = mats[+miS], shadowOnly = hidS === 'h';
    if (lift === null) lift = liftAbove(o, g);
    const cls = meshClass(o, m, { ...ctx, lift, flat });
    const mk = regMat(m, m.userData && m.userData.isFacade ? tileKey : null);
    const nightOnly = !!(m.userData && m.userData.tkNightOnly);   // TW: the tower kit's night windows (city/tk/tkMats.js litWinMat)
    const gk = `m:${mk}|${sk}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${o.layers.mask}|${cls}${shadowOnly ? '|h' : ''}${nightOnly ? '|n' : ''}`;
    const A = acc(cell, gk, { kind: 'mesh', mat: mk, attrs: sig, cls, castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, renderOrder: o.renderOrder || 0, layers: o.layers.mask, sources: new Set(), shadowOnly, nightOnly });
    A.sources.add((o.name || o.type).slice(0, 60));
    addPiece(A, g, o.matrixWorld, tris, cellOrigin(...cell.split('_').map(Number)), det < 0);
  }
}
// any other InstancedMesh (not the pools, not actors): every live instance to the cell of its position
function takeInstanced(o, ctx) {
  const why = skipReason(o, ctx);
  if (why) { skip('inst:' + why); return; }
  if (/^tw:/.test(o.name || '')) { takeExpanded(o, ctx); return; }   // TW: the tower kit's parts as merged meshes
  if (!o.layers.test(eng().camera.layers) || !o.count) return;
  const A = o.instanceMatrix.array, ic = o.instanceColor ? o.instanceColor.array : null;
  const m4 = new THREE.Matrix4();
  const extra = Object.keys(o.geometry.attributes).filter((k) => o.geometry.attributes[k].isInstancedBufferAttribute);
  for (let k = 0; k < o.count; k++) {
    m4.fromArray(A, k * 16).premultiply(o.matrixWorld);
    const e = m4.elements;
    if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;
    const cell = inRegionCell(e[12], e[14]);
    if (!cell) continue;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const mk = regMat(mat, null);
    const ik = `i:${o.uuid}`;
    let I = INST.get(cell + '|' + ik);
    if (!I) {
      I = { cell, kind: 'inst', name: (o.name || 'instanced').slice(0, 60), geo: o.geometry, mat: mk, cls: meshClass(o, mat, { ...ctx, lift: null, flat: false }),
        castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, renderOrder: o.renderOrder || 0, layers: o.layers.mask, M: [], C: ic ? [] : null, X: Object.fromEntries(extra.map((n) => [n, []])) };
      INST.set(cell + '|' + ik, I);
    }
    I.M.push(...e);
    if (ic) I.C.push(ic[k * 3], ic[k * 3 + 1], ic[k * 3 + 2]);
    for (const n of extra) { const at = o.geometry.attributes[n]; for (let c = 0; c < at.itemSize; c++) I.X[n].push(at.array[k * at.itemSize + c]); }
  }
}
// TW (towers lane): the tower kit's instanced parts (world/towerKit.js pools, `tw:` names: sills, lintels, mullions,
// transoms, piers, air conditioners), each instance written out as geometry into its cell's merged mesh of that material:
// a tower region holds about 10^5 of them, which today's Unreal import would make one actor each (r1c_cells.py)
function takeExpanded(o, ctx) {
  if (!o.layers.test(eng().camera.layers) || !o.count) return;
  const g = o.geometry, mat = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!g.index) return;
  const tris = g.index.array, A = o.instanceMatrix.array, m4 = new THREE.Matrix4();
  const sig = attrSig(g), sk = sigKey(sig), mk = regMat(mat, null);
  const cls = meshClass(o, mat, { ...ctx, lift: null, flat: false });
  for (let k = 0; k < o.count; k++) {
    m4.fromArray(A, k * 16).premultiply(o.matrixWorld);
    const e = m4.elements;
    if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;
    const cell = inRegionCell(e[12], e[14]);
    if (!cell) continue;
    const gk = `m:${mk}|${sk}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${o.layers.mask}|${cls}`;
    const Acc = acc(cell, gk, { kind: 'mesh', mat: mk, attrs: sig, cls, castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, renderOrder: o.renderOrder || 0, layers: o.layers.mask, sources: new Set(), shadowOnly: false });
    Acc.sources.add((o.name || 'tw').slice(0, 60));
    addPiece(Acc, g, m4, tris, cellOrigin(...cell.split('_').map(Number)), m4.determinant() < 0);
  }
}
// the instancer's pools: every live instance (the store, not the culled draw set), at the main geometry
function exportPools(ctx) {
  const P = ins();
  if (!P || !P.pools) return;
  const m4 = new THREE.Matrix4();
  for (const [name, p] of P.pools) {
    if (!p.pos || !p.top || !p.mesh) continue;
    if (isDynamicPool(name)) { skip('pool-dynamic'); continue; }
    const night = isGlowPool(name);   // the lamp glows: drawn at night
    if (!p.mesh.parent) { skip('pool-detached'); continue; }
    const mw = p.mesh.matrixWorld, ident = mw.equals(new THREE.Matrix4());
    const mat = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material;
    if (!mat || mat.visible === false) continue;
    const cls = poolClass(name);
    for (let s = 0; s < p.top; s++) {
      if (!p.alive[s]) continue;
      const cell = inRegionCell(p.pos[s * 3], p.pos[s * 3 + 2]);
      if (!cell) continue;
      const key = cell + '|p:' + name;
      let I = INST.get(key);
      if (!I) {
        I = { cell, kind: 'pool', name, pool: name, geo: p.geo || p.mesh.geometry, mat: regMat(mat, null), cls, castShadow: !!p.shadow, receiveShadow: !!p.mesh.receiveShadow,
          renderOrder: p.mesh.renderOrder || 0, layers: p.mesh.layers.mask, M: [], C: [], X: {}, nightOnly: night };
        INST.set(key, I);
      }
      if (ident) for (let q = 0; q < 16; q++) I.M.push(p.mats[s * 16 + q]);
      else { m4.fromArray(p.mats, s * 16).premultiply(mw); I.M.push(...m4.elements); }
      I.C.push(p.cols[s * 3], p.cols[s * 3 + 1], p.cols[s * 3 + 2]);
    }
  }
}
// the dresser's buildings, whole, to the cell of the centroid: its per-tile merges and its pooled parts
function exportDresser(ctx, buildings) {
  const D = drs();
  if (!D) return;
  const ident = new THREE.Matrix4();
  const perCell = new Map();
  const BLDG = { name: 'bldg', type: 'u16', itemSize: 1, normalized: false };   // the building's index in the sidecar's list
  for (const [recKey, a] of D.active) {
    const cell = inRegionCell(a.cx, a.cz);
    if (!cell) continue;
    const org = cellOrigin(...cell.split('_').map(Number));
    const bi = perCell.get(cell) || 0; perCell.set(cell, bi + 1);
    const rec = D.tiles.get(a.tile)?.recs.find((r) => r.key === recKey);
    buildings.push({ key: recKey, cell, tile: a.tile, bid: a.bid, cx: a.cx, cz: a.cz, dressed: true,
      height: rec ? +rec.height.toFixed(2) : null, baseY: rec ? +rec.baseY.toFixed(3) : null, style: rec ? rec.style : null,
      ring: rec ? rec.ring.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]) : null });
    // merges: the building's own merged geometry per material (world space)
    const T = D.merges.tiles.get(a.tile);
    if (T) for (const [matName, b] of T) {
      const g = b.geos.get(recKey);
      if (!g || !g.attributes.position) continue;
      const m = D.M.get(matName), mesh = b.mesh;
      const sig = [...attrSig(g), BLDG];
      const mk = regMat(m, null);
      const gk = `m:${mk}|${sigKey(sig)}|11|${mesh ? mesh.renderOrder : 0}|${mesh ? mesh.layers.mask : 9}|${SEG.CID.building}`;
      const A = acc(cell, gk, { kind: 'mesh', mat: mk, attrs: sig, cls: SEG.CID.building, castShadow: true, receiveShadow: true, renderOrder: mesh ? mesh.renderOrder : 0, layers: mesh ? mesh.layers.mask : 9, sources: new Set(['nyc:merge']), dress: true });
      const n = g.index ? g.index.count : g.attributes.position.count;
      const tris = new Array(n);
      for (let i = 0; i < n; i++) tris[i] = g.index ? g.index.array[i] : i;
      addPiece(A, g, ident, tris, org, false, { bldg: bi });
    }
    // pooled parts: vertex ranges [start, start + count) of the bucket's static pool (non-indexed, world space)
    for (const [, h] of a.handles) {
      const bk = h.bucket;
      if (!bk || !h.count) continue;
      const g = bk.geometry, m = bk.material, mesh = bk.mesh;
      const sig = [...attrSig(g), BLDG];
      const mk = regMat(m, null);
      const night = !!bk.nightOnly;
      const gk = `m:${mk}|${sigKey(sig)}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${mesh.layers.mask}|${SEG.CID.building}|${night ? 'n' : ''}`;
      const A = acc(cell, gk, { kind: 'mesh', mat: mk, attrs: sig, cls: SEG.CID.building, castShadow: !!mesh.castShadow, receiveShadow: !!mesh.receiveShadow, renderOrder: mesh.renderOrder || 0, layers: mesh.layers.mask, sources: new Set(['nyc:parts']), dress: true, nightOnly: night });
      const tris = [];
      const pa = g.attributes.position;
      for (let v = h.start; v + 2 < h.start + h.count; v += 3) {
        if (pa.getX(v) === pa.getX(v + 1) && pa.getX(v) === pa.getX(v + 2) && pa.getY(v) === pa.getY(v + 1) && pa.getZ(v) === pa.getZ(v + 2) && pa.getY(v) === pa.getY(v + 2)) continue;
        tris.push(v, v + 1, v + 2);
      }
      if (tris.length) addPiece(A, g, ident, tris, org, false, { bldg: bi });
    }
  }
}

// ---------------------------------------------------------------- the street lamps
// Every lamp head the page lights the city with: world/life.js lampSpots (city/props.js cobraheads and Bishop's crooks
// from the instancer's claims, city/pk/props.js the 125th St luminaires and signal-arm lamps, city/cpFlora.js the park's
// post tops, city/bryantParkKit.js its acorns), one per 0.5 m as world/cityLamps.js keeps them, at full precision, with
// the fixture the page chose (world/night11.js FIXTURES: led3000, led4000, hps2000, acorn3000; 'legacy' with ?n11=0)
// and its mount (the head's height over the ground point, the arm's yaw where it throws along an arm).
let FIX = null;
export async function lampHeads() {
  if (!FIX) { try { FIX = (await import('../world/night11.js')).FIXTURES; } catch { FIX = []; } }
  const L = (W().__LIFE && W().__LIFE.lampSpots) || [], seen = new Set(), out = [];
  for (const s of L) {
    const k = Math.round(s[0] * 2) + ',' + Math.round(s[2] * 2);
    if (seen.has(k)) continue;
    seen.add(k);
    const fi = Number.isInteger(s[3]) ? s[3] : -1, h = Number.isFinite(s[4]) ? s[4] : 8.2, yaw = Number.isFinite(s[5]) ? s[5] : null;
    const kind = fi === 3 ? 'acorn' : yaw !== null ? (Math.abs(h - 7.93) < 0.02 ? 'signalArm' : 'cobra') : Math.abs(h - 5.9) < 0.01 ? 'crook' : Math.abs(h - 3.4) < 0.01 ? 'parkPost' : 'post';
    out.push({ kind, x: s[0], y: s[1], z: s[2], headY: s[1] + h,
      fixture: { key: fi >= 0 && fi < FIX.length ? FIX[fi].key : 'legacy', index: fi, mount: yaw !== null ? 'arm' : 'postTop', height: h, yaw } });
  }
  return out;
}
// ---------------------------------------------------------------- the sidecar's data per cell
let HEADS = null;   // lampHeads(), once per export
const KINDS = ['asphalt', 'sidewalk', 'curb', 'paint', 'grass', 'path', 'terrain', 'plaza', 'gutter', 'buslane', 'bikelane', 'water', 'other'];
function sidecarFor(cell, buildings) {
  const S = str();
  const [cx, cz] = cell.split('_').map(Number), [ox, oz] = cellOrigin(cx, cz);
  const tile = `${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`;
  const td = S.tiles.get(tile)?.data;
  const inCell = (x, z) => x >= ox && x < ox + CELL && z >= oz && z < oz + CELL;
  // ground: heights at 4 m (33 x 33, the terrain grid's own plane) and the top surface's kind and height at 2 m (64 x 64)
  const N = 33, hgt = new Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const v = S.terrainAt(ox + i * 4, oz + j * 4); hgt[j * N + i] = Number.isFinite(v) ? +v.toFixed(3) : null; }
  const M = 64, kind = new Array(M * M), top = new Array(M * M), kinds = [];
  const kid = (k) => { let i = kinds.indexOf(k); if (i < 0) { kinds.push(k); i = kinds.length - 1; } return i; };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = ox + (i + 0.5) * 2, z = oz + (j + 0.5) * 2;
    let si = null; try { si = S.surfaceInfoAt(x, z, 0.4); } catch { si = null; }
    kind[j * M + i] = si ? kid(si.kind + (si.road ? '' : '')) : -1;
    top[j * M + i] = si && Number.isFinite(si.y) ? +si.y.toFixed(3) : null;
  }
  const roads = td ? (td.roads || []).filter((r) => r.pts.some(([x, , z]) => inCell(x, z))).map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) if (!['start', 'len', 'nameIdx', 'pts'].includes(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) o[k] = v;
    o.pts = r.pts.map((p) => p.map((v) => +v.toFixed(2)));
    return o;
  }) : [];
  const nodes = td ? (td.nodes || []).filter((n) => inCell(n.x, n.z)).map((n) => ({ x: +n.x.toFixed(2), z: +n.z.toFixed(2), signal: !!n.signal })) : [];
  // the instancer's furniture and the signal heads by kind (positions and headings), and the street lamps as lights
  const furniture = {}, lights = [], signals = [];
  const P = ins();
  if (P && P.pools) for (const [name, p] of P.pools) {
    if (!p.pos || !p.top) continue;
    for (let s = 0; s < p.top; s++) {
      if (!p.alive[s]) continue;
      const x = p.pos[s * 3], y = p.pos[s * 3 + 1], z = p.pos[s * 3 + 2];
      if (!inCell(x, z)) continue;
      const e = p.mats.subarray(s * 16, s * 16 + 16), rot = +Math.atan2(e[8], e[10]).toFixed(4);
      if (/^(signalMast|signalHead|signalPed)$/.test(name)) signals.push({ kind: name, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), rot });
      if (!isDynamicPool(name)) furniture[name] = (furniture[name] || 0) + 1;
    }
  }
  for (const l of HEADS || []) if (inCell(l.x, l.z)) lights.push(l);
  return {
    buildings: buildings.filter((b) => b.cell === cell).map(({ cell: _c, ...b }) => b),
    ground: { heights: { step: 4, n: N, origin: [ox, oz], values: hgt }, surface: { step: 2, n: M, origin: [ox, oz], kinds, kind, top } },
    nav: { roads, nodes, lanes: null, sidewalks: null, crossings: null },
    signals, lights, furniture, colliders: null, spawns: null,
  };
}

// every texture of the table read back from the GPU at most maxDim px (rows as read: bottom-up, which is the image as
// glTF samples it with the client's uvs), POSTed raw to the sink as <run>/tex_<id>_<layer>__<w>x<h>.rgba.
// Measured on this client: right after some of the page's frames, every read of a batch comes back empty (about a quarter
// of the textures in a bake, a different quarter each time: the "textures that differ between two bakes"). So the
// renderer's state is reset before each read, and an empty read is tried again in later frames (up to 8 rounds); what is
// still empty then is empty (`blank: true`).
export async function readTextures({ sink, run, maxDim = 4096 }) {
  const R = eng().renderer;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const scene = new THREE.Scene(); scene.add(quad);
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vs = 'in vec3 position; in vec2 uv; out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const fs2 = 'precision highp float; uniform sampler2D map; uniform float nrmRG; in vec2 vUv; out vec4 o; void main() { vec4 t = texture(map, vUv); if (nrmRG > 0.5) { vec2 xy = t.rg * 2.0 - 1.0; t = vec4(t.rg, sqrt(max(0.0, 1.0 - dot(xy, xy))) * 0.5 + 0.5, 1.0); } o = t; }';
  const fsA = 'precision highp float; precision highp sampler2DArray; uniform sampler2DArray map; uniform float layer; in vec2 vUv; out vec4 o; void main() { o = texture(map, vec3(vUv, layer)); }';
  const m2 = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { map: { value: null }, nrmRG: { value: 0 } }, vertexShader: vs, fragmentShader: fs2, depthTest: false, depthWrite: false });
  const mA = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { map: { value: null }, layer: { value: 0 } }, vertexShader: vs, fragmentShader: fsA, depthTest: false, depthWrite: false });
  const RG = new Set([THREE.RGFormat, THREE.RED_GREEN_RGTC2_Format, THREE.SIGNED_RED_GREEN_RGTC2_Format, THREE.RG11_EAC_Format, THREE.SIGNED_RG11_EAC_Format].filter((v) => v !== undefined));
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const out = [], jobs = [];
  let bytes = 0, retried = 0;
  for (const { id, t } of TEX.values()) {
    if (TEX_DONE.has(id)) continue;
    TEX_DONE.add(id);
    const info = { id, name: t.name || '', colorSpace: t.colorSpace || '', flipY: !!t.flipY, wrapS: t.wrapS, wrapT: t.wrapT, compressed: !!t.isCompressedTexture, array: !!(t.isDataArrayTexture || t.isCompressedArrayTexture) };
    out.push(info);
    const img = t.image || {};
    const w = t.mipmaps && t.mipmaps[0] && t.mipmaps[0].width ? t.mipmaps[0].width : (img.width || img.videoWidth || 0);
    const h = t.mipmaps && t.mipmaps[0] && t.mipmaps[0].height ? t.mipmaps[0].height : (img.height || img.videoHeight || 0);
    if (!w || !h) { info.err = 'no size'; continue; }
    const sc = Math.min(1, maxDim / Math.max(w, h)), ow = Math.max(1, Math.round(w * sc)), oh = Math.max(1, Math.round(h * sc));
    const layers = info.array ? Math.min(img.depth || 1, 32) : 1;
    Object.assign(info, { w, h, ow, oh, layers, capped: sc < 1 });
    for (let L = 0; L < layers; L++) jobs.push({ info, t, L });
  }
  // the CPU path (no GPU read: the flaky part): canvases, bitmaps, images and 8-bit data textures straight from their
  // source, rows ordered as glTF samples them with the client's uvs (a flipY texture's last source row first)
  let cv = null;
  const cpuRead = (job) => {
    const { info, t, L } = job, img = t.image, { ow, oh } = info;
    if (!img || t.isCompressedTexture || (info.array && !t.isDataArrayTexture)) return null;
    let px = null;
    if ((t.isDataTexture || t.isDataArrayTexture) && img.data && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray) && t.type === THREE.UnsignedByteType && ow === img.width && oh === img.height) {
      const n = ow * oh, ch = t.format === THREE.RGBAFormat ? 4 : t.format === THREE.RGFormat ? 2 : t.format === THREE.RedFormat ? 1 : 0;
      const d = info.array ? img.data.subarray((L || 0) * n * ch, ((L || 0) + 1) * n * ch) : img.data;   // an array's layer
      if (!ch || d.length < n * ch) return null;
      px = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) { const o = i * 4, k = i * ch; px[o] = d[k]; px[o + 1] = ch > 1 ? d[k + 1] : d[k]; px[o + 2] = ch > 2 ? d[k + 2] : ch === 1 ? d[k] : 0; px[o + 3] = ch > 3 ? d[k + 3] : 255; }
    } else if (info.array) return null;
    else if ((typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.complete)) {
      if (!cv) cv = document.createElement('canvas');
      cv.width = ow; cv.height = oh;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.clearRect(0, 0, ow, oh);
      cx.drawImage(img, 0, 0, ow, oh);
      px = new Uint8Array(cx.getImageData(0, 0, ow, oh).data.buffer);
    } else return null;
    if (t.flipY) { const row = ow * 4, tmp = new Uint8Array(row); for (let j = 0; j < oh >> 1; j++) { const a = j * row, b = (oh - 1 - j) * row; tmp.set(px.subarray(a, a + row)); px.copyWithin(a, b, b + row); px.set(tmp, b); } }
    info.via = 'cpu';
    return px;
  };
  // compressed textures (KTX2: the PBR library's sets, the ground bank) in a WebGL2 context of their own: their level 0
  // uploaded from the CPU copy the loader keeps, drawn into an 8-bit target and read (three's compressed format constants
  // are the GL enums; the linear one gives the stored values)
  let G2 = null;
  const ctx2 = () => {
    if (G2) return G2;
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const gl = c.getContext('webgl2', { premultipliedAlpha: false, antialias: false, depth: false });
    if (!gl) return (G2 = { gl: null });
    for (const e of ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc', 'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc']) gl.getExtension(e);
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; out vec2 vUv; void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; uniform sampler2D map; in vec2 vUv; out vec4 o; void main() { o = textureLod(map, vUv, 0.0); }'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return (G2 = { gl: null });
    const progA = gl.createProgram();   // the layers of an array texture
    gl.attachShader(progA, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; out vec2 vUv; void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(progA, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; precision highp sampler2DArray; uniform sampler2DArray map; uniform float layer; in vec2 vUv; out vec4 o; void main() { o = textureLod(map, vec3(vUv, layer), 0.0); }'));
    gl.bindAttribLocation(progA, 0, 'p'); gl.linkProgram(progA);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return (G2 = { gl, prog, vao, progA: gl.getProgramParameter(progA, gl.LINK_STATUS) && gl.getAttribLocation(progA, 'p') === loc ? progA : null, arr: null });
  };
  const ctxRead = (job) => {
    const { info, t, L } = job, { ow, oh } = info;
    if (!t.isCompressedTexture || !t.mipmaps || !t.mipmaps[0] || !t.mipmaps[0].data) return null;
    if (info.array && !t.isCompressedArrayTexture) return null;
    const G = ctx2(), { gl, prog, vao } = G;
    if (!gl || (info.array && !G.progA)) return null;
    const m0 = t.mipmaps[0];
    const filt = (T) => { gl.texParameteri(T, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(T, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(T, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(T, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
    let tex = null;
    gl.activeTexture(gl.TEXTURE0);
    if (info.array) {   // all layers uploaded once (level 0 holds them back to back), one layer drawn per job
      if (!G.arr || G.arr.id !== info.id) {
        if (G.arr) gl.deleteTexture(G.arr.tex);
        G.arr = { id: info.id, tex: gl.createTexture() };
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, G.arr.tex);
        gl.compressedTexImage3D(gl.TEXTURE_2D_ARRAY, 0, t.format, m0.width, m0.height, t.image.depth, 0, m0.data);
        if (gl.getError()) { gl.deleteTexture(G.arr.tex); G.arr = null; return null; }
        filt(gl.TEXTURE_2D_ARRAY);
      }
    } else {
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.compressedTexImage2D(gl.TEXTURE_2D, 0, t.format, m0.width, m0.height, 0, m0.data);
      if (gl.getError()) { gl.deleteTexture(tex); return null; }
      filt(gl.TEXTURE_2D);
    }
    const rtex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rtex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ow, oh);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtex, 0);
    gl.viewport(0, 0, ow, oh); gl.bindVertexArray(vao);
    if (info.array) {
      gl.useProgram(G.progA); gl.bindTexture(gl.TEXTURE_2D_ARRAY, G.arr.tex);
      gl.uniform1i(gl.getUniformLocation(G.progA, 'map'), 0); gl.uniform1f(gl.getUniformLocation(G.progA, 'layer'), L || 0);
    } else {
      gl.useProgram(prog); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(prog, 'map'), 0);
    }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8Array(ow * oh * 4); gl.readPixels(0, 0, ow, oh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(rtex); if (tex) gl.deleteTexture(tex);
    if (err) return null;
    if (RG.has(t.format)) for (let i = 0; i < px.length; i += 4) { const x = px[i] / 127.5 - 1, y = px[i + 1] / 127.5 - 1; px[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - x * x - y * y)) * 0.5 + 0.5) * 255); px[i + 3] = 255; }   // two-channel normals: z rebuilt, as the GPU path does
    info.via = 'ctx';
    return px;
  };
  const readOne = (job) => {   // one synchronous read: true and the pixels when anything came back
    const { info, t, L } = job, { ow, oh } = info;
    const prevRT = R.getRenderTarget(), prevAuto = R.autoClear;
    const rt = new THREE.WebGLRenderTarget(ow, oh, { depthBuffer: false, type: THREE.UnsignedByteType, colorSpace: t.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    try {
      R.resetState();
      if (info.array) { mA.uniforms.map.value = t; mA.uniforms.layer.value = L; quad.material = mA; }
      else { R.initTexture(t); m2.uniforms.map.value = t; m2.uniforms.nrmRG.value = RG.has(t.format) ? 1 : 0; quad.material = m2; }
      R.setRenderTarget(rt); R.autoClear = true; R.setClearColor(0x000000, 0); R.clear(); R.render(scene, ocam);
      const px = new Uint8Array(ow * oh * 4);
      R.readRenderTargetPixels(rt, 0, 0, ow, oh, px);
      let any = false;
      for (let i = 0; i < px.length; i += 4093) if (px[i] | px[i + 1] | px[i + 2] | px[i + 3]) { any = true; break; }
      if (!any) for (let i = 0; i < px.length; i++) if (px[i]) { any = true; break; }
      return { any, px };
    } finally { R.setRenderTarget(prevRT); R.autoClear = prevAuto; rt.dispose(); R.resetState(); }
  };
  const send = async (job, px) => {
    const { info, L } = job;
    let opaque = true;
    for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) { opaque = false; break; }
    info.opaque = L === 0 ? opaque : info.opaque && opaque;
    const r = await fetch(`${sink}/put/${run}/tex_${info.id}_${L}__${info.ow}x${info.oh}.rgba`, { method: 'POST', body: px });
    if (!r.ok) throw new Error('sink refused texture ' + info.id);
    bytes += px.length;
  };
  let todo = [];
  for (let i = 0; i < jobs.length; i++) {   // the CPU path first; what it cannot read goes to the GPU path
    let px = null;
    try { px = cpuRead(jobs[i]) || ctxRead(jobs[i]); } catch (e) { px = null; }
    if (px) await send(jobs[i], px); else todo.push(jobs[i]);
    if (i % 8 === 7) await raf();
  }
  for (let round = 0; round < 8 && todo.length; round++) {
    if (round) { retried += todo.length; await raf(); await raf(); }
    const again = [];
    for (let i = 0; i < todo.length; i++) {
      const job = todo[i];
      try {
        const r = readOne(job);
        if (r.any || round === 7) { if (!r.any) job.info.blank = true; await send(job, r.px); }
        else again.push(job);
      } catch (e) { job.info.err = String(e).slice(0, 160); }
      if (i % 16 === 15) await raf();   // the page draws between groups, as it would anyway
    }
    todo = again;
  }
  m2.dispose(); mA.dispose(); quad.geometry.dispose();
  return { textures: out, bytes, retried, blank: out.filter((i) => i.blank).length, cpu: out.filter((i) => i.via === 'cpu' || i.via === 'ctx').length };
}
// what moves (rowboats, animated sets): every object whose world matrix or instance matrices change over a second and a
// half while the camera holds still; by name, so the loader can leave the same objects alone
export async function detectMovers(ms = 1500) {
  const E = eng(), snap = () => {
    const m = new Map();
    E.scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.name) return;
      const e = o.matrixWorld.elements;
      m.set(o, `${o.isInstancedMesh ? o.instanceMatrix.version + ':' + o.count : ''}|${e[12].toFixed(4)},${e[13].toFixed(4)},${e[14].toFixed(4)},${e[0].toFixed(5)},${e[2].toFixed(5)}`);
    });
    return m;
  };
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap(), out = new Set();
  for (const [o, v] of b) if (a.has(o) && a.get(o) !== v) out.add(o.name);
  return [...out];
}
// ---------------------------------------------------------------- the whole export: per cell, a JSON and one binary
export async function exportAll({ sink, run, movers = [], signCells = false }) {
  await loadSeg();
  ACC.clear(); INST.clear(); MATS.clear(); for (const k of Object.keys(SKIP)) delete SKIP[k];   // (TEX stays: a session's batches share their textures)
  const E = eng(), S = str();
  signTextUndo();
  E.scene.updateMatrixWorld(true);
  const signs = signCells ? splitSignText() : null;
  const ctx = { farGroup: S && S.macroGroup, farMat: S && S.ctx && S.ctx.farMat, groundMat: S && S.ctx && S.ctx.groundMat, heroMat: null, movers: new Set(movers) };
  const t0 = performance.now();
  const buildings = [];
  exportMeshes(ctx);
  exportKit();
  const tM = performance.now();
  exportPools(ctx);
  exportDresser(ctx, buildings);
  // the tiles' building records that are not dressed (tile facades only) are listed too
  const D = drs();
  const dressedKeys = new Set(buildings.map((b) => b.key));
  for (const [tk, td] of S.tiles) {
    const recs = td.data && td.data.bldgs ? td.data.bldgs : [];
    for (const r of recs) {
      const cell = inRegionCell(r.cx, r.cz);
      if (!cell || dressedKeys.has(r.key)) continue;
      buildings.push({ key: r.key, cell, tile: tk, bid: r.bid, cx: r.cx, cz: r.cz, dressed: false, height: +r.height.toFixed(2), baseY: +r.baseY.toFixed(3), style: r.style, ring: r.ring.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]) });
    }
  }
  const tE = performance.now();
  HEADS = await lampHeads();
  const { keys: FK, shared } = finalKeys();
  // per cell: the binary (all buffers back to back, 4-byte aligned) and the manifest that indexes it
  const out = [];
  for (const [cx, cz] of REGION.list) {
    const cell = cellKey(cx, cz);
    const parts = [], man = { schema: SCHEMA, cell, origin: [cx * CELL, 0, cz * CELL], meshes: [], instances: [], materials: [], sidecar: null };
    let off = 0;
    const put = (arr) => { const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(new Uint8Array(pad)); off += pad; } const o = off; parts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); off += arr.byteLength; return { offset: o, bytes: arr.byteLength }; };
    const used = new Set();
    for (const a of ACC.values()) {
      if (a.cell !== cell) continue;
      const attrs = a.attrs.map((d) => {
        const n = d.chunks.reduce((s, c) => s + c.length, 0), arr = new CTOR[d.type](n);
        let o = 0; for (const c of d.chunks) { arr.set(c, o); o += c.length; }
        return { name: d.name, type: d.type, itemSize: d.itemSize, normalized: d.normalized, count: n / d.itemSize, ...put(arr) };
      });
      const ni = a.idx.reduce((s, c) => s + c.length, 0), ix = new Uint32Array(ni);
      { let o = 0; for (const c of a.idx) { ix.set(c, o); o += c.length; } }
      man.meshes.push({ mat: FK.get(a.mat), cls: a.cls, castShadow: a.castShadow, receiveShadow: a.receiveShadow, renderOrder: a.renderOrder, layers: a.layers,
        dress: !!a.dress, nightOnly: !!a.nightOnly, shadowOnly: !!a.shadowOnly, sources: [...a.sources].slice(0, 12), tris: a.nt, verts: a.nv, attrs, index: { count: ni, ...put(ix) } });
      used.add(a.mat);
    }
    for (const I of INST.values()) {
      if (I.cell !== cell) continue;
      const g = I.geo, sig = attrSig(g);
      const attrs = sig.map((d) => {
        const A = g.attributes[d.name], n = A.count, arr = new CTOR[d.type](n * d.itemSize), get = reader(A, d.type);
        for (let i = 0; i < n; i++) for (let c = 0; c < d.itemSize; c++) arr[i * d.itemSize + c] = get(i, c);
        return { name: d.name, type: d.type, itemSize: d.itemSize, normalized: d.normalized, count: n, ...put(arr) };
      });
      let index = null;
      if (g.index) { const ix = new Uint32Array(g.index.count); for (let i = 0; i < ix.length; i++) ix[i] = g.index.array[i]; index = { count: ix.length, ...put(ix) }; }
      const M = new Float32Array(I.M);
      const [ox, , oz] = man.origin;
      for (let k = 0; k < M.length; k += 16) { M[k + 12] -= ox; M[k + 14] -= oz; }
      const extra = {};
      for (const [n, v] of Object.entries(I.X || {})) extra[n] = { itemSize: (I.XS && I.XS[n]) || g.attributes[n].itemSize, ...put(new Float32Array(v)) };
      man.instances.push({ kind: I.kind, name: I.name, pool: I.pool || null, mat: FK.get(I.mat), cls: I.cls, castShadow: I.castShadow, receiveShadow: I.receiveShadow, renderOrder: I.renderOrder, layers: I.layers, nightOnly: !!I.nightOnly,
        count: M.length / 16, matrices: put(M), colors: I.C ? put(new Float32Array(I.C)) : null, extra, attrs, index, geoName: g.name || '' });
      used.add(I.mat);
    }
    const seen = new Set();
    for (const id of used) {
      const k = FK.get(id); if (seen.has(k)) continue; seen.add(k);
      const e = MATS.get(id);
      if (!e.desc) e.desc = describeMat(e.m, e.tileKey);   // once per export (the stand-in shader runs once)
      man.materials.push({ key: k, ...e.desc });
    }
    man.sidecar = sidecarFor(cell, buildings);
    const bin = new Blob(parts);
    man.bytes = off;
    const r1 = await fetch(`${sink}/put/${run}/${cell}.bin`, { method: 'POST', body: bin });
    const r2 = await fetch(`${sink}/put/${run}/${cell}.json`, { method: 'POST', body: JSON.stringify(man) });
    if (!r1.ok || !r2.ok) throw new Error('sink refused ' + cell);
    out.push({ cell, meshes: man.meshes.length, instances: man.instances.length, materials: man.materials.length, bytes: off,
      tris: man.meshes.reduce((s, m) => s + m.tris, 0), inst: man.instances.reduce((s, m) => s + m.count, 0), buildings: man.sidecar.buildings.length });
  }
  return { cells: out, materials: MATS.size, sharedKeys: shared, skipped: { ...SKIP }, signs, ms: { meshes: Math.round(tM - t0), rest: Math.round(tE - tM), total: Math.round(performance.now() - t0) } };
}
