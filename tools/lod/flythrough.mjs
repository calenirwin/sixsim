#!/usr/bin/env node
// A short recorded fly-through for the LOD pop check (tools/ad/temporal_scan.py): the page in record mode (fixed steps),
// a camera path south over Central Park toward Midtown at 250-320 m, which crosses the L6 -> L5 -> L4 refinements of
// the chunks ahead; the near tiles are held as loaded (streamer hold 'freeze') so what changes on screen is this tier.
//   GPU_LANE=36 node tools/lod/flythrough.mjs [--out client/shots/arch_r1b/clips] [--take fly_lod16] [--flags "..."]
//        [--frames 150] [--time day] [--nolod]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGpu } from '../gpulock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bdir = path.join(root, 'client');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const OUT = path.resolve(root, opt('out', 'client/shots/arch_r1b/clips'));
const TAKE = opt('take', 'fly_lod16');
const FRAMES = Number(opt('frames', '240'));
const TIME = opt('time', 'day');
const LOD = opt('nolod') !== '1';
const FLAGS = opt('flags', 'hud=0&lmwait=150&life=0&clean=1&pr=1&gi=0&probe=0&nocascade2=1') + (LOD ? '&lod16=1' : '');
const W = 1920, H = 1080;
// 'park': 800 m south over the park (no level changes, the steady case); 'midtown' (default): 5 km from the north end of
// the park to Midtown, which crosses the L6 -> L5 -> L4 refinements of the chunks ahead
const LL = (x, z, y) => [-73.9712 + x / 84311.4, 40.7831 - z / 111132, y];
const MID = [[100, -1500], [-233, 167], [-567, 1833], [-900, 3500]];
const PATHS = {
  midtown: { duration: FRAMES / 30, ease: 0.1, abs: false, fov: 60, keys: MID.map(([x, z]) => ({ p: LL(x, z, 250), look: LL(x - 294, z + 1470, 60) })) },
  // 3 km from the north end of the park toward Midtown at 500 m (375 m/s over 8 s)
  aerial: { duration: FRAMES / 30, ease: 0.1, abs: false, fov: 60, keys: [[100, -1500], [-96, -520], [-292, 460], [-488, 1440]].map(([x, z]) => ({ p: LL(x, z, 500), look: LL(x - 588, z + 2940, 80) })) },
  // the camera holds over the park looking south while the tier's threshold is forced (frame 20: 0.75 px, frame 120: back to 3),
  // so every refinement and its return fade in place, with no camera motion in the comparison
  still: { duration: 1e6, ease: 0, abs: false, fov: 60, keys: [{ p: LL(0, 0, 700), look: LL(0, 3000, 400) }, { p: LL(0.01, 0.01, 700), look: LL(0, 3000, 400) }] },
  park: { duration: FRAMES / 30, ease: 0.1, abs: false, fov: 60, keys: [
    { p: [-73.9700, 40.7800, 320], look: [-73.9790, 40.7600, 140] },
    { p: [-73.9714, 40.7768, 300], look: [-73.9804, 40.7568, 130] },
    { p: [-73.9728, 40.7736, 280], look: [-73.9818, 40.7536, 120] },
    { p: [-73.9742, 40.7704, 260], look: [-73.9832, 40.7504, 110] },
  ] },
};
const PATH = PATHS[opt('path', 'midtown')];
const release = await acquireGpu('lodB fly ' + TAKE);
const port = String(5400 + Math.floor(Math.random() * 3000));
const server = spawn(process.execPath, [path.join(bdir, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--js-flags=--max-old-space-size=16384'] });
const dir = path.join(OUT, TAKE);
fs.mkdirSync(dir, { recursive: true });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  const LAT0 = 40.7831, LON0 = -73.9712, MLAT = 111132.0, MLON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
  const sx = (PATH.keys[0].p[0] - LON0) * MLON, sz = -(PATH.keys[0].p[1] - LAT0) * MLAT;
  const url = `http://127.0.0.1:${port}/?shot=1&record=1&${FLAGS}&x=${sx.toFixed(1)}&z=${sz.toFixed(1)}&y=${PATH.keys[0].p[2]}&time=${TIME}`;
  console.log(url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('typeof window.__SET_PATH === "function" && typeof window.__advance === "function"', undefined, { timeout: 300000 });
  await page.waitForFunction('window.__READY === true', undefined, { timeout: 240000 }).catch(() => console.log('READY timeout'));
  await page.evaluate((p) => window.__SET_PATH(p), PATH);
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__advance(0));
  // settle: near tiles and this tier in, then hold the near tiles
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const ok = await page.evaluate(() => { const s = window.__STREAMER; return !!(s && s.idle && s.idle()); });
    if (ok) break;
    await page.evaluate(() => window.__advance(0));
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.evaluate(() => { if (window.__STREAMER) window.__STREAMER.hold = 'freeze'; });
  await page.evaluate((p) => window.__SET_PATH(p), PATH);
  const stats = [];
  for (let i = 0; i < FRAMES; i++) {
    if (opt('path') === 'still' && (i === 20 || i === 120)) await page.evaluate((v) => { const L = window.__LOD16; if (L) L.sse = v; }, i === 20 ? 0.75 : 3);
    await page.evaluate((dt) => window.__advance(dt), i ? 1 / 30 : 0);
    const s = await page.evaluate(() => { const L = window.__LOD16; return L ? { ...L.stats, resident: { ...L.stats.resident }, drawn: { ...L.stats.drawn } } : null; });
    stats.push(s);
    await page.screenshot({ path: path.join(dir, `frame_${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  fs.writeFileSync(path.join(dir, '_lod16.json'), JSON.stringify(stats));
  console.log(`${FRAMES} frames in ${dir}`);
} catch (e) { console.error(e); code = 1; }
await browser.close();
server.kill();
release();
process.exit(code);
