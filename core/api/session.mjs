// The Python API served by a core process: src/api/bridge.js, the page's API half, imported as it is and run against
// the headless world (core/sim/world.mjs: the page's traffic, walker, signal and train models on the headless
// streamer) in place of the page. The page's frame becomes the core's step: main.js engine.onFrame's order (the sky's
// clock, bridge.js preStep, the API camera, the spawn and view guards, the streamer, traffic, walkers, bridge.js
// postStep), requestAnimationFrame and window.__advance drive it, so world.tick, world.wait_until_loaded and the
// asynchronous mode step it as main.js does under ?api=1.
//
// What the page lends bridge.js and the core has no use for stands in here: the engine (its camera is the world's
// lens; the drawing buffer's size is the server's --res; no renderer), main.js's ApiCam, world/sky.js (the time of day:
// its name and the night factor the models read), world/weather.js (the rain value), the perception module's class
// table (perception/segRender.js CLASSES, imported as it is). Sensors need pixels: sensor.listen answers needs_renderer
// (docs/specs/render-protocol.md is what a renderer client implements to serve them from this state).
import * as THREE from 'three';
import { createWorld, NIGHT_OF } from '../sim/world.mjs';
import { PUBLIC } from '../env/shim.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const NEEDS_RENDERER = 'needs_renderer';

// main.js ApiCam: `center` is the spectator's position (where the world streams), `pose` what the frame is seen from
class ApiCam {
  constructor(camera, x, y, z) { this.camera = camera; this.center = new THREE.Vector3(x, y, z); this.pose = null; this.t = 0; }
  apply(pose) {
    const cam = this.camera;
    cam.position.copy(pose.p);
    cam.quaternion.copy(pose.q);
    let proj = false;
    if (pose.fov && Math.abs(cam.fov - pose.fov) > 1e-4) { cam.fov = pose.fov; proj = true; }
    if (pose.aspect && Math.abs(cam.aspect - pose.aspect) > 1e-6) { cam.aspect = pose.aspect; proj = true; }
    if (proj) cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  update(dt) {
    this.t += dt;
    if (this.pose) this.apply(this.pose);
    return { x: this.center.x, y: this.center.y, z: this.center.z };
  }
}

// the crowd's walker variants and pool as sim/crowd.js builds them (manifest + rb27, bodies present; the pool's weights):
// the walker blueprints and the skin a spawned walker gets, as the page offers them with its photoreal crowd
function crowdVariants(query) {
  const base = path.join(PUBLIC, 'models/peds24');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  const rbF = path.join(base, 'rb27/manifest.json');
  const extra = new URLSearchParams(query).get('rb27') === '0' || !fs.existsSync(rbF) ? null : JSON.parse(fs.readFileSync(rbF, 'utf8'));
  const bodies = new Set([...Object.keys(manifest.bodies), ...(extra ? Object.keys(extra.bodies) : [])]);
  const variants = [...manifest.variants, ...(extra ? extra.variants : [])].filter((v) => bodies.has(v.body));
  const pool = [];
  variants.forEach((v, i) => { const w = v.weight ?? (v.uniform === 'police' ? 1 : v.age === 'child' ? 2 : v.build === 'heavy' ? 4 : 10); for (let k = 0; k < w; k++) pool.push(i); });
  return { variants, pool };
}

// the segmentation classes (map.get_semantic_classes) as perception/segRender.js builds CLASSES from its CLASS_ROWS, read
// from that file's text: the table is data, and the core imports no renderer module (docs/specs/modules.md rule 1)
export function semanticClasses() {
  const src = fs.readFileSync(path.join(path.dirname(PUBLIC), 'src/perception/segRender.js'), 'utf8');
  const i = src.indexOf('const CLASS_ROWS = ['), j = src.indexOf('];', i);
  if (i < 0 || j < 0) throw new Error('perception/segRender.js: no CLASS_ROWS table');
  const out = [];
  for (const m of src.slice(i, j).matchAll(/\[\s*(\d+)\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([01])\s*\]/g)) out.push({ id: +m[1], name: m[2], rgb: [+m[3], +m[4], +m[5]], isthing: m[6] === '1' });
  return out;
}

export async function createApiSession({ server, seed = 1, time = 'day', start, res = [1280, 720], procedural = false, idleFps = 0, log = console.log }) {
  const [RW, RH] = res;
  const W = await createWorld({ seed, peds: true, trains: true, night: NIGHT_OF[time] ?? 0 });
  const cam = new ApiCam(W.camera, start.x, start.y, start.z);
  W.controller = cam;
  if (!procedural && W.rig) Object.assign(W.rig, (({ variants, pool }) => ({ A: { variants }, pool }))(crowdVariants(location.search)));
  // the near ring round the start, then the simulation's own random stream (tools/core/take.mjs does the same)
  const tl = performance.now();
  await W.step(0);
  W.reseed(1);
  log(`world: ${W.streamer.stats.near} tiles round (${start.x.toFixed(1)}, ${start.z.toFixed(1)}) in ${((performance.now() - tl) / 1000).toFixed(1)} s; ${Object.keys(W.traffic.pools || {}).length} vehicle kinds, ${W.rig?.A ? W.rig.A.variants.length + ' walker variants' : 'procedural walkers'}`);

  // ---------------------------------------------------------------- the page bridge.js expects
  globalThis.window = globalThis.window || globalThis;
  for (const k of ['addEventListener', 'removeEventListener']) if (typeof window[k] !== 'function') window[k] = () => {};
  window.__PERC = { classes: semanticClasses(), capture: () => { throw Object.assign(new Error('captures need a renderer client'), { code: NEEDS_RENDERER }); } };
  window.__RECSTAT = () => ({ idle: W.streamer.idle(), near: W.streamer.stats.near, macro: 0, dressQ: 0, dressActive: 0 });
  const fr = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  const engine = {
    camera: W.camera, fps: 0, taa: null, skipDraw: false, _grab: null, idleNap: null,
    renderer: {
      getDrawingBufferSize: (v) => v.set(RW, RH),
      getContext: () => ({ RENDERER: 0x1f01, getExtension: () => null, getParameter: () => 'none: the headless core (sensors need a renderer client)' }),
      domElement: { style: {}, addEventListener() {}, removeEventListener() {} },
    },
    wake() {},
    inView(x, y, z, r = 1) { const c = W.camera; c.updateMatrixWorld(); pv.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); fr.setFromProjectionMatrix(pv); sph.center.set(x, y, z); sph.radius = r; return fr.intersectsSphere(sph); },
  };
  const sky = { mode: time, apply(m) { this.mode = m; if (W.ENV.night) W.ENV.night.value = NIGHT_OF[m] ?? 0; } };
  const weather = { rain: 0, set(r) { this.rain = r; } };

