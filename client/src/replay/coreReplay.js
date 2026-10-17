// ?replay=<take folder | tracks.atrk URL> (R1D, docs/notes/arch-r1-d.md): the page draws a take of the headless core
// (core/, docs/specs/actor-tracks.md) instead of simulating its own. The traffic model's and the walker model's steps
// are replaced: every frame the take's vehicles and walkers are written into the same instance storage the models
// write, and the page's own drawing does the rest (sim/fleet24.js culls, levels and lamps, with the take's seed, wheel
// spin, steering, lamps and bend per vehicle; sim/crowd.js bodies, clips, phases and fades through the walker rig's
// contract, setAnim / setStyle / setAmp / setPace / setPose, as sim/peds.js drives it). The take's frame is picked by the
// page's simulation clock (ENV.time, which world/sky.js advances by every step, as the core's), so a recording that
// warms up as the take did draws frame i at the take's simTime[i]. What is closed-form in that clock follows it with
// the page's own code: the signal lenses (sim/signals.js on traffic.time, set here from the clock), the trains
// (sim/trains.js, cued for the same path) and the Lake's boats (city/cpLakeside.js).
//
// A take folder holds tracks.atrk. A path on this machine (/data0/...) is fetched through the dev server's /@fs/.
import * as THREE from 'three';
import { ENV } from '../world/materials.js';

const MAGIC = 0x4b525441, VEH = 52, WALK = 44, TRAIN = 72;

// the ATRK v1 reader of core/tracks/format.mjs (readTracks) over an ArrayBuffer
export function parseTracks(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not an ATRK file');
  const version = dv.getUint32(4, true), hl = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl)));
  let o = 12 + hl;
  const n = dv.getUint32(o, true); o += 4;
  const frames = [];
  const f32 = (p) => dv.getFloat32(p, true);
  for (let i = 0; i < n; i++) {
    let p = dv.getUint32(o + 4 * i, true);
    const nv = dv.getUint16(p, true), nw = dv.getUint16(p + 2, true), ns = dv.getUint16(p + 4, true), nt = dv.getUint16(p + 6, true);
    p += 8;
    const veh = [], walk = [], train = [];
    for (let k = 0; k < nv; k++, p += VEH) veh.push({ id: dv.getUint32(p, true), x: f32(p + 4), y: f32(p + 8), z: f32(p + 12), q: [f32(p + 16), f32(p + 20), f32(p + 24), f32(p + 28)],
      v: f32(p + 32), spin: f32(p + 36), steer: f32(p + 40), bend: f32(p + 44), lamps: dv.getUint8(p + 48), flags: dv.getUint8(p + 49), kind: dv.getUint16(p + 50, true) });
    for (let k = 0; k < nw; k++, p += WALK) walk.push({ id: dv.getUint32(p, true), x: f32(p + 4), y: f32(p + 8), z: f32(p + 12), yaw: f32(p + 16), v: f32(p + 20), phase: f32(p + 24),
      hz: f32(p + 28), sxz: f32(p + 32), sy: f32(p + 36), amp: dv.getUint8(p + 40) / 255, pose: dv.getUint8(p + 41), pace: dv.getUint16(p + 42, true) / 10000 });
    const sig = new Uint8Array(buf.slice(p, p + ns));
    p += (ns + 3) & ~3;
    for (let k = 0; k < nt; k++, p += TRAIN) train.push({ id: dv.getUint32(p, true), x: f32(p + 4), y: f32(p + 8), z: f32(p + 12), yaw: f32(p + 16),
      ta: [f32(p + 20), f32(p + 24), f32(p + 28), f32(p + 32)], tb: [f32(p + 36), f32(p + 40), f32(p + 44), f32(p + 48)], roll: f32(p + 52), doors: f32(p + 56), v: f32(p + 60),
      lamps: dv.getUint8(p + 64), kind: dv.getUint8(p + 65), flags: dv.getUint8(p + 66), side: dv.getInt8(p + 67), num: dv.getUint8(p + 68), dest: dv.getUint8(p + 69) });
    frames.push({ veh, walk, sig, train });
  }
  return { version, header, frames };
}

