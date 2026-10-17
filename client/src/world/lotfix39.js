// LF39 (LOTFIX, docs/notes/ar34-lotfix.md; `?lf39=0` off): the ground the compiled tiles leave as an empty lot where the
// city is built or in use, from tools/ar34/lotfix/lf39_bake.mjs (public/data/lf39/lf39.json):
//   * buildings in the current NYC Building Footprints that our footprint export lacks (53 W 53rd St and 32 more inside the
//     trailer and shorts views), as ordinary 44-byte tile records styled by the compiler's classify() from PLUTO, so the
//     facade shader, the roofs, the harvest (Cycles, Unreal) and the far LoD (lf39Macro) all take them like any other;
//   * the parked cars of the city's parking lots (NYC Planimetric "Parking Lot", the lots GF38 paves): traffic.js parks
//     them with the kerb cars (lf39Stalls);
//   * the NYCHA grounds (Manhattanville and General Grant Houses): their bare terrain as lawn at the compiled lawn height and
//     full-size campus trees, which the street-tree census never reaches (t7ValleyTrain, owner 2026-10-09: "there isn't an
//     empty lot there in real life").
// OV39 (shared/overlay.js): an entry applies to the compiled tile content it was baked against (its content key), read
// from the tile set's own overlays/lf39.json first; a tile whose content changed keeps its compiled content, with a warning.
import { FURN } from '../shared/geo.js';
import { fetchOverlay, entryApplies, warnStale } from '../shared/overlay.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const LF39 = !(Q && Q.get('lf39') === '0');

let _data = null, _p = null;
const _applied = new Set();
export function lf39Load() {
  if (!_p) _p = !LF39 || typeof fetch === 'undefined' ? Promise.resolve(null)
    : fetchOverlay('lf39.json', 'data/lf39/lf39.json').then((o) => (o ? o.res.json() : null)).catch(() => null).then((d) => (_data = d));
  return _p;
}
const cat = (A, B) => { const m = new A.constructor(A.length + B.length); m.set(A, 0); m.set(B, A.length); return m; };

// append the tile's baked buildings, trees and lawn to its sections (world/assemble.js, straight after parseTile, before
// anything reads the buildings, the furniture or the ground)
// ckey: the tile's content key (shared/overlay.js tileContentKey), taken before anything changed its sections
export function lf39Apply(key, tile, byteLength, data, ckey = null) {
  if (!LF39 || !data || !tile || !tile.S || tile.lf39Done) return 0;
  const e = data.tiles && data.tiles[key];
  if (!e) return 0;
  if (!entryApplies(e, ckey, byteLength)) { warnStale('lf39', key, e, ckey); return 0; }
  tile.lf39Done = true; _applied.add(key);
  const S = tile.S;
  let n = 0;
  if (e.b && e.b.length) {
    const old = S.bldg, nOld = old.byteLength, rec = new Uint8Array(nOld + e.b.length * 44);
    rec.set(new Uint8Array(old.buffer, old.byteOffset, nOld), 0);
    const dv = new DataView(rec.buffer), xz = [];
    let start = S.bldgXZ.length / 2;
    e.b.forEach((b, i) => {
      const o = nOld + i * 44;
      dv.setUint32(o, start, true); dv.setUint16(o + 4, b.ring.length, true); dv.setInt16(o + 6, 0, true);
      dv.setFloat32(o + 8, b.baseY, true); dv.setFloat32(o + 12, b.h, true);
      dv.setUint8(o + 16, b.floors); dv.setUint8(o + 17, b.style);
      dv.setUint8(o + 18, b.rgb[0]); dv.setUint8(o + 19, b.rgb[1]); dv.setUint8(o + 20, b.rgb[2]);
      dv.setUint8(o + 21, b.roofKind); dv.setUint8(o + 22, b.flags); dv.setUint8(o + 23, b.lit);
      dv.setFloat32(o + 24, b.floorH, true); dv.setFloat32(o + 28, b.winW, true); dv.setFloat32(o + 32, b.storeH, true);
      dv.setUint32(o + 36, 0, true); dv.setUint16(o + 40, Math.min(65000, b.area | 0), true);
      dv.setUint8(o + 42, b.colorVar); dv.setUint8(o + 43, 0);   // no party walls known, frontage unknown
      for (const [x, z] of b.ring) xz.push(x, z);
      start += b.ring.length;
    });
    S.bldg = rec; S.bldgXZ = cat(S.bldgXZ, Float32Array.from(xz)); n += e.b.length;
  }
  if (e.t && e.t.length) {   // campus trees: FURN.TREE records (tile-local x/z, absolute y), p2 0 = full allometry
    const old = S.furn && S.furn.byteLength ? S.furn : new Uint8Array(0), nOld = old.byteLength, rec = new Uint8Array(nOld + e.t.length * 20);
    rec.set(new Uint8Array(old.buffer, old.byteOffset, nOld), 0);
    const dv = new DataView(rec.buffer);
    e.t.forEach(([x, y, z, sp, dbh, rot], i) => {
      const o = nOld + i * 20;
      dv.setUint8(o, FURN.TREE); dv.setUint8(o + 1, sp); dv.setUint8(o + 2, dbh); dv.setUint8(o + 3, 0);
      dv.setFloat32(o + 4, x, true); dv.setFloat32(o + 8, y, true); dv.setFloat32(o + 12, z, true); dv.setFloat32(o + 16, rot, true);
    });
    S.furn = rec; n += e.t.length;
  }
  if (e.g && e.g.length) {   // lawn runs [x, z, length along x] (tile-local) at the compiled lawn height, two up-facing triangles each
    const c = e.cell || 1.5, y = e.gy, add = new Float32Array((e.g.length / 3) * 18);
    for (let i = 0, o = 0; i < e.g.length; i += 3) {
      const x0 = e.g[i], z0 = e.g[i + 1], x1 = x0 + e.g[i + 2], z1 = z0 + c;
      add.set([x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1], o); o += 18;
    }
    S.grass = S.grass && S.grass.length ? cat(S.grass, add) : add; n += add.length / 9;
  }
  if (typeof window !== 'undefined') { const W = (window.__lf39 = window.__lf39 || { tiles: 0, bldg: 0, trees: 0, lawnTris: 0 }); W.tiles++; W.bldg += (e.b || []).length; W.trees += (e.t || []).length; W.lawnTris += ((e.g || []).length / 3) * 2; }
  return n;
}

// the parked cars of the tile's parking lots: [x, y, z, yaw, hash] in world metres (traffic.js _parkTile), only for a tile
// whose sections LF39 extended (the same compiled file the stalls were laid out on)
export function lf39Stalls(key) {
  if (!LF39 || !_data || !_applied.has(key)) return [];
  const e = _data.tiles && _data.tiles[key];
  return (e && e.p) || [];
}

// the far LoD boxes of the macro tile (streamer.js _fetchMacro): { pos: Int16Array, col: Uint8Array } or null
export function lf39Macro(key, data) {
  if (!LF39 || !data || !data.macros) return null;
  const m = data.macros[key];
  return m && m.pos.length ? { pos: Int16Array.from(m.pos), col: Uint8Array.from(m.col) } : null;
}
