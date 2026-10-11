// LITE15 (owner 2026-10-10): the light showcase for the Hugging Face Space, built for 2020-era PCs.
//   node tools/lite/build_lite.mjs --out <dir> [--assets <trace.txt>] [--novite]
// 1. showcase.json: the scenes (trailer camera moves from tools/ad/shots.json, slowed, with plain titles)
// 2. the client built by Vite without its public folder (index.html opens the showcase with the light settings)
// 3. only the tiles each scene can see: near tiles within the light near radius of its camera path, far tiles within the
//    light far radius; tiles/manifest.json filtered to them, so nothing outside is ever requested
// 4. small shared folders (data, settings, luts, basis, the Inter faces), and every other asset the trace saw requested
//    (tools/lite/trace_lite.mjs writes the list)
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

// the loading screen (#vload): the wordmark over a blurred frame of the demo, a progress bar fed by the boot timeline
// (window.__BOOT) and the showcase (window.__SC), held until the first scene's programs are compiled and its frames warm.
// Phones and browsers without WebGL2 get the trailer instead, with the live view one tap away.
const LOADER = `
<style>
#vload{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;
  font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#05070b;transition:opacity 1.1s ease}
#vload .bg{position:absolute;inset:-40px;background:url(poster.jpg) center/cover;filter:blur(18px) brightness(.42) saturate(1.1);transform:scale(1.04)}
#vload .in{position:relative;text-align:center;padding:0 24px}
#vload .w{font-weight:700;font-size:clamp(34px,6vw,72px);letter-spacing:.18em;margin-right:-.18em}
#vload .s{font-weight:400;font-size:clamp(14px,1.6vw,19px);opacity:.86;margin-top:10px;letter-spacing:.02em}
#vload .b{width:min(360px,70vw);height:3px;background:rgba(255,255,255,.16);border-radius:3px;margin:34px auto 12px;overflow:hidden}
#vload .b i{display:block;height:100%;width:0;background:#fff;border-radius:3px;transition:width .4s ease}
#vload .st{font-size:13px;opacity:.72;letter-spacing:.04em;min-height:18px}
#vload .f{position:absolute;bottom:4vh;left:0;right:0;text-align:center;font-size:12px;opacity:.6;letter-spacing:.05em}
#vload video{width:min(960px,92vw);border-radius:10px;margin-top:22px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#vload button{margin-top:16px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:999px;padding:10px 20px;font:500 15px Inter,system-ui,sans-serif;cursor:pointer}
</style>
<div id="vload"><div class="bg"></div><div class="in"><div class="w">VALDRADA</div><div class="s">New York City, live in your browser</div>
<div class="b"><i></i></div><div class="st">Starting</div></div>
<div class="f">A real-time digital twin built from public data · rendered with three.js</div></div>
<script>(function(){
var L=document.getElementById('vload'),bar=L.querySelector('.b i'),st=L.querySelector('.st');
var gl=null;try{gl=document.createElement('canvas').getContext('webgl2');}catch(e){}
var phone=matchMedia('(pointer:coarse)').matches&&Math.min(screen.width,screen.height)<820;
if((!gl||phone)&&!/[?&]live=1/.test(location.search)){
  window.__VALDRADA_NOLIVE=true;
  L.querySelector('.in').innerHTML='<div class="w">VALDRADA</div><div class="s">'+(gl?'The live 3D city is built for computers. Here is the trailer.':'Your browser cannot run the live 3D city. Here is the trailer.')+'</div>'+
   '<video src="trailer.mp4" controls autoplay muted playsinline loop poster="poster.jpg"></video>'+(gl?'<div><button id="vlive">Open the live city anyway</button></div>':'');
  var b=document.getElementById('vlive');if(b)b.onclick=function(){location.search+=(location.search?'&':'?')+'live=1';};
  return;}
var S={'tile manifest':[.06,'Reading the city'],'tile assembly open':[.1,'Streaming the city'],'landmarks module':[.16,'Placing landmarks'],
 'fleet24 loaded':[.3,'Loading vehicles'],'crowd loaded':[.44,'Loading people'],'sims':[.5,'Starting traffic'],'frame loop':[.56,'Building streets'],'near ring ready':[.6,'Building streets']};
var shown=0;function tick(){var p=.02,l='Starting',B=window.__BOOT||[];
 for(var i=0;i<B.length;i++){var e=S[B[i][1]];if(e&&e[0]>p){p=e[0];l=e[1];}}
 var C=window.__SC;if(C){if(C.progress>p){p=C.progress;l=p<.9?'Streaming the first scene':'Compiling shaders';}if(C.shown)p=1;}
 shown+=(p-shown)*.25;bar.style.width=(shown*100).toFixed(1)+'%';st.textContent=l+' · '+Math.round(shown*100)+'%';
 if(!(C&&C.shown))setTimeout(tick,150);}
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
Park, Harlem's 125th Street, Columbia University and Midtown; press **Explore** (or drag, or use W A S D) to take control.

This is the light edition, sized for ordinary computers. The full city, the simulator and its Python API:
<https://github.com/mkturkcan/valdrada>.
`;
export const LITE = { near: 640, macro: 5000 };
// the light settings every visitor gets (index.html puts them in the URL before any module loads)
// one walker set (rb27=0) and a light, New York fleet (about 20 MB of models instead of 130)
const FLEET = 'taxinv200,nypd,cargovan,stepvan,uspsllv,mtaxd40,mustang,auditt,impala,boxtruck26,schoolbus,foodtruck';
export const QUERY = `showcase=1&hud=0&gi=0&probe=0&nocascade2=1&pr=1&sm=2048&near=${LITE.near}&macro=${LITE.macro}&pedtarget=160&fall=0&rb27=0&f24only=${FLEET}`;

