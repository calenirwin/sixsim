// The three.js side of the streaming manager for ?lod16=1 (docs/notes/tile-system.md sections 4 to 7; docs/notes/arch-r1-b.md).
//
// WHAT to load and draw is decided by the renderer-agnostic manager in core/streaming/stream.mjs (the same module the
// load-set writer for Unreal and Blender takes runs, docs/specs/load-set.md): the persistent tier (every L6 chunk, with
// the coarse ground) and the landmarks always in; a chunk replaced by its children only when its screen-space error is
// over the tier's threshold and all of them are resident; dithered cross-fades; budgets. This file executes it: fetches
// and attaches the chunks the core requests (one upload a frame), applies each chunk's fade state to its material,
// disposes what the core evicts, and handles the environment (no far boxes, no fog crutch, the haze to 60 km).
// Near tiles drawn by the streamer hide this tier per fragment (NM24 mask, with lane A's baked cells).
//
// URL: ?lod16=1 [&lodtier=low|medium|high|cinematic] [&lodsse=<px>] [&lodmax=3|4|5|6 (finest level)] [&lodfade=<s>]
//      [&lodfog=1 keeps the old fog] [&lodlm=0 no landmarks] [&lod16dir=<dir under public> (default data/lod16)]
//      [&lodbd=0 no backdrop]; ?tier=<name> sets them from client/public/data/tiers.json
// BD40 (backdrop lane): a chunk's index entry may carry `bd` (tools/lod/build_backdrop.mjs: the backdrop's buildings and
// textured ground outside the city, in a file of its own); the finest level defaults to the index's finest (L3 with the
// backdrop); the backdrop's meshes fade with their chunk and are never hidden by the near mask.
import * as THREE from 'three';
import { parseTile } from '../world/tiledata.js';
import { ENV } from '../world/materials.js';
import { makeShellMaterial } from './shellMaterial.js';
import { loadLandmarks } from './landmarks.js';
import { makeGroundMaterial, jpegTexture } from './groundMaterial.js';   // BD40
import { StreamManager, normalizeLod, tierParams, DEFAULT_TIERS, FADE_S as CORE_FADE_S } from '../../../core/streaming/stream.mjs';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const TIERS = DEFAULT_TIERS;
const FADE_S = Math.max(0.05, Number(Q.get('lodfade')) || CORE_FADE_S);
const FETCH_CONC = 4;

export class LodManager {
  constructor(scene, ctx, streamer) {
    this.scene = scene;
    this.ctx = ctx;
    this.streamer = streamer;
    this.group = new THREE.Group();
    this.group.name = 'lod16';
    scene.add(this.group);
    const tn = (Q.get('lodtier') || 'low').toLowerCase();
    this.tierName = DEFAULT_TIERS[tn] ? tn : 'low';
    // a preset from client/public/data/tiers.json (?tier=, lod/tiers.js) sets the threshold and the budgets
    const T = typeof window !== 'undefined' ? window.__TIER : null;
    this.tier = tierParams(T && T.name === this.tierName ? T : null, this.tierName);
    if (Number(Q.get('lodsse')) > 0) this.tier.sse = Number(Q.get('lodsse'));
    this.finest = Math.max(3, Math.min(6, Number(Q.get('lodmax')) || 4));   // (BD40: set again from the index in init)
    this.nodes = new Map();      // chunk key 'L<n>_<i>_<j>' -> { key, lv, info, state, mesh, ground, bytes, decoded }
    this.fetching = 0;
    this.queue = [];             // nodes waiting for a fetch slot
    this.ready = [];             // decoded nodes waiting to be attached (one per frame: no upload spikes)
    this.landmarks = [];
    this.lmReady = false;
    this.stats = { tris: 0, calls: 0, bytes: 0, resident: { 6: 0, 5: 0, 4: 0, 3: 0 }, drawn: { 6: 0, 5: 0, 4: 0, 3: 0 }, fading: 0, landmarks: 0, lmTris: 0, bdTris: 0 };
    this._t = performance.now();
    this._envDone = false;
    if (typeof window !== 'undefined') window.__LOD16 = this;
  }
  // the threshold in pixels (the forced-transition takes set it)
  get sse() { return this.core ? this.core.sse : this.tier.sse; }
  set sse(v) { this.tier.sse = v; if (this.core) this.core.sse = v; }

