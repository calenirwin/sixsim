// A headless API host for Linux servers (CONTROL, docs/notes/ar34-control.md): the Electron server (server/main.js) is
// Windows-packaged and needs a display; this host speaks the same TCP protocol (docs/api/protocol.md) and runs the page in
// Playwright's headless Chromium on a GPU, with window.boundlessHost provided through exposed bindings. The Python package
// connects to it exactly as to the Electron server.
//   GPU_LANE=ctl GPU_INDEX=1 node tools/api/pw_host.mjs [--port 2000] [--host 127.0.0.1] [--res 1280x720] [--time day]
//        [--start-lat 40.80955 --start-lon -73.95905] [--flags "extra=1"] [--verbose]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import tcp from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGpu } from '../gpulock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bdir = path.join(root, 'client');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const VERBOSE = args.includes('--verbose');
const PORT = Number(opt('port', '2000')), HOST = opt('host', '127.0.0.1');
const [W, H] = opt('res', '1280x720').split('x').map(Number);
const TIME = opt('time', 'day');
const START_LAT = Number(opt('start-lat', '40.80955')), START_LON = Number(opt('start-lon', '-73.95905'));
const VERSION = '0.1.0-pw';
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KIND_JSON = 1, KIND_BLOB = 2;
const frame = (kind, payload) => { const h = Buffer.alloc(5); h.writeUInt32BE(payload.length + 1, 0); h[4] = kind; return [h, payload]; };
function send(sock, obj, blobs = []) {
  if (!sock || sock.destroyed) return;
  const js = Buffer.from(JSON.stringify(blobs.length ? { ...obj, blobs: blobs.length } : obj), 'utf8');
  for (const b of frame(KIND_JSON, js)) sock.write(b);
  for (const blob of blobs) for (const b of frame(KIND_BLOB, blob)) sock.write(b);
}

const release = await acquireGpu('pw_host');
const vport = String(5400 + Math.floor(Math.random() * 300));
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', vport, '--strictPort', '--host', '127.0.0.1'],
  { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await sleep(5000);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W},${H}`] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => { const t = m.text(); if ((VERBOSE || /\[api\]|error/i.test(t)) && !/vite|WebSocket|favicon/.test(t)) log('[page]', t.slice(0, 240)); });
page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 300)));

let pageReady = false;
const queue = [], clients = new Map();
let clientSeq = 0;
const t0 = Date.now();
await page.exposeBinding('__hostRespond', (_src, msg) => { const sock = clients.get(msg.cid); if (!sock) return; const { cid, ...rest } = msg; send(sock, rest); });
await page.exposeBinding('__hostEmit', (_src, meta, blobs) => {
  const sock = clients.get(meta.cid); if (!sock) return;
  const { cid, ...rest } = meta;
  send(sock, rest, (blobs || []).map((b) => Buffer.from(b, 'base64')));
});
await page.exposeBinding('__hostReady', (_src, info) => {
  pageReady = true;
  log(`world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (api ${info?.api_version}); ${queue.length} queued request(s)`);
  while (queue.length) { const [cid, msg] = queue.shift(); if (clients.has(cid)) forward(cid, msg); }
});
await page.addInitScript(() => {
  const b64 = (v) => {
    const u = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let s = ''; const C = 0x8000;
    for (let i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C));
    return btoa(s);
  };
  window.boundlessHost = {
    onRequest: (cb) => { window.__hostReq = cb; },
    onDisconnect: (cb) => { window.__hostDisc = cb; },
    respond: (msg) => window.__hostRespond(msg),
    emit: (meta, blobs) => window.__hostEmit(meta, (blobs || []).map(b64)),
    ready: (info) => window.__hostReady(info),
  };
});
function forward(cid, msg) {
  page.evaluate((req) => window.__hostReq(req), { cid, id: msg.id, method: msg.method, params: msg.params || {} })
    .catch((e) => send(clients.get(cid), { id: msg.id, error: { code: 'server_closing', message: String(e.message || e).slice(0, 200) } }));
}
function handleMessage(cid, msg) {
  const sock = clients.get(cid);
  if (VERBOSE) log(`#${cid} ->`, msg.method);
  if (typeof msg.method !== 'string') return send(sock, { id: msg.id ?? null, error: { code: 'bad_request', message: 'missing method' } });
  if (msg.method === 'server.status') return send(sock, { id: msg.id, result: { ready: pageReady, server_version: VERSION, uptime: (Date.now() - t0) / 1000, clients: clients.size } });
  if (msg.method === 'server.ping') return send(sock, { id: msg.id, result: 'pong' });
  if (!pageReady) { queue.push([cid, msg]); return; }
  forward(cid, msg);
}
const srv = tcp.createServer((sock) => {
  const cid = ++clientSeq;
  clients.set(cid, sock);
  sock.setNoDelay(true);
  log(`client #${cid} connected`);
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 5) {
      const n = buf.readUInt32BE(0);
      if (n < 1 || n > 512 * 1024 * 1024) { sock.destroy(new Error('bad frame length')); return; }
      if (buf.length < 4 + n) break;
      const kind = buf[4], payload = buf.subarray(5, 4 + n);
      buf = buf.subarray(4 + n);
      if (kind !== KIND_JSON) continue;
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch { send(sock, { id: null, error: { code: 'bad_json', message: 'request is not JSON' } }); continue; }
      handleMessage(cid, msg);
    }
  });
  const bye = () => { if (!clients.has(cid)) return; clients.delete(cid); log(`client #${cid} disconnected`); page.evaluate((c) => window.__hostDisc?.(c), cid).catch(() => {}); };
  sock.on('close', bye); sock.on('error', bye);
});
srv.listen(PORT, HOST, () => log(`listening on ${HOST}:${PORT}`));

const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const sx = (START_LON - LON0) * M_LON, sz = -(START_LAT - LAT0) * M_LAT;
const q = new URLSearchParams({ api: '1', hud: '0', clean: '1', life: '0', x: sx.toFixed(1), z: sz.toFixed(1), y: '60', time: TIME, pedtarget: '520', lmwait: '150' });
const extra = opt('flags', '');
const url = `http://127.0.0.1:${vport}/?${q.toString()}${extra ? '&' + extra : ''}`;
log('page', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
const bye = async () => { srv.close(); await browser.close().catch(() => {}); vite.kill(); release(); process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
