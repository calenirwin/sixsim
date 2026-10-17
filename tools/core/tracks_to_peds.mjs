// A core take's walkers as the export pipeline's walker files (what client/tools/ar34/export/harvest_peds.mjs writes from
// the page's photoreal crowd: peds_<shot>.json, peds/<shot>/f<iii>.bin, peds/assets.json, peds/geo/*), so usd_peds.py,
// unchanged, writes their UsdSkel walkers. No page runs: each walker's crowd state is derived from its track the way
// sim/crowd.js derives it from the walker model's calls, and its pose is evaluated on the CPU as harvest_peds.mjs does.
//
// What comes from where (docs/notes/arch-r1-d.md has the full account):
//   - body and variant, walk style, height scale, carried props, garment tints: sim/crowd.js's own rules, called on its
//     prototype (setAnim, setStyle, setPace, _heightScale, _clipFor, _propMask) with the walker's seed, speed, phase and
//     outfit from the tracks; the tint tables and the clip fix through the R1D block at the end of crowd.js;
//   - clips, clip times and crossfades: update()'s state machine, mirrored below (walk while the walker walks, idle while
//     it stands; the first clip time from its phase; 0.28 s crossfades; the playback rate from its speed and pace);
//   - the pose: harvest_peds.mjs cpuPose (crowd.js POSE_FS on the CPU), mirrored below, from the crowd's clip data
//     (client/public/models/peds24/clips_*.bin with crowd.js fixLoop) and each body's reference pose and inverse binds;
//   - which walkers are written: those in the camera's view (the crowd's own test) and, for their shadows, those within
//     --shadow m of the lens (the page uses its sun's near cascade); the body meshes from earlier harvests' peds/geo.
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/tracks_to_peds.mjs --tracks <take>/tracks.atrk --out <dir> [--shadow 30]
// then:  uv run --no-project --with usd-core --with numpy --with pillow python client/tools/ar34/export/usd_peds.py \
//          --in <dir> --out <usd dir> --shots <shot>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const { readTracks } = await import('../../core/tracks/format.mjs');
const T = readTracks(path.resolve(opt('tracks')));
const H = T.header, shot = H.shot, nF = T.frames.length, DT = H.dt || 1 / 30;
const out = path.resolve(opt('out'));
const SHADOW_R = parseFloat(opt('shadow', '30'));
// the take's page query before the crowd module loads (its LOD distances, `record`, the crowd flags)
globalThis.location = { search: H.query || '?record=1' };
await import('../../core/env/shim.mjs');
const THREE = await import('three');
const { Crowd, R1D_CROWD } = await import('../../client/src/sim/crowd.js');
const { fixLoop, FADE, LODD, hash, BOTTOMS, SHOES } = R1D_CROWD;
const PEDS = path.join(ROOT, 'client/public/models/peds24');
const QS = new URLSearchParams(H.query || '');

// ---------------------------------------------------------------- the crowd's assets, as loadCrowd builds them (no mesh)
const manifest = JSON.parse(fs.readFileSync(path.join(PEDS, 'manifest.json'), 'utf8'));
const extra = QS.get('rb27') === '0' || !fs.existsSync(path.join(PEDS, 'rb27/manifest.json')) ? null : JSON.parse(fs.readFileSync(path.join(PEDS, 'rb27/manifest.json'), 'utf8'));
const clipIdx = JSON.parse(fs.readFileSync(path.join(PEDS, 'clips.json'), 'utf8'));
const skel = {};
for (const [k, S] of Object.entries(manifest.skeletons)) {
  if (!S.parents) continue;
  const b = fs.readFileSync(path.join(PEDS, `clips_${k}.bin`));
  const data = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const nb = S.bones.length, hips = S.bones.findIndex((n) => /hips/i.test(n));
  const clips = clipIdx.clips.filter((c) => c.skeleton === k).map((c) => ({ ...c }));
  for (const c of clips) fixLoop(data, nb, hips, c);
  skel[k] = { name: k, nb, bones: S.bones, parents: S.parents, hips, clipData: data, clips, bodies: [] };
}
// bodies: the CARLA set in manifest order, then the rb27 set (the page orders them by load completion; the order only
// numbers them and picks the reference hips height below, so a fixed order is the deterministic choice)
const bodies = {};
for (const [name, B] of Object.entries(manifest.bodies)) bodies[name] = { name, ...B };
if (extra) for (const [name, B] of Object.entries(extra.bodies)) bodies[name] = { name, ...B, set: B.set || extra.set || 'rb27' };
for (const B of Object.values(bodies)) { const S = skel[B.skeleton]; if (S) { B.index = S.bodies.length; S.bodies.push(B); } }
for (const S of Object.values(skel)) {
  for (const B of S.bodies) B.hipsH = Math.hypot(B.refT[S.hips * 3], B.refT[S.hips * 3 + 1], B.refT[S.hips * 3 + 2]);
  S.refHips = (S.bodies.find((B) => B.height > 1.5) || S.bodies[0])?.hipsH || 1;
}
for (const B of Object.values(bodies)) B.propBits = (B.props || []).reduce((m, id) => m | (1 << id), 0);
const variants = [...manifest.variants, ...(extra ? extra.variants : [])].filter((v) => bodies[v.body]);

