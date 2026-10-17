// BD40 (backdrop lane): the page's compiled facade program (client/src/world/materials.js makeFacadeMaterial), dumped for
// tools/ue/bd_tilefac_port.py:  node tools/bshot.mjs --views <a view with tile facades> --evalfile tools/ue/bd_tilefac_dump.js
// (the eval line's JSON: [{ name, key, fs, vs }] -> facade_0.frag, facade_0.vert; then tools/ue/bd_tilefac_extract.py <dir>)
(() => {
  const E = window.__ENGINE; const R = E && E.renderer; if (!R) return 'no renderer';
  const gl = R.getContext();
  const out = [];
  for (const p of (R.info.programs || [])) {
    try {
      const fs = gl.getShaderSource(p.fragmentShader), vs = gl.getShaderSource(p.vertexShader);
      if (fs && fs.indexOf('building rebuilt by the NYC dresser') >= 0) out.push({ name: p.name, key: (p.cacheKey || '').slice(0, 200), fs, vs });
    } catch (e) { out.push({ err: String(e) }); }
  }
  return out;
})()
