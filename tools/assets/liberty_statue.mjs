// The Statue of Liberty's statue as a level chain: the fitted, coloured scan (tools/assets/liberty_bake.py: "Statue Of
// Liberty Bronze Model" by jerryfisher, CC BY 4.0, scaled to HAER NY-138's measurements and given her verdigris per
// vertex) simplified with meshoptimizer into four levels, each a GLB with two primitives (the copper; the torch's flame,
// gilded) in the statue's frame (+x her left, +y up from the statue's base, +z her front, metres), quantised and meshopt
// compressed. city/liberty.js draws them as a THREE.LOD.
//   node tools/assets/liberty_statue.mjs <bake dir> [out dir]      (run from tools/assets for its node modules)
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

const [bake, outArg] = process.argv.slice(2);
const OUT = outArg || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../client/public/models/landmarks');
const H = JSON.parse(fs.readFileSync(path.join(bake, 'header.json'), 'utf8'));
const pos = new Float32Array(fs.readFileSync(path.join(bake, 'pos.f32')).buffer.slice(0));
const nrm = new Float32Array(fs.readFileSync(path.join(bake, 'nrm.f32')).buffer.slice(0));
const col = new Uint8Array(fs.readFileSync(path.join(bake, 'col.u8')));
const idx = new Uint32Array(fs.readFileSync(path.join(bake, 'idx.u32')).buffer.slice(0));
console.log(`bake: ${H.vertices} vertices, ${H.triangles} triangles, ${H.height_m.toFixed(2)} m`);
// the flame: triangles over 43.15 m on the torch's side (x < -1.5), gilded
const FLAME_Y = 43.15;
const isFlame = (t) => { let y = 0, x = 0; for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; y += pos[v * 3 + 1]; x += pos[v * 3]; } return y / 3 > FLAME_Y && x / 3 < -1.5; };
const nT = idx.length / 3, copperI = [], flameI = [];
for (let t = 0; t < nT; t++) (isFlame(t) ? flameI : copperI).push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
console.log(`copper ${copperI.length / 3} triangles, flame ${flameI.length / 3}`);
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
// a level: each part simplified to a share of its triangles (attribute-aware: normals and colours weigh in), then compacted
function level(I, target) {
  const src = new Uint32Array(I);
  if (src.length / 3 <= target) return src;
  const attrs = new Float32Array(H.vertices * 6);
  for (let v = 0; v < H.vertices; v++) {
    attrs[v * 6] = nrm[v * 3]; attrs[v * 6 + 1] = nrm[v * 3 + 1]; attrs[v * 6 + 2] = nrm[v * 3 + 2];
    attrs[v * 6 + 3] = col[v * 4] / 255; attrs[v * 6 + 4] = col[v * 4 + 1] / 255; attrs[v * 6 + 5] = col[v * 4 + 2] / 255;
  }
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(src, pos, 3, attrs, 6, [0.3, 0.3, 0.3, 0.6, 0.6, 0.6], null, target * 3, 0.05, []);
  console.log(`    ${src.length / 3} -> ${out.length / 3} triangles (error ${(err * H.height_m).toFixed(3)} m)`);
  return out;
}
function prim(doc, buf, I, mat) {
  // compact the vertices this part uses
  const map = new Int32Array(H.vertices).fill(-1), used = [];
  for (const v of I) if (map[v] < 0) { map[v] = used.length; used.push(v); }
  const P = new Float32Array(used.length * 3), Nn = new Float32Array(used.length * 3), C = new Uint8Array(used.length * 4), J = new Uint32Array(I.length);
  used.forEach((v, i) => { for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[v * 3 + k]; Nn[i * 3 + k] = nrm[v * 3 + k]; } for (let k = 0; k < 4; k++) C[i * 4 + k] = col[v * 4 + k]; });
  for (let k = 0; k < I.length; k++) J[k] = map[I[k]];
  const p = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(Nn).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(C).setNormalized(true).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(J).setBuffer(buf));
  return p;
}
const LEVELS = [{ name: 'l0', copper: 1e9, flame: 1e9 }, { name: 'l1', copper: 70000, flame: 3000 }, { name: 'l2', copper: 12000, flame: 600 }, { name: 'l3', copper: 1900, flame: 100 }];
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const manifest = { asset: 'liberty_statue', source: { title: 'Statue Of Liberty Bronze Model', author: 'jerryfisher', url: 'https://sketchfab.com/3d-models/statue-of-liberty-bronze-model-5b9aa58d51624f01b9009b52379bf18a', license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/', copy: 'Objaverse (allenai/objaverse on Hugging Face), glbs/000-057/5b9aa58d51624f01b9009b52379bf18a.glb' }, fit: H, levels: [] };
for (const L of LEVELS) {
  console.log(`level ${L.name}`);
  const doc = new Document();
  const buf = doc.createBuffer();
  const copper = doc.createMaterial('lb:copper').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.65).setMetallicFactor(0.05);
  const gold = doc.createMaterial('lb:gold').setBaseColorFactor([0.95, 0.76, 0.35, 1]).setRoughnessFactor(0.25).setMetallicFactor(1);
  const cI = level(copperI, L.copper), fI = level(flameI, L.flame);
  const mesh = doc.createMesh('statue').addPrimitive(prim(doc, buf, cI, copper)).addPrimitive(prim(doc, buf, fI, gold));
  const node = doc.createNode('liberty_statue').setMesh(mesh);
  doc.createScene('statue').addChild(node);
  doc.getRoot().getAsset().extras = { source: manifest.source, levelOf: 'city/liberty.js' };
  await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = path.join(OUT, `liberty_statue_${L.name}.glb`);
  await io.write(file, doc);
  const tris = (cI.length + fI.length) / 3;
  manifest.levels.push({ file: path.basename(file), triangles: tris, bytes: fs.statSync(file).size });
  console.log(`  ${path.basename(file)}: ${tris} triangles, ${(fs.statSync(file).size / 1048576).toFixed(2)} MB`);
}
fs.writeFileSync(path.join(OUT, 'liberty_statue.json'), JSON.stringify(manifest, null, 1));