  async init(base = 'data/lod16') {
    base = Q.get('lod16dir') || base;   // BD40: a staged set under client/public
    this.base = base;
    this.index = await (await fetch(`${base}/index.json`)).json();
    const lod = normalizeLod(this.index);
    // ==== BD40: the finest level the index holds (L3 with the backdrop) unless ?lodmax= says otherwise
    {
      const lvs = lod.chunks.map((c) => c.level);
      const minLv = lvs.length ? Math.min(...lvs) : 4;
      this.finest = Math.max(3, Math.min(6, Number(Q.get('lodmax')) || minLv));
      this.bdOn = Q.get('lodbd') !== '0';
    }
    // ==== end BD40
    for (const c of lod.chunks) this.nodes.set(c.key, { key: c.key, lv: c.level, info: c.src, state: 'none', mesh: null, ground: null, bdMesh: null, bdGround: null, bytes: 0, decoded: null, bdDecoded: null });
    this.core = new StreamManager({ lod, tier: this.tier, finest: this.finest, fadeS: FADE_S });
    this.roots = this.core.persistentKeys().map((k) => this.nodes.get(k));
    if (Q.get('lodlm') !== '0') {
      // (BD40: the backdrop's towers, a registry of their own beside the city's)
      const bdl = this.bdOn && this.index.backdrop && this.index.backdrop.landmarks ? `${base}/${this.index.backdrop.landmarks}` : null;
      Promise.all([loadLandmarks(this.group), bdl ? loadLandmarks(this.group, bdl, { nearMask: false }) : Promise.resolve([])])
        .then(([lm, bd]) => { this.landmarks = lm.concat(bd); this.lmReady = true; }).catch((e) => { console.warn('[lod16] landmarks', e); this.lmReady = true; });
    } else this.lmReady = true;
    console.log(`[lod16] ${this.nodes.size} chunks (L6 ${this.roots.length}), tier ${this.tierName} ${this.sse} px, finest L${this.finest} (core/streaming)`);
    return this;
  }

