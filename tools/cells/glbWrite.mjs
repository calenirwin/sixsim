// Writes one cell package's glTF 2.0 binary from the baker's page manifest and buffer (docs/specs/cell-package.md, v0).
//   meshes      one node per merged primitive, positions relative to the cell origin (the root node's translation)
//   instances   one node per instanced set with EXT_mesh_gpu_instancing (TRANSLATION, ROTATION, SCALE, _COLOR, _<attr>)
//   materials   glTF PBR factors as a stand-in, the renderer-neutral key and the three.js description in extras
//   attributes  POSITION, NORMAL, TANGENT, TEXCOORD_n, COLOR_0; every other attribute as `_<three.js name>`
// Compression: EXT_meshopt_compression (lossless byte codecs, no quantization) unless --nomeshopt.
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const req = createRequire(path.join(root, 'tools', 'assets', 'package.json'));
const imp = (name) => import(pathToFileURL(req.resolve(name)).href);
const { Document, NodeIO } = await imp('@gltf-transform/core');
const { EXTMeshGPUInstancing, EXTMeshoptCompression } = await imp('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');
const { weld } = await imp('@gltf-transform/functions');

const CTOR = { f32: Float32Array, u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array };
const TYPE = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4' };
const view = (bin, d, type) => {
  const C = CTOR[type];
  const n = d.bytes / C.BYTES_PER_ELEMENT;
  // copy: the source offsets are 4-byte aligned, but the writer owns its arrays
  return new C(bin.buffer.slice(bin.byteOffset + d.offset, bin.byteOffset + d.offset + d.bytes), 0, n);
};
export function semantic(name, itemSize, type) {
  if (name === 'position' && itemSize === 3) return 'POSITION';
  if (name === 'normal' && itemSize === 3 && type === 'f32') return 'NORMAL';
  if (name === 'tangent' && itemSize === 4 && type === 'f32') return 'TANGENT';
  const uv = /^uv(\d?)$/.exec(name);
  if (uv && itemSize === 2 && (type === 'f32' || type === 'u8' || type === 'u16')) return 'TEXCOORD_' + (uv[1] || '0');
  if (name === 'color' && (itemSize === 3 || itemSize === 4) && (type === 'f32' || type === 'u8' || type === 'u16')) return 'COLOR_0';
  return '_' + name;
}
// TRS of a column-major 4x4 (three's elements); a mirrored matrix keeps its sign in scale x
function decompose(e, o) {
  let sx = Math.hypot(e[o], e[o + 1], e[o + 2]), sy = Math.hypot(e[o + 4], e[o + 5], e[o + 6]), sz = Math.hypot(e[o + 8], e[o + 9], e[o + 10]);
  const det = e[o] * (e[o + 5] * e[o + 10] - e[o + 9] * e[o + 6]) - e[o + 4] * (e[o + 1] * e[o + 10] - e[o + 9] * e[o + 2]) + e[o + 8] * (e[o + 1] * e[o + 6] - e[o + 5] * e[o + 2]);
  if (det < 0) sx = -sx;
  const ix = sx ? 1 / sx : 0, iy = sy ? 1 / sy : 0, iz = sz ? 1 / sz : 0;
  const m11 = e[o] * ix, m12 = e[o + 4] * iy, m13 = e[o + 8] * iz;
  const m21 = e[o + 1] * ix, m22 = e[o + 5] * iy, m23 = e[o + 9] * iz;
  const m31 = e[o + 2] * ix, m32 = e[o + 6] * iy, m33 = e[o + 10] * iz;
  let qx, qy, qz, qw;
  const tr = m11 + m22 + m33;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); qw = 0.25 / s; qx = (m32 - m23) * s; qy = (m13 - m31) * s; qz = (m21 - m12) * s; }
  else if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); qw = (m32 - m23) / s; qx = 0.25 * s; qy = (m12 + m21) / s; qz = (m13 + m31) / s; }
  else if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); qw = (m13 - m31) / s; qx = (m12 + m21) / s; qy = 0.25 * s; qz = (m23 + m32) / s; }
  else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); qw = (m21 - m12) / s; qx = (m13 + m31) / s; qy = (m23 + m32) / s; qz = 0.25 * s; }
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  return { t: [e[o + 12], e[o + 13], e[o + 14]], r: [qx / ql, qy / ql, qz / ql, qw / ql], s: [sx, sy, sz] };
}
function makeMaterial(doc, md) {
  const c = (md.color || [1, 1, 1]).map((v) => Math.min(1, Math.max(0, v))), u = (v, d) => Math.min(1, Math.max(0, v ?? d));   // glTF factors are 0..1 (the client's own values stay in extras)
  const m = doc.createMaterial(md.key)
    .setBaseColorFactor([c[0], c[1], c[2], u(md.opacity, 1)])
    .setRoughnessFactor(u(md.roughness, 1))
    .setMetallicFactor(u(md.metalness, 0))
    .setDoubleSided(md.side === 2)
    .setAlphaMode(md.transparent ? 'BLEND' : md.alphaTest > 0 ? 'MASK' : 'OPAQUE');
  if (md.alphaTest > 0 && !md.transparent) m.setAlphaCutoff(md.alphaTest);
  if (md.emissive) { const k = Math.min(1, md.emissiveIntensity ?? 1); m.setEmissiveFactor(md.emissive.map((v) => Math.min(1, v * k))); }
  const { key, ...three } = md;
  m.setExtras({ key, three });
  return m;
}
function primitiveFrom(doc, buffer, bin, attrs, index, mat) {
  const prim = doc.createPrimitive().setMaterial(mat);
  for (const a of attrs) {
    const sem = semantic(a.name, a.itemSize, a.type);
    let arr = view(bin, a, a.type);
    if (sem === 'COLOR_0' && a.type !== 'f32' && !a.normalized) arr = Float32Array.from(arr);
    const acc = doc.createAccessor().setType(TYPE[a.itemSize]).setArray(arr).setBuffer(buffer);
    if (a.normalized || (sem.startsWith('TEXCOORD') && a.type !== 'f32') || (sem === 'COLOR_0' && a.type !== 'f32' && a.normalized)) acc.setNormalized(true);
    prim.setAttribute(sem, acc);
  }
  if (index) {
    let ix = view(bin, index, 'u32');
    const nv = attrs.length ? attrs[0].count : 0;
    if (nv < 65535) ix = Uint16Array.from(ix);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(ix).setBuffer(buffer));
  }
  return prim;
}
// a prototype (an instanced set's geometry and material) once in the shared library, by the hash of its content:
// <protoDir>/<hash>.glb (one mesh node, the material with its key and extras); returns `protos/<hash>.glb`
async function writeProto(protoDir, bin, it, md, meshopt) {
  const h = crypto.createHash('sha256');
  h.update(it.mat);
  for (const a of it.attrs) { h.update(`${a.name}:${a.type}:${a.itemSize}:${a.normalized}`); h.update(bin.subarray(a.offset, a.offset + a.bytes)); }
  if (it.index) h.update(bin.subarray(it.index.offset, it.index.offset + it.index.bytes));
  const hash = h.digest('hex').slice(0, 24), file = path.join(protoDir, hash + '.glb');
  if (!fs.existsSync(file)) {
    const doc = new Document();
    doc.getRoot().getAsset().generator = 'valdrada cells bake v0 (prototype)';
    const buffer = doc.createBuffer();
    const mat = makeMaterial(doc, md);
    const mesh = doc.createMesh('proto').addPrimitive(primitiveFrom(doc, buffer, bin, it.attrs, it.index, mat));
    const node = doc.createNode('proto').setMesh(mesh);
    node.setExtras({ schema: 'valdrada.cellproto/0', hash, matKey: it.mat, name: it.name, pool: it.pool || null, geoName: it.geoName || '' });
    doc.createScene('proto').addChild(node);
    const glb = await ioFor(doc, meshopt).writeBinary(doc);
    fs.mkdirSync(protoDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, glb);
    fs.renameSync(tmp, file);
  }
  return { ref: `protos/${hash}.glb`, hash };
}
function ioFor(doc, meshopt) {
  const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression]);
  if (meshopt) {
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  }
  return io;
}
// ---- shader-only materials as standard ones: a renderer without the client's shaders draws them from glTF alone.
// The ground-contact AO skirt (world/assemble.js aoSkirtMat: a dark ribbon whose alpha is the attribute aA) and the
// boulders' contact shade (city/cpRocks.js contactMat: multiply by 1 - t^2 strength, t falling from the rock's edge to the
// disc's rim) become alpha-blended black with the alpha in COLOR_0 (dst x (1 - a) is the multiply), the shade's disc
// from a texture over uv = (aCd + 1) / 2. The client's own material still draws them (they resolve by key).
const sharpMod = createRequire(path.join(root, 'tools', 'assets', 'package.json'))('sharp');
let DISC = null;
async function discTexture(texDir) {   // the contact disc: alpha = t^2 with the shade's mean rock edge (0.58 of the radius)
  if (DISC) return DISC;
  const N = 256, px = Buffer.alloc(N * N * 4);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * 2 - 1, v = ((j + 0.5) / N) * 2 - 1, t = 1 - ss(0.58, 1, Math.hypot(u, v)), o = (j * N + i) * 4;
    px[o] = px[o + 1] = px[o + 2] = 255; px[o + 3] = Math.round(255 * t * t);
  }
  const png = await sharpMod(px, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();
  const rel = `tex/${crypto.createHash('sha256').update(png).digest('hex').slice(0, 24)}.png`, abs = path.join(texDir, '..', rel);
  if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(`${abs}.${process.pid}.tmp`, png); fs.renameSync(`${abs}.${process.pid}.tmp`, abs); }
  DISC = { file: rel, w: N, h: N, colorSpace: 'srgb', opaque: false, generated: 'procedural' };
  return DISC;
}
function standIn(md, attrs) {
  if (!md || !/Shader/.test(md.type || '')) return null;
  const has = (n) => attrs.some((a) => a.name === n);
  if (md.name === 'cpr34:contact' && has('aCd') && has('aCk')) return 'contactShade';
  if (!md.name && has('aA') && attrs.length <= 3) return 'aoSkirt';
  return null;
}
function standInAttrs(kind, attrs, bin) {   // the extra arrays: [{ sem, itemSize, array }]
  const get = (n) => { const a = attrs.find((d) => d.name === n); return new Float32Array(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes)); };
  if (kind === 'aoSkirt') { const A = get('aA'), C = new Float32Array(A.length * 4); for (let i = 0; i < A.length; i++) { C[i * 4] = C[i * 4 + 1] = C[i * 4 + 2] = 1; C[i * 4 + 3] = A[i]; } return [{ sem: 'COLOR_0', itemSize: 4, array: C }]; }
  const D = get('aCd'), K = get('aCk'), n = D.length / 2, U = new Float32Array(n * 2), C = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { U[i * 2] = (D[i * 2] + 1) / 2; U[i * 2 + 1] = (D[i * 2 + 1] + 1) / 2; C[i * 4] = C[i * 4 + 1] = C[i * 4 + 2] = 1; C[i * 4 + 3] = Math.min(1, K[i * 3 + 1]); }
  return [{ sem: 'TEXCOORD_0', itemSize: 2, array: U }, { sem: 'COLOR_0', itemSize: 4, array: C }];
}
// protoDir: instanced sets reference their prototype in the shared library and carry a one-triangle placeholder mesh
// (degenerate, with the set's material), so the cell stays a valid glTF; without it the prototype is embedded
export async function writeCellGLB(man, bin, { meshopt = true, welded = true, protoDir = null, texDir = null } = {}) {
  if (meshopt) await MeshoptEncoder.ready;
  // the stand-ins: the materials of shader-only meshes become standard (black, alpha-blended, the disc texture)
  const stand = new Map();   // material key -> kind
  for (const ms of man.meshes) { const md = man.materials.find((m) => m.key === ms.mat), k = standIn(md, ms.attrs); if (k) stand.set(ms.mat, k); }
  for (const md of man.materials) {
    const k = stand.get(md.key);
    if (!k) continue;
    md.procedural = k === 'aoSkirt'
      ? { kind: 'aoSkirt', from: 'world/assemble.js aoSkirtMat', color: [0.015, 0.015, 0.025], alpha: 'COLOR_0.a (the attribute aA)' }
      : { kind: 'contactShade', from: 'city/cpRocks.js contactMat', blend: 'multiply by 1 - t^2 * aCk.y, t = 1 - smoothstep(aCk.z, 1, |aCd|); cut under aCk.x', standIn: 'black, alpha = disc texture (rock edge 0.58) x COLOR_0.a (aCk.y), uv = (aCd + 1) / 2' };
    md.color = k === 'aoSkirt' ? [0.015, 0.015, 0.025] : [0, 0, 0];
    md.transparent = true; md.alphaTest = 0; md.opacity = 1; md.roughness = 1; md.metalness = 0;
    if (k === 'contactShade' && texDir) md.textures = { map: await discTexture(texDir) };
  }
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'valdrada cells bake v0';
  const buffer = doc.createBuffer();
  const inst = doc.createExtension(EXTMeshGPUInstancing).setRequired(false);
  const scene = doc.createScene('cell_' + man.cell);
  const root = doc.createNode('cell_' + man.cell).setTranslation(man.origin);
  root.setExtras({ schema: man.schema, cell: man.cell, origin: man.origin, size: 128 });
  scene.addChild(root);
  const mats = new Map();
  for (const md of man.materials) mats.set(md.key, makeMaterial(doc, md));
  man.meshes.forEach((ms, i) => {
    const prim = primitiveFrom(doc, buffer, bin, ms.attrs, ms.index, mats.get(ms.mat));
    const sk = stand.get(ms.mat);
    if (sk) for (const x of standInAttrs(sk, ms.attrs, bin)) prim.setAttribute(x.sem, doc.createAccessor().setType(TYPE[x.itemSize]).setArray(x.array).setBuffer(buffer));
    const mesh = doc.createMesh(`m${i}`).addPrimitive(prim);
    const node = doc.createNode(`m${i}`).setMesh(mesh);
    node.setExtras({ kind: 'mesh', matKey: ms.mat, class: ms.cls, castShadow: ms.castShadow, receiveShadow: ms.receiveShadow, renderOrder: ms.renderOrder, layers: ms.layers,
      dress: ms.dress, nightOnly: ms.nightOnly, shadowOnly: ms.shadowOnly || undefined, sources: ms.sources, tris: ms.tris });
    root.addChild(node);
  });
  const mdOf = new Map(man.materials.map((m) => [m.key, m]));
  for (const [i, it] of man.instances.entries()) {
    let prim, proto = null;
    if (protoDir) {
      proto = await writeProto(protoDir, bin, it, mdOf.get(it.mat), meshopt);
      prim = doc.createPrimitive().setMaterial(mats.get(it.mat))
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(9)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer));
    } else prim = primitiveFrom(doc, buffer, bin, it.attrs, it.index, mats.get(it.mat));
    const mesh = doc.createMesh(`i${i}`).addPrimitive(prim);
    const M = view(bin, it.matrices, 'f32');
    const n = it.count, T = new Float32Array(n * 3), R = new Float32Array(n * 4), S = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const d = decompose(M, k * 16); T.set(d.t, k * 3); R.set(d.r, k * 4); S.set(d.s, k * 3); }
    const batch = inst.createInstancedMesh()
      .setAttribute('TRANSLATION', doc.createAccessor().setType('VEC3').setArray(T).setBuffer(buffer))
      .setAttribute('ROTATION', doc.createAccessor().setType('VEC4').setArray(R).setBuffer(buffer))
      .setAttribute('SCALE', doc.createAccessor().setType('VEC3').setArray(S).setBuffer(buffer));
    if (it.colors) batch.setAttribute('_COLOR', doc.createAccessor().setType('VEC3').setArray(view(bin, it.colors, 'f32')).setBuffer(buffer));
    for (const [name, d] of Object.entries(it.extra || {})) batch.setAttribute('_' + name, doc.createAccessor().setType(TYPE[d.itemSize]).setArray(view(bin, d, 'f32')).setBuffer(buffer));
    const node = doc.createNode(`i${i}`).setMesh(mesh).setExtension('EXT_mesh_gpu_instancing', batch);
    node.setExtras({ kind: it.kind, name: it.name, pool: it.pool, matKey: it.mat, class: it.cls, castShadow: it.castShadow, receiveShadow: it.receiveShadow, renderOrder: it.renderOrder, layers: it.layers, count: n, nightOnly: it.nightOnly || undefined,
      ...(proto ? { proto: proto.ref, protoHash: proto.hash } : {}) });
    root.addChild(node);
  }
  if (welded) await doc.transform(weld());   // identical vertices merged (the static pools store 3 per triangle)
  return ioFor(doc, meshopt).writeBinary(doc);
}
