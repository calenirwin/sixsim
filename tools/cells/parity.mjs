// Parity of the cell packages against today's client: the same views with and without ?cells=1, 1:1 images, the
// difference image and its numbers, the boot to tiles-ready both ways, the bytes and draw counts.
//   GPU_LANE=35 node tools/withgpu.mjs cells-parity -- node tools/cells/parity.mjs --views lenoxRef,scTerraceGolden \
//        [--modes live,cells,live2] [--out shots/r1a/parity] [--flags k=v&...] [--size 1600x900]
// A view is a preset below, L:x:z:h:tx:tz:pitch[:time] (the L() numbers), or a shot of tools/ad/shots.json (its first
// key, its lens, time and flags). --probe x:z:r writes, per view and mode, the meshes drawn within r metres of (x, z)
// with their materials and maps (<view>_<mode>_probe.json). Both modes run
// with the simulations off (nosim, trains=0, life=0) so the frames differ only by the city.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, CACHE, sleep, stamp, startVite, startBrowser, newPage, guard, serveDir } from './harness.mjs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const sharp = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'))('sharp');
const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const project = (lon, lat) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
// L(camera x, z, height over the ground, target x, z, pitch): tools/bshot.mjs's convention (rel=1)
const L = (cx, cz, alt, tx, tz, pitch) => ({ x: cx, y: alt, z: cz, yaw: Math.atan2(-(tx - cx), -(tz - cz)), pitch, rel: true });
const PRESETS = {
  lenoxRef: { ...L(2094, -2609, 150, 2167, -2740, -0.78), time: 'golden' },   // tools/bshot.mjs lenoxRef
  retail125: { ...L(2132.5, -2773.8, 1.8, 2112, -2748, -0.02), time: 'golden' },
  lenoxEye: { ...L(2140.9, -2755.7, 2.6, 2210.2, -2742.5, 0.062), time: 'golden' },   // tools/bshot.mjs mLenoxEye
  lenoxAir: { ...L(2150, -2700, 22, 2168, -2742, -0.62), time: 'golden' },     // tools/bshot.mjs traffic125
  // eye level at signs: 300 Lenox Ave's storefronts (STARBUCKS COFFEE, AT&T, JUICI PATTIES) from across 125th Street,
  // and its rooftop billboard from t8LenoxDive's frame 6 (the camera of the take's load set, frame 6)
  lenoxSigns: { ...L(2207, -2723, 1.7, 2213, -2747, 0.16), time: 'day' },
  t8f006: { ...L(2204.55, -2713.34, 29.4, 2212.9, -2750.9, -0.55), time: 'day' },
};
const SHOTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
function viewOf(name) {
  if (PRESETS[name]) return PRESETS[name];
  if (name.startsWith('L:')) { const [x, z, h, tx, tz, pitch, time] = name.slice(2).split(':'); return { ...L(+x, +z, +h, +tx, +tz, +pitch), time: time || 'day' }; }   // L:x:z:h:tx:tz:pitch[:time]
  const s = (SHOTS.shots || {})[name] || (SHOTS.probes || {})[name];
  if (!s || !s.keys) return null;
  const k = s.keys[0], [px, pz] = project(k.p[0], k.p[1]), [lx, lz] = project(k.look[0], k.look[1]);
  const dy = k.look[2] - k.p[2], dh = Math.hypot(lx - px, lz - pz);
  return { x: px, y: k.p[2], z: pz, yaw: Math.atan2(-(lx - px), -(lz - pz)), pitch: Math.atan2(dy, dh), rel: !s.abs, fov: s.fov, time: s.time || 'golden', flags: (s.flags || '').replace(/(^|&)gfx=[^&]*/g, ''), key: k };
}
// --det: the page in the recorder's fixed-step mode with the view as a held camera path, stepped the same number of frames
// in every mode, so wind, water, spray and clouds are at the same instant and only the city can differ
const DET = !!opt('det'), DET_STEPS = Number(opt('steps', '45'));
const unproject = (x, z) => [x / M_LON + LON0, -z / M_LAT + LAT0];
function holdPathOf(v) {
  let K;
  if (v.key) K = v.key;
  else {   // a preset: height over the ground; the look point 100 m along the view
    const d = [-Math.sin(v.yaw) * Math.cos(v.pitch), Math.sin(v.pitch), -Math.cos(v.yaw) * Math.cos(v.pitch)];
    K = { p: [...unproject(v.x, v.z), v.y], look: [...unproject(v.x + d[0] * 100, v.z + d[2] * 100), v.y + d[1] * 100] };
  }
  const K2 = { p: [K.p[0] + 1e-6, K.p[1] + 1e-6, K.p[2]], look: K.look };
  return { duration: 1e6, ease: 0, abs: !v.rel, fov: v.fov || undefined, keys: [K, K2] };
}
const views = opt('views', 'lenoxRef').split(',');
const modes = opt('modes', 'live,cells').split(',');
const [W, H] = opt('size', '1600x900').split('x').map(Number);
const outDir = path.resolve(ROOT, opt('out', 'shots/r1a/parity'));
const BASEFLAGS = 'hud=0&lmwait=150&life=0&clean=1&nosim=1&trains=0' + (opt('flags') ? '&' + opt('flags') : '');
await fsp.mkdir(outDir, { recursive: true });
guard('cells-parity', 20 + 6 * views.length * modes.length);
const log = (...a) => console.log(`[parity ${stamp()}]`, ...a);

