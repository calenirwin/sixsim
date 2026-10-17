// The Statue of Liberty (Liberty Enlightening the World: Bartholdi, Eiffel, 1886) on Richard Morris Hunt's pedestal and Fort
// Wood, on Liberty Island. The statue is a photogrammetry scan of a 19th-century bronze model of it ("Statue Of Liberty Bronze
// Model" by jerryfisher, CC BY 4.0; client/public/models/landmarks/NOTICE_liberty.md) fitted to the Historic American
// Engineering Record's measurements (HAER NY-138: her base 43.49 m and the flame's top 88.42 m over the drawings' datum,
// tools/assets/liberty_bake.py), her copper's verdigris baked per vertex, the flame gilded; the pedestal and the fort are
// drawn from HAER's elevations (city/libertyPedestal.js), the island from OpenStreetMap (city/libertyIsland.js). She faces
// azimuth 146.9 degrees (the pedestal's square), toward the Narrows.
//
// Resident like the bridges (city/bridgeKit.js): built once at boot, never streamed out, so she is drawn from anywhere in the
// harbour; the statue a THREE.LOD of four levels (355k triangles near to 2k, the last the registry's L6 silhouette), the
// pedestal, the fort and the island three each. The compiled footprints on the island are replaced by nothing
// (shared/landmarkSpec.js ids 67 and 68). After dark the statue and the pedestal are floodlit, the flame and the lamps glow.
import * as THREE from 'three';
import { GeoBag } from './br/geom.js';
import { ENV, applyLightTrim, applyCityAO } from '../world/materials.js';
import { pedestal, fortWood, pedMats } from './libertyPedestal.js';
import { islandGroup, islandGrass, plantTrees, GROUND } from './libertyIsland.js';

// the pedestal's axis (OpenStreetMap's building parts round it); the drawings' datum (the ground at the fort's entrance) at
// world 1.6 m, so the island's ground (3.5 m, the compiled land) stands 1.9 m over it at the fort's foot (HAER sheet 20)
export const LIBERTY = { x: -6181.2, z: 10429.4, datum: GROUND - 1.9, azimuth: 146.9, base: 43.49 };
const ROT = Math.atan2(Math.sin((LIBERTY.azimuth * Math.PI) / 180), -Math.cos((LIBERTY.azimuth * Math.PI) / 180));   // local +z (her front) -> the facing
const BASE = LIBERTY.base;

// ---------------------------------------------------------------- materials
const mcache = new Map();
const once = (k, f) => { if (!mcache.has(k)) mcache.set(k, f()); return mcache.get(k); };
// a floodlight's warm wash after dark, strongest a little over y0 (world metres) and fading toward y1
function flood(m, y0, y1, k, col = 0xfff1dc) {
  const prev = m.onBeforeCompile, c = new THREE.Color(col);
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.lbNight = ENV.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lbNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float fy = vCAOw.y;
        float fl = smoothstep(0.25, 0.75, lbNight) * smoothstep(${y0.toFixed(1)}, ${(y0 + 6).toFixed(1)}, fy) * (1.0 - 0.55 * smoothstep(${(y0 + 10).toFixed(1)}, ${y1.toFixed(1)}, fy));
        totalEmissiveRadiance += diffuseColor.rgb * vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}) * fl * ${k.toFixed(2)};
      }`);
  };
  const f = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => f() + `|lbFlood${y0}`;
  return m;
}
// the 1986 flame, beaten copper under 24-carat gold leaf: gold by day, lit after dark
const goldFlame = () => once('gold', () => {
  const m = new THREE.MeshStandardMaterial({ color: 0xf2c25a, metalness: 1.0, roughness: 0.24, emissive: new THREE.Color(0xffb347), emissiveIntensity: 2.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.lbNight = ENV.night;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float lbNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= smoothstep(0.2, 0.7, lbNight);');
  };
  m.customProgramCacheKey = () => 'lb:gold';
  m.name = 'lb:gold';
  m.userData.brBase = { r: 0.95, g: 0.76, b: 0.35 };
  return m;
});
// ---------------------------------------------------------------- the statue (a scan, fitted; tools/assets/liberty_*)
// the copper: the scan's baked verdigris per vertex (tools/assets/liberty_bake.py: the folds' hollows dark, the faces open
// to the rain washed pale, streaks run down under the edges; its roughness in the colour's alpha), the hammered sheets'
// relief as a fine bump from the statue's own coordinates (no uvs), the floodlights' wash after dark
const LB_BUMP = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lbbump') === '0';
const copperMat = () => once('copper', () => {
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.65, metalness: 0.04 })));
  flood(m, LIBERTY.datum + BASE - 2, LIBERTY.datum + 90, 1.3, 0xfff4e4);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLbObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLbObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLbObj;
      float lbH(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }   // (no sin: its precision drew the lattice's lines)
      float lbN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(lbH(i), lbH(i + vec3(1,0,0)), f.x), mix(lbH(i + vec3(0,1,0)), lbH(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(lbH(i + vec3(0,0,1)), lbH(i + vec3(1,0,1)), f.x), mix(lbH(i + vec3(0,1,1)), lbH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      #ifdef USE_COLOR_ALPHA
        roughnessFactor = clamp(vColor.a * 1.05, 0.35, 1.0);
      #endif`)
      .replace('#include <normal_fragment_maps>', LB_BUMP ? '#include <normal_fragment_maps>' : `#include <normal_fragment_maps>
      {
        // the beaten sheets: a fine dimpled relief, its slope from the screen derivatives (Mikkelsen's surface gradient)
        // (a height in metres: 1.5 cm of dimpling over 0.5 m, 0.6 cm over 0.14 m; world metres, as the quantised positions are not)
        float h = lbN(vCAOw * 1.9 + 0.37) * 0.015 + lbN(vCAOw * 7.3 + 5.1) * 0.006;
        vec2 dh = vec2(dFdx(h), dFdy(h));
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
        normal = normalize(abs(det) * normal - g);
      }`);
  };
  const f = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => f() + '|lbCopper';
  m.name = 'lb:copper';
  m.userData.brBase = { r: 0.42, g: 0.62, b: 0.55 };
  m.userData.pbr = { name: 'copper_patina', opts: { tint: '#7fb5a3' } };
  return m;
});
// the statue's levels (the scan simplified: 355k, 73k, 12.6k and 2k triangles), loaded as they come, coarsest first so she
// stands at once; THREE.LOD distances from her base
const STATUE_LEVELS = [['l0', 0], ['l1', 650], ['l2', 2400], ['l3', 7000]];
let LOADER = null;
async function statueLoader() {
  if (LOADER) return LOADER;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
  LOADER = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return LOADER;
}
async function loadStatue(lod) {
  const loader = await statueLoader();
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  // a slot per level; a slot whose level has not loaded yet shows the finest loaded one (a clone: shared geometry)
  const slots = STATUE_LEVELS.map(([name, d]) => { const g = new THREE.Group(); g.name = `liberty:statue:${name}`; g.position.y = BASE; lod.addLevel(g, d, 0.05); return g; });
  const scenes = [];
  for (const k of [3, 2, 1, 0]) {
    const gltf = await loader.loadAsync(`${base}models/landmarks/liberty_statue_${STATUE_LEVELS[k][0]}.glb`);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = /gold/.test(o.material?.name || '') ? goldFlame() : copperMat();
      o.castShadow = true; o.receiveShadow = true;
      o.name = `liberty:statue:${STATUE_LEVELS[k][0]}:${o.material.name}`;
    });
    scenes[k] = gltf.scene;
    for (let j = 0; j <= k; j++) { if (scenes[j] && j !== k) continue; slots[j].clear(); slots[j].add(j === k ? gltf.scene : gltf.scene.clone()); }
  }
  return scenes;
}

