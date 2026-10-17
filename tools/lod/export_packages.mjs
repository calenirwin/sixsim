#!/usr/bin/env node
// The persistent tier (L6, L5, L4) and the landmark registry as packages in the cell format (docs/specs/cell-package.md,
// section 12), so Unreal (tools/ue/) and Blender load the same skyline three.js draws with ?lod16=1.
//
//   node tools/lod/export_packages.mjs [--levels 6,5,4] [--src client/public/data/lod16] [--out /data0/projectnyc_aux/cellcache/lod16]
//        [--only L6_0_0] [--nomeshopt]
//
// Input: the chunk files of tools/lod/build_persistent.mjs (CTL1: pos Int16 x3 at 1/4 m about the chunk centre, col
// Uint8 x4 = albedo sRGB byte + lit share, uv Float32 x2, idx Uint32, bk Uint32 + the header's bkeys; the L6 ones also
// gpos/gidx, the ground) and the registry (client/public/data/landmarks.json + data/lod16/landmarks_l6.bin).
// Output, content-addressed like the cell cache: <out>/<hash>/cell.glb + meta.json per chunk or landmark, <out>/index.json.
// <hash>: the first 24 hex digits of SHA-256 over the exporter's version and options and the source file's bytes; an
// entry already in the cache is not rewritten (and never deleted).
// R2B (2026-10-11): the water is content at the far level (docs/specs/cell-package.md sections 7 and 12): every L6 chunk
// with water carries a `water` node (the page's plane at y 0 over its square's real water, tools/lod/water_l6.py; land
// outside the city stays empty), and the L6 squares round the city with water alone are chunks of it (`waterOnly`), so
// renderers that draw the packages have the rivers, the harbour and the sea; three.js keeps its own plane.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTile } from '../../client/src/world/tiledata.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const SRC = path.resolve(root, opt('src', 'client/public/data/lod16'));
const OUT = path.resolve(opt('out', '/data0/projectnyc_aux/cellcache/lod16'));
const CACHE = path.dirname(OUT);   // the cell cache root: the shared texture store is <CACHE>/tex
const LEVELS = opt('levels', '6,5,4,3').split(',').map(Number);   // (BD40: L3, the backdrop's and the city's under it)
const ONLY = opt('only');
// --plain: self-contained uncompressed copies for readers without meshopt (Blender, Unreal's Interchange), as the cell
// cache's plain/<region>/<cell>.glb: <cache>/plain/lod16/<key>.glb and its own index.json
const PLAIN = opt('plain') === '1';
const MESHOPT = opt('nomeshopt') !== '1' && !PLAIN;
const PLAIN_DIR = path.join(path.dirname(path.resolve(opt('out', '/data0/projectnyc_aux/cellcache/lod16'))), 'plain', 'lod16');
const VERSION = 'valdrada lod16 export v0';

const req = createRequire(path.join(root, 'tools', 'assets', 'package.json'));
const imp = (name) => import(pathToFileURL(req.resolve(name)).href);
const { Document, NodeIO } = await imp('@gltf-transform/core');
const { EXTMeshoptCompression } = await imp('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');
if (MESHOPT) await MeshoptEncoder.ready;

