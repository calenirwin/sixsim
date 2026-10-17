// SPACE r2 (docs/notes/space-r2.md): the light showcase's memory peak. `?lowmem=1` (tools/lite/build_lite.mjs QUERY; off by
// default, so the full client keeps every array for its readers: the perception export, the API's sensors, raycasts):
// the CPU copies of data that is on the GPU and that nothing reads again are let go once uploaded.
//
// Geometry: freeArraysAfterUpload(root, mark) gives every static, non-instanced mesh geometry created since `mark`
// (geometryMark(), taken when a tile's assembly starts: older geometries can be module templates that later builds clone
// or merge) its bounding box and sphere now and drops each attribute's array and the index once three has uploaded it;
// an attribute older than the mark (an index or a buffer shared by many geometries) keeps its array. Readers audited
// (2026-10-11, and with ?lowmem=probe below): the colliders, the surface and road queries, the walk graph, the traffic
// graph, the dresser and the hero records read the tile's data, not its meshes; the facade, prop and vendor kits merge
// their parts at build and only count triangles later; the tile's sign merge reads the sign holders once the fonts are
// in (city/fk/facadeKit.js marks them); the ground's kerb pass and the lawn field read the ground later (waited for,
// below); culling and Box3 use the bounds computed here. Kept: instanced meshes, skinned meshes, points and lines, any
// attribute that is not StaticDrawUsage (the pools write into theirs), interleaved attributes, a geometry under 64 KB,
// a geometry or a subtree marked userData.keepArrays. The array goes a few seconds after the upload, and a dropped
// array's buffer outlives a dispose for a while (below). A freed mesh no longer answers raycasts (main.js __PICK skips
// it). A lost context is recovered by reloading the page (game/showcase.js), which builds every tile again.
//
// Textures: a compressed texture (KTX2: the ground and material banks, the trees' atlases, the crowd's arrays, the fleet)
// lets its mip data go after its first upload, is kept from world/disposeOwned.js (userData.keep: it can no longer be
// uploaded again) and, with its Source, ignores later needsUpdate sets. A kit marks a texture it never repaints or reads
// once uploaded with dropAfterUpload (city/fk/signKit.js's atlas pages).
//
// Checks: window.__CPUFREE counts what went and any upload of data already let go that could not be recovered
// (`reuploads`, `texBroken`) and any write to a dropped array (`writes`), with the owners in `broken`: all must stay 0
// (tools/lite/tour_mem.mjs prints them). `?lowmem=probe` also traps every read of a dropped array and lists the readers
// (`readers`, by call site) and notes where a geometry drawn again was disposed; it is slower and is never published.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const MODE = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lowmem') : null;
export const LOWMEM = MODE === '1' || MODE === 'probe';
const PROBE = MODE === 'probe';
export const CPU_FREE_STATS = { geometries: 0, bytes: 0, textures: 0, texBytes: 0, recovered: 0, reuploads: 0, texBroken: 0, writes: 0, reads: 0, held: 0, heldMB: 0, broken: [], readers: {} };
if (typeof window !== 'undefined' && LOWMEM) window.__CPUFREE = CPU_FREE_STATS;

// the ids the next BufferGeometry and the next BufferAttribute will get (three numbers both in creation order)
export function geometryMark() {
  if (!LOWMEM) return null;
  const g = new THREE.BufferGeometry(), a = new THREE.BufferAttribute(new Float32Array(0), 1);
  g.dispose();
  return { g: g.id + 1, a: a.id + 1 };
}

