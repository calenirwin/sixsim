#!/usr/bin/env node
// valdrada: the one command over the build graph (docs/notes/tile-system.md section 10; docs/specs/build-graph.md).
// A thin orchestrator: every step calls a lane's own tool, unchanged; around it, the step's inputs are hashed (files by
// content, folders as trees of file hashes, values as JSON) and compared with the cache manifest
// (/data0/projectnyc_aux/cache/graph.json): a step whose input hash is recorded and whose recorded outputs are intact is
// skipped; otherwise it runs and its outputs are hashed and recorded. Steps feed each other by OUTPUT hashes, so a change
// that leaves an output identical stops there (a cell change re-runs the load sets, but only the shots whose load set
// changed render again).
//
//   node tools/valdrada.mjs lod                                   tools/lod/build_persistent.mjs, export_packages.mjs (+ --plain)
//                                                                 (BD40: and the backdrop between them, tools/lod/backdrop.sh)
//   node tools/valdrada.mjs cells --shot <s> | --bbox x0,z0,x1,z1 | --cells a,b   lane A's bake.mjs + export_plain.mjs
//   node tools/valdrada.mjs take <shot> [--seed 1]               lane D's tools/core/actor_layers.sh, then tools/core/loadsets.mjs
//   node tools/valdrada.mjs render <shot> --renderer three|ue|blender [--frames a-b] [--time t] [--nolod16]
//   node tools/valdrada.mjs gate <shot> [--renderer three|ue] [--frames a-b]     tools/ad/temporal_scan.py on a render
//   node tools/valdrada.mjs trailer <seq.json> [--renderer three|ue] [--frames a-b] [--name n]   take, render, gate per shot, cut
//   node tools/valdrada.mjs status [--steps]                      the manifest
// Options for every command: --force (run even when the inputs are unchanged), --dry (report run/skip, run nothing).
// GPU steps hold this machine's GPU lock (tools/gpulock.mjs) on GPU_LANE (default 36).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '/data0/projectnyc_aux/cache', CELLCACHE = '/data0/projectnyc_aux/cellcache';
const GRAPH = path.join(CACHE, 'graph.json'), HASHCACHE = path.join(CACHE, 'graph.hashcache.json');
const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a, i, A) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--') && !['--force', '--dry', '--steps', '--nolod16'].includes(A[i - 1])));
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);
const FORCE = has('force'), DRY = has('dry');
const LANE = process.env.GPU_LANE || '36';
const t0 = Date.now();
const log = (...a) => console.log(`[valdrada ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------- hashing (content, with a size+mtime cache)
const hc = fs.existsSync(HASHCACHE) ? readJSON(HASHCACHE) : {};
let hcDirty = false;
function fileHash(f) {
  const st = fs.statSync(f);
  const c = hc[f];
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.sha;
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(f, 'r'), buf = Buffer.allocUnsafe(1 << 22);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  const s = h.digest('hex');
  hc[f] = { size: st.size, mtime: st.mtimeMs, sha: s }; hcDirty = true;
  return s;
}
function walkFiles(dir, filter = () => true, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || /_prev_|\.old-|\.tmp$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, filter, out); else if (e.isFile() && filter(p)) out.push(p);
  }
  return out;
}
// a folder as a tree hash over (relative path, file hash); { sha, files, bytes }
function dirHash(dir, filter) {
  const files = walkFiles(dir, filter);
  const h = crypto.createHash('sha256');
  let bytes = 0;
  for (const f of files) { h.update(path.relative(dir, f) + '\0' + fileHash(f) + '\n'); bytes += fs.statSync(f).size; }
  return { sha: h.digest('hex'), files: files.length, bytes };
}
// an input: { file } | { dir, ext? } | { files: [...] } | { value } | { step: <key> } (that step's output hash)
function inputHash(spec) {
  if (spec.value !== undefined) return sha(JSON.stringify(spec.value));
  if (spec.file) return fs.existsSync(spec.file) ? fileHash(spec.file) : 'missing';
  if (spec.dir) return fs.existsSync(spec.dir) ? dirHash(spec.dir, spec.ext ? (p) => spec.ext.test(p) : undefined).sha : 'missing';
  if (spec.files) { const h = crypto.createHash('sha256'); for (const f of spec.files) h.update(path.relative(ROOT, f) + '\0' + (fs.existsSync(f) ? fileHash(f) : 'missing') + '\n'); return h.digest('hex'); }
  if (spec.step) { const s = graph.steps[spec.step]; return s ? s.outputHash : 'missing'; }
  throw new Error('bad input ' + JSON.stringify(spec));
}
function outputRecord(p) {
  if (!fs.existsSync(p)) return { path: p, missing: true };
  if (fs.statSync(p).isDirectory()) return { path: p, kind: 'dir', ...dirHash(p) };
  return { path: p, kind: 'file', sha: fileHash(p), bytes: fs.statSync(p).size };
}

// ---------------------------------------------------------------- the manifest and a step
const graph = fs.existsSync(GRAPH) ? readJSON(GRAPH) : { schema: 'valdrada.graph/0', steps: {} };
const changed = new Set();   // the steps this process recorded: merged into the manifest as it is on disk when saving
function save() {
  if (changed.size && !DRY) {
    const disk = fs.existsSync(GRAPH) ? readJSON(GRAPH) : { schema: 'valdrada.graph/0', steps: {} };
    for (const k of changed) disk.steps[k] = graph.steps[k];
    const tmp = `${GRAPH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(disk, null, 1)); fs.renameSync(tmp, GRAPH);
  }
  if (hcDirty) { const t2 = `${HASHCACHE}.${process.pid}.tmp`; fs.writeFileSync(t2, JSON.stringify(hc)); fs.renameSync(t2, HASHCACHE); hcDirty = false; }
}
const summary = [];
// key: a stable step name; inputs: { name: spec }; outputs: [paths]; run(): returns { code, ...extra }; ok(code): success
// published: paths the step also writes for other lanes in shared places (verified to exist, not by hash: another agent may
// publish there too); outputs: what the graph owns and verifies by hash (a step's snapshot when the tool's own output
// location is shared)
async function step(key, { inputs, outputs, published = [], run, after = null, ok = (c) => c === 0, note = '' }) {
  const ins = {};
  for (const [k, v] of Object.entries(inputs)) ins[k] = inputHash(v);
  const inHash = sha(JSON.stringify(Object.keys(ins).sort().map((k) => [k, ins[k]])));
  const prev = graph.steps[key];
  let intact = false;
  if (prev && prev.inputHash === inHash && prev.ok) {
    intact = true;
    for (const o of prev.outputs || []) { const r = outputRecord(o.path); if (r.missing || r.sha !== o.sha) { intact = false; break; } }
    for (const p of prev.published || []) if (!fs.existsSync(p)) intact = false;
  }
  if (intact && !FORCE) { log(`skip  ${key} (inputs ${inHash.slice(0, 12)} unchanged, outputs intact)`); summary.push([key, 'skip', 0]); return prev; }
  const why = !prev ? 'never built' : prev.inputHash !== inHash ? `inputs changed: ${Object.keys(ins).filter((k) => !prev.inputs || prev.inputs[k] !== ins[k]).join(', ')}` : !prev.ok ? 'last run failed' : FORCE ? 'forced' : 'outputs changed or missing';
  if (DRY) { log(`would run ${key} (${why})`); summary.push([key, 'would run', 0]); return prev; }
  log(`run   ${key} (${why})${note ? ' ' + note : ''}`);
  const ts = Date.now();
  const r = await run();
  if (after && ok(r.code)) after(inHash);
  const ms = Date.now() - ts;
  const outs = (typeof outputs === 'function' ? outputs(inHash) : outputs).map(outputRecord);
  const success = ok(r.code) && outs.every((o) => !o.missing);
  graph.steps[key] = {
    inputHash: inHash, inputs: ins, outputs: outs, published, outputHash: sha(JSON.stringify(outs.map((o) => [path.basename(o.path), o.sha || null]))),
    ok: success, code: r.code, ran: new Date().toISOString(), ms, cmd: r.cmd, ...(r.extra || {}),
  };
  changed.add(key);
  save();
  log(`${success ? 'done ' : 'FAIL '} ${key} in ${(ms / 1000).toFixed(1)} s${success ? '' : ` (exit ${r.code}${outs.some((o) => o.missing) ? ', outputs missing' : ''})`}`);
  summary.push([key, success ? 'ran' : 'failed', ms]);
  if (!success && !has('keep-going')) { printSummary(); process.exit(1); }
  return graph.steps[key];
}
function sh(command, args, { env = {}, cwd = ROOT, tail = 12 } = {}) {
  const shown = [command, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  log(`  $ ${shown}`);
  const r = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split('\n').filter((l) => l.trim() && !/PIXEL_PACK|GL Driver/.test(l));
  for (const l of lines.slice(-tail)) console.log('    ' + l.slice(0, 220));
  // (GB43: the whole output kept, one file a command, so a step's time can be read back: the tail alone hid the bake's)
  try {
    const ld = path.join(CACHE, 'logs'); fs.mkdirSync(ld, { recursive: true });
    const lf = path.join(ld, `${new Date().toISOString().replace(/[:.]/g, '-')}_${path.basename(args.find((x) => /\.(m?js|py|sh)$/.test(x)) || command)}_${process.pid}.log`);
    fs.writeFileSync(lf, `$ ${shown}\n${lines.join('\n')}\n`); log(`    (log ${lf})`);
  } catch { /* */ }
  return { code: r.status ?? 1, cmd: shown, out: r.stdout || '' };
}
// a CORS file server over a folder (argv: folder, port), its own process because the steps run their tools synchronously;
// the page fetches the cell packages and the take from it (lane A's harness serves ?cellsbase= the same way)
const SERVE_DIR = `const http=require('http'),fs=require('fs'),path=require('path');const dir=process.argv[1];
http.createServer((q,s)=>{const c={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Private-Network':'true','Access-Control-Allow-Headers':'*'};
if(q.method==='OPTIONS'){s.writeHead(204,c);return s.end();}const p=path.join(dir,decodeURIComponent(q.url.split('?')[0]));
if(!p.startsWith(dir+'/')||!fs.existsSync(p)||fs.statSync(p).isDirectory()){s.writeHead(404,c);return s.end();}
s.writeHead(200,{...c,'Content-Type':p.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(p).pipe(s);
}).listen(+process.argv[2],'127.0.0.1');`;
function printSummary() {
  if (!summary.length) return;
  console.log('\nstep'.padEnd(52) + 'result     seconds');
  for (const [k, s, ms] of summary) console.log(k.padEnd(51) + s.padEnd(11) + (ms / 1000).toFixed(1));
}

// ---------------------------------------------------------------- the city's inputs
const SH = readJSON(path.join(ROOT, 'tools/ad/shots.json'));
const shotSpec = (s) => { const p = SH.shots[s] || SH.probes?.[s]; if (!p) { console.error('no shot', s); process.exit(2); } return p; };
const LAT0 = 40.7831, LON0 = -73.9712, MLAT = 111132.0, MLON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const proj = (lon, lat) => [(lon - LON0) * MLON, -(lat - LAT0) * MLAT];
const TILES = path.join(ROOT, 'client/public/tiles');
// the compiled tiles a shot's near field reads: within 1.6 km of its keys (the near ring 1 km + the unload margin + a tile)
function tilesNear(spec, margin = 1600) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const k of spec.keys || []) for (const q of [k.p, k.look].filter(Boolean)) { const [x, z] = proj(q[0], q[1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const man = readJSON(path.join(TILES, 'manifest.json')), out = [];
  for (let tz = Math.floor((z0 - margin) / 512); tz <= Math.floor((z1 + margin) / 512); tz++) for (let tx = Math.floor((x0 - margin) / 512); tx <= Math.floor((x1 + margin) / 512); tx++) {
    const e = man.tiles[`${tx}_${tz}`];
    if (e) out.push(path.join(TILES, e.f));
  }
  return out;
}
const CODE = {
  take: ['core/sim', 'core/tracks', 'core/world', 'core/env', 'client/src/sim', 'client/src/shared', 'tools/core/take.mjs', 'tools/core/actor_layers.sh', 'tools/core/light_bake.mjs', 'tools/core/signals_dump.mjs',
    'tools/core/tracks_to_peds.mjs', 'tools/core/tracks_to_trains.mjs', 'tools/core/tracks_to_boats.mjs', 'tools/core/tracks_to_mov.py', 'client/tools/ar34/export/usd_write.py', 'client/tools/ar34/export/usd_peds.py'],
  loadset: ['core/streaming', 'tools/core/loadsets.mjs'],
  lodBuild: ['tools/lod/build_persistent.mjs', 'client/src/world/tiledata.js', 'client/src/world/towers.js', 'client/src/world/lotfix39.js', 'client/src/world/ringOffset.js',
    'client/src/shared/geo.js', 'client/src/shared/landmarkSpec.js', 'client/tools/pipeline/binio.mjs'],
  lodExport: ['tools/lod/export_packages.mjs', 'client/src/world/tiledata.js', 'client/public/textures/far_windows_fw14.png'],
  cells: ['tools/cells', 'client/src'],
  three: ['client/src', 'client/index.html', 'client/vite.config.js', 'tools/ad/record.mjs'],
  blender: ['client/tools/ar34/export/blender_take.py', 'client/tools/ar34/export/blender_render.py', 'client/tools/ar34/export/blender_moving.py', 'client/tools/ar34/export/blender_light.py'],
  ue: ['tools/ue', ...fs.readdirSync(path.join(ROOT, 'client/tools/ar34/export')).filter((f) => /^ue_.*\.py$/.test(f)).map((f) => `client/tools/ar34/export/${f}`)],
  gate: ['tools/ad/temporal_scan.py'],
  cut: ['tools/ad/teaser_area_cut.mjs'],
};
// ==== BD40: the backdrop's chain (tools/lod/backdrop.sh: records, ground, far levels merged beside the city's chunks)
CODE.bdRecords = ['client/tools/pipeline/backdrop', 'tools/lod/water_l6.py', 'tools/lod/backdrop.sh'];
CODE.bdGround = ['tools/lod/backdrop_ground.py', 'client/tools/pipeline/backdrop/common.py', 'client/tools/pipeline/backdrop/land.py', 'client/tools/pipeline/backdrop/terrain.py'];
CODE.bdBuild = ['tools/lod/build_backdrop.mjs', 'tools/lod/shellkit.mjs', 'tools/lod/build_persistent.mjs', 'client/src/world/towers.js', 'client/src/world/tiledata.js', 'tools/lod/backdrop.sh'];
// ==== end BD40
// skip: folders the step's tool never loads (the page imports client/src/cells only behind ?cells=1, lane A's baker lives there)
const code = (name, skip = []) => ({ files: CODE[name].flatMap((p) => { const a = path.join(ROOT, p); return fs.existsSync(a) && fs.statSync(a).isDirectory() ? walkFiles(a, (f) => /\.(m?js|cjs|py|sh|json|html)$/.test(f) && !skip.some((d) => f.startsWith(path.join(ROOT, d) + path.sep))) : [a]; }) });

// ---------------------------------------------------------------- steps
async function lodSteps() {
  const tileFiles = walkFiles(TILES, (f) => /\/(t|far)_-?\d+_-?\d+\.bin$|manifest\.json$/.test(f));
  const bd = await backdropSteps();   // (BD40: the backdrop's records and ground; its chunks are built with the city's below)
  await step('lod:build', {
    inputs: { code: code('lodBuild'), tiles: { files: tileFiles }, lf39: { file: path.join(ROOT, 'client/public/data/lf39/lf39.json') }, registry: { file: path.join(ROOT, 'client/public/data/landmarks.json') },
      bdGround: { step: 'lod:backdrop:ground' }, bdCode: code('bdBuild') },   // (BD40)
    outputs: [path.join(CACHE, 'lod16')],
    run: () => {
      const a = sh(process.execPath, ['--max-old-space-size=24000', 'tools/lod/build_persistent.mjs', '--out', path.join(CACHE, 'lod16')], { tail: 5 });
      if (a.code) return a;
      return sh('bash', ['tools/lod/backdrop.sh', 'build', path.join(CACHE, 'lod16'), bd.run], { env: { BD_REC: bd.rec }, tail: 5 });   // (BD40)
    },
  });
  await step('lod:export', {
    inputs: { chunks: { step: 'lod:build' }, water: { file: path.join(ROOT, 'client/data/raw/water_l6.json') }, code: code('lodExport'), registry: { file: path.join(ROOT, 'client/public/data/landmarks.json') }, bin: { file: path.join(CACHE, 'lod16/landmarks_l6.bin') } },
    outputs: [path.join(CELLCACHE, 'lod16/index.json'), path.join(CELLCACHE, 'plain/lod16/index.json')],
    run: () => { const a = sh(process.execPath, ['tools/lod/export_packages.mjs'], { tail: 5 }); if (a.code) return a; return sh(process.execPath, ['tools/lod/export_packages.mjs', '--plain', '--levels', '6,5'], { tail: 3 }); },
  });
}
// ==== BD40: the backdrop: its records (from client/data/raw/backdrop and the charts' water) and the ground of its chunks;
// lod:build then adds the city's L3 under the L4s it shares and the backdrop's chunks and landmarks to its lod16 folder
async function backdropSteps() {
  const BD_REC = process.env.BD_REC || '/data0/projectnyc_aux/tiles_backdrop/records';
  const BD_RUN = process.env.BD_RUN || path.join(CACHE, 'backdrop');
  const raw = walkFiles(path.join(ROOT, 'client/data/raw/backdrop'), (f) => !/provenance\.json$/.test(f));
  const macros = walkFiles(TILES, (f) => /\/far_-?\d+_-?\d+\.bin$|manifest\.json$/.test(f));
  await step('lod:backdrop:records', {
    inputs: { code: code('bdRecords'), raw: { files: raw }, enc: { file: path.join(ROOT, 'client/data/raw/enc_water.json') }, city: { file: path.join(ROOT, 'client/data/raw/boundaries.geojson') },
      landings: { file: path.join(ROOT, 'client/data/raw/osm_landings.json') }, macros: { files: macros } },
    outputs: [path.join(BD_REC, 'buildings.ctl'), path.join(BD_REC, 'ground8.npy'), path.join(BD_REC, 'land', 'bd_land.wkb'), path.join(ROOT, 'client/data/raw/water_l6.json')],
    run: () => sh('bash', ['tools/lod/backdrop.sh', 'records'], { env: { BD_REC }, tail: 8 }),
  });
  await step('lod:backdrop:ground', {
    inputs: { records: { step: 'lod:backdrop:records' }, code: code('bdGround') },
    outputs: [path.join(BD_RUN, 'ground', 'plan.json'), path.join(BD_RUN, 'ground', 'index.json')],
    run: () => sh('bash', ['tools/lod/backdrop.sh', 'ground', BD_RUN], { env: { BD_REC }, tail: 4 }),
  });
  return { rec: BD_REC, run: BD_RUN };
}
// ==== end BD40
// the cells a shot needs: its load set's 11 x 11 grids (baked and missing), or a box / list
function cellList() {
  if (opt('cells')) return { name: opt('name', 'cells'), cells: opt('cells').split(',') };
  if (opt('bbox')) {
    const [x0, z0, x1, z1] = opt('bbox').split(',').map(Number), out = [];
    for (let cz = Math.floor(z0 / 128); cz <= Math.floor(z1 / 128); cz++) for (let cx = Math.floor(x0 / 128); cx <= Math.floor(x1 / 128); cx++) out.push(`${cx}_${cz}`);
    return { name: opt('name', 'bbox'), cells: out };
  }
  const s = opt('shot');
  const ls = loadsetOf(s);
  if (!fs.existsSync(ls)) { console.error(`no load set for ${s}: run \`valdrada take ${s}\` first`); process.exit(2); }
  const L = readJSON(ls);
  return { name: s, cells: [...new Set([...L.union.cells, ...L.union.cellsMissing])].sort() };
}
async function cellsStep(list) {
  const tileOf = (k) => { const [cx, cz] = k.split('_').map(Number); return `${Math.floor(cx / 4)}_${Math.floor(cz / 4)}`; };
  const man = readJSON(path.join(TILES, 'manifest.json'));
  const tiles = [...new Set(list.cells.flatMap((k) => { const [tx, tz] = tileOf(k).split('_').map(Number); const a = []; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const e = man.tiles[`${tx + dx}_${tz + dz}`]; if (e) a.push(path.join(TILES, e.f)); } return a; }))].sort();
  return step(`cells:${list.name}`, {
    inputs: { cells: { value: list.cells }, tiles: { files: tiles }, code: code('cells') },
    outputs: [path.join(CELLCACHE, 'index', `${list.name}.json`), path.join(CELLCACHE, 'plain', list.name, 'index.json')],
    note: `(${list.cells.length} cells; lane A's bake skips the cells already in its cache)`,
    run: () => {
      const a = sh(process.execPath, ['tools/withgpu.mjs', `valdrada cells ${list.name}`, '--', process.execPath, 'tools/cells/bake.mjs', '--cells', list.cells.join(','), '--name', list.name], { env: { GPU_LANE: LANE }, tail: 6 });
      if (a.code) return a;
      return sh(process.execPath, ['tools/cells/export_plain.mjs', '--region', list.name], { tail: 3 });
    },
  });
}
// the take's identity (tracks and stats) is snapshotted under the step's input hash: lane D's tool publishes to a shared
// folder other agents also publish to, and the graph must not lose its record when they do
const snapDir = (key, h) => path.join(CACHE, 'steps', key.replace(/[:]/g, '_'), h.slice(0, 24));
async function takeSteps(shot, seed) {
  const spec = shotSpec(shot);
  const pub = path.join(CELLCACHE, 'takes', shot);
  const tkey = `take:${shot}:s${seed}`;
  let takeVer = null;
  const t = await step(tkey, {
    inputs: { shot: { value: { spec, meta: SH._meta } }, seed: { value: seed }, code: code('take'), tiles: { files: tilesNear(spec) } },
    outputs: (h) => [path.join(snapDir(tkey, h), 'tracks.atrk'), path.join(snapDir(tkey, h), 'stats.json')],
    published: [path.join(pub, 'tracks.atrk'), path.join(pub, 'usd'), path.join(pub, 'harvest')],
    note: '(lane D: take, actor layers, light)',
    // lane D publishes each build atomically as <shot>/v<stamp>/ and repoints the links; the snapshot copies THIS run's
    // version (its "published ... -> v<stamp>" line), not whatever the links point at by then
    run: () => { const r = sh('bash', ['tools/core/actor_layers.sh', shot, String(seed)], { tail: 8 }); const m = /published .* -> (v\d{8}-\d{6})/.exec(r.out); takeVer = m ? m[1] : null; return { ...r, extra: { version: takeVer } }; },
    after: (h) => { const d = snapDir(tkey, h), src = takeVer && fs.existsSync(path.join(pub, takeVer)) ? path.join(pub, takeVer) : pub; fs.mkdirSync(d, { recursive: true }); for (const f of ['tracks.atrk', 'stats.json']) fs.copyFileSync(path.join(src, f), path.join(d, f)); },
  });
  if (!t) return;
  const takeSnap = path.dirname(t.outputs[0].path);
  // the cells this take can need: the cinematic grid (11 x 11 + the keep margin) round every frame's camera; only their
  // entries in lane A's index are inputs, so a cell baked elsewhere does not touch this shot
  const cellIdx = fs.existsSync(path.join(CELLCACHE, 'index.json')) ? readJSON(path.join(CELLCACHE, 'index.json')) : { cells: {} };
  const near = new Set();
  try {
    const { readTracks } = await import('../core/tracks/format.mjs');
    const T = readTracks(t.outputs[0].path), F = T.header.camera.fields;
    const tiers = readJSON(path.join(ROOT, 'client/public/data/tiers.json')), N = tiers.tiers.cinematic.loadedGrid.cells, h = Math.floor(N / 2) + 1;
    for (const r of T.header.camera.rows) { const cx = Math.floor(r[F.indexOf('x')] / 128), cz = Math.floor(r[F.indexOf('z')] / 128); for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) near.add(`${cx + dx}_${cz + dz}`); }
  } catch (e) { log('loadset: camera rows unreadable, the whole cell index is the input', e.message); }
  const cellsIn = near.size ? { value: [...near].sort().map((k) => [k, cellIdx.cells[k] ? cellIdx.cells[k].hash : null]) } : { file: path.join(CELLCACHE, 'index.json') };
  const lkey = `loadset:${shot}:cinematic`;
  await step(lkey, {
    inputs: { camera: { file: t.outputs[0].path }, lod: { file: path.join(CELLCACHE, 'lod16/index.json') }, cells: cellsIn,
      tiers: { file: path.join(ROOT, 'client/public/data/tiers.json') }, shot: { value: { spec, meta: SH._meta } }, code: code('loadset') },
    outputs: (h) => [path.join(snapDir(lkey, h), 'loadset.json')],
    published: [path.join(pub, 'loadset.json')],
    run: () => { fs.mkdirSync(path.join(CACHE, 'steps', 'tmp'), { recursive: true }); return sh(process.execPath, ['tools/core/loadsets.mjs', shot, '--tier', 'cinematic', '--take', takeSnap, '--out', path.join(CACHE, 'steps', 'tmp', `${shot}.loadset.json`)], { tail: 2 }); },
    after: (h) => { const d = snapDir(lkey, h), src = path.join(CACHE, 'steps', 'tmp', `${shot}.loadset.json`); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(src, path.join(d, 'loadset.json')); fs.mkdirSync(pub, { recursive: true }); fs.copyFileSync(src, path.join(pub, 'loadset.json')); },
  });
}
// the load set the graph owns for a shot (its snapshot), else the published one
function loadsetOf(shot) {
  const s = graph.steps[`loadset:${shot}:cinematic`];
  return s && s.outputs && s.outputs[0] && fs.existsSync(s.outputs[0].path) ? s.outputs[0].path : path.join(CELLCACHE, 'takes', shot, 'loadset.json');
}
function framesOpt(spec) {
  const total = Math.round(spec.duration * (SH._meta?.fps || 30));
  const f = opt('frames');
  if (!f) return { a: 0, b: total, tag: 'all' };
  const [a, b] = f.split('-').map(Number);
  return { a: Math.max(0, a), b: Math.min(total, b), tag: `f${a}-${b}` };
}
async function renderStep(shot, renderer) {
  const spec = shotSpec(shot), fr = framesOpt(spec);
  const ls = loadsetOf(shot);
  const time = opt('time', spec.time || 'golden');
  if (renderer === 'ue') {
    // tools/ue/render_take.sh: the take's world (its load set's cells at their current hashes, the far chunks and the
    // landmarks) and the take (actors, light) are each built once and reused by their keys, then the frames, on GPU 0
    // under the shared Unreal GPU lock. Exit 0 frames written; 2 inputs missing; 3 world; 4 take; 5 render; 6 frames
    const root = path.join(ROOT, 'client/shots/valdrada/ue');
    return step(`render:ue:${shot}:${fr.tag}`, {
      inputs: { take: { step: `take:${shot}:s${opt('seed', '1')}` }, loadset: { file: ls }, cells: { file: path.join(CELLCACHE, 'index.json') },
        lod: { file: path.join(CELLCACHE, 'plain/lod16/index.json') }, code: code('ue'), frames: { value: fr } },
      outputs: [path.join(root, fr.tag, 'clips', shot)],
      run: () => sh('bash', ['tools/ue/render_take.sh', shot, ...(opt('frames') ? ['--frames', opt('frames')] : []), '--out', root], { tail: 6 }),
    });
  }
  if (renderer === 'blender') {
    const usd = path.join(CELLCACHE, 'takes', shot, 'usd');
    const out = path.join(ROOT, 'client/shots/valdrada/blender', `${shot}_${fr.tag}`);
    const gpu = (Number(LANE) - 1) % 3;
    return step(`render:blender:${shot}:${fr.tag}`, {
      inputs: { take: { step: `take:${shot}:s${opt('seed', '1')}` }, loadset: { file: ls }, code: code('blender'), frames: { value: fr }, samples: { value: opt('samples', '24') } },
      outputs: [out],
      run: () => sh('/data0/projectnyc_aux/.tools/blender/blender', ['-b', '--factory-startup', '--python', 'client/tools/ar34/export/blender_take.py', '--', '--usd', path.join(usd, `${shot}.usda`),
        '--frames', `${fr.a}-${fr.b - 1}`, '--outdir', out, '--samples', opt('samples', '24')], { env: { CUDA_VISIBLE_DEVICES: String(gpu) }, tail: 6 }),
    });
  }
  // three.js: tools/ad/record.mjs, the film's flags (+ ?lod16=1, the persistent skyline, unless --nolod16), its own root.
  // The source is the one Unreal renders: the take the graph made (?replay, every actor from the core's tracks) and the
  // cell packages (?cells=1), both served by a CORS file server over the aux tree for the length of the recording.
  // --live: the page's own simulation and live city instead
  const live = has('live');
  const takeKey = `take:${shot}:s${opt('seed', '1')}`, tk = graph.steps[takeKey];
  const atrk = tk && tk.outputs && tk.outputs[0] && tk.outputs[0].path;
  if (!live && !(atrk && fs.existsSync(atrk))) {
    log(`render three: no take of ${shot} in the graph; run \`valdrada take ${shot}\` first (or --live for the page's own simulation)`);
    summary.push([`render:three:${shot}`, 'no take', 0]);
    return null;
  }
  const AUX = '/data0/projectnyc_aux', port = 47000 + Number(LANE), srv = `http://127.0.0.1:${port}`;
  const flags = `${SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1'}${has('nolod16') ? '' : '&lod16=1'}${live ? '' : '&cells=1'}`;
  const served = live ? '' : `&cellsbase=${encodeURIComponent(srv + '/cellcache')}&replay=${encodeURIComponent(srv + atrk.slice(AUX.length))}`;
  const root = path.join(ROOT, 'client/shots/valdrada/three', fr.tag);
  const tag = opt('time') ? `${shot}_${time}` : shot;
  const lod = has('nolod16') ? {} : { lod: { file: path.join(ROOT, 'client/public/data/lod16/index.json') }, registry: { file: path.join(ROOT, 'client/public/data/landmarks.json') } };
  const source = live ? {} : { take: { step: takeKey }, cells: { file: path.join(CELLCACHE, 'index.json') } };
  return step(`render:three:${shot}:${fr.tag}`, {
    inputs: { shot: { value: { spec, meta: SH._meta } }, frames: { value: fr }, time: { value: time }, flags: { value: flags }, code: code('three', /(^|&)cells=1/.test(flags) ? [] : ['client/src/cells']), tiles: { files: tilesNear(spec) },
      city: { file: ls }, assets: { dir: path.join(ROOT, 'client/public/models') }, textures: { dir: path.join(ROOT, 'client/public/textures') }, ...lod, ...source },
    outputs: [path.join(root, 'clips', tag)],
    run: () => {
      const files = live ? null : spawn(process.execPath, ['-e', SERVE_DIR, AUX, String(port)], { stdio: 'ignore' });
      try {
        return sh(process.execPath, ['tools/ad/record.mjs', '--shot', shot, '--start', String(fr.a), '--end', String(fr.b), '--out', root, '--encode', '0', '--noqa', '--flags', flags + served,
          ...(opt('time') ? ['--time', time] : [])], { env: { GPU_LANE: LANE }, tail: 6 });
      } finally { if (files) files.kill(); }
    },
  });
}
async function gateStep(shot, renderer) {
  const spec = shotSpec(shot), fr = framesOpt(spec);
  const root = path.join(ROOT, 'client/shots/valdrada', renderer, fr.tag);
  const tag = opt('time') ? `${shot}_${opt('time')}` : shot;
  const outJson = path.join(root, '_gate', `${tag}.json`);
  return step(`gate:${renderer}:${shot}:${fr.tag}`, {
    inputs: { frames: { step: `render:${renderer}:${shot}:${fr.tag}` }, code: code('gate') },
    outputs: [outJson],
    ok: (c) => c === 0 || c === 3,   // 3: the take fails a check; the verdict is recorded and the trailer reports it
    run: () => { fs.mkdirSync(path.dirname(outJson), { recursive: true }); const r = sh('python3', ['tools/ad/temporal_scan.py', path.join(root, 'clips'), tag, '--out', path.join(root, '_gate'), '--json', outJson], { tail: 3 }); return { ...r, extra: { verdict: r.code === 0 ? 'pass' : r.code === 3 ? 'fail' : 'error' } }; },
  });
}
async function trailer(seqFile) {
  const seq = readJSON(path.resolve(ROOT, seqFile));
  const renderer = opt('renderer', 'three'), seed = parseInt(opt('seed', '1'), 10);
  // the cut's default name carries the renderer (three.js keeps the bare name), so cuts of one sequence from two
  // renderers never write the same file
  const name = opt('name', 'vg_' + path.basename(seqFile).replace(/_seq\.json$|\.json$/g, '') + (renderer === 'three' ? '' : `_${renderer}`));
  const verdicts = [];
  for (const s of seq.shots) {
    await takeSteps(s.name, seed);
    if (await renderStep(s.name, renderer)) { const g = await gateStep(s.name, renderer); verdicts.push([s.name, g && g.verdict]); }
  }
  const fr = framesOpt(shotSpec(seq.shots[0].name));
  const clips = path.join(ROOT, 'client/shots/valdrada', renderer, fr.tag, 'clips');
  const inputs = { seq: { value: seq }, code: code('cut') };
  for (const s of seq.shots) inputs[`render:${s.name}`] = { step: `render:${renderer}:${s.name}:${fr.tag}` };
  await step(`cut:${name}:${renderer}:${fr.tag}`, {
    inputs, outputs: [path.join(ROOT, 'client/shots/ad', `nyc_${name}.mp4`)],
    run: () => sh(process.execPath, ['tools/ad/teaser_area_cut.mjs', '--name', name, '--seq', path.resolve(ROOT, seqFile), '--clips', clips], { tail: 4 }),
  });
  const failed = verdicts.filter(([, v]) => v === 'fail');
  if (failed.length) log(`gates: ${failed.length} shot(s) fail temporal_scan: ${failed.map(([n]) => n).join(', ')}`);
}

// ---------------------------------------------------------------- commands
try {
  if (cmd === 'lod') await lodSteps();
  else if (cmd === 'cells') await cellsStep(cellList());
  else if (cmd === 'take') await takeSteps(pos[0], parseInt(opt('seed', '1'), 10));
  else if (cmd === 'render') { const r = opt('renderer', 'three'); await renderStep(pos[0], r); }
  else if (cmd === 'gate') await gateStep(pos[0], opt('renderer', 'three'));
  else if (cmd === 'trailer') await trailer(pos[0]);
  else if (cmd === 'status') {
    const S = Object.entries(graph.steps);
    console.log(`${GRAPH}: ${S.length} steps`);
    if (has('steps')) for (const [k, v] of S) console.log(`  ${k.padEnd(48)} ${v.ok ? 'ok  ' : 'FAIL'} ${v.ran} ${(v.ms / 1000).toFixed(1)} s  in ${v.inputHash.slice(0, 12)} out ${v.outputHash.slice(0, 12)}`);
  } else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 20).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
} finally { save(); }
printSummary();
