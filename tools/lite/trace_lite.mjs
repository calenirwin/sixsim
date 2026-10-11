// LITE15: play every showcase scene once in a GPU browser and list what the page requests.
//   GPU_LANE=34 node tools/withgpu.mjs lite-trace -- node tools/lite/trace_lite.mjs --out <built dir> [--fallback] [--secs 8]
// --fallback serves files missing from <out> from client/public (the build's trace pass); without it, a missing file is a
// 404 and is reported (the final check). Writes <out>/../trace.txt (requested paths), screenshots and a JSON report.
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
const shots = path.join(DIR, 'trace_shots'); fs.mkdirSync(shots, { recursive: true });
const report = { scenes: [], firstFrameS: null };
let lastName = null, shotAt = 0, played = 0;
const deadline = t0 + (scenes.length * (SECS + 25) + 90) * 1000;
while (Date.now() < deadline && played <= scenes.length) {
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
const perf = await page.evaluate(() => new Promise((res) => { if (!window.__PERF) return res(null); window.__PERF().then(res).catch(() => res(null)); })).catch(() => null);
report.perf = perf; report.boot = await page.evaluate(() => window.__BOOT || null).catch(() => null); report.errors = errors.slice(0, 40); report.missing = [...missing].slice(0, 200);
report.bytesOut = bytesOut; report.bytesPub = bytesPub; report.files = seen.size; report.wallS = (Date.now() - t0) / 1000;
fs.writeFileSync(path.join(DIR, 'trace.txt'), [...seen.keys()].sort().join('\n') + '\n');
fs.writeFileSync(path.join(DIR, 'trace_report.json'), JSON.stringify(report, null, 1));
console.log(`[trace] scenes played ${played}/${scenes.length}; first frame ${report.firstFrameS}s; files ${seen.size}; from out ${(bytesOut / 1048576).toFixed(1)} MB, from public ${(bytesPub / 1048576).toFixed(1)} MB; missing ${missing.size}; errors ${errors.length}`);
await browser.close(); srv.close();
