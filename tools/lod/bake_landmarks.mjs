#!/usr/bin/env node
// The landmark registry (client/public/data/landmarks.json) and its L6 silhouettes (client/public/data/lod16/landmarks_l6.bin):
// runs client/src/lod/bake_landmarks.html in headless Chromium against a Vite dev server (our builders need the browser's
// three.js build), then writes the registry and the binary (CTL1 sections pos Int16 x3 at 1/8 m about each landmark's
// origin, col Uint8 x4, uv Float32 x2, idx Uint32, indices relative to each landmark's first vertex).
//   GPU_LANE=36 node tools/lod/bake_landmarks.mjs [--port <vite port>]
// Then rebuild the chunks (tools/lod/build_persistent.mjs) so the landmarks it lists leave the block shells.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTile } from '../../client/tools/pipeline/binio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bdir = path.join(root, 'client');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
// --live captures: the camera position to load, and which drawn objects make the landmark (THREE.LOD: the coarsest level)
const LIVE = [
  { key: 'bethesdaTerrace', name: 'Bethesda Terrace and Fountain', feature: 'cp:bethesdaTerrace', cam: [60, 820], at: [24, 978], r: 140, excludeR: 70, prefix: ['cp32b:', 'cp33b:'], night: { lamps: 'terrace lamps' } },
  { key: 'belvedereCastle', name: 'Belvedere Castle', feature: 'cp:belvedereCastle', cam: [140, 520], at: [185, 411], r: 120, excludeR: 35, lod: 'cpc33:castle' },
];
// in the page: world triangles (sRGB colours) of the named objects; LODs contribute their last level; instanced meshes skipped
const HARVEST = (L) => {
  const E = window.__ENGINE;
  if (!E) return null;
  E.scene.updateMatrixWorld(true);
  const P = [], C = [];
  let meshes = 0;
  const lin2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const take = (o) => {
    const g = o.geometry, pos = g && g.attributes && g.attributes.position;
    if (!pos || o.isInstancedMesh) return;
    const mt = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mt || mt.visible === false || (mt.transparent && mt.opacity < 0.3)) return;
    let col = mt.color ? [lin2s(mt.color.r), lin2s(mt.color.g), lin2s(mt.color.b)] : [0.62, 0.58, 0.52];
    if (mt.map && col[0] > 0.9 && col[1] > 0.9 && col[2] > 0.9) col = [0.62, 0.58, 0.52];   // a textured stone: its mean tint
    const e = o.matrixWorld.elements, idx = g.index, n = idx ? idx.count : pos.count;
    meshes++;
    for (let q = 0; q + 2 < n; q += 3) for (let w = 0; w < 3; w++) {
      const vi = idx ? idx.getX(q + w) : q + w;
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      C.push(col[0], col[1], col[2]);
    }
  };
  const walk = (o, inside, level = false) => {
    if (o.visible === false && !o.isLOD && !level) return;   // a LOD's coarsest level is hidden while the camera is near: taken anyway
    if (o.isLOD && o.levels && o.levels.length) { walk(o.levels[o.levels.length - 1].object, inside || (L.lod && o.name === L.lod), true); return; }
    const named = L.prefix ? L.prefix.some((p) => (o.name || '').startsWith(p)) : false;
    const inS = inside || named;
    if (inS && o.isMesh) {
      const wp = o.getWorldPosition ? o.getWorldPosition(o.position.clone()) : null;
      if (!wp || Math.hypot(wp.x - L.at[0], wp.z - L.at[1]) < L.r + 400) take(o);
    }
    for (const c of o.children) walk(c, inS);
  };
  walk(E.scene, false);
  // keep only the triangles near the landmark
  const P2 = [], C2 = [];
  for (let t = 0; t < P.length; t += 9) {
    const cx = (P[t] + P[t + 3] + P[t + 6]) / 3, cz = (P[t + 2] + P[t + 5] + P[t + 8]) / 3;
    if (Math.hypot(cx - L.at[0], cz - L.at[1]) > L.r) continue;
    for (let k = 0; k < 9; k++) { P2.push(P[t + k]); C2.push(C[t + k]); }
  }
  return { P: P2, C: C2, meshes };
};
let port = opt('port');
let server = null;
if (!port) {
  port = String(5400 + Math.floor(Math.random() * 3000));
  server = spawn(process.execPath, [path.join(bdir, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
  await new Promise((r) => setTimeout(r, 2500));
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8192'] });
let code = 0;
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
  // (BR38: --tiles <dir>: the bridges from a staged set's bridges.json)
  await page.goto(`http://127.0.0.1:${port}/src/lod/bake_landmarks.html${opt('tiles') ? `?tiles=${opt('tiles')}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('window.__BAKE_READY === true', undefined, { timeout: 300000 });
  const { out, log } = await page.evaluate(() => window.__BAKE());
  for (const l of log) console.log(' ', l);
  // --live: landmarks built by the area kits inside the near tiles (no standalone builder), harvested from the client
  if (opt('live') === '1') {
    for (const L of LIVE) {
      try {
        const lp = await browser.newPage({ viewport: { width: 640, height: 360 } });
        lp.on('pageerror', (e) => console.log('[live pageerror]', String(e).slice(0, 200)));
        await lp.goto(`http://127.0.0.1:${port}/?shot=1&record=1&hud=0&lmwait=150&life=0&clean=1&nopeds=1&x=${L.cam[0]}&z=${L.cam[1]}&y=80&time=day`, { waitUntil: 'domcontentloaded', timeout: 300000 });
        await lp.waitForFunction('window.__READY === true', undefined, { timeout: 300000 }).catch(() => console.log('  live: READY timeout'));
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
          if (await lp.evaluate(() => { const s = window.__STREAMER; return !!(s && s.idle && s.idle()); })) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        await new Promise((r) => setTimeout(r, 4000));
        const raw = await lp.evaluate(HARVEST, L);
        await lp.close();
        if (!raw || !raw.P.length) { console.log(`  ${L.key}: nothing harvested`); continue; }
        const pk = await page.evaluate(([P, C, lit]) => window.__PACK(P, C, lit), [raw.P, raw.C, 0]);
        out.push({ key: L.key, name: L.name, kind: 'park', feature: L.feature, excludeR: L.excludeR, priority: 2, night: L.night || null, tris0: pk.tris0, tris: pk.tris, err: pk.err, how: pk.how, ...pk });
        console.log(`  ${L.key}: ${raw.meshes} meshes, ${pk.tris0} -> ${pk.tris} (${pk.how}, err ${pk.err.toFixed(4)}) [live]`);
      } catch (e) { console.log(`  ${L.key}: live capture failed ${e.message}`); }
    }
  }
  const P = [], C = [], U = [], I = [], reg = [];
  for (const L of out) {
    const v0 = P.length / 3, i0 = I.length;
    P.push(...L.P); C.push(...L.C); U.push(...L.U);
    for (let k = 0; k < L.nv; k++) I.push(k);
    const [x0, y0, z0, x1, y1, z1] = L.bbox;
    reg.push({
      key: L.key, name: L.name, kind: L.kind, ...(L.lmId ? { lmId: L.lmId, mode: L.mode, tile: L.tile } : {}), ...(L.feature ? { feature: L.feature } : {}), ...(L.excludeR ? { excludeR: L.excludeR } : {}),
      bin: null, priority: L.priority, ...(L.drawnBy ? { drawnBy: L.drawnBy } : {}), night: L.night,
      center: [+((x0 + x1) / 2).toFixed(1), +((y0 + y1) / 2).toFixed(1), +((z0 + z1) / 2).toFixed(1)],
      radius: +(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2).toFixed(1), top: +y1.toFixed(1),
      l6: { origin: L.origin.map((v) => +v.toFixed(2)), v0, nv: L.nv, i0, ni: L.nv, tris: L.tris, from: L.tris0, how: L.how, err: +L.err.toFixed(5) },
    });
  }
  // (BR38: --dry: the bake and its log, nothing written)
  if (opt('dry')) { console.log(`dry run: ${reg.length} landmarks, ${I.length / 3} triangles; nothing written`); throw Object.assign(new Error('dry run'), { dry: true }); }
  const binRel = 'lod16/landmarks_l6.bin';
  writeTile(path.join(bdir, 'public/data', binRel), { v: 1, scale: 1 / 8, count: reg.length }, [
    { name: 'pos', array: Int16Array.from(P) }, { name: 'col', array: Uint8Array.from(C) },
    { name: 'uv', array: Float32Array.from(U) }, { name: 'idx', array: Uint32Array.from(I) },
  ]);
  const doc = {
    v: 1, built: new Date().toISOString(), file: binRel, levels: ['L6'], limitTris: 2000,
    note: 'Landmark registry, first list. L6 silhouettes from our own builders (city/landmarks.js, city/bridgeKit.js), simplified with meshoptimizer; keyed by landmark id (shared/landmarkSpec.js) or feature. bin: the footprint BIN, to be filled from the records module.',
    landmarks: reg,
  };
  fs.writeFileSync(path.join(bdir, 'public/data/landmarks.json'), JSON.stringify(doc, null, 1));
  console.log(`landmarks: ${reg.length}, ${I.length / 3} triangles, bin ${(fs.statSync(path.join(bdir, 'public/data', binRel)).size / 1024).toFixed(0)} KB`);
} catch (e) { if (!e.dry) { console.error(e); code = 1; } }
await browser.close();
if (server) server.kill();
process.exit(code);
