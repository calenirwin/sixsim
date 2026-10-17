// PLAY MODE (CONTROL, docs/notes/ar34-control.md): walk and drive in the twin.
//
//   ?play=1 (or walk) starts on foot, ?play=drive in a car; ?car=<fleet24 kind> (default taxi2); ?pv=<n> the walker's body
//   keys: WASD walk / drive, mouse look (click the view to lock the pointer), wheel zoom, Shift run, Space hand brake,
//         F get in / out of the car, V camera (on foot: third / first person; in the car: chase / bonnet),
//         K record a take on / off (the take downloads as JSON and stays on window.__PLAY.lastTake), C back onto the street
//
// Two bodies, each a slot of the existing sims, so the city treats the player as one of its own:
//   WalkerBody: a crowd slot (sim/peds.js walker with `manual`: peds.js leaves it alone; it carries _x/_z/_vx/_vz so the
//               crowd's avoidance steers round it like round any walker); ground from the street sections; collides with
//               buildings (city/colliders.js), street furniture and parked cars (peds.js obstacle boxes) and moving cars.
//               Off the footway it is a crosser (traffic.js _crossers): cars stop for it.
//   CarBody:    a fleet24 slot (sim/traffic.js car with `api` + `manual`, snapped to the nearest lane every step, so AI cars
//               follow it as a leader and stand short of its body through OV32 / VN36). Arcade dynamics: throttle, brake,
//               a steering lock that falls with speed (the turn radius grows with speed), a lateral grip limit
//               (understeer), drag and rolling resistance. Collides with kerbs (only the carriageway is drivable),
//               buildings, furniture, parked and moving cars and walkers.
// Both take a control object: walker { dx, dz (three world direction), speed }, car { throttle, steer, brake, hand_brake,
// reverse } (CARLA's VehicleControl: steer +1 is full right). The keyboard, the autopilot (scripted runs) and the API
// (src/api/bridge.js, role_name 'hero') all drive them through it.
//
// TAKES: a run is recorded as per-frame transforms at 30 fps: cam [x, y, z, qx, qy, qz, qw, fovY] and body
// [x, y, z, heading, speed, flags] (three space; flags bit 0: body hidden, first person). tools/ad/record.mjs and the export's
// harvest.mjs install a take through PathCam (main.js), which replays the camera and puts the body back in the sims frame by
// frame (createReplay below), so every renderer gets the same run.
import * as THREE from 'three';
import { COLLIDERS } from '../city/colliders.js';

if (typeof window !== 'undefined') window.__THREE_PLAY = THREE;   // (probes: tools/play/play_run.mjs --probe)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const FOOT_R = 0.28;           // the walker's collision radius (m)
const WALK = 1.45, RUN = 2.55; // m/s: the crowd's walk clips play well up to ~2.6 m/s (crowd.js rate clamp 2.3x)

// ------------------------------------------------------------------ world probes
export function makeProbe({ streamer, traffic, peds }) {
  // the Central Park rectangle (main.js FlyCam CP32R): the park's relief is the terrain grid's, not a street section's
  const inPark = (x, z) => { const qx = x - 447.2, qz = z - 82.2; return Math.abs(qx * 0.4848 - qz * 0.8746) < 2084 && Math.abs(qx * 0.8746 + qz * 0.4848) < 451; };
  const P = {
    streamer, traffic, peds,
    ground(x, z, fb = null) {
      const s = streamer.surfaceAt ? streamer.surfaceAt(x, z) : null;
      const t = streamer.terrainAt(x, z);
      if (inPark(x, z) && t !== null && isFinite(t)) {
        // the park's paving and terraces (cp32b) are collider prisms laid over the sections and the relief (Bethesda's
        // lower terrace: paving -2.96, section -3.50): a prism top at most 0.75 m over either is the ground
        for (const b of [s, t]) {
          if (b === null || !isFinite(b)) continue;
          const w = COLLIDERS.resolve({ x, y: b + 0.7, z }, 0.02, 0.1);
          if (w.ground !== null && w.ground > b - 0.05 && w.ground < b + 0.75) return w.ground;
        }
        return s !== null && isFinite(s) && Math.abs(s - t) < 0.6 ? Math.max(s, t) : t;
      }
      if (s !== null && isFinite(s)) return s;
      if (t !== null && isFinite(t)) return Math.max(t, 0.3) + 0.15;
      return fb;
    },
    info(x, z, tol = 0.05) { return streamer.surfaceInfoAt ? streamer.surfaceInfoAt(x, z, tol) : null; },
    loaded(x, z) { return streamer.terrainAt(x, z) !== null; },
    wall(x, y, z, r, h = 1.7) { return COLLIDERS.resolve({ x, y, z }, r, h); },
    // low barriers a walker does not cross (city/colliders.js addBarrier: tree guards, the Mall's hoop fence)
    barrier(x, z, r) { return COLLIDERS.barrierAt(x, z, r); },
    // street furniture and parked cars (peds.js oriented boxes, built round the streaming centre)
    furniture(x, y, z, r) { return !!(peds && peds._clearAt && !peds._clearAt(x, z, y, r, false)); },
    // a moving car's body at (x, z) within r (skip: the caller's own car)
    carAt(x, z, r, skip = null) {
      if (!traffic || !traffic._ovNear) return null;
      for (const oc of traffic._ovNear(x, z, r + 8)) {
        if (oc === skip || !oc._pose) continue;
        const q = oc._pose, h = traffic.carHalf(oc), s = Math.sin(q[3]), c = Math.cos(q[3]);
        const dx = x - q[0], dz = z - q[2], a = dx * s + dz * c, b = dx * c - dz * s;
        if (Math.abs(a) < h[1] + r && Math.abs(b) < h[0] + r) return oc;
      }
      return null;
    },
    inPark,
  };
  return P;
}

// ------------------------------------------------------------------ sim slots
// a crowd walker for the player (bridge.js spawnWalker without the API bookkeeping)
export function pedSlot(peds, o = {}) {
  const rig = peds && peds.rig;
  if (!rig || peds.peds.length >= peds.cap) return null;
  const pool = rig.pool || [];
  const k = o.k ?? 11;
  const skin = pool.length ? ((((k % pool.length) + pool.length) % pool.length) + 0.5) / pool.length : 0.37;
  const ped = {
    manual: true, api: o.api || 'player', player: true, e: null, d: 0, dir: 1, v: WALK, lat: 0, phase: 0.25,
    idx: peds.peds.length, skin, build: 1, amp: 1, mask: o.mask ?? 0, bagTone: 0.4, umbTone: 0.5, __percUid: o.uid || 'player',
  };
  peds.peds.push(ped);
  const col = new THREE.Color(o.color ?? 0x2b3038);
  peds.mesh.setColorAt(ped.idx, col);
  ped.color = col.clone();
  peds.mesh.instanceColor.needsUpdate = true;
  rig.setAnim(ped.idx, ped.phase, WALK * 4.4, 1, skin);
  rig.setStyle(ped.idx, ped.mask, ped.bagTone, ped.umbTone);
  rig.setPose?.(ped.idx, 0);
  peds.mesh.count = peds.peds.length;
  return ped;
}
// a fleet24 car for the player (bridge.js spawnVehicle without the API bookkeeping)
export function carSlot(traffic, kind, color) {
  const pool = traffic && traffic.pools && traffic.pools[kind];
  if (!pool || pool.n >= pool.cap) return null;
  const car = { api: 'player', manual: true, player: true, kind, color, idx: pool.n++, v: 0, e: { cars: new Set() }, d: 0, dir: 1, lane: 0, laneF: 0, _lfv: 0, __percUid: 'player' };
  traffic._c.set(color);
  pool.mb.setColorAt(car.idx, traffic._c);
  pool.mb.instanceColor.needsUpdate = true;
  pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
  for (const m of pool.mx) m.count = pool.mb.count;
  traffic.cars.push(car);
  return car;
}
export const PLAYER_KINDS = ['taxi2', 'model3', 'suv', 'charger', 'lincoln', 'mercedes', 'mini', 'impala', 'taxi', 'van', 'police', 'nypd'];
export function pickKind(traffic, want) {
  const P = (traffic && traffic.pools) || {};
  if (want && P[want]) return want;
  return PLAYER_KINDS.find((k) => P[k]) || Object.keys(P)[0] || null;
}
const paintOf = (kind) => (/taxi/.test(kind) ? 0xf7b500 : /police|nypd/.test(kind) ? 0xf2f2f2 : 0x1e2a3a);