  // ---------------------------------------------------------------- environment: no far boxes, no fog crutch
  _env(engine) {
    if (!engine) return;
    const cam = engine.camera;
    if (cam.far < 60000) { cam.far = 60000; cam.updateProjectionMatrix(); }
    if (Q.get('lodfog') !== '1') {
      if (engine.scene.fog) engine.scene.fog.density = 0;
      ENV.fogDensity.value = 0;
    }
    if (this._envDone) return;
    this._envDone = true;
    // the haze pass integrates its optical depth to 14 km; the atmosphere now reaches the horizon (60 km)
    try {
      const hm = engine.haze && engine.haze._quad && engine.haze._quad.material;
      if (hm && hm.fragmentShader.includes('14000.0')) { hm.fragmentShader = hm.fragmentShader.replace('14000.0', '60000.0'); hm.needsUpdate = true; }
    } catch (e) { console.warn('[lod16] haze range', e); }
    // the 46 km water plane ends inside the new far plane: widen it
    engine.scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width === 46000) o.scale.set(5, 1, 5); });
  }

  // ---------------------------------------------------------------- per frame
  update() {
    const engine = typeof window !== 'undefined' ? window.__ENGINE : null;
    if (!engine || !this.core) return;
    this._env(engine);
    // fades run on the simulation's clock (sky.js advances ENV.time by the frame's dt), so a recorded take fades over
    // the same frames however long each frame takes to capture; on still frames (dt 0) the wall clock finishes them
    // (a frame can call this more than once; only a pause of over 2 s of wall time counts as stills)
    const now = performance.now();
    const wdt = Math.min(0.1, (now - this._t) / 1000);
    this._t = now;
    const simT = ENV.time.value, sdt = simT - (this._simT ?? simT);
    this._simT = simT;
    if (sdt > 1e-5) this._simWall = now;
    const dt = sdt > 1e-5 ? Math.min(0.1, sdt) : (now - (this._simWall ?? 0) > 2000 ? wdt : 0);
    const cam = engine.camera;
    const cp = cam.getWorldPosition(this._cp || (this._cp = new THREE.Vector3()));
    const hPx = engine.renderer.domElement.height || 1080;
    // attach at most one decoded chunk per frame (its first draw uploads it)
    if (this.ready.length) this._attach(this.ready.shift());
    // ---- the core decides: the load set (chunk fade states), what to request, what to evict
    const out = this.core.update({
      cameras: [{ x: cp.x, y: cp.y, z: cp.z, fovV: cam.fov, heightPx: hPx }], dt,
      resident: (k) => this.nodes.get(k).state === 'ready', bytesOf: (k) => this.nodes.get(k).bytes,
    });
    for (const k of out.evict) this._dispose(this.nodes.get(k));
    for (const k of out.requests) this._request(this.nodes.get(k));
    // ---- apply the fade states
    const shown = new Map(out.chunks.map(([k, a, m]) => [k, [a, m]]));
    for (const n of this.nodes.values()) {
      const s = shown.get(n.key);
      for (const mm of [n.mesh, n.bdMesh, n.bdGround]) {   // (BD40: the backdrop's meshes fade with their chunk)
        if (!mm) continue;
        mm.visible = !!s && s[0] > 0;
        if (s) { const U = mm.material.userData.lod; U.uFade.value = s[0]; U.uFadeMode.value = s[1]; }
      }
    }
    this.stats.fading = out.fading;
    this._pump(cp);
    this._stats(cam);
  }

  _request(n) {
    if (!n || n.state !== 'none') return;
    n.state = 'queued';
    this.queue.push(n);
  }
  _pump(cp) {
    if (!this.queue.length || this.fetching >= FETCH_CONC) return;
    // persistent first, then nearest (the core's request order; the queue keeps it across frames)
    const box = (n) => this.core.nodes.get(n.key).box;
    const d = (n) => { const b = box(n); return Math.hypot(Math.max(b[0] - cp.x, 0, cp.x - b[3]), Math.max(b[1] - cp.y, 0, cp.y - b[4]), Math.max(b[2] - cp.z, 0, cp.z - b[5])); };
    this.queue.sort((a, b) => (+(b.lv === 6) - +(a.lv === 6)) || (d(a) - d(b)));
    while (this.queue.length && this.fetching < FETCH_CONC) this._fetch(this.queue.shift());
  }
  async _fetch(n) {
    this.fetching++;
    n.state = 'loading';
    try {
      const jobs = [];
      if (n.info.f) jobs.push(fetch(`${this.base}/${n.info.f}`).then((r) => r.arrayBuffer()).then((buf) => { n.decoded = parseTile(buf); }));
      // ==== BD40: the backdrop's file (buildings, ground, its textures decoded off the main thread)
      if (n.info.bd && this.bdOn) {
        jobs.push(fetch(`${this.base}/${n.info.bd.f}`).then((r) => r.arrayBuffer()).then(async (buf) => {
          const t = parseTile(buf);
          if (t.S.ttex && t.S.ttex.length) { t.tex = await jpegTexture(t.S.ttex, true); t.nit = t.S.tnit && t.S.tnit.length ? await jpegTexture(t.S.tnit, false) : null; }
          n.bdDecoded = t;
        }));
      }
      // ==== end BD40
      await Promise.all(jobs);
      this.ready.push(n);
    } catch (e) { console.warn('[lod16] chunk', n.key, e); n.state = 'none'; }
    this.fetching--;
  }
  _attach(n) {
    const t = n.decoded, bt = n.bdDecoded;
    n.decoded = null; n.bdDecoded = null;
    if (!t && !bt) { n.state = 'none'; return; }
    let bytes = 0;
    if (bt) bytes += this._attachBd(n, bt);   // BD40
    if (!t) { n.bytes = bytes; n.state = 'ready'; return; }
    const S = t.S, h = t.header, sc = h.scale || 0.25;
    if (S.idx && S.idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(S.pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(S.col, 4, true));
      g.setAttribute('uv', new THREE.BufferAttribute(S.uv, 2));
      if (S.ao && S.ao.length * 3 === S.pos.length) g.setAttribute('ao', new THREE.BufferAttribute(S.ao, 1, true));   // BD40: open-sky share
      g.setIndex(new THREE.BufferAttribute(S.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, makeShellMaterial());
      m.position.set(h.origin[0], 0, h.origin[1]);
      m.scale.setScalar(sc);
      m.name = `lod16_${n.key}`;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.visible = false;
      m.castShadow = false; m.receiveShadow = false;
      this.group.add(m);
      n.mesh = m;
      bytes += S.pos.byteLength + S.col.byteLength + S.uv.byteLength + S.idx.byteLength;
    }
    if (S.gpos && S.gidx && S.gidx.length) {   // the persistent ground (L6): world-space floats, the ground material's far terrain (matId 8)
      const nv = S.gpos.length / 3, p = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) { p[i * 3] = S.gpos[i * 3] * sc + h.origin[0]; p[i * 3 + 1] = S.gpos[i * 3 + 1] * sc; p[i * 3 + 2] = S.gpos[i * 3 + 2] * sc + h.origin[1]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('matId', new THREE.BufferAttribute(new Float32Array(nv).fill(8), 1));
      g.setIndex(new THREE.BufferAttribute(S.gidx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const gm = new THREE.Mesh(g, this.ctx.groundMat);
      gm.name = `lod16_ground_${n.key}`;
      gm.receiveShadow = true;
      this.group.add(gm);
      n.ground = gm;
      bytes += p.byteLength * 2 + nv * 4 + S.gidx.byteLength;
    }
    n.bytes = bytes;
    n.state = 'ready';
  }
  // ==== BD40: the backdrop's part of a chunk: its buildings (the shell material without the near mask) and its textured ground
  _attachBd(n, t) {
    const S = t.S, h = t.header, sc = h.scale || 0.25;
    let bytes = 0;
    if (S.idx && S.idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(S.pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(S.col, 4, true));
      g.setAttribute('uv', new THREE.BufferAttribute(S.uv, 2));
      if (S.ao && S.ao.length * 3 === S.pos.length) g.setAttribute('ao', new THREE.BufferAttribute(S.ao, 1, true));   // BD40: open-sky share
      g.setIndex(new THREE.BufferAttribute(S.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, makeShellMaterial({ nearMask: false }));
      m.position.set(h.origin[0], 0, h.origin[1]);
      m.scale.setScalar(sc);
      m.name = `lod16bd_${n.key}`;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.visible = false; m.castShadow = false; m.receiveShadow = false;
      this.group.add(m);
      n.bdMesh = m;
      bytes += S.pos.byteLength + S.col.byteLength + S.uv.byteLength + S.idx.byteLength;
    }
    if (S.tidx && S.tidx.length && t.tex) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(S.tpos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(S.tuv, 2));
      const nv = S.tpos.length / 3, nb = new Int8Array(nv * 3);
      if (S.tnrm) for (let i = 0; i < nv * 3; i++) nb[i] = S.tnrm[i] - 128; else for (let i = 0; i < nv; i++) nb[i * 3 + 1] = 127;
      g.setAttribute('normal', new THREE.BufferAttribute(nb, 3, true));
      g.setAttribute('shade', new THREE.BufferAttribute(S.tsh || new Uint8Array(nv).fill(255), 1, true));
      g.setIndex(new THREE.BufferAttribute(S.tidx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, makeGroundMaterial(t.tex, t.nit || t.tex));
      m.position.set(h.origin[0], 0, h.origin[1]);
      m.scale.setScalar(sc);
      m.name = `lod16bdg_${n.key}`;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.visible = false; m.castShadow = false; m.receiveShadow = false;
      m.userData.tex = [t.tex, t.nit];
      this.group.add(m);
      n.bdGround = m;
      const tb = (tx) => (tx && tx.image ? tx.image.width * tx.image.height * 4 * 1.34 : 0);
      bytes += S.tpos.byteLength + S.tuv.byteLength + nb.byteLength + S.tidx.byteLength + tb(t.tex) + tb(t.nit);
    }
    return bytes;
  }
  // ==== end BD40
  _dispose(n) {
    if (!n) return;
    if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); n.mesh = null; }
    if (n.ground) { this.group.remove(n.ground); n.ground.geometry.dispose(); n.ground = null; }
    // (BD40)
    if (n.bdMesh) { this.group.remove(n.bdMesh); n.bdMesh.geometry.dispose(); n.bdMesh.material.dispose(); n.bdMesh = null; }
    if (n.bdGround) {
      this.group.remove(n.bdGround); n.bdGround.geometry.dispose(); n.bdGround.material.dispose();
      for (const tx of n.bdGround.userData.tex || []) if (tx) { tx.dispose(); if (tx.image && tx.image.close) tx.image.close(); }
      n.bdGround = null;
    }
    n.state = 'none'; n.bytes = 0;
  }
  // tris / calls: every mesh of this tier that is switched on; inView: those whose bounds meet the camera's frustum (what
  // three.js actually submits); bytes: geometry buffers resident (the persistent tier included)
  _stats(cam) {
    const s = this.stats;
    s.tris = 0; s.calls = 0; s.bytes = 0; s.trisInView = 0; s.callsInView = 0;
    const fr = this._fr || (this._fr = new THREE.Frustum()), m4 = this._m4 || (this._m4 = new THREE.Matrix4()), sp = this._sp || (this._sp = new THREE.Sphere());
    if (cam) { cam.updateMatrixWorld(); m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(m4); }
    const count = (mesh, t) => {
      s.tris += t; s.calls++;
      if (!cam || !mesh.geometry.boundingSphere) return;
      sp.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (fr.intersectsSphere(sp)) { s.trisInView += t; s.callsInView++; }
    };
    for (const k of [6, 5, 4, 3]) { s.resident[k] = 0; s.drawn[k] = 0; }
    s.bdTris = 0;
    for (const n of this.nodes.values()) {
      if (n.state !== 'ready') continue;
      s.resident[n.lv]++; s.bytes += n.bytes;
      const vis = (n.mesh && n.mesh.visible) || (n.bdMesh && n.bdMesh.visible) || (n.bdGround && n.bdGround.visible);
      if (vis) s.drawn[n.lv]++;
      if (n.mesh && n.mesh.visible) count(n.mesh, n.mesh.geometry.index.count / 3);
      if (n.ground) count(n.ground, n.ground.geometry.index.count / 3);
      for (const mm of [n.bdMesh, n.bdGround]) if (mm && mm.visible) { const tr = mm.geometry.index.count / 3; count(mm, tr); s.bdTris += tr; }   // (BD40)
    }
    s.landmarks = 0; s.lmTris = 0;
    for (const l of this.landmarks) { if (l.mesh) { s.landmarks++; s.lmTris += l.tris; s.bytes += l.bytes; count(l.mesh, l.tris); } }
  }
  // persistent tier + landmarks in, nothing fetching, nothing fading, the wanted set resident
  idle() {
    if (!this.core || !this.lmReady) return false;
    for (const r of this.roots) if (r.state !== 'ready') return false;
    if (this.fetching || this.queue.length || this.ready.length) return false;
    return this.core.fading === 0;
  }
}