// ---------------------------------------------------------------- the bodies' meshes: earlier harvests' peds/geo, merged
const harvests = [];
const scan = (d, depth) => {
  if (depth > 6 || !fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(d, e.name);
    if (e.name === 'peds' && fs.existsSync(path.join(p, 'assets.json'))) harvests.push(path.dirname(p));
    else if (!/^(geo|tex|textures|frames|clips|peds)$/.test(e.name)) scan(p, depth + 1);
  }
};
scan(opt('harvests', '/data0/projectnyc_aux/tmp'), 0);
const have = {};   // body name -> { entry, dir }
let tmplVariants = null, tmplClips = null;
for (const h of harvests.sort()) {
  let A;
  try { A = JSON.parse(fs.readFileSync(path.join(h, 'peds/assets.json'), 'utf8')); } catch { continue; }
  const names = (A.variants || []).map((v) => v.name).join(',');
  if (names !== variants.map((v) => v.name).join(',')) continue;   // another crowd build: its variant numbers differ
  tmplVariants = tmplVariants || A.variants; tmplClips = tmplClips || A.clips;
  for (const [bn, E] of Object.entries(A.bodies)) {
    if (have[bn]) continue;
    const files = E.lods.flatMap((L) => Object.values(L || {}).map((x) => x.file));
    if (files.every((f) => fs.existsSync(path.join(h, f)))) have[bn] = { entry: E, dir: h };
  }
}
if (!tmplVariants) { console.error('no harvest with this crowd build found'); process.exit(2); }
console.log(`[peds] ${harvests.length} harvests scanned: meshes for ${Object.keys(have).length} of ${Object.keys(bodies).length} bodies`);
// a variant whose body has no mesh anywhere is replaced by the next pool entry that has one (deterministic, logged)
const pool = [];
for (let i = 0; i < variants.length; i++) {
  const v = variants[i];
  const w = v.weight ?? (v.uniform === 'police' ? 1 : v.age === 'child' ? 2 : v.build === 'heavy' ? 4 : 10);
  for (let k = 0; k < w; k++) pool.push(i);
}
const usable = (vi) => !!have[variants[vi].body];
const remap = new Map();
const remapOf = (vi) => {
  if (usable(vi)) return vi;
  if (remap.has(vi)) return remap.get(vi);
  let j = pool.indexOf(vi);
  for (let k = 1; k <= pool.length; k++) { const c = pool[(j + k) % pool.length]; if (usable(c)) { remap.set(vi, c); return c; } }
  return vi;
};

