// The headless walker rig: the contract sim/peds.js drives (sim/pedmesh.js and sim/crowd.js: mesh, cap, timeRef,
// setAnim, setPace, setAmp, setStyle, moveSlot, update), keeping per slot what a renderer needs to pose a walker and
// nothing it would draw. The walk cycle follows pedmesh.js: phase(t) = t * rate + offset radians, rate = speed * 4.4
// (one cycle per 1.43 m walked at any pace), setPace changes the rate and moves the offset so the cycle does not jump.
// The gait phase exported per frame is that phase as a fraction of the cycle.
import * as THREE from 'three';

class InstanceStore extends THREE.Object3D {
  constructor(cap) {
    super();
    this.count = 0;
    this.frustumCulled = false;
    this.instanceMatrix = { array: new Float32Array(cap * 16), needsUpdate: false };
    this.instanceColor = { array: new Float32Array(cap * 3).fill(1), needsUpdate: false };
  }
  setMatrixAt(i, m) { m.toArray(this.instanceMatrix.array, i * 16); }
  getMatrixAt(i, m) { return m.fromArray(this.instanceMatrix.array, i * 16); }
  setColorAt(i, c) { c.toArray(this.instanceColor.array, i * 3); }
  getColorAt(i, c) { return c.fromArray(this.instanceColor.array, i * 3); }
}

export class HeadlessRig {
  constructor(cap = 700) {
    this.cap = cap;
    this.timeRef = { value: 0 };
    // instance storage only: the part of THREE.InstancedMesh peds.js writes (each walker's matrix and colour), no geometry,
    // no material; a scene-graph node so the page's scene.add() takes it
    this.mesh = new InstanceStore(cap);
    const f = () => new Float32Array(cap);
    // (speed: the crowd rig's per-slot walking speed, which src/game/control.js writes for a player's walker)
    // (ph0: the phase setAnim was given, the seed of the crowd's first clip time, sim/crowd.js update)
    // (pace: the last walk-rate factor peds.js asked for, unthresholded, as the crowd rig keeps it)
    this.st = { off: f(), rate: f(), base: f(), amp: f(), skin: f(), mask: f(), bag: f(), umb: f(), speed: f(), ph0: f(), pace: f().fill(1) };
  }
  setAnim(idx, phase, rate, amp, skin) {
    const s = this.st;
    s.off[idx] = phase; s.rate[idx] = rate; s.base[idx] = rate; s.amp[idx] = amp; s.skin[idx] = skin; s.speed[idx] = rate / 4.4; s.ph0[idx] = phase; s.pace[idx] = 1;
  }
  setPace(idx, f) {
    this.st.pace[idx] = f;
    const s = this.st, r0 = s.rate[idx], r1 = s.base[idx] * f;
    if (Math.abs(r1 - r0) < 0.04 * (s.base[idx] || 1)) return;
    s.off[idx] += this.timeRef.value * (r0 - r1);
    s.rate[idx] = r1;
  }
  setAmp(idx, amp) { this.st.amp[idx] = amp; }
  setStyle(idx, mask, bagTone, umbTone) { const s = this.st; s.mask[idx] = mask; s.bag[idx] = bagTone; s.umb[idx] = umbTone; }
  moveSlot(from, to) {
    if (from === to) return;
    for (const a of Object.values(this.st)) a[to] = a[from];
  }
  update() {}
  // the slot's gait: cycle fraction in [0, 1), walking amplitude (0 standing, 1 walking), cycles per second
  gait(idx) {
    const s = this.st, ph = this.timeRef.value * s.rate[idx] + s.off[idx], c = ph / (2 * Math.PI);
    return { phase: c - Math.floor(c), amp: s.amp[idx], hz: s.rate[idx] / (2 * Math.PI), pace: s.pace[idx] };
  }
}
