// SPACE r2 (docs/notes/space-r2.md): three's WebGLRenderer.compileAsync() polls every material it prepared with
// properties.get(material).currentProgram.isReady(). A material disposed while it waits (a tile streamed out under the
// compile) comes back with no currentProgram, and the poll throws "Cannot read properties of undefined (reading
// 'isReady')" from a timer, outside any promise (an uncaught page error, seen in every light build's trace). This is the
// same pass with that case read as done, and a time cap. Without KHR_parallel_shader_compile the programs are linked
// synchronously by compile() and nothing is left to wait for.
export function compileSafe(renderer, scene, camera, capMs = 8000) {
  let mats;
  try { mats = renderer.compile(scene, camera); } catch (e) { console.warn('[compile] pass failed', e); return Promise.resolve(false); }
  if (!renderer.extensions.has('KHR_parallel_shader_compile')) return Promise.resolve(true);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      try {
        for (const m of mats) {
          const p = renderer.properties.get(m).currentProgram;
          if (!p || p.isReady()) mats.delete(m);
        }
      } catch (e) { resolve(false); return; }
      if (!mats.size) resolve(true);
      else if (performance.now() - t0 > capMs) resolve(false);
      else setTimeout(check, 10);
    };
    check();
  });
}