// ---------------------------------------------------------------- the crowd's per-walker rules, on its prototype
const walkers = new Map();   // track id -> slot
for (const F of T.frames) for (const w of F.walk) if (!walkers.has(w.id)) walkers.set(w.id, walkers.size);
const N = Math.max(1, walkers.size);
const f32 = (n = 1) => new Float32Array(N * n);
const C = Object.create(Crowd.prototype);
Object.assign(C, {
  show: null, showProps: null, A: { variants, bodies, skel }, pool,
  st: { phase: f32(), speed: f32(), amp: f32(), seed: f32(), gait: new Int16Array(N).fill(-1), variant: new Int16Array(N).fill(-1), clipA: new Int16Array(N).fill(-1), tA: f32(), clipB: new Int16Array(N).fill(-1), tB: f32(), w: f32(), style: f32(4), pace: f32().fill(1), pose: new Int8Array(N), fit: f32().fill(1),
    armPose: new Int8Array(N), armPose2: new Int8Array(N), armV: new Int16Array(N).fill(-1), armS: f32(), armKW: f32(), gzMode: new Int8Array(N), gzT: f32(3), gzJ: new Int16Array(N).fill(-1), gzY: f32(), gzP: f32(), gzTau: f32().fill(0.5), gzSeed: f32(), gzC: new Int16Array(N * 3).fill(-1), gzCS: f32(3), gzAt: f32().fill(-1) },
  clipsBy: {},
});
for (const S of Object.values(skel)) {
  const by = (kind) => S.clips.filter((c) => c.kind === kind);
  C.clipsBy[S.name] = { walk: by('walk'), idle: by('idle'), sit: S.clips.filter((c) => c.kind === 'sit'), all: S.clips };
}
const actor = new Map(H.actors.filter((a) => a.type === 'walker').map((a) => [a.id, a]));
const st = C.st;
for (const [id, i] of walkers) {
  const a = actor.get(id);
  // peds.js: setAnim(idx, phase, v * 4.4, amp, skin) and setStyle(idx, mask, bagTone, umbTone) when the walker spawns
  C.setAnim(i, a.phase0 ?? 0, (a.speed ?? 1.3) * 4.4, 1, a.variant);
  C.setStyle(i, a.outfit | 0, a.bagTone || 0, a.umbTone || 0);
  const vi = remapOf(st.variant[i]);
  if (vi !== st.variant[i]) st.variant[i] = vi;
}

// ---------------------------------------------------------------- the pose on the CPU (harvest_peds.mjs cpuPose)
const qmul = (a, b) => [a[3] * b[0] + b[3] * a[0] + (a[1] * b[2] - a[2] * b[1]), a[3] * b[1] + b[3] * a[1] + (a[2] * b[0] - a[0] * b[2]), a[3] * b[2] + b[3] * a[2] + (a[0] * b[1] - a[1] * b[0]), a[3] * b[3] - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])];
const qrot = (q, v) => { const cx = q[1] * v[2] - q[2] * v[1] + q[3] * v[0], cy = q[2] * v[0] - q[0] * v[2] + q[3] * v[1], cz = q[0] * v[1] - q[1] * v[0] + q[3] * v[2];
  return [v[0] + 2 * (q[1] * cz - q[2] * cy), v[1] + 2 * (q[2] * cx - q[0] * cz), v[2] + 2 * (q[0] * cy - q[1] * cx)]; };
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; };
const nl = (a, b, t) => { const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], k = d < 0 ? -1 : 1;
  return nrm([a[0] * (1 - t) + b[0] * k * t, a[1] * (1 - t) + b[1] * k * t, a[2] * (1 - t) + b[2] * k * t, a[3] * (1 - t) + b[3] * k * t]); };