// the nearest lane edge (bridge.js nearestEdge / snapCarToLane): the car joins that lane's set so AI cars follow it
function nearestEdge(traffic, x, z, maxDist = 12, ux = 0, uz = 0) {
  let best = null, bd = maxDist * maxDist;
  for (const e of traffic.edges.values()) {
    if (e.minor) continue;
    const P = e.pts;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1][0], az = P[i - 1][2], bx = P[i][0], bz = P[i][2];
      if ((x < Math.min(ax, bx) - maxDist) || (x > Math.max(ax, bx) + maxDist) || (z < Math.min(az, bz) - maxDist) || (z > Math.max(az, bz) + maxDist)) continue;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      if ((ux || uz) && Math.abs(dx * ux + dz * uz) < 0.85 * Math.sqrt(L2)) continue;   // (laneRoute) only edges along the run
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const qx = ax + dx * t, qz = az + dz * t, d2 = (x - qx) ** 2 + (z - qz) ** 2;
      if (d2 < bd) { bd = d2; best = { e, d: e.cum[i - 1] + Math.sqrt(L2) * t, dist: Math.sqrt(d2) }; }
    }
  }
  return best;
}
export function snapToLane(traffic, car, x, z, h, maxDist = 8) {
  const ne = nearestEdge(traffic, x, z, maxDist);
  if (!ne) return false;
  const e = ne.e, s = traffic.sampleEdge(e, ne.d);
  const dir = (Math.sin(h) * s.dirx + Math.cos(h) * s.dirz) >= 0 ? 1 : -1;
  const hx = s.dirx * dir, hz = s.dirz * dir, lat = -(x - s.x) * hz + (z - s.z) * hx;
  const nl = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
  let lane = 0, bl = 1e9;
  for (let k = 0; k < nl; k++) { const o = traffic._laneOffsetAt(e, { dir }, k); if (Math.abs(o - lat) < bl) { bl = Math.abs(o - lat); lane = k; } }
  if (car.e && car.e !== e && car.e.cars) car.e.cars.delete(car);
  car.e = e; car.d = ne.d; car.dir = dir; car.lane = lane; car.laneF = lane;
  e.cars.add(car);
  return true;
}
// a lane pose near (x, z): where a car can start { x, z, h }
export function lanePoseNear(traffic, x, z, maxDist = 60, h = null) {
  // facing a way: the nearest edge along it (|cos| > 0.85; at a junction the cross street is nearer), else the nearest
  const ne = (h !== null && nearestEdge(traffic, x, z, maxDist, Math.sin(h), Math.cos(h))) || nearestEdge(traffic, x, z, maxDist);
  if (!ne) return null;
  const e = ne.e;
  // a two-way street: the direction the caller faces (a car from F points where the player looks)
  let dir = e.oneway !== 0 ? e.oneway : 1;
  if (e.oneway === 0 && h !== null) { const sm = traffic.sampleEdge(e, ne.d); dir = Math.sin(h) * sm.dirx + Math.cos(h) * sm.dirz >= 0 ? 1 : -1; }
  const d = clamp(ne.d, 2, e.len - 2);
  const a = traffic.sampleEdge(e, d - 1.5), b = traffic.sampleEdge(e, d + 1.5), s = traffic.sampleEdge(e, d);
  let hx = (b.x - a.x) * dir, hz = (b.z - a.z) * dir;
  const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
  // the inner lane of a two-way street (clear of the parking and bus lanes along the kerb), the middle of a one-way's
  const nl = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
  const off = traffic._laneOffsetAt(e, { dir }, e.oneway !== 0 ? Math.floor((nl - 1) / 2) : 0);
  return { x: s.x - hz * off, z: s.z + hx * off, h: Math.atan2(hx, hz) };
}

// a rough polyline [[x, z], ...] (three) -> the same run on a lane's centre line, sampled every `step` m: each sample goes to
// the nearest lane edge, in the direction of travel, on lane `lane` counted from the kerb side (0) or 'inner'
export function laneRoute(traffic, pts, lane = 0, step = 4) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / step));
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      const ne = nearestEdge(traffic, x, z, 25, (bx - ax) / (L || 1), (bz - az) / (L || 1));
      if (!ne) { out.push([x, z]); continue; }
      const e = ne.e, sm = traffic.sampleEdge(e, ne.d);
      const dir = (bx - ax) * sm.dirx + (bz - az) * sm.dirz >= 0 ? 1 : -1;
      const nl = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
      const li = lane === 'inner' ? 0 : clamp(nl - 1 - lane, 0, nl - 1);
      const off = traffic._laneOffsetAt(e, { dir }, li);
      const hx = sm.dirx * dir, hz = sm.dirz * dir;
      out.push([sm.x - hz * off, sm.z + hx * off]);
    }
  }
  // a light smoothing (lane offsets jump where the lane count changes)
  const sm2 = out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    let sx = 0, sz = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(out.length - 1, i + 2); j++) { sx += out[j][0]; sz += out[j][1]; c++; }
    return [sx / c, sz / c];
  });
  return sm2;
}

// ghosts in the crowd's walker hash (sim/peds.js _wh, cells of 2 m): points between the third-person camera and the player
// that move with the player, so the crowd steers round the camera's line to the player (a walker overtaking the camera no
// longer walks into the frame between them) and nobody spawns there. Installed once per Peds; setGhosts(list) per frame.
const WH = 2;
export function setGhosts(peds, list) {
  if (!peds || !peds._hashWalkers) return;
  if (!peds._ghostHook) {
    const orig = peds._hashWalkers;
    peds._ghosts = [];
    peds._hashWalkers = function () {
      orig.call(this);
      const H = this._wh;
      if (!H) return;
      for (const g of this._ghosts) {
        const k = (Math.floor(g._x / WH) + 32768) * 65536 + (Math.floor(g._z / WH) + 32768);
        let L = H.get(k);
        if (!L) H.set(k, (L = []));
        L.push(g);
      }
    };
    peds._ghostHook = true;
  }
  peds._ghosts = list || [];
}
// the ghosts for a walker body and the camera: at the camera and at 25, 50 and 75 % of the horizontal line to the body
export function lensGhosts(cam, b) {
  const dx = b.x - cam.x, dz = b.z - cam.z, L = Math.hypot(dx, dz);
  if (L < 1.2 || L > 9) return [];
  // (0: the lens itself, passed with a stranger's shoulder room)
  return [0, 0.25, 0.5, 0.75].map((f, i) => ({ _x: cam.x + dx * f, _y: b.y, _z: cam.z + dz * f, _vx: b.vx || 0, _vz: b.vz || 0, yaw: b.h, idx: -1 - i, stand: 0, ghost: true }));
}

