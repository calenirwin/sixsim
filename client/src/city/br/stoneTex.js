// The bridge kit's masonry textures, generated (seeded, seamless): coursed ashlar of 5 courses by 10 course heights,
// 2048 x 1024 texels (3.9 mm at the 0.8 m course), as albedo, tangent-space normal (green up) and AO-roughness-metal
// maps that every renderer reads from the packages like any other texture. Two dressings:
//   rock     rock-faced (quarry-faced) blocks: a pitched arris round each face, the face bulging 2-4 cm between its
//            edges, its surface broken at 3-50 cm; recessed joints (the Brooklyn Bridge's towers, the Queensboro's piers)
//   dressed  smooth-dressed blocks with a small chamfer at each joint (mouldings, cornices, the classical towers)
// Blocks vary in length (1.6-3.4 course heights) and tone; the joints are recessed 2 cm and darker. The UVs that read
// them come from the world (geom.js stoneize: v = height / 5 courses, u = the distance along the face / 10 courses).
import * as THREE from 'three';

const W = 2048, H = 1024, COURSES = 5, UNITS = 10;
const cache = new Map();

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash2 = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// periodic value noise on a lattice of `cell` texels (cell divides W and H): seamless over the tile
function vnoiseLayer(cell, seed) {
  const nx = W / cell, ny = H / cell, g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = hash2(i, j, seed) * 2 - 1;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = y / cell, j0 = Math.floor(fy), ty = fy - j0, sy = ty * ty * (3 - 2 * ty), j1 = (j0 + 1) % ny;
    for (let x = 0; x < W; x++) {
      const fx = x / cell, i0 = Math.floor(fx), tx = fx - i0, sx = tx * tx * (3 - 2 * tx), i1 = (i0 + 1) % nx;
      const a = g[j0 * nx + i0], b = g[j0 * nx + i1], c = g[j1 * nx + i0], d = g[j1 * nx + i1];
      out[y * W + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}
// a separable box blur with wrap (radius r texels)
function blurWrap(src, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0; const row = y * W;
    for (let k = -r; k <= r; k++) s += src[row + ((k + W) % W)];
    for (let x = 0; x < W; x++) { tmp[row + x] = s / n; s += src[row + ((x + r + 1) % W)] - src[row + ((x - r + W) % W)]; }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[((k + H) % H) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[((y + r + 1) % H) * W + x] - tmp[((y - r + H) % H) * W + x]; }
  }
  return out;
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the layout: course boundaries (texel rows) and each course's blocks (start texels, wrapping)
function layout(seed) {
  const R = rng(seed);
  const hs = []; let sum = 0;
  for (let r = 0; r < COURSES; r++) { const h = 0.82 + R() * 0.36; hs.push(h); sum += h; }
  const rows = []; let y0 = 0;
  for (let r = 0; r < COURSES; r++) { const y1 = r === COURSES - 1 ? H : Math.round(y0 + (hs[r] / sum) * H); rows.push({ y0, y1, blocks: [] }); y0 = y1; }
  const unit = W / UNITS;
  let prevJ = [];
  for (const row of rows) {
    // lengths 1.6-3.4 units summing to UNITS, the course started at a random offset, joints kept 0.35 units off the last
    // course's joints where a few tries allow
    let best = null;
    for (let tr = 0; tr < 12; tr++) {
      const L = []; let s = 0;
      while (s < UNITS - 1.6) { const l = 1.6 + R() * 1.8; L.push(l); s += l; }
      const k = UNITS / s; for (let i = 0; i < L.length; i++) L[i] *= k;
      const off = R() * UNITS, J = []; let p = off;
      for (const l of L) { J.push(((p % UNITS) + UNITS) % UNITS); p += l; }
      let bad = 0;
      for (const a of J) for (const b of prevJ) { const d = Math.abs(a - b), dd = Math.min(d, UNITS - d); if (dd < 0.35) bad++; }
      if (!best || bad < best.bad) best = { bad, J };
      if (!bad) break;
    }
    const J = best.J.slice().sort((a, b) => a - b);
    row.blocks = J.map((j, i) => ({ x0: j * unit, x1: (i + 1 < J.length ? J[i + 1] : J[0] + UNITS) * unit, tone: 0.7 + R() * 0.3, warm: (R() - 0.5) * 0.09, id: Math.floor(R() * 1e9) }));
    prevJ = J;
  }
  return rows;
}

// height (metres at the 0.8 m course), tone and the joint mask for every texel; then the maps
function generate(style) {
  const seed = style === 'rock' ? 7311 : 4127;
  const rows = layout(seed);
  const ps = (UNITS * 0.8) / W;            // texel size in metres at the reference course
  const rock = style === 'rock';
  const n0 = vnoiseLayer(64, seed + 6), n1 = vnoiseLayer(128, seed + 1), n2 = vnoiseLayer(32, seed + 2), n3 = vnoiseLayer(8, seed + 3), n4 = vnoiseLayer(256, seed + 4), n5 = vnoiseLayer(16, seed + 5);
  const hgt = new Float32Array(W * H), tone = new Float32Array(W * H).fill(0.9), joint = new Uint8Array(W * H);
  const warmA = new Float32Array(W * H);
  const jw = (rock ? 0.011 : 0.006) / ps;   // half the joint's width, texels
  for (const row of rows) {
    const hh = (row.y1 - row.y0) / 2, cy = (row.y0 + row.y1) / 2;
    for (const b of row.blocks) {
      const hw = (b.x1 - b.x0) / 2, cx = (b.x0 + b.x1) / 2, bid = b.id % 1000;
      const bulge = rock ? 0.012 + (bid / 1000) * 0.035 : 0, pitch = rock ? 0.03 + ((b.id >> 10) % 100) / 100 * 0.025 : 0;
      for (let y = row.y0; y < row.y1; y++) {
        const dy = Math.min(y - row.y0 + 0.5, row.y1 - y - 0.5), vy = (y - cy) / hh;
        for (let xx = Math.floor(b.x0); xx < Math.ceil(b.x1); xx++) {
          const xc = xx + 0.5;
          if (xc < b.x0 || xc >= b.x1) continue;
          const x = ((xx % W) + W) % W, i = y * W + x;
          const dx = Math.min(xc - b.x0, b.x1 - xc), e = Math.min(dx, dy);   // texels to the block's nearest edge
          // (a rock face's arris wanders: its line moved up to 2.5 cm in and out along the edge)
          const ew = rock ? e - (0.5 + 0.5 * n2[i]) * 0.025 / ps : e;
          if (e < jw) { joint[i] = 1; hgt[i] = -0.025; tone[i] = 0.58; warmA[i] = 0; continue; }
          const em = Math.max(0, ew - jw) * ps, ux = (xc - cx) / hw;
          let h;
          if (rock) {
            // the pitched arris (the face drops `pitch` toward the joint within 4-7 cm), the block's bulge, and the face
            // broken in conchoidal chips (ridged noise: sharp creases between smooth hollows) at 5-50 cm
            const r0 = 1 - Math.abs(n0[i]), r2 = 1 - Math.abs(n2[i]);
            h = pitch * sstep(0, 0.045 + 0.025 * (0.5 + 0.5 * n5[i]), em) - pitch + bulge * (1 - ux * ux * ux * ux) * (1 - vy * vy * vy * vy)
              + 0.014 * n1[i] + 0.009 * r0 * r0 + 0.004 * r2 * r2 + 0.0015 * n3[i];
          } else {
            // smooth-dressed: a 1.2 cm chamfer, a bush-hammered stipple
            h = -0.008 * (1 - sstep(0, 0.012, em)) + 0.0005 * n2[i] + 0.0004 * n3[i] + 0.0003 * n5[i];
          }
          hgt[i] = h;
          // the block's tone, a mottle across it, its lower edge a little darker (water and dirt off the course above)
          tone[i] = b.tone * (1 + 0.07 * n4[i] + 0.05 * n1[i] + 0.04 * n2[i]) * (1 - 0.08 * (1 - sstep(0, 0.1, (y - row.y0) * ps)));
          warmA[i] = b.warm;
        }
      }
    }
  }
  // cavities from the local mean height; the granite's grain (dark mica, light quartz)
  const mean = blurWrap(hgt, 10);
  const alb = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4), orm = new Uint8Array(W * H * 4);
  const R = rng(seed + 9);
  const k = 1 / ps;
  let sum = 0;
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, yr = y * W;
    for (let x = 0; x < W; x++) {
      const i = yr + x, xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const cav = Math.max(0, Math.min(1, (mean[i] - hgt[i]) * (rock ? 22 : 60)));
      const q = R();
      const grain = (R() - 0.5) * (rock ? 0.1 : 0.06) + (q < 0.05 ? -0.28 * R() : q > 0.97 ? 0.1 : 0);
      let t = tone[i] * (1 - 0.3 * cav) * (1 + grain);
      if (joint[i]) t = 0.58 + grain * 0.4;
      const wa = warmA[i];
      const r = Math.min(1, t * (0.93 + wa)), g = Math.min(1, t * 0.92), bl = Math.min(1, t * (0.89 - wa * 0.6));
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      alb[i * 4] = Math.round(255 * Math.pow(r, 1 / 2.2)); alb[i * 4 + 1] = Math.round(255 * Math.pow(g, 1 / 2.2)); alb[i * 4 + 2] = Math.round(255 * Math.pow(bl, 1 / 2.2)); alb[i * 4 + 3] = 255;
      // the normal from the height's slope (OpenGL: x along u, y along v)
      const dhx = (hgt[yr + xp] - hgt[yr + xm]) * 0.5 * k, dhy = (hgt[yp + x] - hgt[ym + x]) * 0.5 * k;
      const l = Math.hypot(dhx, dhy, 1);
      nrm[i * 4] = Math.round(255 * (0.5 - 0.5 * dhx / l)); nrm[i * 4 + 1] = Math.round(255 * (0.5 - 0.5 * dhy / l)); nrm[i * 4 + 2] = Math.round(255 * (0.5 + 0.5 / l)); nrm[i * 4 + 3] = 255;
      const ao = joint[i] ? 0.5 : 1 - 0.55 * cav, ro = joint[i] ? 0.95 : rock ? 0.82 + 0.1 * cav + (R() - 0.5) * 0.08 : 0.68 + 0.12 * cav + (R() - 0.5) * 0.04;
      orm[i * 4] = Math.round(255 * ao); orm[i * 4 + 1] = Math.round(255 * Math.min(1, ro)); orm[i * 4 + 2] = 0; orm[i * 4 + 3] = 255;
    }
  }
  const tex = (data, name, srgb) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.name = name; t.needsUpdate = true;
    return t;
  };
  // (mean: the albedo's mean linear luminance, so a material keeps its builder's colour on average)
  return { map: tex(alb, `br:stone_${style}:albedo`, true), normalMap: tex(nrm, `br:stone_${style}:normal`, false), ormMap: tex(orm, `br:stone_${style}:orm`, false), mean: sum / (W * H) };
}

export function stoneTextures(style = 'rock') {
  if (!cache.has(style)) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    cache.set(style, generate(style));
    if (typeof performance !== 'undefined') console.log(`[bridges] stone textures (${style}): ${(performance.now() - t0).toFixed(0)} ms`);
  }
  return cache.get(style);
}
export const STONE_TILE = { courses: COURSES, units: UNITS };