const note = (s) => { if (CPU_FREE_STATS.broken.length < 40) CPU_FREE_STATS.broken.push(s); };
const site = (skip) => String(new Error().stack || '').split('\n').slice(skip, skip + 4).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?v=[0-9a-f]+/, '')).join(' < ');
const EMPTY = new Map();
const emptyOf = (a) => { const C = a.constructor; let e = EMPTY.get(C); if (!e) EMPTY.set(C, (e = new C(0))); return e; };
// ?lowmem=probe: the dropped array becomes an accessor that notes who reads it (three's renderer does not, once uploaded)
function trap(attr, E) {
  let n = 0;
  Object.defineProperty(attr, 'array', {
    configurable: true, enumerable: true,
    get() {
      CPU_FREE_STATS.reads++;
      if (n++ < 2) { const k = String(attr.__cpuFree).split(' ')[0].replace(/:-?\d{4,}/g, '') + ' | ' + site(3); const R = CPU_FREE_STATS.readers; if (k in R || Object.keys(R).length < 80) R[k] = (R[k] || 0) + 1; }
      return E;
    },
    set(v) { Object.defineProperty(attr, 'array', { value: v, writable: true, configurable: true, enumerable: true }); },
  });
}
// The drop and the GL buffers. Three calls an attribute's upload callback right after it made and filled the buffer,
// still bound (WebGLAttributes.createBuffer), so the callback reads the buffer from the binding. The array goes DROP_MS
// after the first upload, so a reader in the same frame or the next seconds still finds it (the ground's kerb pass reads
// position and matId at the mesh's first draw, the lawn field a tile that arrived while it loaded). Once the array is
// gone the buffer is its only copy: three's delete of it at a dispose (`gl.deleteBuffer`) is held back GRACE_MS, and an
// upload of the attribute meanwhile (a kit drawing again a geometry it disposed: a level it swaps back, a template the
// next tile takes) copies the held buffer on the GPU (`recovered`); then the buffer is deleted. An upload with nothing
// held (`reuploads`) is a kit drawing geometry long after its dispose: that kit's geometry gets userData.keepArrays.
const DROP_MS = 4000, GRACE_MS = 20000;
let GL = null, delBuf = null;
const OWNER = new WeakMap();   // GL buffer -> its attribute, from the upload until the buffer is deleted
const due = [];                // [time, attribute]: drops to make, in time order
const grace = [];              // [time, attribute, buffer]: held buffers to delete, in time order
function glOf() {
  if (GL) return GL;
  const r = typeof window !== 'undefined' && window.__ENGINE && window.__ENGINE.renderer;
  if (!r) return null;
  GL = r.getContext();
  delBuf = GL.deleteBuffer;
  GL.deleteBuffer = function (b) {
    const a = b && OWNER.get(b);
    if (a) {
      if (a.__dropped && a.__buf === b) {
        // the array went: the buffer is the only copy, held back for a while
        a.__buf = null; a.__held = b;
        grace.push([performance.now() + GRACE_MS, a, b]);
        CPU_FREE_STATS.held++; CPU_FREE_STATS.heldMB += a.__size / 1048576;
        return;
      }
      OWNER.delete(b);
      if (a.__buf === b) a.__buf = null;   // deleted before its drop: the drop is called off (the array is still there)
    }
    return delBuf.call(this, b);
  };
  setInterval(tick, 1000);
  return GL;
}
function release(a, b) {
  if (a.__held !== b) return;
  a.__held = null; OWNER.delete(b); delBuf.call(GL, b);
  CPU_FREE_STATS.held--; CPU_FREE_STATS.heldMB -= a.__size / 1048576;
}
// the ground (the tile's one non-indexed mesh with matId) has two readers of its own: the kerb pass copies position and
// matId at the mesh's first draw in the frame (world/materials.js gpKerbAsync, sets userData.gpK), the lawn field scans
// it when it takes the tile, which can be long after the upload: its module loads late and then takes every tile there is
// (world/vg36.js, sets userData.lawnScanned). Its arrays go once both have read it (`?gp31=0`, `?vg36=0`: that one is off).
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const KERB = !(Q && Q.get('gp31') === '0'), LAWN = !(Q && Q.get('vg36') === '0');
const readersDone = (g) => (!KERB || g.userData.gpK) && (!LAWN || g.userData.lawnScanned);
function drop(a) {
  a.__due = false;
  if (a.__dropped || !a.__buf || !a.array || !a.array.length) return;
  if (a.__gate && !readersDone(a.__gate)) { a.__due = true; due.push([performance.now() + 2000, a]); return; }
  a.__dropped = true;
  a.__size = a.array.byteLength;
  CPU_FREE_STATS.bytes += a.__size;
  const E = emptyOf(a.array);
  if (PROBE) trap(a, E); else a.array = E;
  // a later write has nothing to send (three would throw at the size change): counted, the GPU copy stays
  Object.defineProperty(a, 'needsUpdate', { configurable: true, get() { return false; }, set(v) { if (v) { CPU_FREE_STATS.writes++; if (!this.__wn) { this.__wn = 1; note('write ' + String(this.__cpuFree) + ' ' + site(3)); } } } });
}
function tick() {
  const now = performance.now();
  let k = 0;
  while (k < due.length && due[k][0] <= now) drop(due[k++][1]);
  if (k) due.splice(0, k);
  k = 0;
  while (k < grace.length && grace[k][0] <= now) { const [, a, b] = grace[k++]; release(a, b); }
  if (k) grace.splice(0, k);
}
function dropOnUpload(attr, own, mark, isIndex, gate) {
  if (!attr || attr.isInterleavedBufferAttribute || attr.__cpuFree || attr.usage !== THREE.StaticDrawUsage || !attr.array || !attr.array.length) return;
  if (mark && attr.id < mark.a) return;
  attr.__cpuFree = own || true;
  if (gate) attr.__gate = gate;
  const prev = attr.onUploadCallback;
  attr.onUpload(function () {
    try { prev && prev.call(this); } catch (e) { /* the previous callback's own business */ }
    const gl = glOf();
    const bound = gl ? gl.getParameter(isIndex ? gl.ELEMENT_ARRAY_BUFFER_BINDING : gl.ARRAY_BUFFER_BINDING) : null;
    if (!bound) return;   // (no buffer to read back the binding from: the array stays)
    if (this.__dropped) {
      // drawn again after a dispose: the new, empty buffer takes the held one's bytes on the GPU
      const h = this.__held;
      if (h && h !== bound) {
        gl.bindBuffer(gl.COPY_READ_BUFFER, h);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, bound);
        gl.bufferData(gl.COPY_WRITE_BUFFER, this.__size, gl.STATIC_DRAW);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, this.__size);
        gl.bindBuffer(gl.COPY_READ_BUFFER, null); gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
        release(this, h);
        this.__buf = bound; OWNER.set(bound, this);
        if (CPU_FREE_STATS.recovered++ < 20) note('recovered ' + String(this.__cpuFree) + (this.__geo && this.__geo.__dsite ? ' | disposed ' + ((performance.now() - this.__geo.__dt) / 1000).toFixed(1) + ' s before at ' + this.__geo.__dsite : ''));
        return;
      }
      CPU_FREE_STATS.reuploads++;
      note('lost ' + String(this.__cpuFree) + ' n' + this.count + (this.__geo && this.__geo.__dsite ? ' | disposed at ' + this.__geo.__dsite : ''));
      return;
    }
    // the first upload (or one more before the drop): the array goes DROP_MS later
    this.__buf = bound; OWNER.set(bound, this);
    if (!this.__due) { this.__due = true; due.push([performance.now() + DROP_MS, this]); }
  });
}
const label = (o) => { const a = []; for (let c = o, k = 0; c && k < 4; c = c.parent, k++) if (c.name) a.push(c.name); return a.join('<') || '(unnamed ' + ((o.material && (o.material.name || o.material.type)) || '') + ')'; };
const noRaycast = () => {};
const MIN_BYTES = 65536;
export function freeArraysAfterUpload(root, mark = null) {
  if (!LOWMEM || !root) return 0;
  let n = 0;
  const seen = new Set();
  // (an object marked userData.keepArrays keeps its whole subtree: city/fk/facadeKit.js's sign holders, which the tile's
  // sign merge reads once the fonts are in)
  const walk = (o, f) => { if (o.userData && o.userData.keepArrays) return; f(o); for (const c of o.children) walk(c, f); };
  walk(root, (o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return;
    const g = o.geometry;
    if (!g || seen.has(g) || (mark && g.id < mark.g) || (g.userData && g.userData.keepArrays) || (g.morphAttributes && Object.keys(g.morphAttributes).length)) return;
    seen.add(g);
    const pos = g.attributes.position;
    if (!pos || pos.isInterleavedBufferAttribute) return;
    const again = !!pos.__cpuFree;   // a later pass: only attributes added since (the ground's kerb attribute)
    if (!again) {
      if (!pos.array || !pos.array.length) return;
      // a small geometry stays whole: little to win, and the small ones are the kits' cached templates (a box, a post, a
      // bench made at their first use, in whichever tile that was, and drawn by every tile after it: the first tile's
      // dispose deletes their buffers and the others upload them again)
      let bytes = g.index ? g.index.array.byteLength : 0;
      for (const k in g.attributes) { const a = g.attributes[k]; if (a.array) bytes += a.array.byteLength; }
      if (bytes < MIN_BYTES) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
    }
    const own = label(o), gate = g.attributes.matId && !g.index ? g : null;
    for (const k in g.attributes) dropOnUpload(g.attributes[k], own + ' .' + k, mark, false, gate);
    dropOnUpload(g.index, own + ' .index', mark, true, gate);
    if (PROBE) { for (const k in g.attributes) g.attributes[k].__geo = g; if (g.index) g.index.__geo = g; }
    if (again) return;
    o.raycast = noRaycast;
    n++;
  });
  CPU_FREE_STATS.geometries += n;
  return n;
}