// ------------------------------------------------------------------ the walker
export class WalkerBody {
  constructor(P, o = {}) {
    this.P = P; this.o = o;
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.y = P.ground(this.x, this.z, o.y ?? 4) ?? 4; this.h = o.h ?? 0;
    this.vx = 0; this.vz = 0; this.v = 0;
    this.ped = o.ped || null;
    this.hidden = false;
    this.offFoot = false;
    this.hits = 0;
  }
  ensure() {
    const peds = this.P.peds;
    if (!peds) return null;
    if (this.ped && peds.peds[this.ped.idx] === this.ped) return this.ped;
    if (this.o.ped) return null;               // an API walker's slot is the bridge's to keep
    this.ped = pedSlot(peds, this.o);           // first time, or the crowd was reset (record.mjs __PEDS_RESET)
    if (this.ped && !this._counted) { peds.apiCount = (peds.apiCount || 0) + 1; this._counted = true; }
    return this.ped;
  }
  teleport(x, z, h = this.h) {
    this.x = x; this.z = z; this.h = h; this.vx = this.vz = this.v = 0;
    const g = this.P.ground(x, z, null);
    if (g !== null) this.y = g;
  }
  // blocked at (x, z)? null, or { push: [dx, dz] } for a building (slide out along it), or { solid: true }
  blockedAt(x, z) {
    const P = this.P;
    // walls: prisms rising more than 0.6 m over the feet (a lower one is a step the street sections already carry)
    const w = P.wall(x, this.y + 0.6, z, FOOT_R, 1.2);
    if (w.wall) return { push: [w.pushX, w.pushZ] };
    if (P.furniture(x, this.y, z, FOOT_R)) return { solid: true };
    if (P.barrier && !this._inBarrier && P.barrier(x, z, FOOT_R)) return { solid: true };   // (one standing in a barrier walks out)
    if (P.carAt(x, z, FOOT_R)) return { solid: true };
    const g = P.ground(x, z, null);
    if (g !== null && g - this.y > 0.45) return { solid: true };   // a plinth or a wall the collider set does not hold
    return null;
  }
  // c: { dx, dz, speed }: the direction in three's ground plane (normalised here) and the speed (m/s)
  step(c, dt) {
    if (!(dt > 0)) return;
    const dl = Math.hypot(c.dx || 0, c.dz || 0);
    const sp = dl > 1e-6 ? clamp(c.speed ?? WALK, 0, 3.2) : 0;
    const ux = dl > 1e-6 ? c.dx / dl : 0, uz = dl > 1e-6 ? c.dz / dl : 0;
    // accelerate toward the wanted velocity (a person needs ~0.4 s to reach walking pace and stops in ~0.25 s)
    const ax = ux * sp - this.vx, az = uz * sp - this.vz, al = Math.hypot(ax, az);
    const amax = (sp > 0.05 ? 4.5 : 7) * dt;
    if (al > amax) { this.vx += (ax / al) * amax; this.vz += (az / al) * amax; } else { this.vx += ax; this.vz += az; }
    // turn the body toward where it walks, at up to 420 deg/s
    if (sp > 0.05) {
      const want = Math.atan2(ux, uz), d = wrapPi(want - this.h), m = 7.3 * dt;
      this.h = wrapPi(this.h + (Math.abs(d) <= m ? d : Math.sign(d) * m));
    }
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    this._inBarrier = !!(this.P.barrier && this.P.barrier(this.x, this.z, FOOT_R));
    if (Math.abs(this.vx) + Math.abs(this.vz) > 1e-5) {
      let b = this.blockedAt(nx, nz);
      if (b && b.push) { nx += b.push[0]; nz += b.push[1]; b = this.blockedAt(nx, nz); }   // slide along a wall
      if (b) {
        // slide along furniture / a car: one axis at a time, else stand
        if (!this.blockedAt(nx, this.z)) { nz = this.z; this.vz *= 0.3; }
        else if (!this.blockedAt(this.x, nz)) { nx = this.x; this.vx *= 0.3; }
        else { nx = this.x; nz = this.z; this.vx = this.vz = 0; }
        this.hits++;
      }
    }
    // the velocity is what the body did (a push back off a wall leaves it standing, not walking on the spot)
    this.vx = (nx - this.x) / dt; this.vz = (nz - this.z) / dt;
    this.x = nx; this.z = nz;
    this.v = Math.hypot(this.vx, this.vz);
    const g = this.P.ground(this.x, this.z, null);
    if (g !== null) this.y = g > this.y ? g : this.y + (g - this.y) * Math.min(1, dt * 14);   // kerbs: up at once, down eased
    const si = this.P.info(this.x, this.z, 0.1);
    this.offFoot = !!(si && si.road);
  }
  // write the crowd slot: matrix, walk cycle speed, the avoidance fields; and stop the cars when on the carriageway
  place() {
    const p = this.ensure();
    if (!p) return;
    const peds = this.P.peds, rig = peds.rig;
    const m = WalkerBody._m || (WalkerBody._m = new THREE.Matrix4());
    const q = WalkerBody._q || (WalkerBody._q = new THREE.Quaternion());
    q.setFromAxisAngle(WalkerBody._up || (WalkerBody._up = new THREE.Vector3(0, 1, 0)), this.h);
    const s = this.hidden ? 0.0001 : 1;
    m.compose(new THREE.Vector3(this.x, this.y, this.z), q, new THREE.Vector3(s, s, s));
    peds.mesh.setMatrixAt(p.idx, m);
    peds.mesh.instanceMatrix.needsUpdate = true;
    p.yaw = this.h; p.v = Math.max(0.3, this.v);
    p._x = this.x; p._y = this.y; p._z = this.z; p._vx = this.vx; p._vz = this.vz;
    if (rig.st) rig.st.speed[p.idx] = Math.max(0.3, this.v);
    rig.setAmp(p.idx, this.v > 0.12 ? 1 : 0);
    const T = this.P.traffic;
    if (T && this.offFoot) (T._crossers || (T._crossers = [])).push(this.x, this.z);
  }
  release() {
    const peds = this.P.peds;
    if (this.ped && peds && peds.peds[this.ped.idx] === this.ped && !this.o.ped) {
      peds._remove(this.ped.idx);
      if (this._counted) { peds.apiCount = Math.max(0, (peds.apiCount || 0) - 1); this._counted = false; }
    }
    this.ped = null;
  }
  pose() { return [this.x, this.y, this.z, this.h, this.v, this.hidden ? 1 : 0]; }
}

