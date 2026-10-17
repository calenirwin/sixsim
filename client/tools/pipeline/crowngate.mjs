// FB38 crown gate: every part the runtime builds for a tall building must rest on the ground or on another part of
// the same building, with no vertical gap over 0.5 m.
//
// The compiled record is one footprint and a height; the parts above the roof (setback tiers, crown tiers, pylons,
// bulkheads, masts, parapets and their copings) are made at load time by src/world/towers.js. This gate runs that same
// code on every record that takes the tower pass (assemble.js: a SETBACKS footprint over 40 m and 300 m2 that fills
// 72 % of its box, else any non-landmark building over TOWER_H) and checks each wall it draws: the foot of the wall must
// lie on the ground, on a deck (a horizontal face of the building) or on the top of another wall, within 0.5 m. A part
// that fails is reported with its building; towers.js (FB38) puts each piece on the deck it stands on and brings a box
// whose foot is over a lower deck down to it, so the expected count is zero.
//
//   node tools/pipeline/crowngate.mjs <tilesDir> [--json out.json] [--towers path/to/towers.js]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTile, buildingsOf } from '../../src/world/tiledata.js';
import { BF } from '../../src/shared/geo.js';

const GAP = 0.5;

function ringOBBArea(ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
    const a = Math.atan2(z2 - z1, x2 - x1), c = Math.cos(-a), s = Math.sin(-a);
    let x0 = 1e9, xm = -1e9, z0 = 1e9, zm = -1e9;
    for (const [px, pz] of ring) { const rx = px * c - pz * s, rz = px * s + pz * c; x0 = Math.min(x0, rx); xm = Math.max(xm, rx); z0 = Math.min(z0, rz); zm = Math.max(zm, rz); }
    best = Math.min(best, (xm - x0) * (zm - z0));
  }
  return best;
}
const inTri = (t, x, z) => {
  const [a, b, c] = t;
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(d) < 1e-9) return false;
  const l0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  return l0 >= -1e-4 && l1 >= -1e-4 && 1 - l0 - l1 >= -1e-4;
};
const segDist = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

// one building through the runtime's tower pass; returns the walls whose foot is unsupported
export function gateBuilding(T, b, ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  const y0 = b.baseY, topY = y0 + b.height;
  const walls = [], decks = [];
  const buf = {
    quad: (a, b2, c, d, n) => walls.push({ a, b: b2, c, d, n }),
    tri: (a, b2, c) => decks.push([a, b2, c]),
  };
  const extrudePrism = (bf, r, ya, yb) => {   // the body and the setback tiers, as assemble.js extrudes them
    for (let i = 0; i < r.length; i++) {
      const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length];
      const L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.05) continue;
      walls.push({ a: [x1, ya, z1], b: [x1, yb, z1], c: [x2, yb, z2], d: [x2, ya, z2], n: [(z2 - z1) / L, 0, -(x2 - x1) / L] });
    }
  };
  if (b.landmarkId > 0) return null;   // a replace landmark is drawn by its builder (assemble.js skips the massing for it)
  const convexish = (b.flags & BF.SETBACKS) ? b.area / Math.max(1, ringOBBArea(ring)) > 0.72 : false;
  if ((b.flags & BF.SETBACKS) && convexish && b.height > 40 && b.area > 300 && !(b.roofKind === 2 || b.roofKind === 3)) {
    const set = T.buildSetbacks(buf, ring, cx, cz, y0, topY, b, { fndY: y0 - 1 }, extrudePrism);
    T.buildTower(buf, set.top, cx, cz, y0, topY, b);
  } else if (b.height > T.TOWER_H && !b.landmarkId) {
    extrudePrism(buf, ring, y0 - 1, topY);
    T.buildTower(buf, ring, cx, cz, y0, topY, b);
  } else return null;
  const bad = [];
  for (const w of walls) {
    const ya = Math.min(w.a[1], w.d[1]);
    if (ya <= y0 + GAP) continue;                                  // on the ground
    const mx = (w.a[0] + w.d[0]) / 2, mz = (w.a[2] + w.d[2]) / 2;
    const n = w.n || [0, 0, 0];
    let ok = false;
    // a deck under the wall's foot (probed just behind the wall, inside the part)
    for (const [px, pz] of [[mx - n[0] * 0.3, mz - n[2] * 0.3], [mx + n[0] * 0.3, mz + n[2] * 0.3]]) {
      for (const t of decks) { const y = t[0][1]; if (y <= ya + GAP && y >= ya - GAP && inTri(t, px, pz)) { ok = true; break; } }
      if (ok) break;
    }
    // or the top of another wall (a coping on its parapet, a lip on its tier)
    if (!ok) for (const v of walls) {
      if (v === w) continue;
      const yt = Math.max(v.b[1], v.c[1]);
      if (yt < ya - GAP || yt > ya + GAP || Math.min(v.a[1], v.d[1]) >= ya) continue;
      if (segDist(mx, mz, v.b[0], v.b[2], v.c[0], v.c[2]) < 1.5) { ok = true; break; }   // a coping stands ~1.4 % proud of its parapet
    }
    if (!ok) bad.push({ ya: +ya.toFixed(2), yb: +Math.max(w.b[1], w.c[1]).toFixed(2), x: +mx.toFixed(1), z: +mz.toFixed(1) });
  }
  return { walls: walls.length, bad };
}

// every tile of a set
export async function crownGateTiles(dir, towersPath = null) {
  const T = await import(towersPath ? pathToFileURL(path.resolve(towersPath)).href : '../../src/world/towers.js');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const out = { buildings: 0, walls: 0, failing: [] };
  for (const [key, ent] of Object.entries(man.tiles)) {
    const b0 = fs.readFileSync(path.join(dir, ent.f));
    const t = parseTile(b0.buffer.slice(b0.byteOffset, b0.byteOffset + b0.byteLength));
    if (!t.S.bldg || !t.S.bldg.byteLength) continue;
    const [ox, oz] = t.header.origin;
    for (const b of buildingsOf(t)) {
      if (b.height <= 40) continue;
      const ring = [];
      for (let q = 0; q < b.len; q++) ring.push([t.S.bldgXZ[(b.start + q) * 2] + ox, t.S.bldgXZ[(b.start + q) * 2 + 1] + oz]);
      if (ring.length < 3) continue;
      let r;
      try { r = gateBuilding(T, b, ring); } catch (e) { r = { walls: 0, bad: [{ error: String(e && e.message || e) }] }; }
      if (!r) continue;
      out.buildings++; out.walls += r.walls;
      if (r.bad.length) {
        let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; }
        out.failing.push({ tile: key, i: b.i, x: +(cx / ring.length).toFixed(1), z: +(cz / ring.length).toFixed(1), height: +b.height.toFixed(2), flags: b.flags, style: b.style, roofY: +(b.baseY + b.height).toFixed(2), walls: r.bad.length, parts: r.bad.slice(0, 6) });
      }
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && !['--json', '--towers'].includes(args[i - 1]));
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const r = await crownGateTiles(dir, opt('--towers'));
  console.log(`crown gate: ${r.buildings} buildings through the tower pass, ${r.walls} walls, ${r.failing.length} buildings with a part not resting on the ground or on its own building (${r.failing.reduce((s, f) => s + f.walls, 0)} walls)`);
  for (const f of r.failing.slice(0, 12)) console.log('  ', JSON.stringify(f).slice(0, 300));
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(r, null, 1));
}
