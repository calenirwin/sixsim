// DRONE (SPACE r2, docs/notes/space-r2.md): a hovering quadcopter flown in third person in the light showcase.
//
// The model is procedural: a lacquered graphite shell over the fuselage, a battery pack, four carbon arms in an X, motor
// bells, two-blade propellers under spinning motion discs, landing legs, a two-axis gimbal camera that stays level, and
// steady navigation lights (red port, green starboard, white tail). PBR materials, a few thousand triangles.
//
// Flight: the sticks set a wanted velocity in the camera's frame; the drone reaches it with a first-order lag (inertia)
// and slows down on its own when the sticks are let go (damping). It banks into its acceleration and its speed, bobs
// gently at the hover, and turns its nose after the camera. It collides with the building prisms (city/colliders.js),
// the ground (the street sections, the park's terraces and relief) and the water, stays under an altitude ceiling, and a
// caller's boundary pushes it back softly (bound(x, z) -> { nx, nz, over }: the inward direction and the metres outside).
//
// Camera: a chase camera on a smoothed pivot with mouse / stick orbit and wheel distance, pulled in front of buildings;
// V switches to the gimbal's own view (first person). update() returns the point the city streams around.
//
// No input listeners here: the caller passes an input snapshot to update() and calls look(), zoom(), toggleView().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLLIDERS } from '../city/colliders.js';
import { ENV } from '../world/materials.js';
import { cpWaterY } from '../city/cpLand.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// flight envelope
const V_MAX = 17;        // m/s horizontal
const V_UP = 6.5;        // m/s climb and descent
const K_ACC = 2.4;       // 1/s: the lag toward a wanted velocity (inertia)
const K_STOP = 1.5;      // 1/s: the decay with the sticks centred (damping)
const SCALE = 1.4;       // the model's scale: a 0.95 m cinema drone, which reads at a chase distance
const R_BODY = 0.7;      // m: the collision sphere (props included)
const LIFT = 0.27;       // the chase camera rides this much of its distance above the drone: the drone in the lower third
const CLEAR = 0.45;      // m: the lowest hover over the ground or the water
const CEILING = 150;     // m over the ground at the spawn point
const CELL = 28;         // COLLIDERS grid cell (city/colliders.js)

