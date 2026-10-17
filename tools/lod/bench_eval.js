(async () => {
  // Lane B bench (tools/lod/bench.sh): the whole frame with this tier drawn and hidden, at the page's settings
  const L = window.__LOD16;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const gpuOf = (ps) => { try { let g = 0, c = 0; for (const k of Object.keys(ps.passes || ps)) { const v = (ps.passes || ps)[k]; if (v && typeof v.gpu === 'number') g += v.gpu; if (v && typeof v.cpu === 'number') c += v.cpu; } return { gpuMs: +g.toFixed(2), cpuMs: +c.toFixed(2) }; } catch { return null; } };
  const measure = async () => {
    await wait(2500);
    const p = await window.__PERF();
    let ps = null;
    try { ps = await window.__PASSES(60); } catch (e) { ps = { err: String(e) }; }
    return { fps: p.fps, calls: p.calls, tris: p.tris, geoms: p.geoms, texs: p.texs, passes: gpuOf(ps), raw: ps && ps.passes ? undefined : ps };
  };
  const on = await measure();
  let off = null;
  if (L) { L.group.visible = false; off = await measure(); L.group.visible = true; await wait(500); }
  const s = L ? JSON.parse(JSON.stringify(L.stats)) : null;
  const E = window.__ENGINE;
  let water = null;
  try { E.scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width === 46000) water = o.scale.x; }); } catch {}
  const env = E ? { far: E.camera.far, fog: E.scene.fog ? E.scene.fog.density : null, hazeTo60km: !!(E.haze && E.haze._quad && E.haze._quad.material.fragmentShader.includes('60000.0')), waterScale: water } : null;
  return JSON.stringify({ lod: s, env, on, off });
})()