  // ---------------------------------------------------------------- frames: requestAnimationFrame, __advance, free run
  // one core step per frame, never two at once; a frame's dt is what __advance (or the free run) left pending, else 0
  let pending = 0, running = false, scheduled = false;
  const rafQ = [];
  const schedule = () => { if (!scheduled && !running) { scheduled = true; setImmediate(runFrame); } };
  async function runFrame() {
    scheduled = false; running = true;
    const q = rafQ.splice(0), dt = pending;
    pending = 0;
    try { await W.step(dt); } catch (e) { log('frame failed:', e?.stack || e); }
    running = false;
    for (const cb of q) { try { cb(performance.now()); } catch (e) { log('frame callback failed:', e?.stack || e); } }
    if (rafQ.length || pending > 0) schedule();
  }
  globalThis.requestAnimationFrame = (cb) => { rafQ.push(cb); schedule(); return rafQ.length; };
  globalThis.cancelAnimationFrame = () => {};
  window.__advance = (dt = 1 / 30) => new Promise((res) => { pending += dt; rafQ.push(() => res()); schedule(); });
  // asynchronous mode (bridge.js setAsync sets __FREERUN_ON): the world steps on real time, at most 0.1 s a frame;
  // --idle-fps N: frames of dt 0 between ticks, as the page's loop keeps streaming round the spectator
  let lastReal = performance.now(), idleAt = 0;
  const pump = setInterval(() => {
    const now = performance.now(), rdt = (now - lastReal) / 1000;
    lastReal = now;
    if (window.__FREERUN_ON) { pending = Math.min(0.1, pending + rdt); schedule(); }
    else if (idleFps > 0 && now - idleAt >= 1000 / idleFps) { idleAt = now; schedule(); }
  }, 16);
  pump.unref?.();

  // ---------------------------------------------------------------- the host (server/preload.js's boundlessHost)
  let onReq = null, onBye = null, readyInfo = null;
  window.boundlessHost = {
    onRequest(cb) { onReq = cb; },
    onDisconnect(cb) { onBye = cb; },
    respond(msg) { const { cid, ...rest } = msg; server.send(cid, rest); },
    emit(meta, blobs) { const { cid, ...rest } = meta; server.send(cid, rest, blobs || []); },
    ready(info) { readyInfo = info; },
  };
  const { initApi } = await import('../../client/src/api/bridge.js');
  const hooks = initApi({ engine, streamer: W.streamer, traffic: W.traffic, peds: W.peds, signals: null, sky, weather, dresser: null, instancer: null, cam, spawnGuard: null });
  W.hooks = { pre: hooks.preStep, post: hooks.postStep };
  if (!readyInfo || !onReq) throw new Error('bridge.js did not start');

  // the requests: sensor captures need a renderer client; server.info says what serves it; the rest is bridge.js
  server.attach((cid, msg) => {
    const m = msg.method, p = msg.params || {};
    if (m === 'sensor.listen') {
      const a = window.__API.actors.get(p.id | 0);
      const what = a ? `${a.type_id} ${a.id}` : `sensor ${p.id}`;
      return server.send(cid, { id: msg.id, error: { code: NEEDS_RENDERER, message: `${what}: sensor data needs a renderer client; this server is the headless core (simulation, no pixels). See docs/specs/render-protocol.md` } });
    }
    if (m === 'server.info') {
      return window.__API.call('server.info', p).then((r) => server.send(cid, { id: msg.id, result: { ...r, engine: 'valdrada-core', renderer: null, sensors: 'need a renderer client' } }),
        (e) => server.send(cid, { id: msg.id, error: { code: e.code || 'internal', message: String(e.message || e) } }));
    }
    onReq({ cid, id: msg.id, method: m, params: p });
  }, (cid) => onBye && onBye(cid));
  server.setReady();
  log(`ready: bridge.js API ${readyInfo.api_version} on the headless core (seed ${seed}, ${time}, ${RW}x${RH}${idleFps ? `, idle frames at ${idleFps} fps` : ''})`);
  return { W, cam, engine, close() { clearInterval(pump); } };
}
