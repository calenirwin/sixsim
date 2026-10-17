// The streaming manager (docs/notes/tile-system.md section 6; docs/specs/load-set.md): one module, renderer-agnostic, that
// the three.js client (client/src/lod/manager.js), the load-set writer for takes (tools/core/loadsets.mjs) and through
// those files Unreal and Blender all use, so every renderer loads the identical city by construction.
//
// Inputs per tick: the cameras (position, vertical field of view, viewport height in pixels), the tier (screen error in
// pixels, budgets, the loaded grid), the time step, and the renderer's residency (which chunks it holds, their bytes).
// Output: the load set: the L0 cells of the loaded grid around each camera (lane A's index), the chunks at L1 to L6 with
// their fade state, the landmarks (always), the chunks to request, the chunks to evict.
//
// Rules (unchanged from the round-1 three.js manager):
//   * the persistent tier (every chunk of the coarsest level, L6) and every landmark are always in;
//   * from each persistent root down, a chunk is replaced by its children only when its screen-space error (geometric
//     error x pixels per radian / distance from the camera to the chunk's box; the largest over the cameras) is over the
//     tier's threshold, with hysteresis (a refined chunk returns below 0.8 x the threshold), AND every child is resident:
//     never a hole; a chunk still fading finishes before its subtree changes; a refined chunk returns only once its
//     children have settled;
//   * a chunk entering or leaving the drawn set fades over FADE_S on the caller's clock; the incoming side keeps the screen
//     threshold < alpha (mode 0), the outgoing side >= 1 - alpha (mode 1), so the two cover complementary pixels; a chunk
//     that nothing else covers (boot) appears at once;
//   * budgets: resident chunks past the persistent tier beyond the tier's bytes or count are evicted, least recently wanted
//     first, only when invisible and not wanted for 4 s; the persistent tier is never evicted.
// No imports: the module runs in Node (the core, the tools) and in the browser alike.

export const FADE_S = 0.45;
export const HYSTERESIS = 0.8;
export const EVICT_AFTER_S = 4;
// the fallbacks when no preset table is given (client/public/data/tiers.json holds the real ones)
export const DEFAULT_TIERS = {
  low: { sse: 3, maxBytes: 384 << 20, maxNodes: 48, grid: 5 },
  medium: { sse: 2, maxBytes: 640 << 20, maxNodes: 96, grid: 7 },
  high: { sse: 1, maxBytes: 1024 << 20, maxNodes: 160, grid: 9 },
  cinematic: { sse: 1, maxBytes: 2048 << 20, maxNodes: 320, grid: 11, viewFar: 2500 },
};
// a preset of client/public/data/tiers.json (or a DEFAULT_TIERS name) as the manager's parameters
export function tierParams(t, name) {
  const base = DEFAULT_TIERS[name] || DEFAULT_TIERS[(t && t.name) || ''] || DEFAULT_TIERS.low;
  if (!t || typeof t !== 'object') return { name: name || 'low', ...base };
  return {
    name: name || t.name || 'low',
    sse: t.screenErrorPx ?? t.sse ?? base.sse,
    maxBytes: (t.lod && t.lod.maxBytes) ?? t.maxBytes ?? base.maxBytes,
    maxNodes: (t.lod && t.lod.maxNodes) ?? t.maxNodes ?? base.maxNodes,
    grid: (t.loadedGrid && t.loadedGrid.cells) ?? t.grid ?? base.grid,
    viewFar: (t.loadedGrid && t.loadedGrid.viewFar) ?? t.viewFar ?? base.viewFar ?? 0,   // (GB43)
  };
}