// ------------------------------------------------------------------ the car
export class CarBody {
  constructor(P, o = {}) {
    this.P = P; this.o = o;
    this.kind = o.car ? o.car.kind : pickKind(P.traffic, o.kind);
    this.car = o.car || null;
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.h = o.h ?? 0;
    this.y = P.ground(this.x, this.z, o.y ?? 4) ?? 4;
    this.v = 0; this.steer = 0; this.yawRate = 0; this.hits = 0; this.lastHit = null;
    const hh = P.traffic && this.kind ? P.traffic.carHalf({ kind: this.kind }) : [0.95, 2.4];
    this.hw = hh[0]; this.hl = hh[1];
    this.wb = Math.max(2.3, this.hl * 2 * 0.58);   // wheelbase
    const vd = P.traffic && P.traffic.vehDims && P.traffic.vehDims[this.kind];
    this.ht = vd ? vd[1] : (/van|truck|bus/.test(this.kind || '') ? 2.4 : /suv|nypd/.test(this.kind || '') ? 1.75 : 1.47);
  }
  ensure() {
    const T = this.P.traffic;
    if (!T || !this.kind) return null;
    if (this.car && T.cars.includes(this.car)) return this.car;
    if (this.o.car) return null;
    this.car = carSlot(T, this.kind, this.o.color ?? paintOf(this.kind));
    if (this.car && !this._counted) { T.apiCount = (T.apiCount || 0) + 1; this._counted = true; }
    return this.car;
  }
  teleport(x, z, h = this.h) {
    this.x = x; this.z = z; this.h = h; this.v = 0; this.steer = 0; this.yawRate = 0;
    const g = this.P.ground(x, z, null);
    if (g !== null) this.y = g;
  }
  // what the footprint at (x, z, h) runs into: null, or 'kerb' | 'wall' | 'furniture' | 'car' | 'walker'
  blockedAt(x, z, h) {
    const P = this.P, s = Math.sin(h), c = Math.cos(h);
    const hl = this.hl, hw = this.hw;
    // kerbs: the corners (inset) and the bumpers' and sides' middles must be on the carriageway (asphalt, gutter, bus lane)
    const pts = [[hl - 0.15, hw - 0.12], [hl - 0.15, -hw + 0.12], [-hl + 0.15, hw - 0.12], [-hl + 0.15, -hw + 0.12], [hl - 0.05, 0], [-hl + 0.05, 0], [0, hw - 0.1], [0, -hw + 0.1]];
    for (const [a, b] of pts) {
      const px = x + s * a + c * b, pz = z + c * a - s * b;
      const si = P.info(px, pz, 0.02);
      if (si && !si.road) return 'kerb';
    }
    // buildings and furniture round the body's outline (every ~0.6 m)
    const ny = Math.max(2, Math.round(hl / 0.6)), nx = Math.max(1, Math.round(hw / 0.6));
    const out = [];
    for (let i = -ny; i <= ny; i++) { const a = (i / ny) * hl; out.push([a, hw], [a, -hw]); }
    for (let j = -nx + 1; j < nx; j++) { const b = (j / nx) * hw; out.push([hl, b], [-hl, b]); }
    for (const [a, b] of out) {
      const px = x + s * a + c * b, pz = z + c * a - s * b;
      if (P.wall(px, this.y + 0.25, pz, 0.12, 1.2).wall) return 'wall';
      if (P.furniture(px, this.y, pz, 0.12)) return 'furniture';
    }
    // moving cars (traffic.js OV32 box test) and walkers
    const T = P.traffic;
    if (T && T._ovNear && T._ovHit) {
      for (const oc of T._ovNear(x, z, hl + 8)) if (oc !== this.car && oc._pose && T._ovHit(x, z, h, hw, hl, oc)) return 'car';
    }
    const peds = P.peds;
    if (peds) for (const w of peds.peds) {
      if (w._x === undefined || w.player || w.seat) continue;
      const dx = w._x - x, dz = w._z - z;
      if (dx * dx + dz * dz > (hl + 1) ** 2 || Math.abs((w._y ?? this.y) - this.y) > 1.5) continue;
      const a = dx * s + dz * c, b = dx * c - dz * s;
      if (Math.abs(a) < hl + 0.25 && Math.abs(b) < hw + 0.25) return 'walker';
    }
    return null;
  }
  // c: CARLA VehicleControl { throttle 0..1, steer -1..1 (+ right), brake 0..1, hand_brake, reverse }
  step(c, dt) {
    if (!(dt > 0)) return;
    const thr = clamp(+c.throttle || 0, 0, 1), brk = clamp(+c.brake || 0, 0, 1), st = clamp(+c.steer || 0, -1, 1);
    const hb = !!c.hand_brake, gear = c.reverse ? -1 : 1;
    let v = this.v;
    // drive: a broad torque curve tailing off toward the top speed (33 m/s forward, 7 reverse)
    const vmax = gear > 0 ? 33 : 7;
    let acc = 0;
    if (v * gear >= -0.3) acc = gear * thr * 4.3 * (1 - Math.min(1, Math.abs(v) / vmax) ** 1.6);
    // brakes (and throttle against the direction of travel brakes too), rolling resistance, drag
    let dec = brk * 9.0 + (hb ? 7.5 : 0) + 0.16 + 0.00042 * v * v;
    if (v * gear < -0.3) dec += thr * 8;
    v += acc * dt;
    const sv = Math.sign(v), dv = dec * dt;
    v = Math.abs(v) <= dv ? (Math.abs(acc) > dec ? v : 0) : v - sv * dv;
    this.v = v;
    // steering: the lock falls with speed (34 deg standing, ~5 deg at 30 m/s), the wheel turns at most 2.8 rad/s
    const lock = (34 - 29 * smooth01(Math.abs(v) / 28)) * (Math.PI / 180);
    const want = -st * lock;          // positive = left in three (heading grows anticlockwise from above)
    const ds = want - this.steer, mr = 2.8 * dt;
    this.steer += Math.abs(ds) <= mr ? ds : Math.sign(ds) * mr;
    // yaw from the bicycle model, capped by the tyres' grip (8.5 m/s2; the hand brake lets the rear go: more yaw, less grip)
    let w = (v / this.wb) * Math.tan(this.steer);
    const grip = hb && Math.abs(v) > 4 ? 6.5 : 8.5;
    const wmax = grip / Math.max(1, Math.abs(v));
    if (hb && Math.abs(v) > 4) w *= 1.35;
    w = clamp(w, -wmax * (hb ? 1.5 : 1), wmax * (hb ? 1.5 : 1));
    this.yawRate = w;
    const nh = wrapPi(this.h + w * dt);
    const nx = this.x + Math.sin(nh) * v * dt, nz = this.z + Math.cos(nh) * v * dt;
    if (Math.abs(v) > 1e-4 || Math.abs(w) > 1e-5) {
      const hit = this.blockedAt(nx, nz, nh);
      if (hit && !this.blockedAt(this.x, this.z, this.h)) {
        // a hit: turn in place if that is free (scrape along), bounce back a little, stop when slow
        if (!this.blockedAt(this.x, this.z, nh)) this.h = nh;
        this.v = Math.abs(v) > 2.5 ? -0.25 * v : 0;
        this.hits++; this.lastHit = hit;
      } else { this.x = nx; this.z = nz; this.h = nh; }
    }
    const g = this.P.ground(this.x, this.z, null);
    if (g !== null) this.y += (g - this.y) * Math.min(1, dt * 12);
  }
  place(dt) {
    const car = this.ensure();
    if (!car) return;
    const T = this.P.traffic;
    car.v = Math.abs(this.v);
    T._placeCar(car, this.x, this.y + 0.002, this.z, this.h, Math.max(dt, 1e-3));
    if (dt > 0) snapToLane(T, car, this.x, this.z, this.h, 8);
  }
  release() {
    const T = this.P.traffic;
    if (this.car && T && !this.o.car) {
      const i = T.cars.indexOf(this.car);
      if (i >= 0) T._remove(i);
      if (this._counted) { T.apiCount = Math.max(0, (T.apiCount || 0) - 1); this._counted = false; }
    }
    this.car = null;
  }
  pose() { return [this.x, this.y, this.z, this.h, this.v, this.steer]; }
}