// ---------------------------------------------------------------- the scene
function pedestalLevel(lod) {
  const bag = new GeoBag({ lod }), M = pedMats();
  pedestal(bag, M);
  fortWood(bag, M, ROT);
  const g = new THREE.Group();
  g.name = 'liberty:pedestal:' + lod;
  for (const [, L] of bag.flushChunks('liberty:pedestal', {})) { L.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(L.group); }
  return g;
}

export let LIBERTY_READY = null;
// scene: where to add her (null: just build, the landmark baker); opts.instancer: the city's instancer, for the island's
// trees (the tree pools); opts.island === false leaves the island out (the baker's silhouette is the statue, pedestal, fort)
export function buildLiberty(scene, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const root = new THREE.Group();
  root.name = 'liberty';
  // the statue, the pedestal and the fort in her frame, at the drawings' datum
  const frame = new THREE.Group();
  frame.name = 'liberty:frame';
  frame.position.set(LIBERTY.x, LIBERTY.datum, LIBERTY.z);
  frame.rotation.y = ROT;
  root.add(frame);
  const ped = new THREE.LOD();
  ped.name = 'liberty:pedestal';
  [[0, 0], [1, 900], [2, 3200]].forEach(([k, d]) => ped.addLevel(pedestalLevel(k), d, 0.05));
  frame.add(ped);
  const statue = new THREE.LOD();
  statue.name = 'liberty:statue';
  frame.add(statue);
  // the island in world axes about the axis
  if (opts.island !== false) {
    const isl = new THREE.Group();
    isl.name = 'liberty:island';
    isl.position.set(LIBERTY.x, 0, LIBERTY.z);
    const lod = new THREE.LOD();
    lod.name = 'liberty:island:lod';
    [[0, 0], [1, 1200], [2, 4000]].forEach(([k, d]) => lod.addLevel(islandGroup(k), d, 0.05));
    lod.position.set(0, 0, 0);
    isl.add(lod);
    if (typeof document !== 'undefined') isl.add(islandGrass());
    root.add(isl);
    if (opts.instancer) { const n = plantTrees(opts.instancer); console.log(`[liberty] ${n} island trees planted`); }
  }
  if (scene) scene.add(root);
  LIBERTY_READY = loadStatue(statue).then(() => {
    let tris = 0;
    statue.levels[0].object.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    console.log(`[liberty] the statue loaded: ${(tris / 1000).toFixed(0)}k triangles near, ${((performance?.now?.() ?? t0) - t0).toFixed(0)} ms`);
  }).catch((e) => console.warn('[liberty] the statue did not load', e));
  if (typeof window !== 'undefined') window.__LIBERTY_READY = LIBERTY_READY;
  return root;
}