// ---------------------------------------------------------------- indexes
// the chunk index of tools/lod/build_persistent.mjs (client/public/data/lod16/index.json: chunks[level][i_j].b =
// [x0, z0, x1, z1, y0, y1]) or of tools/lod/export_packages.mjs (cellcache/lod16/index.json: chunks['L<n>_i_j'].bounds =
// [x0, y0, z0, x1, y1, z1]) as one list: { key 'L<n>_<i>_<j>', level, i, j, box [x0, y0, z0, x1, y1, z1], err, bytes, src }
export function normalizeLod(index) {
  const levels = {}, chunks = [];
  for (const [lv, L] of Object.entries(index.levels || {})) levels[lv] = { size: L.size, err: L.err };
  for (const [a, v] of Object.entries(index.chunks || {})) {
    if (/^L\d+_/.test(a)) {   // packages index
      const m = /^L(\d+)_(-?\d+)_(-?\d+)$/.exec(a);
      if (!m) continue;
      const lv = +m[1];
      chunks.push({ key: a, level: lv, i: +m[2], j: +m[3], box: v.bounds.slice(0, 6), err: levels[lv] ? levels[lv].err : 0, bytes: v.bytes ? v.bytes.glb : 0, src: v });
    } else {                  // client index: a = level
      const lv = +a;
      for (const [ij, c] of Object.entries(v)) {
        const [i, j] = ij.split('_').map(Number);
        chunks.push({ key: `L${lv}_${ij}`, level: lv, i, j, box: [c.b[0], c.b[4], c.b[1], c.b[2], c.b[5], c.b[3]], err: levels[lv] ? levels[lv].err : 0, bytes: c.bytes || 0, src: c });
      }
    }
  }
  return { levels, chunks };
}
// lane A's cell index (cellcache/index.json): the baked L0 cells, key `cx_cz`
export function normalizeCells(index) {
  if (!index || !index.cells) return { size: 128, cells: new Map() };
  return { size: index.cellSize || 128, cells: new Map(Object.entries(index.cells).map(([k, c]) => [k, { key: k, box: c.bounds, bytes: c.bytes ? (c.bytes.glb || 0) + (c.bytes.sidecar || 0) : 0, hash: c.hash }])) };
}
// the landmark registry (client/public/data/landmarks.json) or the packages index's `landmarks`
export function normalizeLandmarks(reg) {
  if (!reg) return [];
  const list = Array.isArray(reg.landmarks) ? reg.landmarks : Object.entries(reg.landmarks || {}).map(([key, v]) => ({ key, ...v }));
  return list.filter((l) => !l.l6 || l.l6.ni || l.l6.tris).map((l) => ({ key: l.key, drawnBy: l.drawnBy || null, box: l.bounds || null, center: l.center || null }));
}

// distance from a point to a box [x0, y0, z0, x1, y1, z1]
export function boxDist(b, p) {
  const dx = Math.max(b[0] - p.x, 0, p.x - b[3]);
  const dy = Math.max(b[1] - p.y, 0, p.y - b[4]);
  const dz = Math.max(b[2] - p.z, 0, p.z - b[5]);
  return Math.hypot(dx, dy, dz);
}
// pixels per radian of a camera: viewport height / (2 tan(vertical fov / 2))
export const pxPerRad = (cam) => (cam.heightPx || 1080) / (2 * Math.tan(((cam.fovV || 60) * Math.PI) / 360));