const gmod = (x, y) => x - y * Math.floor(x / y);
function cpuPose(S, B, iA, iB, iC, out, o) {
  const nb = S.nb, CD = S.clipData, par = S.parents;
  const clipAt = (c0, c1, c2, b) => {
    const f = Math.floor(c2), a = c2 - f;
    const r0 = Math.floor(c0 + gmod(f, c1) + 0.5), r1 = Math.floor(c0 + gmod(f + 1, c1) + 0.5);
    const i0 = (r0 * nb + b) * 8, i1 = (r1 * nb + b) * 8;
    const ok = CD[i0 + 7];
    const qq = ok > 0.5 ? nl([CD[i0], CD[i0 + 1], CD[i0 + 2], CD[i0 + 3]], [CD[i1], CD[i1 + 1], CD[i1 + 2], CD[i1 + 3]], a) : [0, 0, 0, 1];
    return [qq, [CD[i0 + 4] * (1 - a) + CD[i1 + 4] * a, CD[i0 + 5] * (1 - a) + CD[i1 + 5] * a, CD[i0 + 6] * (1 - a) + CD[i1 + 6] * a], ok];
  };
  const GQ = new Array(nb), GT = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const p = par[b], gq = p >= 0 ? GQ[p] : [0, 0, 0, 1], gt = p >= 0 ? GT[p] : [0, 0, 0];
    const [qa, ta, va] = clipAt(iA[0], iA[1], iA[2], b), [qb, tb, vb] = clipAt(iB[0], iB[1], iB[2], b);
    const rT = [B.refT[b * 3], B.refT[b * 3 + 1], B.refT[b * 3 + 2]], rR = [B.refR[b * 4], B.refR[b * 4 + 1], B.refR[b * 4 + 2], B.refR[b * 4 + 3]];
    const la = va > 0.5 ? qa : rR, lb = vb > 0.5 ? qb : rR;
    const lq = nl(la, lb, iA[3]);
    let lt = rT;
    if (b === S.hips) {
      const ha = va > 0.5 ? [ta[0] * iC[0], ta[1] * iC[0], ta[2] * iC[0]] : rT, hb = vb > 0.5 ? [tb[0] * iC[1], tb[1] * iC[1], tb[2] * iC[1]] : ha;
      lt = [ha[0] * (1 - iA[3]) + hb[0] * iA[3], ha[1] * (1 - iA[3]) + hb[1] * iA[3], ha[2] * (1 - iA[3]) + hb[2] * iA[3]];
    }
    const rt = qrot(gq, lt);
    GT[b] = [gt[0] + rt[0], gt[1] + rt[1], gt[2] + rt[2]];
    GQ[b] = nrm(qmul(gq, lq));
    // skinning matrix S = G x IBM, rows 0..2 (IBM column-major in the body table: row r = m[r], m[4 + r], m[8 + r], m[12 + r])
    const g = GQ[b], cx = qrot(g, [1, 0, 0]), cy = qrot(g, [0, 1, 0]), cz = qrot(g, [0, 0, 1]), Tt = GT[b], m = b * 16;
    for (let i = 0; i < 3; i++) {
      const R0 = cx[i], R1 = cy[i], R2 = cz[i];
      for (let j = 0; j < 4; j++) out[o + b * 12 + i * 4 + j] = R0 * B.ibm[m + j * 4] + R1 * B.ibm[m + j * 4 + 1] + R2 * B.ibm[m + j * 4 + 2] + (j === 3 ? Tt[i] : 0);
    }
  }
}

