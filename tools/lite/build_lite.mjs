// LITE15 (owner 2026-10-10): the light showcase for the Hugging Face Space, built for 2020-era PCs.
//   node tools/lite/build_lite.mjs --out <dir> [--assets <trace.txt>] [--novite] [--src <client>] [--trailer <mp4>]
//       [--content <built dir>]
// --content takes the tiles, data, textures, models, poster and trailer of an earlier build as they are (only the code
// and index.html are new): a code fix keeps the content that was checked and published.
// 1. showcase.json: the scenes (trailer camera moves from tools/ad/shots.json, slowed, with plain titles) and the places
//    of the menu (SPACE r2: where Walk, Drone and Drive start, and the disc each one may roam)
// 2. the client built by Vite without its public folder (index.html opens the showcase with the light settings)
// 3. only the tiles the visitor can reach: near tiles within the light near radius of every scene's camera path and of
//    every point of the places' discs, far tiles within the light far radius; tiles/manifest.json filtered to them, so
//    nothing outside is ever requested
// 4. small shared folders (data, settings, luts, basis, the interface's Inter subsets), and every other asset the trace
//    saw requested (tools/lite/trace_lite.mjs writes the list)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { project, TILE, MACRO } from '../../client/src/shared/geo.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PUB = path.join(REPO, 'client/public');
const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(REPO, '../projectnyc_aux/lite/out')));
const ASSETS = arg('assets');
const SRC = path.resolve(arg('src', path.join(REPO, 'client')));   // the client to build (a scrubbed copy for public builds)
const DIR = path.dirname(OUT);

