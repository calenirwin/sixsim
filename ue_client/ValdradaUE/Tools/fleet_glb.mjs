// The fleet's models as Unreal's glTF importer reads them: client/public/models/fleet24/<kind>.glb is meshopt-compressed
// with KTX2 (Basis Universal) textures, neither of which the importer supports. Each model is written again with its
// LOD0 only, its geometry uncompressed and its textures as PNG (basisu -unpack, the CLI tools/assets/lib/tex.mjs builds
// with); Tools/make_fleet.py imports the result.
//   node ue_client/ValdradaUE/Tools/fleet_glb.mjs <out dir> [kind ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const req = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'));
const imp = (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
const { prune, dequantize, transformPrimitive } = await imp('@gltf-transform/functions');
const BASISU = process.env.BASISU || '/data0/projectnyc_aux/.tools/basisu/basis_universal-1_60/bin/basisu';
const SRC = process.env.FLEET_SRC || path.join(ROOT, 'client', 'public', 'models', 'fleet24');

const out = process.argv[2];
const only = new Set(process.argv.slice(3));
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fleetglb_'));
for (const fn of fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const kind = fn.slice(0, -4);
  if (only.size && !only.has(kind)) continue;
  const doc = await io.read(path.join(SRC, fn));
  const root = doc.getRoot();
  // LOD0 only: the other levels' nodes go, prune drops their meshes
  for (const n of root.listNodes()) if (/LOD[1-9]$/.test(n.getName())) n.dispose();
  // one mesh: a model in parts (the NYPD car's chrome, glass, paint, ...; an articulated bus's front, joint and rear,
  // drawn rigid) has every part's primitives moved into the first part's mesh at the part's place
  const top = doc.getRoot().getDefaultScene() || root.listScenes()[0];
  const parts = [];
  top.traverse((n) => { if (n.getMesh()) parts.push(n); });
  if (parts.length > 1) {
    const merged = doc.createMesh(kind);
    for (const n of parts) {
      const M = n.getWorldMatrix();
      for (const prim of n.getMesh().listPrimitives()) { transformPrimitive(prim, M); merged.addPrimitive(prim); }
    }
    const holder = doc.createNode('LOD0').setMesh(merged);
    for (const n of parts) n.setMesh(null);
    top.addChild(holder);
  }
  let png = 0;
  for (const t of root.listTextures()) {
    if (t.getMimeType() !== 'image/ktx2') continue;
    const base = `t${png}`, d = path.join(tmp, kind);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, base + '.ktx2'), Buffer.from(t.getImage()));
    execFileSync(BASISU, ['-unpack', base + '.ktx2', '-no_ktx', '-format_only', '10'], { cwd: d, stdio: 'ignore' });
    const hit = fs.readdirSync(d).filter((f) => f.startsWith(base + '_unpacked_rgba_') && /level_0/.test(f) && f.endsWith('.png')).sort()[0];
    if (!hit) throw new Error(`${kind}: basisu wrote no PNG for texture ${png}`);
    t.setImage(new Uint8Array(fs.readFileSync(path.join(d, hit)))).setMimeType('image/png');
    png++;
  }
  await doc.transform(dequantize());   // (quantized positions and normals as floats: the importer reads no KHR_mesh_quantization)
  for (const e of root.listExtensionsUsed()) {
    const n = e.extensionName;
    if (n === 'KHR_texture_basisu' || n === 'EXT_meshopt_compression' || n === 'KHR_mesh_quantization') e.dispose();
  }
  await doc.transform(prune());
  const dst = path.join(out, fn);
  await io.write(dst, doc);
  console.log(`${kind}: ${png} textures as PNG, ${root.listMeshes().length} mesh(es) -> ${dst}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
