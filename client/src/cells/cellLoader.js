// ?cells=1: the baked L0 cells (docs/specs/cell-package.md, v0) load from their packages instead of the live city's own
// static content. The streamer still assembles every tile (the simulations read its roads, sidewalks, surfaces and
// colliders until the core reads the sidecars), and then, inside each baked cell:
//   - the live static meshes lose the triangles whose plan centroid is in a baked cell (the baker's own rule,
//     cells/cellRules.js), and live instances there are dropped;
//   - the instancer draws no live instance there (window.__R1A_CELLHIDE, a marked block in city/instancer.js);
//   - the dresser keeps today's ring, but a building whose centroid is in a baked cell takes its slot without being built
//     (the package holds it dressed) and the hero ring leaves it alone; the package's dressed buildings hide their tile
//     facades (the tile's hide mask);
//   - the live city leaves a cell only in the frame its package joins (no hole while loading); a package mesh whose
//     material key does not resolve is never drawn with a stand-in: it waits hidden while the live meshes of that key stay;
//   - objects the baker saw moving (index.json movers) stay live;
//   - the package's meshes are drawn with the live client's own material of the same key (fallback: its PBR stand-in),
//     its pooled instances are claimed into the instancer's pools (so they keep the pools' LOD, culling and shadows).
// ?cellsbase=<url> serves the cache (default /cells); everything else is unchanged.
import * as THREE from 'three';
import { MeshoptDecoder } from './meshoptDecoder.js';   // three's decoder (MIT), vendored: a new optimized dep reloads Vite's deps mid-run
import { CELL, cellKey, skipReason, triXZ, materialKey, materialSignature, baseKey, isDynamicPool } from './cellRules.js';
import { ENV } from '../world/materials.js';
import { r1aSignText } from '../city/signText.js';
const OWN_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
export const CELLS_ON = Q.get('cells') === '1';
const BASE = (Q.get('cellsbase') || '/cells').replace(/\/$/, '');

// ---------------------------------------------------------------- a minimal glTF 2.0 binary reader (the package subset)
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
async function readGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  let o = 12, json = null, bin = null;
  while (o < buf.byteLength) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o + 8, len)));
    else if (type === 0x004e4942) bin = new Uint8Array(buf, o + 8, len);
    o += 8 + len;
  }
  // every buffer view decoded at once: the big ones in the decoder's workers, the small ones here (a worker's reply waits
  // for the main thread between the tiles' assembly tasks, so hundreds of small replies cost more than they save)
  await MeshoptDecoder.ready;
  const views = await Promise.all((json.bufferViews || []).map(async (bv) => {
    const mx = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (!mx) return { data: new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength), stride: bv.byteStride || 0 };
    const src = new Uint8Array(bin.buffer, bin.byteOffset + (mx.byteOffset || 0), mx.byteLength);
    if (mx.count * mx.byteStride >= 1 << 20) return { data: await MeshoptDecoder.decodeGltfBufferAsync(mx.count, mx.byteStride, src, mx.mode, mx.filter || 'NONE'), stride: mx.byteStride };
    const t0 = performance.now(), dst = new Uint8Array(mx.count * mx.byteStride);
    MeshoptDecoder.decodeGltfBuffer(dst, mx.count, mx.byteStride, src, mx.mode, mx.filter || 'NONE');
    MAIN.decodeMs += performance.now() - t0;
    return { data: dst, stride: mx.byteStride };
  }));
  const viewData = async (i) => views[i];
  const accessor = async (i) => {
    const a = json.accessors[i], C = CT[a.componentType], n = NC[a.type];
    const v = await viewData(a.bufferView), off = a.byteOffset || 0, es = C.BYTES_PER_ELEMENT * n;
    const at = v.data.byteOffset + off;
    if ((!v.stride || v.stride === es) && at % C.BYTES_PER_ELEMENT === 0) return { array: new C(v.data.buffer, at, a.count * n), itemSize: n, normalized: !!a.normalized };   // a view, no copy
    const out = new C(a.count * n);
    if (!v.stride || v.stride === es) out.set(new C(v.data.buffer.slice(at, at + a.count * es)));
    else { const raw = new Uint8Array(es); for (let k = 0; k < a.count; k++) { raw.set(v.data.subarray(off + k * v.stride, off + k * v.stride + es)); out.set(new C(raw.buffer.slice(0)), k * n); } }
    return { array: out, itemSize: n, normalized: !!a.normalized };
  };
  return { json, accessor };
}
const MAIN = { decodeMs: 0 };   // main-thread time of the loader's synchronous parts (the stats report it)
const nameOf = (sem) => (sem === 'POSITION' ? 'position' : sem === 'NORMAL' ? 'normal' : sem === 'TANGENT' ? 'tangent' : sem === 'COLOR_0' ? 'color'
  : sem.startsWith('TEXCOORD_') ? (sem === 'TEXCOORD_0' ? 'uv' : 'uv' + sem.slice(9)) : sem.startsWith('_') ? sem.slice(1) : sem.toLowerCase());

