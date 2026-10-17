// SG40 shore gate: is the land the records hold along the shore drawn, and does every bulkhead stand in front of ground?
//
//   node tools/pipeline/shoregate.mjs <tilesDir> [--json out.json] [--tile 250] [--share 0.02] [--frag 10] [--planks 3] [--inland 3] [--base 3.24]
//
// It reads the written tiles only (their terrain grid, shore aprons, building footprints and the bulkhead faces in the curb
// soup: the quads that run from -2.6 m up to the wall's top) and the land polygons the compile reads (data/raw/
// boundaries.geojson, and the New Jersey landing patches unless NJ_PATCHES=0, as in compile.mjs). Per tile it counts:
// - FRAGMENTS: apron pieces (strips within 1.5 m in a row or overlapping within 1 m across adjacent rows, as compile.mjs
//   joins them) that reach no land-grade terrain and have undrawn land of the same structure beside them (3 m2 and a
//   twentieth of the piece's area or more): a piece of a dock or pier standing out in the water with its walls, the rest of
//   it not drawn. Runs 7 to 11 left them at marina finger piers (their short edges lost their walls, the
//   aprons went with the walls, and the rows that kept both stood alone); the live set has them at docks too.
// - PLANKS: bulkhead faces with no ground behind them (the terrain grid at the land grade, or an apron, within 6 m on the
//   land's side of the face's middle or ends), or more than 6 m from any land: a wall standing in the water.
// - FACING INLAND: bulkhead faces wound towards the land (the ground material draws front faces only, so from the water
//   the face is culled and the skirt reads as a plank: WW39).
// - LAND LEFT TO THE WATER: metres of a city land polygon's shore with land at least 3 m deep behind it (not a sliver, a
//   spike, a tip or a dock too narrow to wall on both sides, which the compile leaves to the water on purpose: an edge
//   under 8 m long counts only where it has land 2.5 m behind its middle and its quarter points, or 2.5 and 4 m behind its
//   middle, as in compile.mjs) that have neither a bulkhead face within 4 m in front of them nor ground above the water or
//   a building 1 or 2 m behind them: land the records hold that is drawn as water.
// A tile fails above --frag m2 of fragments (10), --planks planks (3), --inland faces facing inland (3) or --tile metres of
// land left to the water (250: run 12 has at most 248 m in a tile, City Island's docks; runs 7 to 11 had up to 460 m);
// the set fails when its land left to the water passes --share of its shore (2 %; run 12 0.8 %, run 11 4.4 %, the live
// set 3.2 %). The exit code is 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseTile } from '../../src/world/tiledata.js';
import { project, unproject } from '../../src/shared/geo.js';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = path.join(CLIENT, 'data', 'raw');
const TILE = 512, RC = 8, FC = 8;

// land polygons with a row index per ring: point-in-polygon by crossings over the rows that hold the point
function rowIndex(ring) {
  const rows = new Map();
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    for (let r = Math.floor(Math.min(az, bz) / RC); r <= Math.floor(Math.max(az, bz) / RC); r++) {
      let a = rows.get(r); if (!a) rows.set(r, (a = []));
      a.push(ax, az, bx, bz);
    }
  }
  return rows;
}
function inRing(rows, x, z) {
  const a = rows.get(Math.floor(z / RC)); if (!a) return false;
  let c = false;
  for (let k = 0; k < a.length; k += 4) {
    const az = a[k + 1], bz = a[k + 3];
    if ((az > z) !== (bz > z) && a[k] + ((z - az) * (a[k + 2] - a[k])) / (bz - az) > x) c = !c;
  }
  return c;
}
export function loadLand({ njPatches = process.env.NJ_PATCHES !== '0' } = {}) {
  const LAND = [];
  const add = (outer, holes, city) => {
    let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12;
    for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    LAND.push({ outer, oi: rowIndex(outer), hi: holes.map(rowIndex), bbox: [x0, z0, x1, z1], city });
  };
  const fc = JSON.parse(fs.readFileSync(path.join(RAW, 'boundaries.geojson'), 'utf8'));
  for (const f of fc.features) {
    const g = f.geometry; if (!g) continue;
    for (const poly of g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) {
      const rings = poly.map((r) => r.map(([lon, lat]) => project(lon, lat)));
      add(rings[0], rings.slice(1), true);
    }
  }
  const lp = path.join(RAW, 'osm_landings.json');
  if (njPatches && fs.existsSync(lp)) {
    for (const L of Object.values(JSON.parse(fs.readFileSync(lp, 'utf8')))) for (const ring of L.land || []) add(ring.map(([lon, lat]) => project(lon, lat)), [], false);
  }
  const onLand = (x, z) => {
    for (const L of LAND) {
      const b = L.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || !inRing(L.oi, x, z)) continue;
      let hole = false;
      for (const h of L.hi) if (inRing(h, x, z)) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  };
  return { LAND, onLand };
}