// ------------------------------------------------------------------ cameras
// mode: 'third' | 'first' (walker), 'chase' | 'bonnet' (car). Writes engine.camera; state persists between frames.
export class FollowCam {
  constructor(engine, P) {
    this.engine = engine; this.P = P;
    this.yaw = 0; this.pitch = -0.12; this.boom = 3.3; this.mode = 'third';
    this.head = null; this.orbit = 0; this.orbitT = 0; this.auto = true; this.idleT = 9;
    this.fov0 = engine.camera.fov; this.pos = new THREE.Vector3();
    this.lag = new THREE.Vector3();
  }
  look(dx, dy) {   // mouse
    if (this.mode === 'chase') { this.orbit = wrapPi(this.orbit - dx * 0.0025); this.orbitT = 0; }
    else this.yaw = wrapPi(this.yaw - dx * 0.0022);
    this.pitch = clamp(this.pitch - dy * 0.0022, -1.2, 0.9);
    this.idleT = 0;
  }
  _apply(pos, yaw, pitch, roll = 0, fov = null) {
    const cam = this.engine.camera;
    cam.position.copy(pos);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(yaw); cam.rotateX(pitch);
    if (roll) cam.rotateZ(roll);
    const f = fov ?? this.fov0;
    if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.pos.copy(pos);
  }
  // pull the camera in front of a building between the target and it
  _clear(target, pos) {
    const d = new THREE.Vector3().subVectors(pos, target);
    const L = d.length();
    if (L < 0.3) return pos;
    d.divideScalar(L);
    const hit = COLLIDERS.raycast(target, d, L);
    if (hit && hit.dist < L) pos.copy(target).addScaledVector(d, Math.max(0.5, hit.dist - 0.3));
    const g = this.P.ground(pos.x, pos.z, null);
    if (g !== null && pos.y < g + 0.35) pos.y = g + 0.35;
    return pos;
  }
  walker(b, dt) {
    const portrait = this.engine.camera.aspect < 1;
    this.idleT += dt;
    // the follow: with the mouse idle for 1.5 s (always, in a scripted run) the camera swings in behind a walking player
    if ((this.auto || (this.idleT > 1.5 && Math.abs(wrapPi(b.h + Math.PI - this.yaw)) < 1.0)) && b.v > 0.3 && this.mode === 'third') {
      const k = 1 - Math.exp(-dt / 0.9);
      this.yaw = wrapPi(this.yaw + wrapPi(b.h + Math.PI - this.yaw) * k);
      this.pitch += ((portrait ? 0.0 : -0.1) - this.pitch) * k * 0.5;   // portrait: level, the city's height in frame
    }
    if (this.mode === 'first') {
      b.hidden = true;
      const pos = new THREE.Vector3(b.x - Math.sin(this.yaw) * 0.12, b.y + 1.63, b.z - Math.cos(this.yaw) * 0.12);
      this._apply(pos, this.yaw, this.pitch, 0, portrait ? 74 : this.fov0);
      return;
    }
    b.hidden = false;
    const target = new THREE.Vector3(b.x, b.y + (portrait ? 1.4 : 1.55), b.z);
    const cp = Math.cos(this.pitch), boom = this.boom * (portrait ? 1.3 : 1);
    const f = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    // a little over the right shoulder in landscape; centred in portrait
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(portrait ? 0 : 0.35);
    const pos = target.clone().addScaledVector(f, -boom).add(r);
    this._clear(target, pos);
    this._apply(pos, this.yaw, this.pitch, 0, portrait ? 70 : this.fov0);
  }
  car(b, dt) {
    const portrait = this.engine.camera.aspect < 1;
    this.idleT += dt;
    if (this.head === null) this.head = b.h;
    // the chase camera's heading lags the car's (critically damped, ~0.35 s), so a turn opens the car's flank
    const k = 1 - Math.exp(-dt / 0.35);
    this.head = wrapPi(this.head + wrapPi(b.h - this.head) * k);
    this.orbitT += dt;
    if (this.orbitT > 1.2) this.orbit *= Math.exp(-dt * 2.5);
    if (this.mode === 'bonnet') {
      const car = b.car, pitch = car ? (car._pitch || 0) : 0, roll = car ? (car._roll || 0) : 0;
      const fx = Math.sin(b.h), fz = Math.cos(b.h);
      const pos = new THREE.Vector3(b.x + fx * b.hl * 0.42, b.y + b.ht + 0.08, b.z + fz * b.hl * 0.42);
      this._apply(pos, b.h + Math.PI, -0.035 - pitch, -roll, portrait ? 72 : this.fov0 + 4);
      return;
    }
    const hd = this.head + this.orbit;
    const D = b.hl + (portrait ? 6.6 : 5.4), H = b.ht + (portrait ? 1.55 : 1.05);
    const fx = Math.sin(hd), fz = Math.cos(hd);
    const target = new THREE.Vector3(b.x + Math.sin(b.h) * 2.5, b.y + b.ht * 0.75, b.z + Math.cos(b.h) * 2.5);
    const pos = new THREE.Vector3(b.x - fx * D, b.y + H, b.z - fz * D);
    this._clear(new THREE.Vector3(b.x, b.y + b.ht, b.z), pos);
    const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const fov = (portrait ? 64 : this.fov0) + clamp(Math.abs(b.v) * 0.3, 0, 8);
    this._apply(pos, yaw, pitch, 0, fov);
  }
}

