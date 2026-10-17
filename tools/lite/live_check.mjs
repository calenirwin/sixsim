// LITE15, SPACE r2: load the light showcase like a visitor and check it headlessly, on a built folder (a static server
// here) or on the published Space.
//   GPU_LANE=36 node tools/withgpu.mjs lite-live -- node tools/lite/live_check.mjs [url] [--dir <built dir>] [--out <dir>]
//       [--checks gpu,modes,nowebgl2,throttle,swiftshader] [--wait 300]
// gpu         1600x900 on the GPU: the time and megabytes to the first scene, console errors, failed requests
// modes       by key presses in the menu: Drone 10 s (it moves, every coordinate finite), Walk 10 s at 125th Street and Lenox
//             (it moves, stands on the ground, not inside a building), Drive 10 s at the Apollo (it moves, on the
//             carriageway), Night and Low quality, back to the Tour; a screenshot and the frame times at every step
// nowebgl2    a browser that refuses WebGL2: the trailer shows and nothing of the live city loads
// throttle    25 Mbit/s and 40 ms: the time to the first scene; the loader's line sampled every second, the longest stretch
//             without a change
// swiftshader software GL: the trailer fallback or the first scene, never a black screen
// --redirect (with --dir): binary files of 64 KB or more answer with a 302 to a second server on another origin that sends
// no Timing-Allow-Origin, as the published Space's LFS files do (Resource Timing then reports their sizes as 0)
// Writes <out>/live_check.json and the screenshots; exit 1 when a check fails.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', 'live_check'));
const CHECKS = arg('checks', 'gpu,modes,nowebgl2,throttle,swiftshader').split(',');
const WAIT = Number(arg('wait', '300'));
fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);