// The loading screen (#vload), SPACE r2: the blurred poster frame, the wordmark and one quiet line of status with its
// percentage, fed by the boot timeline (window.__BOOT) and the showcase (window.__SC); held until the first scene's
// programs are compiled and its frames warm. Phones and browsers without WebGL2 get the trailer instead, with the live
// view one tap away. The interface's type is Inter (OFL), subset to Latin and served as woff2 (client/public/fonts/ui).
export const LOADER = `
<style>
@font-face{font-family:Inter;font-style:normal;font-weight:400;font-display:swap;src:url(fonts/ui/Inter-400.woff2) format('woff2')}
@font-face{font-family:Inter;font-style:normal;font-weight:500;font-display:swap;src:url(fonts/ui/Inter-500.woff2) format('woff2')}
@font-face{font-family:Inter;font-style:normal;font-weight:600;font-display:swap;src:url(fonts/ui/Inter-600.woff2) format('woff2')}
#vload{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;color:#fff;overflow:hidden;
  font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;background:#06080b;transition:opacity 1.1s ease;-webkit-font-smoothing:antialiased}
#vload .bg{position:absolute;inset:-48px;background:url(poster.jpg) center/cover;filter:blur(24px) brightness(.5) saturate(1.05);transform:scale(1.06)}
#vload .in{position:relative;text-align:center;padding:0 24px}
#vload .w{font-weight:600;font-size:clamp(44px,6.6vw,88px);letter-spacing:-.03em;line-height:1}
#vload .st{margin-top:22px;font-size:14px;font-weight:400;opacity:.74;min-height:20px;font-variant-numeric:tabular-nums}
#vload .st b{font-weight:400;margin-left:9px}
#vload .s{font-size:clamp(15px,1.4vw,18px);opacity:.86;margin-top:16px;line-height:1.45}
#vload video{display:block;width:min(960px,92vw);border-radius:8px;margin:24px auto 0;box-shadow:0 12px 48px rgba(0,0,0,.5)}
#vload button{margin-top:18px;color:#fff;background:rgba(255,255,255,.14);border:0;border-radius:999px;padding:11px 20px;font:500 15px Inter,system-ui,sans-serif;cursor:pointer}
#vload button:hover{background:rgba(255,255,255,.22)}
</style>
<div id="vload"><div class="bg"></div><div class="in"><div class="w">Valdrada</div><div class="st"><span>Starting</span><b>0%</b></div></div></div>
<script>(function(){
var L=document.getElementById('vload'),st=L.querySelector('.st span'),pc=L.querySelector('.st b');
var gl=null;try{gl=document.createElement('canvas').getContext('webgl2');}catch(e){}
var phone=matchMedia('(pointer:coarse)').matches&&Math.min(screen.width,screen.height)<820;
// a software renderer (SwiftShader, llvmpipe) cannot draw the city at any useful rate: the trailer, with the live view on request
var soft=false;try{if(gl){var dx=gl.getExtension('WEBGL_debug_renderer_info'),rn=String(gl.getParameter(dx?dx.UNMASKED_RENDERER_WEBGL:gl.RENDERER)||'');soft=/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rn);}}catch(e){}
if((!gl||phone||soft)&&!/[?&]live=1/.test(location.search)){
  window.__VALDRADA_NOLIVE=true;
  L.querySelector('.in').innerHTML='<div class="w">Valdrada</div><div class="s">'+(!gl?'This browser cannot run the live city. This is the trailer.':soft?'This computer draws 3D without a graphics card, too slowly for the live city. This is the trailer.':'The live city needs a computer with a graphics card. This is the trailer.')+'</div>'+
   '<video src="trailer.mp4" controls autoplay muted playsinline loop poster="poster.jpg"></video>'+(gl?'<button id="vlive" type="button">Open the live city anyway</button>':'');
  var b=document.getElementById('vlive');if(b)b.onclick=function(){location.search+=(location.search?'&':'?')+'live=1';};
  return;}
var S={'tile manifest':[.06,'Loading the city'],'tile assembly open':[.1,'Loading the city'],'landmarks module':[.16,'Loading the city'],
 'fleet24 loaded':[.3,'Loading vehicles'],'crowd loaded':[.44,'Loading people'],'sims':[.5,'Starting traffic'],'frame loop':[.56,'Building the streets'],'near ring ready':[.6,'Building the streets']};
// the bytes downloaded so far (each finished request) against what the first scene needs (FIRST, measured), so the
// percentage moves through the large downloads between the boot's stages. A finished request counts at its file's size
// from sizes.json (tools/lite/sizes.mjs): on the published Space the large files are redirects to a CDN on another
// origin, and Resource Timing reports their sizes as 0 there; a request not in the list counts at what the browser
// reports, or at the average size of a listed file.
var got=0,FIRST=__FIRSTBYTES__,SZ=null,seen={},early=[],base=location.href.replace(/[?#].*$/,'').replace(/[^\/]*$/,'');
function add(e){var k=e.name.split('#')[0].split('?')[0];if(seen[k])return;seen[k]=1;
 if(!SZ){early.push(e);return;}var r=k.indexOf(base)===0?decodeURIComponent(k.slice(base.length)):null;
 var n=(r&&SZ[r])||e.encodedBodySize||e.transferSize||(r&&/\.(json|js|css|html|woff2|wasm)$/.test(r)?0:SZ.__avg||0);got+=n;}
try{fetch('sizes.json').then(function(r){return r.json();}).then(function(j){var t=0,c=0;for(var k in j){t+=j[k];c++;}j.__avg=c?t/c:0;SZ=j;},function(){SZ={};}).then(function(){var E=early;early=[];E.forEach(add);});
 performance.setResourceTimingBufferSize(5000);new PerformanceObserver(function(ls){ls.getEntries().forEach(add);}).observe({type:'resource',buffered:true});}catch(e){}
// ...and the bytes of the app's fetches as they stream in, so a large file moves the line while it downloads (until the
// first scene shows; then fetch is the browser's own again)
var flow=0,F0=window.fetch;window.__VL={get got(){return got;},get flow(){return flow;}};
if(F0&&window.TransformStream&&window.Response){window.fetch=function(){return F0.apply(this,arguments).then(function(res){try{
 if(!res.body||res.type==='opaque')return res;var ts=new TransformStream({transform:function(c,k){flow+=c.byteLength;k.enqueue(c);}});
 return new Response(res.body.pipeThrough(ts),{status:res.status,statusText:res.statusText,headers:res.headers});}catch(e){return res;}});};}
// the percentage is the bytes (to 92 %), then the first scene's own preparation; the boot's stages name the line
var shown=0;function tick(){var p=.02,l='Starting',sp=0,B=window.__BOOT||[];
 for(var i=0;i<B.length;i++){var e=S[B[i][1]];if(e&&e[0]>sp){sp=e[0];l=e[1];}}
 var q=.92*Math.min(1,Math.max(got,flow)/FIRST);if(q>p){p=q;if(l==='Starting')l='Loading the city';}
 var C=window.__SC;if(C){if(C.progress>p){p=C.progress;l='Preparing the first scene';}if(C.shown)p=1;}
 shown+=(p-shown)*.25;st.textContent=l;pc.textContent=Math.round(shown*100)+'%';
 if(!(C&&C.shown))setTimeout(tick,150);else if(F0&&window.fetch!==F0)window.fetch=F0;}
tick();})();</script>`;

