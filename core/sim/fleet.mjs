// The vehicle fleet as the traffic model sees it, with no mesh: sim/fleet24.js loadFleet24 hands traffic.js a
// `trafficFleet` whose geometries only size the storage, plus (installFleet24) `traffic.vehDims` and `traffic.fleet24.kinds`
// whose LOD0 bounding boxes give each body's plan box (carHalf, _lf39BB). Here both come from the GLBs' JSON chunk alone:
// the kind's build metadata (the vehicle node's extras: size, hubs, wheelbase, axles, doors) and the LOD0 nodes' accessor
// bounds through their node transforms (the same box the page computes from the baked LOD0 geometry). No buffer is read.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { KIND24, R1D_FLEET_SEL } from '../../client/src/sim/fleet24.js';
import { PUBLIC } from '../env/shim.mjs';

const { F27, NV34, VH36_OUT, VH36_BASE, VH36_FILE, BASE } = R1D_FLEET_SEL;

function glbJson(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + file);
  const jl = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
}
const deq = (v, a) => (a.normalized ? (a.componentType === 5122 ? Math.max(v / 32767, -1) : a.componentType === 5120 ? Math.max(v / 127, -1) : a.componentType === 5123 ? v / 65535 : a.componentType === 5121 ? v / 255 : v) : v);
function nodeMatrix(n) {
  const m = new THREE.Matrix4();
  if (n.matrix) return m.fromArray(n.matrix);
  return m.compose(new THREE.Vector3().fromArray(n.translation || [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale || [1, 1, 1]));
}
// the kind's metadata and its LOD0 plan box (the rear body of an articulated bus is its own set in the page: left out)
export function readKind(file) {
  const J = glbJson(file);
  const rootI = J.nodes.findIndex((n) => n.extras && n.extras.hubs);
  const root = J.nodes[rootI >= 0 ? rootI : 0];
  const meta = { ...(root.extras || {}) };
  const parent = new Map();
  J.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const world = (i) => { const M = nodeMatrix(J.nodes[i]); for (let p = parent.get(i); p !== undefined; p = parent.get(p)) M.premultiply(nodeMatrix(J.nodes[p])); return M; };
  const lod0 = J.nodes.findIndex((n) => n.name === 'LOD0');
  const box = new THREE.Box3(), rearBox = new THREE.Box3();
  const visit = (i, rear) => {
    const n = J.nodes[i];
    const isRear = rear || /^LOD\d_rear(_\d+)?$/.test(n.name || '') || /^REAR_LOD\d/.test(n.name || '');
    if (n.mesh !== undefined) {
      const M = world(i);
      for (const pr of J.meshes[n.mesh].primitives) {
        const a = J.accessors[pr.attributes.POSITION];
        if (!a || !a.min || !a.max) continue;
        const b = new THREE.Box3(new THREE.Vector3(...a.min.map((v) => deq(v, a))), new THREE.Vector3(...a.max.map((v) => deq(v, a))));
        (isRear ? rearBox : box).union(b.applyMatrix4(M));
      }
    }
    for (const c of n.children || []) visit(c, isRear);
  };
  if (lod0 >= 0) visit(lod0, false);
  const rearLod0 = J.nodes.findIndex((n) => /^REAR_LOD0(_\d+)?$/.test(n.name || ''));
  if (rearLod0 >= 0) visit(rearLod0, true);
  const size = meta.size || [2, 1.5, 4.6];
  // an articulated bus's rear body (fleet24 buildKind: towed about the turntable pivot, `tow` m to its axle)
  const PIV = meta.turntable || meta.pivot || null;
  const hasRear = J.nodes.some((n) => /^REAR_LOD0/.test(n.name || '') || /^LOD0_rear(_\d+)?$/.test(n.name || ''));
  let rear = null;
  if (PIV && hasRear) {
    const hz = (meta.hubs || []).filter((h) => h.id >= 5).map((h) => h.p[2]);
    const axle = hz.length ? Math.min(...hz) : -(size[2] / 2 - 2.5);
    // (traffic.js _rearBody reads the rear body's plan box from rear.lods[0], as it reads the front's from lods[0])
    rear = { pivot: PIV, tow: Math.max(1, PIV[2] - axle), lods: [rearBox.isEmpty() ? [] : [{ cls: 'paint', geometry: { attributes: { position: true }, boundingBox: rearBox } }]] };
  }
  return { meta, size, box: box.isEmpty() ? null : box, rear };
}

// trafficFleet as loadFleet24 builds it (the same kind filter, weights, caps and weighted parked list)
export function loadFleetMeta({ dir = path.join(PUBLIC, BASE) } = {}) {
  const wanted = Object.keys(KIND24).filter((k) => !(KIND24[k].f27 && (F27 === '0' || (KIND24[k].f27 === 'qa' && F27 !== 'all'))) && !(KIND24[k].nv34 && !NV34) && !VH36_OUT.has(k));
  const baseOf = (k) => VH36_BASE[k] || KIND24[k].base || null;
  const kinds = {};
  for (const b of new Set(wanted.map((k) => baseOf(k) || k))) {
    const f = path.join(dir, (VH36_FILE[b] || b) + '.glb');
    if (!fs.existsSync(f)) { console.warn('[core fleet] missing', f); continue; }
    kinds[b] = { kind: b, ...readKind(f) };
  }
  for (const k of wanted) if (baseOf(k) && kinds[baseOf(k)]) kinds[k] = { ...kinds[baseOf(k)], kind: k, meta: { ...kinds[baseOf(k)].meta }, size: [...kinds[baseOf(k)].size] };
  for (const k of Object.keys(kinds)) if (!wanted.includes(k)) delete kinds[k];
  const names = Object.keys(KIND24).filter((k) => kinds[k]);
  // the page's kind record for traffic.js: lods[0] holds one part whose geometry carries only the precomputed LOD0 box
  for (const k of names) {
    const K = kinds[k];
    K.lods = K.box ? [[{ cls: 'paint', geometry: { attributes: { position: true }, boundingBox: K.box } }]] : [[]];
    K.lamps = null;
  }
  const trafficFleet = {};
  for (const k of names) {
    const K = kinds[k];
    const box = new THREE.BoxGeometry(K.size[0], K.size[1], K.size[2]).translate(0, K.size[1] / 2, 0);
    trafficFleet[k] = { paint: box, dark: box, parts: {}, shell: null, cap: KIND24[k].cap, w: KIND24[k].w, lamps: null, f24: K };
  }
  // weighted parked kinds (loadFleet24, verbatim logic)
  const parked = names.filter((k) => !KIND24[k].f27).flatMap((k) => Array(KIND24[k].pw).fill(k));
  const extra = names.filter((k) => KIND24[k].f27).flatMap((k) => Array(Math.round(KIND24[k].pw * 2)).fill(k));
  if (extra.length && extra.length >= parked.length) {
    parked.splice(0, parked.length, ...names.flatMap((k) => Array(Math.round(KIND24[k].pw * 2)).fill(k)));
  } else if (extra.length) {
    const copy = parked.slice(), n = new Map();
    for (const k of copy) n.set(k, (n.get(k) || 0) + 1);
    const quota = new Map([...n].map(([k, c]) => [k, (extra.length * c) / copy.length]));
    for (const k of extra) {
      const top = [...quota].filter(([q]) => n.get(q) > 0).sort((a, b) => b[1] - a[1])[0][0];
      copy[copy.lastIndexOf(top)] = k;
      quota.set(top, quota.get(top) - 1);
      n.set(top, n.get(top) - 1);
    }
    parked.push(...copy);
  }
  trafficFleet.__parkedKinds = parked;
  trafficFleet.__fleet24 = true;
  return { kinds, trafficFleet, names };
}

// what installFleet24 publishes on the traffic object for the model (the rendering half is the renderer's business)
export function installFleetMeta(traffic, kinds) {
  traffic.fleet24 = { kinds, groups: [], stats: {} };
  traffic.vehDims = Object.fromEntries(Object.entries(kinds).map(([k, K]) => [k, [+K.size[0].toFixed(2), +K.size[1].toFixed(2), +K.size[2].toFixed(2)]]));
}
