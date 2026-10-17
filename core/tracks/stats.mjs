// What a take shows near its lens, measured the same way in the core and in the page (tools/core/page_take.mjs
// evaluates this function's source inside the page against window.__gtRefs): vehicles and walkers within each radius of
// the camera, how many move, their mean speeds, and the page's own plausibility checks (traffic.js drawnOverlaps: bodies
// inside each other on screen; offRoad: a wheel or centre on a non-road surface on screen).
export function lensStatsOf(T, peds, cam, radii = [50, 100, 250], checks = true) {
  const cx = cam.position.x, cz = cam.position.z;
  const o = { cars: {}, moving: {}, meanV: {}, parked: {}, walkers: {}, walking: {}, meanWalkV: {}, kinds: {} };
  for (const R of radii) {
    let n = 0, mv = 0, sv = 0, pk = 0, w = 0, ww = 0, sw = 0;
    const R2 = R * R;
    for (const c of T.cars) {
      const q = c._pose;
      if (!q) continue;
      if ((q[0] - cx) ** 2 + (q[2] - cz) ** 2 > R2) continue;
      n++;
      if ((c.v || 0) > 0.5) { mv++; sv += c.v; }
      if (R === radii[radii.length - 1]) o.kinds[c.kind] = (o.kinds[c.kind] || 0) + 1;
    }
    for (const recs of T.parkedRecs.values()) for (const r of recs) if ((r.x - cx) ** 2 + (r.z - cz) ** 2 <= R2) pk++;
    if (peds) for (const p of peds.peds) {
      const x = p._x ?? null, z = p._z ?? null;
      let px = x, pz = z;
      if (px === null || pz === null) { const M = peds.mesh.instanceMatrix.array, k = p.idx * 16; px = M[k + 12]; pz = M[k + 14]; }
      if ((px - cx) ** 2 + (pz - cz) ** 2 > R2) continue;
      w++;
      const v = (p.v || 0) * (p.vf ?? 1);
      if (!p.seat && !(p.stand > 0) && v > 0.3) { ww++; sw += v; }
    }
    o.cars[R] = n; o.moving[R] = mv; o.meanV[R] = mv ? +(sv / mv).toFixed(2) : 0; o.parked[R] = pk;
    o.walkers[R] = w; o.walking[R] = ww; o.meanWalkV[R] = ww ? +(sw / ww).toFixed(2) : 0;
  }
  if (checks) {
    const ov = T.drawnOverlaps ? T.drawnOverlaps(0.1) : null;
    const off = T.offRoad ? T.offRoad(false) : null;
    o.overlaps = ov ? ov.length : 0;
    o.overlapsParked = ov ? ov.filter((s) => /\(parked\) x \S+ \(parked\)/.test(s)).length : 0;
    o.offRoad = off ? off.length : 0;
    if (ov && ov.length) o.overlapList = ov.slice(0, 4);
    if (off && off.length) o.offRoadList = off.slice(0, 4).map((r) => `${r.kind} ${r.hits.join('; ')} @${r.dist} m`);
  }
  o.total = { cars: T.cars.length, walkers: peds ? peds.peds.length : 0 };
  return o;
}
export function lensStats(W, { radii = [50, 100, 250], checks = true } = {}) {
  return lensStatsOf(W.traffic, W.peds, W.camera, radii, checks);
}