const SPACE_README = `---
title: Valdrada
emoji: 🗽
colorFrom: indigo
colorTo: yellow
sdk: static
pinned: true
short_description: New York City, live in your browser (three.js)
---

# Valdrada: New York City, live in your browser

A real-time digital twin of New York City built from public data, rendered live with three.js. The camera tours Central
Park, Harlem's 125th Street, Columbia University and Midtown. Open the menu with Esc, the Menu button or a gamepad's Start
button to walk the streets, fly a camera drone or drive at any of the tour's places, in the morning, at golden hour or at
night.

This is the light edition, sized for ordinary computers. The full city, the simulator and its Python API:
<https://github.com/mkturkcan/valdrada>.
`;
export const LITE = { near: 640, macro: 5000 };
// the light settings every visitor gets (index.html puts them in the URL before any module loads)
// one walker set (rb27=0) and a light, New York fleet (about 20 MB of models instead of 130)
const FLEET = 'taxinv200,nypd,cargovan,stepvan,uspsllv,mtaxd40,mustang,auditt,impala,boxtruck26,schoolbus,foodtruck';
// lowmem=1 (client/src/world/cpuFree.js): the CPU copies of static tile geometry and compressed textures go once uploaded
export const QUERY = `showcase=1&hud=0&gi=0&probe=0&nocascade2=1&pr=1&sm=2048&near=${LITE.near}&macro=${LITE.macro}&pedtarget=160&fall=0&rb27=0&lowmem=1&f24only=${FLEET}`;

// The tour: the shot, the caption (place and title), the seconds on screen, the menu place it belongs to (`at`, an id of
// PLACES), whether it opens the page and a time of day other than the shot's. Only places that hold up at the tour's
// framing: 125th Street at Lenox is a Walk and Drive place without a tour stop (its towers are plain boxes).
const SCENES = [
  { shot: 'scLakeGolden', place: 'Central Park', title: 'The Lake and Bow Bridge at golden hour', secs: 13, at: 'lake', first: true },
  { shot: 'scBowGolden', place: 'Central Park', title: 'Bow Bridge', secs: 12, at: 'lake' },
  { shot: 'scTerraceGolden', place: 'Central Park', title: 'Bethesda Terrace', secs: 12, at: 'terrace' },
  { shot: 't4Angel', place: 'Central Park', title: 'Bethesda Fountain and the Angel of the Waters', secs: 12, at: 'terrace' },
  { shot: 't7Mall', place: 'Central Park', title: 'The Mall under its elms', secs: 12, at: 'mall' },
  { shot: 'fColumbia', place: 'Columbia University', title: 'College Walk to Low Library', secs: 14, at: 'columbia' },
  { shot: 't7ArchTrack', place: 'Harlem', title: 'The Riverside Drive Viaduct at 125th Street', secs: 12, at: 'riverside' },
  { shot: 't7ValleyTrain', place: 'Harlem', title: 'The 1 train on the Manhattan Valley Viaduct', secs: 12, at: 'broadway' },
  { shot: 'tuValleyTrainDusk', place: 'Harlem', title: 'The viaduct at dusk', secs: 12, at: 'broadway' },
  { shot: 'tuApolloSweep', place: 'Harlem', title: 'The Apollo Theater on 125th Street at night', secs: 12, at: 'apollo' },
  { shot: 't3Fountain', place: 'Midtown Manhattan', title: 'Bryant Park and the New York Public Library', secs: 12, at: 'bryant' },
];