// ?lowmem=probe: who disposes a geometry that is drawn again (the site goes with the recovery's note)
if (PROBE) {
  const dispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function () { if (this.attributes.position && this.attributes.position.__cpuFree) { this.__dsite = site(3); this.__dt = performance.now(); } return dispose.call(this); };
}

// ?census=1 (a diagnostic, never published): every canvas the page makes, with the code that made it, and three's programs
// by material name; window.__CENSUS() (after a collection) names what holds the renderer's canvases and the GPU's programs
if (typeof window !== 'undefined' && typeof location !== 'undefined' && new URLSearchParams(location.search).get('census') === '1') {
  const live = [];
  const where = () => String(new Error().stack || '').split('\n').slice(3, 6).map((l) => { const m = /(?:src|assets)\/([\w/.-]+?)(?:-[\w-]{8})?\.js[^:]*:(\d+)/.exec(l); const f = /at ([\w$.<>]+) /.exec(l); return (f ? f[1] + ' ' : '') + (m ? m[1] + ':' + m[2] : ''); }).join(' < ');
  const track = (c) => { live.push([new WeakRef(c), where()]); };
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...a) { const el = ce.call(this, tag, ...a); if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') track(el); return el; };
  if (typeof OffscreenCanvas !== 'undefined') { const OC = OffscreenCanvas; globalThis.OffscreenCanvas = class extends OC { constructor(w, h) { super(w, h); track(this); } }; }
  window.__CENSUS = (full = true) => {
    const by = {}; let n = 0, mb = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const c = live[i][0].deref();
      if (!c) { live.splice(i, 1); continue; }
      const b = (c.width * c.height * 4) / 1048576;
      n++; mb += b;
      if (full) { const e = by[live[i][1]] || (by[live[i][1]] = [0, 0]); e[0]++; e[1] += b; }
    }
    const R = window.__ENGINE && window.__ENGINE.renderer, P = {};
    const progs = (R && R.info && R.info.programs) || [];
    if (full) for (const q of progs) P[q.name || '(unnamed)'] = (P[q.name || '(unnamed)'] || 0) + 1;
    const top = (o, k, f) => Object.entries(o).sort((a, b) => f(b[1]) - f(a[1])).slice(0, k);
    return { canvases: n, canvasMB: Math.round(mb), programs: progs.length,
      ...(full ? { byCreator: top(by, 40, (v) => v[1]).map(([k, v]) => [k, v[0], Math.round(v[1])]), programsByName: top(P, 50, (v) => v) } : {}) };
  };
}

