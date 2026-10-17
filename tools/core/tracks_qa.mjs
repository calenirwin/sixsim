// Plausibility of a take's actor tracks, from the file alone (what a renderer would replay):
// - jumps: a vehicle moving more than 4 m or a walker more than 1 m between two frames (a teleport on screen);
// - speeds: vehicle and walker speed percentiles from the poses;
// - pops: an actor whose first or last frame falls inside the take and who is then in view, nearer than 150 m
//   (appearing or vanishing in the picture; the spawn guard should make this zero for spawns);
// - lamps: brake and blinker toggles per vehicle-second (flicker); gait: the phase advance against hz x dt.
//
//   node tools/core/tracks_qa.mjs shots/core/tuApolloSweep_s1/tracks.atrk
import * as THREE from 'three';
import { readTracks } from '../../core/tracks/format.mjs';

const file = process.argv[2];
const { header: H, frames } = readTracks(file);
const dt = H.dt, N = frames.length, aspect = 16 / 9;
const cams = H.camera.rows.map((r) => {
  const cam = new THREE.PerspectiveCamera(r[7], aspect, 0.4, 5000);
  cam.position.set(r[0], r[1], r[2]); cam.quaternion.set(r[3], r[4], r[5], r[6]); cam.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  return { cam, fr };
});
const inView = (f, x, y, z, r) => cams[f].fr.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), r)) && cams[f].cam.position.distanceTo(new THREE.Vector3(x, y, z)) < 150;
const tracks = new Map();
frames.forEach((F, f) => {
  for (const v of F.veh) { let T = tracks.get(v.id); if (!T) tracks.set(v.id, (T = { type: 'veh', fr: [] })); T.fr.push([f, v]); }
  for (const w of F.walk) { let T = tracks.get(w.id); if (!T) tracks.set(w.id, (T = { type: 'walk', fr: [] })); T.fr.push([f, w]); }
});
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
const R = { veh: { tracks: 0, jumps: 0, maxStep: 0, speeds: [], popsIn: 0, popsOut: 0, brakeToggles: 0, blinkToggles: 0, vehSeconds: 0, gaps: 0 },
  walk: { tracks: 0, jumps: 0, maxStep: 0, speeds: [], popsIn: 0, popsOut: 0, phaseErr: [], gaps: 0 } };
const popList = [];
for (const [id, T] of tracks) {
  const S = R[T.type];
  S.tracks++;
  const lim = T.type === 'veh' ? 4 : 1;
  for (let k = 1; k < T.fr.length; k++) {
    const [f0, a] = T.fr[k - 1], [f1, b] = T.fr[k];
    if (f1 !== f0 + 1) { S.gaps++; continue; }   // left the region and came back
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    S.maxStep = Math.max(S.maxStep, d);
    if (d > lim) S.jumps++;
    S.speeds.push(d / dt);
    if (T.type === 'veh') {
      if (((a.lamps ^ b.lamps) & 4)) S.brakeToggles++;
      if (((a.lamps ^ b.lamps) & 24)) S.blinkToggles++;
      S.vehSeconds += dt;
    } else if (a.amp > 0.5 && b.amp > 0.5) {
      let adv = b.phase - a.phase; adv -= Math.floor(adv);
      S.phaseErr.push(Math.abs(adv - b.hz * dt));
    }
  }
  const [fa, A] = T.fr[0], [fb, B] = T.fr[T.fr.length - 1];
  const r = T.type === 'veh' ? 3 : 1;
  if (fa > 0 && inView(fa, A.x, A.y + 1, A.z, r)) { S.popsIn++; popList.push(`${T.type} ${id} appears at frame ${fa} in view, ${cams[fa].cam.position.distanceTo(new THREE.Vector3(A.x, A.y, A.z)).toFixed(0)} m`); }
  if (fb < N - 1 && inView(fb, B.x, B.y + 1, B.z, r)) { S.popsOut++; popList.push(`${T.type} ${id} vanishes after frame ${fb} in view, ${cams[fb].cam.position.distanceTo(new THREE.Vector3(B.x, B.y, B.z)).toFixed(0)} m`); }
}
const out = {
  file, shot: H.shot, seed: H.seed, frames: N,
  vehicles: { tracks: R.veh.tracks, jumps: R.veh.jumps, maxStepM: +R.veh.maxStep.toFixed(2), speedP50: pct(R.veh.speeds, 0.5), speedP95: pct(R.veh.speeds, 0.95), speedMax: pct(R.veh.speeds, 1),
    popsIn: R.veh.popsIn, popsOut: R.veh.popsOut, brakeTogglesPerS: +(R.veh.brakeToggles / Math.max(1e-9, R.veh.vehSeconds)).toFixed(3), blinkTogglesPerS: +(R.veh.blinkToggles / Math.max(1e-9, R.veh.vehSeconds)).toFixed(3), regionGaps: R.veh.gaps },
  walkers: { tracks: R.walk.tracks, jumps: R.walk.jumps, maxStepM: +R.walk.maxStep.toFixed(2), speedP50: pct(R.walk.speeds, 0.5), speedP95: pct(R.walk.speeds, 0.95), speedMax: pct(R.walk.speeds, 1),
    popsIn: R.walk.popsIn, popsOut: R.walk.popsOut, gaitPhaseErrP95: pct(R.walk.phaseErr, 0.95), regionGaps: R.walk.gaps },
  pops: popList.slice(0, 12),
};
console.log(JSON.stringify(out, null, 1));