// SPACE r2: the places of the menu. at: where Walk starts (the nearest point of the crowd's path graph to it) and Drone
// starts (alt m over the ground; drone: its own point), look: what both face, drive: where Drive looks for a lane (default
// at), r: the radius of the disc the visitor may roam (the tiles within the near radius of every point of it are shipped)
export const PLACES = [
  { id: 'lake', name: 'The Lake', at: [-73.97177, 40.77576], look: [-73.9757, 40.7775], drone: [-73.97035, 40.77546], droneLook: [-73.97372, 40.77666], alt: 8, drive: [-73.9765, 40.7764], r: 300 },
  { id: 'terrace', name: 'Bethesda Terrace', at: [-73.97083, 40.7739], look: [-73.97083, 40.77432], drone: [-73.97089, 40.7751], droneLook: [-73.97086, 40.774], alt: 9, drive: [-73.9681, 40.7727], r: 300 },
  { id: 'mall', name: 'The Mall', at: [-73.97235, 40.7704], look: [-73.97175, 40.772], alt: 9, drive: [-73.9688, 40.7697], r: 300 },
  { id: 'columbia', name: 'Columbia University', at: [-73.96208, 40.80738], look: [-73.96205, 40.80862], alt: 12, r: 300 },
  { id: 'riverside', name: 'Riverside Drive Viaduct', at: [-73.96075, 40.81765], look: [-73.96059, 40.81758], drone: [-73.96095, 40.81761], droneLook: [-73.9604, 40.8181], alt: 15, r: 300 },
  { id: 'broadway', name: 'Broadway at 125th Street', at: [-73.9573, 40.8168], look: [-73.9579, 40.8162], alt: 18, r: 300 },
  { id: 'apollo', name: 'The Apollo Theater', at: [-73.95012, 40.80965], look: [-73.95021, 40.80987], alt: 9, r: 300 },
  { id: 'lenox', name: '125th Street at Lenox Avenue', at: [-73.94589, 40.80795], look: [-73.94503, 40.80779], alt: 12, r: 300 },
  { id: 'bryant', name: 'Bryant Park', at: [-73.98418, 40.7541], look: [-73.98375, 40.75384], alt: 12, r: 300 },
];

export function scenes() {
  const shots = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/ad/shots.json'), 'utf8')).shots;
  const out = [];
  for (const { shot: name, place, title, secs, first, time, at } of SCENES) {
    const s = shots[name];
    if (!s) { console.warn('[lite] no shot', name); continue; }
    const placeIdx = PLACES.findIndex((p) => p.id === at);
    if (placeIdx < 0) throw new Error(`[lite] scene ${name}: no place ${at}`);
    const gfx = {};
    const m = /(?:^|&)gfx=([^&]+)/.exec(s.flags || '');
    if (m) for (const kv of m[1].split(',')) { const [k, v] = kv.split(':'); gfx[k] = isNaN(+v) ? v : +v; }
    gfx.motionBlur = 0;   // a 2020 laptop has no frames to spare for it
    out.push({ name, place, title, secs, first: !!first, time: time || s.time || 'golden', fov: s.fov, duration: s.duration || 8,
      ease: s.ease ?? 0.12, abs: !!s.abs, keys: s.keys, gfx, cars: 40, placeIdx });
  }
  return out;
}
export function showcaseJSON() {
  return { secondsPerScene: 12, scenes: scenes(), places: PLACES.map(({ id, name, at, look, drone, droneLook, alt, drive, r }) => ({ id, name, at, look, drone, droneLook, alt, drive, r })) };
}

