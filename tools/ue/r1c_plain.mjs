// R1C (lane C, 2026-10-11): uncompressed copies of a take's load set (docs/specs/load-set.md) for Unreal's glTF importer,
// which reads no EXT_meshopt_compression (as tools/cells/export_plain.mjs does for a region): the chunks drawn on the take's
// frames, its landmarks and its cells, from the load set's union.files, into <out>/<key>.glb (EXT_mesh_gpu_instancing kept).
//   node tools/ue/r1c_plain.mjs --loadset /data0/projectnyc_aux/cellcache/takes/<shot>/loadset.json --out <dir>
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
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CACHE = process.env.CELLCACHE || '/data0/projectnyc_aux/cellcache';
const LS = JSON.parse(fs.readFileSync(opt('loadset'), 'utf8'));
const out = opt('out');
fs.mkdirSync(out, { recursive: true });
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const drawn = new Set(LS.frames.flatMap((f) => f.chunks));
const files = LS.union.files;
const jobs = [];
for (const k of drawn) if (files.chunks[k]) jobs.push([k, files.chunks[k]]);
for (const k of LS.union.landmarks) if (files.landmarks[k]) jobs.push(['LM_' + k, files.landmarks[k]]);
for (const k of LS.union.cells) if (files.cells[k]) jobs.push(['cell_' + k, files.cells[k]]);
const t0 = Date.now();
let bytes = 0;
for (const [k, rel] of jobs) {
  const dst = path.join(out, `${k}.glb`);
  if (fs.existsSync(dst)) continue;
  const doc = await io.read(path.join(CACHE, rel));
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  await io.write(dst, doc);
  bytes += fs.statSync(dst).size;
}
fs.writeFileSync(path.join(out, 'plain.json'), JSON.stringify({ shot: LS.shot, drawn: [...drawn], landmarks: LS.union.landmarks, cells: LS.union.cells, jobs: jobs.length, secs: (Date.now() - t0) / 1000 }, null, 1));
console.log(JSON.stringify({ shot: LS.shot, chunks: drawn.size, landmarks: LS.union.landmarks.length, cells: LS.union.cells.length, written_mb: Math.round(bytes / 1e6), secs: (Date.now() - t0) / 1000 }));
