// Cell package rules shared by the baker's page code (cells/bakeLib.js) and the three.js loader (cells/cellLoader.js),
// so that what a package holds and what the loader takes out of the live city are decided by the same tests.
// Contract: docs/specs/cell-package.md (v0). A cell is a 128 m square of the worldspace, x east, z south, y up, metres.
export const SCHEMA = 'valdrada.cell/0';
export const CELL = 128;
export const cellOf = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)];
export const cellKey = (cx, cz) => `${cx}_${cz}`;
export const parseCellKey = (k) => k.split('_').map(Number);
export const cellOrigin = (cx, cz) => [cx * CELL, cz * CELL];
export const TILE = 512;
export const tileOfCell = (cx, cz) => `${Math.floor((cx * CELL) / TILE)}_${Math.floor((cz * CELL) / TILE)}`;

// instancer pools whose instances change state at run time (the signal lenses and heads, the walk signals): they stay
// live in every mode and are not packaged. The lamp glows (`...Glow`) are packaged as night-only sets.
const DYN_POOL = /^(sigR|sigA|sigG|signalLens|signalHead|pedHand|pedMan|crossingBeacon)$/;
export const isDynamicPool = (name) => DYN_POOL.test(name || '');
export const isGlowPool = (name) => /Glow$/.test(name || '');
// the uniforms that hold the page's state, not a material's look (the near mask of the streamed tiles, the facade hide
// mask of the dressed buildings): never read back as textures
export const DYN_UNIFORMS = new Set(['nearMask', 'uHide', 'hideTex']);   // (the baker also takes the dither frames, uDith<n>, and the
// clocks, recognised by their objects ENV.windT and ENV.time whatever a shader calls them)

// objects that are never city content of a cell: moving actors, the far level, sky and water, labels and helpers
const ACTOR = /^(veh|vehS|ped|pedS|crowd|crowdProp|trains|f24|sit|bus|fleet)[:_]/;
const FAR = /^(macroCrowns_|farTerrain|cp33:farPark|lf39)/;
export function skipReason(o, ctx) {
  if (!(o.isMesh || o.isInstancedMesh)) return 'type';
  if (o.isSkinnedMesh) return 'skinned';
  if (o.userData && o.userData.cellPkg) return 'package';
  const name = o.name || '';
  if (ctx && ctx.movers && name && ctx.movers.has(name)) return 'mover';   // seen moving by the baker (index.json movers)
  if (/^pool[SF]?:/.test(name)) return 'pool';                 // the instancer's pools: by instance (bakeLib / loader)
  if (ACTOR.test(name) || name === 'trains') return 'actor';
  for (let p = o.parent; p; p = p.parent) {
    if (ctx && p === ctx.farGroup) return 'far';
    if (ACTOR.test(p.name || '') || p.name === 'trains') return 'actor';
  }
  if (FAR.test(name)) return 'far';
  if (o.userData && o.userData.nycDress) return 'dress';        // the dresser's output: by building (bakeLib / loader)
  if (name === 'heroes' || (ctx && ctx.heroMat && o.material === ctx.heroMat)) return 'heroes';
  const g = o.geometry;
  if (!g || !g.attributes || !g.attributes.position) return 'nogeo';
  if (g.isInstancedBufferGeometry && !o.isInstancedMesh) return 'custom-instanced';
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (!mats.some((m) => m && m.visible !== false && m.colorWrite !== false)) return 'nocolor';
  if (ctx && ctx.farMat && mats.includes(ctx.farMat)) return 'far';
  // the 46 km water plane and sky / fog shells
  const pa = g.attributes.position;
  if (pa.count === 4 && mats[0] && mats[0].type === 'ShaderMaterial') return 'water';
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (g.boundingSphere && g.boundingSphere.radius > 3000 && mats.every((m) => m && (m.side === 1 || (m.type === 'ShaderMaterial' && !m.lights)))) return 'sky';
  return null;
}

