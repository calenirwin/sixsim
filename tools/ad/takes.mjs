// PLAYER TAKES (CONTROL, docs/notes/ar34-control.md): a shot in shots.json may name a recorded player run instead of a
// spline: `"take": "tools/ad/takes/<name>.json"` (written by tools/play/play_run.mjs --take, or the play mode's R key, or
// the API's world.stop_take). expandTakes() fills such a shot in place for the tools that install shots through
// window.__SET_PATH (tools/ad/record.mjs, client/tools/ar34/export/harvest.mjs):
//   keys      the camera's positions every half second as [lon, lat, y] (abs) with a look point 20 m along its view, so
//             the pre-stream (filmlod=1) and the holds visit the take's path as they visit a spline's;
//   duration  (frames - 1) / fps; abs: true; ease 0; fov: the first frame's;
//   takeData  the frames (camera and body) and the body's kind, passed inline to the page: main.js PathCam replays the
//             camera and src/game/control.js createReplay puts the walker or the car back in the sims every frame.
// The shot's flags must hold play=1 (the page loads the replay only then).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const unproject = (x, z) => [LON0 + x / M_LON, LAT0 - z / M_LAT];
const r6 = (v) => Math.round(v * 1e6) / 1e6, r2 = (v) => Math.round(v * 100) / 100;

export function expandTake(spec, root) {
  if (!spec || !spec.take || spec.takeData) return spec;
  const T = JSON.parse(readFileSync(path.resolve(root, spec.take), 'utf8'));
  const keys = [];
  const step = Math.max(1, Math.round(T.fps / 2));
  for (let i = 0; i < T.frames; i += step) keys.push(i);
  if (keys[keys.length - 1] !== T.frames - 1) keys.push(T.frames - 1);
  spec.keys = keys.map((i) => {
    const [x, y, z, qx, qy, qz, qw] = T.cam[i];
    // the camera's view axis: (0, 0, -1) turned by the quaternion
    const fx = -2 * (qx * qz + qw * qy), fy = -2 * (qy * qz - qw * qx), fz = -(1 - 2 * (qx * qx + qy * qy));
    const [lo, la] = unproject(x, z), [llo, lla] = unproject(x + fx * 20, z + fz * 20);
    return { p: [r6(lo), r6(la), r2(y)], look: [r6(llo), r6(lla), r2(y + fy * 20)] };
  });
  spec.duration = +((T.frames - 1) / T.fps).toFixed(3);
  spec.abs = true; spec.ease = 0;
  if (spec.fov === undefined) spec.fov = T.cam[0][7];
  spec.takeData = { fps: T.fps, frames: T.frames, mode: T.mode, kind: T.kind, pv: T.pv, color: T.color, cam: T.cam, body: T.body };
  return spec;
}
export function expandTakes(pool, root) {
  for (const k of Object.keys(pool)) if (pool[k] && pool[k].take) {
    try { expandTake(pool[k], root); } catch (e) { console.log(`*** take of ${k} (${pool[k].take}) unreadable: ${e.message}`); delete pool[k]; }
  }
  return pool;
}
// the hold path's extra fields: a take's warm-up holds its first frame (camera and body)
export const takeHold = (P) => (P.takeData ? { takeData: P.takeData, takeHold: true } : {});
