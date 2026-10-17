// The traffic signals' heads and lenses around a shot, and its street lamps' heads, as data, written by today's page
// (assembleTile places them; the cell packages leave the signal heads out because they change state at run time, and their
// sidecars carry the lamp poles without the fixture): every live instance of the head and lens pools
// (signalHead, signalLens, sigR, sigA, sigG, pedHand, pedMan) with its instancer slot, and the signal registry that ties
// each lens slot to the axis its head serves (sim/signals.js SignalController). tools/core/tracks_to_mov.py --signals
// writes them into the take's static layer and switches the lenses frame by frame from the core's signal states.
//
//   node tools/core/signals_dump.mjs --shot t8LenoxDive [--out shots/core/signals/<shot>.json]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotName = opt('shot', 't8LenoxDive');
const out = path.resolve(opt('out', path.join(ROOT, 'shots/core/signals', `${shotName}.json`)));
fs.mkdirSync(path.dirname(out), { recursive: true });
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const P = { name: shotName, ...(SH.shots[shotName] || SH.probes[shotName]) };
if (P.take) { const { expandTake } = await import('../ad/takes.mjs'); expandTake(P, ROOT); }
// GB43: an aerial (every key over 120 m up) needs no signal heads (they are not seen from there), and the page boot over
// a river or the backdrop could wait out the readiness timeout (40 min, then no file): no page, no file
if (P.keys.every((k) => (k.p[2] ?? 0) > 120)) { console.log(`[signals] ${shotName}: aerial (keys over 120 m), no signal heads`); process.exit(0); }
const BASE_FLAGS = SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1';
const { project } = await import('../../client/src/shared/geo.js');
const [sx, sz] = project(P.keys[0].p[0], P.keys[0].p[1]);
const holdAt = (Q, K) => ({ duration: 1e6, ease: 0, abs: Q.abs, tension: Q.tension, fov: Q.fov, keys: [K, { p: [K.p[0] + 1e-6, K.p[1] + 1e-6, K.p[2]], look: K.look }] });
const midKey = (a, b) => ({ p: a.p.map((v, i) => (v + b.p[i]) / 2), look: (a.look || a.p).map((v, i) => (v + (b.look || b.p)[i]) / 2) });
const query = `?shot=1&record=1&${BASE_FLAGS}&time=${P.time}${P.flags ? '&' + P.flags : ''}&x=${sx.toFixed(1)}&z=${sz.toFixed(1)}&y=${(P.keys[0].p[2] + 40).toFixed(1)}&pc26=0`;
const port = String(5400 + Math.floor(Math.random() * 3000));
const bdir = path.join(ROOT, 'client');
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await sleep(4000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--window-size=640,360'] });
const cleanup = async () => { try { await browser.close(); } catch {} try { vite.kill('SIGTERM'); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.addInitScript(() => { setInterval(() => { const E = window.__ENGINE; if (E && !E.holdDraw) E.holdDraw = true; }, 20); });
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  // (GB43: 8 min, not 40: a page not up by then is not coming up; the take goes on without signal heads)
  try { await page.waitForFunction('typeof window.__SET_PATH === "function" && !!window.__STREAMER && !!window.__STREAMER.ctx', null, { timeout: 480000, polling: 3000 }); }
  catch (e) { console.log(`[signals] ${shotName}: FAILED, the page was not ready in 8 min; no signal heads`); await cleanup(); process.exit(0); }
  const settle = async () => { for (;;) { const ok = await page.evaluate(() => { const S = window.__STREAMER; return S.outstanding === 0 && S.queue.length === 0 && S.fetching === 0; }); if (ok) return; await sleep(1000); } };
  await page.evaluate(() => window.__DRESS_HOLD?.('grow'));
  const pts = [P.keys[0]];
  for (let k = 1; k < P.keys.length; k++) pts.push(midKey(P.keys[k - 1], P.keys[k]), P.keys[k]);
  for (const K of pts) { await page.evaluate((p) => window.__SET_PATH(p), holdAt(P, K)); await page.evaluate(() => window.__advance(0)); await settle(); }
  const D = await page.evaluate(() => {
    const ctx = window.__STREAMER.ctx, I = ctx.instancer, out = { pools: {}, reg: [] };
    for (const name of ['signalHead', 'signalLens', 'sigR', 'sigA', 'sigG', 'pedHand', 'pedMan']) {
      const p = I.pools.get(name);
      if (!p || !p.mats || !p.alive) continue;
      const list = [];
      for (let s = 0; s < p.top; s++) {
        if (!p.alive[s]) continue;
        list.push({ slot: s, m: Array.from(p.mats.subarray(s * 16, s * 16 + 16), (v) => Math.round(v * 1e5) / 1e5), c: p.cols ? Array.from(p.cols.subarray(s * 3, s * 3 + 3)) : null });
      }
      out.pools[name] = list;
    }
    for (const e of ctx.signalReg || []) out.reg.push({ veh: !!e.veh, servesEW: e.servesEW ?? null, rot: e.rot ?? null, heads: !!e.heads, ids: e.ids, x: e.x ?? e.heads?.[0]?.x, z: e.z ?? e.heads?.[0]?.z });
    // the street lamps' heads as the page records them (city/props.js, city/cpFlora.js: [x, y, z, fixture, mount, arm yaw]);
    // the fixture is a hash of the pole's exact position (world/night11.js lampKind), which a rounded position cannot give
    out.lampSpots = (window.__LIFE?.lampSpots || []).map((q) => q.slice());
    return out;
  });
  fs.writeFileSync(out, JSON.stringify({ shot: shotName, ...D }));
  console.log(`[signals] ${shotName}: ${Object.entries(D.pools).map(([k, v]) => `${k} ${v.length}`).join(', ')}; ${D.reg.length} registry entries, ${D.lampSpots.length} lamp heads in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(ROOT, out)}`);
} catch (e) {
  console.log('FAILED', e.stack || e);
} finally {
  await cleanup();
}
