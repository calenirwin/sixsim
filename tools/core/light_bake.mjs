// A take's light and sky inputs without the city page: the page's own light code (core/engine.js's lights and post
// passes, world/sky.js, world/weather.js with settings/graphics.json and the take's ?gfx flags, world/cityLamps.js,
// world/night11.js, sim/headlamps.js) runs alone in headless Chromium on SwiftShader (no GPU, no tiles, no sims), set to
// the shot's time of day and its camera, and the export's own light pass reads it (harvest_lights.mjs lightsStatic,
// imported as it is), so ue_light.py and blender_light.py get the files they read:
//   lights.json        the scene's lights, tone mapping, exposure, fog (harvest.mjs __EXP.lights, mirrored here)
//   light_static.json  the time of day, the street lamps, the lamp rig, the headlamp constants, the sun, the sky
//                      uniforms, the haze, the bloom, the grade, the exposure (harvest_lights.mjs)
//   sky_vis.f16/.hdr   the visible dome, sky_env.f16/.hdr the dome the IBL is baked from (harvest_lights.mjs; .hdr as
//                      ue_prep.py and blender_light.py write them)
//   light_<shot>.json  per frame the exposure and the bloom (here, along the take's camera) and the twelve headlamp beams
//                      (from the core's take: light_frames.json)
// The street lamps come from lane A's cell packages: every head the page lights with (the sidecars' `lights`, with each
// head's kind, full-precision position and fixture since 2026-10-11) within --lamp-radius (900 m) of the lens path, as
// the page's own lamp spots (world/life.js lampSpots: head x, ground y, head z, fixture, height, arm yaw). --lamps bake
// takes the page's dump of the region instead (tools/core/signals_dump.mjs), --lamps sidecar the older sidecars' poles
// by the rule city/props.js uses; with both packages and dump at hand the two are compared (printed, lamps_compare.json).
//
//   node tools/core/light_bake.mjs --take shots/core/r2/<shot>_s1 --out <harvest dir> [--sky 4096] [--cube 1536]
//        [--lamps cells|bake|sidecar] [--lamp-radius 900]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const take = path.resolve(opt('take'));
const out = path.resolve(opt('out', path.join(take, 'harvest')));
fs.mkdirSync(out, { recursive: true });
const { readTracks } = await import('../../core/tracks/format.mjs');
const T = readTracks(path.join(take, 'tracks.atrk'));
const H = T.header, shot = H.shot, rows = H.camera.rows;
const { lightsStatic } = await import('../../client/tools/ar34/export/harvest_lights.mjs');
const { lampKind } = await import('../../client/src/world/night11.js');

