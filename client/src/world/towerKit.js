// Tower kit runtime (TW, towers lane, docs/notes/r2-towers.md): builds the near level of the towers nearest the camera
// (city/tk/tkBuild.js on the tiers assemble.js extruded), and hides the tile's own walls of each tower it builds through
// the tile's facade mask (slot TW_BID + the building's index: the roofs, terrace parapets, crown and bulkheads stay the
// tile's, drawn by towers.js). Beyond the near radius the tile facade shader draws the same grid, colours and lit rooms.
//
// Budgeted: a few milliseconds of building per frame, nearest first, with hysteresis on the radius. Merged geometry is
// one mesh per material per tower; repeated parts are instanced from shared prototypes, one InstancedMesh per prototype
// and material for the whole kit (rebuilt when the set of built towers changes).
//   ?tw=0 off (the A/B) · ?twr=<m> near radius (1500; 2500 with filmlod=1) · ?twfull=<m> the full level's radius (450;
//   1200 with filmlod=1; beyond it the lite level: walls, reveals, panes, spandrels, mullions, piers, no frames, sills,
//   lintels or transoms) · ?twmax=<n> towers at most (300)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { towerParams, towerRecord, loadTowerRecords, TW_BID } from '../city/tk/tkParams.js';
import { buildTowerKit, tkGlassAttrs } from '../city/tk/tkBuild.js';
import { tkMatsReady, TW_NIGHT } from '../city/tk/tkMats.js';
import { TW_TOWERS } from '../city/tk/tkOverrides.js';
import { project } from '../shared/geo.js';

// the override whose point lies inside a tower's footprint
const TW_PTS = TW_TOWERS.map((t) => { const [x, z] = project(t.lon, t.lat); return { t, x, z }; });
function twOverride(rec) {
  const r = rec.ring;
  for (const p of TW_PTS) {
    if (Math.abs(p.x - rec.cx) > 120 || Math.abs(p.z - rec.cz) > 120) continue;
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i], [xj, zj] = r[j];
      if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) c = !c;
    }
    if (c) return p.t;
  }
  return null;
}

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
export const TW_ON = Q.get('tw') !== '0';
const R_NEAR = +(Q.get('twr') || (Q.get('filmlod') === '1' ? 2500 : 1500));
const R_FULL = +(Q.get('twfull') || (Q.get('filmlod') === '1' ? 1200 : 450));   // within it the full level (frames, sills, transoms)
const MAX_T = +(Q.get('twmax') || 300);
const BUDGET_MS = +(Q.get('twms') || 14);
const TW_NOMERGE = Q.get('twmerge') === '0';   // ?twmerge=0: every tower its own meshes (the A/B of the settled-tile merge)

