// OV39 overlay gate: do a tile set's baked overlays (LF39, GF38) apply to its tiles?
//
//   node tools/pipeline/overlaygate.mjs <tilesDir> [--json out.json]
//
// The overlays are read where the page reads them (shared/overlay.js): <tilesDir>/overlays/lf39.json and
// <tilesDir>/overlays/gf38/index.json if the set has them, else public/data/lf39/lf39.json and public/data/gf38/index.json.
// Every entry is checked against its tile: a keyed entry by the tile's content key, an old entry by file size. A stale
// entry (the tile's content changed since the bake) is listed; the exit code is 1 when any entry is stale or an overlay is
// missing, so a compile or a swap that would drop an overlay fails here instead of in silence on the page.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseTile } from '../../src/world/tiledata.js';
import { tileContentKey } from '../../src/shared/overlay.js';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function locate(tilesDir, rel, legacy) {
  const own = path.join(tilesDir, 'overlays', rel);
  if (fs.existsSync(own)) return { file: own, local: true };
  const leg = path.join(CLIENT, 'public', legacy);
  return fs.existsSync(leg) ? { file: leg, local: false } : null;
}

export function overlayGate(tilesDir) {
  const man = JSON.parse(fs.readFileSync(path.join(tilesDir, 'manifest.json'), 'utf8'));
  const keyOf = new Map();
  const tileKey = (k) => {
    if (keyOf.has(k)) return keyOf.get(k);
    const ent = man.tiles[k];
    if (!ent) { keyOf.set(k, null); return null; }
    const b0 = fs.readFileSync(path.join(tilesDir, ent.f));
    const r = { ckey: tileContentKey(parseTile(b0.buffer.slice(b0.byteOffset, b0.byteOffset + b0.byteLength))), bytes: b0.byteLength };
    keyOf.set(k, r);
    return r;
  };
  const check = (name, src, entries, count) => {
    const res = { name, file: src ? path.relative(CLIENT, src.file) : null, ownSet: !!(src && src.local), tiles: 0, stale: [], noTile: [], ...count };
    if (!src) { res.missing = true; return res; }
    for (const [k, e] of Object.entries(entries)) {
      res.tiles++;
      const t = tileKey(k);
      if (!t) { res.noTile.push(k); continue; }
      const ok = e.ckey ? e.ckey === t.ckey : e.bytes === t.bytes;
      if (!ok) res.stale.push(k);
    }
    return res;
  };
  const out = [];
  const lf = locate(tilesDir, 'lf39.json', 'data/lf39/lf39.json');
  const L = lf ? JSON.parse(fs.readFileSync(lf.file, 'utf8')) : { tiles: {} };
  const lt = Object.values(L.tiles || {});
  out.push(check('lf39', lf, L.tiles || {}, {
    buildings: lt.reduce((s, v) => s + (v.b || []).length, 0), stalls: lt.reduce((s, v) => s + (v.p || []).length, 0),
    trees: lt.reduce((s, v) => s + (v.t || []).length, 0), unkeyed: lt.filter((v) => !v.ckey).length,
  }));
  const gf = locate(tilesDir, 'gf38/index.json', 'data/gf38/index.json');
  const G = gf ? JSON.parse(fs.readFileSync(gf.file, 'utf8')) : { tiles: {} };
  const gt = Object.values(G.tiles || {});
  out.push(check('gf38', gf, G.tiles || {}, {
    tris: gt.reduce((s, v) => s + Object.values(v.tris || {}).reduce((a, b) => a + b, 0), 0), unkeyed: gt.filter((v) => !v.ckey).length,
  }));
  const failed = out.some((r) => r.missing || r.stale.length);
  return { tilesDir, overlays: out, failed };
}

export function overlayLine(r) {
  return r.overlays.map((o) => o.missing ? `${o.name} MISSING`
    : `${o.name} ${o.tiles} tiles${o.buildings != null ? `, ${o.buildings} buildings, ${o.stalls} stalls, ${o.trees} trees` : `, ${o.tris} triangles`}`
      + ` (${o.ownSet ? "the set's own" : 'public/data'}), ${o.stale.length} stale${o.stale.length ? ' [' + o.stale.slice(0, 12).join(' ') + (o.stale.length > 12 ? ' ...' : '') + ']' : ''}`
      + (o.unkeyed ? `, ${o.unkeyed} unkeyed (old bake)` : '') + (o.noTile.length ? `, ${o.noTile.length} for tiles the set lacks` : '')).join(' | ');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
  if (!dir) { console.log('usage: node tools/pipeline/overlaygate.mjs <tilesDir> [--json out.json]'); process.exit(2); }
  const r = overlayGate(path.resolve(dir));
  console.log(`overlay gate: ${overlayLine(r)}`);
  const j = args.indexOf('--json');
  if (j >= 0) fs.writeFileSync(args[j + 1], JSON.stringify(r, null, 1));
  if (r.failed) { console.log('OVERLAY GATE FAILED: re-bake the overlays against this set (compile.mjs does it into <tiles>/overlays/; for the copy in public/data: tools/ar34/ground/gf38_dump.mjs + gf38_bake.py, then tools/ar34/lotfix/lf39_bake.mjs)'); process.exit(1); }
}