// ---------------------------------------------------------------- per frame: the crowd's update(), mirrored
const HW = 48, LOD0_2 = LODD[0] * LODD[0], LOD1_2 = LODD[1] * LODD[1], NEAR = 0.4, NF_W = 0.08, ASPECT = 16 / 9;
const skelIdx = (k) => (k === 'gen2' ? 0 : k === 'gen3' ? 1 : 2);
const cam = new THREE.PerspectiveCamera(58, ASPECT, NEAR, 20000), fr = new THREE.Frustum(), pv = new THREE.Matrix4();
fs.mkdirSync(path.join(out, 'peds', shot), { recursive: true });
fs.mkdirSync(path.join(out, 'peds', 'geo'), { recursive: true });
const used = new Set();
const framesOut = [];
const stats = { written: 0, vis: 0, shadow: 0, faded: 0, lod: [0, 0, 0], remapped: 0, clipSwitches: 0 };
const t0 = performance.now();
for (let f = 0; f < nF; f++) {
  const dt = f > 0 ? DT : 0;
  const r = H.camera.rows[f];
  cam.position.set(r[0], r[1], r[2]); cam.quaternion.set(r[3], r[4], r[5], r[6]);
  if (Math.abs(cam.fov - r[7]) > 1e-6) { cam.fov = r[7]; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pv);
  const inside = (x, y, z, rad) => { for (let q = 0; q < 6; q++) { const p = fr.planes[q]; if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -rad) return false; } return true; };
  const cx = r[0], cy = r[1], cz = r[2];
  const recs = [];
  const rows = { gen2: 0, gen3: 0 };
  for (const w of T.frames[f].walk) {
    if (w.pose) continue;   // (no seated walkers in the core yet)
    const i = walkers.get(w.id);
    st.amp[i] = w.amp; st.pace[i] = w.pace ?? 1;   // peds.js setAmp / setPace this frame
    const x = w.x, y = w.y, z = w.z;
    const vis = inside(x, y + 0.9, z, 1.1);
    const d3 = Math.hypot(x - cx, y + 0.9 - cy, z - cz);
    const shv = !vis && d3 < SHADOW_R;
    if (!vis && !shv) continue;   // the crowd skips it: its clip waits
    const vi = st.variant[i], V = variants[vi], B = bodies[V.body], S = skel[B.skeleton];
    // ---- clip state (crowd.js update)
    const walking = st.amp[i] > 0.5;
    const vScale = (V.scale || 1) * C._heightScale(V, B, i) * (st.fit[i] || 1);
    const gaitK = (B.hipsH / S.refHips) * vScale;
    const want = C._clipFor(B.skeleton, V, B, walking, st.seed[i], st.speed[i], gaitK, st.gait[i], 0);
    const wantIdx = S.clips.indexOf(want);
    if (st.clipA[i] < 0) { st.clipA[i] = wantIdx; st.tA[i] = (st.phase[i] * 13.7 % 1) * want.frames; st.clipB[i] = wantIdx; st.w[i] = 0; }
    else if (st.clipA[i] !== wantIdx) {
      st.clipB[i] = st.clipA[i]; st.tB[i] = st.tA[i];
      st.clipA[i] = wantIdx; st.tA[i] = walking ? 0 : (st.seed[i] * 97.1 % 1) * want.frames;
      st.w[i] = 1; stats.clipSwitches++;
    }
    const cA = S.clips[st.clipA[i]], cB = S.clips[st.clipB[i]];
    const rateOf = (c) => (c.kind === 'walk' && c.speed > 0.1 ? Math.min(2.3, Math.max(0.5, st.speed[i] / (c.speed * gaitK))) : 1);
    const pace = st.pace[i] || 1;
    st.tA[i] += dt * cA.fps * rateOf(cA) * (cA.kind === 'walk' ? pace : 1);
    st.tB[i] += dt * cB.fps * rateOf(cB) * (cB.kind === 'walk' ? pace : 1);
    st.w[i] = Math.max(0, st.w[i] - dt / FADE);
    // ---- NF31 / NF32 near fade (the surface within 8 cm of the near plane dissolves)
    const pm = C._propMask(i, V, B);
    const k = vScale, fwx = Math.sin(w.yaw), fwz = Math.cos(w.yaw);
    const lx = cx - x, lz = cz - z, la = Math.abs(lx * fwz - lz * fwx), lf = lx * fwx + lz * fwz, ly = cy - y;
    const pack = (pm & 3) !== 0, bag = (pm & 28) !== 0;
    const sdH = Math.hypot(la, lf - 0.02 * k, ly - 1.62 * k) - 0.125 * k;
    const rr = 0.08 * k, y0 = 0.1 * k, y1 = 1.45 * k, bc = pack ? -0.175 : 0, bh = pack ? 0.325 : 0.15;
    const qx = Math.max(0, la - (bag ? 0.36 : 0.24) * k + rr), qz = Math.max(0, Math.abs(lf - bc * k) - bh * k + rr);
    const sd = Math.min(sdH, Math.hypot(qx, qz, ly < y0 ? y0 - ly : ly > y1 ? ly - y1 : 0) - rr);
    const fade = Math.min(1, Math.max(0, (NEAR + NF_W - sd) / NF_W));
    if (fade >= 1) stats.faded++;
    if (fade >= 1 && !shv) continue;
    // ---- the draw: instance matrix, tints, LOD
    const c0 = Math.cos(w.yaw) * vScale, s0 = Math.sin(w.yaw) * vScale;
    const M = [c0, 0, -s0, 0, 0, vScale, 0, 0, s0, 0, c0, 0, x, y, z, 1];
    const a = actor.get(w.id), Cs = a.col || [0.2, 0.2, 0.2], sdd = st.seed[i], wk = Math.floor(sdd * 1e6);
    const tintOn = V.uniform || QS.get('crowdtint') === '0' ? 0 : 1;
    const bt = BOTTOMS[Math.floor(sdd * 7919) % BOTTOMS.length], sh = SHOES[Math.floor(sdd * 104729) % SHOES.length];
    const tint = [Cs[0], Cs[1], Cs[2], tintOn * (hash(wk, 7) < 0.55 ? 0.85 : 0), bt[0], bt[1], bt[2], tintOn * (hash(wk, 11) < 0.6 ? 0.8 : 0), sh[0], sh[1], sh[2], tintOn * (hash(wk, 13) < 0.5 ? 0.7 : 0)];
    const d2 = (x - cx) ** 2 + (y + 0.9 - cy) ** 2 + (z - cz) ** 2;
    const li = d2 < LOD0_2 ? 0 : d2 < LOD1_2 ? 1 : 2;
    const row = rows[B.skeleton]++;
    const hdr = new Float32Array(HW + S.nb * 12);
    hdr[0] = i; hdr[1] = st.seed[i]; hdr[2] = vi; hdr[3] = li; hdr[4] = vis ? 1 : 0; hdr[5] = shv ? 1 : 0; hdr[6] = fade; hdr[7] = pm;
    hdr.set(M, 8); hdr.set(tint, 24);
    hdr[36] = st.clipA[i]; hdr[37] = st.tA[i] % cA.frames; hdr[38] = st.clipB[i]; hdr[39] = st.tB[i] % cB.frames; hdr[40] = st.w[i];
    hdr[41] = row; hdr[42] = S.nb; hdr[43] = skelIdx(B.skeleton); hdr[44] = 0; hdr[45] = B.index; hdr[46] = Math.sqrt(d2);
    cpuPose(S, B, [cA.row, cA.frames, st.tA[i] % cA.frames, st.w[i]], [cB.row, cB.frames, st.tB[i] % cB.frames, B.index],
      [B.hipsH / (cA.hipsH || B.hipsH), B.hipsH / (cB.hipsH || B.hipsH)], hdr, HW);
    recs.push(hdr);
    used.add(B.name);
    stats.written++; if (vis) stats.vis++; else stats.shadow++; stats.lod[li]++;
  }
  const file = `peds/${shot}/f${String(f).padStart(3, '0')}.bin`;
  const total = recs.reduce((s, x) => s + x.length, 0), buf = new Float32Array(total);
  let o = 0;
  for (const x of recs) { buf.set(x, o); o += x.length; }
  fs.writeFileSync(path.join(out, file), Buffer.from(buf.buffer));
  framesOut.push({ i: f, file, n: recs.length });
}
stats.remapped = remap.size;
// ---------------------------------------------------------------- assets.json and the meshes (hard links)
const A = { skel: {}, bodies: {}, clips: tmplClips, variants: tmplVariants };
for (const [k, S] of Object.entries(skel)) A.skel[k] = { bones: S.bones, parents: S.parents, hips: S.hips, nb: S.nb };
for (const bn of used) {
  const E = have[bn];
  if (!E) continue;
  A.bodies[bn] = { ...E.entry, index: bodies[bn].index };
  for (const L of E.entry.lods) for (const x of Object.values(L || {})) {
    const dst = path.join(out, x.file);
    if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); try { fs.linkSync(path.join(E.dir, x.file), dst); } catch { fs.copyFileSync(path.join(E.dir, x.file), dst); } }
  }
}
fs.writeFileSync(path.join(out, 'peds', 'assets.json'), JSON.stringify(A));
fs.writeFileSync(path.join(out, `peds_${shot}.json`), JSON.stringify({ shot, hw: HW, source: 'core', tracks: path.relative(ROOT, path.resolve(opt('tracks'))), frames: framesOut }));
// a manifest for usd_peds.py (fps, the crowd flags, the shot) unless the vehicles' conversion wrote one
const mp = path.join(out, 'manifest.json');
const man = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : { fps: H.fps, flags: (H.query || '').replace(/^\?/, ''), shots: {} };
man.shots[shot] = { ...(man.shots[shot] || {}), title: H.title || '', time: H.time, frames: nF };
fs.writeFileSync(mp, JSON.stringify(man));
console.log(`[peds] ${shot}: ${stats.written} walker frames (${stats.vis} in view, ${stats.shadow} shadow only; LOD ${stats.lod.join('/')}), ${walkers.size} walkers, ${used.size} bodies, ${stats.clipSwitches} clip switches, ${stats.faded} near-faded, ${stats.remapped} variants remapped; ${((performance.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, out)}`);