// a written tile, reduced to what the gate reads
export function readTile(file) {
  const b0 = fs.readFileSync(file);
  const t = parseTile(b0.buffer.slice(b0.byteOffset, b0.byteOffset + b0.byteLength));
  const [ox, oz] = t.header.origin, res = t.header.res;
  const grid = Float32Array.from(t.S.terrain || []);
  // aprons: world-space triangles in an 8 m cell index
  const ap = t.S.apron ? Float32Array.from(t.S.apron) : new Float32Array(0);
  const apIdx = new Map();
  for (let i = 0; i + 8 < ap.length; i += 9) {
    for (let k = 0; k < 9; k += 3) { ap[i + k] += ox; ap[i + k + 2] += oz; }
    if (Math.abs((ap[i + 3] - ap[i]) * (ap[i + 8] - ap[i + 2]) - (ap[i + 6] - ap[i]) * (ap[i + 5] - ap[i + 2])) < 1e-6) continue;   // a strip taken out (collapsed to a point)
    const x0 = Math.min(ap[i], ap[i + 3], ap[i + 6]), x1 = Math.max(ap[i], ap[i + 3], ap[i + 6]);
    const z0 = Math.min(ap[i + 2], ap[i + 5], ap[i + 8]), z1 = Math.max(ap[i + 2], ap[i + 5], ap[i + 8]);
    for (let j = Math.floor(z0 / FC); j <= Math.floor(z1 / FC); j++) for (let c = Math.floor(x0 / FC); c <= Math.floor(x1 / FC); c++) {
      const k = c + '_' + j; let a = apIdx.get(k); if (!a) apIdx.set(k, (a = [])); a.push(i);
    }
  }
  // bulkhead faces: curb triangles with two corners at -2.6 m (the face quad's lower triangle); its bottom edge and the
  // horizontal part of its winding normal (the side the face is drawn on)
  const faces = [];
  const cu = t.S.curb || new Float32Array(0);
  for (let i = 0; i + 8 < cu.length; i += 9) {
    const low = [];
    for (let k = 0; k < 3; k++) if (Math.abs(cu[i + k * 3 + 1] + 2.6) < 0.01) low.push(k);
    if (low.length !== 2) continue;
    const a = low[0] * 3 + i, b = low[1] * 3 + i;
    const ax = cu[a] + ox, az = cu[a + 2] + oz, bx = cu[b] + ox, bz = cu[b + 2] + oz;
    if (Math.hypot(bx - ax, bz - az) < 0.05) continue;   // a collapsed piece (WW39 leaves its floats on one point)
    const ux = cu[i + 3] - cu[i], uy = cu[i + 4] - cu[i + 1], uz = cu[i + 5] - cu[i + 2];
    const vx = cu[i + 6] - cu[i], vy = cu[i + 7] - cu[i + 1], vz = cu[i + 8] - cu[i + 2];
    let nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    faces.push([ax, az, bx, bz, nx, nz]);
  }
  // building footprints (a building standing to the shore's edge draws it with its own walls), in an 8 m cell index
  const rings = [], bIdx = new Map();
  const meta = t.S.bldg, XZ = t.S.bldgXZ;
  if (meta && meta.byteLength && XZ) {
    const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
    for (let o = 0; o + 44 <= meta.byteLength; o += 44) {
      const start = dv.getUint32(o, true), len = dv.getUint16(o + 4, true);
      if (len < 3) continue;
      const r = new Float64Array(len * 2);
      let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12;
      for (let i = 0; i < len; i++) {
        const x = XZ[(start + i) * 2] + ox, z = XZ[(start + i) * 2 + 1] + oz;
        r[i * 2] = x; r[i * 2 + 1] = z;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      const k = rings.push(r) - 1;
      for (let j = Math.floor(z0 / FC); j <= Math.floor(z1 / FC); j++) for (let c = Math.floor(x0 / FC); c <= Math.floor(x1 / FC); c++) {
        const key = c + '_' + j; let a = bIdx.get(key); if (!a) bIdx.set(key, (a = [])); a.push(k);
      }
    }
  }
  // the apron's strips (compile.mjs lays each 1 m row's strip as two triangles; a strip taken out is collapsed to a point)
  const strips = [];
  for (let i = 0; i + 17 < ap.length; i += 18) {
    let z0 = 1e12, x0 = 1e12, x1 = -1e12;
    for (let k = 0; k < 18; k += 3) { z0 = Math.min(z0, ap[i + k + 2]); x0 = Math.min(x0, ap[i + k]); x1 = Math.max(x1, ap[i + k]); }
    if (x1 - x0 > 0.01) strips.push(Math.round(z0), x0, x1);
  }
  return { ox, oz, res, grid, ap, apIdx, faces, rings, bIdx, strips };
}

export function shoreGate(tilesDir, { baseY = 3.24, maxTile = 250, maxShare = 0.02, maxPlanks = 3, maxInland = 3, maxFrag = 10, njPatches } = {}) {
  const t0 = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(tilesDir, 'manifest.json'), 'utf8'));
  const { LAND, onLand } = loadLand({ njPatches });
  const cache = new Map();
  const tileAt = (tx, tz) => {
    const key = tx + '_' + tz;
    if (cache.has(key)) return cache.get(key);
    const e = manifest.tiles[key];
    const T = e ? readTile(path.join(tilesDir, e.f)) : null;
    cache.set(key, T);
    return T;
  };
  const gridAt = (x, z) => {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), T = tileAt(tx, tz);
    if (!T || !T.grid.length) return null;
    const R = T.res, n = R + 1;
    const fx = ((x - tx * TILE) / TILE) * R, fz = ((z - tz * TILE) / TILE) * R;
    const i = Math.min(R - 1, Math.max(0, Math.floor(fx))), j = Math.min(R - 1, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j)), g = T.grid;
    const y00 = g[j * n + i], y10 = g[j * n + i + 1], y01 = g[(j + 1) * n + i], y11 = g[(j + 1) * n + i + 1];
    return (u >= v ? y00 + u * (y10 - y00) + v * (y11 - y10) : y00 + v * (y01 - y00) + u * (y11 - y01)) - 0.12;   // drawn 0.12 m under its samples
  };
  const apronAt = (x, z) => {
    const T = tileAt(Math.floor(x / TILE), Math.floor(z / TILE)); if (!T) return false;
    const a = T.apIdx.get(Math.floor(x / FC) + '_' + Math.floor(z / FC)); if (!a) return false;
    const p = T.ap;
    for (const i of a) {
      const d1 = (x - p[i + 3]) * (p[i + 2] - p[i + 5]) - (p[i] - p[i + 3]) * (z - p[i + 5]);
      const d2 = (x - p[i + 6]) * (p[i + 5] - p[i + 8]) - (p[i + 3] - p[i + 6]) * (z - p[i + 8]);
      const d3 = (x - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 6] - p[i]) * (z - p[i + 2]);
      if (!((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6))) return true;
    }
    return false;
  };
  const inBuilding = (x, z) => {
    const T = tileAt(Math.floor(x / TILE), Math.floor(z / TILE)); if (!T) return false;
    const a = T.bIdx.get(Math.floor(x / FC) + '_' + Math.floor(z / FC)); if (!a) return false;
    for (const k of a) {
      const r = T.rings[k], n = r.length / 2;
      let c = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const zi = r[i * 2 + 1], zj = r[j * 2 + 1];
        if ((zi > z) !== (zj > z) && x < r[j * 2] + ((z - zj) * (r[i * 2] - r[j * 2])) / (zi - zj)) c = !c;
      }
      if (c) return true;
    }
    return false;
  };
  const landGrade = (x, z) => { const y = gridAt(x, z); return (y !== null && y >= baseY - 0.4) || apronAt(x, z); };
  const aboveWater = (x, z) => { const y = gridAt(x, z); return (y !== null && y > 0.1) || apronAt(x, z); };
  // faces near a point, over the tile and its neighbours
  const facesNear = (x, z, r, fn) => {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.floor((x + dx * r) / TILE) !== tx + dx && dx !== 0) continue;
      if (Math.floor((z + dz * r) / TILE) !== tz + dz && dz !== 0) continue;
      const T = tileAt(tx + dx, tz + dz); if (!T) continue;
      if (!T.fIdx) {
        T.fIdx = new Map();
        T.faces.forEach((f, k) => {
          for (let j = Math.floor((Math.min(f[1], f[3]) - 5) / FC); j <= Math.floor((Math.max(f[1], f[3]) + 5) / FC); j++)
            for (let c = Math.floor((Math.min(f[0], f[2]) - 5) / FC); c <= Math.floor((Math.max(f[0], f[2]) + 5) / FC); c++) {
              const key = c + '_' + j; let a = T.fIdx.get(key); if (!a) T.fIdx.set(key, (a = [])); a.push(k);
            }
        });
      }
      const a = T.fIdx.get(Math.floor(x / FC) + '_' + Math.floor(z / FC));
      if (a) for (const k of a) if (fn(T.faces[k])) return true;
    }
    return false;
  };
  const segDist = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    return [Math.hypot(px - ax - dx * t, pz - az - dz * t), ax + dx * t, az + dz * t];
  };
  const per = new Map();   // tile key -> { left, edges, planks, inland }
  const row = (key) => { let r = per.get(key); if (!r) per.set(key, (r = { left: 0, edges: 0, planks: 0, inland: 0, faces: 0, at: null })); return r; };
  const shoreTiles = new Set();
  let edgesChecked = 0, metresChecked = 0, excluded = 0;
  // LAND LEFT TO THE WATER, over the rings the compile walls (outer rings 60 m round or longer)
  for (const L of LAND) {
    if (!L.city) continue;   // the New Jersey landing patches: not the city's land, and the backdrop's once NJ_PATCHES=0
    const ring = L.outer;
    let ringLen = 0;
    for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; ringLen += Math.hypot(x2 - x1, z2 - z1); }
    if (ringLen < 60) continue;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      const segL = Math.hypot(x2 - x1, z2 - z1); if (segL < 0.5) continue;
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, tx = Math.floor(mx / TILE), tz = Math.floor(mz / TILE);
      if (!manifest.tiles[tx + '_' + tz]) continue;
      shoreTiles.add(tx + '_' + tz);
      const dx = (x2 - x1) / segL, dz = (z2 - z1) / segL;
      let nx = dz, nz = -dx, found = false;
      for (const pd of [3, 1.6, 5.5]) {
        if (!onLand(mx + nx * pd, mz + nz * pd)) { found = true; break; }
        if (!onLand(mx - nx * pd, mz - nz * pd)) { nx = -nx; nz = -nz; found = true; break; }
      }
      if (!found) continue;   // land on both sides: an edge between two polygons
      const l25 = onLand(mx - nx * 2.5, mz - nz * 2.5);
      if (segL < 8) {
        const strip = l25 && (onLand(mx - nx * 4, mz - nz * 4)
          || (onLand(x1 + (x2 - x1) * 0.25 - nx * 2.5, z1 + (z2 - z1) * 0.25 - nz * 2.5) && onLand(x1 + (x2 - x1) * 0.75 - nx * 2.5, z1 + (z2 - z1) * 0.75 - nz * 2.5)));
        if (!strip) { excluded++; continue; }   // a spike or a tip
      }
      edgesChecked++;
      const ns = Math.max(1, Math.round(segL / 2)), step = segL / ns;
      let left = 0;
      for (let k = 0; k < ns; k++) {
        const px = x1 + dx * step * (k + 0.5), pz = z1 + dz * step * (k + 0.5);
        // land under 3 m deep behind the point: a sliver, or a dock the compile leaves to the water because its far side is
        // one (a marina's T-head, 2 to 3 m wide); a finger pier the walls must hold is 3.25 m and more
        if (!onLand(px - nx * 3, pz - nz * 3)) continue;
        metresChecked += step;
        if (aboveWater(px - nx * 1, pz - nz * 1) || aboveWater(px - nx * 2, pz - nz * 2)) continue;
        if (inBuilding(px - nx * 1, pz - nz * 1) || inBuilding(px - nx * 2, pz - nz * 2)) continue;   // a building stands to the edge
        // a bulkhead face in front of the point (0.2 to 4 m out, on the water's side), whichever way it is wound
        if (facesNear(px, pz, 5, (f) => { const [d, qx, qz] = segDist(px, pz, f[0], f[1], f[2], f[3]); return d <= 4 && (qx - px) * nx + (qz - pz) * nz > 0.2; })) continue;
        left += step;
      }
      if (left > 0) {
        const r = row(tx + '_' + tz);
        r.left += left; r.edges++;
        if (!r.at || left > r.at[2]) { const [lon, lat] = unproject(mx, mz); r.at = [+lat.toFixed(6), +lon.toFixed(6), +left.toFixed(1)]; }
      }
    }
  }
  // PLANKS and FACING INLAND, over every bulkhead face of the shore tiles and their neighbours
  const faceTiles = new Set();
  for (const k of shoreTiles) { const [tx, tz] = k.split('_').map(Number); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (manifest.tiles[(tx + dx) + '_' + (tz + dz)]) faceTiles.add((tx + dx) + '_' + (tz + dz)); }
  // the land rings' edges in an 8 m cell index, for the nearest land to a face
  const edgeIdx = new Map();
  for (const L of LAND) for (const ring of [L.outer]) for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    for (let j = Math.floor(Math.min(az, bz) / FC); j <= Math.floor(Math.max(az, bz) / FC); j++)
      for (let c = Math.floor(Math.min(ax, bx) / FC); c <= Math.floor(Math.max(ax, bx) / FC); c++) {
        const k = c + '_' + j; let a = edgeIdx.get(k); if (!a) edgeIdx.set(k, (a = [])); a.push(ax, az, bx, bz);
      }
  }
  const nearestLand = (x, z, r) => {   // [distance, x, z] of the nearest land ring point within r (else null)
    let best = null;
    for (let j = Math.floor((z - r) / FC); j <= Math.floor((z + r) / FC); j++) for (let c = Math.floor((x - r) / FC); c <= Math.floor((x + r) / FC); c++) {
      const a = edgeIdx.get(c + '_' + j); if (!a) continue;
      for (let k = 0; k < a.length; k += 4) { const q = segDist(x, z, a[k], a[k + 1], a[k + 2], a[k + 3]); if (q[0] <= r && (!best || q[0] < best[0])) best = q; }
    }
    return best;
  };
  let faces = 0, planks = 0, inland = 0, planksNoLand = 0;
  const plank = (r, x, z) => { r.planks++; planks++; if (!r.plankAt) { const [lon, lat] = unproject(x, z); r.plankAt = [+lat.toFixed(6), +lon.toFixed(6)]; } };
  for (const key of faceTiles) {
    const [tx, tz] = key.split('_').map(Number), T = tileAt(tx, tz);
    for (const [ax, az, bx, bz, wnx, wnz] of T.faces) {
      faces++;
      const fx = (ax + bx) / 2, fz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az);
      let px = -(bz - az) / L, pz = (bx - ax) / L;   // one of the face's two horizontal normals
      const r = row(key); r.faces++;
      // a face more than 6 m from any land stands in open water
      const near = nearestLand(fx, fz, 6);
      if (!near) { plank(r, fx, fz); planksNoLand++; continue; }
      // the land's side: the one side with land 4.5 m out; with land on both (across a narrow slip) the side the face is
      // not drawn on; with land on neither (a corner piece past the ring's end) the side of the nearest land
      const sideA = onLand(fx + px * 4.5, fz + pz * 4.5), sideB = onLand(fx - px * 4.5, fz - pz * 4.5);
      if (sideA && sideB) { if (px * wnx + pz * wnz > 0) { px = -px; pz = -pz; } }
      else if (sideA || sideB) {
        if (sideB) { px = -px; pz = -pz; }
        if (px * wnx + pz * wnz > 0.5) { r.inland++; inland++; if (!r.inlandAt) { const [lon, lat] = unproject(fx, fz); r.inlandAt = [+lat.toFixed(6), +lon.toFixed(6)]; } }
      } else if ((near[1] - fx) * px + (near[2] - fz) * pz < 0) { px = -px; pz = -pz; }
      // ground behind it, on lines from its middle and both its ends
      let ground = false;
      for (const [sx, sz] of [[fx, fz], [ax, az], [bx, bz]]) for (let d = 0.5; d <= 6 && !ground; d += 0.5) ground = landGrade(sx + px * d, sz + pz * d);
      if (!ground) plank(r, fx, fz);
    }
  }
  // FRAGMENTS: apron pieces (strips within 1.5 m in a row or overlapping within 1 m across adjacent rows) that reach no land-grade terrain
  // (just past a strip's end or in the row beside it) and have undrawn land beside them (3 m2 or more in the rows just past
  // their strips): pieces of a dock or pier standing out in the water with their walls, the rest of it not drawn
  let fragM2 = 0, fragPieces = 0;
  {
    const Z = [], S = [], E = [];
    for (const key of faceTiles) { const T = tileAt(...key.split('_').map(Number)); for (let i = 0; i < T.strips.length; i += 3) { Z.push(T.strips[i]); S.push(T.strips[i + 1]); E.push(T.strips[i + 2]); } }
    const N = Z.length, par = new Int32Array(N);
    for (let i = 0; i < N; i++) par[i] = i;
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const byRow = new Map();
    for (let i = 0; i < N; i++) { let a = byRow.get(Z[i]); if (!a) byRow.set(Z[i], (a = [])); a.push(i); }
    for (const a of byRow.values()) a.sort((p, q) => S[p] - S[q]);
    for (const [z, a] of byRow) {
      for (let k = 1; k < a.length; k++) if (S[a[k]] <= E[a[k - 1]] + 1.5) uni(a[k], a[k - 1]);
      const b = byRow.get(z + 1); if (!b) continue;
      let j0 = 0;
      for (const i of a) { while (j0 < b.length && E[b[j0]] <= S[i] - 1) j0++; for (let j = j0; j < b.length && S[b[j]] < E[i] + 1; j++) uni(i, b[j]); }
    }
    const grade = (x, z) => { const y = gridAt(x, z); return y !== null && y >= baseY - 0.4; };
    const reaches = new Set();
    for (let i = 0; i < N; i++) {
      const r = find(i); if (reaches.has(r)) continue;
      let ok = grade(S[i] - 0.75, Z[i] + 0.5) || grade(E[i] + 0.75, Z[i] + 0.5);
      for (let x = S[i] - 0.5; !ok && x <= E[i] + 0.5; x += 1) ok = grade(x, Z[i] - 0.5) || grade(x, Z[i] + 1.5);
      if (ok) reaches.add(r);
    }
    // the apron as compile.mjs reads it here: each row's strips as x spans (a strip's slanted ends count whole)
    const spanAt = (x, z) => { const a = byRow.get(Math.floor(z)); if (a) for (const i of a) if (x >= S[i] - 0.05 && x <= E[i] + 0.05) return true; return false; };
    const beside = new Map(), pieceArea = new Map();
    for (let i = 0; i < N; i++) {
      const r = find(i); if (reaches.has(r)) continue;
      let n = beside.get(r) || 0;
      for (let x = S[i] + 0.5; x < E[i]; x += 1) for (const zz of [Z[i] - 0.5, Z[i] + 1.5]) if (onLand(x, zz) && !grade(x, zz) && !spanAt(x, zz)) n++;
      beside.set(r, n); pieceArea.set(r, (pieceArea.get(r) || 0) + E[i] - S[i]);
    }
    const frag = new Set([...beside].filter(([r, n]) => n >= 3 && n >= 0.05 * pieceArea.get(r)).map(([r]) => r));
    fragPieces = frag.size;
    for (let i = 0; i < N; i++) {
      if (!frag.has(find(i))) continue;
      const x = (S[i] + E[i]) / 2, key = Math.floor(x / TILE) + '_' + Math.floor(Z[i] / TILE), r = row(key);
      r.frag = (r.frag || 0) + E[i] - S[i]; fragM2 += E[i] - S[i];
      if (!r.fragAt) { const [lon, lat] = unproject(x, Z[i] + 0.5); r.fragAt = [+lat.toFixed(6), +lon.toFixed(6)]; }
    }
  }
  const failing = [], list = [];
  let left = 0;
  for (const [key, r] of per) {
    left += r.left;
    const fr = r.frag || 0;
    const bad = r.left > maxTile || r.planks > maxPlanks || r.inland > maxInland || fr > maxFrag;
    const e = { tile: key, leftM: +r.left.toFixed(1), edges: r.edges, fragM2: +fr.toFixed(1), planks: r.planks, inland: r.inland, faces: r.faces, at: r.at, fragAt: r.fragAt, plankAt: r.plankAt, inlandAt: r.inlandAt };
    if (bad) failing.push(e);
    if (r.left > 0 || r.planks || r.inland || fr > 0) list.push(e);
  }
  const order = (a, b) => b.fragM2 - a.fragM2 || b.leftM - a.leftM || b.planks - a.planks || b.inland - a.inland;
  list.sort(order); failing.sort(order);
  const maxLeft = list.reduce((m, e) => Math.max(m, e.leftM), 0);
  const overBudget = left > maxShare * metresChecked;   // the whole set: land left to the water over 2 % of the shore checked
  return {
    tilesDir, baseY, thresholds: { leftMPerTile: maxTile, leftShareOfShore: maxShare, fragM2PerTile: maxFrag, planksPerTile: maxPlanks, inlandPerTile: maxInland },
    shoreTiles: shoreTiles.size, edgesChecked, metresChecked: Math.round(metresChecked), spikesAndTipsExcluded: excluded,
    leftM: +left.toFixed(1), leftShare: +(left / Math.max(1, metresChecked)).toFixed(4), maxLeftM: maxLeft, overBudget,
    fragPieces, fragM2: +fragM2.toFixed(1), faces, planks, planksNoLand, inland,
    failing, list: list.slice(0, 200), failed: failing.length > 0 || overBudget, seconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
}