// ---------------------------------------------------------------- the manager
export class StreamManager {
  // lod: normalizeLod(...); cells: normalizeCells(...) or null; landmarks: normalizeLandmarks(...); tier: tierParams(...)
  // finest: the finest chunk level used (4); persistentLevel: the always-resident level (6)
  constructor({ lod, cells = null, landmarks = [], tier = tierParams(null, 'low'), finest = 4, persistentLevel = 6, fadeS = FADE_S, hysteresis = HYSTERESIS }) {
    this.tier = tier;
    this.sse = tier.sse;
    this.finest = finest;
    this.fadeS = fadeS;
    this.hysteresis = hysteresis;
    this.cells = cells || { size: 128, cells: new Map() };
    this.landmarks = landmarks;
    this.nodes = new Map();
    this.roots = [];
    for (const c of lod.chunks) {
      if (c.level < finest) continue;
      this.nodes.set(c.key, { key: c.key, lv: c.level, i: c.i, j: c.j, box: c.box, err: c.err, bytes: c.bytes, children: [], parent: null,
        persistent: c.level === persistentLevel, resident: false, alpha: 0, target: 0, mode: 0, refined: false, wantAt: -1e9 });
    }
    for (const n of this.nodes.values()) {
      if (n.persistent) this.roots.push(n);
      if (n.lv > finest) {
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const c = this.nodes.get(`L${n.lv - 1}_${n.i * 2 + dx}_${n.j * 2 + dz}`);
          if (c) { n.children.push(c); c.parent = n; }
        }
      }
    }
    this.roots.sort((a, b) => (a.key < b.key ? -1 : 1));
    this.cellKeep = new Set();   // L0 cells in the set (kept until outside the grid + 2)
    this.fading = 0;
    this.t = 0;
  }
  setTier(tier) { this.tier = tier; this.sse = tier.sse; }

  // cameras: [{ x, y, z, fovV, heightPx }]; dt: seconds on the caller's clock; resident(key) -> bool; bytesOf(key) -> bytes
  update({ cameras, dt = 0, resident = () => true, bytesOf = null }) {
    this.t += Math.max(0, dt);
    const now = this.t;
    const cams = cameras.map((c) => ({ ...c, K: pxPerRad(c) }));
    for (const n of this.nodes.values()) {
      const was = n.resident;
      n.resident = !!resident(n.key);
      if (was && !n.resident) { n.alpha = 0; n.target = 0; n.refined = false; }   // dropped by the renderer
    }
    // ---- select
    const draw = new Set(), want = new Set();
    for (const r of this.roots) this._select(r, cams, draw, want, now);
    // ---- fades
    let fading = 0;
    for (const n of this.nodes.values()) {
      if (!n.resident) continue;
      const tgt = draw.has(n) ? 1 : 0;
      if (tgt !== n.target) {
        n.target = tgt;
        if (tgt === 1 && !this._covered(n)) n.alpha = 1;   // nothing else covers this ground (boot): no fade from empty
      }
      if (n.alpha !== n.target) {
        n.alpha = n.target ? Math.min(1, n.alpha + dt / this.fadeS) : Math.max(0, n.alpha - dt / this.fadeS);
        fading++;
      }
      n.mode = n.target ? 0 : 1;
    }
    this.fading = fading;
    // ---- requests (persistent first, then nearest) and evictions (over budget only)
    const requests = [...want].filter((n) => !n.resident)
      .sort((a, b) => (b.persistent - a.persistent) || (this._dist(a, cams) - this._dist(b, cams)) || (a.key < b.key ? -1 : 1)).map((n) => n.key);
    const evict = this._evict(now, bytesOf);
    this.lastDraw = draw;
    return { chunks: this._chunkStates(), requests, evict, cells: this._cells(cams), landmarks: this.landmarks.map((l) => l.key), fading };
  }
  // the chunks drawn or fading, deterministic order: [key, alpha, mode]
  _chunkStates() {
    const out = [];
    for (const n of this.nodes.values()) if (n.resident && (n.alpha > 0 || n.target > 0)) out.push([n.key, n.alpha, n.mode]);
    out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return out;
  }
  state(key) { const n = this.nodes.get(key); return n ? { alpha: n.alpha, target: n.target, mode: n.mode, refined: n.refined } : null; }
  _dist(n, cams) { let d = Infinity; for (const c of cams) d = Math.min(d, boxDist(n.box, c)); return d; }
  _sse(n, cams) { let s = 0; for (const c of cams) s = Math.max(s, (n.err * c.K) / Math.max(1, boxDist(n.box, c))); return s; }
  // is the area of `n` drawn by something else right now (its parent, or any descendant)?
  _covered(n) {
    if (n.parent && n.parent.resident && n.parent.alpha > 0) return true;
    return this._coveredDown(n);
  }
  _coveredDown(n) { for (const c of n.children) if (c.resident && (c.alpha > 0 || this._coveredDown(c))) return true; return false; }
  _select(n, cams, draw, want, now) {
    n.wantAt = now;
    if (!n.resident) { want.add(n); return; }
    const kids = n.children;
    if (!kids.length) { draw.add(n); return; }
    const sse = this._sse(n, cams);
    const wantRefine = n.refined ? sse > this.sse * this.hysteresis : sse > this.sse;
    if (wantRefine) {
      let all = true;
      for (const c of kids) { c.wantAt = now; if (!c.resident) { all = false; want.add(c); } }
      // a node still fading (in or out) finishes before its subtree changes again
      const settled = n.alpha === n.target;
      if (all && (n.refined || settled)) { n.refined = true; for (const c of kids) this._select(c, cams, draw, want, now); return; }
    }
    if (n.refined) {
      // un-refine only once every child has settled, so a fade is never reversed half-way
      let busy = false;
      for (const c of kids) if (c.alpha !== c.target) busy = true;
      if (busy) { for (const c of kids) this._select(c, cams, draw, want, now); return; }
    }
    n.refined = false;
    draw.add(n);
  }
  _evict(now, bytesOf) {
    let bytes = 0, count = 0;
    const cand = [];
    for (const n of this.nodes.values()) {
      if (n.persistent || !n.resident) continue;
      const b = bytesOf ? bytesOf(n.key) : n.bytes;
      bytes += b; count++;
      if (n.alpha === 0 && n.target === 0 && now - n.wantAt > EVICT_AFTER_S) cand.push([n, b]);
    }
    const out = [];
    if (bytes <= this.tier.maxBytes && count <= this.tier.maxNodes) return out;
    cand.sort((a, b) => a[0].wantAt - b[0].wantAt || (a[0].key < b[0].key ? -1 : 1));
    for (const [n, b] of cand) {
      if (bytes <= this.tier.maxBytes && count <= this.tier.maxNodes) break;
      out.push(n.key);
      n.alpha = 0; n.target = 0; n.refined = false;
      bytes -= b; count--;
    }
    return out;
  }
  // the L0 cells: the tier's grid (N x N cells of the cell index's size) round each camera's cell, kept until outside
  // N + 2; split into the baked ones (in lane A's index) and the missing ones (not baked: the chunks cover them)
  _cells(cams) {
    const S = this.cells.size, N = this.tier.grid || 0, h = Math.floor(N / 2), H = h + 1;
    const inGrid = new Set(), keep = new Set();
    for (const c of cams) {
      const cx = Math.floor(c.x / S), cz = Math.floor(c.z / S);
      for (let dz = -H; dz <= H; dz++) for (let dx = -H; dx <= H; dx++) {
        const k = `${cx + dx}_${cz + dz}`;
        if (Math.abs(dx) <= h && Math.abs(dz) <= h) inGrid.add(k);
        else keep.add(k);
      }
      // GB43: and, at a tier with viewFar, the cells in the camera's view out to viewFar metres (the horizontal field of view
      // at 16:9 and 8 degrees either side): an aerial looking 5 km out held full detail only within the grid's 700 m round
      // the camera, half of it behind the lens, and the towers along the view drew as the far tier
      const VF = this.tier.viewFar || 0;
      if (VF > 0 && c.q) {
        const [qx, qy, qz, qw] = c.q;
        // forward = q * (0, 0, -1)
        let fx = -(2 * (qx * qz + qw * qy)), fz = -(1 - 2 * (qx * qx + qy * qy));
        const fl = Math.hypot(fx, fz);
        if (fl > 1e-3) {
          fx /= fl; fz /= fl;
          const half = Math.atan(Math.tan(((c.fovV || 58) * Math.PI) / 360) * 16 / 9) + (8 * Math.PI) / 180, cosH = Math.cos(Math.min(half, Math.PI / 2));
          const r = Math.ceil(VF / S);
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            const ex = (cx + dx + 0.5) * S - c.x, ez = (cz + dz + 0.5) * S - c.z, d = Math.hypot(ex, ez);
            if (d > VF || d < 1) continue;
            if ((ex * fx + ez * fz) / d >= cosH || d < S * 1.5) inGrid.add(`${cx + dx}_${cz + dz}`);
          }
        }
      }
    }
    const next = new Set(inGrid);
    for (const k of this.cellKeep) if (keep.has(k)) next.add(k);
    this.cellKeep = next;
    const baked = [], missing = [];
    for (const k of [...next].sort()) (this.cells.cells.has(k) ? baked : missing).push(k);
    return { baked, missing };
  }
  // the persistent tier's keys and the drawn counts per level (for stats)
  persistentKeys() { return this.roots.map((n) => n.key); }
  drawnPerLevel() { const d = {}; for (const n of this.lastDraw || []) d[n.lv] = (d[n.lv] || 0) + 1; return d; }
}
