// The per-slot motion state that sim/fleet24.js installFleet24 derives after every traffic update (its `cull`), without
// the drawing: traffic.js reads it back (VC36 _rearBody: an articulated bus's rear body from its moving group's tow state),
// so the model needs it to behave as in the page. Mirror of the state half of the cull loop (spin, steer, brake,
// blinkers, the rear axle towed about the turntable pivot); `traffic.update` is wrapped the same way (update, then state).
const TAU = Math.PI * 2;

class SlotState {
  constructor(cap) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.z = f(); this.yaw = f(); this.spin = f(); this.v = f(); this.steer = f(); this.brake = f(); this.blinkL = f(); this.blinkR = f();
    this.rx = f(); this.rz = f();
    this.ok = new Uint8Array(cap);
    this.cap = cap;
  }
}
// fleet24's hash (exported through its R1D block)
export function installFleetState(traffic, kinds, hash) {
  const groups = [];
  for (const [k, P] of Object.entries(traffic.pools || {})) {
    const K = kinds[k];
    if (!K || !P.mb) continue;
    groups.push({ kind: k, K, P, moving: true, state: new SlotState(P.cap) });
  }
  traffic.fleet24.groups = groups;
  const orig = traffic.update.bind(traffic);
  const derive = (dt) => {
    const still = !(dt > 0);
    dt = still ? 0 : Math.min(0.1, Math.max(1e-3, dt));
    for (const G of groups) {
      const A = G.P.mb.instanceMatrix.array, n = G.P.mb.count, S = G.state, K = G.K, R = K.rear;
      const hubR = K.meta?.hubs?.[0]?.r || 0.34, wb = K.meta?.wheelbase || 2.8;
      for (let i = 0; i < n && i < S.cap; i++) {
        const o = i * 16;
        if (A[o] === 0 && A[o + 5] === 0 && A[o + 10] === 0) continue;
        const x = A[o + 12], z = A[o + 14], seed = hash(i, G.kind.length * 131 + 7);
        const yaw = Math.atan2(A[o + 8], A[o + 10]);
        if (still && S.ok[i]) { /* hold */ }
        else if (S.ok[i]) {
          const d = Math.hypot(x - S.x[i], z - S.z[i]);
          if (d > 4) S.ok[i] = 0;
          else {
            S.spin[i] = (S.spin[i] + d / hubR) % TAU;
            const vNow = d / dt, acc = (vNow - S.v[i]) / dt;
            S.v[i] += (vNow - S.v[i]) * Math.min(1, dt * 6);
            let dy = yaw - S.yaw[i];
            if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
            const target = S.v[i] > 0.5 ? Math.max(-0.6, Math.min(0.6, Math.atan(wb * (dy / dt) / S.v[i]))) : S.steer[i];
            S.steer[i] += (target - S.steer[i]) * Math.min(1, dt * 5);
            S.brake[i] = acc < -1.4 || S.v[i] < 0.4 ? 0.5 : Math.max(0, S.brake[i] - dt);
            if (S.steer[i] > 0.12) S.blinkL[i] = 1.2; else S.blinkL[i] = Math.max(0, S.blinkL[i] - dt);
            if (S.steer[i] < -0.12) S.blinkR[i] = 1.2; else S.blinkR[i] = Math.max(0, S.blinkR[i] - dt);
          }
        }
        let fresh = false;
        if (!S.ok[i]) { S.ok[i] = 1; S.v[i] = 0; S.steer[i] = 0; S.brake[i] = 0; S.blinkL[i] = S.blinkR[i] = 0; S.spin[i] = seed * 6.28; fresh = true; }
        S.x[i] = x; S.z[i] = z; S.yaw[i] = yaw;
        if (R) {
          const fl = Math.hypot(A[o + 8], A[o + 10]) || 1, fx = A[o + 8] / fl, fz = A[o + 10] / fl;
          const hx = x + fx * R.pivot[2], hz = z + fz * R.pivot[2];
          if (fresh) { S.rx[i] = hx - fx * R.tow; S.rz[i] = hz - fz * R.tow; }
          else if (!still) {
            const ddx = hx - S.rx[i], ddz = hz - S.rz[i], dd = Math.hypot(ddx, ddz);
            if (dd > 1e-6) { S.rx[i] = hx - (ddx / dd) * R.tow; S.rz[i] = hz - (ddz / dd) * R.tow; }
          }
          let da = Math.atan2(hx - S.rx[i], hz - S.rz[i]) - yaw;
          da -= Math.round(da / TAU) * TAU;
          const art = Math.max(-0.75, Math.min(0.75, da));
          if (Math.abs(da) > 0.75) { S.rx[i] = hx - Math.sin(yaw + art) * R.tow; S.rz[i] = hz - Math.cos(yaw + art) * R.tow; }
        }
      }
    }
  };
  traffic.update = (dt, px, pz) => { orig(dt, px, pz); derive(dt); };
  return groups;
}