export class TowerKit {
  constructor(scene) {
    this.scene = scene;
    this.tiles = new Map();      // tile key -> { recs, hideTex }
    this.active = new Map();     // rec key -> { rec, tile, meshes, inst, tris }
    this.queue = [];
    this.pools = new Map();      // prototype|material -> { geo, mat, mesh, cap, shadow }
    this.merged = new Map();     // tile key -> { meshes, hidden } (a settled tile's towers joined per material)
    this.tileT = new Map();      // tile key -> the time its towers last changed
    this.dirty = false;
    this.ready = false;
    this.stats = { built: 0, ms: 0, evicted: 0, fail: 0 };
    this._t = 0; this._cam = new THREE.Vector3();
    Promise.all([loadTowerRecords(), tkMatsReady]).then(() => { this.ready = true; }).catch((e) => console.warn('[tw] not ready', e));
  }
  setTile(key, data) {
    this.tiles.set(key, { recs: (data && data.towers) || [], hideTex: (data && data.hideTex) || null });
    this._t = 0;   // re-rank now
  }
  removeTile(key) {
    for (const [k, a] of [...this.active]) if (a.tile === key) this._evict(k);
    this._unmerge(key); this.tileT.delete(key);
    this.tiles.delete(key);
    this.queue = this.queue.filter((q) => q.rec.tile !== key);
  }
  owns(recKey) { return this.active.has(recKey); }
  // the cell baker (cells/bakeLib.js dressRegion): every tower whose centroid lies in the baked cells, at the full level,
  // whatever its distance, and none dropped while the region holds
  setRegion(fn) {
    this.region = fn;
    this._t = 0;
    // the landmarks' night windows show for the baker (their nodes are exported night-only) and hide again after
    for (const m of TW_NIGHT) { let r = m; while (r.parent) r = r.parent; if (!r.isScene) TW_NIGHT.delete(m); else m.visible = !!fn; }
    if (!fn) return 0;
    let n = 0;
    for (const [tk, t] of this.tiles) for (const rec of t.recs) if (fn(rec.cx, rec.cz, rec)) n++;
    return n;
  }
  idle() { return !TW_ON || (this.ready && this.queue.length === 0 && !this.dirty); }
  // distance from the camera to the tower's cylinder (centroid, radius, base, top)
  _dist(rec, cam) {
    if (rec.__r === undefined) {
      let r = 0;
      for (const [x, z] of rec.ring) r = Math.max(r, Math.hypot(x - rec.cx, z - rec.cz));
      rec.__r = r;
    }
    const dh = Math.max(0, Math.hypot(cam.x - rec.cx, cam.z - rec.cz) - rec.__r);
    const top = rec.baseY + rec.height;
    const dy = cam.y > top ? cam.y - top : cam.y < rec.baseY ? rec.baseY - cam.y : 0;
    return Math.hypot(dh, dy);
  }
  update(camera) {
    if (!TW_ON || !this.ready || !camera) return;
    const cam = camera.position;
    const now = performance.now();
    if (now - this._t > 250 || this._cam.distanceToSquared(cam) > 400) {
      this._t = now; this._cam.copy(cam);
      const cand = [];
      for (const [tk, t] of this.tiles) for (const rec of t.recs) {
        const d = this._dist(rec, cam);
        if (this.region ? this.region(rec.cx, rec.cz, rec) : d < R_NEAR * 1.15) cand.push({ rec, d, tile: tk });
      }
      cand.sort((a, b) => a.d - b.d);
      const want = new Set();
      for (const c of cand) { if (this.region || (c.d < R_NEAR && want.size < MAX_T)) want.add(c.rec.key); }
      // evict what fell out (beyond the hysteresis band, or past the count with margin); a tower that crossed the full
      // radius (with hysteresis) is rebuilt at its new level
      const relevel = [];
      for (const [k, a] of [...this.active]) {
        const d = this._dist(a.rec, cam);
        if (!this.region && (d > R_NEAR * 1.15 || (!want.has(k) && this.active.size > MAX_T * 1.1))) { this._evict(k); continue; }
        const lite = this.region ? false : a.lite ? d > R_FULL : d > R_FULL * 1.15;
        // (a tower built before the baker's hold is rebuilt under it too: the hold adds the packages' night windows)
        if ((lite !== a.lite || !!this.region !== !!a.nq) && !a.failed) relevel.push({ rec: a.rec, d, tile: a.tile, relevel: true });
      }
      this.queue = relevel.concat(cand.filter((c) => want.has(c.rec.key) && !this.active.has(c.rec.key)));
    }
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < BUDGET_MS) {
      const q = this.queue.shift();
      if ((this.active.has(q.rec.key) && !q.relevel) || !this.tiles.has(q.tile)) continue;
      this._build(q.rec, q.tile, !this.region && q.d > R_FULL);
    }
    if (this.dirty && (this.queue.length === 0 || performance.now() - t0 < BUDGET_MS)) this._flushPools();
    // a settled tile's towers joined into one mesh per material and attribute set (the draw calls), one tile a frame, only
    // while nothing is building (the region a baker holds keeps its meshes as they are)
    if (!this.region && this.queue.length === 0 && !this.dirty && !TW_NOMERGE) {
      const now2 = performance.now();
      for (const [tk, t] of this.tileT) {
        if (now2 - t < 1500 || this.merged.has(tk)) continue;
        this._merge(tk);
        break;
      }
    }
  }
  _merge(tk) {
    this.tileT.delete(tk);
    const groups = new Map();
    const [tx, tz] = tk.split('_').map(Number), ox = tx * 512, oz = tz * 512;
    for (const a of this.active.values()) {
      if (a.tile !== tk) continue;
      for (const m of a.meshes) {
        const g = m.geometry;
        const sig = m.material.uuid + '|' + Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize).join(',');
        let G = groups.get(sig);
        if (!G) groups.set(sig, (G = { mat: m.material, ms: [] }));
        G.ms.push(m);
      }
    }
    const meshes = [], hidden = [];
    for (const G of groups.values()) {
      if (G.ms.length < 2) continue;
      const parts = G.ms.map((m) => m.geometry.clone().translate(m.position.x - ox, 0, m.position.z - oz));
      let g = null;
      try { g = mergeGeometries(parts, false); } catch (e) { g = null; }
      for (const p of parts) p.dispose();
      if (!g) continue;
      g.computeBoundingSphere();
      const mm = new THREE.Mesh(g, G.mat);
      mm.position.set(ox, 0, oz);
      mm.updateMatrix(); mm.matrixAutoUpdate = false;
      mm.castShadow = true; mm.receiveShadow = true;
      mm.layers.enable(3);
      mm.userData.tw = 'merge:' + tk;
      this.scene.add(mm);
      meshes.push(mm);
      for (const m of G.ms) { this.scene.remove(m); hidden.push(m); }
    }
    this.merged.set(tk, { meshes, hidden });
  }
  // a merged tile back to its towers' own meshes (a tower of it is built, rebuilt or dropped)
  _unmerge(tk) {
    this.tileT.set(tk, performance.now());
    const M = this.merged.get(tk);
    if (!M) return;
    for (const mm of M.meshes) { this.scene.remove(mm); mm.geometry.dispose(); }
    for (const m of M.hidden) if (m.userData.tw && !m.userData.twGone) this.scene.add(m);
    this.merged.delete(tk);
  }
  _build(rec, tileKey, lite = false) {
    const t0 = performance.now();
    const tile = this.tiles.get(tileKey);
    this._unmerge(tileKey);
    const old = this.active.get(rec.key);   // a level change: the new level is built before the old one goes
    let out;
    try {
      const lr = towerRecord(rec.tile, rec.bid, rec.cx, rec.cz);
      const P = towerParams(rec, lr);
      const ov = twOverride(rec);   // the facts the records lack (city/tk/tkOverrides.js)
      if (ov && ov.P) Object.assign(P, ov.P);
      P.lite = lite;
      P.fac = true;   // the generic towers: the facade shader's walls and panes (the landmarks keep the kit's own)
      P.nightQuads = !!this.region;   // the packages' night windows, while the cell baker holds a region
      rec.__tw = P;
      out = buildTowerKit(rec, P);
    } catch (e) {
      this.stats.fail++;
      if (this.stats.fail < 4) console.warn('[tw] build failed', rec.key, e);
      this.active.set(rec.key, { rec, tile: tileKey, meshes: [], inst: new Map(), tris: 0, failed: true });
      return;
    }
    const meshes = [];
    let tris = 0;
    for (const { mat, S } of out.sinks.values()) {
      const g = S.build();
      if (!g) continue;
      const gl = out.glass && out.glass.get(mat);
      if (gl) tkGlassAttrs(g, gl);
      const m = new THREE.Mesh(g, mat);
      m.position.set(out.org[0], 0, out.org[1]);
      m.updateMatrix(); m.matrixAutoUpdate = false;
      m.castShadow = true; m.receiveShadow = true;
      m.layers.enable(3);
      m.userData.tw = rec.key;
      this.scene.add(m);
      meshes.push(m);
      tris += g.index ? g.index.count / 3 : 0;
    }
    for (const [mat, FS] of out.fac) {
      const g = FS.build();
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.position.set(out.org[0], 0, out.org[1]);
      m.updateMatrix(); m.matrixAutoUpdate = false;
      m.castShadow = true; m.receiveShadow = true;
      m.layers.enable(3);
      m.userData.tw = rec.key;
      this.scene.add(m);
      meshes.push(m);
      tris += g.index.count / 3;
    }
    for (const e of out.inst.values()) tris += (e.M.length / 16) * ((e.geo.index ? e.geo.index.count : 0) / 3);
    if (old) { for (const m of old.meshes) { this.scene.remove(m); m.geometry.dispose(); m.userData.twGone = true; } this.active.delete(rec.key); }
    this.active.set(rec.key, { rec, tile: tileKey, meshes, inst: out.inst, tris, lite, nq: !!this.region });
    if (out.inst.size) this.dirty = true;
    if (tile && tile.hideTex) { tile.hideTex.image.data[TW_BID + rec.bid] = 255; tile.hideTex.needsUpdate = true; }
    this.stats.built++; this.stats.ms += performance.now() - t0;
  }
  _evict(key) {
    const a = this.active.get(key);
    if (!a) return;
    this._unmerge(a.tile);
    for (const m of a.meshes) { this.scene.remove(m); m.geometry.dispose(); m.userData.twGone = true; }
    if (a.inst.size) this.dirty = true;
    const tile = this.tiles.get(a.tile);
    if (tile && tile.hideTex) { tile.hideTex.image.data[TW_BID + a.rec.bid] = 0; tile.hideTex.needsUpdate = true; }
    this.active.delete(key);
    this.stats.evicted++;
  }
  // every pool from the built towers' instances (a few hundred thousand matrices: a few milliseconds)
  _flushPools() {
    this.dirty = false;
    const tot = new Map();
    for (const a of this.active.values()) for (const [k, e] of a.inst) {
      let t = tot.get(k);
      if (!t) tot.set(k, (t = { geo: e.geo, mat: e.mat, shadow: e.shadow, parts: [] }));
      t.parts.push(e.M);
    }
    for (const [k, p] of this.pools) if (!tot.has(k)) { p.mesh.count = 0; p.mesh.visible = false; }
    for (const [k, t] of tot) {
      let n = 0;
      for (const M of t.parts) n += M.length / 16;
      let p = this.pools.get(k);
      if (!p || p.cap < n) {
        if (p) { this.scene.remove(p.mesh); p.mesh.dispose(); }
        const cap = Math.max(64, 1 << Math.ceil(Math.log2(n * 1.25 + 1)));
        const mesh = new THREE.InstancedMesh(t.geo, t.mat, cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = !!t.shadow; mesh.receiveShadow = true;
        mesh.layers.enable(3);
        mesh.name = 'tw:' + k.split('|')[0];
        mesh.userData.tw = 'pool';
        this.scene.add(mesh);
        p = { geo: t.geo, mat: t.mat, mesh, cap };
        this.pools.set(k, p);
      }
      const arr = p.mesh.instanceMatrix.array;
      let o = 0;
      for (const M of t.parts) { arr.set(M, o); o += M.length; }
      p.mesh.count = n;
      p.mesh.visible = n > 0;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.instanceMatrix.clearUpdateRanges?.();
    }
  }
  report() {
    let tris = 0, inst = 0;
    for (const a of this.active.values()) tris += a.tris;
    for (const p of this.pools.values()) inst += p.mesh.count;
    return { on: TW_ON, ready: this.ready, active: this.active.size, queued: this.queue.length, built: this.stats.built, fail: this.stats.fail,
      msPerBuild: this.stats.built ? +(this.stats.ms / this.stats.built).toFixed(1) : 0, tris: Math.round(tris), instances: inst, pools: this.pools.size,
      meshes: [...this.active.values()].reduce((s, a) => s + a.meshes.length, 0),
      drawn: [...this.active.values()].reduce((s, a) => s + a.meshes.filter((m) => m.parent).length, 0) + [...this.merged.values()].reduce((s, M) => s + M.meshes.length, 0),
      merged: this.merged.size };
  }
}
