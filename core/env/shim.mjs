// The browser globals the page's simulation modules touch, for a headless Node process (no WebGL, no DOM).
//
// - `location` stays undefined unless the caller sets it (only `location.search` is ever read): undefined, every `?flag=`
//   in the sim modules takes the page's default; tools/core/take.mjs sets the recorder's page query before the sim modules
//   load, so every flag is the take's.
// - `fetch` of a relative or root path reads client/public/<path> from disk (the data files the sims ask for:
//   data/columbia_campus.json, data/lf39/lf39.json, ...).
// - `document.createElement('canvas')` returns an inert canvas (a few material builders paint a texture at construction;
//   the core never draws them).
// - `Math.random` is replaced by a seeded generator (seedRandom) so a take is a pure function of (tiles, seed, steps).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT = path.join(ROOT, 'client');
export const PUBLIC = path.join(CLIENT, 'public');

const fetchLog = [];
export const shimStats = { fetches: fetchLog };

function diskResponse(rel) {
  const p = path.join(PUBLIC, rel.replace(/^\/+/, '').split('?')[0]);
  if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) { fetchLog.push([rel, 404]); return new Response(null, { status: 404 }); }
  fetchLog.push([rel, 200]);
  return new Response(fs.readFileSync(p), { status: 200 });
}
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const s = typeof url === 'string' ? url : url?.url ?? String(url);
  if (/^[a-z]+:\/\//i.test(s)) return nodeFetch(url, opts);
  // OV39: the overlays of the tile set the core runs on (shared/overlay.js reads <tiles>/overlays/ by absolute path)
  const tb = globalThis.VALDRADA_TILES_BASE;
  if (tb && s.startsWith(tb + '/')) {
    if (!fs.existsSync(s)) { fetchLog.push([s, 404]); return new Response(null, { status: 404 }); }
    fetchLog.push([s, 200]);
    return new Response(fs.readFileSync(s), { status: 200 });
  }
  return diskResponse(s);
};

// inert 2D canvas: every call is a no-op, every property read is harmless
function inertCtx() {
  const target = { canvas: null, measureText: (t) => ({ width: String(t).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}
function inertCanvas() {
  const c = { width: 1, height: 1, style: {}, getContext() { const x = inertCtx(); x.canvas = c; return x; }, toDataURL: () => 'data:,', addEventListener() {}, removeEventListener() {} };
  return c;
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? inertCanvas() : { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }),
    createElementNS: (ns, tag) => globalThis.document.createElement(tag),
    body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {},
  };
}
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = class { constructor(w, h) { Object.assign(this, inertCanvas(), { width: w, height: h }); } };
if (typeof globalThis.requestAnimationFrame === 'undefined') globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
// the viewport a few modules read for an aspect (sim/trains.js cue camera): 16:9 as the core's camera
if (typeof globalThis.innerWidth === 'undefined') { globalThis.innerWidth = 1920; globalThis.innerHeight = 1080; }

// ---- seeded Math.random (sfc32, seeded through splitmix32): the sims draw every choice from Math.random
const nativeRandom = Math.random;
export function seedRandom(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const sm = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
  let a = sm(), b = sm(), c = sm(), d = sm();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
    const r = (t + d) | 0; c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  Math.random = next;
  return next;
}
export function unseedRandom() { Math.random = nativeRandom; }