// ------------------------------------------------------------------ the model
// albedo trim: the city's sun and sky are hot by design (sim/traffic.js vhTrim, world/materials.js applyLightTrim)
function trim(mat, day = 0.86) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.dnNight = ENV.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float dnNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= mix(${day.toFixed(3)}, 1.0, dnNight);`);
  };
  mat.customProgramCacheKey = () => 'droneTrim' + day.toFixed(3);
  return mat;
}

// the motion disc's alpha: clear over the hub, a faint even veil, two soft blade smears and a denser tip ring
function discTexture() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), c = S / 2;
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - c) / c, dy = (y + 0.5 - c) / c, r = Math.hypot(dx, dy);
    let a = 0;
    if (r < 1) {
      const ang = Math.atan2(dy, dx);
      const hub = THREE.MathUtils.smoothstep(r, 0.16, 0.3);
      const edge = 1 - THREE.MathUtils.smoothstep(r, 0.9, 1.0);
      // two blades: a smear trailing each blade, densest along the blade and fading round the turn
      const ph = ((ang % Math.PI) + Math.PI) % Math.PI;          // 0..pi, two blades
      const smear = Math.exp(-ph * 2.6) + 0.35 * Math.exp(-(Math.PI - ph) * 9);
      const tip = Math.exp(-((r - 0.86) ** 2) / 0.004);
      a = hub * edge * (0.16 + 0.42 * smear * (0.4 + 0.6 * r) + 0.3 * tip);
    }
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.round(clamp(a, 0, 1) * 255);
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// a blade: a thin aerofoil-ish slab, tapered toward the tip and twisted (more pitch at the root)
function bladeGeometry(len = 0.13, root = 0.021, tip = 0.011, th = 0.0028) {
  const g = new THREE.BoxGeometry(len, th, 1, 10, 1, 1);
  g.translate(len / 2 + 0.012, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), t = clamp((x - 0.012) / len, 0, 1);
    const w = root + (tip - root) * t * t;
    let z = p.getZ(i) * w, y = p.getY(i);
    const tw = 0.32 - 0.22 * t;                     // twist (rad)
    const zz = z * Math.cos(tw) - y * Math.sin(tw), yy = z * Math.sin(tw) + y * Math.cos(tw);
    // a rounded tip
    const tr = t > 0.92 ? Math.sqrt(Math.max(0, 1 - ((t - 0.92) / 0.08) ** 2)) : 1;
    p.setXYZ(i, x, yy, zz * tr);
  }
  g.computeVertexNormals();
  return g;
}

export function buildDroneModel() {
  const M = {
    shell: trim(new THREE.MeshPhysicalMaterial({ color: 0x2c3036, roughness: 0.4, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.16 })),
    body: trim(new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.6, metalness: 0.12 })),
    pack: trim(new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.52, metalness: 0.05 })),
    grip: trim(new THREE.MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.45, metalness: 0.6 })),
    carbon: trim(new THREE.MeshPhysicalMaterial({ color: 0x16181b, roughness: 0.34, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.22 })),
    metal: trim(new THREE.MeshStandardMaterial({ color: 0xa4abb3, roughness: 0.3, metalness: 1.0 })),
    dark: trim(new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.42, metalness: 0.75 })),
    prop: trim(new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.48, metalness: 0.0 })),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06080c, roughness: 0.04, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.02 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.55, metalness: 0.0, alphaMap: discTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: 0x220404, roughness: 0.3, emissive: 0xff2a1f, emissiveIntensity: 3.2 }),
    green: new THREE.MeshStandardMaterial({ color: 0x032206, roughness: 0.3, emissive: 0x1fff5a, emissiveIntensity: 3.0 }),
    white: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, emissive: 0xfff4e6, emissiveIntensity: 2.6 }),
  };
  const root = new THREE.Group();
  root.name = 'drone';
  const frame = new THREE.Group();     // banks and bobs; root carries position and heading
  root.add(frame);
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = frame, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // fuselage (forward is -Z), the shell over it, the nose sensor window, the battery pack with its grip
  add(new RoundedBoxGeometry(0.2, 0.08, 0.34, 3, 0.03), M.body, 0, 0, 0);
  const shell = add(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.shell, 0, 0.022, -0.012);
  shell.scale.set(0.108, 0.05, 0.178);
  add(new RoundedBoxGeometry(0.11, 0.028, 0.02, 2, 0.008), M.glass, 0, 0.004, -0.168);
  add(new RoundedBoxGeometry(0.118, 0.038, 0.15, 2, 0.012), M.pack, 0, 0.066, 0.07);
  add(new RoundedBoxGeometry(0.06, 0.012, 0.03, 2, 0.005), M.grip, 0, 0.088, 0.13);
  // arms in an X out to the motors, motors (base, bell, hub), props and their motion discs, landing legs
  const MX = 0.245, MZ = 0.22, MY = 0.018;
  const props = [], discs = [];
  const bladeGeo = bladeGeometry(), discGeo = new THREE.CircleGeometry(0.138, 48).rotateX(-Math.PI / 2);
  const armGeo = new THREE.CylinderGeometry(0.011, 0.016, 1, 14);
  const motorGeo = new THREE.CylinderGeometry(0.03, 0.031, 0.034, 28), bellGeo = new THREE.CylinderGeometry(0.024, 0.029, 0.014, 28);
  const hubGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.016, 16), legGeo = new THREE.CylinderGeometry(0.0055, 0.0045, 1, 10);
  const footGeo = new THREE.SphereGeometry(0.011, 12, 8);
  for (const [sx, sz, k] of [[-1, -1, 0], [1, -1, 1], [-1, 1, 2], [1, 1, 3]]) {
    const mx = sx * MX, mz = sz * MZ;
    const ax = sx * 0.07, az = sz * 0.1;                 // the arm's root on the fuselage
    const len = Math.hypot(mx - ax, mz - az);
    const arm = add(armGeo, M.carbon, (mx + ax) / 2, MY - 0.004, (mz + az) / 2);
    arm.scale.set(1, len, 0.8);
    arm.rotation.set(Math.PI / 2, 0, 0);
    arm.rotation.order = 'YXZ';
    arm.rotation.y = Math.atan2(mx - ax, mz - az);
    add(motorGeo, M.dark, mx, MY + 0.012, mz);
    add(bellGeo, M.metal, mx, MY + 0.036, mz);
    add(hubGeo, M.dark, mx, MY + 0.051, mz);
    const spin = new THREE.Group();
    spin.position.set(mx, MY + 0.052, mz);
    frame.add(spin);
    for (const a of [0, Math.PI]) { const b = add(bladeGeo, M.prop, 0, 0, 0, spin); b.rotation.y = a; }
    spin.userData.dir = (k === 0 || k === 3) ? 1 : -1;  // diagonal pairs counter-rotate
    props.push(spin);
    const disc = add(discGeo, M.disc, mx, MY + 0.053, mz, frame, false);
    disc.renderOrder = 2;
    disc.userData.dir = spin.userData.dir;
    discs.push(disc);
    // landing legs under the motors, splayed a little outward
    const leg = add(legGeo, M.carbon, mx * 1.04, MY - 0.045, mz * 1.04);
    leg.scale.set(1, 0.085, 1);
    leg.rotation.z = sx * 0.12; leg.rotation.x = -sz * 0.12;
    add(footGeo, M.dark, mx * 1.08, MY - 0.088, mz * 1.08);
  }
  // navigation lights: steady, never blinking
  const navGeo = new THREE.SphereGeometry(0.0075, 12, 8);
  add(navGeo, M.red, -MX, MY + 0.0, -MZ - 0.03, frame, false);
  add(navGeo, M.green, MX, MY + 0.0, -MZ - 0.03, frame, false);
  add(navGeo, M.white, 0, 0.04, 0.175, frame, false);
  // the gimbal under the nose: a mount, a yaw arm, a yoke and the camera, held level and pitched by the view
  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.045, -0.115);
  frame.add(gimbal);
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 24), M.dark, 0, 0, 0, gimbal);
  add(new THREE.BoxGeometry(0.01, 0.03, 0.01), M.dark, 0.0, -0.018, 0.0, gimbal);
  const yoke = new THREE.Group();
  yoke.position.set(0, -0.042, 0);
  gimbal.add(yoke);
  add(new THREE.BoxGeometry(0.074, 0.008, 0.012), M.dark, 0, 0.012, 0, yoke);
  add(new THREE.BoxGeometry(0.007, 0.03, 0.022), M.dark, -0.034, 0, 0, yoke);
  add(new THREE.BoxGeometry(0.007, 0.03, 0.022), M.dark, 0.034, 0, 0, yoke);
  const cam = new THREE.Group();
  yoke.add(cam);
  add(new RoundedBoxGeometry(0.056, 0.044, 0.05, 2, 0.01), M.body, 0, 0, 0, cam);
  const lens = add(new THREE.CylinderGeometry(0.017, 0.019, 0.016, 28), M.metal, 0, 0, -0.03, cam);
  lens.rotation.x = Math.PI / 2;
  const glass = add(new THREE.CircleGeometry(0.0135, 28), M.glass, 0, 0, -0.0385, cam, false);
  glass.rotation.y = Math.PI;
  root.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
  frame.scale.setScalar(SCALE);
  root.visible = false;
  return { root, frame, props, discs, gimbal, yoke, cam, mats: M };
}

// ------------------------------------------------------------------ collisions
// the nearest point of a prism ring to (x, z): its distance and the unit vector from that point to (x, z)
function nearestEdge(x, z, pts, out) {
  let bd = 1e9, nx = 0, nz = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x1 = pts[i * 2], z1 = pts[i * 2 + 1], j = (i + 1) % n, x2 = pts[j * 2], z2 = pts[j * 2 + 1];
    const ex = x2 - x1, ez = z2 - z1, L2 = ex * ex + ez * ez || 1e-9;
    const t = clamp(((x - x1) * ex + (z - z1) * ez) / L2, 0, 1);
    const dx = x - (x1 + ex * t), dz = z - (z1 + ez * t), d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { const L = Math.sqrt(L2); nx = ez / L; nz = -ex / L; } }
  }
  out.d = bd; out.nx = nx; out.nz = nz;
  return out;
}
// push the sphere (p, r) out of every prism it overlaps; v loses its component into each surface. Returns the hits.
const _e = { d: 0, nx: 0, nz: 0 };
function collidePrisms(p, v, r, floorY) {
  let hits = 0;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const g = COLLIDERS.grid.get(`${cx + dx}_${cz + dz}`);
      if (!g) continue;
      for (const pr of g) {
        if (p.x < pr.minX - r || p.x > pr.maxX + r || p.z < pr.minZ - r || p.z > pr.maxZ + r) continue;
        if (p.y > pr.y1 + r || p.y < pr.y0 - r) continue;
        const inside = COLLIDERS._pointIn2D(p.x, p.z, pr.pts);
        nearestEdge(p.x, p.z, pr.pts, _e);
        if (!inside && _e.d >= r) continue;
        // the three ways out: over the roof, under a deck that clears the ground, or sideways past the nearest wall
        const up = pr.y1 + r - p.y;
        const down = pr.y0 > floorY + 2 * r + 0.5 ? p.y - (pr.y0 - r) : Infinity;
        let side;
        if (inside) side = _e.d + r;
        else if (p.y > pr.y1) {
          // beside the roof's edge, above it: out along the edge's corner
          const dy = p.y - pr.y1, d = Math.hypot(_e.d, dy);
          if (d >= r) continue;
          const k = (r - d) / Math.max(d, 1e-6);
          p.x += _e.nx * _e.d * k; p.z += _e.nz * _e.d * k; p.y += dy * k;
          const vn = v.x * _e.nx + v.z * _e.nz;
          if (vn < 0) { v.x -= _e.nx * vn; v.z -= _e.nz * vn; }
          if (v.y < 0) v.y *= 0.5;
          hits++; moved = true;
          continue;
        } else side = r - _e.d;
        if (up <= side && up <= down) { p.y += up; if (v.y < 0) v.y = 0; }
        else if (down <= side) { p.y -= down; if (v.y > 0) v.y = 0; }
        else {
          const s = inside ? -1 : 1;     // inside, the edge normal points in: go the other way
          p.x += _e.nx * side * s; p.z += _e.nz * side * s;
          const nx = _e.nx * s, nz = _e.nz * s, vn = v.x * nx + v.z * nz;
          if (vn < 0) { v.x -= nx * vn * 1.15; v.z -= nz * vn * 1.15; }
        }
        hits++; moved = true;
      }
    }
    if (!moved) break;
  }
  return hits;
}

// ------------------------------------------------------------------ the controller
export class DroneController {
  // o: { engine, probe (game/control.js makeProbe: ground(x, z), inPark), bound(x, z) -> { nx, nz, over } | null }
  constructor(o) {
    this.engine = o.engine;
    this.P = o.probe;
    this.bound = o.bound || null;
    this.model = buildDroneModel();
    this.engine.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.yaw = 0;                       // the body's heading
    this.camYaw = 0; this.camPitch = -0.18;
    this.dist = 2.6; this.distT = 2.6;
    this.view = 'chase';                // 'chase' | 'gimbal'
    this.tilt = { x: 0, z: 0 };
    this.t = 0; this.spin = 0;
    this.pivot = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.fov0 = o.fov0 || 66;
    this.ceilY = CEILING;
    this.active = false;
    this.hits = 0;
    this._f = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }
  // the ground or the water under (x, z): the lowest the drone may hover is this plus CLEAR
  floorAt(x, z, fb = null) {
    const P = this.P;
    let g = P ? P.ground(x, z, null) : null;
    const park = P && P.inPark && P.inPark(x, z);
    if (park) { const w = cpWaterY(x, z); if (w !== null && (g === null || w > g)) g = w; }
    else if (g !== null) g = Math.max(g, 0);
    return g === null ? fb : g;
  }
  spawn(x, y, z, yaw = 0, pitch = -0.18) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.acc.set(0, 0, 0);
    this.yaw = yaw; this.camYaw = yaw; this.camPitch = pitch;
    this.tilt.x = this.tilt.z = 0;
    const g = this.floorAt(x, z, null);
    if (g !== null && y < g + CLEAR) this.pos.y = g + CLEAR;
    this.ceilY = (g ?? y) + CEILING;
    this.pivot.copy(this.pos);
    this.camPos.copy(this.pos).add(new THREE.Vector3(Math.sin(yaw) * this.dist, 1, Math.cos(yaw) * this.dist));
    this._snap = true;
  }
  show(on) { this.model.root.visible = !!on && this.view === 'chase'; this.active = !!on; }
  look(dx, dy) {   // pointer pixels
    this.camYaw = wrapPi(this.camYaw - dx * 0.0024);
    this.camPitch = clamp(this.camPitch - dy * 0.0022, -1.35, 0.6);
  }
  zoom(deltaY) { this.distT = clamp(this.distT * (deltaY > 0 ? 1.12 : 1 / 1.12), 1.8, 14); }
  toggleView() {
    this.view = this.view === 'chase' ? 'gimbal' : 'chase';
    this.model.root.visible = this.active && this.view === 'chase';
    this._snap = true;
    return this.view;
  }
  // input: { fwd, right, up (each -1..1), lookX, lookY (rad/s, a stick) }
  update(dt, input = {}) {
    const E = this.engine, cam = E.camera;
    if (!(dt > 0)) dt = 0;
    this.t += dt;
    // look (a stick turns the view at a rate)
    if (input.lookX || input.lookY) {
      this.camYaw = wrapPi(this.camYaw - (input.lookX || 0) * dt);
      this.camPitch = clamp(this.camPitch - (input.lookY || 0) * dt, -1.35, 0.6);
    }
    // the wanted velocity in the camera's frame (level: pitch does not steer the climb)
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const f = clamp(input.fwd || 0, -1, 1), r = clamp(input.right || 0, -1, 1), u = clamp(input.up || 0, -1, 1);
    let wx = (fx * f - fz * r), wz = (fz * f + fx * r);
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    let wy = u * V_UP;
    // the ceiling: no climb in its last 12 m, a gentle sink above it
    const ceilLeft = this.ceilY - this.pos.y;
    if (wy > 0) wy *= clamp(ceilLeft / 12, 0, 1);
    if (ceilLeft < 0) wy = Math.min(wy, ceilLeft * 0.8);
    const want = this._v.set(wx * V_MAX, wy, wz * V_MAX);
    const k = (wl > 0.05 || Math.abs(u) > 0.05) ? K_ACC : K_STOP;
    const a = damp(k, dt);
    const ox = this.vel.x, oy = this.vel.y, oz = this.vel.z;
    this.vel.x += (want.x - this.vel.x) * a;
    this.vel.z += (want.z - this.vel.z) * a;
    this.vel.y += (want.y - this.vel.y) * damp(k * 1.4, dt);
    // the boundary: a spring back inside and the outward speed bled off
    if (this.bound) {
      const b = this.bound(this.pos.x, this.pos.z);
      if (b && b.over > 0) {
        const vout = -(this.vel.x * b.nx + this.vel.z * b.nz);
        if (vout > 0) { const kk = damp(0.8 + b.over * 0.12, dt); this.vel.x += b.nx * vout * kk; this.vel.z += b.nz * vout * kk; }
        const push = Math.min(12, b.over * 0.6) * dt;
        this.vel.x += b.nx * push * 3; this.vel.z += b.nz * push * 3;
        if (b.over > 80) { this.pos.x += b.nx * (b.over - 80); this.pos.z += b.nz * (b.over - 80); }
      }
    }
    if (dt > 0) this.acc.set((this.vel.x - ox) / dt, (this.vel.y - oy) / dt, (this.vel.z - oz) / dt);
    // move, then resolve against the buildings, the ground and the water
    this.pos.addScaledVector(this.vel, dt);
    const floor = this.floorAt(this.pos.x, this.pos.z, null);
    this.hits += collidePrisms(this.pos, this.vel, R_BODY, floor ?? -1e9);
    if (floor !== null && this.pos.y < floor + CLEAR) { this.pos.y = floor + CLEAR; if (this.vel.y < 0) this.vel.y = 0; }
    if (this.pos.y > this.ceilY + 8) { this.pos.y = this.ceilY + 8; if (this.vel.y > 0) this.vel.y = 0; }
    // the nose follows the camera (a yaw rate limit, eased)
    const dYaw = wrapPi(this.camYaw - this.yaw);
    this.yaw = wrapPi(this.yaw + clamp(dYaw * damp(3.2, dt), -2.6 * dt, 2.6 * dt));
    // bank into the motion: speed and acceleration in the body's frame
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const vf = -(this.vel.x * sy + this.vel.z * cy), vr = this.vel.x * cy - this.vel.z * sy;
    const af = -(this.acc.x * sy + this.acc.z * cy), ar = this.acc.x * cy - this.acc.z * sy;
    const tx = clamp(-(vf * 0.019 + af * 0.028), -0.42, 0.42), tz = clamp(-(vr * 0.019 + ar * 0.028), -0.42, 0.42);
    const kt = damp(6, dt);
    this.tilt.x += (tx - this.tilt.x) * kt; this.tilt.z += (tz - this.tilt.z) * kt;
    this._place(dt);
    this._camera(dt, cam);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  _place(dt) {
    const m = this.model, root = m.root;
    // a gentle hover: a slow bob and a breath of roll, damped at speed
    const sp = Math.hypot(this.vel.x, this.vel.z), calm = 1 - clamp(sp / 6, 0, 0.7);
    const bob = (0.022 * Math.sin(this.t * 2.1) + 0.009 * Math.sin(this.t * 3.7 + 1.3)) * calm;
    root.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    root.rotation.set(0, this.yaw, 0);
    m.frame.rotation.order = 'YXZ';
    m.frame.rotation.set(this.tilt.x + 0.012 * Math.sin(this.t * 1.7) * calm, 0, this.tilt.z + 0.014 * Math.sin(this.t * 1.3 + 0.6) * calm);
    // the props: a fast spin that rises with the climb and the speed; the discs turn with them
    const w = 58 + 14 * clamp(this.vel.y / V_UP, -1, 1) + 0.9 * sp;
    this.spin += w * dt;
    for (const p of m.props) p.rotation.y = this.spin * p.userData.dir;
    for (const d of m.discs) d.rotation.y = this.spin * 0.37 * d.userData.dir;
    // the gimbal: level against the bank, pitched to the view
    m.gimbal.rotation.order = 'ZXY';
    m.gimbal.rotation.set(-m.frame.rotation.x, wrapPi(this.camYaw - this.yaw), -m.frame.rotation.z);
    m.cam.rotation.x = clamp(this.camPitch, -1.5, 0.35);
  }
  _camera(dt, cam) {
    this.dist += (this.distT - this.dist) * damp(8, dt);
    const snap = this._snap; this._snap = false;
    if (this.view === 'gimbal') {
      // first person: the gimbal camera's lens, the world level, the view where the visitor looks
      this.model.cam.updateWorldMatrix(true, false);
      const lp = this._v.set(0, 0, -0.06).applyMatrix4(this.model.cam.matrixWorld);
      cam.position.copy(lp);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.camYaw); cam.rotateX(this.camPitch);
      this._fov(cam, this.fov0 + 8);
      cam.updateMatrixWorld();
      return;
    }
    // chase: a smoothed pivot on the drone; the lens orbits it at the view angles and rides above the orbit by LIFT of the
    // distance, so the view looks over the drone and it sits in the lower third; pulled in front of buildings
    const k = snap ? 1 : damp(14, dt);
    this.pivot.x += (this.pos.x - this.pivot.x) * k;
    this.pivot.y += (this.pos.y + 0.08 - this.pivot.y) * k;
    this.pivot.z += (this.pos.z - this.pivot.z) * k;
    const cp = Math.cos(this.camPitch);
    const f = this._f.set(-Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), -Math.cos(this.camYaw) * cp);
    const want = new THREE.Vector3().copy(this.pivot).addScaledVector(f, -this.dist);
    want.y += this.dist * LIFT;
    // buildings between the drone and the lens
    const dir = new THREE.Vector3().subVectors(want, this.pivot);
    const L = dir.length();
    if (L > 0.3) {
      dir.divideScalar(L);
      const hit = COLLIDERS.raycast(this.pivot, dir, L + 0.4);
      if (hit && hit.dist < L + 0.3) want.copy(this.pivot).addScaledVector(dir, Math.max(0.6, hit.dist - 0.35));
    }
    const g = this.floorAt(want.x, want.z, null);
    if (g !== null && want.y < g + 0.3) want.y = g + 0.3;
    this.camPos.copy(want);
    cam.position.copy(this.camPos);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(this.camYaw); cam.rotateX(this.camPitch);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this._fov(cam, this.fov0 + clamp(sp * 0.25, 0, 5));
    cam.updateMatrixWorld();
  }
  _fov(cam, f) { if (Math.abs(cam.fov - f) > 0.05) { cam.fov += (f - cam.fov) * 0.2; cam.updateProjectionMatrix(); } }
  speedText() { return `drone ${Math.hypot(this.vel.x, this.vel.z).toFixed(1)} m/s`; }
  state() { return { pos: this.pos.toArray().map((v) => +v.toFixed(2)), vel: +this.vel.length().toFixed(2), yaw: +this.yaw.toFixed(3), view: this.view, hits: this.hits }; }
}