// ---------------------------------------------------------------- the loader
export class CellLoader {
  constructor(streamer) {
    this.S = streamer;
    this.baked = new Set();          // cell keys
    this.byTile = new Map();         // tile key -> [cell keys]
    this.cells = new Map();          // cell key -> { state, group, claims, buildings }
    this.reg = new Map();            // material key -> live materials
    this.byName = new Map();         // object name -> live objects (a package node names the objects it was cut from)
    this.keyOf = new Map();          // material uuid -> key
    this.group = new THREE.Group(); this.group.name = 'cells';
    this.stats = { loaded: 0, loadMs: 0, buildMs: 0, bytes: 0, clipped: 0, hidden: 0, fallbacks: 0, matHits: 0, inflight: 0, firstFetch: null, firstReady: null, lastReady: null, sweepMs: 0 };
    this.fallback = new Map();
    this.pending = [];               // meshes drawn with a guessed or stand-in material, retried in tick()
    this.readyCells = new Set();     // cells whose package is in: only there is the live city taken out (no hole while loading)
    this.readyNum = new Set();       // the same as numbers (the instancer asks per instance per frame: no strings)
    this.rb = [Infinity, Infinity, -Infinity, -Infinity];   // the ready cells' plan bounds (a quick no)
    this.readyVer = 0;
    this.cellVer = new Map();        // cell key -> readyVer when its package joined (an object is re-cut only for newer cells)
    this.joining = [];               // built packages waiting for the next tick
    this.finishing = [];             // decoded packages whose tile is in: their meshes are made in the next tick
    this.keepLive = new Map();       // material key -> package meshes waiting for it: the live meshes of that key stay
    this._frame = 0;
  }
  async init() {
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/index.json`, { cache: 'no-cache' });
      this.index = await r.json();
    } catch (e) { console.warn('[cells] no index at', BASE, e); this.index = { cells: {} }; }
    this.movers = new Set(this.index.movers || []);   // what the baker saw moving stays live everywhere
    for (const [k, c] of Object.entries(this.index.cells || {})) {
      this.baked.add(k);
      const [cx, cz] = k.split('_').map(Number), t = `${Math.floor((cx * CELL) / 512)}_${Math.floor((cz * CELL) / 512)}`;
      if (!this.byTile.has(t)) this.byTile.set(t, []);
      this.byTile.get(t).push(k);
    }
    this.pkgKeys = new Set();
    this._patchDresser();
    this.S.scene.add(this.group);
    try { MeshoptDecoder.useWorkers(Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) >> 2))); } catch (e) { console.warn('[cells] decoder workers unavailable', e); }
    window.__R1A_CELLHIDE = (x, z, pool) => !isDynamicPool(pool) && this.isReady(x, z);   // signal heads stay live
    this._dirtyPools();
    window.__CELLS = this;
    // prefetch: the packages of the baked cells within 1.6 km of the start are fetched and decoded while the city boots;
    // each joins once its tile is in (a take's preload would ask for its load set the same way)
    const sx = Number(Q.get('x')), sz = Number(Q.get('z'));
    if (Number.isFinite(sx) && Number.isFinite(sz)) {
      for (const k of this.baked) { const [cx, cz] = k.split('_').map(Number); if (Math.hypot((cx + 0.5) * CELL - sx, (cz + 0.5) * CELL - sz) < 1600) this._load(k, false); }
    }
    console.log(`[cells] ${this.baked.size} baked cells in ${this.byTile.size} tiles from ${BASE} (${(performance.now() - t0).toFixed(0)} ms)`);
    return this;
  }
  // The dresser keeps its ring exactly as in today's client, but a building of a baked cell takes its slot without being
  // built (the package holds it dressed), and the hero ring treats it as owned (no trims on it)
  _patchDresser() {
    const D = window.__LD13;
    if (!D || D.__r1a) return;
    D.__r1a = true;
    const dress = D._dress.bind(D), owns = D.owns.bind(D);
    D._dress = (rec, tile) => {
      if (!this.pkgKeys.has(rec.key)) return dress(rec, tile);
      D.active.set(rec.key, { handles: [], tile: rec.tile, bid: rec.bid, hideTex: null, cx: rec.cx, cz: rec.cz, pkg: true });
    };
    D.owns = (k) => this.pkgKeys.has(k) || owns(k);
  }
  // the streamer's near mask (NM24: the far level and lane B's persistent tier are discarded over drawn near tiles) marks a
  // tile whose baked cells are drawn, whether or not the tile itself is assembled
  tileDrawn(tk) { for (const ck of this.byTile.get(tk) || []) if (this.readyCells.has(ck)) return true; return false; }
  isBaked(x, z) { return this.baked.has(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))); }
  isReady(x, z) {
    const b = this.rb;
    if (x < b[0] || z < b[1] || x >= b[2] || z >= b[3]) return false;
    return this.readyNum.has((Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768));
  }
  _readyAdd(ck, on) {
    const [cx, cz] = ck.split('_').map(Number), n = (cx + 32768) * 65536 + (cz + 32768);
    if (on) { this.readyCells.add(ck); this.readyNum.add(n); } else { this.readyCells.delete(ck); this.readyNum.delete(n); }
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const k of this.readyCells) { const [i, j] = k.split('_').map(Number); b[0] = Math.min(b[0], i * CELL); b[1] = Math.min(b[1], j * CELL); b[2] = Math.max(b[2], (i + 1) * CELL); b[3] = Math.max(b[3], (j + 1) * CELL); }
    this.rb = b;
  }
  _dirtyPools() { const I = this.S.ctx.instancer; if (I && I.pools) for (const p of I.pools.values()) { p.dirty = p.sdirty = p.fdirty = true; } }
  // ---- the streamer hook (world/streamer.js _assemble, marked R1A): a tile was assembled, before it joins the scene
  onTile(key, data) {
    const list = this.byTile.get(key);
    if (!list) return;
    for (const r of data.bldgs || []) if (this.isBaked(r.cx, r.cz)) this.pkgKeys.add(r.key);   // the package's buildings (see _patchDresser)
    if (data.facadeMat) this._register(data.facadeMat, key);
    this._registerTree(data.group, key);
    for (const ck of list) this._load(ck, true);   // the live city stays in a cell until its package is in
    const dispose = data.dispose;
    data.dispose = (scene, inst) => { for (const ck of list) this._unload(ck); dispose(scene, inst); };
    this._applyHides();
  }
  // ---- material registry: the live materials by key
  _register(m, tileKey = null) {
    if (!m) return null;
    const ck = m.uuid + ':' + m.version + (tileKey ? '@' + tileKey : '');   // a material the client changes (needsUpdate) is keyed again
    let k = this.keyOf.get(ck);
    if (!k) { k = materialKey(m, tileKey); this.keyOf.set(ck, k); }
    let L = this.reg.get(k);
    if (!L) this.reg.set(k, (L = []));
    if (!L.includes(m)) L.push(m);
    return k;
  }
  _registerTree(root, tileKey = null) {
    root.traverse((o) => {
      if (!o.material || (o.userData && o.userData.cellPkg)) return;
      if (o.name) { let N = this.byName.get(o.name); if (!N) this.byName.set(o.name, (N = [])); if (!N.includes(o)) N.push(o); }
      let tk = tileKey;
      if (!tk) for (let p = o; p; p = p.parent) if (p.name && p.name.startsWith('tile_')) { tk = p.name.slice(5); break; }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) this._register(m, m && m.userData && m.userData.isFacade ? tk : null);
    });
  }
  _registerAll() {   // afresh: materials change after they are made (the tree atlas, the probes), so their keys do
    this.reg.clear(); this.byName.clear();
    for (const [k, t] of this.S.tiles) if (t.data && t.data.facadeMat) this._register(t.data.facadeMat, k);
    this._registerTree(this.S.scene);
    const D = window.__LD13; if (D && D.M) for (const m of D.M.values()) this._register(m);
    const I = this.S.ctx.instancer; if (I && I.pools) for (const p of I.pools.values()) if (p.mesh) this._register(Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material);
    this._regAll = performance.now();
  }
  // the live material for a key: by its level-0 key, and among several candidates by the package's level-1 and level-2
  // keys (files and sizes, pixel samples: only comparable once the textures are in, so a guess is retried in tick())
  _resolve(key, desc, names = null) {
    const base = baseKey(key), tile = base.includes('@') ? base.split('@')[1] : null;
    let L = this.reg.get(base);
    if ((!L || !L.length) && tile) {   // a tile facade: that tile's own facade material, when its key matches
      const fm = this.S.tiles.get(tile)?.data?.facadeMat;
      if (fm && materialKey(fm) === base.split('@')[0]) L = [fm];
    }
    if (!L || !L.length) return { m: null, exact: false };
    if (L.length === 1) return { m: L[0], exact: true };
    // several live materials of the key (one per level of detail of a set, per closure): the one the live object of the
    // same name wears
    if (names) for (const n of names) for (const o of this.byName.get(n) || []) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (L.includes(m)) return { m, exact: true };
    const ks = desc && desc.keys;
    if (ks) for (const level of [1, 2]) { const hit = L.filter((m) => materialKey(m, tile, level) === ks[level]); if (hit.length === 1) return { m: hit[0], exact: true }; }
    return { m: L[0], exact: false };
  }
  // the package's own images for the maps the page paints at run time (`generated`): an atlas's layout (the storefront
  // signs' face and mask pages, the shop and street-name atlases), which occupant a sign shows and what a canvas holds
  // depend on what the page built before, so the live texture under the same key can hold something else at the
  // package's uvs. The cell draws what was baked: the live material of the key (or, for a cell's own street names, the
  // page's sign material) cloned with its shader hooks, wearing the stored files. Files load once each.
  _ownMaterial(key, desc, names) {
    const slots = Object.entries(desc.textures || {}).filter(([, t]) => t && t.file && (t.generated || desc.cellTexture));
    if (!slots.length) return null;
    const sig = baseKey(key) + '|' + slots.map(([k, t]) => `${k}=${t.file}`).join(',');
    if (!this.ownMat) this.ownMat = new Map();
    let m = this.ownMat.get(sig);
    if (!m) {
      const r = this._resolve(key, desc, names);
      const live = r.m || (desc.cellTexture ? r1aSignText.mat() : null);
      if (!live) return null;
      m = live.clone();
      m.onBeforeCompile = live.onBeforeCompile;   // (Material.copy keeps neither the hooks nor added defines)
      m.customProgramCacheKey = live.customProgramCacheKey;
      if (live.defines) m.defines = { ...live.defines };
      for (const [k, t] of slots) m[k] = this._ownTex(t);
      m.userData = { ...live.userData, cellTexture: slots[0][1].file };
      m.needsUpdate = true;
      this.ownMat.set(sig, m);
      this.stats.ownMats = this.ownMat.size;
    }
    this.stats.matHits++;
    return { m, exact: true };
  }
  _ownTex(t) {
    const rep = t.repeat || [1, 1], off = t.offset || [0, 0], wrap = t.wrap || [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping];
    const k = `${t.file}|${rep.join(',')}|${off.join(',')}|${wrap.join(',')}|${t.channel || 0}`;
    if (!this.ownTexs) this.ownTexs = new Map();
    let tex = this.ownTexs.get(k);
    if (!tex) {
      const done = () => { tex.userData.r1aDone = true; this.stats.ownWait = Math.max(0, (this.stats.ownWait || 1) - 1); };
      tex = new THREE.TextureLoader().load(`${BASE}/${t.file}`, done, undefined, () => { done(); this.stats.ownTexErr = (this.stats.ownTexErr || 0) + 1; });
      tex.userData.r1aOwn = true;
      this.stats.ownWait = (this.stats.ownWait || 0) + 1;
      tex.flipY = false;   // the stored rows run as glTF samples them
      tex.colorSpace = t.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = wrap[0]; tex.wrapT = wrap[1]; tex.repeat.set(rep[0], rep[1]); tex.offset.set(off[0], off[1]);
      tex.channel = t.channel || 0; tex.anisotropy = 8;
      this.ownTexs.set(k, tex);
      this.stats.ownTex = this.ownTexs.size;
    }
    return tex;
  }
  _material(key, desc, names = null) {
    if (desc && desc.textures) { const own = this._ownMaterial(key, desc, names); if (own) return own; }
    const base = baseKey(key), tile = base.includes('@') ? base.split('@')[1] : null;
    let r = this._resolve(key, desc, names);
    if (!r.m && (!this._regAll || performance.now() - this._regAll > 2000)) { this._registerAll(); r = this._resolve(key, desc, names); }
    if (r.m) { this.stats.matHits++; if (!r.exact) this.stats.guessed = (this.stats.guessed || 0) + 1; return r; }
    this.stats.fallbacks++;
    if (!this.fallback.has(key)) {
      const d = desc || {}, c = d.color || [0.7, 0.7, 0.7];
      const f = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: d.roughness ?? 0.9, metalness: d.metalness ?? 0, side: d.side ?? 0,
        transparent: !!d.transparent, opacity: d.opacity ?? 1, alphaTest: d.alphaTest || 0, vertexColors: !!d.vertexColors });
      f.name = 'cellsFallback:' + (d.name || key);
      this.fallback.set(key, f);
      if (this.fallback.size <= 12) {
        // why: the nearest live material of the same type and name, and the first fields of its signature that differ
        let why = '';
        if (d.sig) {
          const want = d.sig.split(';');
          let best = null, bestN = -1;
          for (const m2 of new Set([...this.reg.values()].flat())) {
            if (m2.type !== d.type || (m2.name || '') !== (d.name || '')) continue;
            const have = materialSignature(m2, 1).split(';'), hs = new Set(have);
            const n = want.filter((x) => hs.has(x)).length;
            if (n > bestN) { bestN = n; best = have; }
          }
          if (best) { const bs = new Set(best), ws = new Set(want); why = ' baked-only: ' + want.filter((x) => !bs.has(x)).join(' ').slice(0, 300) + ' | live-only: ' + best.filter((x) => !ws.has(x)).join(' ').slice(0, 300); }
          else why = ' (no live material of that type and name)';
        }
        if (tile) { const b0 = base.split('@')[0]; why += ' | same key at: ' + [...this.reg.keys()].filter((k) => k.split('@')[0] === b0).map((k) => k.split('@')[1] || '-').join(','); }
        console.warn('[cells] no live material for', key + why);
      }
    }
    return { m: this.fallback.get(key), exact: false };
  }
  // ---- taking the live static content out of the baked cells
  sweepTree(root) {
    const t0 = performance.now();
    this._sweep(root);
    this.stats.sweepMs += performance.now() - t0;
  }
  _sweep(root) {
    const ctx = { farGroup: this.S.macroGroup, farMat: this.S.ctx.farMat, movers: this.movers };
    if (!this.readyCells.size) return;
    const keep = this.keepLive.size ? (o) => {   // a live mesh whose material the packages could not resolve stays whole
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        let tk = null;
        if (m.userData && m.userData.isFacade) for (let p = o; p; p = p.parent) if (p.name && p.name.startsWith('tile_')) { tk = p.name.slice(5); break; }
        if (this.keepLive.has(this._register(m, tk))) return true;
      }
      return false;
    } : null;
    const users = new Map();
    root.traverse((o) => { if (o.geometry) users.set(o.geometry, (users.get(o.geometry) || 0) + 1); });
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      if (skipReason(o, ctx)) return;
      if (keep && keep(o)) return;
      if (o.isInstancedMesh) this._hideInstances(o);
      else this._clipMesh(o, (users.get(o.geometry) || 1) > 1);
    });
  }
  _cellsTouch(x0, z0, x1, z1) {   // 'none' | 'all' | 'some' baked cells under a plan box
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) return 'some';
    let n = 0, b = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { n++; if (this.readyCells.has(cellKey(i, j))) b++; }
    return b === 0 ? 'none' : b === n ? 'all' : 'some';
  }
  // the newest join among the ready cells under a plan box (an object is cut again only when a newer cell joined)
  _touchVer(B) {
    const i0 = Math.floor(B[0] / CELL), i1 = Math.floor(B[2] / CELL), j0 = Math.floor(B[1] / CELL), j1 = Math.floor(B[3] / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) return this.readyVer;
    let v = -1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const cv = this.cellVer.get(cellKey(i, j)); if (cv !== undefined && cv > v && this.readyCells.has(cellKey(i, j))) v = cv; }
    return v;
  }
  _clipMesh(o, shared) {
    const g = o.geometry, pa = g.attributes.position;
    const gs = `${g.uuid}:${g.index ? g.index.version : 'n'}:${pa.version}:${g.drawRange.start}:${g.drawRange.count}`;
    if (o.userData.__r1aG !== gs || o.userData.__r1aB === undefined) {
      if (!g.boundingBox || o.userData.__r1aG !== gs) g.computeBoundingBox();
      const bb = g.boundingBox;
      let B = null;
      if (bb && isFinite(bb.min.x) && (bb.max.x - bb.min.x) < 1e5) { const W = bb.clone().applyMatrix4(o.matrixWorld); B = [W.min.x, W.min.z, W.max.x, W.max.z]; }
      o.userData.__r1aB = B;
    }
    const B = o.userData.__r1aB;
    if (o.userData.__r1aG === gs && (o.userData.__r1aV ?? -2) >= (B ? this._touchVer(B) : this.readyVer)) return;
    const done = (geo) => { const pa2 = geo.attributes.position; o.userData.__r1aG = `${geo.uuid}:${geo.index ? geo.index.version : 'n'}:${pa2.version}:${geo.drawRange.start}:${geo.drawRange.count}`; o.userData.__r1aV = this.readyVer; };
    const touch = B ? this._cellsTouch(B[0], B[1], B[2], B[3]) : 'some';
    if (o.userData.__r1aHidden && touch !== 'all') { o.layers.mask = o.userData.__r1aMask; o.userData.__r1aHidden = false; }   // it grew out of the baked cells
    if (touch === 'none') { done(g); return; }
    if (touch === 'all') { if (!o.userData.__r1aHidden) { o.userData.__r1aMask = o.layers.mask; o.layers.disableAll(); o.userData.__r1aHidden = true; this.stats.hidden++; } done(g); return; }
    const e = o.matrixWorld.elements, idx = g.index ? g.index.array : null;
    const nIdx = idx ? g.index.count : pa.count;
    const start = Math.max(0, g.drawRange.start), end = Math.min(nIdx, start + g.drawRange.count);
    if (!idx) {   // non-indexed (the static pools): zero the triangles in place, as StaticPool.free does
      let n = 0;
      if (shared) { o.geometry = g.clone(); o.userData.__r1aG = null; return this._clipMesh(o, false); }
      for (let t = start; t + 2 < end; t += 3) {
        const p = triXZ(pa, e, t, t + 1, t + 2);
        if (!p || !this.isReady(p[0], p[1])) continue;
        for (let c = 0; c < 3; c++) pa.setXYZ(t + c, 0, 0, 0);
        n++;
      }
      if (n) { pa.needsUpdate = true; this.stats.clipped += n; }
      done(g);
      return;
    }
    const keep = [];
    const groups = g.groups && g.groups.length ? g.groups : null;
    const out = [];
    let drop = 0;
    for (let t = start; t + 2 < end; t += 3) {
      const p = triXZ(pa, e, idx[t], idx[t + 1], idx[t + 2]);
      if (p && this.isReady(p[0], p[1])) { drop++; continue; }
      keep.push(t);
    }
    if (!drop) { done(g); return; }
    const ni = new (pa.count > 65535 ? Uint32Array : Uint16Array)(keep.length * 3);
    keep.forEach((t, k) => { ni[k * 3] = idx[t]; ni[k * 3 + 1] = idx[t + 1]; ni[k * 3 + 2] = idx[t + 2]; });
    let ng = null;
    if (groups) {   // the kept triangles stay in their groups' order
      ng = [];
      keep.forEach((t, k) => { let mi = 0; for (const q of groups) if (t >= q.start && t < q.start + q.count) { mi = q.materialIndex ?? 0; break; } const L = ng[ng.length - 1]; if (L && L.materialIndex === mi) L.count += 3; else ng.push({ start: k * 3, count: 3, materialIndex: mi }); });
    }
    const tgt = shared ? g.clone() : g;
    tgt.setIndex(new THREE.BufferAttribute(ni, 1));
    tgt.setDrawRange(0, Infinity);
    if (ng) { tgt.clearGroups(); for (const q of ng) tgt.addGroup(q.start, q.count, q.materialIndex); }
    if (shared) o.geometry = tgt;
    this.stats.clipped += drop;
    done(tgt);
  }
  _hideInstances(o) {
    const im = o.instanceMatrix, sig = `${im.version}:${o.count}:${this.readyVer}`;
    if (o.userData.__r1a === sig) return;
    const A = im.array, m4 = new THREE.Matrix4();
    let n = 0;
    for (let k = 0; k < o.count; k++) {
      m4.fromArray(A, k * 16).premultiply(o.matrixWorld);
      const e = m4.elements;
      if (e[0] === 0 && e[5] === 0 && e[10] === 0) continue;
      if (!this.isReady(e[12], e[14])) continue;
      A.fill(0, k * 16, k * 16 + 16);
      n++;
    }
    if (n) { im.needsUpdate = true; this.stats.hidden += n; }
    o.userData.__r1a = `${im.version}:${o.count}:${this.readyVer}`;
  }
  // every few frames: whatever joined the scene since (lazy near forms, other systems' meshes) is swept too
  _join() {
    const tJ = performance.now();
    // a cell whose own images are still loading waits for them (up to 30 s): it would draw them black
    const wait = [];
    this.joining = this.joining.filter((ck) => {
      const rec = this.cells.get(ck);
      const w = !!rec && rec.state === 'built' && !!rec.waitTex && rec.waitTex.some((t) => !t.userData.r1aDone) && tJ - (rec.builtAt || 0) < 30000;
      if (w) wait.push(ck);
      return !w;
    });
    this.joinWait = wait;
    const I = this.S.ctx.instancer;
    for (const ck of this.joining.splice(0)) {
      const rec = this.cells.get(ck);
      if (!rec || rec.state !== 'built') continue;
      rec.state = 'ready';
      this.group.add(rec.group);
      // the pool instances go into the pools now, marked as the package's (never drawn twice with the live ones)
      for (const ps of rec.poolSets) {
        const p = I && I.pools ? I.pools.get(ps.pool) : null;
        if (!p) continue;
        const { T, R, S, C, ox, oy, oz } = ps, n = T.length / 3, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
        for (let k = 0; k < n; k++) {
          v.set(T[k * 3] + ox, T[k * 3 + 1] + oy, T[k * 3 + 2] + oz); q.fromArray(R, k * 4); sc.fromArray(S, k * 3);
          const slot = I.claim(ps.pool, v.x, v.y, v.z, 0, Math.abs(sc.x), sc.y, sc.z, 0xffffff);
          if (slot < 0) continue;
          m4.compose(v, q, sc);
          p.mats.set(m4.elements, slot * 16);
          if (C) { p.cols[slot * 3] = C[k * 3]; p.cols[slot * 3 + 1] = C[k * 3 + 1]; p.cols[slot * 3 + 2] = C[k * 3 + 2]; }
          if (!p.cellPkg || p.cellPkg.length < p.cap) { const a = new Uint8Array(p.cap); if (p.cellPkg) a.set(p.cellPkg); p.cellPkg = a; }
          p.cellPkg[slot] = 1;
          rec.claims.push([ps.pool, slot]);
        }
      }
      rec.poolSets = [];
      this._readyAdd(ck, true);
      this.cellVer.set(ck, ++this.readyVer);
      this.S._maskVer = (this.S._maskVer || 0) + 1;   // the near mask is rebuilt with this cell drawn
      if (this.stats.firstReady === null) this.stats.firstReady = performance.now();
      this.stats.lastReady = performance.now();
    }
    this.sweepTree(this.S.scene);   // the live city out of the joined cells, in the same frame
    this._applyHides();
    this._dirtyPools();
    if (window.__ENGINE && window.__ENGINE.invalidateFarShadow) window.__ENGINE.invalidateFarShadow();   // the far cascade is cached
    this.stats.joinMs = (this.stats.joinMs || 0) + performance.now() - tJ;
    this.stats.decodeMs = MAIN.decodeMs;
  }
  tick() {
    if (this.finishing.length) for (const ck of this.finishing.splice(0)) this._finish(ck);
    if (this.joinWait && this.joinWait.length) { this.joining.push(...this.joinWait); this.joinWait = []; }
    if (this.joining.length) this._join();
    if (++this._frame % 20) return;
    this.sweepTree(this.S.scene);
    if (this.pending.length && this._frame % 60 === 0) {
      this._registerAll();
      this.pending = this.pending.filter((p) => {
        if (!p.mesh.parent) {   // its cell left: it no longer holds its key's live meshes
          if (p.hidden) { const b = baseKey(p.key), n = (this.keepLive.get(b) || 1) - 1; if (n > 0) this.keepLive.set(b, n); else this.keepLive.delete(b); }
          return false;
        }
        const r = this._resolve(p.key, p.desc, p.names);
        if (r.m && r.exact) {
          p.mesh.material = r.m; this.stats.resolvedLate = (this.stats.resolvedLate || 0) + 1;
          if (p.hidden) {
            p.mesh.visible = !p.mesh.userData.nightOnly || !!this._night; p.hidden = false;
            const b = baseKey(p.key), n = (this.keepLive.get(b) || 1) - 1;
            if (n > 0) this.keepLive.set(b, n); else { this.keepLive.delete(b); this.readyVer++; }   // the live meshes of that key go
          }
        }
        return !r.exact && ++p.tries < 40;
      });
    }
    const night = ENV && ENV.night ? ENV.night.value > 0.5 : false;
    if (night !== this._night) { this._night = night; this.group.traverse((o) => { if (o.userData.nightOnly) o.visible = night; }); }
  }
  // ---- the packages
  // phase 1: fetch and decode (geometries, instance data), as soon as the cell is wanted or prefetched
  async _load(ck, want = true) {
    let rec = this.cells.get(ck);
    if (rec) { if (want) this._want(ck); return; }
    rec = { state: 'loading', want, group: new THREE.Group(), claims: [], poolSets: [], items: [], buildings: [] };
    rec.group.name = 'cell_' + ck;
    this.cells.set(ck, rec);
    this.stats.inflight++;
    const t0 = performance.now();
    if (this.stats.firstFetch === null) this.stats.firstFetch = t0;
    try {
      const c = this.index.cells[ck];
      const [gb, sc] = await Promise.all([fetch(`${BASE}/${c.hash}/cell.glb`).then((r) => r.arrayBuffer()), fetch(`${BASE}/${c.hash}/cell.json`).then((r) => r.json())]);
      if (this.cells.get(ck) !== rec) return;
      this.stats.bytes += gb.byteLength;
      const tb = performance.now();
      await this._decode(ck, rec, gb, sc);
      this.stats.buildMs += performance.now() - tb;
      rec.state = 'fetched';
      this.stats.loadMs += performance.now() - t0;
      if (rec.want) this.finishing.push(ck);
    } catch (e) { console.warn('[cells] load', ck, e); rec.state = 'failed'; }
    finally { this.stats.inflight--; }
  }
  // finished in the next tick, not here: the streamer calls onTile before the tile joins the scene and before its data is
  // stored, and the live materials are looked up in the scene
  _want(ck) { const rec = this.cells.get(ck); if (!rec) return; rec.want = true; if (rec.state === 'fetched') this.finishing.push(ck); }
  // a primitive's geometry (three.js attribute names)
  async _geometry(accessor, prim) {
    const g = new THREE.BufferGeometry();
    for (const [sem, ai] of Object.entries(prim.attributes)) {
      const a = await accessor(ai);
      g.setAttribute(nameOf(sem), new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    }
    if (prim.indices !== undefined) { const a = await accessor(prim.indices); g.setIndex(new THREE.BufferAttribute(a.array, 1)); }
    return g;
  }
  // a prototype of the shared library (protos/<hash>.glb), fetched once and shared by every cell that draws it
  _proto(ref) {
    if (!this.protos) this.protos = new Map();
    if (!this.protos.has(ref)) {
      this.protos.set(ref, (async () => {
        const buf = await fetch(`${BASE}/${ref}`).then((r) => r.arrayBuffer());
        this.stats.protoBytes = (this.stats.protoBytes || 0) + buf.byteLength;
        const { json, accessor } = await readGLB(buf);
        const node = json.nodes[json.scenes[0].nodes[0]];
        const g = await this._geometry(accessor, json.meshes[node.mesh].primitives[0]);
        g.userData.cellProto = ref;
        return g;
      })());
    }
    return this.protos.get(ref);
  }
  async _decode(ck, rec, gb, sc) {
    const { json, accessor } = await readGLB(gb);
    const root = json.nodes[json.scenes[0].nodes[0]];
    const [ox, oy, oz] = root.translation || [0, 0, 0];
    const mats = json.materials || [];
    const I = this.S.ctx.instancer;
    for (const ni of root.children || []) {
      const node = json.nodes[ni], x = node.extras || {};
      const prim = json.meshes[node.mesh].primitives[0];
      const md = mats[prim.material] || {}, desc = md.extras ? md.extras.three : null;
      const inst = node.extensions && node.extensions.EXT_mesh_gpu_instancing;
      const poolOf = inst && x.pool && I && I.pools ? I.pools.get(x.pool) : null;
      // a pool's instances are drawn with the pool's own prototype (nothing to decode); another instanced set's prototype
      // comes from the shared library; a mesh's geometry from the package
      let g = null;
      if (inst && x.proto && !poolOf) {   // the library's attributes themselves (one GPU copy for every cell); never disposed
        const sh = await this._proto(x.proto);
        g = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(sh.attributes)) g.setAttribute(k, a);
        if (sh.index) g.setIndex(sh.index);
        g.userData.sharedProto = true;
      } else if (!poolOf) g = await this._geometry(accessor, prim);
      if (!inst) {
        const t0 = performance.now();
        { const P = g.attributes.position.array; for (let i = 0; i < P.length; i += 3) { P[i] += ox; P[i + 1] += oy; P[i + 2] += oz; } }   // world space with an identity matrix, as the live city draws it
        g.computeBoundingSphere();
        this.stats.geoMs = (this.stats.geoMs || 0) + performance.now() - t0;
        rec.items.push({ x, desc, g });
        continue;
      }
      const T = (await accessor(inst.attributes.TRANSLATION)).array, R = (await accessor(inst.attributes.ROTATION)).array, S = (await accessor(inst.attributes.SCALE)).array;
      const C = inst.attributes._COLOR !== undefined ? (await accessor(inst.attributes._COLOR)).array : null;
      if (poolOf) { rec.poolSets.push({ pool: x.pool, T, R, S, C, ox, oy, oz }); continue; }   // claimed when the cell joins
      for (const [sem, ai] of Object.entries(inst.attributes)) {
        if (!sem.startsWith('_') || sem === '_COLOR') continue;
        const a = await accessor(ai);
        g.setAttribute(sem.slice(1), new THREE.InstancedBufferAttribute(a.array, a.itemSize));
      }
      rec.items.push({ x, desc, g, inst: { T, R, S, C, ox, oy, oz } });
    }
    rec.buildings = (sc.buildings || []).filter((b) => b.dressed);
  }
  // phase 2, once the cell's tile is in (its materials are live): the meshes with the client's materials, then the join
  _finish(ck) {
    const rec = this.cells.get(ck);
    if (!rec || rec.state !== 'fetched') return;
    const tF = performance.now();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    for (const { x, desc, g, inst } of rec.items) {
      const names = x.name ? [x.name] : (x.sources || []).filter((n) => n && n !== 'Mesh');
      const res = this._material(x.matKey, desc, names), material = res.m;
      let mesh;
      if (!inst) {
        mesh = new THREE.Mesh(g, material);
        mesh.matrixAutoUpdate = false;
        mesh.name = 'cell:' + ck + ':' + (x.matKey || '').split('#')[0];
        if (x.dress) mesh.userData.nycDress = true;
        if (x.nightOnly) { mesh.userData.nightOnly = true; mesh.visible = !!this._night; }
      } else {
        const { T, R, S, C, ox, oy, oz } = inst, n = T.length / 3;
        mesh = new THREE.InstancedMesh(g, material, n);
        for (let k = 0; k < n; k++) {
          v.set(T[k * 3] + ox, T[k * 3 + 1] + oy, T[k * 3 + 2] + oz); q.fromArray(R, k * 4); s.fromArray(S, k * 3);
          mesh.setMatrixAt(k, m4.compose(v, q, s));
        }
        if (C) mesh.instanceColor = new THREE.InstancedBufferAttribute(C, 3);
        mesh.name = 'cell:' + ck + ':' + (x.name || 'instanced');
        mesh.computeBoundingSphere();
      }
      mesh.castShadow = !!x.castShadow; mesh.receiveShadow = !!x.receiveShadow; mesh.renderOrder = x.renderOrder || 0;
      if (x.layers) mesh.layers.mask = x.layers;
      mesh.userData.cellPkg = true; mesh.userData.cls = x.class;
      if (!res.exact) {   // neither a stand-in nor a guess is drawn: the live meshes of that key stay until the key resolves
        mesh.visible = false; { const b = baseKey(x.matKey); this.keepLive.set(b, (this.keepLive.get(b) || 0) + 1); }
        this.pending.push({ mesh, key: x.matKey, desc, names, tries: 0, hidden: true });
      }
      rec.group.add(mesh);
    }
    rec.items = [];
    // the package's own images this cell wears (loading from the cache): it joins once they are in
    rec.waitTex = [];
    rec.group.traverse((o) => { for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) for (const k of OWN_SLOTS) { const t = m && m[k]; if (t && t.userData && t.userData.r1aOwn && !t.userData.r1aDone && !rec.waitTex.includes(t)) rec.waitTex.push(t); } });
    rec.builtAt = performance.now();
    rec.state = 'built';
    this.stats.finishMs = (this.stats.finishMs || 0) + performance.now() - tF;
    this.stats.loaded++;
    this.joining.push(ck);   // joins the scene in tick(), with the sweep that takes the live city out of it (one frame)
  }
  // the package's dressed buildings hide their tile facades (in every loaded tile that holds them)
  _applyHides() {
    for (const rec of this.cells.values()) {
      if (rec.state !== 'ready') continue;
      for (const b of rec.buildings) {
        const t = this.S.tiles.get(b.tile);
        const ht = t && t.data && t.data.hideTex;
        if (!ht || ht.image.data[b.bid] === 255) continue;
        ht.image.data[b.bid] = 255; ht.needsUpdate = true;
      }
    }
  }
  _unload(ck) {
    const rec = this.cells.get(ck);
    if (!rec) return;
    this.cells.delete(ck);
    const I = this.S.ctx.instancer;
    for (const [pool, slot] of rec.claims) { const p = I.pools.get(pool); if (p && p.cellPkg) p.cellPkg[slot] = 0; I.release(pool, slot); }
    this._readyAdd(ck, false); this.readyVer++; this.S._maskVer = (this.S._maskVer || 0) + 1;
    rec.group.traverse((o) => { if (o.geometry && !o.geometry.userData.sharedProto) o.geometry.dispose(); });
    this.group.remove(rec.group);
  }
  ready() {   // the packages of every ready tile are in the scene (or failed)
    if (this.stats.inflight > 0 || this.joining.length || this.finishing.length) return false;
    for (const k of this.baked) {
      const [cx, cz] = k.split('_').map(Number), t = `${Math.floor((cx * CELL) / 512)}_${Math.floor((cz * CELL) / 512)}`, c = this.cells.get(k);
      if (this.S.tiles.get(t)?.state === 'ready' && c && (c.state === 'loading' || c.state === 'fetched' || c.state === 'built')) return false;
    }
    return true;
  }
}
