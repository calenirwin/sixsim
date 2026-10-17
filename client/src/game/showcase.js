// LITE15 (owner 2026-10-10): the light showcase. The trailer's camera moves played live in the browser, slowed down, in
// the curated order, with a fade and a caption between scenes, a gentle parallax that follows the pointer and a
// resolution governor for weak graphics cards. Scenes and places come from showcase.json (tools/lite/build_lite.mjs
// writes it from tools/ad/shots.json). Enabled by ?showcase=1 (main.js puts the path camera in charge).
//
// SPACE r2 (owner 2026-10-11, docs/notes/space-r2.md): exploration. A menu (Esc, the Menu button or a
// gamepad's Start) over a darkened, blurred frame sets the mode (Tour, Walk, Drone, Drive), the place, the time of day
// and the quality. Walk and Drive are the play controller (game/control.js PlayController: a crowd walker, a fleet car);
// Drone is game/drone.js. A mode starts behind the black like a tour scene: the city streams in around the place, the
// body spawns on a path or a lane, the new programs compile, then the frame fades in with a short controls legend.
// The player stays inside the shipped area: one disc per place, with a soft push back at the edge. Input (keyboard,
// pointer lock or drag, wheel, gamepad) is read here and handed to the active controller; main.js asks `controller`.
import * as THREE from 'three';
import { GFX } from '../world/weather.js';
import { project } from '../shared/geo.js';
import { PlayController, makeProbe, lanePoseNear, setGhosts } from './control.js';
import { DroneController } from './drone.js';
import { createUI } from './showcaseUI.js';
import { compileSafe } from '../core/compileSafe.js';
import { COLLIDERS } from '../city/colliders.js';
import { LOWMEM } from '../world/cpuFree.js';