// ------------------------------------------------------------------ autopilot (scripted runs; the shorts)
// route: { mode: 'walk' | 'drive', pts: [[x, z], ...] (three), speed (m/s), stopAtEnd }
export class Autopilot {
  constructor(route) { this.r = route; this.i = 1; this.done = false; this.t = 0; }
  _seg(px, pz) {   // advance along the polyline past points we are level with
    const P = this.r.pts;
    while (this.i < P.length - 1) {
      const a = P[this.i - 1], b = P[this.i];
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
      if (((px - a[0]) * dx + (pz - a[1]) * dz) / L2 < 1) break;
      this.i++;
    }
  }
  // the point `ahead` m further along the route from the projection of (px, pz)
  _ahead(px, pz, ahead) {
    const P = this.r.pts;
    const a = P[this.i - 1], b = P[this.i];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
    let t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / (L * L), 0, 1);
    let rem = ahead, j = this.i, cx = a[0] + dx * t, cz = a[1] + dz * t;
    let segLeft = L * (1 - t);
    while (rem > segLeft && j < P.length - 1) { rem -= segLeft; cx = P[j][0]; cz = P[j][1]; j++; segLeft = Math.hypot(P[j][0] - cx, P[j][1] - cz); }
    const ex = P[j][0] - cx, ez = P[j][1] - cz, el = Math.hypot(ex, ez) || 1e-9, u = Math.min(rem, el) / el;
    return [cx + ex * u, cz + ez * u, j];
  }
  _left(px, pz) {   // metres of route left
    const P = this.r.pts;
    let s = Math.hypot(P[this.i][0] - px, P[this.i][1] - pz);
    for (let j = this.i + 1; j < P.length; j++) s += Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]);
    return s;
  }
  walk(b, dt) {
    this.t += dt;
    this._seg(b.x, b.z);
    const left = this._left(b.x, b.z);
    if (left < 0.4) { this.done = true; return { dx: 0, dz: 0, speed: 0 }; }
    const [tx, tz] = this._ahead(b.x, b.z, 1.6);
    const sp = (this.r.speed || WALK) * Math.min(1, this.t / 0.6) * (this.r.stopAtEnd === false ? 1 : Math.min(1, left / 1.2 + 0.25));
    return { dx: tx - b.x, dz: tz - b.z, speed: sp };
  }
  drive(b, dt, P) {
    this.t += dt;
    // pinned against something (a kerb corner, a car that stopped across the lane): back off for a second, wheel opposite
    if (b.hits !== this._h0) { this._h0 = b.hits; this._pin = (this._pin || 0) + 1; } else this._pin = Math.max(0, (this._pin || 0) - 0.25);
    if (this._pin > 12 && !(this._back > 0) && /kerb|wall|furniture/.test(b.lastHit || '')) { this._back = 1.0; this._pin = 0; }
    if (this._back > 0) { this._back -= dt; return { throttle: 0.5, brake: 0, steer: -(this._st0 || 0), hand_brake: false, reverse: true }; }
    this._seg(b.x, b.z);
    const v = Math.abs(b.v), left = this._left(b.x, b.z);
    if (left < 1.5 && v < 0.3) this.done = true;
    // pure pursuit on a look-ahead point that grows with speed
    const Ld = 5.5 + 0.55 * v;
    const [tx, tz] = this._ahead(b.x, b.z, Ld);
    const dx = tx - b.x, dz = tz - b.z;
    const alpha = wrapPi(Math.atan2(dx, dz) - b.h);
    const k = (2 * Math.sin(alpha)) / Math.max(1, Math.hypot(dx, dz));
    const delta = Math.atan(k * b.wb);   // left positive
    const lock = (34 - 29 * smooth01(v / 28)) * (Math.PI / 180);
    const steer = clamp(-delta / lock, -1, 1);
    this._st0 = steer;
    // speed: the route's, slower into bends (lateral 2.6 m/s2 on the curvature 15-25 m ahead), behind a car, at the end
    let vt = this.r.speed || 11;
    const [fx, fz] = this._ahead(b.x, b.z, 12 + v), [gx, gz] = this._ahead(b.x, b.z, 22 + v * 1.2);
    const turn = Math.abs(wrapPi(Math.atan2(gx - fx, gz - fz) - Math.atan2(fx - b.x, fz - b.z)));
    if (turn > 0.15) vt = Math.min(vt, Math.max(4, Math.sqrt(2.6 * 10 / Math.max(0.05, turn))));
    vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 2.2 * (left - 2))));
    // the body's own box swept along the route ahead (the same test as a collision, so an articulated bus's rear body or a
    // car cutting in counts): the first hit sets the gap
    if (P && P.traffic && P.traffic._ovNear && P.traffic._ovHit) {
      const T = P.traffic;
      for (const d of [1.2, 2.5, 4, 6, 8.5, 11.5, 15, 19.5, 25]) {
        const [ax, az] = this._ahead(b.x, b.z, d), [cx, cz] = this._ahead(b.x, b.z, d + 1);
        const hh = Math.atan2(cx - ax, cz - az);
        let hit = false;
        for (const oc of T._ovNear(ax, az, b.hl + 8)) if (oc !== b.car && oc._pose && T._ovHit(ax, az, hh, b.hw + 0.25, b.hl + 0.4, oc)) { hit = true; break; }
        if (!hit && P.peds) for (const w of P.peds.peds) {
          if (w._x === undefined || w.player || w.ghost) continue;
          const ox = w._x - ax, oz = w._z - az;
          if (ox * ox + oz * oz > (b.hl + 1.5) ** 2) continue;
          const sa = Math.sin(hh), ca = Math.cos(hh), u = ox * sa + oz * ca, v = ox * ca - oz * sa;
          if (Math.abs(u) < b.hl + 0.6 && Math.abs(v) < b.hw + 0.7) { hit = true; break; }
        }
        if (hit) { vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 3 * (d - 1.6)))); break; }
      }
    }
    // whatever is in the corridor ahead (any car, crossing or not, by its box's extent across my way; walkers): stop short
    if (P && P.traffic && P.traffic._ovNear) {
      const s = Math.sin(b.h), c = Math.cos(b.h);
      let gap = 1e9;
      for (const oc of P.traffic._ovNear(b.x + s * 16, b.z + c * 16, 22)) {
        if (oc === b.car || !oc._pose) continue;
        const q = oc._pose, ox = q[0] - b.x, oz = q[2] - b.z, a = ox * s + oz * c, lat = ox * c - oz * s;
        const hh = P.traffic.carHalf(oc), rel = q[3] - b.h, ca = Math.abs(Math.cos(rel)), sa = Math.abs(Math.sin(rel));
        const across = ca * hh[0] + sa * hh[1], along = ca * hh[1] + sa * hh[0];
        if (a > 0 && Math.abs(lat) < b.hw + across + 0.5) gap = Math.min(gap, a - b.hl - along);
      }
      if (P.peds) for (const w of P.peds.peds) {
        if (w._x === undefined || w.player) continue;
        const ox = w._x - b.x, oz = w._z - b.z;
        if (ox * ox + oz * oz > 900) continue;
        const a = ox * s + oz * c, lat = ox * c - oz * s;
        if (a > 0 && Math.abs(lat) < b.hw + 0.9) gap = Math.min(gap, a - b.hl - 0.6);
      }
      if (gap < 1e8) vt = Math.min(vt, Math.max(0, Math.sqrt(Math.max(0, 2 * 3 * (gap - 2.2)))));
    }
    if (this.r.stopAtEnd === false) vt = Math.max(vt, Math.min(this.r.speed || 11, 3));
    const e = vt - b.v;
    return { throttle: e > 0 ? clamp(e * 0.45, 0, 1) : 0, brake: e < -0.6 ? clamp(-e * 0.18, 0, 1) : 0, steer, hand_brake: false, reverse: false };
  }
}

// ------------------------------------------------------------------ take recorder
const r5 = (v) => Math.round(v * 1e5) / 1e5, r4 = (v) => Math.round(v * 1e4) / 1e4, r3 = (v) => Math.round(v * 1e3) / 1e3;
export class TakeRecorder {
  constructor(engine, meta = {}) { this.engine = engine; this.meta = meta; this.s = []; this.t = 0; this.fps = meta.fps || 30; }
  sample(dt, body) {
    const cam = this.engine.camera;
    this.t += dt;
    const q = cam.quaternion;
    this.s.push([this.t, cam.position.x, cam.position.y, cam.position.z, q.x, q.y, q.z, q.w, cam.fov, ...body.pose()]);
  }
  // resample to the take's fps (the sim may have run at any rate: real-time play) -> the take JSON
  finish(extra = {}) {
    const S = this.s, fps = this.fps;
    if (S.length < 2) return null;
    const t0 = S[0][0], T = S[S.length - 1][0] - t0, n = Math.max(1, Math.floor(T * fps + 1e-6) + 1);
    const cam = [], body = [];
    let j = 0;
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = t0 + i / fps;
      while (j < S.length - 2 && S[j + 1][0] < t) j++;
      const A = S[j], B = S[j + 1], u = clamp((t - A[0]) / Math.max(1e-9, B[0] - A[0]), 0, 1);
      const L = (k) => A[k] + (B[k] - A[k]) * u;
      qa.set(A[4], A[5], A[6], A[7]); qb.set(B[4], B[5], B[6], B[7]); qa.slerp(qb, u);
      cam.push([r4(L(1)), r4(L(2)), r4(L(3)), r5(qa.x), r5(qa.y), r5(qa.z), r5(qa.w), r3(L(8))]);
      const h = A[12] + wrapPi(B[12] - A[12]) * u;
      body.push([r4(L(9)), r4(L(10)), r4(L(11)), r5(wrapPi(h)), r3(L(13)), u < 0.5 ? A[14] : B[14]]);
    }
    return { version: 1, fps, frames: n, duration: +((n - 1) / fps).toFixed(3), aspect: +this.engine.camera.aspect.toFixed(4), ...this.meta, ...extra, cam, body };
  }
}

