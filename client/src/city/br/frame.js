// A bridge's frame: stations s (metres along the deck's centre line from its first point), the roadway's height y(s),
// the horizontal tangent and the across direction at s. P(s, o, y) is the world point `o` metres across the centre line
// (positive to the left of the direction of increasing s) at height y.
export class Frame {
  constructor(rec) {
    const d = rec.deck;
    this.rec = rec;
    this.x = d.map((p) => p[0]); this.y = d.map((p) => p[1]); this.z = d.map((p) => p[2]);
    this.g = rec.ground || null;
    this.s = [0];
    for (let i = 1; i < d.length; i++) this.s.push(this.s[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][2] - d[i - 1][2]));
    this.L = this.s[this.s.length - 1];
  }
  // the segment index and fraction at station s (clamped)
  seg(s) {
    const S = this.s, n = S.length;
    if (s <= 0) return [0, s / Math.max(1e-6, S[1])];
    if (s >= this.L) return [n - 2, 1 + (s - this.L) / Math.max(1e-6, S[n - 1] - S[n - 2])];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    return [lo, (s - S[lo]) / Math.max(1e-6, S[lo + 1] - S[lo])];
  }
  // the roadway's height at s (linear between the record's samples; beyond the ends, the end grade carried on)
  yAt(s) { const [i, t] = this.seg(s); return this.y[i] + (this.y[i + 1] - this.y[i]) * t; }
  grade(s) { const [i] = this.seg(s); return (this.y[i + 1] - this.y[i]) / Math.max(1e-6, this.s[i + 1] - this.s[i]); }
  // the ground under the centre line at s: the terrain on land, null over the water
  groundAt(s) {
    if (!this.g) return null;
    const [i, t] = this.seg(s), a = this.g[i], b = this.g[Math.min(i + 1, this.g.length - 1)];
    if (a === null || b === null) return t < 0.5 ? a : b;
    return a + (b - a) * Math.max(0, Math.min(1, t));
  }
  // the horizontal tangent at s, smoothed over the neighbouring segments so a corner of the centre line turns gradually
  dir(s) {
    const h = 6, a = this.xz(s - h), b = this.xz(s + h);
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }
  xz(s) { const [i, t] = this.seg(s); return [this.x[i] + (this.x[i + 1] - this.x[i]) * t, this.z[i] + (this.z[i + 1] - this.z[i]) * t]; }
  // the frame at s: centre point (on the roadway), tangent t, across n (left), up
  at(s) {
    const [x, z] = this.xz(s), [tx, tz] = this.dir(s);
    return { s, x, y: this.yAt(s), z, t: [tx, 0, tz], n: [tz, 0, -tx] };
  }
  P(s, o, y) { const [x, z] = this.xz(s), [tx, tz] = this.dir(s); return [x + tz * o, y, z - tx * o]; }
  // the station of the centre line nearest to the world point (x, z)
  stationOf(x, z) {
    let best = 1e18, bs = 0;
    for (let i = 0; i + 1 < this.s.length; i++) {
      const x1 = this.x[i], z1 = this.z[i], dx = this.x[i + 1] - x1, dz = this.z[i + 1] - z1, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      const d2 = (x1 + dx * t - x) ** 2 + (z1 + dz * t - z) ** 2;
      if (d2 < best) { best = d2; bs = this.s[i] + t * (this.s[i + 1] - this.s[i]); }
    }
    return bs;
  }
  // stations from s0 to s1 at about `step`, both ends included
  range(s0, s1, step) {
    const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step)), out = [];
    for (let i = 0; i <= n; i++) out.push(s0 + ((s1 - s0) * i) / n);
    return out;
  }
}
