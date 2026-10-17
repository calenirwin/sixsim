// A core take's train cars as part tracks for the export's moving-set file: every car's body (one track per material
// part), door leaves, trucks, wheelsets and coupling gap, frame by frame, computed from the car records of the tracks
// (pose, trucks, wheel roll, doors) the way sim/trains.js update() places its instances (mirrored below, with its car
// models and specs imported as they are). tools/core/tracks_to_mov.py --trains matches each part set to an earlier
// harvest's mover of the same material and vertex count, which carries the geometry.
//
//   node tools/core/tracks_to_trains.mjs --tracks <take>/tracks.atrk --out <file.json>
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const { readTracks } = await import('../../core/tracks/format.mjs');
const T = readTracks(path.resolve(opt('tracks')));
const H = T.header;
globalThis.location = { search: H.query || '?record=1' };
globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
await import('../../core/env/shim.mjs');
const THREE = await import('three');
const { carModel, doorSlots } = await import('../../client/src/city/trains/models.js');
const { SPECS } = await import('../../client/src/city/trains/cars.js');
const QS = new URLSearchParams(H.query || '');
const forceLod = QS.get('trlod') !== null ? +QS.get('trlod') : QS.get('filmlod') === '1' ? 0 : null;   // trains.js: the film draws LOD0
const LOD0_D = 45, CAP = { r62a: 48, m7a: 64, m8: 64 };
const kinds = H.trainKinds || ['r62a', 'm7a', 'm8'];
const actors = new Map(H.actors.filter((a) => a.type === 'train').map((a) => [a.id, a]));
// each kind's part sets: material keys and vertex counts (the geometry the page builds)
const partsOf = {};
for (const k of kinds) {
  const m = carModel(k);
  const vtx = (g) => g.getAttribute('position').count;
  partsOf[k] = { body: [0, 1].map((L) => Object.entries(m.lod[L] || {}).map(([mat, g]) => ({ mat, vtx: vtx(g) }))), door: Object.entries(m.door.geos).map(([mat, g]) => ({ mat, vtx: vtx(g) })),
    truck: Object.entries(m.truck).map(([mat, g]) => ({ mat, vtx: vtx(g) })), wheel: Object.entries(m.wheel).map(([mat, g]) => ({ mat, vtx: vtx(g) })), gap: Object.entries(m.gap).map(([mat, g]) => ({ mat, vtx: vtx(g) })) };
}
const sets = new Map();   // `${kind}|${role}|${lod}|${mat}` -> { kind, role, lod, mat, vtx, tracks: Map(id -> {id, f0, m}) }
const put = (kind, role, lod, parts, id, f, M) => {
  const m12 = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10], M[12], M[13], M[14]].map((v) => Math.round(v * 1e5) / 1e5);
  for (const p of parts) {
    const key = `${kind}|${role}|${lod}|${p.mat}`;
    let S = sets.get(key);
    if (!S) sets.set(key, (S = { kind, role, lod, mat: p.mat, vtx: p.vtx, tracks: new Map() }));
    let tr = S.tracks.get(id);
    if (!tr) S.tracks.set(id, (tr = { id, f0: f, m: [] }));
    while (tr.f0 + tr.m.length < f) tr.m.push(tr.m[tr.m.length - 1]);   // a frame it was culled in between holds its pose
    tr.m.push(m12);
  }
};
const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 20000), fr = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
const mtx = new THREE.Matrix4(), m2 = new THREE.Matrix4(), mw = new THREE.Matrix4(), mr = new THREE.Matrix4(), RY = new THREE.Matrix4().makeRotationY(Math.PI);
const q = new THREE.Quaternion(), eu = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
const carsOut = [];
T.frames.forEach((F, f) => {
  const r = H.camera.rows[f];
  cam.position.set(r[0], r[1], r[2]); cam.quaternion.set(r[3], r[4], r[5], r[6]); cam.fov = r[7]; cam.updateProjectionMatrix();
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pv);
  const n = Object.fromEntries(kinds.map((k) => [k, [0, 0]]));
  const list = [];
  for (const c of F.train || []) {
    const kind = kinds[c.kind], S = SPECS[kind], P = partsOf[kind], A = actors.get(c.id) || {};
    const d = Math.hypot(c.x - r[0], c.y + 2 - r[1], c.z - r[2]);
    if (d > 3000) continue;
    sph.center.set(c.x, c.y + S.H / 2, c.z); sph.radius = S.LB / 2 + 2;
    if (d > 150 && !fr.intersectsSphere(sph)) continue;
    const L = forceLod !== null ? forceLod : d < LOD0_D ? 0 : 1;
    if (n[kind][L] >= CAP[kind]) continue;
    n[kind][L]++;
    const key = A.key || String(c.id);
    q.setFromEuler(eu.set(0, c.yaw, 0)); pos.set(c.x, c.y, c.z); mtx.compose(pos, q, scl);
    put(kind, 'body', L, P.body[L], `${key}/body`, f, mtx.elements);
    const lw = S.doorW / S.leaves;
    let j = 0;
    for (const [x, dir] of doorSlots(S)) for (const sg of [1, -1]) {
      const fo = sg === c.side ? c.doors : 0;
      m2.makeTranslation(x + dir * lw * fo * 0.98, 0, sg * (S.W / 2 - 0.022));
      if (sg < 0) m2.multiply(RY);
      m2.premultiply(mtx);
      put(kind, 'door', 0, P.door, `${key}/door${j++}`, f, m2.elements);
    }
    [c.ta, c.tb].forEach(([tx, ty, tz, tyaw], ti) => {
      q.setFromEuler(eu.set(0, tyaw, 0)); pos.set(tx, ty, tz); m2.compose(pos, q, scl);
      put(kind, 'truck', 0, P.truck, `${key}/truck${ti}`, f, m2.elements);
      [-S.wheelBase / 2, S.wheelBase / 2].forEach((ax, ai) => {
        const w = mw.makeTranslation(ax, S.wheelR, 0).multiply(mr.makeRotationZ(c.roll));
        w.premultiply(m2);
        put(kind, 'wheel', 0, P.wheel, `${key}/wheel${ti}${ai}`, f, w.elements);
      });
    });
    if (!(c.flags & 2)) {   // the coupling gap behind every car but the last
      m2.makeTranslation(-S.LC / 2 * (c.flags & 1 ? -1 : 1), 0, 0).premultiply(mtx);
      put(kind, 'gap', 0, P.gap, `${key}/gap`, f, m2.elements);
    }
    list.push({ id: key, kind, x: c.x, y: c.y, z: c.z, yaw: c.yaw, lamps: [c.lamps & 1, (c.lamps >> 1) & 1, (c.lamps >> 2) & 1, (c.lamps >> 3) & 1], doors: c.doors, v: c.v });
  }
  carsOut.push(list);
});
const outSets = [...sets.values()].map((S) => ({ kind: S.kind, role: S.role, lod: S.lod, mat: S.mat, vtx: S.vtx, tracks: [...S.tracks.values()] }));
fs.writeFileSync(path.resolve(opt('out')), JSON.stringify({ shot: H.shot, sets: outSets, cars: carsOut }));
console.log(`[trains] ${H.shot}: ${outSets.length} part sets, ${outSets.reduce((s, x) => s + x.tracks.length, 0)} part tracks, ${new Set(carsOut.flat().map((c) => c.id)).size} cars -> ${opt('out')}`);
