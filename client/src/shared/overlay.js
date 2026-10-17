// Baked overlays (LF39 world/lotfix39.js, GF38 city/groundFix38.js): data baked against compiled tiles and applied at load.
//
// LF39 and GF38 used to apply only to a tile whose file had the byte size they were baked against. Every five-borough
// recompile changes every file's size, so both went silent after the run 6 swap (53 West 53rd and 32 more buildings, the
// paving of 125th Street's bare ground). Two rules replace that:
//   * content keys: an overlay entry carries the key of the compiled tile content it read (tileContentKey: the buildings,
//     the terrain and the ground sections), so it applies wherever that content is unchanged, whatever else a recompile
//     touched, and a tile whose content did change is refused with a warning (never silently);
//   * overlays travel with their tile set: the compile bakes them into <tiles>/overlays/ (compile.mjs, the overlays step),
//     and the page reads <tiles>/overlays/<name> first and the copy in public/data second.
// tools/pipeline/overlaygate.mjs checks a set's overlays against its tiles (the compile runs it; a swap should too).

// the tile set the page draws (world/streamer.js: `?tiles=` or tiles/); the headless core sets globalThis.VALDRADA_TILES_BASE
export function tilesBase() {
  if (typeof globalThis !== 'undefined' && globalThis.VALDRADA_TILES_BASE) return globalThis.VALDRADA_TILES_BASE;
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tiles') : null;
  return q || 'tiles';
}

// the first of <tiles>/overlays/<rel> and the legacy path that exists: { url, res, local } or null. A dev server answers a
// missing file with its index page, so an HTML answer counts as missing.
export async function fetchOverlay(rel, legacy) {
  for (const [url, local] of [[`${tilesBase()}/overlays/${rel}`, true], [legacy, false]]) {
    if (!url) continue;
    let r = null;
    try { r = await fetch(url); } catch { r = null; }
    if (r && r.ok && (r.headers?.get?.('content-type') || '').indexOf('html') < 0) return { url, res: r, local };
  }
  return null;
}

// The content key of a compiled tile: a 64-bit hash (two 32-bit lanes, hex) over the sections an overlay reads, in name
// order: the building records and rings (bldg, bldgXZ, bholes), the terrain grid, and every ground section (Float32,
// 9 floats a triangle). Furniture, road records and names are left out: a recompile that only changes those keeps the key.
// Computed on the tile as parsed, before any load-time pass appends to its sections.
const KEY_FIXED = new Set(['bldg', 'bldgXZ', 'bholes', 'terrain']);
const KEY_SKIP = new Set(['roadVerts', 'rtopA']);
export function tileContentKey(tile) {
  const S = tile.S;
  const names = Object.keys(S).filter((n) => KEY_FIXED.has(n) || (!KEY_SKIP.has(n) && S[n] instanceof Float32Array && S[n].length % 9 === 0)).sort();
  let h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0;
  for (const n of names) {
    const a = S[n];
    if (!a || !a.byteLength) continue;
    for (let i = 0; i < n.length; i++) { const c = n.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 0x85ebca6b); }
    const n4 = a.byteLength >> 2;
    const u = a.byteOffset % 4 === 0 ? new Uint32Array(a.buffer, a.byteOffset, n4) : new Uint32Array(new Uint8Array(a.buffer, a.byteOffset, n4 * 4).slice().buffer);
    for (let i = 0; i < n4; i++) {
      const w = u[i];
      h1 = Math.imul(h1 ^ w, 16777619);
      h2 = Math.imul(h2 ^ ((w >>> 16) | (w << 16)), 0x85ebca6b);
      h2 ^= h2 >>> 13;
    }
    for (let i = n4 * 4; i < a.byteLength; i++) { const c = new Uint8Array(a.buffer, a.byteOffset + i, 1)[0]; h1 = Math.imul(h1 ^ c, 16777619); }
    h1 = Math.imul(h1 ^ a.byteLength, 16777619);
    h2 = Math.imul(h2 ^ a.byteLength, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

// whether an overlay entry applies to a parsed tile (ckey: its content key, computed before any pass changed it):
// a keyed entry by key, an old entry by file size
export function entryApplies(e, ckey, byteLength) {
  if (!e) return false;
  return e.ckey ? e.ckey === ckey : e.bytes === byteLength;
}

// one warning per tile and overlay when an entry does not apply (the guard used to skip in silence)
const _warned = new Set();
export function warnStale(name, key, e, ckey) {
  const w = `${name}:${key}`;
  if (_warned.has(w)) return;
  _warned.add(w);
  if (typeof window !== 'undefined') { const W = (window.__overlayStale = window.__overlayStale || {}); (W[name] = W[name] || []).push(key); }
  console.warn(`[${name}] tile ${key}: its compiled content is not the one this overlay was baked against (${e.ckey ? `key ${e.ckey}, tile ${ckey}` : `${e.bytes} bytes`}); `
    + `not applied. Re-bake (tools/pipeline/overlaygate.mjs lists the stale tiles).`);
}