// a triangle's plan centroid (world x, z) for the 3 vertex indices; null for a degenerate triangle (zeroed pool slots)
export function triXZ(pa, e, a, b, c) {
  const ax = pa.getX(a), ay = pa.getY(a), az = pa.getZ(a);
  const bx = pa.getX(b), by = pa.getY(b), bz = pa.getZ(b);
  const cx = pa.getX(c), cy = pa.getY(c), cz = pa.getZ(c);
  if (ax === bx && ay === by && az === bz && ax === cx && ay === cy && az === cz) return null;
  const x = (ax + bx + cx) / 3, y = (ay + by + cy) / 3, z = (az + bz + cz) / 3;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]];
}

// a material's key: what the material is, stable across page loads (no uuids), so a renderer can find its own material
// for a package's primitive. The tile facades carry their tile (each tile has its own hide mask).
// a texture the client draws at run time (canvas, bitmap, data) has no file name: its pixels tell two apart (sampled, once)
const _tc = new WeakMap();
let _cv = null;
function texContent(t, img) {
  const k = t.source || t;
  if (_tc.has(k)) return _tc.get(k);
  let h = '';
  try {
    const data = (img && img.data) || (t.mipmaps && t.mipmaps[0] && t.mipmaps[0].data);
    if (data && data.length) {
      const step = Math.max(1, Math.floor(data.length / 8192));
      let a = 0x811c9dc5;
      for (let i = 0; i < data.length; i += step) { a ^= data[i] & 0xff; a = Math.imul(a, 0x01000193) >>> 0; }
      h = a.toString(16);
    } else if (img && img.width && img.height && typeof document !== 'undefined' && (img.tagName === 'CANVAS' || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) || img.tagName === 'IMG')) {
      if (!_cv) { _cv = document.createElement('canvas'); _cv.width = _cv.height = 32; }
      const cx = _cv.getContext('2d', { willReadFrequently: true });
      cx.clearRect(0, 0, 32, 32); cx.drawImage(img, 0, 0, 32, 32);
      const d = cx.getImageData(0, 0, 32, 32).data;
      let a = 0x811c9dc5;
      for (let i = 0; i < d.length; i++) { a ^= d[i]; a = Math.imul(a, 0x01000193) >>> 0; }
      h = a.toString(16);
    }
  } catch { h = ''; }
  if (h) _tc.set(k, h);
  return h;
}
// a texture's identity at three levels: 0 what it is when made (name, kind, repeat: a file loads later, a canvas may be
// painted over several frames), 1 also its file and size, 2 also a sample of its pixels when it has no file
const texId = (t, level = 1) => {
  if (!t || !t.isTexture) return null;
  if (!level) return `${t.name || ''}|${t.repeat ? t.repeat.x.toFixed(4) + ',' + t.repeat.y.toFixed(4) : ''}`;   // (no kind: a 1 x 1 placeholder is swapped for its KTX2 later)
  const img = t.image || (t.source && t.source.data);
  const src = img && (img.currentSrc || img.src);
  if (level >= 2 && !(src && !String(src).startsWith('data:') && !String(src).startsWith('blob:'))) return texIdBase(t, img, src) + '#' + texContent(t, img);
  return texIdBase(t, img, src);
};
const texIdBase = (t, img, src) => {
  const sz = img ? `${img.width || (img.image && img.image.width) || 0}x${img.height || (img.image && img.image.height) || 0}` : '';
  return `${t.name || ''}|${src && !String(src).startsWith('data:') ? String(src).replace(/^https?:\/\/[^/]+/, '') : ''}|${sz}|${t.isCompressedTexture ? 'c' : ''}${t.isDataTexture ? 'd' : ''}${t.isCanvasTexture ? 'v' : ''}|${t.repeat ? t.repeat.x.toFixed(4) + ',' + t.repeat.y.toFixed(4) : ''}`;
};
// (emissiveIntensity and envMapIntensity are left out: the client sets them by the time of day and when the probes land)
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'specularMap', 'displacementMap', 'transmissionMap'];
const SCAL = ['roughness', 'metalness', 'opacity', 'alphaTest', 'ior', 'transmission', 'thickness', 'clearcoat', 'clearcoatRoughness', 'sheen', 'side', 'blending', 'polygonOffsetFactor', 'polygonOffsetUnits', 'shininess'];
const hash32 = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const hex8 = (n) => ('0000000' + n.toString(16)).slice(-8);
export function materialSignature(m, level = 0) {
  if (!m) return 'none';
  const p = [m.type, m.name || ''];
  for (const k of SCAL) if (typeof m[k] === 'number') p.push(k + '=' + (+m[k].toFixed(5)));
  for (const k of ['transparent', 'vertexColors', 'flatShading', 'depthWrite', 'depthTest', 'polygonOffset', 'fog', 'toneMapped', 'wireframe']) if (typeof m[k] === 'boolean') p.push(k + '=' + (m[k] ? 1 : 0));
  for (const k of ['color', 'emissive', 'sheenColor', 'specularColor', 'attenuationColor']) if (m[k] && m[k].isColor) p.push(k + '=' + m[k].getHexString());
  if (m.normalScale) p.push('ns=' + m.normalScale.x.toFixed(4) + ',' + m.normalScale.y.toFixed(4));
  for (const k of MAPS) { const t = texId(m[k], level); if (t) p.push(k + '=' + t); }
  const obc = m.onBeforeCompile ? String(m.onBeforeCompile) : '';
  if (obc.length > 40) p.push('obc=' + hex8(hash32(obc)));
  let pk = '';
  try { pk = m.customProgramCacheKey ? String(m.customProgramCacheKey()) : ''; } catch { pk = ''; }
  if (pk && pk !== obc) p.push('pk=' + hex8(hash32(pk)));
  if (m.defines) p.push('def=' + Object.keys(m.defines).sort().map((k) => k + ':' + m.defines[k]).join(','));
  if (m.uniforms) {   // names and textures only: a ShaderMaterial's numbers can be clocks that change every frame
    for (const k of Object.keys(m.uniforms).sort()) {
      const v = m.uniforms[k] && m.uniforms[k].value;
      p.push('u.' + k + (v && v.isTexture ? '=' + texId(v, 0) : ''));
    }
  }
  const ud = m.userData || {};
  for (const k of Object.keys(ud).sort()) {
    const v = ud[k];
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') p.push('ud.' + k + '=' + String(v).slice(0, 80));
    else if (v && v.isTexture) p.push('ud.' + k + '=' + texId(v, 0));
    else if (k === 'pbr' && v && typeof v === 'object') { try { p.push('ud.pbr=' + JSON.stringify(v).slice(0, 300)); } catch { /* */ } }
  }
  return p.join(';');
}
// The key hashes the level-0 signature (stable from the moment the material is made). Where several materials of one
// export share it, the baker adds `~t<hash>` (level 1: files and sizes) or `~c<hash>` (level 2: pixel samples), which a
// renderer compares once the textures are in.
export function materialKey(m, tileKey = null, level = 0) {
  const sig = materialSignature(m, 0);
  let key = `${(m && m.name ? m.name : (m ? m.type : 'none')).replace(/[^A-Za-z0-9:_\-|.]/g, '_').slice(0, 48)}#${hex8(hash32(sig))}${hex8(hash32(sig + '/2'))}`;
  if (m && m.userData && m.userData.isFacade && tileKey) key += '@' + tileKey;
  if (level) key += '~' + (level === 1 ? 't' : 'c') + hex8(hash32(materialSignature(m, level)));
  return key;
}
export const keyLevel = (k) => (k.includes('~c') ? 2 : k.includes('~t') ? 1 : 0);
export const baseKey = (k) => k.split('~')[0];
