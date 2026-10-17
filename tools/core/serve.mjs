// The Python API on the headless core: docs/api/protocol.md on a TCP port, answered by the page's own API module
// (client/src/api/bridge.js) running against the core's simulation (core/api/session.mjs), with no page, no window and
// no GPU. The options are server/main.js's; the page query it would open is the one the core's modules read. Sensor
// data answers needs_renderer (docs/specs/render-protocol.md).
//
//   node tools/core/serve.mjs [--port 2000] [--host 127.0.0.1] [--start-lat 40.80955 --start-lon -73.95905]
//        [--time day|golden|dusk|night] [--res 1280x720] [--quality high|medium] [--pedestrians photoreal|procedural]
//        [--seed 1] [--idle-fps 0] [--verbose] [--log <file>]
//
// --seed: the simulation's random stream (the same requests give the same world). --idle-fps N: frames of dt 0
// between ticks, as the page's loop keeps streaming round the spectator (default 0: the world moves only when a request
// steps it: world.tick, world.wait_until_loaded, the asynchronous mode).
import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const eq = argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return def;
};
const flag = (name) => argv.includes('--' + name);
const PORT = Number(opt('port', '2000')), HOST = opt('host', '127.0.0.1');
const [RES_W, RES_H] = String(opt('res', '1280x720')).split('x').map(Number);
const START_LAT = Number(opt('start-lat', '40.80955')), START_LON = Number(opt('start-lon', '-73.95905'));   // W 120th St & Amsterdam Ave
const TIME = opt('time', 'day'), QUALITY = opt('quality', 'high'), PEDESTRIANS = opt('pedestrians', 'photoreal');
const SEED = parseInt(opt('seed', '1'), 10), IDLE_FPS = Number(opt('idle-fps', '0')), VERBOSE = flag('verbose'), LOG_FILE = opt('log');
const log = (...a) => {
  const line = '[core-api] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n'); } catch { /* */ } }
};

// the start position and the page query exactly as server/main.js builds them
const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const sx = (START_LON - LON0) * M_LON, sz = -(START_LAT - LAT0) * M_LAT;
const q = new URLSearchParams({ api: '1', hud: '0', clean: '1', life: '0', x: sx.toFixed(1), z: sz.toFixed(1), y: '60', time: TIME, pedtarget: '520', lmwait: '150' });
if (QUALITY === 'medium') q.set('crowdlod', '15,45');
if (PEDESTRIANS === 'procedural') q.set('crowd', '0');
globalThis.location = { search: '?' + q.toString() };
globalThis.innerWidth = RES_W; globalThis.innerHeight = RES_H;

const { startServer } = await import('../../core/api/server.mjs');
const server = startServer({ port: PORT, host: HOST, log, verbose: VERBOSE });
try { await server.listening; } catch (e) { log(`ERROR cannot listen on ${HOST}:${PORT}: ${e.message}`); process.exit(2); }
const { createApiSession } = await import('../../core/api/session.mjs');
const t0 = performance.now();
const S = await createApiSession({ server, seed: SEED, time: TIME, start: { x: +sx.toFixed(1), y: 60, z: +sz.toFixed(1) }, res: [RES_W, RES_H], procedural: PEDESTRIANS === 'procedural', idleFps: IDLE_FPS, log });
log(`world ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const bye = () => { log('stopping'); S.close(); server.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
