// Self-contained, uncompressed copies of baked cell packages, for importers without EXT_meshopt_compression (Unreal's glTF
// importer) or the shared prototype library: each instanced set's prototype is copied into the cell in place of its
// placeholder, and the materials' textures are glTF textures on image files in <region>/tex/ (an earlier copy of a
// region is moved aside, never deleted).
//   node tools/cells/export_plain.mjs [--region lenox125] [--out /data0/projectnyc_aux/cellcache/plain]
// Writes <out>/<region>/<cell>.glb (EXT_mesh_gpu_instancing kept) and <out>/<region>/index.json (cell -> file, origin).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(path.join(root, 'tools', 'assets', 'package.json'));
const imp = (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { EXTMeshGPUInstancing, EXTMeshoptCompression, KHRTextureTransform } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
const { copyToDocument, prune } = await imp('@gltf-transform/functions');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CACHE = process.env.CELLCACHE || '/data0/projectnyc_aux/cellcache';
const out = opt('out', path.join(CACHE, 'plain'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression, KHRTextureTransform]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// the package's texture references (extras.three.textures: the client's maps, read back into cellcache/tex) as glTF
// textures whose images are files beside the copy (<out>/<region>/tex/<hash>.png, hard links into the cache: one copy
// of each image per region, not one per cell): map -> base colour, normalMap -> normal, roughnessMap / metalnessMap ->
// metallic-roughness (three.js reads the same channels: G roughness, B metalness), aoMap -> occlusion (R), emissiveMap ->
// emissive, with the client's repeat and offset as KHR_texture_transform
function addTextures(doc, texDir) {
  const cache = new Map();
  let tt = null, n = 0;
  const texOf = (file) => {
    if (!cache.has(file)) {
      const name = path.basename(file), dst = path.join(texDir, name);
      if (!fs.existsSync(dst)) { fs.mkdirSync(texDir, { recursive: true }); try { fs.linkSync(path.join(CACHE, file), dst); } catch { fs.copyFileSync(path.join(CACHE, file), dst); } }
      cache.set(file, doc.createTexture(name).setMimeType('image/png'));   // the uri is set in the written JSON (externalImages)
    }
    return cache.get(file);
  };
  const xf = (info, d) => {
    if (!info || !d || !d.repeat) return;
    const [sx, sy] = d.repeat, [ox, oy] = d.offset || [0, 0];
    if (sx === 1 && sy === 1 && !ox && !oy) return;
    tt ||= doc.createExtension(KHRTextureTransform);
    info.setExtension('KHR_texture_transform', tt.createTransform().setScale([sx, sy]).setOffset([ox, oy]));
  };
  for (const m of doc.getRoot().listMaterials()) {
    const T = (m.getExtras() && m.getExtras().three && m.getExtras().three.textures) || {};
    const has = (k) => T[k] && T[k].file && fs.existsSync(path.join(CACHE, T[k].file));
    if (has('map')) { m.setBaseColorTexture(texOf(T.map.file)); xf(m.getBaseColorTextureInfo(), T.map); n++; }
    if (has('normalMap')) { m.setNormalTexture(texOf(T.normalMap.file)); xf(m.getNormalTextureInfo(), T.normalMap); n++; }
    const mr = has('roughnessMap') ? T.roughnessMap : has('metalnessMap') ? T.metalnessMap : null;
    if (mr) { m.setMetallicRoughnessTexture(texOf(mr.file)); xf(m.getMetallicRoughnessTextureInfo(), mr); n++; }
    if (has('aoMap')) { m.setOcclusionTexture(texOf(T.aoMap.file)); xf(m.getOcclusionTextureInfo(), T.aoMap); n++; }
    if (has('emissiveMap')) { m.setEmissiveTexture(texOf(T.emissiveMap.file)); xf(m.getEmissiveTextureInfo(), T.emissiveMap); n++; }
  }
  return n;
}
// the written GLB's images get their uri (tex/<hash>.png): glTF-Transform writes an image without data as a name only
function externalImages(glb) {
  const b = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength), jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  for (const im of j.images || []) if (!im.uri && im.bufferView === undefined && /^[0-9a-f]{24}\.png$/.test(im.name || '')) im.uri = 'tex/' + im.name;
  let js = Buffer.from(JSON.stringify(j)); const pad = (4 - (js.length % 4)) % 4; if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const rest = b.subarray(20 + jl), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + js.length + rest.length, 8); head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, js, rest]);
}
const regions = opt('region') ? [opt('region')] : fs.readdirSync(path.join(CACHE, 'index')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
for (const r of regions) {
  const idx = JSON.parse(fs.readFileSync(path.join(CACHE, 'index', r + '.json'), 'utf8'));
  const dir = path.join(out, r);
  if (!Object.keys(idx.cells || {}).length) { console.log(`${r}: the index lists no cells; ${dir} left as it is`); continue; }
  if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.prev-${new Date().toISOString().replace(/[:.]/g, '-')}`);   // never deleted: moved aside
  fs.mkdirSync(dir, { recursive: true });
  const list = {};
  for (const [k, c] of Object.entries(idx.cells)) {
    const doc = await io.read(path.join(CACHE, c.hash, 'cell.glb'));
    for (const node of doc.getRoot().listNodes()) {
      const ref = node.getExtras() && node.getExtras().proto;
      if (!ref || !node.getMesh()) continue;
      const pdoc = await io.read(path.join(CACHE, ref));
      const pmesh = pdoc.getRoot().listMeshes()[0];
      const map = copyToDocument(doc, pdoc, [pmesh]);
      const mesh = map.get(pmesh), keep = node.getMesh().listPrimitives()[0].getMaterial();
      for (const pr of mesh.listPrimitives()) pr.setMaterial(keep);
      node.setMesh(mesh);
    }
    { const [b0, ...rest] = doc.getRoot().listBuffers(); for (const a of doc.getRoot().listAccessors()) a.setBuffer(b0); for (const b of rest) b.dispose(); }   // a GLB holds one buffer
    const ntex = addTextures(doc, path.join(dir, 'tex'));
    // RG44: keep the attributes no texture reads (prune drops 'UVs without an assigned texture' by default): the facade
    // shader's UV 0 is the wall's metres, its windows' grid; without it every tile facade drew in Unreal as a plain wall
    await doc.transform(prune({ keepAttributes: true }));
    for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
    const file = path.join(dir, `${k}.glb`);
    fs.writeFileSync(file, externalImages(await io.writeBinary(doc)));
    fs.copyFileSync(path.join(CACHE, c.hash, 'cell.json'), path.join(dir, `${k}.json`));
    list[k] = { glb: `${k}.glb`, sidecar: `${k}.json`, hash: c.hash, origin: [Number(k.split('_')[0]) * 128, 0, Number(k.split('_')[1]) * 128], bytes: fs.statSync(file).size };
    list[k].textures = ntex;
    console.log(r, k, (list[k].bytes / 1e6).toFixed(1), 'MB,', ntex, 'texture slots');
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ schema: 'valdrada.cellindex/0', region: r, plain: true, cells: list }, null, 1));
}