// ---- a static server for a built folder (byte ranges for the trailer)
let base = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'https://mehmetkeremturkcan-valdrada.static.hf.space/index.html';
let srv = null;
if (arg('dir')) {
  const DIR = path.resolve(arg('dir'));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
    '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.css': 'text/css', '.txt': 'text/plain' };
  const REDIR = argv.includes('--redirect');
  const serve = (cross) => (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const f = path.join(DIR, rel);
    if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    const n = fs.statSync(f).size, type = TYPES[path.extname(f)] || 'application/octet-stream';
    if (REDIR && !cross && n >= 65536 && /\.(bin|ktx2|glb|mp4|jpg|png|wasm|woff2|ttf)$/.test(rel)) {
      res.writeHead(302, { Location: `http://127.0.0.1:${cdn.address().port}/${rel.split('/').map(encodeURIComponent).join('/')}` }); res.end(); return;
    }
    if (cross) res.setHeader('Access-Control-Allow-Origin', '*');   // (no Timing-Allow-Origin, as on the CDN)
    const m = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (m) { const a = +m[1], b = m[2] ? +m[2] : n - 1; res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${n}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f, { start: a, end: b }).pipe(res); return; }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': n, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(res);
  };
  var cdn = http.createServer(serve(true));
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
  srv = http.createServer(serve(false));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/index.html`;
}
const GPU_ARGS = ['--ozone-platform=headless', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const R = { url: arg('dir') ? 'built folder ' + path.resolve(arg('dir')) : base, checks: {} };
const pass = (name, ok, detail) => { R.checks[name] = { pass: !!ok, ...detail }; log(name, ok ? 'PASS' : 'FAIL', JSON.stringify(detail).slice(0, 600)); };

// a page with the visitor's instruments: errors, failed requests, bytes, frame times
async function visitor(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...(opts.ctx || {}) });
  const page = await ctx.newPage();
  const I = { errors: [], failed: [], bytes: 0, reqs: 0, urls: [] };
  page.on('pageerror', (e) => I.errors.push('page error: ' + String(e).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error') I.errors.push('console: ' + m.text().slice(0, 240)); });
  // (a request the page itself cancels, a tile streamed out before it arrived, is not a failure: counted apart)
  I.aborted = 0;
  page.on('requestfailed', (r) => { const u = r.url(), e = r.failure()?.errorText || ''; if (/ERR_ABORTED/.test(e)) { I.aborted++; return; } if (!/trailer\.mp4/.test(u)) I.failed.push(u.slice(-90) + ' ' + e); });
  page.on('response', (r) => { if (r.status() >= 400) I.failed.push(`HTTP ${r.status()} ${r.url().slice(-90)}`); });
  page.on('requestfinished', async (r) => { I.reqs++; I.urls.push(r.url()); try { const s = await r.sizes(); I.bytes += s.responseBodySize; } catch { /* */ } });
  await page.addInitScript(() => {
    window.__FT = []; let last = performance.now();
    const loop = (t) => { window.__FT.push(t - last); last = t; if (window.__FT.length > 20000) window.__FT.splice(0, 10000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  if (opts.init) await page.addInitScript(opts.init);
  return { ctx, page, I };
}
// the resident memory of this run's browser processes by type (MB), for the record (local runs)
const rssOf = (browser) => {
  try {
    const pid = browser.process && browser.process() ? browser.process().pid : null;
    if (!pid) return null;
    const rows = execSync('ps -eo pid,ppid,rss,args', { encoding: 'utf8' }).trim().split(String.fromCharCode(10)).slice(1)
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], mb: Math.round(+m[3] / 1024), args: m[4] }));
    const mine = new Set([pid]);
    for (let k = 0; k < 4; k++) for (const r of rows) if (mine.has(r.ppid)) mine.add(r.pid);
    const out = {};
    for (const r of rows) if (mine.has(r.pid)) { const t = (/--type=(\S+)/.exec(r.args) || [, 'browser'])[1]; out[t] = (out[t] || 0) + r.mb; }
    return out;
  } catch { return null; }
};
const frameStats = (ft) => { const a = ft.filter((x) => x > 0).sort((x, y) => x - y); if (!a.length) return null; return { frames: a.length, medianMs: +a[Math.floor(a.length / 2)].toFixed(1), worstMs: +a[a.length - 1].toFixed(1), fpsMedian: +(1000 / a[Math.floor(a.length / 2)]).toFixed(1) }; };
// the moment the first scene shows (ms since the epoch), or null
const waitShown = async (page, maxS) => {
  const t = Date.now();
  while ((Date.now() - t) / 1000 < maxS) {
    if (await page.evaluate(() => !!(window.__SC && window.__SC.shown)).catch(() => false)) return Date.now();
    await page.waitForTimeout(250);
  }
  return null;
};

// ---- 1, 2: the GPU visitor, then the modes by key presses
if (CHECKS.includes('gpu') || CHECKS.includes('modes')) {
  const browser = await chromium.launch({ args: GPU_ARGS });
  const { page, I } = await visitor(browser);
  const t0 = Date.now();
  await page.goto(base, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '01_loader.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
  const tShown = await waitShown(page, WAIT), shownS = tShown && (tShown - t0) / 1000;
  const mbFirst = +(I.bytes / 1048576).toFixed(1), errFirst = I.errors.length, failFirst = I.failed.length;
  R.memoryAtFirstSceneMB = rssOf(browser);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, '02_tour.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
  const ftTour = frameStats(await page.evaluate(() => window.__FT.slice(-300)));
  if (CHECKS.includes('gpu')) pass('1 gpu first scene', shownS !== null && !errFirst && !failFirst, { firstSceneS: shownS && +shownS.toFixed(1), mbToFirstScene: mbFirst, requests: I.reqs, abortedByPage: I.aborted, tourFrames: ftTour, errors: I.errors.slice(0, 5), failed: I.failed.slice(0, 5) });
  if (CHECKS.includes('modes') && shownS !== null) {
    const st = () => page.evaluate(() => window.__SPACE.state());
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(90); } };
    const opts = await page.evaluate(() => ({ places: window.__SPACE.places().map((p) => p.name) }));
    const MODES = ['tour', 'walk', 'drone', 'drive'], TIMES = ['day', 'golden', 'night'], QUAL = ['auto', 'low', 'medium', 'high'];
    // the menu's rows: Resume 0, Mode 1, Place 2, Time of day 3, Quality 4
    const setRow = async (row, list, cur, want) => {
      await key('ArrowDown', row);
      const ci = list.indexOf(cur), d = ci < 0 ? list.indexOf(want) + 1 : (list.indexOf(want) - ci + list.length) % list.length;   // (a value outside the list steps to the first)
      await key('ArrowRight', d); await key('ArrowUp', row);
    };
    const steps = [];
    const step = async (name, fn) => {
      await page.evaluate(() => { window.__FT.length = 0; });
      const t = Date.now();
      let res;
      try { res = await fn(); } catch (e) { res = { ok: false, error: String(e).slice(0, 200) }; }
      const ft = frameStats(await page.evaluate(() => window.__FT.slice()));
      await page.screenshot({ path: path.join(OUT, `${String(steps.length + 3).padStart(2, '0')}_${name}.png`), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
      steps.push({ step: name, secs: +((Date.now() - t) / 1000).toFixed(1), ...res, frames: ft });
      log('step', name, JSON.stringify(steps[steps.length - 1]).slice(0, 400));
    };
    const waitMode = async (mode, place, maxS = 120) => {
      const t = Date.now();
      while ((Date.now() - t) / 1000 < maxS) { const s = await st(); if (s.state === 'mplay' && s.mode === mode && (place === undefined || s.place === place)) return (Date.now() - t) / 1000; await page.waitForTimeout(250); }
      return null;
    };
    const finite = (a) => Array.isArray(a) && a.every((v) => Number.isFinite(v));
    // the frame times of a step are those of its active part (from here), not the load behind the black
    const resetFT = () => page.evaluate(() => { window.__FT.length = 0; });
    await step('menu', async () => { await key('Escape'); await page.waitForTimeout(800); const s = await st(); return { ok: s.menu === true }; });
    await step('drone', async () => {
      let s = await st();
      await setRow(1, MODES, s.mode, 'drone');
      await key('Escape');
      const ready = await waitMode('drone');
      await resetFT();
      await page.waitForTimeout(1200);
      const a = (await st()).drone;
      await page.keyboard.down('KeyW'); await page.keyboard.down('Space'); await page.waitForTimeout(3000); await page.keyboard.up('Space');
      await page.waitForTimeout(7000); await page.keyboard.up('KeyW');
      const b = (await st()).drone;
      const moved = a && b ? Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) : 0;
      return { ok: ready !== null && finite(a?.pos) && finite(b?.pos) && moved > 20, readyS: ready, from: a?.pos, to: b?.pos, movedM: +moved.toFixed(1) };
    });
    await step('walk', async () => {
      let s = await st();
      await key('Escape'); await page.waitForTimeout(500);
      await setRow(1, MODES, s.mode, 'walk');
      const lenox = opts.places.findIndex((n) => /Lenox/.test(n));
      await key('ArrowDown', 2); await key('ArrowRight', (lenox - s.place + opts.places.length) % opts.places.length); await key('ArrowUp', 2);
      await page.waitForTimeout(900);
      await key('Escape');
      const ready = await waitMode('walk', lenox);
      await resetFT();
      await page.waitForTimeout(1200);
      const a = (await st()).play;
      await page.keyboard.down('KeyW'); await page.waitForTimeout(5000); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(5000);
      await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
      await page.waitForTimeout(500);
      const b = (await st()).play;
      const moved = a && b ? Math.hypot(b.pose[0] - a.pose[0], b.pose[2] - a.pose[2]) : 0;
      const pr = b ? await page.evaluate((p) => window.__SPACE.probe(p[0], p[1], p[2]), b.pose) : null;
      const onGround = pr && pr.ground !== null && Math.abs(b.pose[1] - pr.ground) < 0.6;
      return { ok: ready !== null && finite(b?.pose) && moved > 5 && onGround && !pr.inside, readyS: ready, place: (await st()).placeName, from: a?.pose?.slice(0, 3), to: b?.pose?.slice(0, 3), movedM: +moved.toFixed(1), groundY: pr && pr.ground, insideBuilding: pr && pr.inside };
    });
    let driveShipped = (await st()).drive;
    if (driveShipped) await step('drive', async () => {
      let s = await st();
      await key('Escape'); await page.waitForTimeout(500);
      await setRow(1, MODES, s.mode, 'drive');
      const apollo = opts.places.findIndex((n) => /Apollo/.test(n));
      await key('ArrowDown', 2); await key('ArrowRight', (apollo - s.place + opts.places.length) % opts.places.length); await key('ArrowUp', 2);
      await page.waitForTimeout(900);
      await key('Escape');
      const ready = await waitMode('drive', apollo);
      await resetFT();
      await page.waitForTimeout(1500);
      const a = (await st()).play;
      await page.keyboard.down('KeyW'); await page.waitForTimeout(10000); await page.keyboard.up('KeyW');
      await page.keyboard.down('KeyS'); await page.waitForTimeout(1500); await page.keyboard.up('KeyS');
      const b = (await st()).play;
      const moved = a && b ? Math.hypot(b.pose[0] - a.pose[0], b.pose[2] - a.pose[2]) : 0;
      const road = b ? await page.evaluate((p) => { const si = window.__STREAMER.surfaceInfoAt(p[0], p[2], 0.3); return si ? !!si.road : null; }, b.pose) : null;
      return { ok: ready !== null && finite(b?.pose) && moved > 10 && b.mode === 'drive' && road !== false, readyS: ready, place: (await st()).placeName, movedM: +moved.toFixed(1), onRoad: road, hits: b?.hits };
    });
    await step('night_low', async () => {
      let s = await st();
      await key('Escape'); await page.waitForTimeout(500);
      await setRow(3, TIMES, s.time, 'night');
      await setRow(4, QUAL, s.quality, 'low');
      await page.waitForTimeout(600);
      await key('Escape');
      await page.waitForTimeout(1500);
      await resetFT();
      await page.waitForTimeout(6000);
      s = await st();
      return { ok: s.time === 'night' && s.quality === 'low' && s.pr <= 0.71, time: s.time, quality: s.quality, pixelRatio: s.pr };
    });
    await step('tour', async () => {
      let s = await st();
      await key('Escape'); await page.waitForTimeout(500);
      await setRow(1, MODES, s.mode, 'tour');
      await key('Escape');
      const t = Date.now();
      let ok = false;
      while ((Date.now() - t) / 1000 < 90) { s = await st(); if (s.mode === 'tour' && s.state === 'play') { ok = true; break; } await page.waitForTimeout(250); }
      await resetFT();
      await page.waitForTimeout(5000);
      return { ok, readyS: +((Date.now() - t) / 1000 - 5).toFixed(1), place: s.placeName };
    });
    const errs = I.errors.slice(errFirst), fails = I.failed.slice(failFirst);
    pass('2-3 modes by key presses', steps.every((x) => x.ok) && !errs.length && !fails.length, { driveShipped, steps, errors: errs.slice(0, 5), failed: fails.slice(0, 5) });
    R.sessionMB = +(I.bytes / 1048576).toFixed(1);
    R.memoryAfterModesMB = rssOf(browser);
  }
  await browser.close();
}

// ---- 4: no WebGL2: the trailer, nothing else
if (CHECKS.includes('nowebgl2')) {
  const browser = await chromium.launch({ args: GPU_ARGS });
  const { page, I } = await visitor(browser, { init: () => {
    const g = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) { return /webgl2/i.test(t) ? null : g.call(this, t, o); };
  } });
  await page.goto(base, { timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, '10_nowebgl2.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
  const v = await page.evaluate(() => ({ nolive: !!window.__VALDRADA_NOLIVE, video: !!document.querySelector('#vload video'), text: document.querySelector('#vload .s')?.textContent || '' }));
  const live = I.urls.filter((u) => /\/(assets|tiles|models|textures|data)\//.test(u));
  pass('4 no WebGL2', v.nolive && v.video && !live.length && !I.errors.length, { ...v, requests: I.urls.map((u) => u.replace(/^.*\//, '')).slice(0, 12), liveRequests: live.length, errors: I.errors.slice(0, 5) });
  await browser.close();
}

// ---- 5: a 25 Mbit/s, 40 ms link: the time to the first scene; the loader's line never stands still for long
if (CHECKS.includes('throttle')) {
  const browser = await chromium.launch({ args: GPU_ARGS });
  const { page, I } = await visitor(browser);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 25e6 / 8, uploadThroughput: 10e6 / 8 });
  const t0 = Date.now();
  await page.goto(base, { timeout: 180000 });
  let last = null, lastT = Date.now(), longest = 0, samples = 0, shownS = null;
  const tl = [];   // the loader's line every second (the record)
  while ((Date.now() - t0) / 1000 < Number(arg('throttlewait', '900'))) {
    const v = await page.evaluate(() => ({ line: document.querySelector('#vload .st')?.textContent || null, shown: !!(window.__SC && window.__SC.shown) })).catch(() => ({}));
    samples++;
    if (v.shown) { shownS = (Date.now() - t0) / 1000; break; }
    if (v.line !== last) { longest = Math.max(longest, (Date.now() - lastT) / 1000); last = v.line; lastT = Date.now(); }
    if (samples % 5 === 1) tl.push([Math.round((Date.now() - t0) / 1000), v.line]);
    if (samples === 30) await page.screenshot({ path: path.join(OUT, '11_throttled_loader.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
    await page.waitForTimeout(1000);
  }
  longest = Math.max(longest, shownS === null ? (Date.now() - lastT) / 1000 : 0);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '12_throttled_first_scene.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
  pass('5 throttled 25 Mbit/s 40 ms', shownS !== null && longest <= 15 && !I.errors.length, { firstSceneS: shownS && +shownS.toFixed(1), mbToFirstScene: +(I.bytes / 1048576).toFixed(1), longestStillS: +longest.toFixed(1), loaderLine: tl, errors: I.errors.slice(0, 5), failed: I.failed.slice(0, 5) });
  await browser.close();
}

// ---- 6: software GL: the trailer fallback or the first scene, never a black screen
if (CHECKS.includes('swiftshader')) {
  const browser = await chromium.launch({ args: ['--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
  const { page, I } = await visitor(browser);
  await page.goto(base, { timeout: 120000 });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(OUT, '13_swiftshader.png'), timeout: 60000 }).catch((e) => log('screenshot failed', String(e).slice(0, 80)));
  const v = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    let rn = '';
    try { const dx = gl && gl.getExtension('WEBGL_debug_renderer_info'); rn = gl ? String(gl.getParameter(dx ? dx.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no webgl2'; } catch { /* */ }
    return { renderer: rn, nolive: !!window.__VALDRADA_NOLIVE, video: !!document.querySelector('#vload video'), text: document.querySelector('#vload .s, #vload .st')?.textContent || '', shown: !!(window.__SC && window.__SC.shown) };
  });
  // never a black screen: the trailer view (poster, wordmark, text, video) or the city itself
  const live = I.urls.filter((u) => /\/(tiles|models)\//.test(u)).length;
  pass('6 software GL', (v.nolive && v.video && !live) || v.shown, { ...v, liveRequests: live, errors: I.errors.slice(0, 5) });
  await browser.close();
}

R.wallS = +((Date.now() - T0) / 1000).toFixed(0);
fs.writeFileSync(path.join(OUT, 'live_check.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(R.checks).map(([k, v]) => [k, v.pass ? 'PASS' : 'FAIL']))));
if (srv) srv.close();
if (typeof cdn !== 'undefined' && cdn) cdn.close();
process.exit(Object.values(R.checks).every((c) => c.pass) ? 0 : 1);
