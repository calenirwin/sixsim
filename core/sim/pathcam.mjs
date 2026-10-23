// A shot's camera, headless: client/src/main.js PathCam (keys in lon/lat/alt with look points, centripetal-free
// Catmull-Rom at the path's tension, easeEnds, heights over the terrain unless `abs`, the seam low-pass on the ground)
// driving a THREE.PerspectiveCamera that the spawn and view guards read. Plus the recorder's hold path
// (tools/ad/record.mjs holdOf: the camera parked on key 0 through the warm-up).
import * as THREE from 'three';
import { project } from '../../client/src/shared/geo.js';

export const holdOf = (P) => ({
  duration: 1e6, ease: 0, abs: P.abs, tension: P.tension, fov: P.fov,
  keys: [P.keys[0], { p: [P.keys[0].p[0] + 1e-6, P.keys[0].p[1] + 1e-6, P.keys[0].p[2]], look: P.keys[0].look }],
  ...(P.takeData ? { takeData: P.takeData, takeHold: true } : {}),   // a player take holds its first frame (record.mjs takeHold)
});

// a hold at any key (or a point between keys) of a take's path, and the midpoint of two keys (record.mjs holdAt, midKey)
export const holdAt = (P, K) => ({ duration: 1e6, ease: 0, abs: P.abs, tension: P.tension, fov: P.fov, keys: [K, { p: [K.p[0] + 1e-6, K.p[1] + 1e-6, K.p[2]], look: K.look }] });
export const midKey = (a, b) => ({ p: a.p.map((v, i) => (v + b.p[i]) / 2), look: (a.look || a.p).map((v, i) => (v + (b.look || b.p)[i]) / 2) });

export class PathCam {
  constructor(camera, streamer, projectCoordinates = project) {
    this.project = projectCoordinates;
    this.camera = camera; this.streamer = streamer;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.t = 0; this.path = null;
  }
  static easeEnds(x, f) {
    if (f <= 0.001) return x;
    const norm = 1 - f;
    let a;
    if (x < f) a = (x * x) / (2 * f);
    else if (x > 1 - f) { const y = 1 - x; a = norm - (y * y) / (2 * f); }
    else a = x - f / 2;
    return a / norm;
  }
  setPath(path) {
    this.path = path; this.t = 0; this.ground = null; this.lookGround = null;
    // a player take (tools/ad/takes.mjs expandTake): the recorded camera frame by frame (main.js PathCam.takeStep)
    this.take = path.takeData || null; this.takeHold = !!path.takeHold;
    const cam = this.camera;
    if (path.fov && Math.abs(cam.fov - path.fov) > 1e-4) { cam.fov = path.fov; cam.updateProjectionMatrix(); }
    const pts = path.keys.map((k) => { const [x, z] = this.project(k.p[0], k.p[1]); return new THREE.Vector3(x, k.p[2], z); });
    const lks = path.keys.map((k) => { const s = k.look || k.p; const [x, z] = this.project(s[0], s[1]); return new THREE.Vector3(x, k.look ? k.look[2] : k.p[2], z); });
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', path.tension ?? 0.5);
    this.lookCurve = new THREE.CatmullRomCurve3(lks, false, 'catmullrom', path.tension ?? 0.5);
  }
  groundAt(x, z, prev, dt) {
    const g = this.streamer.terrainAt(x, z);
    if (g === null || !isFinite(g)) return prev;
    if (prev === null) return g;
    return prev + (g - prev) * (1 - Math.pow(0.75, Math.max(0, dt) * 30));
  }
  // the camera's position at the start of the path, before any tile is in (where to stream first)
  startXZ() { const p = this.curve.getPointAt(0); return [p.x, p.z]; }
  takeStep(dt) {
    const T = this.take, cam = this.camera;
    if (!this.takeHold) this.t += dt;
    const f = Math.min(T.frames - 1, Math.max(0, this.t * T.fps));
    const i = Math.floor(f), j = Math.min(T.frames - 1, i + 1), u = f - i, A = T.cam[i], B = T.cam[j];
    this.pos.set(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
    const qa = this._qa || (this._qa = new THREE.Quaternion()), qb = this._qb || (this._qb = new THREE.Quaternion());
    qa.set(A[3], A[4], A[5], A[6]); qb.set(B[3], B[4], B[5], B[6]); qa.slerp(qb, u);
    cam.position.copy(this.pos); cam.quaternion.copy(qa);
    const fov = A[7] + (B[7] - A[7]) * u;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    if (this.onTake) this.onTake(f, dt, this.takeHold);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  update(dt) {
    if (this.take) return this.takeStep(dt);
    const P = this.path;
    this.t += dt;
    const u = PathCam.easeEnds(Math.min(1, Math.max(0, this.t / (P.duration || 12))), P.ease ?? 0.14);
    const p = this.curve.getPointAt(u);
    const l = this.lookCurve.getPointAt(Math.min(1, u + (P.lookAhead ?? 0)));
    if (!P.abs) { this.ground = this.groundAt(p.x, p.z, this.ground, dt); this.lookGround = this.groundAt(l.x, l.z, this.lookGround, dt); }
    this.pos.set(p.x, p.y + (P.abs ? 0 : (this.ground ?? 0)), p.z);
    const ly = l.y + (P.abs ? 0 : (this.lookGround ?? this.ground ?? 0));
    const dx = l.x - this.pos.x, dy = ly - this.pos.y, dz = l.z - this.pos.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(this.yaw);
    cam.rotateX(this.pitch);
    cam.updateMatrixWorld();
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
}