// world points along a scene's path (the keys and the straight runs between them; Catmull-Rom stays close)
function pathPoints(sc) {
  const pts = sc.keys.map((k) => project(k.p[0], k.p[1]));
  const looks = sc.keys.map((k) => project((k.look || k.p)[0], (k.look || k.p)[1]));
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i], looks[i]);
    if (i + 1 < pts.length) for (let u = 0.25; u < 1; u += 0.25) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]);
  }
  return out;
}

// a tile is shipped when the streamer can ask for it: its centre within the near radius (+0.7 tile, world/streamer.js) of
// a camera path point, or of any point of a place's disc (the disc's radius added)
function selectTiles(scs, manifest) {
  const near = new Set(), far = new Set();
  const pts = scs.flatMap(pathPoints).map(([x, z]) => [x, z, 0]);
  for (const p of PLACES) { const [x, z] = project(p.at[0], p.at[1]); pts.push([x, z, p.r || 300]); }
  for (const [key] of Object.entries(manifest.tiles)) {
    const [tx, tz] = key.split('_').map(Number), cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE;
    if (pts.some(([x, z, r]) => Math.hypot(cx - x, cz - z) < r + LITE.near + TILE * 0.75)) near.add(key);
  }
  for (const [key] of Object.entries(manifest.macros)) {
    const [mx, mz] = key.split('_').map(Number), cx = (mx + 0.5) * MACRO, cz = (mz + 0.5) * MACRO;
    if (pts.some(([x, z, r]) => Math.hypot(cx - x, cz - z) < r + LITE.macro + MACRO * 0.75)) far.add(key);
  }
  return { near, far };
}