// ------------------------------------------------------------------ take replay (record mode: PathCam with takeData)
export function createReplay(ctx) {
  const P = makeProbe(ctx);
  let walker = null, car = null, take = null;
  // a drive take's future path: AI cars standing or driving on it (within 2.4 m of any of its points) are recycled during
  // the warm-up, and out of view during the take, so a replayed run never meets a car its authoring run did not meet
  let path = null, clearF = 0;
  const clearCorridor = (onlyUnseen) => {
    const T = P.traffic;
    if (!T || !path) return 0;
    let n = 0;
    for (let i = T.cars.length - 1; i >= 0; i--) {
      const c = T.cars[i], q = c._pose;
      if (c.api || !q) continue;
      let hit = false;
      for (let k = 0; k < path.length && !hit; k += 2) hit = (q[0] - path[k]) ** 2 + (q[2] - path[k + 1]) ** 2 < 5.8;
      if (!hit) continue;
      if (onlyUnseen && ctx.engine && ctx.engine.inView && ctx.engine.inView(q[0], q[1] + 0.8, q[2], 3)) continue;
      T._remove(i); n++;
    }
    return n;
  };
  const mk = (T) => {
    if (T.mode === 'drive') {
      if (!car || car.kind !== pickKind(P.traffic, T.kind)) { car?.release(); car = new CarBody(P, { kind: T.kind, color: T.color }); }
      walker?.release(); walker = null;
      return car;
    }
    if (!walker) walker = new WalkerBody(P, { k: T.pv ?? 11 });
    car?.release(); car = null;
    return walker;
  };
  return {
    P,
    start(T) {
      take = T; mk(T);
      path = null;
      if (T.mode === 'drive') { path = []; for (let i = 0; i < T.body.length; i += 3) path.push(T.body[i][0], T.body[i][2]); }
      return { mode: T.mode, frames: T.frames };
    },
    stop() { take = null; path = null; walker?.release(); car?.release(); walker = car = null; setGhosts(P.peds, []); if (P.peds) P.peds.pl42 = null; },
    cleared: 0,
    // put the body at frame f (fractional: interpolated) of the take
    place(f, dt, hold = false) {
      if (!take) return;
      const B = take.body, n = B.length;
      const i = clamp(Math.floor(f), 0, n - 1), j = Math.min(n - 1, i + 1), u = clamp(f - i, 0, 1);
      const a = B[i], b = B[j];
      const body = take.mode === 'drive' ? car : walker;
      if (!body) return;
      body.x = a[0] + (b[0] - a[0]) * u; body.y = a[1] + (b[1] - a[1]) * u; body.z = a[2] + (b[2] - a[2]) * u;
      body.h = a[3] + wrapPi(b[3] - a[3]) * u;
      const v = hold ? 0 : a[4] + (b[4] - a[4]) * u;   // held on frame 0 (the warm-up): a standing body
      if (take.mode === 'drive') {
        body.v = v; body.steer = a[5]; body.place(dt);
        if (dt > 0 && ++clearF % 10 === 0) this.cleared += clearCorridor(!hold);
      }
      else {
        body.v = Math.abs(v); body.vx = Math.sin(body.h) * body.v; body.vz = Math.cos(body.h) * body.v; body.hidden = !!(a[5] & 1);
        const si = P.info(body.x, body.z, 0.1); body.offFoot = !!(si && si.road);
        body.place(dt);
        const C = take.cam[i];
        setGhosts(P.peds, body.hidden ? [] : lensGhosts({ x: C[0], z: C[2] }, body));
        if (P.peds) P.peds.pl42 = body.hidden ? null : { lens: [C[0], C[1], C[2]], body: [body.x, body.y, body.z], f: i, hold: !!hold };   // PL42 (sim/peds.js)
      }
    },
    get take() { return take; },
    bodies: () => ({ walker, car }),
  };
}