// place, title, seconds on screen; the first one opens the page
const SCENES = [
  ['scLakeGolden', 'Central Park', 'The Lake and Bow Bridge at golden hour', 13, true],
  ['scBowGolden', 'Central Park', 'Bow Bridge', 12],
  ['scTerraceGolden', 'Central Park', 'Bethesda Terrace', 12],
  ['t4Angel', 'Central Park', 'Bethesda Fountain and the Angel of the Waters', 12],
  ['t7Mall', 'Central Park', 'The Mall under its elms', 12],
  ['fColumbia', 'Columbia University', 'College Walk to Low Library', 14],
  ['t7ArchTrack', 'Harlem', 'The Riverside Drive Viaduct at 125th Street', 12],
  ['t7ValleyTrain', 'Harlem', 'The 1 train on the Manhattan Valley Viaduct', 12],
  ['tuValleyTrainDusk', 'Harlem', 'The viaduct at dusk', 12],
  ['tuApolloSweep', 'Harlem', 'The Apollo Theater on 125th Street at night', 12],
  ['t3Fountain', 'Midtown Manhattan', 'Bryant Park and the New York Public Library', 12],
];

function scenes() {
  const shots = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/ad/shots.json'), 'utf8')).shots;
  const out = [];
  for (const [name, place, title, secs, first] of SCENES) {
    const s = shots[name];
    if (!s) { console.warn('[lite] no shot', name); continue; }
    const gfx = {};
    const m = /(?:^|&)gfx=([^&]+)/.exec(s.flags || '');
    if (m) for (const kv of m[1].split(',')) { const [k, v] = kv.split(':'); gfx[k] = isNaN(+v) ? v : +v; }
    gfx.motionBlur = 0;   // a 2020 laptop has no frames to spare for it
    out.push({ name, place, title, secs, first: !!first, time: s.time || 'golden', fov: s.fov, duration: s.duration || 8,
      ease: s.ease ?? 0.12, abs: !!s.abs, keys: s.keys, gfx, cars: 40 });
  }
  return out;
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

function selectTiles(scs, manifest) {
  const near = new Set(), far = new Set();
  const pts = scs.flatMap(pathPoints);
  for (const [key] of Object.entries(manifest.tiles)) {
    const [tx, tz] = key.split('_').map(Number), cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE;
    if (pts.some(([x, z]) => Math.hypot(cx - x, cz - z) < LITE.near + TILE * 0.75)) near.add(key);
  }
  for (const [key] of Object.entries(manifest.macros)) {
    const [mx, mz] = key.split('_').map(Number), cx = (mx + 0.5) * MACRO, cz = (mz + 0.5) * MACRO;
    if (pts.some(([x, z]) => Math.hypot(cx - x, cz - z) < LITE.macro + MACRO * 0.75)) far.add(key);
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
  const scs = scenes();
  fs.writeFileSync(path.join(OUT, 'showcase.json'), JSON.stringify({ secondsPerScene: 12, scenes: scs }));
  const manifest = JSON.parse(fs.readFileSync(path.join(PUB, 'tiles/manifest.json'), 'utf8'));
  const { near, far } = selectTiles(scs, manifest);
  const fm = { ...manifest, tiles: {}, macros: {} };
  let bytes = { tiles: 0, far: 0, shared: 0, traced: 0 };
  for (const k of near) { fm.tiles[k] = manifest.tiles[k]; bytes.tiles += copy(path.join('tiles', manifest.tiles[k].f)); }
  for (const k of far) { fm.macros[k] = manifest.macros[k]; bytes.far += copy(path.join('tiles', manifest.macros[k].f)); }
  fs.writeFileSync(path.join(OUT, 'tiles/manifest.json'), JSON.stringify(fm));
  for (const f of fs.readdirSync(path.join(PUB, 'tiles'))) if (f.endsWith('.json') && f !== 'manifest.json') bytes.shared += copy(path.join('tiles', f));
  for (const d of ['data', 'settings', 'luts', 'basis']) bytes.shared += copy(d);
  for (const f of ['Inter-400.ttf', 'Inter-500.ttf', 'Inter-600.ttf', 'Inter-700.ttf', 'OFL.txt']) bytes.shared += copy(path.join('fonts', f));
  if (ASSETS) {
    for (const rel of fs.readFileSync(ASSETS, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (rel.startsWith('tiles/') || rel.startsWith('assets/') || fs.existsSync(path.join(OUT, rel))) continue;
      bytes.traced += copy(rel);
    }
  }
  // light settings: the URL gets them before main.js runs, so every module (each reads location.search) sees them
  const ix = path.join(OUT, 'index.html');
  let html = fs.readFileSync(ix, 'utf8');
  const boot = `<script>(function(){var q=new URLSearchParams(location.search);var d=new URLSearchParams(${JSON.stringify(QUERY)});` +
    `d.forEach(function(v,k){if(!q.has(k))q.set(k,v);});var s=q.toString();if(s!==location.search.slice(1))history.replaceState(null,'','?'+s);})();</script>`;
  html = html.replace('<head>', '<head>' + boot);
  html = html.replace(/<title>[^<]*<\/title>/, '<title>Valdrada · New York City, live in your browser</title>' +
    '<meta name="description" content="A real-time digital twin of New York City built from public data: Central Park, Harlem\'s 125th Street, Columbia and Midtown, rendered live with three.js.">');
  // the app starts only when the live view is wanted (phones and browsers without WebGL2 get the trailer, not 100 MB)
  const entry = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
  if (!entry) throw new Error('no module entry in index.html');
  html = html.replace(entry[0], '').replace(/<link rel="modulepreload"[^>]*>/g, '');
  html = html.replace('</body>', LOADER + `<script type="module">if (!window.__VALDRADA_NOLIVE) import('${entry[1]}');</script></body>`);
  fs.writeFileSync(ix, html);
  // the loading screen's backdrop: a frame of the live demo (the trace's first scene), small and blurred
  const poster = path.join(DIR, 'trace_shots', '01.jpg');
  if (fs.existsSync(poster)) execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(poster)}).convert('RGB'); im.thumbnail((960,540)); im.save(${JSON.stringify(path.join(OUT, 'poster.jpg'))}, quality=70)`]);
  const trailer = arg('trailer');
  if (trailer && fs.existsSync(trailer)) fs.copyFileSync(trailer, path.join(OUT, 'trailer.mp4'));
  fs.writeFileSync(path.join(OUT, 'README.md'), SPACE_README);
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  console.log(`[lite] ${scs.length} scenes; near tiles ${near.size} (${mb(bytes.tiles)}), far tiles ${far.size} (${mb(bytes.far)}), shared ${mb(bytes.shared)}, traced assets ${mb(bytes.traced)}`);
}
main();