// ---- the street lamps near the path: from the cell packages (default), the page's dump, or the older sidecars' poles
const CELLS = '/data0/projectnyc_aux/cellcache';
const index = JSON.parse(fs.readFileSync(path.join(CELLS, 'index.json'), 'utf8'));
const pathPts = (H.region && H.region.path) || rows.map((r) => [r[0], r[2]]);
const LAMP_R = parseFloat(opt('lamp-radius', '900'));
const near = (x, z, R) => pathPts.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 <= R * R);
const fromCells = [], fromPoles = [], cellBox = [];
let cellsRead = 0;
for (const [key, c] of Object.entries(index.cells)) {
  const [x0, , z0, x1, , z1] = c.bounds;
  if (!near((x0 + x1) / 2, (z0 + z1) / 2, LAMP_R + 100)) continue;
  let S;
  try { S = JSON.parse(fs.readFileSync(path.join(CELLS, c.hash, 'cell.json'), 'utf8')); } catch { continue; }
  cellsRead++;
  cellBox.push([x0, z0, x1, z1]);
  for (const L of S.lights || []) {
    if (L.fixture) { if (near(L.x, L.z, LAMP_R)) fromCells.push([L.x, L.y, L.z, L.fixture.index, L.fixture.height, L.fixture.yaw ?? null]); continue; }
    // (sidecars before 2026-10-11: the pole, its kind and heading; city/props.js puts the head 3.4 m out along the arm for
    // a cobrahead at 8.2 m, 1.7 m for a bishop's crook at 5.9 m, 7 cm over the pole's foot; the fixture is a hash of the
    // pole's exact position, which those sidecars rounded to the centimetre)
    const crook = L.kind === 'lampCrook';
    if (L.kind !== 'lampCobra' && !crook) continue;
    const r = crook ? 1.7 : 3.4;
    fromPoles.push([L.x + Math.sin(L.rot) * r, L.y + 0.07, L.z + Math.cos(L.rot) * r, lampKind(L.x, L.z, crook), crook ? 5.9 : 8.2, crook ? null : L.rot]);
  }
}
const bakeF = path.join(ROOT, 'shots/core/signals', `${shot}.json`);
const bake = fs.existsSync(bakeF) ? (JSON.parse(fs.readFileSync(bakeF, 'utf8')).lampSpots || null) : null;
const fromBake = bake ? bake.filter((q) => near(q[0], q[2], LAMP_R)) : [];
const lampSrc = opt('lamps', fromCells.length ? 'cells' : bake ? 'bake' : 'sidecar');
const spots = lampSrc === 'cells' ? fromCells : lampSrc === 'bake' ? fromBake : fromPoles;
// the packages against the page's dump: every dumped head inside the baked cells matched to the nearest packaged head
if (fromCells.length && fromBake.length) {
  const inCells = (x, z) => cellBox.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
  const grid = new Map(), gk = (x, z) => `${Math.floor(x / 2)}_${Math.floor(z / 2)}`;
  for (const q of fromCells) { const k = gk(q[0], q[2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(q); }
  const C = { packaged: fromCells.length, dumped: fromBake.length, dumpedInsideCells: 0, matched: 0, maxDistM: 0, maxDyM: 0, sameFixture: 0, sameHeight: 0, sameYaw: 0, dumpedOutsideCells: 0 };
  for (const q of fromBake) {
    if (!inCells(q[0], q[2])) { C.dumpedOutsideCells++; continue; }
    C.dumpedInsideCells++;
    let best = null, bd = 0.5;
    const gx = Math.floor(q[0] / 2), gz = Math.floor(q[2] / 2);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of grid.get(`${gx + i}_${gz + j}`) || []) { const d = Math.hypot(p[0] - q[0], p[2] - q[2]); if (d < bd) { bd = d; best = p; } }
    if (!best) continue;
    C.matched++; C.maxDistM = Math.max(C.maxDistM, bd); C.maxDyM = Math.max(C.maxDyM, Math.abs(best[1] - q[1]));
    C.sameFixture += best[3] === q[3]; C.sameHeight += Math.abs(best[4] - q[4]) < 1e-6;
    C.sameYaw += (best[5] === null && q[5] === null) || (best[5] !== null && q[5] !== null && Math.abs(best[5] - q[5]) < 1e-5);
  }
  fs.writeFileSync(path.join(out, 'lamps_compare.json'), JSON.stringify(C, null, 1));
  console.log(`[light] ${shot} lamps: ${C.packaged} packaged heads within ${LAMP_R} m of the path; of the page's ${C.dumped}, ${C.dumpedInsideCells} inside the baked cells, ${C.matched} matched (max ${C.maxDistM.toFixed(4)} m, height diff ${C.maxDyM.toFixed(4)} m, fixture ${C.sameFixture}, mount height ${C.sameHeight}, yaw ${C.sameYaw}); ${C.dumpedOutsideCells} outside the cells`);
}
console.log(`[light] ${shot} (${H.time}): ${spots.length} street lamps (${lampSrc === 'cells' ? `the packages: ${cellsRead} cell sidecars` : lampSrc === 'bake' ? "the page's dump" : `${cellsRead} cell sidecars' poles`})`);

// ---- a sink for the domes (harvest_lights.mjs posts them to cfg.sink when it has no harvest lib)
const sink = http.createServer((req, res) => {
  // the page's POST of a binary body is a cross-origin request with a preflight: answer it
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }
  const m = /^\/put\/([\w.]+)$/.exec(req.url || '');
  if (req.method !== 'POST' || !m) { res.writeHead(404); res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { fs.writeFileSync(path.join(out, m[1]), Buffer.concat(chunks)); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok'); });
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const sinkUrl = `http://127.0.0.1:${sink.address().port}`;

const port = String(5400 + Math.floor(Math.random() * 3000));
const bdir = path.join(ROOT, 'client');
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await sleep(4000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--window-size=2560,1440'] });
const cleanup = async () => { try { await browser.close(); } catch {} try { vite.kill('SIGTERM'); } catch {} try { sink.close(); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });
const t0 = Date.now();
try {
  // the film's frame (shots.json _meta size, 2560 x 1440): the post passes' sizes (the grade's texel) follow it
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  // a document of the dev server's origin carrying the take's query (the light modules read their flags from it); no app
  await page.goto(`http://127.0.0.1:${port}/settings/graphics.json${H.query || ''}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const setup = await page.evaluate(async (A) => {
    const eng = await import('/src/core/engine.js'), skyM = await import('/src/world/sky.js'), wth = await import('/src/world/weather.js');
    const life = await import('/src/world/life.js'), CLM = await import('/src/world/cityLamps.js');
    const u = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/\.vite\/deps\/three\.js(\?|$)/.test(n));
    const THREE = await import(u);
    document.body.innerHTML = '';
    const el = document.createElement('div'); el.id = 'app'; el.style.cssText = 'width:2560px;height:1440px'; document.body.appendChild(el);
    const engine = new eng.Engine(el);
    engine.holdDraw = true;   // nothing drawn by the loop: the light state is all this needs (the domes draw themselves)
    const sky = new skyM.Sky(engine);
    const Q = new URLSearchParams(location.search);
    sky.apply(Q.get('time') || A.time);
    const weather = wth.createWeather(engine.scene, engine.camera, engine);
    try { const r = await fetch('/settings/graphics.json'); if (r.ok) { wth.applyGfx(await r.json()); sky.apply(sky.mode); } } catch { /* defaults */ }
    if (Q.get('gfx')) {
      for (const kv of Q.get('gfx').split(',')) { const [k, v] = kv.split(':'); if (k in wth.GFX) wth.GFX[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; }
      sky.apply(sky.mode);
    }
    const lamps = new CLM.CityLamps();
    window.__LAMPS = lamps;
    for (const s of A.spots) life.lampSpots.push(s);
    const { ENV } = await import('/src/world/materials.js');
    const cam = engine.camera;
    const place = (r, t) => {
      cam.position.set(r[0], r[1], r[2]); cam.quaternion.set(r[3], r[4], r[5], r[6]);
      if (Math.abs(cam.fov - r[7]) > 1e-6 || Math.abs(cam.aspect - 16 / 9) > 1e-6) { cam.fov = r[7]; cam.aspect = 16 / 9; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
      engine.updateSun(sky.sunDir, r[0], r[1], r[2]);
      if (engine.haze?.uniforms?.uCamPos) engine.haze.uniforms.uCamPos.value.copy(cam.position);   // as the haze pass sets it each frame
      if (t !== undefined) ENV.time.value = t;   // the sim clock of that frame (the clouds' drift, the grain's time)
    };
    place(A.cam0);
    // the page's state once its light probe has captured (engine.probeOn eases 0 -> 1; weather.js trades hemisphere light
    // for it): the probe's own picture of the city cannot be made without the city, its weight in the rig can
    engine.probeOn = 1;
    // the exposure meter (core/engine.js) reads the drawn frame: want = clamp(target / scene average, aeMin, 1.35). With no
    // city drawn it stays at 1. At golden, dusk and night the page's meter sat at its 1.35 clamp in the shots measured
    // (t8LenoxDive, scLakeGolden: exposure x 1.227 over the meter at 1), so the headless light takes that clamp there
    // (--ae 1 leaves it at 1; by day the meter's reading depends on the scene and stays 1)
    if (A.ae !== null && sky.mode !== 'day') engine.autoExpo = A.ae;
    // the per-frame light state settles over the boot's frames in the page; the street lamps' rig (CL24 lights near the
    // lens, the bounce share they take) updates with the camera as main.js does every frame
    for (let i = 0; i < 240; i++) { sky.update(1 / 30); weather.update(1 / 30); lamps.update(cam, ENV.night.value, 1 / 30, engine); }
    place(A.cam0, A.t0); sky.update(0); weather.update(0); lamps.update(cam, ENV.night.value, 0, engine);
    window.__ENGINE = engine; window.__EXP = { getThree: async () => THREE, lib: null };
    window.__R1D = { sky, weather, place };
    return { mode: sky.mode, exposure: engine.renderer.toneMappingExposure, toneMapping: engine.renderer.toneMapping, night: (await import('/src/world/materials.js')).ENV.night.value };
  }, { time: H.time, cam0: rows[0], spots, t0: H.simTime[0], ae: opt('ae', 'clamp') === 'clamp' ? 1.35 : parseFloat(opt('ae', '1')) });
  console.log(`[light] page light set: ${JSON.stringify(setup)}`);
  // lights.json: the scene's lights as harvest.mjs collects them (its __EXP.lights, mirrored)
  const LJ = await page.evaluate(async () => {
    const E = window.__ENGINE, T = await window.__EXP.getThree();
    const o = { lights: [], toneMapping: E.renderer.toneMapping, exposure: E.renderer.toneMappingExposure, outputColorSpace: E.renderer.outputColorSpace };
    E.scene.traverse((L) => {
      if (!L.isLight) return;
      L.updateMatrixWorld();
      const r = { type: L.type, name: L.name, visible: L.visible, color: [L.color.r, L.color.g, L.color.b], intensity: L.intensity, pos: L.getWorldPosition(new T.Vector3()).toArray() };
      if (L.target) { L.target.updateMatrixWorld(); r.target = L.target.getWorldPosition(new T.Vector3()).toArray(); }
      if (L.groundColor) r.groundColor = [L.groundColor.r, L.groundColor.g, L.groundColor.b];
      if (L.castShadow) r.castShadow = true;
      if (L.distance !== undefined) r.distance = L.distance;
      o.lights.push(r);
    });
    if (E.scene.fog) o.fog = { type: E.scene.fog.type, color: E.scene.fog.color?.toArray(), near: E.scene.fog.near, far: E.scene.fog.far, density: E.scene.fog.density };
    o.environmentIntensity = E.scene.environmentIntensity;
    o.background = E.scene.background ? (E.scene.background.isColor ? E.scene.background.toArray() : E.scene.background.type) : null;
    try { o.sunInfo = { elev: E.sunElev ?? null, az: E.sunAz ?? null }; } catch {}
    return o;
  });
  fs.writeFileSync(path.join(out, 'lights.json'), JSON.stringify(LJ, null, 1));
  // light_static.json and the domes: the export's own light pass, run on this page (lamps: every spot given, F wide)
  const S = await lightsStatic(page, out, { cx: rows[0][0], cz: rows[0][2], F: 100000, sink: sinkUrl, cube: parseInt(opt('cube', '1536'), 10), eqW: parseInt(opt('sky', '4096'), 10) });
  // per frame along the take's camera: the exposure and the bloom; the headlamp beams from the core
  const LF = fs.existsSync(path.join(take, 'light_frames.json')) ? JSON.parse(fs.readFileSync(path.join(take, 'light_frames.json'), 'utf8')) : [];
  const perFrame = await page.evaluate(async ([rowsA, simT]) => {
    const E = window.__ENGINE, R = window.__R1D, outA = [];
    const { ENV } = await import('/src/world/materials.js');
    rowsA.forEach((r, i) => {
      R.place(r, simT[i]);
      R.sky.update(0); R.weather.update(i ? 1 / 30 : 0); window.__LAMPS.update(E.camera, ENV.night.value, i ? 1 / 30 : 0, E);
      outA.push({ exposure: E.renderer.toneMappingExposure, bloom: E.bloom ? [E.bloom.strength, E.bloom.radius, E.bloom.threshold, E.bloom.highPassUniforms?.smoothWidth?.value ?? null] : null });
    });
    return outA;
  }, [rows, H.simTime]);
  perFrame.forEach((f, i) => { f.spots = (LF[i] && LF[i].spots) || []; });
  fs.writeFileSync(path.join(out, `light_${shot}.json`), JSON.stringify(perFrame));
  // the domes as Radiance .hdr (rows top first, flat RGBE), as ue_prep.py sky_hdr and blender_light.py write_hdr do
  for (const [key, fn] of [['skyVis', 'sky_vis.f16'], ['skyEnv', 'sky_env.f16']]) {
    const info = S[key];
    const p = path.join(out, fn);
    if (!info || !info.w || !fs.existsSync(p)) continue;
    const w = info.w, h = info.h, b = fs.readFileSync(p), u16 = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    const half = (x) => { const s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); };
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = h - 1 - y;   // rows bottom-up in the capture, top first in the file
      for (let x = 0; x < w; x++) {
        const i = (src * w + x) * 3, o = (y * w + x) * 4;
        let r = half(u16[i]), g = half(u16[i + 1]), bl = half(u16[i + 2]);
        r = r > 0 && isFinite(r) ? r : 0; g = g > 0 && isFinite(g) ? g : 0; bl = bl > 0 && isFinite(bl) ? bl : 0;
        const m = Math.max(r, g, bl);
        if (m <= 1e-32) continue;
        const ex = Math.floor(Math.log2(m)) + 1, sc = 256 / 2 ** ex;   // frexp: m = f * 2^ex with f in [0.5, 1)
        px[o] = Math.min(255, Math.floor(r * sc)); px[o + 1] = Math.min(255, Math.floor(g * sc)); px[o + 2] = Math.min(255, Math.floor(bl * sc)); px[o + 3] = ex + 128;
      }
    }
    fs.writeFileSync(p.slice(0, -4) + '.hdr', Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`), px]));
  }
  console.log(`[light] ${shot}: ${S.mode} night ${S.night}, exposure ${(+S.exposure).toFixed(4)}, ${S.lamps?.length ?? 0} lamps, sky ${S.skyVis?.w}x${S.skyVis?.h} max ${(+S.skyVis?.max).toFixed(3)}, ${perFrame.length} frames (${perFrame.reduce((a, f) => a + f.spots.length, 0)} beams) in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(ROOT, out)}`);
} catch (e) {
  console.log('FAILED', e.stack || e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
