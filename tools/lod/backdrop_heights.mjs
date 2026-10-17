// The backdrop's ground heights as a function (docs/notes/r2-backdrop.md): the 8 m grid that the backdrop's terrain, its
// buildings' bases and its far levels are drawn from (client/tools/pipeline/backdrop/heights.py: the USGS 3DEP DEM in
// metres NAVD88, joined to the city's ground along the land borders, land never under 1 m over the water plane), so other
// generators (the bridge records' New Jersey ends) stand on the same ground the backdrop draws.
//
//   import { backdropHeights } from './backdrop_heights.mjs';
//   const H = backdropHeights();          // <records>/ground8.json + ground8.npy (BD_REC, default the lane's records)
//   H.at(x, z)                            // world metres -> ground height in metres (bilinear), null outside the grid
//   H.meta                                // { x0, z0, x1, z1, step, nx, nz, ... } of the grid
//
// Rows are read from the file as they are needed (a grid row is 53 KB; the file is 654 MB), so a few thousand lookups
// along a bridge's approach cost a few megabytes.
//   node tools/lod/backdrop_heights.mjs <x> <z> [<x> <z> ...]      prints the heights (a check)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REC = process.env.BD_REC || '/data0/projectnyc_aux/tiles_backdrop/records';

export function backdropHeights(rec = DEFAULT_REC) {
  const meta = JSON.parse(fs.readFileSync(path.join(rec, 'ground8.json'), 'utf8'));
  const file = path.join(rec, 'ground8.npy');
  const fd = fs.openSync(file, 'r');
  // the .npy header: magic, version, header length, a Python dict with descr, fortran_order and shape
  const pre = Buffer.alloc(12);
  fs.readSync(fd, pre, 0, 12, 0);
  if (pre.toString('latin1', 1, 6) !== 'NUMPY') throw new Error(`not an .npy file: ${file}`);
  const major = pre[6];
  const hlen = major >= 2 ? pre.readUInt32LE(8) : pre.readUInt16LE(8);
  const hoff = major >= 2 ? 12 : 10;
  const hdr = Buffer.alloc(hlen);
  fs.readSync(fd, hdr, 0, hlen, hoff);
  const h = hdr.toString('latin1');
  if (!/'descr':\s*'<f4'/.test(h) || /'fortran_order':\s*True/.test(h)) throw new Error(`ground8.npy: expected little-endian float32 in C order (${h.trim()})`);
  const shape = /'shape':\s*\((\d+),\s*(\d+)\)/.exec(h);
  const nz = +shape[1], nx = +shape[2];
  if (nz !== meta.nz || nx !== meta.nx) throw new Error(`ground8.npy is ${nz} x ${nx}, ground8.json says ${meta.nz} x ${meta.nx}`);
  const data0 = hoff + hlen;
  const rows = new Map();   // row index -> Float32Array (a small cache, oldest dropped first)
  const row = (j) => {
    let r = rows.get(j);
    if (r) return r;
    const b = Buffer.alloc(nx * 4);
    fs.readSync(fd, b, 0, nx * 4, data0 + j * nx * 4);
    r = new Float32Array(b.buffer, b.byteOffset, nx);
    rows.set(j, r);
    if (rows.size > 512) rows.delete(rows.keys().next().value);
    return r;
  };
  const { x0, z0, step } = meta;
  return {
    meta,
    at(x, z) {
      const fx = (x - x0) / step, fz = (z - z0) / step;
      if (!(fx >= 0 && fz >= 0 && fx <= nx - 1 && fz <= nz - 1)) return null;
      const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz));
      const tx = fx - i, tz = fz - j;
      const a = row(j), b = row(j + 1);
      return a[i] * (1 - tx) * (1 - tz) + a[i + 1] * tx * (1 - tz) + b[i] * (1 - tx) * tz + b[i + 1] * tx * tz;
    },
    close() { fs.closeSync(fd); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2).map(Number);
  const H = backdropHeights();
  for (let k = 0; k + 1 < a.length; k += 2) console.log(`${a[k]} ${a[k + 1]} -> ${H.at(a[k], a[k + 1])}`);
  H.close();
}
