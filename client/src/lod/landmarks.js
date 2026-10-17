// The landmark registry's always-resident level (?lod16=1): client/public/data/landmarks.json lists the landmarks (key,
// name, kind, landmark id or feature, centre, priority) and the L6 silhouette of each, generated from our own meshes by
// tools/lod/bake_landmarks.mjs (at most about 2,000 triangles each) into one binary (CTL1 sections pos/col/uv/idx).
// Landmarks are never merged into chunks and never evicted; they are hidden only where a ready near tile draws the
// full landmark (the NM24 near mask in the shell material) and, like every mesh, outside the frustum.
// Entries whose `drawnBy` names a module that already keeps them resident at full detail (the bridges: city/bridgeKit.js
// builds all of them at boot) keep their silhouette in the registry for the other renderers and are not drawn twice.
import * as THREE from 'three';
import { parseTile } from '../world/tiledata.js';
import { makeShellMaterial } from './shellMaterial.js';

// { nearMask: false } (BD40): the backdrop's towers (tools/lod/build_backdrop.mjs, landmarks_bd.json) lie outside the city,
// where no near tile draws them, so the near mask must not hide them
export async function loadLandmarks(group, url = 'data/landmarks.json', { nearMask = true } = {}) {
  const r = await fetch(url);
  if (!r.ok) { console.warn('[lod16] no landmark registry at', url); return []; }
  const reg = await r.json();
  if (!reg.file) return [];
  const buf = await (await fetch(`data/${reg.file}`)).arrayBuffer();
  const t = parseTile(buf);
  const S = t.S, sc = t.header.scale || 0.125;
  const out = [];
  for (const L of reg.landmarks) {
    const it = L.l6;
    const rec = { key: L.key, name: L.name, kind: L.kind, mesh: null, tris: 0, bytes: 0, drawnBy: L.drawnBy || null };
    out.push(rec);
    if (!it || !it.ni || L.drawnBy) continue;
    const g = new THREE.BufferGeometry();
    const pos = S.pos.subarray(it.v0 * 3, (it.v0 + it.nv) * 3), col = S.col.subarray(it.v0 * 4, (it.v0 + it.nv) * 4);
    const uv = S.uv.subarray(it.v0 * 2, (it.v0 + it.nv) * 2), idx = S.idx.subarray(it.i0, it.i0 + it.ni);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, makeShellMaterial({ nearMask }));
    m.position.set(it.origin[0], it.origin[1], it.origin[2]);
    m.scale.setScalar(sc);
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.name = `lod16_lm_${L.key}`;
    group.add(m);
    rec.mesh = m; rec.tris = it.ni / 3; rec.bytes = pos.byteLength + col.byteLength + uv.byteLength + idx.byteLength;
  }
  console.log(`[lod16] landmarks: ${out.filter((l) => l.mesh).length} drawn of ${out.length} in the registry`);
  return out;
}
