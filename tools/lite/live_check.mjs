// LITE15: load the published Space like a visitor and report the time to the first scene, the bytes downloaded and errors.
//   GPU_LANE=34 node tools/withgpu.mjs lite-live -- node tools/lite/live_check.mjs [url] [--out shot.jpg] [--wait 150]
import { chromium } from 'playwright';

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'https://mehmetkeremturkcan-valdrada.static.hf.space/index.html';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('out', 'live_check.jpg'), waitS = Number(arg('wait', '150'));
const browser = await chromium.launch({ args: ['--ozone-platform=headless', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let bytes = 0, reqs = 0, firstBytes = null;
const errors = [];
page.on('response', async (r) => { try { const b = await r.body(); bytes += b.length; reqs++; } catch {} });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('requestfailed', (r) => errors.push('FAILED ' + r.url().slice(-80)));
const t0 = Date.now();
await page.goto(url, { timeout: 120000 });
let first = null;
while ((Date.now() - t0) / 1000 < waitS) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({ shown: !!(window.__SC && window.__SC.shown), pct: document.querySelector('#vload .st')?.textContent })).catch(() => ({}));
  if (st.shown && first === null) { first = (Date.now() - t0) / 1000; firstBytes = bytes; await page.waitForTimeout(6000); break; }
}
await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
console.log(JSON.stringify({ url, firstSceneS: first, mbAtFirstScene: firstBytes && +(firstBytes / 1048576).toFixed(1), mbTotal: +(bytes / 1048576).toFixed(1), requests: reqs, errors: errors.slice(0, 8) }));
await browser.close();