// what reaches the tile after its assembly (the merged signs, once the fonts are in; the parts a kit adds a moment later):
// a child added to the tile's group at once, anything deeper at two later passes while the tile is in the scene
export function lateSweep(group, mark) {
  if (!LOWMEM || !group || !group.addEventListener) return;
  group.addEventListener('childadded', (e) => { if (e.child) freeArraysAfterUpload(e.child, mark); });
  for (const ms of [10000, 40000]) setTimeout(() => { if (group.parent) freeArraysAfterUpload(group, mark); }, ms);
}

// compressed textures: the mip data goes after the first upload. Every KTX2 texture comes from the app's one KTX2Loader
// (city/mat/ktx2.js; the glTF models' too), whose textures get this as their onUpdate (three calls it after an upload; a
// texture's own onUpdate is null, so the prototype cannot carry it), and a clone of one takes it too. A clone shares the
// mip objects (the glTF loader clones a texture for each other sampler of its image): the texture lets go of its own
// references only (new mip objects without data), so the bytes go once every texture holding them has been uploaded. The
// texture's Source then ignores needsUpdate (a clone with the same settings shares the uploaded texture; its needsUpdate
// would upload again).
const blockSet = (o, k) => Object.defineProperty(o, k, { configurable: true, get() { return false; }, set() { /* the data is gone: no second upload */ } });
function dropCompressed(tex) {
  const t = tex || this;
  if (!t || (t.userData && t.userData.keepData)) return;
  const mm = t.mipmaps || [];
  if (mm.some((m) => m && m.data && !m.data.byteLength)) {
    // an upload from data already let go (a clone with other settings made after the drop, or one disposed and drawn again)
    CPU_FREE_STATS.texBroken++; note('texture ' + (t.name || t.uuid) + ' ' + (t.image && t.image.width) + 'x' + (t.image && t.image.height) + ' ' + site(3));
    return;
  }
  let b = 0;
  t.mipmaps = mm.map((m) => { if (!m || !m.data) return m; b += m.data.byteLength; return { ...m, data: emptyOf(m.data) }; });
  t.userData.keep = true;
  blockSet(t, 'needsUpdate');
  if (t.source) blockSet(t.source, 'needsUpdate');
  CPU_FREE_STATS.textures++; CPU_FREE_STATS.texBytes += b;
}
// a texture its kit never draws into or reads again once uploaded (city/fk/signKit.js's sign atlases, packed after the
// fonts are in; world/nycDress.js's generator textures, painted once at start): a DataTexture lets its data go, a canvas
// texture shrinks its canvas to 1 x 1; the GPU copy stays. A per-tile texture still goes with its tile; `keep` marks one
// that every tile shares
export function dropAfterUpload(tex, keep = false) {
  if (!LOWMEM || !tex) return tex;
  const prev = tex.onUpdate;
  tex.onUpdate = function (arg) {
    const t = arg || tex;
    if (prev) { try { prev.call(t, t); } catch (e) { /* its own business */ } }
    if (t.userData.__dropped) { CPU_FREE_STATS.texBroken++; note('texture uploaded again ' + (t.name || t.uuid)); return; }
    const img = t.image;
    let b = 0;
    if (t.isDataTexture && img && img.data && img.data.byteLength) { b = img.data.byteLength; img.data = emptyOf(img.data); }
    else if (img && img.width > 1 && typeof img.getContext === 'function') { b = img.width * img.height * 4; img.width = 1; img.height = 1; }
    else return;
    t.userData.__dropped = true;
    if (keep) t.userData.keep = true;   // (a texture every tile shares: world/disposeOwned.js never disposes it)
    blockSet(t, 'needsUpdate');
    if (t.source) blockSet(t.source, 'needsUpdate');
    CPU_FREE_STATS.textures++; CPU_FREE_STATS.texBytes += b;
  };
  return tex;
}
if (LOWMEM && KTX2Loader.prototype._createTexture) {
  const make = KTX2Loader.prototype._createTexture;
  KTX2Loader.prototype._createTexture = function (...a) {
    return make.apply(this, a).then((t) => { if (t && t.isCompressedTexture && !t.onUpdate) t.onUpdate = dropCompressed; return t; });
  };
  const copy = THREE.Texture.prototype.copy;
  THREE.Texture.prototype.copy = function (src) { copy.call(this, src); if (src && src.onUpdate === dropCompressed) this.onUpdate = dropCompressed; return this; };
}