const copy = (rel) => {
  const src = path.join(PUB, rel), dst = path.join(OUT, rel);
  if (!fs.existsSync(src)) return 0;
  const st = fs.statSync(src);
  if (st.isDirectory()) return fs.readdirSync(src).reduce((a, f) => a + copy(path.join(rel, f)), 0);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return st.size;
};

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes('--novite')) {
    execFileSync('npx', ['vite', 'build', '--config', path.join(REPO, 'tools/lite/vite.lite.config.mjs'), '--outDir', OUT, '--emptyOutDir'],
      { cwd: SRC, stdio: 'inherit' });
  }
  const sj = showcaseJSON(), scs = sj.scenes;
  fs.writeFileSync(path.join(OUT, 'showcase.json'), JSON.stringify(sj));
  const BASE = arg('content') && path.resolve(arg('content'));
  if (BASE) {
    const cp = (rel) => {
      const s = path.join(BASE, rel), d = path.join(OUT, rel);
      if (fs.statSync(s).isDirectory()) { for (const f of fs.readdirSync(s)) cp(path.join(rel, f)); return; }
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    };
    for (const f of fs.readdirSync(BASE)) if (!['assets', 'index.html', 'showcase.json', 'sizes.json', 'README.md'].includes(f)) cp(f);
  }
  const manifest = BASE ? null : JSON.parse(fs.readFileSync(path.join(PUB, 'tiles/manifest.json'), 'utf8'));
  if (!BASE) copyContent(scs, manifest);
  if (!fs.existsSync(path.join(OUT, 'tiles/overlays'))) overlays(BASE || PUB);
  writeIndex();
  if (!BASE) {
    // the loading screen's backdrop: a frame of the live demo (the trace's first scene), small and blurred
    const poster = path.join(DIR, 'trace_shots', '01.jpg');
    if (fs.existsSync(poster)) execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(poster)}).convert('RGB'); im.thumbnail((960,540)); im.save(${JSON.stringify(path.join(OUT, 'poster.jpg'))}, quality=70)`]);
    const trailer = arg('trailer');
    if (trailer && fs.existsSync(trailer)) fs.copyFileSync(trailer, path.join(OUT, 'trailer.mp4'));
  }
  fs.writeFileSync(path.join(OUT, 'README.md'), SPACE_README);
  if (BASE) console.log(`[lite] ${scs.length} scenes, ${PLACES.length} places; the content of ${BASE}`);
}
// the tile set's baked overlays (shared/overlay.js: LF39, GF38) where the page asks first, <tiles>/overlays/: the set's own
// when it has them, else the copies under data/ (the page's second try), so no request of the boot answers 404
function overlays(root) {
  const put = (src, rel) => { const d = path.join(OUT, 'tiles/overlays', rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(src, d); };
  const walk = (dir, rel) => { for (const f of fs.readdirSync(dir)) { const s = path.join(dir, f); if (fs.statSync(s).isDirectory()) walk(s, path.join(rel, f)); else put(s, path.join(rel, f)); } };
  const own = path.join(root, 'tiles/overlays');
  if (fs.existsSync(own)) { walk(own, ''); return; }
  const lf = path.join(root, 'data/lf39/lf39.json'), gf = path.join(root, 'data/gf38');
  if (fs.existsSync(lf)) put(lf, 'lf39.json');
  if (fs.existsSync(gf)) walk(gf, 'gf38');
  // (the build's own copies under data/ are then never asked for)
  for (const d of ['data/lf39', 'data/gf38']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
}
function copyContent(scs, manifest) {
  const { near, far } = selectTiles(scs, manifest);
  const fm = { ...manifest, tiles: {}, macros: {} };
  let bytes = { tiles: 0, far: 0, shared: 0, traced: 0 };
  for (const k of near) { fm.tiles[k] = manifest.tiles[k]; bytes.tiles += copy(path.join('tiles', manifest.tiles[k].f)); }
  for (const k of far) { fm.macros[k] = manifest.macros[k]; bytes.far += copy(path.join('tiles', manifest.macros[k].f)); }
  fs.writeFileSync(path.join(OUT, 'tiles/manifest.json'), JSON.stringify(fm));
  for (const f of fs.readdirSync(path.join(PUB, 'tiles'))) if (f.endsWith('.json') && f !== 'manifest.json') bytes.shared += copy(path.join('tiles', f));
  for (const d of ['data', 'settings', 'luts', 'basis', 'fonts/ui']) bytes.shared += copy(d);
  if (ASSETS) {
    for (const rel of fs.readFileSync(ASSETS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (rel.startsWith('tiles/') || rel.startsWith('assets/') || fs.existsSync(path.join(OUT, rel))) continue;
      bytes.traced += copy(rel);
    }
  }
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  console.log(`[lite] ${scs.length} scenes, ${PLACES.length} places; near tiles ${near.size} (${mb(bytes.tiles)}), far tiles ${far.size} (${mb(bytes.far)}), shared ${mb(bytes.shared)}, traced assets ${mb(bytes.traced)}`);
}
function writeIndex() {
  // light settings: the URL gets them before main.js runs, so every module (each reads location.search) sees them
  const ix = path.join(OUT, 'index.html');
  let html = fs.readFileSync(ix, 'utf8');
  const boot = `<script>(function(){var q=new URLSearchParams(location.search);var d=new URLSearchParams(${JSON.stringify(QUERY)});` +
    `d.forEach(function(v,k){if(!q.has(k))q.set(k,v);});var s=q.toString();if(s!==location.search.slice(1))history.replaceState(null,'','?'+s);})();</script>`;
  html = html.replace('<head>', '<head>' + boot);
  html = html.replace(/<title>[^<]*<\/title>/, '<title>Valdrada: New York City, live in your browser</title>' +
    '<meta name="description" content="A real-time digital twin of New York City built from public data, rendered live with three.js: tour Central Park, Harlem\'s 125th Street, Columbia and Midtown, then walk, fly a drone or drive.">');
  // the app starts only when the live view is wanted (phones and browsers without WebGL2 get the trailer, not 100 MB)
  const entry = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
  if (!entry) throw new Error('no module entry in index.html');
  html = html.replace(entry[0], '').replace(/<link rel="modulepreload"[^>]*>/g, '');
  html = html.replace('</body>', LOADER.replace('__FIRSTBYTES__', String(Math.round(Number(arg('firstmb', '320')) * 1048576))) + `<script type="module">if (!window.__VALDRADA_NOLIVE) import('${entry[1]}');</script></body>`);
  fs.writeFileSync(ix, html);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
