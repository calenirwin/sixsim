// LITE15: play every showcase scene once in a GPU browser and list what the page requests.
//   GPU_LANE=34 node tools/withgpu.mjs lite-trace -- node tools/lite/trace_lite.mjs --out <built dir> [--fallback] [--secs 8] [--modes]
// --fallback serves files missing from <out> from client/public (the build's trace pass); without it, a missing file is a
// 404 and is reported (the final check). Writes <out>/../trace.txt (requested paths), screenshots and a JSON report.
// --modes (SPACE r2): then every place of the menu in each mode, so the trace holds what Walk, Drone and Drive can reach:
// the drone over a ring of points across the place's disc at two heights, the walker at its spawn, the car at a few
// places, and the place's first stop in the morning and at night.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PUB = path.join(REPO, 'client/public');
const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out'));
const DIR = path.dirname(OUT);
const FALLBACK = process.argv.includes('--fallback');
const SECS = Number(arg('secs', '8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.css': 'text/css' };
const seen = new Map(), missing = new Set();
let bytesOut = 0, bytesPub = 0;
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  let f = path.join(OUT, rel), fromPub = false;
  if (!fs.existsSync(f) && FALLBACK) { f = path.join(PUB, rel); fromPub = true; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { missing.add(rel); res.writeHead(404); res.end(); return; }
  const n = fs.statSync(f).size;
  if (!seen.has(rel)) { seen.set(rel, n); if (fromPub) bytesPub += n; else bytesOut += n; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': n });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const scenes = JSON.parse(fs.readFileSync(path.join(OUT, 'showcase.json'), 'utf8')).scenes;
const browser = await chromium.launch({ args: ['--ozone-platform=headless', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/index.html?scseq=1&scsecs=${SECS}`, { timeout: 120000 });
// SPACE r2: the frames without the interface (the first one becomes the loading screen's backdrop)
await page.addStyleTag({ content: '#sc-ui{visibility:hidden!important}' }).catch(() => {});
const shots = path.join(DIR, 'trace_shots'); fs.mkdirSync(shots, { recursive: true });
const report = { scenes: [], firstFrameS: null };
let lastName = null, shotAt = 0, played = 0;
const deadline = t0 + (scenes.length * (SECS + 25) + 90) * 1000;
// --modesonly: the scenes are not played (their assets are already in the build); the first one only boots the page
const MODESONLY = process.argv.includes('--modesonly');
while (!MODESONLY && Date.now() < deadline && played <= scenes.length) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    fade: document.getElementById('sc-fade')?.style.opacity, place: document.querySelector('#sc-card .t')?.textContent,
    fps: window.__PERF ? null : null,
  })).catch(() => ({}));
  if (st.fade === '0' && report.firstFrameS === null) report.firstFrameS = (Date.now() - t0) / 1000;
  if (st.fade === '0' && st.place && st.place !== lastName) { lastName = st.place; played++; shotAt = Date.now() + SECS * 450; report.scenes.push({ title: st.place, at: (Date.now() - t0) / 1000 }); }
  if (shotAt && Date.now() > shotAt) {
    shotAt = 0;
    await page.screenshot({ path: path.join(shots, `${String(played).padStart(2, '0')}.jpg`), quality: 80, type: 'jpeg' }).catch(() => {});
  }
}
// SPACE r2: the modes at every place
if (process.argv.includes('--modes')) {
  const sleep = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => window.__SPACE.state()).catch(() => ({}));
  const settle = async (maxMs) => { const t = Date.now(); while (Date.now() - t < maxMs) { const ok = await page.evaluate(() => window.__STREAMER && window.__STREAMER.outstanding === 0 && window.__STREAMER.fetching === 0).catch(() => false); if (ok) return true; await sleep(500); } return false; };
  const play = async (mode, i) => {
    await page.evaluate(([m, i]) => window.__SPACE.mode(m, i), [mode, i]);
    const t = Date.now();
    while (Date.now() - t < 120000) { const st = await state(); if (st.state === 'mplay' && st.mode === mode && st.place === i) return (Date.now() - t) / 1000; if (st.mode !== mode && st.state === 'mplay') return null; await sleep(500); }
    return null;
  };
  const boot = async () => {
    for (let k = 0; k < 600; k++) { if (await page.evaluate(() => !!(window.__SC && window.__SC.shown && window.__SPACE)).catch(() => false)) return true; await sleep(500); }
    return false;
  };
  await boot();
  // the first scene's frame for the loading screen's backdrop, when the scenes were not played
  if (MODESONLY) { await sleep(5500); await page.screenshot({ path: path.join(shots, '01.jpg'), quality: 80, type: 'jpeg' }).catch(() => {}); }
  const places = await page.evaluate(() => window.__SPACE.places());
  report.modes = [];
  // a fresh page for each group of neighbouring places: one long session through every area of the city grows the
  // page's memory past what a visitor's session reaches (docs/notes/space-r2.md), and slows the sweep to a crawl
  const FRESH = new Set([3, 4, 6, 7, 8]);
  for (let i = 0; i < places.length; i++) {
    const P = places[i], rec = { place: P.name };
    if (FRESH.has(i)) {
      await page.goto(`http://127.0.0.1:${port}/index.html`, { timeout: 120000 });
      await page.addStyleTag({ content: '#sc-ui{visibility:hidden!important}' }).catch(() => {});
      rec.boot = await boot();
    }
    rec.drone = await play('drone', i);
    if (rec.drone !== null) {
      // a ring of eight points across the disc at street height (where models and textures are nearest), then three at 45 m
      // and the centre; every point stays until its tiles are in (the near radius covers the disc from the ring)
      const ring = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring.push([P.x + Math.cos(a) * P.r * 0.8, P.z + Math.sin(a) * P.r * 0.8, 6]); }
      const high = [0, 3, 6].map((k) => { const a = (k / 8) * Math.PI * 2; return [P.x + Math.cos(a) * P.r * 0.6, P.z + Math.sin(a) * P.r * 0.6, 45]; });
      for (const [x, z, alt] of [...ring, ...high, [P.x, P.z, 45]]) {
        await page.evaluate(([x, z, alt]) => { const D = window.__SPACE.drone; const g = D.floorAt(x, z, null); D.spawn(x, (g ?? 10) + alt, z, D.camYaw, -0.25); }, [x, z, alt]);
        await sleep(700); await settle(9000);
      }
      await page.screenshot({ path: path.join(shots, `m${String(i).padStart(2, '0')}_drone.jpg`), quality: 80, type: 'jpeg' }).catch(() => {});
    }
    rec.walk = await play('walk', i);
    if (rec.walk !== null) { await sleep(3000); await settle(10000); await page.screenshot({ path: path.join(shots, `m${String(i).padStart(2, '0')}_walk.jpg`), quality: 80, type: 'jpeg' }).catch(() => {}); }
    if (i % 3 === 0 || P.name.includes('Lenox')) {
      rec.drive = await play('drive', i);
      if (rec.drive !== null) { await sleep(3000); await page.screenshot({ path: path.join(shots, `m${String(i).padStart(2, '0')}_drive.jpg`), quality: 80, type: 'jpeg' }).catch(() => {}); }
    }
    if (i === 0) for (const t of ['day', 'night', 'golden']) { await page.evaluate((t) => window.__SPACE.time(t), t); await sleep(4000); await settle(8000); }
    report.modes.push(rec);
    console.log('[trace] modes', JSON.stringify(rec));
    fs.writeFileSync(path.join(DIR, 'trace.txt'), [...seen.keys()].sort().join('\n') + '\n');   // so far (a stopped run keeps its list)
  }
}
const perf = await page.evaluate(() => new Promise((res) => { if (!window.__PERF) return res(null); window.__PERF().then(res).catch(() => res(null)); })).catch(() => null);
report.perf = perf; report.boot = await page.evaluate(() => window.__BOOT || null).catch(() => null); report.errors = errors.slice(0, 40); report.missing = [...missing].slice(0, 200);
report.bytesOut = bytesOut; report.bytesPub = bytesPub; report.files = seen.size; report.wallS = (Date.now() - t0) / 1000;
fs.writeFileSync(path.join(DIR, 'trace.txt'), [...seen.keys()].sort().join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'trace_report.json'), JSON.stringify(report, null, 1));
console.log(`[trace] scenes played ${played}/${scenes.length}; first frame ${report.firstFrameS}s; files ${seen.size}; from out ${(bytesOut / 1048576).toFixed(1)} MB, from public ${(bytesPub / 1048576).toFixed(1)} MB; missing ${missing.size}; errors ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 12).join('\n'));
if (missing.size) console.log('[trace] missing:', [...missing].slice(0, 30).join(' '));
await browser.close(); srv.close();
