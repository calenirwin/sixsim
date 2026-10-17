// SPACE r2 (docs/notes/space-r2.md, the light showcase's memory): a group leaving the scene takes its own materials and
// textures with it. Tile groups (world/assemble.js) and the named storefronts (city/namedShops.js) disposed only their
// geometries, so every area kit's per-building materials and canvas textures (signs, storefronts, painted art) stayed on
// the GPU and in memory after their tile unloaded, and the next visit painted and uploaded them again.
//
// registerOwned(key, group): a tile's materials and their textures, noted with the tile once it is assembled. A material or
// texture that two tiles have drawn with is shared (the ground, the facades, the kits' common materials and the texture
// banks behind them) and is never disposed here, even when every tile that used it has gone at once.
// disposeOwned(group, scene, key): call after the group is out of the scene. Every material drawn in the group that is not
// shared, that no other loaded tile holds and that nothing still in the scene draws with is disposed, with each of its
// textures that passes the same tests. A material kept in a module's cache is fine to dispose: three builds its program and
// uploads its textures again (from the canvas or data the texture still holds) when a later tile draws with it. Never
// touched: render target textures, depth textures, environment maps, the scene's environment and background, and anything
// marked userData.keep. Returns { materials, textures } disposed.
const TEX_SKIP = new Set(['envMap']);
const USERS = new WeakMap();   // material or texture -> { tiles: Set of tile keys holding it, shared: two tiles ever did }

function texturesOf(m, out) {
  for (const k in m) {
    if (TEX_SKIP.has(k)) continue;
    const v = m[k];
    if (v && v.isTexture) out.add(v);
  }
  const U = m.uniforms;
  if (U) {
    for (const k in U) {
      const v = U[k] && U[k].value;
      if (!v) continue;
      if (v.isTexture) out.add(v);
      else if (Array.isArray(v)) for (const t of v) if (t && t.isTexture) out.add(t);
    }
  }
  return out;
}
const materialsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
function note(x, key) {
  let u = USERS.get(x);
  if (!u) USERS.set(x, (u = { tiles: new Set(), shared: false }));
  u.tiles.add(key);
  if (u.tiles.size > 1) u.shared = true;
}

export function registerOwned(key, group) {
  const mats = new Set();
  group.traverse((o) => { for (const m of materialsOf(o)) mats.add(m); });
  for (const m of mats) { note(m, key); for (const t of texturesOf(m, new Set())) note(t, key); }
}

export function disposeOwned(group, scene, key = null) {
  const mine = new Set();
  group.traverse((o) => { for (const m of materialsOf(o)) mine.add(m); });
  if (!mine.size) return { materials: 0, textures: 0 };
  // let go of this tile's claims first: what another loaded tile still holds, or two tiles ever held, stays
  const free = (x) => {
    const u = USERS.get(x);
    if (!u) return true;
    if (key !== null) u.tiles.delete(key);
    return !u.shared && u.tiles.size === 0;
  };
  // what the rest of the scene still draws with
  const keepMats = new Set(), keepTex = new Set();
  scene.traverse((o) => {
    for (const m of materialsOf(o)) keepMats.add(m);
    if (o.customDepthMaterial) keepMats.add(o.customDepthMaterial);
    if (o.customDistanceMaterial) keepMats.add(o.customDistanceMaterial);
  });
  for (const m of keepMats) texturesOf(m, keepTex);
  if (scene.environment) keepTex.add(scene.environment);
  if (scene.background && scene.background.isTexture) keepTex.add(scene.background);
  let nm = 0, nt = 0;
  const done = new Set();
  for (const m of mine) {
    const texs = texturesOf(m, new Set());
    const mFree = free(m);
    for (const t of texs) {
      if (done.has(t)) continue;
      done.add(t);
      const tFree = free(t);
      if (!mFree || !tFree || keepMats.has(m) || keepTex.has(t) || t.isRenderTargetTexture || t.isDepthTexture || (t.userData && t.userData.keep) || (m.userData && m.userData.keep)) continue;
      t.dispose();
      nt++;
    }
    if (!mFree || keepMats.has(m) || (m.userData && m.userData.keep)) continue;
    m.dispose();
    nm++;
  }
  return { materials: nm, textures: nt };
}
