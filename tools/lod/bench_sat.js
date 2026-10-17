(async () => {
  // Lane B saturated bench (tools/lod/bench_sat.sh): the persistent tier's GPU cost with the GPU kept busy. The engine's own
  // loop is stopped (externalDrive) and the simulation and the shadow maps are frozen; the same view is rendered back to
  // back with composer.render() and no rAF, one GPU timer query (EXT_disjoint_timer_query_webgl2) around each frame, and
  // gl.finish() before and after each batch (the wall time per frame). Configurations, alternated over ROUNDS rounds:
  // the whole tier on; off; without the shells; without the ground; without the landmarks.
  const N = Number(window.__BENCH_N || 300), ROUNDS = Number(window.__BENCH_ROUNDS || 4), WARM = 120;
  const E = window.__ENGINE, L = window.__LOD16, R = E.renderer, gl = R.getContext();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240; i++) { const S = window.__STREAMER; if (S && S.idle && S.idle() && (!L || L.idle())) break; await wait(500); }
  await wait(1500);
  E.externalDrive = true;   // the rAF loop keeps arming but draws nothing; this script draws
  await wait(100);
  const shadows = [E.sun, E.sun2].filter(Boolean).map((l) => [l, l.shadow.autoUpdate]);
  for (const [l] of shadows) { l.shadow.autoUpdate = false; l.shadow.needsUpdate = false; }
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const parts = { shells: [], ground: [], landmarks: [] };
  if (L) for (const o of L.group.children) (o.name.startsWith('lod16_ground') ? parts.ground : o.name.startsWith('lod16_lm') ? parts.landmarks : parts.shells).push(o);
  const vis0 = new Map(L ? L.group.children.map((o) => [o, o.visible]) : []);
  const set = (hidden) => { if (!L) return; L.group.visible = !hidden.includes('tier'); for (const o of L.group.children) o.visible = vis0.get(o); for (const p of hidden) if (parts[p]) for (const o of parts[p]) o.visible = false; };
  // (WebGL makes query results available only after control returns to the event loop: read them after a yield)
  const batch = async (n) => {
    const qs = [];
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      E.composer.render();
      if (ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    }
    gl.finish();
    const wall = (performance.now() - t0) / n;
    const g = [];
    for (let tries = 0; tries < 50 && qs.length; tries++) {
      await wait(20);
      if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) { for (const q of qs) gl.deleteQuery(q); qs.length = 0; break; }
      for (let k = qs.length - 1; k >= 0; k--) if (gl.getQueryParameter(qs[k], gl.QUERY_RESULT_AVAILABLE)) { g.push(gl.getQueryParameter(qs[k], gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qs[k]); qs.splice(k, 1); }
    }
    for (const q of qs) gl.deleteQuery(q);
    g.sort((a, b) => a - b);
    return { wall, gpuMed: g.length ? g[g.length >> 1] : null, gpuMean: g.length ? g.reduce((s, v) => s + v, 0) / g.length : null, gpuN: g.length };
  };
  const cases = L ? { all: [], noTier: ['tier'], noShells: ['shells'], noGround: ['ground'], noLandmarks: ['landmarks'] } : { all: [] };
  set([]); await batch(WARM);   // warm the clock and the caches
  const res = {};
  for (let r = 0; r < ROUNDS; r++) for (const [name, hid] of Object.entries(cases)) {
    set(hid);
    await batch(20);
    (res[name] = res[name] || []).push(await batch(N));
  }
  set([]);
  for (const [l, a] of shadows) l.shadow.autoUpdate = a;
  E.externalDrive = false;
  const med = (a) => { const b = a.filter((v) => v != null).sort((x, y) => x - y); return b.length ? +b[b.length >> 1].toFixed(3) : null; };
  const out = {};
  for (const [k, v] of Object.entries(res)) out[k] = { gpuMs: med(v.map((x) => x.gpuMed)), gpuMeanMs: med(v.map((x) => x.gpuMean)), wallMs: med(v.map((x) => x.wall)), n: v.map((x) => x.gpuN).join('/'), rounds: v.map((x) => [+(x.gpuMed ?? 0).toFixed(2), +x.wall.toFixed(2)]) };
  const info = R.info;
  return JSON.stringify({ n: N, rounds: ROUNDS, size: [gl.drawingBufferWidth, gl.drawingBufferHeight], pr: R.getPixelRatio(), timer: !!ext,
    lod: L ? { trisInView: L.stats.trisInView, callsInView: L.stats.callsInView, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])) } : null,
    calls: info.render.calls, tris: info.render.triangles, res: out });
})()