const t0 = Date.now();
const log = (...a) => console.log(`[lod16 export ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readCTL = (file) => { const b = fs.readFileSync(file); return { buf: b, t: parseTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }; };
fs.mkdirSync(OUT, { recursive: true });

// ---- the shared texture store: the FW14 far window grid the shell material multiplies its walls by
const fw14Png = fs.readFileSync(path.join(root, 'client/public/textures/far_windows_fw14.png'));
const fw14File = `tex/${sha(fw14Png).slice(0, 24)}.png`;
if (!fs.existsSync(path.join(CACHE, fw14File))) { fs.mkdirSync(path.join(CACHE, 'tex'), { recursive: true }); fs.writeFileSync(path.join(CACHE, fw14File), fw14Png); }

// ---- materials (section 4: named by key, the glTF factors as a stand-in, the three.js description in extras)
const SHELL = {
  type: 'MeshBasicMaterial', name: 'lod16Shell', side: 0, transparent: false, alphaTest: 0, opacity: 1, vertexColors: true,
  depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2, color: [1, 1, 1],
  textures: { map: { uri: 'textures/far_windows_fw14.png', file: fw14File, colorSpace: 'srgb', wrap: [1000, 1000], repeat: [1, 1], offset: [0, 0], channel: 0 } },
  userData: {
    lod16: {
      shader: 'client/src/lod/shellMaterial.js (world/materials.js makeFarMaterial, patched)',
      albedo: 'COLOR_0, linear (the client stores the sRGB byte and squares it; the package holds the square)',
      lighting: 'flat facet normals; ambient sky x city AO x 0.5 sky-view on walls; sun x N.L, none under the horizon',
      windowGrid: { texture: 'map', tileMetres: [12, 15.2], bays: 4, floors: 4, uv: 'TEXCOORD_0: along the wall from the world origin / 12, height / 15.2; roofs on texel (0.06, 0.24)' },
      night: { attribute: '_lit', chancePerBay: 0.28, glazed: [0.70, 0.65], colour: [1.0, 0.82, 0.5], strength: 1.1, octaves: 'bays taken 2^k at a time where a bay is under 2 px (same chance, same mean)', wallsOnly: true },
      fade: 'screen-space dither between levels (uFade, uFadeMode); renderers with their own level switching may ignore it',
    },
  },
};
const GROUND = {
  type: 'ShaderMaterial', name: 'lod16Ground', side: 0, vertexColors: false, color: [0.36, 0.34, 0.30],
  userData: { lod16: { shader: 'world/materials.js makeGroundMaterial, the far terrain (matId 8)', matId: 8, note: 'the macro terrain grids 0.5 m low; open water is left to the water plane' } },
};
// ==== R2B (2026-10-11): the water as content. The page's water plane (client/src/main.js: y 0, the client's
// makeWaterMaterial) is packaged at the far level: every L6 chunk carries a `water` node, one quad over its 8,192 m square at
// y 0 (land in the cells and chunks stands ~3 m over it, river beds ~3.6 m under it), so a renderer that draws the packages
// draws the rivers and the harbour from here. three.js keeps its own plane and does not read this node.
const WATER = {
  type: 'ShaderMaterial', name: 'lod16Water', side: 0, transparent: false, vertexColors: false, color: [0.05, 0.09, 0.11],
  userData: { lod16: { shader: "world/materials.js makeWaterMaterial (the page's water plane, client/src/main.js)", y: 0, note: 'one quad per L6 chunk at y 0; land stands over it, river beds lie under it' } },
};
// The water of each L6 square is clipped to real water (tools/lod/water_l6.py: the charts' depth areas and the strip to the
// city's bulkheads, triangulated; client/data/raw/water_l6.json): land outside the city (New Jersey, Westchester, Nassau)
// gets none and stays empty until there is land there. Without that file no water is written.
const WATER_L6 = (() => {
  // (BD40: --water <dir> reads a staged water_l6.json)
  const f = opt('water') ? path.join(path.resolve(opt('water')), 'water_l6.json') : path.join(root, 'client', 'data', 'raw', 'water_l6.json');
  if (!fs.existsSync(f)) { console.warn('[lod16 export] no client/data/raw/water_l6.json (tools/lod/water_l6.py): the L6 chunks get no water'); return null; }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
})();
const waterOf = (ck) => (WATER_L6 && WATER_L6.squares[ck] && WATER_L6.squares[ck].tris.length ? WATER_L6.squares[ck].tris : null);
// ==== end R2B
// ==== BD40 (backdrop lane): the backdrop's ground (tools/lod/backdrop_ground.py, build_backdrop.mjs): each chunk's own
// top-down texture as the base colour (embedded JPEG, sRGB) and its night map as the emissive texture (factor 0: the
// renderer switches it on after dark, as three.js's ENV.night does); smooth normals from the terrain; COLOR_0 the skirts'
// shade. The buildings take the far city's shell material.
const BDGROUND = {
  type: 'MeshBasicMaterial', name: 'lod16BdGround', side: 0, vertexColors: false, color: [1, 1, 1],
  userData: { lod16: { shader: 'client/src/lod/groundMaterial.js', map: 'baseColorTexture (sRGB): the chunk\'s ground (land cover, roads, railways, canopy, water the charts leave dry)',
    night: 'emissiveTexture (grey): street lights and lit lots, colour (1, 0.68, 0.36) to (1, 0.93, 0.82) by place, x night x 1.4, squared',
    shade: 'COLOR_0 (grey): 1 on the ground, 0.47 on the skirts (the shore\'s bank, the cracks between levels)', fade: 'uFade, uFadeMode as the shells' } },
};
// ==== end BD40
const keyOf = (md) => `${md.name}#${sha(JSON.stringify(md)).slice(0, 16)}`;
SHELL.key = keyOf(SHELL); GROUND.key = keyOf(GROUND); WATER.key = keyOf(WATER); BDGROUND.key = keyOf(BDGROUND);
function material(doc, md, rough) {
  const { key, ...three } = md;
  return doc.createMaterial(key).setBaseColorFactor([...md.color.map((c) => Math.min(1, c)), 1]).setRoughnessFactor(rough).setMetallicFactor(0)
    .setDoubleSided(false).setAlphaMode('OPAQUE').setExtras({ key, three });
}
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
function newDoc() {
  const doc = new Document();
  doc.getRoot().getAsset().generator = VERSION;
  if (MESHOPT) doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return doc;
}
// flat per-face normals on per-face vertices (walls own their 4 vertices; roof polygons share theirs, all facing up)
function faceNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) continue;
    nx /= L; ny /= L; nz /= L;
    for (const o of [a, b, c]) { N[o] = nx; N[o + 1] = ny; N[o + 2] = nz; }
  }
  for (let v = 0; v < N.length; v += 3) if (!N[v] && !N[v + 1] && !N[v + 2]) N[v + 1] = 1;
  return N;
}
// the shell / landmark primitive: POSITION (relative to the package origin), NORMAL, TEXCOORD_0, COLOR_0 (linear albedo),
// _lit (the night window chance's lit share, 0..1), _bkey (uint32 index into extras.buildings), _ao (BD40: the open-sky
// share, 0..1; 0 where the chunk had none, read as 1); every vertex attribute
// 4-byte aligned (float32, or uint32 for the key)
function shellPrim(doc, buffer, mat, pos, scale, dx, dy, dz, col, uv, idx, bk, ao = null) {
  const nv = pos.length / 3, P = new Float32Array(nv * 3), C = new Float32Array(nv * 3), Lt = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    P[v * 3] = pos[v * 3] * scale + dx; P[v * 3 + 1] = pos[v * 3 + 1] * scale + dy; P[v * 3 + 2] = pos[v * 3 + 2] * scale + dz;
    for (let k = 0; k < 3; k++) { const s = col[v * 4 + k] / 255; C[v * 3 + k] = s * s; }
    Lt[v] = col[v * 4 + 3] / 255;
  }
  const I = nv < 65535 ? Uint16Array.from(idx) : Uint32Array.from(idx);
  const acc = (type, arr, norm = false) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer).setNormalized(norm);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', faceNormals(P, I)))
    .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(uv))).setAttribute('COLOR_0', acc('VEC3', C))
    .setAttribute('_lit', acc('SCALAR', Lt));
  if (bk) prim.setAttribute('_bkey', acc('SCALAR', Uint32Array.from(bk)));
  if (ao) prim.setAttribute('_ao', acc('SCALAR', Float32Array.from(ao, (a) => a / 255)));   // BD40: the vertex's open-sky share (0: none)
  prim.setIndices(acc('SCALAR', I));
  return { prim, tris: idx.length / 3, bounds: boundsOf(P) };
}
function boundsOf(P) {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (let v = 0; v < P.length; v += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P[v + k]); b[k + 3] = Math.max(b[k + 3], P[v + k]); }
  return b;
}
// ==== R2B: the water node of an L6 chunk: one quad over its square at y 0, facing up (uv: metres / 100 from its corner)
function addWater(doc, buffer, rootNode, s, origin, index, bAll, ck) {
  const T = waterOf(ck);
  if (!T) return false;
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const nv = T.length / 2, P = new Float32Array(nv * 3), Nw = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) { P[v * 3] = T[v * 2]; P[v * 3 + 2] = T[v * 2 + 1]; Nw[v * 3 + 1] = 1; U[v * 2] = T[v * 2] / 100; U[v * 2 + 1] = T[v * 2 + 1] / 100; }
  const I = nv < 65535 ? new Uint16Array(nv) : new Uint32Array(nv);
  for (let v = 0; v < nv; v++) I[v] = v;
  const prim = doc.createPrimitive().setMaterial(material(doc, WATER, 0.05)).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', Nw))
    .setAttribute('TEXCOORD_0', acc('VEC2', U)).setIndices(acc('SCALAR', I));
  const node = doc.createNode('water').setMesh(doc.createMesh('water').addPrimitive(prim));
  node.setExtras({ kind: 'mesh', matKey: WATER.key, class: 18, water: true, castShadow: false, receiveShadow: true, renderOrder: 1, layers: 1, level: 6,
    sources: ["the page's water plane (client/src/main.js), y 0, clipped to the charts' water and the city's shore strip (tools/lod/water_l6.py)"], tris: nv / 3 });
  rootNode.addChild(node);
  index.tris += nv / 3; index.draws++;
  for (const k of [0, 2]) { bAll[k] = Math.min(bAll[k], origin[k]); bAll[k + 3] = Math.max(bAll[k + 3], origin[k] + s); }
  bAll[1] = Math.min(bAll[1], 0); bAll[4] = Math.max(bAll[4], 0);
  return true;
}
// the L6 squares round the city that build_persistent leaves out (open water: no land, no buildings), each a chunk of water
// alone, so the harbour and the ocean have water to the horizon (BD40: every square water_l6.json lists, the backdrop's
// i -7..5, j -5..6, x -57.3 to +49.2 km, z -41.0 to +57.3 km; it was x -32.8 to +32.8 km, z -24.6 to +41.0 km)
const WATER_ONLY = (() => {
  const ks = Object.keys((WATER_L6 && WATER_L6.squares) || {}).map((k) => k.split('_').map(Number));
  if (!ks.length) return { i: [-4, 3], j: [-3, 4] };
  return { i: [Math.min(...ks.map((k) => k[0])), Math.max(...ks.map((k) => k[0]))], j: [Math.min(...ks.map((k) => k[1])), Math.max(...ks.map((k) => k[1]))] };
})();
// ==== end R2B
// ==== BD40: the backdrop's part of a chunk: `bdShells` (its buildings, the shell material) and `bdGround` (its terrain with
// the chunk's texture); both carry extras.backdrop, so a renderer never masks them under the city's cells (they lie
// outside the city) and keeps them whole like the water
function addBackdrop(doc, buffer, rootNode, t, origin, index, bAll, lv) {
  const H = t.header, S = t.S, sc = H.scale || 0.25;
  const dx = H.origin[0] - origin[0], dz = H.origin[1] - origin[2];
  const grow = (b) => { for (let k = 0; k < 3; k++) { bAll[k] = Math.min(bAll[k], b[k] + origin[k]); bAll[k + 3] = Math.max(bAll[k + 3], b[k + 3] + origin[k]); } };
  if (S.idx && S.idx.length) {
    const r = shellPrim(doc, buffer, material(doc, SHELL, 0.85), S.pos, sc, dx, 0, dz, S.col, S.uv, S.idx, S.bk, S.ao);
    const node = doc.createNode('bdShells').setMesh(doc.createMesh('bdShells').addPrimitive(r.prim));
    node.setExtras({ kind: 'mesh', matKey: SHELL.key, class: 2, castShadow: false, receiveShadow: false, renderOrder: 0, layers: 1, level: lv, backdrop: true,
      sources: [`backdrop L${lv}: ${H.buildings} buildings (${H.towers} towers) from OpenStreetMap and Microsoft footprints (ODbL)`], tris: r.tris, buildings: H.bkeys || [] });
    rootNode.addChild(node);
    index.tris += r.tris; index.draws++;
    grow(r.bounds);
  }
  if (S.tidx && S.tidx.length) {
    const nv = S.tpos.length / 3, P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      P[v * 3] = S.tpos[v * 3] * sc + dx; P[v * 3 + 1] = S.tpos[v * 3 + 1] * sc; P[v * 3 + 2] = S.tpos[v * 3 + 2] * sc + dz;
      for (let k = 0; k < 3; k++) Nn[v * 3 + k] = S.tnrm ? (S.tnrm[v * 3 + k] - 128) / 127 : (k === 1 ? 1 : 0);
      const l = Math.hypot(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) Nn[v * 3 + k] /= l;
      const sh = (S.tsh ? S.tsh[v] : 255) / 255; Cc[v * 3] = Cc[v * 3 + 1] = Cc[v * 3 + 2] = sh;
    }
    const I = nv < 65535 ? Uint16Array.from(S.tidx) : Uint32Array.from(S.tidx);
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    const mat = material(doc, BDGROUND, 0.95);
    if (S.ttex && S.ttex.length) {
      const tex = doc.createTexture('bdGroundMap').setImage(Uint8Array.from(S.ttex)).setMimeType('image/jpeg');
      mat.setBaseColorTexture(tex);
    }
    if (S.tnit && S.tnit.length) {
      const tn = doc.createTexture('bdGroundNight').setImage(Uint8Array.from(S.tnit)).setMimeType('image/jpeg');
      mat.setEmissiveTexture(tn).setEmissiveFactor([0, 0, 0]);
    }
    const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', Nn))
      .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(S.tuv))).setAttribute('COLOR_0', acc('VEC3', Cc)).setIndices(acc('SCALAR', I));
    const node = doc.createNode('bdGround').setMesh(doc.createMesh('bdGround').addPrimitive(prim));
    node.setExtras({ kind: 'mesh', matKey: BDGROUND.key, class: 15, castShadow: false, receiveShadow: true, renderOrder: 0, layers: 1, level: lv, backdrop: true,
      sources: [`backdrop L${lv} ground: USGS 3DEP terrain on the land NOAA's charts leave dry, the texture from OpenStreetMap (ODbL)`], tris: S.tidx.length / 3 });
    rootNode.addChild(node);
    index.tris += S.tidx.length / 3; index.draws++;
    grow(boundsOf(P));
  }
}
// ==== end BD40
async function writeEntry(srcBuf, opts, build) {
  // (R2B: an L6 chunk's hash takes the water's key; the other levels and the landmarks keep theirs)
  const wk = opts.level === 6 && !String(opts.key).startsWith('LM_') ? WATER.key + sha(JSON.stringify(waterOf(String(opts.key).slice(3)) || [])).slice(0, 16) : '';
  const hash = sha(Buffer.concat([Buffer.from(VERSION + JSON.stringify(opts) + SHELL.key + GROUND.key + wk), srcBuf])).slice(0, 24);
  if (PLAIN) {
    const { doc, index } = build();
    const glb = await io.writeBinary(doc);
    fs.mkdirSync(PLAIN_DIR, { recursive: true });
    const f = path.join(PLAIN_DIR, `${opts.key}.glb`), tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, glb); fs.renameSync(tmp, f);
    index.bytes = { glb: glb.length };
    return { hash, ...index, plainFile: `${opts.key}.glb` };
  }
  const dir = path.join(OUT, hash), glbFile = path.join(dir, 'cell.glb');
  if (fs.existsSync(glbFile) && fs.existsSync(path.join(dir, 'meta.json'))) return { hash, ...JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).index, cached: true };
  const { doc, index, meta } = build();
  const glb = await io.writeBinary(doc);
  const tmp = `${dir}.${process.pid}.tmp`;
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'cell.glb'), glb);
  index.bytes = { glb: glb.length };
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ schema: 'valdrada.cellmeta/0', generator: VERSION, hash, inputs: { ...opts, sourceSha256: sha(srcBuf) }, index, ...meta }, null, 1));
  if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.old-${Date.now()}`);
  fs.renameSync(tmp, dir);
  return { hash, ...index };
}

// ---- chunks
const idx = JSON.parse(fs.readFileSync(path.join(SRC, 'index.json'), 'utf8'));
const out = { schema: 'valdrada.cellindex/0', kind: 'lod16', generator: VERSION, generated: new Date().toISOString(), cellSize: 128, levels: {}, persistent: [], chunks: {}, landmarks: {}, materials: { shell: SHELL.key, ground: GROUND.key, water: WATER.key, bdGround: BDGROUND.key }, textures: { fw14: fw14File } };
for (const lv of LEVELS) {
  const L = idx.levels[lv];
  if (!L) continue;
  out.levels[lv] = { size: L.size, err: L.err, cell: L.cell, towerH: L.towerH, grid: `128 x 2^${lv}` };
  let n = 0, bytes = 0, tris = 0;
  for (const [ck, info] of Object.entries(idx.chunks[lv] || {})) {
    const key = `L${lv}_${ck}`;
    if (ONLY && ONLY !== key) continue;
    // (BD40: an entry may hold the city's file, the backdrop's (`bd`), or both)
    const srcFile = info.f ? path.join(SRC, info.f) : null;
    const { buf: cbuf, t } = srcFile ? readCTL(srcFile) : { buf: Buffer.alloc(0), t: { header: { origin: [0, 0], scale: 0.25 }, S: {} } };
    const bdFile = info.bd ? path.join(SRC, info.bd.f) : null;
    const bdT = bdFile ? readCTL(bdFile) : null;
    const buf = bdT ? Buffer.concat([cbuf, Buffer.from('|BD40|'), bdT.buf]) : cbuf;
    const H = t.header, S = t.S, sc = H.scale || 0.25;
    const [ci, cj] = ck.split('_').map(Number);
    const origin = [ci * L.size, 0, cj * L.size];
    const dx = H.origin[0] - origin[0], dz = H.origin[1] - origin[2];   // chunk centre -> chunk origin
    const e = await writeEntry(buf, bdT ? { key, level: lv, bd: BDGROUND.key } : { key, level: lv }, () => {
      const doc = newDoc(), buffer = doc.createBuffer();
      const scene = doc.createScene('cell_' + key);
      const rootNode = doc.createNode('cell_' + key).setTranslation(origin);
      rootNode.setExtras({ schema: 'valdrada.cell/0', cell: key, level: lv, origin, size: L.size, err: L.err, persistent: lv === 6 });
      scene.addChild(rootNode);
      const index = { level: lv, tris: 0, draws: 0, bounds: null };
      const bAll = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
      if (S.idx && S.idx.length) {
        const r = shellPrim(doc, buffer, material(doc, SHELL, 0.85), S.pos, sc, dx, 0, dz, S.col, S.uv, S.idx, S.bk, S.ao);
        const node = doc.createNode('shells').setMesh(doc.createMesh('shells').addPrimitive(r.prim));
        node.setExtras({ kind: 'mesh', matKey: SHELL.key, class: 2, castShadow: false, receiveShadow: false, renderOrder: 0, layers: 1, level: lv,
          sources: [`lod16 L${lv} block shells (${H.regions} regions) and ${H.towers} tower silhouettes`], tris: r.tris, buildings: H.bkeys || [] });
        rootNode.addChild(node);
        index.tris += r.tris; index.draws++;
        for (let k = 0; k < 3; k++) { bAll[k] = Math.min(bAll[k], r.bounds[k] + origin[k]); bAll[k + 3] = Math.max(bAll[k + 3], r.bounds[k + 3] + origin[k]); }
      }
      if (S.gpos && S.gidx && S.gidx.length) {
        const nv = S.gpos.length / 3, P = new Float32Array(nv * 3);
        for (let v = 0; v < nv; v++) { P[v * 3] = S.gpos[v * 3] * sc + dx; P[v * 3 + 1] = S.gpos[v * 3 + 1] * sc; P[v * 3 + 2] = S.gpos[v * 3 + 2] * sc + dz; }
        const I = nv < 65535 ? Uint16Array.from(S.gidx) : Uint32Array.from(S.gidx);
        const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
        const prim = doc.createPrimitive().setMaterial(material(doc, GROUND, 0.95)).setAttribute('POSITION', acc('VEC3', P)).setAttribute('NORMAL', acc('VEC3', faceNormals(P, I)))
          .setAttribute('_matId', acc('SCALAR', new Float32Array(nv).fill(8))).setIndices(acc('SCALAR', I));
        const node = doc.createNode('ground').setMesh(doc.createMesh('ground').addPrimitive(prim));
        node.setExtras({ kind: 'mesh', matKey: GROUND.key, class: 15, castShadow: false, receiveShadow: true, renderOrder: 0, layers: 1, level: lv, sources: ['lod16 L6 ground (macro terrain grids)'], tris: S.gidx.length / 3 });
        rootNode.addChild(node);
        index.tris += S.gidx.length / 3; index.draws++;
        const gb = boundsOf(P);
        for (let k = 0; k < 3; k++) { bAll[k] = Math.min(bAll[k], gb[k] + origin[k]); bAll[k + 3] = Math.max(bAll[k + 3], gb[k + 3] + origin[k]); }
      }
      if (bdT) addBackdrop(doc, buffer, rootNode, bdT.t, origin, index, bAll, lv);   // (BD40: the backdrop)
      if (lv === 6) addWater(doc, buffer, rootNode, L.size, origin, index, bAll, ck);   // (R2B: the water)
      index.bounds = bAll.map((v) => +v.toFixed(2));
      return { doc, index, meta: { source: srcFile ? path.relative(root, srcFile) : null, backdrop: bdFile ? path.basename(bdFile) : null, regions: H.regions, towers: H.towers, buildings: (H.bkeys || []).length } };
    });
    out.chunks[key] = { hash: e.hash, file: PLAIN ? e.plainFile : `${e.hash}/cell.glb`, level: lv, bytes: e.bytes, bounds: e.bounds, tris: e.tris, draws: e.draws };
    if (lv === 6) out.persistent.push(key);
    n++; bytes += e.bytes.glb; tris += e.tris;
  }
  // ==== R2B: the water-only L6 chunks
  if (lv === 6 && !ONLY) {
    for (let j = WATER_ONLY.j[0]; j <= WATER_ONLY.j[1]; j++) for (let i = WATER_ONLY.i[0]; i <= WATER_ONLY.i[1]; i++) {
      const ck = `${i}_${j}`, key = `L6_${ck}`;
      if ((idx.chunks[6] || {})[ck] || !waterOf(ck)) continue;   // (a square with no water: none written)
      const origin = [i * L.size, 0, j * L.size];
      const e = await writeEntry(Buffer.from(`R2B water-only ${key}`), { key, level: 6 }, () => {
        const doc = newDoc(), buffer = doc.createBuffer();
        const scene = doc.createScene('cell_' + key);
        const rootNode = doc.createNode('cell_' + key).setTranslation(origin);
        rootNode.setExtras({ schema: 'valdrada.cell/0', cell: key, level: 6, origin, size: L.size, err: L.err, persistent: true, waterOnly: true });
        scene.addChild(rootNode);
        const index = { level: 6, tris: 0, draws: 0, bounds: null };
        const bAll = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
        addWater(doc, buffer, rootNode, L.size, origin, index, bAll, ck);
        index.bounds = bAll.map((v) => +v.toFixed(2));
        return { doc, index, meta: { source: 'R2B water only', waterOnly: true } };
      });
      out.chunks[key] = { hash: e.hash, file: PLAIN ? e.plainFile : `${e.hash}/cell.glb`, level: 6, bytes: e.bytes, bounds: e.bounds, tris: e.tris, draws: e.draws, waterOnly: true };
      out.persistent.push(key);
      n++; bytes += e.bytes.glb; tris += e.tris;
    }
  }
  // ==== end R2B
  log(`L${lv}: ${n} packages, ${tris} triangles, ${(bytes / 1048576).toFixed(1)} MB`);
}

// ---- landmarks: one package each, never merged into chunks (section 10); nodes carry extras.landmark
// (BD40: the backdrop's towers, <src>/landmarks_bd.json from tools/lod/build_backdrop.mjs, after the city's registry)
const LM_REGS = [{ reg: path.join(root, 'client/public/data/landmarks.json'), bin: (r) => path.join(root, 'client/public/data', r.file) }];
if (fs.existsSync(path.join(SRC, 'landmarks_bd.json'))) LM_REGS.push({ reg: path.join(SRC, 'landmarks_bd.json'), bin: () => path.join(SRC, 'landmarks_bd.bin') });
if (!ONLY || ONLY.startsWith('LM_')) for (const LR of LM_REGS) {
  const reg = JSON.parse(fs.readFileSync(LR.reg, 'utf8'));
  const { buf: lmBuf, t: lt } = readCTL(LR.bin(reg));
  const S = lt.S, sc = lt.header.scale || 0.125;
  let n = 0, bytes = 0;
  for (const L of reg.landmarks) {
    const key = `LM_${L.key}`;
    if (ONLY && ONLY !== key) continue;
    const it = L.l6;
    if (!it || !it.ni) continue;
    const pos = S.pos.subarray(it.v0 * 3, (it.v0 + it.nv) * 3), col = S.col.subarray(it.v0 * 4, (it.v0 + it.nv) * 4), uv = S.uv.subarray(it.v0 * 2, (it.v0 + it.nv) * 2);
    const ix = S.idx.subarray(it.i0, it.i0 + it.ni);
    const src = Buffer.concat([Buffer.from(JSON.stringify(L)), Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength), Buffer.from(col.buffer, col.byteOffset, col.byteLength)]);
    const origin = it.origin;
    const e = await writeEntry(src, { key, level: 6 }, () => {
      const doc = newDoc(), buffer = doc.createBuffer();
      const scene = doc.createScene('cell_' + key);
      const rootNode = doc.createNode('cell_' + key).setTranslation(origin);
      rootNode.setExtras({ schema: 'valdrada.cell/0', cell: key, level: 6, origin, landmark: L.key, persistent: true });
      scene.addChild(rootNode);
      const r = shellPrim(doc, buffer, material(doc, SHELL, 0.85), pos, sc, 0, 0, 0, col, uv, ix, null);
      const node = doc.createNode(L.key).setMesh(doc.createMesh(L.key).addPrimitive(r.prim));
      node.setExtras({ kind: 'mesh', matKey: SHELL.key, class: L.kind === 'bridge' ? 35 : 2, castShadow: false, receiveShadow: false, renderOrder: 0, layers: 1, level: 6,
        landmark: L.key, name: L.name, ...(L.lmId ? { lmId: L.lmId } : {}), ...(L.feature ? { feature: L.feature } : {}), ...(L.drawnBy ? { drawnBy: L.drawnBy } : {}),
        priority: L.priority, night: L.night || null, tris: r.tris, sources: [`landmark ${L.key} L6 silhouette (${L.l6.how} from ${L.l6.from} triangles)`] });
      rootNode.addChild(node);
      const b = r.bounds.map((v, k) => +(v + origin[k % 3]).toFixed(2));
      return { doc, index: { level: 6, tris: r.tris, draws: 1, bounds: b }, meta: { landmark: L.key, name: L.name } };
    });
    out.landmarks[L.key] = { hash: e.hash, file: PLAIN ? e.plainFile : `${e.hash}/cell.glb`, name: L.name, kind: L.kind, ...(L.drawnBy ? { drawnBy: L.drawnBy } : {}), bytes: e.bytes, bounds: e.bounds, tris: e.tris };
    n++; bytes += e.bytes.glb;
  }
  log(`landmarks: ${n} packages, ${(bytes / 1048576).toFixed(2)} MB`);
}
// merge into an existing index when only part was exported
const idxFile = path.join(PLAIN ? PLAIN_DIR : OUT, 'index.json');
if (PLAIN) out.plain = true;
if (ONLY && fs.existsSync(idxFile)) {
  const prev = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const k of ['chunks', 'landmarks', 'levels']) out[k] = { ...prev[k], ...out[k] };
  out.persistent = [...new Set([...(prev.persistent || []), ...out.persistent])];
}
const tmpIdx = `${idxFile}.${process.pid}.tmp`;
fs.writeFileSync(tmpIdx, JSON.stringify(out, null, 1));
fs.renameSync(tmpIdx, idxFile);
log('index', idxFile, `${Object.keys(out.chunks).length} chunks, ${Object.keys(out.landmarks).length} landmarks`);