export function shoreLine(r) {
  const t = r.thresholds;
  return `${r.shoreTiles} shore tiles, ${r.metresChecked} m of shore with land behind it (${r.spikesAndTipsExcluded} spikes and tips left out): `
    + `${r.fragPieces} fragments standing in the water (${r.fragM2} m2), ${r.leftM} m left to the water (${(r.leftShare * 100).toFixed(2)} %, at most ${r.maxLeftM} m in a tile); `
    + `${r.faces} bulkhead faces, ${r.planks} with no ground behind them, ${r.inland} facing inland; ${r.failing.length} tiles over the limits `
    + `(${t.fragM2PerTile} m2 of fragments, ${t.leftMPerTile} m left, ${t.planksPerTile} planks, ${t.inlandPerTile} inland)${r.overBudget ? `, and over ${t.leftShareOfShore * 100} % of the shore left to the water` : ''} in ${r.seconds} s`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const dir = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  if (!dir) { console.log('usage: node tools/pipeline/shoregate.mjs <tilesDir> [--json out.json] [--tile 250] [--share 0.02] [--frag 10] [--planks 3] [--inland 3] [--base 3.24]'); process.exit(2); }
  const r = shoreGate(dir, { baseY: +opt('--base', 3.24), maxTile: +opt('--tile', 250), maxShare: +opt('--share', 0.02), maxFrag: +opt('--frag', 10), maxPlanks: +opt('--planks', 3), maxInland: +opt('--inland', 3) });
  console.log(`shore gate: ${shoreLine(r)}`);
  for (const f of r.failing.slice(0, 30)) console.log('  FAIL', JSON.stringify(f));
  for (const f of r.list.filter((e) => !r.failing.includes(e)).slice(0, 15)) console.log('  ', JSON.stringify(f));
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(r, null, 1));
  if (r.failed) { console.log(`SHORE GATE FAILED: ${r.failing.length} tiles over the limits${r.overBudget ? ', and the set over its share of shore left to the water' : ''}`); process.exit(1); }
}