// ------------------------------------------------------------------ the play controller (main.js ?play=1)
export class PlayController {
  constructor(ctx, o = {}) {
    this.ctx = ctx; this.engine = ctx.engine; this.flash = ctx.flash || (() => {});
    this.P = makeProbe(ctx);
    this.pos = new THREE.Vector3(o.x ?? 0, o.y ?? 60, o.z ?? 0);
    this.yaw = o.yaw ?? 0; this.pitch = -0.12;
    this.cam = new FollowCam(this.engine, this.P);
    this.cam.yaw = this.yaw; this.cam.auto = false;
    this.keys = {};
    this.mode = o.mode === 'drive' ? 'drive' : 'walk';
    this.walker = null; this.car = null;
    this.started = false; this.auto = null; this.rec = null; this.lastTake = null;
    this.kind = o.kind || null; this.pv = o.pv ?? 11;
    this.extControl = null;   // a scripted / API control object (overrides the keyboard while set)
    const el = this.engine.renderer.domElement;
    if (!o.headless) {
      addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
        if (e.repeat) return;
        if (e.code === 'KeyF') this.toggleCar();
        if (e.code === 'KeyV') this.toggleView();
        if (e.code === 'KeyK') this.toggleRecord();   // (R is the client's rain toggle)
        if (e.code === 'KeyC') this.unstick();
        if (e.code === 'Space') e.preventDefault();
      });
      addEventListener('keyup', (e) => (this.keys[e.code] = false));
      el.addEventListener('click', () => el.requestPointerLock?.());
      addEventListener('mousemove', (e) => { if (document.pointerLockElement) this.cam.look(e.movementX, e.movementY); });
      addEventListener('wheel', (e) => { this.cam.boom = clamp(this.cam.boom * (e.deltaY > 0 ? 1.1 : 0.9), 1.6, 9); }, { passive: true });
    }
  }
  get body() { return this.mode === 'drive' ? this.car : this.walker; }
  // the first frame with ground under the start: make the bodies
  _start() {
    const g = this.P.ground(this.pos.x, this.pos.z, null);
    if (g === null) return false;
    const T = this.P.traffic;
    if (this.mode === 'drive' && T && T.edges && T.edges.size > 10) {
      const lp = lanePoseNear(T, this.pos.x, this.pos.z, 80);
      if (!lp) return false;
      this.car = new CarBody(this.P, { kind: this.kind, x: lp.x, z: lp.z, h: lp.h });
      this.cam.mode = 'chase'; this.cam.head = lp.h;
    } else if (this.mode === 'drive') return false;
    else {
      this.walker = new WalkerBody(this.P, { x: this.pos.x, z: this.pos.z, h: this.yaw + Math.PI, k: this.pv });
      this.cam.mode = 'third';
    }
    this.started = true;
    this.flash(this.mode === 'drive' ? 'DRIVING: WASD, SPACE HAND BRAKE, V CAMERA, F GET OUT, K RECORD' : 'ON FOOT: WASD, SHIFT RUN, V CAMERA, F CAR, K RECORD');
    return true;
  }
  toggleView() {
    if (this.mode === 'drive') this.cam.mode = this.cam.mode === 'chase' ? 'bonnet' : 'chase';
    else this.cam.mode = this.cam.mode === 'third' ? 'first' : 'third';
    this.flash(this.cam.mode.toUpperCase() + ' CAMERA');
  }
  toggleCar() {
    if (!this.started) return;
    const T = this.P.traffic;
    if (this.mode === 'walk') {
      const w = this.walker;
      // the car the player left within 8 m, else a new one on the nearest lane
      if (this.car && Math.hypot(this.car.x - w.x, this.car.z - w.z) < 8) { /* get back in */ }
      else {
        this.car?.release();
        const lp = T ? lanePoseNear(T, w.x, w.z, 30, w.h) : null;
        if (!lp) { this.flash('NO LANE NEARBY'); return; }
        this.car = new CarBody(this.P, { kind: this.kind, x: lp.x, z: lp.z, h: lp.h });
      }
      w.release();
      this.mode = 'drive'; this.cam.mode = 'chase'; this.cam.head = this.car.h;
      this.pos.set(this.car.x, this.car.y, this.car.z);   // (else the next update reads the switch as a teleport)
      this.flash('DRIVING (F TO GET OUT)');
    } else {
      const c = this.car;
      if (Math.abs(c.v) > 2) { this.flash('STOP FIRST'); return; }
      // out on the kerb side (right), or the driver's side (left) if that is blocked
      const s = Math.sin(c.h), co = Math.cos(c.h);
      let x = c.x - co * (c.hw + 0.7), z = c.z + s * (c.hw + 0.7);
      this.walker = new WalkerBody(this.P, { x, z, h: c.h, k: this.pv });
      if (this.walker.blockedAt(x, z)) { x = c.x + co * (c.hw + 0.7); z = c.z - s * (c.hw + 0.7); this.walker.teleport(x, z, c.h); }
      c.v = 0;
      this.mode = 'walk'; this.cam.mode = 'third'; this.cam.yaw = c.h + Math.PI;
      this.pos.set(this.walker.x, this.walker.y, this.walker.z);
      this.flash('ON FOOT (F FOR THE CAR)');
    }
  }
  unstick() {
    const b = this.body;
    if (!b) return;
    if (this.mode === 'drive') { const lp = lanePoseNear(this.P.traffic, b.x, b.z, 80); if (lp) b.teleport(lp.x, lp.z, lp.h); }
    else {
      // the nearest point of the crowd's pavement graph within 60 m
      const pe = this.P.peds;
      let best = null, bd = 3600;
      for (const e of (pe && pe.walkEdges) || []) {
        if (e.dead || !e.pts) continue;
        for (const q of e.pts) { const d = (q[0] - b.x) ** 2 + (q[2] - b.z) ** 2; if (d < bd) { bd = d; best = q; } }
      }
      if (best) b.teleport(best[0], best[2], b.h);
    }
    this.flash('BACK ON THE STREET');
  }
  toggleRecord() {
    if (!this.rec) {
      this.rec = new TakeRecorder(this.engine, { mode: this.mode, kind: this.car ? this.car.kind : undefined, pv: this.pv, time: this.ctx.sky ? this.ctx.sky.mode : undefined });
      this.flash('RECORDING A TAKE (K TO STOP)');
      return null;
    }
    const take = this.rec.finish();
    this.rec = null;
    this.lastTake = take;
    if (take && !this.ctx.noDownload) {
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(take)], { type: 'application/json' }));
        a.download = `take_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
      } catch { /* no download in a harness */ }
    }
    this.flash(take ? `TAKE: ${take.frames} FRAMES` : 'TAKE TOO SHORT');
    return take;
  }
  // keyboard -> control objects
  _keysWalk() {
    const k = this.keys, y = this.cam.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y);
    let dx = 0, dz = 0;
    if (k.KeyW || k.ArrowUp) { dx += fx; dz += fz; }
    if (k.KeyS || k.ArrowDown) { dx -= fx; dz -= fz; }
    if (k.KeyD || k.ArrowRight) { dx += -fz; dz += fx; }
    if (k.KeyA || k.ArrowLeft) { dx -= -fz; dz -= fx; }
    return { dx, dz, speed: k.ShiftLeft || k.ShiftRight ? RUN : WALK };
  }
  _keysDrive() {
    const k = this.keys, c = this.car;
    const fwd = !!(k.KeyW || k.ArrowUp), back = !!(k.KeyS || k.ArrowDown);
    const st = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    this._st = (this._st || 0) + clamp(st - (this._st || 0), -0.08, 0.08);   // keys steer progressively
    // S brakes while rolling forward, then reverses
    if (back && !fwd && c.v < 0.5) this._rev = true;
    if (fwd) this._rev = false;
    const rev = !!this._rev;
    return {
      throttle: rev ? (back ? 0.7 : 0) : (fwd ? 1 : 0), brake: !rev && back ? 1 : 0, steer: this._st,
      hand_brake: !!k.Space, reverse: rev,
    };
  }
  update(dt) {
    if (!this.started && !this._start()) {
      // no ground yet: hover over the start so the tiles stream in
      this.engine.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
      return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    }
    let b = this.body;
    // a teleport through main.js (digit keys, the tour, deep links) moves the body
    if (Math.hypot(this.pos.x - b.x, this.pos.z - b.z) > 3) {
      if (this.mode === 'drive') { const lp = lanePoseNear(this.P.traffic, this.pos.x, this.pos.z, 80, b.h); if (lp) b.teleport(lp.x, lp.z, lp.h); else b.teleport(this.pos.x, this.pos.z); }
      else b.teleport(this.pos.x, this.pos.z);
    }
    let ctl = this.hold ? (this.mode === 'drive' ? { throttle: 0, brake: 1, steer: 0 } : { dx: 0, dz: 0, speed: 0 }) : this.extControl;
    if (!ctl && this.auto && !this.auto.done) ctl = this.mode === 'drive' ? this.auto.drive(b, dt, this.P) : this.auto.walk(b, dt);
    if (!ctl) ctl = this.mode === 'drive' ? this._keysDrive() : this._keysWalk();
    if (this.mode === 'drive') { b.step(ctl, dt); b.place(dt); this.walker = null; }
    else b.step(ctl, dt);
    this.cam.auto = !!this.auto || !!this.extControl;
    if (this.mode === 'drive') this.cam.car(b, dt); else this.cam.walker(b, dt);
    if (this.mode === 'walk') b.place(dt);
    setGhosts(this.P.peds, this.mode === 'walk' && this.cam.mode === 'third' ? lensGhosts(this.engine.camera.position, b) : []);
    if (this.P.peds) { const cp = this.engine.camera.position; this.P.peds.pl42 = this.mode === 'walk' ? { lens: [cp.x, cp.y, cp.z], body: [b.x, b.y, b.z] } : null; }   // PL42 (sim/peds.js)
    if (this.car && this.mode === 'walk') this.car.place(0);   // a parked player car stays drawn and in its lane
    if (this.rec && dt > 0) this.rec.sample(dt, b);
    this.pos.set(b.x, b.y, b.z);
    this.yaw = this.cam.yaw; this.pitch = this.cam.pitch;
    return { x: b.x, y: b.y + 1.6, z: b.z };
  }
  // a scripted run: { mode, pts: [[x, z]...] three coords, speed }
  setAuto(route) {
    if (route && route.mode === 'drive' && route.lane !== undefined && this.P.traffic) route = { ...route, pts: laneRoute(this.P.traffic, route.pts, route.lane) };
    this.auto = route ? new Autopilot(route) : null;
    // place: the body starts on the route's first point, facing along it
    const b = this.body;
    if (route && route.place && b && route.pts.length > 1) {
      const [a, c] = route.pts;
      b.teleport(a[0], a[1], Math.atan2(c[0] - a[0], c[1] - a[1]));
      if (this.mode === 'drive') { this.cam.head = b.h; b.place(1 / 30); }
      else { this.cam.yaw = b.h + Math.PI; b.place(0); }
      this.pos.set(b.x, b.y, b.z);
    }
    return route ? { pts: route.pts.length, first: route.pts[0], last: route.pts[route.pts.length - 1] } : null;
  }
  state() {
    const b = this.body;
    if (!b) return { started: false };
    return { started: true, mode: this.mode, cam: this.cam.mode, pose: b.pose().map((v) => +(+v).toFixed(3)), hits: b.hits, lastHit: b.lastHit || null, recording: !!this.rec, frames: this.rec ? this.rec.s.length : 0, autoDone: this.auto ? this.auto.done : null };
  }
  speedText() {
    const b = this.body;
    if (!b) return 'play: loading';
    const rec = this.rec ? ' · REC' : '';
    return this.mode === 'drive' ? `${b.kind} ${(Math.abs(b.v) * 3.6).toFixed(0)} km/h · ${this.cam.mode}${rec}` : `on foot ${b.v.toFixed(1)} m/s · ${this.cam.mode}${rec}`;
  }
}
