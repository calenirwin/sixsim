// LITE15 (owner 2026-10-10): the light showcase. The trailer's camera moves played live in the browser, slowed down, in a
// random order, with a fade and a title card between scenes, a gentle parallax that follows the pointer, a next-scene
// button and a resolution governor for weak graphics cards. Scenes come from showcase.json (tools/lite/build_lite.mjs
// writes it from tools/ad/shots.json). Enabled by ?showcase=1 (main.js puts the path camera in charge).
import { GFX } from '../world/weather.js';

const CSS = `
#sc-fade{position:fixed;inset:0;background:#05070a;opacity:1;transition:opacity .9s ease;pointer-events:none;z-index:20}
#sc-grad{position:fixed;left:0;right:0;bottom:0;height:34vh;z-index:19;pointer-events:none;background:linear-gradient(to top,rgba(0,0,0,.5),rgba(0,0,0,0))}
#sc-prog{position:fixed;left:0;bottom:0;height:2px;width:0;z-index:22;background:rgba(255,255,255,.75);pointer-events:none}
#sc-card .c{font-weight:500;font-size:12px;letter-spacing:.18em;opacity:.7;margin-bottom:8px}
#sc-brand .live{display:inline-block;vertical-align:middle;margin-left:10px;font:600 10px Inter,system-ui,sans-serif;letter-spacing:.14em;padding:3px 7px 3px 16px;border:1px solid rgba(255,255,255,.45);border-radius:999px;position:relative}
#sc-brand .live:before{content:'';position:absolute;left:6px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:#ff4d4d;animation:scp 1.6s ease-in-out infinite}
@keyframes scp{50%{opacity:.25}}
#sc-card{position:fixed;left:5vw;bottom:7vh;z-index:21;color:#fff;font-family:Inter,system-ui,sans-serif;
  text-shadow:0 1px 12px rgba(0,0,0,.55);opacity:0;transform:translateY(6px);transition:opacity .8s ease,transform .8s ease;
  border-left:2px solid rgba(255,255,255,.8);padding-left:16px;max-width:min(640px,80vw);pointer-events:none}
#sc-card.on{opacity:1;transform:none}
#sc-card .p{font-weight:600;font-size:clamp(20px,2.6vw,34px);letter-spacing:-.01em}
#sc-card .t{font-weight:400;font-size:clamp(14px,1.45vw,19px);opacity:.88;margin-top:6px;line-height:1.35}
#sc-brand{position:fixed;left:5vw;top:5vh;z-index:21;color:#fff;font-family:Inter,system-ui,sans-serif;pointer-events:none;
  text-shadow:0 1px 10px rgba(0,0,0,.5)}
#sc-brand .n{font-weight:700;font-size:clamp(18px,2vw,26px);letter-spacing:-.02em}
#sc-brand .s{font-weight:400;font-size:clamp(12px,1.1vw,15px);opacity:.85;margin-top:3px}
#sc-bar{position:fixed;right:4vw;bottom:6vh;z-index:22;display:flex;gap:10px;font-family:Inter,system-ui,sans-serif}
#sc-bar button,#sc-bar a{background:rgba(10,14,20,.55);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:999px;
  padding:10px 18px;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none;backdrop-filter:blur(6px)}
#sc-bar button:hover,#sc-bar a:hover{background:rgba(255,255,255,.18)}
#sc-hint{position:fixed;left:50%;bottom:2.5vh;transform:translateX(-50%);z-index:22;color:#fff;font:400 13px Inter,system-ui,sans-serif;opacity:0;transition:opacity .6s;text-shadow:0 1px 8px rgba(0,0,0,.6);pointer-events:none;white-space:nowrap}
#sc-hint.on{opacity:.9}
#sc-load{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:21;color:#fff;font-family:Inter,system-ui,sans-serif;
  text-align:center;pointer-events:none;transition:opacity .6s ease}
#sc-load .p{font-weight:600;font-size:clamp(22px,3vw,40px);letter-spacing:-.01em}
#sc-load .t{font-size:clamp(14px,1.4vw,18px);opacity:.8;margin-top:8px}
#sc-load .d{margin:18px auto 0;width:140px;height:3px;background:rgba(255,255,255,.18);border-radius:3px;overflow:hidden}
#sc-load .d i{display:block;height:100%;width:30%;background:#fff;border-radius:3px;animation:scl 1.2s ease-in-out infinite}
@keyframes scl{0%{transform:translateX(-110%)}100%{transform:translateX(370%)}}
`;

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

