(async () => {
  // Lane B: which part of this tier costs the GPU time (tools/lod/bench.sh): shells, ground, landmarks, each hidden in turn
  const L = window.__LOD16;
  if (!L) return 'no lod16';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sum = (ps) => { let g = 0; const P = ps.passes || ps; for (const k of Object.keys(P)) { const v = P[k]; if (v && typeof v.gpu === 'number') g += v.gpu; } return g; };
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(2); };
  const parts = { shells: [], ground: [], landmarks: [] };
  for (const o of L.group.children) (o.name.startsWith('lod16_ground') ? parts.ground : o.name.startsWith('lod16_lm') ? parts.landmarks : parts.shells).push(o);
  const vis0 = new Map(L.group.children.map((o) => [o, o.visible]));
  const setHidden = (names) => { for (const o of L.group.children) o.visible = vis0.get(o); for (const n of names) for (const o of parts[n]) o.visible = false; };
  const hold = L.update.bind(L);
  L.update = () => {};   // freeze the manager while measuring (it would switch the shells back on)
  const cases = { all: [], noShells: ['shells'], noGround: ['ground'], noLandmarks: ['landmarks'], none: ['shells', 'ground', 'landmarks'] };
  const res = {};
  await wait(2000);
  for (let k = 0; k < 5; k++) for (const [name, hid] of Object.entries(cases)) {
    setHidden(hid);
    await wait(600);
    (res[name] = res[name] || []).push(sum(await window.__PASSES(40, true)));
  }
  setHidden([]);
  L.update = hold;
  const out = {};
  for (const [k, v] of Object.entries(res)) out[k] = med(v);
  return JSON.stringify({ gpuMs: out, counts: { shells: parts.shells.length, ground: parts.ground.length, landmarks: parts.landmarks.length } });
})()
