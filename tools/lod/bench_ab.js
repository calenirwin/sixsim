(async () => {
  // Lane B in-page A/B (tools/lod/bench.sh): the frame's GPU and CPU time per pass (main.js __PASSES, timer queries),
  // draw calls and triangles, with this tier shown and hidden, alternated four times; medians
  const L = window.__LOD16;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sum = (ps) => { let g = 0, c = 0, calls = 0, tris = 0; const P = ps.passes || ps; for (const k of Object.keys(P)) { const v = P[k]; if (v && typeof v.gpu === 'number') { g += v.gpu; c += v.cpu || 0; calls += v.calls || 0; tris += v.tris || 0; } } return { g, c, calls, tris }; };
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(2); };
  const S = { on: { g: [], c: [], calls: [], tris: [] }, off: { g: [], c: [], calls: [], tris: [] } };
  await wait(3000);
  for (let k = 0; k < 4; k++) {
    for (const mode of ['on', 'off']) {
      if (L) L.group.visible = mode === 'on';
      await wait(800);
      const r = sum(await window.__PASSES(45, true));
      S[mode].g.push(r.g); S[mode].c.push(r.c); S[mode].calls.push(r.calls); S[mode].tris.push(r.tris);
      if (!L) break;
    }
  }
  if (L) L.group.visible = true;
  const out = {};
  for (const m of ['on', 'off']) if (S[m].g.length) out[m] = { gpuMs: med(S[m].g), cpuMs: med(S[m].c), calls: med(S[m].calls), tris: med(S[m].tris) };
  return JSON.stringify({ lod: L ? { trisInView: L.stats.trisInView, callsInView: L.stats.callsInView, tris: L.stats.tris, calls: L.stats.calls, bytes: L.stats.bytes } : null, ...out });
})()