const { server, url } = await startVite();
const cache = await serveDir(CACHE);
const browser = await startBrowser(W, H);
const results = [];
try {
  if (opt('warm')) {   // one page first, not measured: the GPU's shader cache and the dev server warm, so the first measured run is not the cold one
    const logs = [], v = viewOf(views[0]);
    const page = await newPage(browser, W, H, 'parity warm', logs);
    await page.goto(`${url}/?shot=1${v.rel ? '&rel=1' : ''}&x=${v.x.toFixed(2)}&y=${v.y.toFixed(2)}&z=${v.z.toFixed(2)}&yaw=${v.yaw.toFixed(4)}&pitch=${v.pitch.toFixed(4)}&time=${v.time}&${BASEFLAGS}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    try { await page.waitForFunction('window.__READY === true', undefined, { timeout: 300000 }); } catch { /* */ }
    await sleep(2000);
    await page.close();
    log('warm-up page done');
  }
  for (const vn of views) {
    const v = viewOf(vn);
    if (!v) { log('unknown view', vn); continue; }
    for (const mode of modes) {
      const logs = [];
      const page = await newPage(browser, W, H, `parity ${vn} ${mode}`, logs);
      const q = `shot=1${DET ? '&record=1' : ''}${v.rel ? '&rel=1' : ''}&x=${v.x.toFixed(2)}&y=${v.y.toFixed(2)}&z=${v.z.toFixed(2)}&yaw=${v.yaw.toFixed(4)}&pitch=${v.pitch.toFixed(4)}&time=${v.time}`
        + `${v.fov ? '&fov=' + v.fov : ''}&${BASEFLAGS}${v.flags ? '&' + v.flags : ''}${mode.startsWith('cells') ? `&cells=1&cellsbase=${encodeURIComponent(cache.url)}` : ''}`;
      const t0 = Date.now();
      await page.goto(`${url}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      let ready = true;
      try { await page.waitForFunction('window.__READY === true', undefined, { timeout: 300000 }); } catch { ready = false; log(vn, mode, 'READY timeout'); }
      if (DET) {
        const r = await page.evaluate((P) => (window.__SET_PATH ? window.__SET_PATH(P) : 'no __SET_PATH'), holdPathOf(v)).catch((e) => String(e));
        log(vn, mode, 'held path', JSON.stringify(r));
      }
      const tReady = (Date.now() - t0) / 1000;
      if (mode.startsWith('liveL0')) {
        // today's client holding what the packages hold: every level at its finest over the baked cells and every building of
        // them dressed (the baker's own page code), so the frame differs from the cells frame only by where it came from
        const cellsList = Object.keys(JSON.parse(fs.readFileSync(path.join(CACHE, 'index.json'), 'utf8')).cells).map((k) => k.split('_').map(Number));
        const r = await page.evaluate(async (c) => { const B = await import('/src/cells/bakeLib.js'); await B.prepare({ cells: c }); return B.dressRegion({ keep: true }); }, cellsList);
        log(vn, mode, 'held L0 over', cellsList.length, 'cells:', JSON.stringify(r));
        try { await page.waitForFunction('(function(){ const d = window.__LD13; return !d || d.queue.length === 0; })()', undefined, { timeout: 180000 }); } catch { log(vn, mode, 'dresser queue did not drain'); }
      }
      try { await page.waitForFunction('!window.__DRESS || (function(){ const d = window.__DRESS(); return typeof d !== "object" || d.queued === 0; })()', undefined, { timeout: 60000 }); } catch { log(vn, mode, 'dresser queue did not drain'); }
      await sleep(3000);
      if (DET) {   // the same number of fixed steps in every mode: the clock (wind, water, spray) at the same instant
        for (let i = 0; i < DET_STEPS; i++) await page.evaluate(() => window.__advance(1 / 30));
        // and the far shadow cascade drawn afresh in every mode (it is cached and refreshed on its own clock)
        await page.evaluate(() => { const E = window.__ENGINE; if (E && E.invalidateFarShadow) E.invalidateFarShadow(); });
        for (let i = 0; i < 3; i++) await page.evaluate(() => window.__advance(1 / 30));
        await sleep(500);
      }
      const info = await page.evaluate(async () => {
        const C = window.__CELLS;
        const perf = window.__PERF ? await window.__PERF() : null;
        return { boot: window.__BOOT, perf, cells: C ? { ...C.stats, baked: C.baked.size, cellsLoaded: [...C.cells.values()].filter((c) => c.state === 'ready').length } : null };
      });
      info.calls = info.perf ? info.perf.calls : null; info.tris = info.perf ? info.perf.tris : null;
      if (opt('probe')) {   // --probe x:z:r: the meshes drawn within r metres of (x, z) and what they wear (material, map, origin)
        const [px, pz, pr] = opt('probe').split(':').map(Number);
        const rows = await page.evaluate(({ px, pz, pr }) => {
          const E = window.__ENGINE, out = [], v = { x: 0, y: 0, z: 0 };
          if (!E) return out;
          E.scene.updateMatrixWorld(true);
          E.scene.traverseVisible((o) => {
            if (!o.isMesh || !o.geometry) return;
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            const bs = o.geometry.boundingSphere, e = o.matrixWorld.elements;
            if (!bs) return;
            v.x = e[0] * bs.center.x + e[4] * bs.center.y + e[8] * bs.center.z + e[12]; v.z = e[2] * bs.center.x + e[6] * bs.center.y + e[10] * bs.center.z + e[14];
            if (Math.hypot(v.x - px, v.z - pz) > pr + bs.radius || bs.radius > 400) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (!m) continue;
              const t = m.map, img = t && (t.image || (t.source && t.source.data));
              out.push({ obj: (o.name || '').slice(0, 60), inst: !!o.isInstancedMesh, mat: (m.name || m.type).slice(0, 60), type: m.type,
                map: t ? `${(t.name || '').slice(0, 30)}|${img ? (img.width || 0) + 'x' + (img.height || 0) : 'noimg'}|${t.uuid.slice(0, 8)}` : null,
                cellTex: (m.userData && m.userData.cellTexture) || null, fallback: /^cellsFallback:/.test(m.name || ''), r: +bs.radius.toFixed(1) });
            }
          });
          return out;
        }, { px, pz, pr });
        await fsp.writeFile(path.join(outDir, `${vn}_${mode}_probe.json`), JSON.stringify(rows, null, 1));
        log(vn, mode, 'probe', rows.length, 'mesh materials near', opt('probe'), 'fallbacks', rows.filter((r) => r.fallback).length);
      }
      const file = path.join(outDir, `${vn}_${mode}.png`);
      const dataUrl = await page.evaluate(() => (typeof window.__capture === 'function' ? window.__capture('image/png') : null)).catch(() => null);
      if (dataUrl && dataUrl.startsWith('data:image')) await fsp.writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      else await page.screenshot({ path: file, timeout: 120000 });
      const readyMark = (info.boot || []).find((b) => b[1] === 'READY');
      const ringMark = (info.boot || []).find((b) => b[1] === 'near ring ready');
      info.nearRingS = ringMark ? ringMark[0] : null;
      if (info.cells) info.cells.lastReadyS = info.cells.lastReady ? +(info.cells.lastReady / 1000).toFixed(2) : null;
      const errs = logs.filter((l) => /PAGEERROR|\[pageerr\]|\[pagerej\]|\[cells\]/.test(l));
      results.push({ view: vn, mode, ready, readyS: readyMark ? readyMark[0] : tReady, wallS: tReady, ...info, file: path.relative(ROOT, file), notes: errs.slice(0, 12) });
      log(vn, mode, `READY ${readyMark ? readyMark[0] : '?'} s (near ring ${info.nearRingS} s, wall ${tReady.toFixed(1)} s), calls ${info.calls}, tris ${info.tris}`, info.cells ? JSON.stringify(info.cells) : '');
      if (errs.length) log('  ', errs.slice(0, 6).join('\n   '));
      await fsp.writeFile(path.join(outDir, `${vn}_${mode}.log`), logs.join('\n'));
      await page.close();
    }
    // the difference: per pixel |a - b| (max over rgb), the share over 8 and 24 levels, an amplified difference image
    const base = path.join(outDir, `${vn}_${modes[0]}.png`);
    for (const m of modes.slice(1)) {
      const other = path.join(outDir, `${vn}_${m}.png`);
      if (!fs.existsSync(base) || !fs.existsSync(other)) continue;
      const a = await sharp(base).removeAlpha().raw().toBuffer({ resolveWithObject: true }), b = await sharp(other).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      if (a.info.width !== b.info.width || a.info.height !== b.info.height) continue;
      const n = a.info.width * a.info.height, d = Buffer.alloc(n * 3);
      let s = 0, o8 = 0, o24 = 0;
      for (let i = 0; i < n; i++) {
        const dm = Math.max(Math.abs(a.data[i * 3] - b.data[i * 3]), Math.abs(a.data[i * 3 + 1] - b.data[i * 3 + 1]), Math.abs(a.data[i * 3 + 2] - b.data[i * 3 + 2]));
        s += dm; if (dm > 8) o8++; if (dm > 24) o24++;
        const v2 = Math.min(255, dm * 4); d[i * 3] = v2; d[i * 3 + 1] = v2; d[i * 3 + 2] = v2;
      }
      const df = path.join(outDir, `${vn}_diff_${modes[0]}_${m}.png`);
      await sharp(d, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toFile(df);
      const r = { view: vn, a: modes[0], b: m, meanAbs: +(s / n).toFixed(3), over8: +((100 * o8) / n).toFixed(3), over24: +((100 * o24) / n).toFixed(3), file: path.relative(ROOT, df) };
      results.push({ diff: r });
      log('diff', JSON.stringify(r));
      // a sheet: the two frames and the difference (x4) side by side at half size, labelled
      const w2 = Math.round(a.info.width / 2), h2 = Math.round(a.info.height / 2);
      const label = (t) => Buffer.from(`<svg width="${w2}" height="34"><rect width="100%" height="100%" fill="black" opacity="0.6"/><text x="10" y="24" font-family="sans-serif" font-size="20" fill="white">${t}</text></svg>`);
      const panels = [[base, `${vn}: ${modes[0]}`], [other, `${vn}: ${m}`], [df, `difference x4: mean ${r.meanAbs}, ${r.over8} % over 8`]];
      const comp = [];
      for (let i = 0; i < 3; i++) { comp.push({ input: await sharp(panels[i][0]).resize(w2, h2).png().toBuffer(), left: i * w2, top: 0 }); comp.push({ input: label(panels[i][1]), left: i * w2, top: 0 }); }
      await sharp({ create: { width: w2 * 3, height: h2, channels: 3, background: '#000' } }).composite(comp).png().toFile(path.join(outDir, `${vn}_sheet_${modes[0]}_${m}.png`));
    }
  }
} finally {
  await fsp.writeFile(path.join(outDir, `parity_${Date.now().toString(36)}.json`), JSON.stringify(results, null, 1));
  await browser.close().catch(() => {});
  server.kill();
  cache.srv.close();
}