export async function loadCoreReplay(spec) {
  let url = String(spec);
  if (/^\/(data0|home|tmp)\//.test(url)) url = '/@fs' + url;
  if (!/\.atrk$/i.test(url)) url = url.replace(/\/+$/, '') + '/tracks.atrk';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const T = parseTracks(await r.arrayBuffer());
  console.log(`[replay] ${T.header.shot} seed ${T.header.seed}: ${T.frames.length} frames from ${url} (simTime ${T.header.simTime[0]}-${T.header.simTime[T.frames.length - 1]})`);
  return createCoreReplay(T, url);
}

export function createCoreReplay(T, url = '') {
  const H = T.header, F = T.frames, N = F.length, dt = H.dt || 1 / 30, t0 = H.simTime[0];
  const actors = new Map(H.actors.map((a) => [a.id, a]));
  const kinds = H.vehicleKinds.map((k) => (typeof k === 'string' ? k : k.kind));
  const frameAt = (t) => (Number.isFinite(t) ? Math.max(0, Math.min(N - 1, Math.round((t - t0) / dt))) : 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  const R = { header: H, url, frames: N, frameAt, f: -1, stats: { vehicles: 0, parked: 0, parkedMissing: 0, walkers: 0, poolFull: 0 } };

  // ---------------------------------------------------------------- train cars
  // the take's cars as sim/trains.js carsAt writes them (its update draws them through its own sets: an R1D block there
  // asks for these instead of the timetable's); none when the take has none within its region
  const trainKinds = H.trainKinds || ['r62a', 'm7a', 'm8'];
  R.trainCarsAt = (t) => F[frameAt(t)].train.map((c) => ({ id: c.id, kind: trainKinds[c.kind], x: c.x, y: c.y, z: c.z, yaw: c.yaw, trucks: [c.ta, c.tb], roll: c.roll,
    doors: c.doors, doorSide: c.side, lamps: [c.lamps & 1, (c.lamps >> 1) & 1, (c.lamps >> 2) & 1, (c.lamps >> 3) & 1], last: !!(c.flags & 2), rev: !!(c.flags & 1),
    num: c.num, dest: c.dest, v: c.v }));

  // ---------------------------------------------------------------- vehicles
  R.attachTraffic = (traffic) => {
    const C = new Map();   // actor id -> car
    const slotCar = new Map();   // `${kind}:${idx}` -> car
    for (const P of Object.values(traffic.pools || {})) {
      const n = P.cap;
      P.r1d = { on: new Uint8Array(n), seed: new Float32Array(n), spin: new Float32Array(n), steer: new Float32Array(n), lamps: new Uint8Array(n), bend: new Float32Array(n) };
    }
    const put = (P, idx, M) => { P.mb.setMatrixAt(idx, M); P.md.setMatrixAt(idx, M); for (const x of P.mx) x.setMatrixAt(idx, M); };
    const counts = (P) => { P.mb.count = P.md.count = P.n; for (const x of P.mx) x.count = P.n; };
    const add = (id, kind) => {
      const P = traffic.pools[kind], a = actors.get(id) || {};
      if (!P || P.n >= P.cap) { R.stats.poolFull++; return null; }
      const car = { replay: id, kind, idx: P.n++, color: a.color ?? 0xffffff, v: 0, e: { cars: new Set() }, d: 0, dir: 1, lane: 0, __percUid: `core${id}` };
      c.set(car.color);
      P.mb.setColorAt(car.idx, c);
      P.mb.instanceColor.needsUpdate = true;
      counts(P);
      C.set(id, car); slotCar.set(`${kind}:${car.idx}`, car);
      traffic.cars.push(car);
      return car;
    };
    const drop = (id) => {
      const car = C.get(id), P = traffic.pools[car.kind], last = --P.n;
      slotCar.delete(`${car.kind}:${car.idx}`);
      if (car.idx !== last) {
        const mv = slotCar.get(`${car.kind}:${last}`);
        if (mv) {
          for (const x of [P.mb, P.md, ...P.mx]) x.instanceMatrix.array.copyWithin(car.idx * 16, last * 16, last * 16 + 16);
          c.set(mv.color); P.mb.setColorAt(car.idx, c); P.mb.instanceColor.needsUpdate = true;
          for (const k of ['on', 'seed', 'spin', 'steer', 'lamps', 'bend']) P.r1d[k][car.idx] = P.r1d[k][last];
          slotCar.delete(`${car.kind}:${last}`); mv.idx = car.idx; slotCar.set(`${car.kind}:${mv.idx}`, mv);
        }
      }
      P.r1d.on[last] = 0;
      m.makeScale(0, 0, 0); put(P, last, m);
      counts(P);
      C.delete(id);
      const i = traffic.cars.indexOf(car);
      if (i >= 0) traffic.cars.splice(i, 1);
    };
    // the parked vehicles of the take at the core's own poses; their storage colour from the page's record of the same kind
    // nearest each one in its tile (the records' colours are the tile's; a few of the core's parked poses sit centimetres
    // off the page's records, see docs/notes/arch-r1-d.md), placed once the tile is in
    const parkedTodo = [...(H.parked || [])];
    const placeParked = () => {
      if (!parkedTodo.length) return;
      for (let i = parkedTodo.length - 1; i >= 0; i--) {
        const p = parkedTodo[i], recs = traffic.parkedRecs && traffic.parkedRecs.get(p.tile);
        if (!recs) continue;
        const P = traffic.parked[p.kind];
        if (!P || P.n >= P.cap) continue;
        let rec = null, bd = 0.5;
        for (const r of recs) { if (r.kind !== p.kind) continue; const d = Math.hypot(r.x - p.x, r.z - p.z); if (d < bd) { bd = d; rec = r; } }
        parkedTodo.splice(i, 1);
        const idx = P.n++;
        m.compose(v.set(p.x, p.y, p.z), q.set(p.q[0], p.q[1], p.q[2], p.q[3]), one);
        put(P, idx, m);
        if (rec) { c.set(rec.color); R.stats.parkedOff = Math.max(R.stats.parkedOff || 0, +bd.toFixed(3)); if (bd > 0.05) R.stats.parkedOffN = (R.stats.parkedOffN || 0) + 1; }
        else { c.setRGB(p.col[0], p.col[1], p.col[2]); R.stats.parkedNoRecord = (R.stats.parkedNoRecord || 0) + 1; }
        P.mb.setColorAt(idx, c);
        P.mb.instanceColor.needsUpdate = true;
        counts(P);
        for (const x of [P.mb, P.md, ...P.mx]) x.instanceMatrix.needsUpdate = true;
        R.stats.parked++;
      }
      R.stats.parkedMissing = parkedTodo.length;
    };
    for (const P of Object.values(traffic.parked || {})) { P.n = 0; counts(P); }
    // (the parked vehicles not placed yet, with the nearest record of their tile and their pool's fill: a harness's check)
    R.parkedLeft = () => parkedTodo.map((p) => {
      const recs = (traffic.parkedRecs && traffic.parkedRecs.get(p.tile)) || [], P = traffic.parked[p.kind];
      let best = null;
      for (const r of recs) { const d = Math.hypot(r.x - p.x, r.z - p.z); if (!best || d < best.d) best = { d: +d.toFixed(3), kind: r.kind }; }
      return { id: p.id, kind: p.kind, tile: p.tile, recs: recs.length, nearest: best, pool: P ? [P.n, P.cap] : null };
    });
    traffic.update = (dtF) => {
      // the page's clock picks the take's frame; traffic.time (signals, crossings) is the same clock
      const t = ENV.time.value, f = frameAt(t);
      traffic.time = t;
      // (traffic.js update: the parked records of tiles that waited for the fleet's dimensions)
      if (traffic.vehDims && traffic._dimWait && traffic._dimWait.size) { const w = traffic._dimWait; traffic._dimWait = null; for (const [k, d] of w) if (traffic.parkedRecs.has(k)) traffic._parkTile(k, d); }
      placeParked();
      // the car list changed outside the replay (a harness's reset or clearing): start again from the take
      if (traffic.cars.length !== C.size || traffic.cars.some((x) => !x.replay || C.get(x.replay) !== x)) {
        for (const P of Object.values(traffic.pools)) { P.n = 0; counts(P); P.r1d.on.fill(0); }
        traffic.cars.length = 0; C.clear(); slotCar.clear();
        R.stats.resets = (R.stats.resets || 0) + 1;
      }
      const seen = new Set();
      for (const r of F[f].veh) {
        seen.add(r.id);
        const kind = kinds[r.kind];
        const car = C.get(r.id) || add(r.id, kind);
        if (!car) continue;
        const P = traffic.pools[kind], a = actors.get(r.id) || {};
        m.compose(v.set(r.x, r.y, r.z), q.set(r.q[0], r.q[1], r.q[2], r.q[3]), one);
        put(P, car.idx, m);
        e.setFromQuaternion(q, 'YXZ');
        car._pose = [r.x, r.y, r.z, e.y]; car._pitch = e.x; car._roll = e.z; car.v = r.v;
        car._brakeT = r.lamps & 4 ? 0.35 : 0;
        const D = P.r1d;
        D.on[car.idx] = 1; D.seed[car.idx] = a.seed ?? 0; D.spin[car.idx] = r.spin; D.steer[car.idx] = r.steer; D.lamps[car.idx] = r.lamps; D.bend[car.idx] = r.bend;
      }
      for (const id of [...C.keys()]) if (!seen.has(id)) drop(id);
      R.f = f; R.stats.vehicles = C.size;
      if (traffic.camera && traffic.lights) traffic.lights.update(traffic.cars, traffic.camera, dtF);
      for (const P of Object.values(traffic.pools)) { P.mb.instanceMatrix.needsUpdate = true; P.md.instanceMatrix.needsUpdate = true; for (const x of P.mx) x.instanceMatrix.needsUpdate = true; }
    };
    console.log(`[replay] traffic: ${H.actors.filter((x) => x.type === 'vehicle').length} vehicles and ${(H.parked || []).length} parked from the take; the traffic model does not step`);
  };

  // ---------------------------------------------------------------- walkers
  R.attachPeds = (peds) => {
    const rig = peds.rig, Wk = new Map();   // actor id -> ped
    const color = (a) => (a.col ? new THREE.Color(a.col[0], a.col[1], a.col[2]) : new THREE.Color(a.color ?? 0x2b3038));
    const add = (id, w) => {
      if (peds.peds.length >= peds.cap) return null;
      const a = actors.get(id) || {};
      const p = { replay: id, manual: true, idx: peds.peds.length, skin: a.variant ?? 0.5, phase: a.phase0 ?? 0, v: a.speed ?? 1.3, amp: w.amp, mask: a.outfit | 0,
        bagTone: a.bagTone || 0, umbTone: a.umbTone || 0, color: color(a), seat: w.pose > 0, pose: w.pose, __percUid: `core${id}` };
      peds.peds.push(p);
      peds.mesh.count = peds.peds.length;
      peds.mesh.setColorAt(p.idx, p.color);
      peds.mesh.instanceColor.needsUpdate = true;
      rig.setAnim(p.idx, p.phase, p.v * 4.4, w.amp, p.skin);
      rig.setStyle(p.idx, p.mask, p.bagTone, p.umbTone);
      Wk.set(id, p);
      return p;
    };
    // a walker that leaves: the last slot moves into its slot with its state (sim/peds.js _remove)
    const drop = (id) => {
      const p = Wk.get(id), i = peds.peds.indexOf(p), last = peds.peds.length - 1;
      if (i !== last) {
        const lp = peds.peds[last];
        lp.idx = p.idx; peds.peds[i] = lp;
        peds.mesh.instanceMatrix.array.copyWithin(lp.idx * 16, last * 16, last * 16 + 16);
        rig.moveSlot?.(last, lp.idx);
        peds.mesh.setColorAt(lp.idx, lp.color);
        peds.mesh.instanceColor.needsUpdate = true;
        rig.setAnim(lp.idx, lp.phase, lp.v * 4.4, lp.amp, lp.skin);
        rig.setStyle(lp.idx, lp.mask, lp.bagTone, lp.umbTone);
        rig.setPose?.(lp.idx, lp.pose || 0);
      }
      rig.setPose?.(last, 0);
      peds.peds.pop();
      peds.mesh.count = peds.peds.length;
      peds.mesh.setMatrixAt(peds.peds.length, m.makeScale(0, 0, 0));
      Wk.delete(id);
    };
    peds.update = (dtF) => {
      const f = frameAt(ENV.time.value);
      rig.timeRef.value += dtF;   // (peds.js: the shader walk cycle's clock)
      // the walker list changed outside the replay (the recorder's __PEDS_RESET before a take): start again from the take
      if (peds.peds.length !== Wk.size || peds.peds.some((p) => !p.replay || Wk.get(p.replay) !== p)) {
        while (peds.peds.length) peds._remove(peds.peds.length - 1);
        Wk.clear();
        R.stats.resets = (R.stats.resets || 0) + 1;
      }
      const seen = new Set();
      for (const w of F[f].walk) {
        seen.add(w.id);
        const p = Wk.get(w.id) || add(w.id, w);
        if (!p) continue;
        q.setFromEuler(e.set(0, w.yaw, 0));
        m.compose(v.set(w.x, w.y, w.z), q, s.set(w.sxz || 1, w.sy || 1, w.sxz || 1));
        peds.mesh.setMatrixAt(p.idx, m);
        p.amp = w.amp; p.pose = w.pose;
        rig.setAmp(p.idx, w.amp);
        rig.setPace?.(p.idx, w.pace || 1);
        rig.setPose?.(p.idx, w.pose || 0);
      }
      for (const id of [...Wk.keys()]) if (!seen.has(id)) drop(id);
      R.stats.walkers = Wk.size;
      peds.mesh.instanceMatrix.needsUpdate = true;
      rig.update?.(dtF);
    };
    console.log(`[replay] walkers: ${H.actors.filter((x) => x.type === 'walker').length} from the take; the walker model does not step`);
  };
  return R;
}
