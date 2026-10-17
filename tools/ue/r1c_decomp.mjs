// R1C (lane C, 2026-10-11): uncompressed copies of cell, chunk and landmark packages for Unreal's glTF importer (which
// reads no EXT_meshopt_compression), by content: a job list [[src, dst], ...]; a dst that exists is kept.
//   node tools/ue/r1c_decomp.mjs <jobs.json>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(path.join(root, 'tools', 'assets', 'package.json'));
const imp = (n) => import(pathToFileURL(req.resolve(n)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { EXTMeshGPUInstancing, EXTMeshoptCompression } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
const { unpartition, copyToDocument } = await imp('@gltf-transform/functions');   // BD40; GB43 copyToDocument
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const t0 = Date.now();
let n = 0;
const CELLCACHE = '/data0/projectnyc_aux/cellcache', PROTO = new Map();   // (GB43: the prototypes read once a run)
for (const [src, dst] of jobs) {
  if (fs.existsSync(dst)) continue;
  const doc = await io.read(src);
  // GB43: each instanced set's prototype (the bake writes it once by content, cellcache/protos/<hash>.glb, and the cell a
  // one-vertex placeholder) copied in, its material the set's, as export_plain.mjs does: without it every set a cell
  // packed through here held (chairs, hydrants, signal heads, its own lamps) reached Unreal as an empty mesh
  let inl = 0;
  for (const node of doc.getRoot().listNodes()) {
    const ref = node.getExtras() && node.getExtras().proto;
    if (!ref || !node.getMesh()) continue;
    if (!PROTO.has(ref)) PROTO.set(ref, await io.read(path.join(CELLCACHE, ref)));
    const pdoc = PROTO.get(ref), pmesh = pdoc.getRoot().listMeshes()[0];
    const mesh = copyToDocument(doc, pdoc, [pmesh]).get(pmesh), keep = node.getMesh().listPrimitives()[0].getMaterial();
    for (const pr of mesh.listPrimitives()) pr.setMaterial(keep);
    node.setMesh(mesh); inl++;
  }
  if (inl) { const [b0, ...rest] = doc.getRoot().listBuffers(); for (const a of doc.getRoot().listAccessors()) a.setBuffer(b0); for (const b of rest) b.dispose(); }
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  // ==== BD40 (backdrop lane, 2026-10-11): a cell with nothing in it (a cell over water past the tiles, its tile "none")
  // keeps meshopt's fallback buffer beside its own, and a GLB holds one buffer: the buffers merged into the first
  if (doc.getRoot().listBuffers().length > 1) await doc.transform(unpartition());
  // ==== end BD40
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst.replace(/\.glb$/, `.tmp${process.pid}.glb`);
  await io.write(tmp, doc);
  fs.renameSync(tmp, dst);
  n++;
}
console.log(JSON.stringify({ jobs: jobs.length, written: n, secs: (Date.now() - t0) / 1000 }));