export function startShowcase({ engine, streamer, sky, controller, traffic, Q }) {
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style);
  for (const id of ['hud', 'loading']) { const h = document.getElementById(id); if (h) h.style.display = 'none'; }
  const vload = document.getElementById('vload');   // the light build's loading screen (tools/lite/build_lite.mjs)
  window.__SC = { progress: 0.6, phase: 'scenes', shown: false };
  const fade = el('div', { id: 'sc-fade' });
  const load = el('div', { id: 'sc-load' }, '<div class="p"></div><div class="t"></div><div class="d"><i></i></div>');
  const card = el('div', { id: 'sc-card' }, '<div class="c"></div><div class="p"></div><div class="t"></div>');
  const grad = el('div', { id: 'sc-grad' }), prog = el('div', { id: 'sc-prog' });
  const brand = el('div', { id: 'sc-brand' }, '<div class="n">Valdrada<span class="live">LIVE</span></div><div class="s">New York City, rendered in real time in your browser</div>');
  const bar = el('div', { id: 'sc-bar' });
  const take = el('button', { type: 'button', 'aria-label': 'Explore this place yourself' }, 'Explore');
  const next = el('button', { type: 'button', 'aria-label': 'Next scene' }, 'Next scene ›');
  const repo = el('a', { href: 'https://github.com/mkturkcan/valdrada', target: '_blank', rel: 'noopener' }, 'GitHub');
  bar.append(take, next, repo);
  const hint = el('div', { id: 'sc-hint' }, 'Drag to look around · W A S D or arrow keys to move · scroll to fly forward · the tour resumes when you stop');
  document.body.append(hint);
  document.body.append(grad, prog, fade, load, card, brand, bar);

  const S = {
    scenes: [], order: [], cur: null, state: 'boot', t: 0, wait: 0,
    secs: Number(Q.get('scsecs')) || 12, fadeS: 0.9,
    hover: { x: 0, y: 0, tx: 0, ty: 0 },
    fps: [], prMax: engine.renderer.getPixelRatio(), prMin: 0.55, govT: 0,
  };
  fetch('showcase.json').then((r) => r.json()).then((j) => {
    S.scenes = j.scenes || [];
    if (j.secondsPerScene && !Q.get('scsecs')) S.secs = j.secondsPerScene;
    begin(S.scenes.findIndex((s) => s.first) >= 0 ? S.scenes.findIndex((s) => s.first) : 0);
  }).catch((e) => { console.warn('[showcase] no showcase.json', e); });

  const pickNext = () => {
    if (!Q.has('scrandom')) return (S.cur + 1) % S.scenes.length;   // the standard route: the curated order
    if (!S.order.length) {
      S.order = S.scenes.map((_, i) => i).filter((i) => i !== S.cur);
      for (let i = S.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.order[i], S.order[j]] = [S.order[j], S.order[i]]; }
    }
    return S.order.shift();
  };
  function begin(i) {
    const sc = S.scenes[i]; if (!sc) return;
    S.cur = i; S.state = 'loading'; S.wait = 0;
    fade.style.opacity = '1'; card.classList.remove('on');
    load.style.opacity = '1';
    load.querySelector('.p').textContent = sc.place; load.querySelector('.t').textContent = sc.title;
    card.querySelector('.p').textContent = sc.place; card.querySelector('.t').textContent = sc.title;
    card.querySelector('.c').textContent = String(i + 1).padStart(2, '0') + ' / ' + String(S.scenes.length).padStart(2, '0');
    if (sc.time && sky.mode !== sc.time) sky.apply(sc.time);
    if (sc.gfx) for (const [k, v] of Object.entries(sc.gfx)) if (k in GFX) GFX[k] = v;
    controller.setPath({ duration: sc.duration, ease: sc.ease ?? 0.12, abs: !!sc.abs, fov: sc.fov, keys: sc.keys });
    controller.speed = sc.duration / (sc.secs || S.secs);
    controller.hold = true;
    engine.resetTemporal?.();
  }
  function advance() {
    if (S.state === 'play' || S.state === 'fadein') { S.state = 'fadeout'; S.t = 0; fade.style.opacity = '1'; card.classList.remove('on'); }
  }
  next.addEventListener('click', () => { if (S.user) endUser(); advance(); });
  const U = { keys: {}, drag: null, idle: 0, anchor: null };
  function startUser() {
    if (S.state !== 'play' && S.state !== 'fadein') return;
    if (!S.user) {
      S.user = true; S.state = 'user'; U.idle = 0;
      U.anchor = controller.pos.clone(); U.path = controller.path; controller.path = null;   // the path camera just holds the pose
      controller.yaw += controller.hoverYaw || 0; controller.pitch += controller.hoverPitch || 0;
      card.classList.remove('on'); hint.classList.add('on'); take.textContent = 'Resume tour';
    }
    U.idle = 0;
  }
  function endUser() {
    if (!S.user) return;
    S.user = false; hint.classList.remove('on'); take.textContent = 'Explore';
    S.state = 'fadeout'; S.t = 0; fade.style.opacity = '1';
  }
  take.addEventListener('click', () => (S.user ? endUser() : startUser()));
  const cv = engine.renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { U.drag = { x: e.clientX, y: e.clientY }; startUser(); });
  addEventListener('pointerup', () => { U.drag = null; });
  addEventListener('pointermove', (e) => {
    if (!S.user || !U.drag) return;
    controller.yaw -= (e.clientX - U.drag.x) * 0.0035; controller.pitch -= (e.clientY - U.drag.y) * 0.0035;
    controller.pitch = Math.max(-1.3, Math.min(1.3, controller.pitch)); U.drag = { x: e.clientX, y: e.clientY }; U.idle = 0;
  });
  addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE'].includes(e.code)) { U.keys[e.code] = true; startUser(); }
    if (e.code === 'Escape') endUser();
  });
  addEventListener('keyup', (e) => { U.keys[e.code] = false; });
  cv.addEventListener('wheel', (e) => { startUser(); U.wheel = (U.wheel || 0) - Math.sign(e.deltaY) * 6; e.preventDefault(); }, { passive: false });
  function userStep(dt) {
    U.idle += dt;
    const k = U.keys, f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    if (k.ArrowLeft) controller.yaw += dt * 1.2; if (k.ArrowRight) controller.yaw -= dt * 1.2;
    const v = 14 * dt, cy = Math.cos(controller.yaw), sy = Math.sin(controller.yaw), cp = Math.cos(controller.pitch), sp = Math.sin(controller.pitch);
    const fw = f * v + (U.wheel || 0) * dt * 2; U.wheel = (U.wheel || 0) * Math.exp(-dt * 4);
    if (f || r || Math.abs(U.wheel) > 0.01) U.idle = 0;
    const P = controller.pos;
    P.x += -sy * cp * fw + cy * r * v; P.z += -cy * cp * fw - sy * r * v; P.y += sp * fw + ((k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0)) * v;
    // stay where the city is loaded: within 260 m of where the visitor took over, above the ground, under 320 m
    const dx = P.x - U.anchor.x, dz = P.z - U.anchor.z, d = Math.hypot(dx, dz);
    if (d > 260) { P.x = U.anchor.x + (dx / d) * 260; P.z = U.anchor.z + (dz / d) * 260; }
    const g = streamer.terrainAt(P.x, P.z);
    if (g !== null && Number.isFinite(g) && P.y < g + 1.6) P.y = g + 1.6;
    if (P.y > 320) P.y = 320;
    if (U.idle > 20) endUser();
  }
  addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'ArrowRight') advance(); });
  // the pointer's parallax: up to about 4 degrees of yaw and 2 of pitch, eased; it drifts home when the pointer leaves
  addEventListener('pointermove', (e) => {
    S.hover.tx = -((e.clientX / innerWidth) - 0.5) * 0.14;
    S.hover.ty = -((e.clientY / innerHeight) - 0.5) * 0.07;
  });
  document.addEventListener('pointerleave', () => { S.hover.tx = 0; S.hover.ty = 0; });
  engine.renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    load.style.opacity = '1'; fade.style.opacity = '1';
    load.querySelector('.p').textContent = 'Your graphics card ran out of memory';
    load.querySelector('.t').innerHTML = 'Reload to try a lighter setting. <a style="color:#fff" href="?lite=2">Lighter version</a>';
  });

  // resolution governor: keep weak graphics cards above about 28 fps by lowering the render resolution, and give it back
  // when there is headroom (never above the page's own cap)
  function govern(dt) {
    S.fps.push(dt > 0 ? 1 / dt : 60); if (S.fps.length > 90) S.fps.shift();
    if ((S.govT += dt) < 2 || S.fps.length < 60) return;
    S.govT = 0;
    const avg = S.fps.reduce((a, b) => a + b, 0) / S.fps.length;
    const pr = engine.renderer.getPixelRatio();
    let np = pr;
    if (avg < 28 && pr > S.prMin) np = Math.max(S.prMin, pr * 0.85);
    else if (avg > 52 && pr < S.prMax) np = Math.min(S.prMax, pr * 1.08);
    if (Math.abs(np - pr) > 0.01) { engine.renderer.setPixelRatio(np); dispatchEvent(new Event('resize')); S.fps.length = 0; }
  }

  return {
    step(dt) {
      const H = S.hover, k = 1 - Math.exp(-dt * 2.5);
      H.x += (H.tx - H.x) * k; H.y += (H.ty - H.y) * k;
      controller.hoverYaw = H.x; controller.hoverPitch = H.y;
      if (S.state === 'loading') {
        S.wait += dt;
        const ready = streamer.readyUnder() && streamer.outstanding === 0 && S.wait > 1.2;
        if (!S.compiling && (ready || S.wait > 20)) {
          // every program the view needs is compiled now, behind the black, not as a hitch on screen
          S.compiling = true;
          const done = () => { S.state = 'warm'; S.warm = 0; S.calm = 0; S.compiling = false; };
          const R = engine.renderer;
          // three.js's compileAsync can stall on a material it never prepared: never wait more than 4 s for it
          let comp;
          try { comp = R.compileAsync ? R.compileAsync(engine.scene, engine.camera) : Promise.resolve(R.compile(engine.scene, engine.camera)); } catch (e) { comp = Promise.resolve(); }
          Promise.race([Promise.resolve(comp).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]).then(done, done);
        }
        if (!S.shown) window.__SC.progress = Math.min(0.9, 0.6 + 0.3 * Math.min(1, S.wait / 12));
      } else if (S.state === 'warm') {
        // a few frames drawn behind the black (post passes, shadow maps, texture uploads) until frame times settle
        S.warm += dt; S.calm = dt < 1 / 24 ? S.calm + 1 : 0;
        if (!S.shown) window.__SC.progress = Math.min(0.99, 0.9 + 0.09 * Math.min(1, S.warm / 2));
        if ((S.calm > 20 && S.warm > 0.8) || S.warm > 6) {
          S.state = 'fadein'; S.t = 0; controller.hold = false;
          load.style.opacity = '0'; fade.style.opacity = '0';
          if (!S.shown) { S.shown = true; window.__SC.progress = 1; window.__SC.shown = true; load.style.display = 'none';
            if (vload) { vload.style.opacity = '0'; setTimeout(() => vload.remove(), 1200); } }
          setTimeout(() => card.classList.add('on'), 500);
        }
      } else if (S.state === 'fadein' || S.state === 'play') {
        S.state = 'play';
        govern(dt);
        const sc = S.scenes[S.cur];
        const left = sc.duration - controller.t;   // path time left
        prog.style.width = (100 * Math.min(1, controller.t / sc.duration)).toFixed(2) + '%';
        if (left / Math.max(1e-3, controller.speed) < S.fadeS + 0.15) advance();
        if (traffic && sc.cars !== undefined) traffic.target = sc.cars;
      } else if (S.state === 'user') {
        userStep(dt); govern(dt);
      } else if (S.state === 'fadeout') {
        S.t += dt;
        if (S.t > S.fadeS) begin(pickNext());
      }
    },
  };
}