const MODES = [['tour', 'Tour'], ['walk', 'Walk'], ['drone', 'Drone'], ['drive', 'Drive']];
const TIMES = [['day', 'Morning'], ['golden', 'Golden hour'], ['night', 'Night']];
const QUALITIES = [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
// run-time quality: render scale, ambient occlusion (GTAO and the contact pass), the near shadow map, god rays, traffic
const QUALITY = {
  low: { pr: 0.7, ao: false, cao: false, sm: 1024, godrays: 0, cars: 24 },
  medium: { pr: 0.9, ao: true, cao: false, sm: 2048, godrays: 0.5, cars: 40 },
  high: { pr: 1.5, ao: true, cao: true, sm: 4096, godrays: 0.5, cars: 48 },
  auto: { pr: 1, ao: true, cao: true, sm: 2048, godrays: 0.5, cars: 40 },
};
const WALK = 1.45, RUN = 2.55;   // game/control.js
const PLAYER_CAR = 'taxinv200';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const store = {
  get(k) { try { return localStorage.getItem('valdrada.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('valdrada.' + k, v); } catch { /* private window */ } },
};

export function startShowcase({ engine, streamer, sky, controller, traffic, peds, Q }) {
  for (const id of ['hud', 'loading']) { const h = document.getElementById(id); if (h) h.style.display = 'none'; }
  const vload = document.getElementById('vload');   // the light build's loading screen (tools/lite/build_lite.mjs)
  window.__SC = { progress: 0.6, phase: 'scenes', shown: false };
  const FOV0 = engine.camera.fov;
  const cv = engine.renderer.domElement;

  const S = {
    scenes: [], places: [], cur: null, state: 'boot', t: 0, wait: 0, mode: 'tour', place: 0, time: null,
    quality: QUALITY[store.get('quality')] ? store.get('quality') : 'auto',
    secs: Number(Q.get('scsecs')) || 12, fadeS: 0.8,
    hover: { x: 0, y: 0, tx: 0, ty: 0 },
    fps: [], prMax: 1, prMin: 0.55, govT: 0,
    legendDue: false, drive: true,
  };

  // ---- the interface
  const ui = createUI({
    modes: MODES, places: [], times: TIMES, qualities: QUALITIES,
    timeLabels: { dusk: 'Dusk' },
    drive: () => S.drive,
    aboutHTML: '<p>Valdrada is a real-time digital twin of New York City, built from public data and rendered in your browser with three.js.</p>' +
      '<p><a href="https://github.com/mkturkcan/valdrada" target="_blank" rel="noopener">github.com/mkturkcan/valdrada</a></p>' +
      '<p class="sm">Map data from OpenStreetMap contributors (ODbL) and NYC Open Data. Vehicle and pedestrian models from CARLA (CC BY 4.0).</p>',
    onChange: (k, v) => change(k, v),
    onMode: (m) => setMode(m, S.place),
    onNext: () => advance(),
    onOpen: () => { clearKeys(); unlock(); },
    onClose: (resume) => {
      if (resume && S.mode !== 'tour') lock();
      // back from the menu: the controls once more (and the place, the first time)
      if (S.state === 'mplay') { if (S.legendDue) { S.legendDue = false; showLegend(); } else ui.showLegend(S.mode, S.device === 'pad', 6); }
    },
  });
  ui.chrome('none');
  ui.set('quality', S.quality);

  // ---- bodies and controllers
  const probe = makeProbe({ streamer, traffic, peds });
  let pc = null;
  const drone = new DroneController({ engine, probe, bound: (x, z) => bound(x, z), fov0: FOV0 });   // in the scene now: the
  // loader's shader warm-up compiles its materials with everything else
  const hold = { pos: new THREE.Vector3(), update() { engine.camera.position.set(this.pos.x, this.pos.y + 30, this.pos.z); engine.camera.updateMatrixWorld(); return { x: this.pos.x, y: this.pos.y, z: this.pos.z }; } };
  const droneCtl = { update: (dt) => drone.update(dt, droneInput(dt)), speedText: () => drone.speedText() };
  const pcCtl = { update: (dt) => { pc.hold = ui.isOpen || S.state !== 'mplay'; return pc.update(dt); }, speedText: () => pc?.speedText() };
  function makePC() {
    if (pc) return pc;
    pc = new PlayController({ engine, streamer, traffic, peds, sky, flash: () => {}, noDownload: true }, { headless: true, kind: PLAYER_CAR, x: 0, y: 60, z: 0 });
    pc.cam.fov0 = FOV0;
    pc._keysWalk = walkInput;
    pc._keysDrive = driveInput;
    return pc;
  }
  function releaseBodies() {
    drone.show(false);
    if (!pc) return;
    pc.walker?.release(); pc.car?.release();
    pc.walker = null; pc.car = null; pc.started = false; pc.rec = null;
    setGhosts(peds, []);
    if (peds) peds.pl42 = null;
  }

  // ---- places and the playable area (one disc per place)
  let discs = [];
  function bound(x, z) {
    let best = null;
    for (const d of discs) {
      const dx = x - d.x, dz = z - d.z, L = Math.hypot(dx, dz) || 1e-6, over = L - d.r;
      if (!best || over < best.over) best = { over, nx: -dx / L, nz: -dz / L };
    }
    return best && best.over > 0 ? best : null;
  }
  const lookYaw = (x, z, lx, lz) => Math.atan2(-(lx - x), -(lz - z));

  fetch('showcase.json').then((r) => r.json()).then((j) => {
    S.scenes = j.scenes || [];
    S.places = (j.places || []).map((p) => {
      const [x, z] = project(p.at[0], p.at[1]);
      const [lx, lz] = project((p.look || p.at)[0], (p.look || p.at)[1]);
      const drv = p.drive ? project(p.drive[0], p.drive[1]) : [x, z];
      const [ux, uz] = p.drone ? project(p.drone[0], p.drone[1]) : [x, z];
      const [ulx, ulz] = p.droneLook ? project(p.droneLook[0], p.droneLook[1]) : [lx, lz];
      return { ...p, x, z, lx, lz, dx: drv[0], dz: drv[1], ux, uz, uyaw: lookYaw(ux, uz, ulx, ulz) };
    });
    discs = S.places.map((p) => ({ x: p.x, z: p.z, r: p.r || 300 }));
    // SPACE r2 (?lowmem=1, world/cpuFree.js): where a camera of the showcase can ever be (the tour's paths, every 10 m,
    // and the places' discs): city/fk/facadeKit.js leaves out the near detail of a cell no camera comes within its
    // level distance of. reach(x, z, d): one comes within d metres of (x, z)
    if (LOWMEM && Q.get('space2reach') !== '0') {
      const pts = [];
      for (const sc of S.scenes) {
        const K = (sc.keys || []).map((k) => project(k.p[0], k.p[1]));
        for (let i = 0; i < K.length; i++) {
          pts.push(K[i]);
          if (i + 1 >= K.length) continue;
          const [ax, az] = K[i], [bx, bz] = K[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 10);
          for (let t = 1; t < n; t++) pts.push([ax + ((bx - ax) * t) / n, az + ((bz - az) * t) / n]);
        }
      }
      globalThis.__SPACE_REACH = (x, z, d) => discs.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + d) || pts.some(([px, pz]) => Math.hypot(x - px, z - pz) < d);
    }
    ui.setPlaces(S.places.map((p) => p.name));
    if (j.secondsPerScene && !Q.get('scsecs')) S.secs = j.secondsPerScene;
    const first = S.scenes.findIndex((s) => s.first);
    begin(first >= 0 ? first : 0);
  }).catch((e) => { console.warn('[showcase] no showcase.json', e); });

  // ---- the tour
  function begin(i) {
    const sc = S.scenes[i]; if (!sc) return;
    S.mode = 'tour'; S.cur = i; S.state = 'loading'; S.wait = 0; S.compiling = false; S.gen = (S.gen || 0) + 1;
    releaseBodies();
    ui.fade.style.opacity = '1'; ui.card.classList.remove('on'); ui.hideLegend();
    ui.load.style.opacity = '1';
    ui.loading(sc.place, sc.title);
    ui.caption(sc.place, sc.title);
    ui.set('mode', 'tour');
    if (sc.placeIdx !== undefined) { S.place = sc.placeIdx; ui.set('place', S.place); }
    const time = S.time || sc.time;
    if (time && sky.mode !== time) sky.apply(time);
    ui.set('time', sky.mode);
    if (sc.gfx) for (const [k, v] of Object.entries(sc.gfx)) if (k in GFX) GFX[k] = v;
    controller.setPath({ duration: sc.duration, ease: sc.ease ?? 0.12, abs: !!sc.abs, fov: sc.fov, keys: sc.keys });
    controller.speed = sc.duration / (sc.secs || S.secs);
    controller.hold = true;
    engine.resetTemporal?.();
  }
  function advance() {
    if (S.mode !== 'tour') return;
    if (S.state === 'play' || S.state === 'fadein') { S.state = 'fadeout'; S.t = 0; S.next = () => begin((S.cur + 1) % S.scenes.length); ui.fade.style.opacity = '1'; ui.card.classList.remove('on'); }
  }
  // the first scene of a place, or the nearest scene to it
  function sceneFor(pi) {
    let i = S.scenes.findIndex((s) => s.placeIdx === pi);
    if (i < 0) {
      const P = S.places[pi]; let bd = Infinity;
      S.scenes.forEach((s, k) => { const [x, z] = project(s.keys[0].p[0], s.keys[0].p[1]); const d = Math.hypot(x - P.x, z - P.z); if (d < bd) { bd = d; i = k; } });
    }
    return Math.max(0, i);
  }

  // ---- modes
  function setMode(mode, pi = S.place) {
    if (mode === 'drive' && !S.drive) mode = 'walk';
    S.place = pi;
    ui.set('mode', mode); ui.set('place', pi);
    // out through the black, then in: the tour at the place's scene, or a mode at the place
    S.state = 'fadeout'; S.t = 0;
    S.next = () => (mode === 'tour' ? begin(sceneFor(pi)) : beginMode(mode, pi));
    ui.fade.style.opacity = '1'; ui.card.classList.remove('on'); ui.hideLegend();
    ui.chrome(mode === 'tour' ? 'tour' : 'mode');
  }
  function beginMode(mode, pi) {
    const P = S.places[pi]; if (!P) return;
    releaseBodies();
    S.mode = mode; S.place = pi; S.state = 'mload'; S.wait = 0; S.spawned = false; S.compiling = false; S.gen = (S.gen || 0) + 1;
    hold.pos.set(mode === 'drive' ? P.dx : mode === 'drone' ? P.ux : P.x, 0, mode === 'drive' ? P.dz : mode === 'drone' ? P.uz : P.z);
    const g = streamer.terrainAt(hold.pos.x, hold.pos.z); hold.pos.y = g ?? 10;
    ui.loading(P.name, MODES.find((m) => m[0] === mode)[1]);
    ui.load.style.opacity = '1'; ui.fade.style.opacity = '1';
    if (S.time && sky.mode !== S.time) sky.apply(S.time);
    ui.set('time', sky.mode);
    if (traffic) traffic.target = QUALITY[S.quality].cars;
    engine.resetTemporal?.();
  }
  // the nearest point of the crowd's path graph (sidewalks, park paths, promenades) to (x, z) that is not on the
  // carriageway (a crossing's middle is on the graph too: no place to start a walk)
  function pathNear(x, z, maxD = 140) {
    let best = null, bd = maxD * maxD;
    // the street trees' pits on the flags (world/assemble.js data.vgPits: x, y, z, rot, guarded): never a start inside one
    const pits = [];
    for (const t of (streamer.tiles && streamer.tiles.values()) || []) {
      const L = t && t.data && t.data.vgPits;
      if (L) for (let k = 0; k + 2 < L.length; k += 5) if (Math.abs(L[k] - x) < maxD + 5 && Math.abs(L[k + 2] - z) < maxD + 5) pits.push(L[k], L[k + 2]);
    }
    const inPit = (px, pz) => { for (let k = 0; k < pits.length; k += 2) if ((pits[k] - px) ** 2 + (pits[k + 1] - pz) ** 2 < 1.8) return true; return false; };
    for (const e of (peds && peds.walkEdges) || []) {
      if (e.dead || !e.pts) continue;
      const P = e.pts;
      for (let i = 0; i < P.length; i++) {
        const q = P[i], d = (q[0] - x) ** 2 + (q[2] - z) ** 2;
        if (d >= bd) continue;
        const si = streamer.surfaceInfoAt ? streamer.surfaceInfoAt(q[0], q[2], 0.1) : null;
        if (si && si.road) continue;
        if (inPit(q[0], q[2])) continue;
        // the path's direction there (to face along the sidewalk, not across it into the street)
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        bd = d; best = { q, tx: b[0] - a[0], tz: b[2] - a[2] };
      }
    }
    return best;
  }
  function spawn() {
    const P = S.places[S.place], mode = S.mode;
    if (mode === 'drone') {
      const g = drone.floorAt(P.ux, P.uz, null);
      if (g === null) return false;
      drone.spawn(P.ux, g + (P.alt ?? 14), P.uz, P.uyaw, -0.16);
      drone.show(true);
      engine.camera.fov = FOV0; engine.camera.updateProjectionMatrix();
      return true;
    }
    makePC();
    if (mode === 'walk') {
      const n = pathNear(P.x, P.z);
      if (!n && S.wait < 12) return false;
      const q = n && n.q, x = q ? q[0] : P.x, z = q ? q[2] : P.z;
      pc.mode = 'walk'; pc.started = false;
      pc.pos.set(x, (q ? q[1] : 0) + 1, z);
      // facing along the path, the way that is nearer the place's view
      let yaw = lookYaw(x, z, P.lx, P.lz);
      const tl = n ? Math.hypot(n.tx, n.tz) : 0;
      if (tl > 1e-3) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), s = (n.tx * fx + n.tz * fz) >= 0 ? 1 : -1;
        yaw = Math.atan2(-(n.tx * s) / tl, -(n.tz * s) / tl);
      }
      pc.yaw = yaw; pc.cam.yaw = yaw; pc.cam.pitch = -0.1; pc.cam.boom = 3.3; pc.cam.mode = 'third';
      return true;
    }
    // drive: a lane near the place's road, facing the way the place looks if the street runs that way
    if (!traffic || !traffic.edges || traffic.edges.size < 10) return false;
    let lp = null;
    for (const r of [80, 200, 420]) { lp = lanePoseNear(traffic, P.dx, P.dz, r, lookYaw(P.dx, P.dz, P.lx, P.lz) + Math.PI); if (lp) break; }
    if (!lp) return false;
    // the player's car: the taxi, or the first kind whose pool has a free slot
    const pools = traffic.pools || {};
    pc.kind = [PLAYER_CAR, 'impala', 'mustang', 'auditt', 'nypd'].find((k) => pools[k] && pools[k].n < pools[k].cap) || PLAYER_CAR;
    pc.mode = 'drive'; pc.started = false;
    pc.pos.set(lp.x, 0, lp.z); pc.yaw = lp.h + Math.PI; pc.cam.head = lp.h; pc.cam.orbit = 0; pc.cam.mode = 'chase';
    return true;
  }
  function showLegend() {
    ui.showLegend(S.mode, S.device === 'pad', 8);
    ui.showPlace(S.places[S.place]?.name || '', 8);
  }

  // ---- menu changes
  let placeT = 0;
  function change(k, v) {
    if (k === 'mode') setMode(v, S.place);
    else if (k === 'place') {
      // stepping through places with the arrows: act on the last one
      clearTimeout(placeT);
      placeT = setTimeout(() => setMode(S.mode, v), 650);
    } else if (k === 'time') {
      S.time = v;
      if (sky.mode !== v) {
        sky.apply(v);
        compileSafe(engine.renderer, engine.scene, engine.camera, 6000);   // the night's lit programs, behind the menu
      }
    } else if (k === 'quality') { S.quality = v; store.set('quality', v); applyQuality(); }
  }
  function applyQuality() {
    const P = QUALITY[S.quality], R = engine.renderer;
    if (engine.gtao) engine.gtao.enabled = P.ao;
    if (engine.cao) engine.cao.enabled = P.cao;
    GFX.godrays = P.godrays;
    const sh = engine.sun.shadow;
    if (sh.mapSize.x !== P.sm) { sh.mapSize.set(P.sm, P.sm); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    const dpr = window.devicePixelRatio || 1;
    S.prMax = S.quality === 'high' ? Math.max(1, Math.min(dpr, P.pr)) : Math.min(dpr, P.pr);
    if (Math.abs(R.getPixelRatio() - S.prMax) > 0.01) { R.setPixelRatio(S.prMax); dispatchEvent(new Event('resize')); }
    S.fps.length = 0;
    if (traffic && S.mode !== 'tour') traffic.target = P.cars;
  }
  applyQuality();

  // ---- input: keyboard, pointer (lock or drag), wheel, gamepad
  const keys = Object.create(null);
  const clearKeys = () => { for (const k in keys) keys[k] = false; };
  const playing = () => S.mode !== 'tour' && S.state === 'mplay' && !ui.isOpen;
  const NAV = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back' };
  addEventListener('keydown', (e) => {
    S.device = 'keys';
    if (ui.isOpen) {
      const c = NAV[e.code];
      // (the Esc that released the pointer lock and opened the menu may still arrive as a key: it must not close it again)
      if (c === 'back' && e.code === 'Escape' && performance.now() - lockLostAt < 400) { e.preventDefault(); return; }
      if (c) { e.preventDefault(); if (!e.repeat || c !== 'ok') ui.nav(c); }
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); if (performance.now() - lockLostAt > 400) ui.open(); return; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (S.mode === 'tour') { if (!e.repeat && (e.code === 'Space' || e.code === 'ArrowRight')) advance(); return; }
    keys[e.code] = true;
    if (e.repeat || !playing()) return;
    if (e.code === 'KeyV') toggleView();
    if (e.code === 'KeyF') toggleCar();
    if (e.code === 'KeyC' && pc) pc.unstick();
    if (e.code === 'KeyH') ui.showLegend(S.mode, false, 8);
  }, true);
  addEventListener('keyup', (e) => { keys[e.code] = false; }, true);
  addEventListener('blur', clearKeys);
  function toggleView() {
    if (S.mode === 'drone') drone.toggleView();
    else if (pc && pc.started) pc.toggleView();
  }
  function toggleCar() {
    if (!pc || !pc.started || (S.mode !== 'walk' && S.mode !== 'drive') || !S.drive) return;
    pc.toggleCar();
    if (pc.mode !== S.mode) { S.mode = pc.mode; ui.set('mode', S.mode); ui.showLegend(S.mode, S.device === 'pad', 6); }
  }
  // pointer: locked look where the browser allows it, a drag otherwise; leaving the lock opens the menu
  let drag = null, unlocking = false, lockLostAt = -1e9;
  const canLock = () => !!cv.requestPointerLock;
  function lock() {
    if (!canLock() || document.pointerLockElement === cv) return;
    try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed here */ }
  }
  function unlock() { if (document.pointerLockElement) { unlocking = true; document.exitPointerLock(); } }
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) {
      // the browser's own Esc released the lock: that is the visitor asking for the menu
      if (!unlocking && S.mode !== 'tour' && S.state === 'mplay' && !ui.isOpen) { lockLostAt = performance.now(); ui.open(); }
      unlocking = false;
    }
  });
  document.addEventListener('pointerlockerror', () => {});
  const look = (dx, dy) => {
    if (S.mode === 'drone') drone.look(dx, dy);
    else if (pc && pc.started) pc.cam.look(dx, dy);
  };
  cv.addEventListener('pointerdown', (e) => { if (e.button === 0 && S.mode !== 'tour') drag = { x: e.clientX, y: e.clientY, d: 0 }; });
  addEventListener('pointerup', () => {
    if (drag && drag.d < 6 && playing()) lock();
    drag = null;
  });
  addEventListener('pointermove', (e) => {
    S.hover.tx = -((e.clientX / innerWidth) - 0.5) * 0.14;
    S.hover.ty = -((e.clientY / innerHeight) - 0.5) * 0.07;
    if (!playing()) return;
    if (document.pointerLockElement === cv) { look(e.movementX, e.movementY); return; }
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.d += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY; look(dx * 1.2, dy * 1.2); }
  });
  document.addEventListener('pointerleave', () => { S.hover.tx = 0; S.hover.ty = 0; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!playing()) return;
    if (S.mode === 'drone') drone.zoom(e.deltaY);
    else if (pc && S.mode === 'walk') pc.cam.boom = clamp(pc.cam.boom * (e.deltaY > 0 ? 1.1 : 0.9), 1.6, 9);
  }, { passive: false });

  // gamepad: the first connected pad, read once a frame (standard mapping)
  let pad = null, padPrev = null, padRep = { dir: null, t: 0 };
  function pollPad(dt) {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    let g = null;
    for (const x of gps || []) if (x && x.connected && x.mapping === 'standard') { g = x; break; }
    if (!g) { for (const x of gps || []) if (x && x.connected) { g = x; break; } }
    if (!g) { pad = null; return; }
    const ax = (i) => { const v = g.axes[i] || 0; return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; };
    const bt = (i) => { const b = g.buttons[i]; return b ? (b.value || (b.pressed ? 1 : 0)) : 0; };
    pad = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), lt: bt(6), rt: bt(7), b: [] };
    for (let i = 0; i < 17; i++) pad.b[i] = bt(i) > 0.5;
    const was = (i) => padPrev && padPrev.b[i];
    const hit = (i) => pad.b[i] && !was(i);
    if (pad.b.some(Boolean) || Math.abs(pad.lx) + Math.abs(pad.ly) + Math.abs(pad.rx) + Math.abs(pad.ry) + pad.lt + pad.rt > 0.2) S.device = 'pad';
    if (hit(9)) { if (ui.isOpen) ui.close(true); else ui.open(); }
    if (ui.isOpen) {
      if (hit(0)) ui.nav('ok');
      if (hit(1)) ui.nav('back');
      // the d-pad and the left stick, with a key repeat
      const dir = pad.b[12] || pad.ly < -0.6 ? 'up' : pad.b[13] || pad.ly > 0.6 ? 'down' : pad.b[14] || pad.lx < -0.6 ? 'left' : pad.b[15] || pad.lx > 0.6 ? 'right' : null;
      if (dir !== padRep.dir) { padRep = { dir, t: 0.38 }; if (dir) ui.nav(dir); }
      else if (dir && (padRep.t -= dt) <= 0) { padRep.t = 0.13; ui.nav(dir); }
    } else if (playing()) {
      if (hit(3)) toggleView();
      if (hit(2)) toggleCar();
      if (hit(8)) ui.showLegend(S.mode, true, 8);
    } else if (S.mode === 'tour' && hit(0)) setMode('walk', S.place);
    padPrev = pad;
  }

  // ---- the inputs each controller reads
  const kd = (...c) => (c.some((k) => keys[k]) ? 1 : 0);
  function droneInput() {
    if (!playing()) return {};
    const p = pad || { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    return {
      fwd: clamp(kd('KeyW', 'ArrowUp') - kd('KeyS', 'ArrowDown') - p.ly, -1, 1),
      right: clamp(kd('KeyD', 'ArrowRight') - kd('KeyA', 'ArrowLeft') + p.lx, -1, 1),
      up: clamp(kd('Space', 'KeyE') - kd('ShiftLeft', 'ShiftRight', 'KeyQ') + p.rt - p.lt, -1, 1),
      lookX: p.rx * 2.6, lookY: p.ry * 1.8,
    };
  }
  function walkInput() {
    const p = pad || { lx: 0, ly: 0, rx: 0, ry: 0 };
    if (p.rx || p.ry) pc.cam.look(p.rx * 16, p.ry * 12);
    let f = kd('KeyW', 'ArrowUp') - kd('KeyS', 'ArrowDown') - p.ly, r = kd('KeyD', 'ArrowRight') - kd('KeyA', 'ArrowLeft') + p.lx;
    const m = Math.min(1, Math.hypot(f, r));
    if (m < 0.05) return { dx: 0, dz: 0, speed: 0 };
    const y = pc.cam.yaw, fx = -Math.sin(y), fz = -Math.cos(y);
    let dx = fx * f - fz * r, dz = fz * f + fx * r;
    // the edge of the shipped area: the outward part of the step fades out over 12 m
    const w = pc.walker, b = w && bound(w.x, w.z);
    if (b) { const out = -(dx * b.nx + dz * b.nz); if (out > 0) { const k = Math.min(1, b.over / 12); dx += b.nx * out * k; dz += b.nz * out * k; } }
    const run = kd('ShiftLeft', 'ShiftRight') || Math.hypot(p.lx, p.ly) > 0.93;
    return { dx, dz, speed: (run ? RUN : WALK) * Math.max(0.35, m) };
  }
  function driveInput() {
    const c = pc.car, p = pad || { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, b: [] };
    if (p.rx || p.ry) pc.cam.look(p.rx * 16, p.ry * 12);
    const thr = Math.max(kd('KeyW', 'ArrowUp'), p.rt), back = Math.max(kd('KeyS', 'ArrowDown'), p.lt);
    const stIn = Math.abs(p.lx) > 0.05 ? p.lx : kd('KeyD', 'ArrowRight') - kd('KeyA', 'ArrowLeft');
    pc._st = (pc._st || 0) + clamp(stIn - (pc._st || 0), -0.08, 0.08);   // the wheel turns progressively
    if (back > 0.1 && thr < 0.1 && c.v < 0.5) pc._rev = true;               // S brakes while rolling, then reverses
    if (thr > 0.1) pc._rev = false;
    const rev = !!pc._rev;
    const out = { throttle: rev ? back * 0.7 : thr, brake: rev ? 0 : back, steer: pc._st, hand_brake: !!(keys.Space || (p.b && p.b[0])), reverse: rev };
    // the edge of the shipped area: no throttle outward, then the brakes
    const b = bound(c.x, c.z);
    if (b) {
      const hx = Math.sin(c.h) * (rev ? -1 : 1), hz = Math.cos(c.h) * (rev ? -1 : 1);
      if (-(hx * b.nx + hz * b.nz) > 0) { out.throttle *= Math.max(0, 1 - b.over / 15); out.brake = Math.max(out.brake, clamp((b.over - 8) / 25, 0, 1)); }
    }
    return out;
  }

  // ---- context loss: the page cannot recover the city; offer a lighter reload
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ui.load.style.opacity = '1'; ui.fade.style.opacity = '1';
    ui.fatal('The graphics card ran out of memory', 'Reload with low quality', () => { store.set('quality', 'low'); location.reload(); });
  });

  // ---- resolution governor (Auto): keep weak graphics cards above about 28 fps by lowering the render scale
  function govern(dt) {
    if (S.quality !== 'auto') return;
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

  // ---- precompile behind the black, then a few frames until frame times settle, then the fade in
  function compileThen(next) {
    S.compiling = true;
    const gen = S.gen;   // a pass that ends after the visitor moved on to another scene or mode is not this one's
    compileSafe(engine.renderer, engine.scene, engine.camera, 6000).then(() => { if (gen !== S.gen) return; S.compiling = false; next(); });
  }
  function reveal() {
    ui.load.style.opacity = '0'; ui.fade.style.opacity = '0';
    if (!S.shown) {
      S.shown = true; window.__SC.progress = 1; window.__SC.shown = true;
      if (vload) { vload.style.opacity = '0'; setTimeout(() => vload.remove(), 1200); }
    }
  }

  const api = {
    get controller() {
      if (S.state === 'mload') return hold;
      if (S.mode === 'drone' && (S.state === 'mwarm' || S.state === 'mplay')) return droneCtl;
      if ((S.mode === 'walk' || S.mode === 'drive') && (S.state === 'mwarm' || S.state === 'mplay') && pc) return pcCtl;
      return null;
    },
    step(dt) {
      pollPad(dt);
      const H = S.hover, k = 1 - Math.exp(-dt * 2.5);
      H.x += (H.tx - H.x) * k; H.y += (H.ty - H.y) * k;
      const tour = S.mode === 'tour';
      controller.hoverYaw = tour && !ui.isOpen ? H.x : 0; controller.hoverPitch = tour && !ui.isOpen ? H.y : 0;
      if (S.state === 'loading') {
        S.wait += dt;
        const ready = streamer.readyUnder() && streamer.outstanding === 0 && S.wait > 1.2;
        // every program the view needs is compiled now, behind the black, not as a hitch on screen
        if (!S.compiling && (ready || S.wait > 20)) compileThen(() => { S.state = 'warm'; S.warm = 0; S.calm = 0; });
        if (!S.shown) window.__SC.progress = Math.min(0.9, 0.6 + 0.3 * Math.min(1, S.wait / 12));
      } else if (S.state === 'warm') {
        // a few frames drawn behind the black (post passes, shadow maps, texture uploads) until frame times settle
        S.warm += dt; S.calm = dt < 1 / 24 ? S.calm + 1 : 0;
        if (!S.shown) window.__SC.progress = Math.min(0.99, 0.9 + 0.09 * Math.min(1, S.warm / 2));
        if ((S.calm > 20 && S.warm > 0.8) || S.warm > 6) {
          S.state = 'fadein'; S.t = 0; controller.hold = ui.isOpen;
          const first = !S.shown;
          reveal();
          ui.chrome('tour');
          setTimeout(() => { if (S.mode === 'tour' && (S.state === 'play' || S.state === 'fadein')) ui.card.classList.add('on'); }, first ? 900 : 500);
        }
      } else if (S.state === 'fadein' || S.state === 'play') {
        S.state = 'play';
        govern(dt);
        controller.hold = ui.isOpen;
        const sc = S.scenes[S.cur];
        const left = sc.duration - controller.t;   // path time left
        if (!ui.isOpen && left / Math.max(1e-3, controller.speed) < S.fadeS + 0.15) advance();
        if (traffic && sc.cars !== undefined) traffic.target = Math.min(sc.cars, QUALITY[S.quality].cars);
      } else if (S.state === 'fadeout') {
        S.t += dt;
        if (S.t > S.fadeS && S.next) { const n = S.next; S.next = null; n(); }
      } else if (S.state === 'mload') {
        S.wait += dt;
        const ready = streamer.readyUnder() && streamer.outstanding === 0 && S.wait > 0.8;
        if (!S.spawned && (ready || S.wait > 25)) {
          S.spawned = spawn();
          // (Drive waits for its lanes while the tiles round the place still stream, up to a minute: a slow machine's
          // graph fills later than 30 s)
          if (!S.spawned && S.wait > 30 && !(S.mode === 'drive' && streamer.outstanding > 0 && S.wait < 60)) {
            // no lane within reach of this place: the visitor walks here instead; with no traffic at all, Drive leaves the menu
            if (S.mode === 'drive') {
              if (!traffic) { S.drive = false; ui.setModes(MODES.filter((m) => m[0] !== 'drive')); }
              beginMode('walk', S.place); ui.set('mode', 'walk'); return;
            }
            S.spawned = true;
          }
          if (S.spawned) { S.state = 'mwarm'; S.warm = 0; S.calm = 0; S.compiling = false; S.compiled = false; }
        }
      } else if (S.state === 'mwarm') {
        // the body is placed (held still); compile what the new view needs, then let frame times settle
        S.warm += dt;
        if (!S.compiled && !S.compiling && (S.mode === 'drone' || (pc && pc.started))) compileThen(() => { S.compiled = true; S.warm = 0; });
        if (S.compiled) {
          S.calm = dt < 1 / 24 ? S.calm + 1 : 0;
          if ((S.calm > 20 && S.warm > 0.6) || S.warm > 5) {
            S.state = 'mplay';
            reveal();
            ui.chrome('mode');
            engine.resetTemporal?.();
            if (ui.isOpen) S.legendDue = true; else showLegend();
          }
        } else if (S.warm > 20) S.compiled = true;
      } else if (S.state === 'mplay') {
        govern(dt);
      }
    },
  };
  // harness hooks (tools/lite/trace_lite.mjs, the checks): the state, a mode at a place, the view
  window.__SPACE = {
    state: () => ({ mode: S.mode, state: S.state, place: S.place, placeName: S.places[S.place]?.name, menu: ui.isOpen, quality: S.quality, time: sky.mode,
      pr: +engine.renderer.getPixelRatio().toFixed(2), fps: +engine.fps.toFixed(1), drone: S.mode === 'drone' ? drone.state() : null, play: pc && pc.started ? pc.state() : null, drive: S.drive }),
    places: () => S.places.map((p) => ({ name: p.name, x: +p.x.toFixed(1), z: +p.z.toFixed(1), r: p.r })),
    mode: (m, pi = S.place) => { setMode(m, pi); return m; },
    menu: (on = true) => { if (on) ui.open(); else ui.close(true); return ui.isOpen; },
    view: (yaw, pitch) => { if (S.mode === 'drone') { drone.camYaw = yaw; drone.camPitch = pitch; } else if (pc) { pc.cam.yaw = yaw; pc.cam.pitch = pitch; } },
    keys, drone, get pc() { return pc; }, quality: (q) => { change('quality', q); ui.set('quality', q); return q; },
    time: (t) => { change('time', t); ui.set('time', t); return t; },
    // the ground under (x, z) and whether (x, y, z) stands inside a building (the checks: a body on the ground, not in a wall)
    probe: (x, y, z) => ({ ground: probe.ground(x, z, null), inside: COLLIDERS.resolve({ x, y: y + 0.3, z }, 0.05, 1.2).wall }),
    // the collider registry's size (the memory checks: it must stay bounded as tiles come and go)
    colliders: () => { let n = 0; const by = {}; for (const [k, a] of COLLIDERS.byTile) { n += a.length; if (!/^-?\d+_-?\d+$/.test(k)) by[k] = a.length; } return { keys: COLLIDERS.byTile.size, prisms: n, fixedKeys: by }; },
  };
  return api;
}
