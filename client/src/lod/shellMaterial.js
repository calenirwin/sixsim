// The persistent tier's material (?lod16=1): the far city's own look (world/materials.js makeFarMaterial: lit from the
// live sun and sky, the FW14 window grid, the tower terms, weather, the NM24 near mask) on the LOD chunks' format, plus
//   * the dithered cross-fade: each mesh's material carries `uFade` (its visible share) and `uFadeMode` (0 for the
//     incoming or steady side: keep where the screen threshold < uFade; 1 for the outgoing side: keep where it is
//     >= 1 - uFade), so a parent and its children fading over the same frames cover complementary pixels;
//   * night windows that hold a pixel: lit windows (70 x 65 % of a bay), taken several bays at a time where a bay is under
//     two pixels (same chance, same glazed share, same mean light), so the far city at night neither sparkles nor glows
//     flat; only walls carry them.
// Every material made here shares one program (a constant cache key); each has its own fade uniforms.
import { makeFarMaterial } from '../world/materials.js';

const IGN = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';
const warned = new Set();
const WALL_SKY = Math.max(0, Math.min(1, Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('lodwallsky')) || 0.5));
const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); console.warn('[lod16] material patch:', m); } };

function patch(sh, U, nearMask = true) {
  sh.uniforms.uFade = U.uFade;
  sh.uniforms.uFadeMode = U.uFadeMode;
  if (sh.uniforms.uScale) sh.uniforms.uScale.value = 1.0;   // positions are scaled by the mesh (frustum culling sees it)
  const v0 = sh.vertexShader;
  sh.vertexShader = v0.replace(/transformed\.xz\s*\*=\s*0\.996;\s*transformed\.y\s*-=\s*0\.6;/, '')
    // BD40: the chunk's per-vertex open-sky share (tools/lod/shellkit.mjs aoPass) on the sky term; none (0) reads as open
    .replace('#include <common>', '#include <common>\nattribute float ao; varying float vLodAO;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodAO = ao > 0.001 ? ao : 1.0;');
  if (sh.vertexShader === v0) warnOnce('far vertex offset not found');
  let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFade; uniform float uFadeMode; varying float vLodAO;');
  const f1 = f.replace(/if\s*\(\s*farHidden\(vWPos\.xz\)\s*\)\s*discard;/, (m) => `{ float lodH = ${IGN};
          if (uFadeMode < 0.5 ? lodH >= uFade : lodH < 1.0 - uFade) discard; }
        ${nearMask ? m : '/* BD40: the backdrop lies outside the city, where no near tile draws */'}`);
  if (f1 === f) { warnOnce('near-mask test not found; fade dither at the top of the colour block'); f = f.replace('#include <color_fragment>', `#include <color_fragment>\n{ float lodH = ${IGN}; if (uFadeMode < 0.5 ? lodH >= uFade : lodH < 1.0 - uFade) discard; }`); } else f = f1;
  const f2 = f.replace(/vec2 cell = floor\(vec2\(vWPos\.x \+ vWPos\.z \* 0\.7, vWPos\.y\) \/ 3\.0\);\s*float sp = step\(hash12\(cell\), vColor\.a \* 0\.28\) \* night;/, `
        // night windows: a lit cell is a window (70 x 65 % of its bay) with the lit share as its chance; where a bay is
        // under two pixels the cells are taken 2, 4, 8... bays at a time (the same chance and glazed share, so the same
        // mean light), blended across octaves: points of light that stay a pixel or two wide instead of sub-pixel
        // sparkle or a flat glow
        // the bays and floors of the FW14 window grid where it is on (4 x 4 per 12 x 15.2 m tile), else 3 m world cells
        #ifdef USE_MAP
        vec2 lodWq = vMapUv * 4.0;
        #else
        vec2 lodWq = vec2(vWPos.x + vWPos.z * 0.7, vWPos.y) / 3.0;
        #endif
        float lodPx = max(length(fwidth(lodWq)), 1e-4);
        float lodL = max(0.0, log2(lodPx * 2.0));
        float lodL0 = floor(lodL), lodFr = lodL - lodL0;
        float lodP = vColor.a * 0.28;
        float sp = 0.0;
        for (int k = 0; k < 2; k++) {
          float lodS = exp2(lodL0 + float(k));
          vec2 lodQ = lodWq / lodS, lodC = floor(lodQ), lodF = fract(lodQ);
          float lodWin = step(0.15, lodF.x) * step(lodF.x, 0.85) * step(0.2, lodF.y) * step(lodF.y, 0.85);
          sp += step(hash12(lodC + vec2(17.0 * (lodL0 + float(k)), 3.0)), lodP) * lodWin * (k == 0 ? 1.0 - lodFr : lodFr);
        }
        vec3 lodN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        sp *= night * (1.0 - smoothstep(0.5, 0.8, abs(lodN.y)));`);
  if (f2 === f) warnOnce('night window stipple not found (unfiltered)');
  // a wall sees at most half the sky, and less in a street canyon: the ambient on vertical faces is scaled by a sky-view
  // factor (the far boxes baked an orientation shade into their colours instead; these colours are albedo)
  const f3 = f2.replace(/vec3 light = skyAmbF \* \(0\.8 \+ 0\.3 \* max\(N\.y, 0\.0\)\) \* caoV/, (m) => `${m} * mix(${WALL_SKY.toFixed(3)}, 1.0, abs(N.y)) * vLodAO`);
  if (f3 === f2) warnOnce('far light term not found (no wall sky-view factor)');
  // no direct sun once it is under the horizon (the far term lit west walls orange all night from a sun at -14 degrees)
  const f4 = f3.replace('sunColF * ndl * 1.05', 'sunColF * ndl * 1.05 * smoothstep(-0.06, 0.04, sunDirF.y)');
  if (f4 === f3) warnOnce('far sun term not found (no horizon cut)');
  sh.fragmentShader = f4;
}

// { nearMask: false } (BD40): the backdrop's buildings (tools/lod/build_backdrop.mjs) lie outside the city's line, where no
// near tile draws, so the near mask (per 512 m tile) must not hide them: a tile over the Arthur Kill or a land border
// would blank the New Jersey or Westchester buildings inside its square
export function makeShellMaterial({ nearMask = true } = {}) {
  const mat = makeFarMaterial();
  const base = mat.onBeforeCompile;
  const U = { uFade: { value: 1 }, uFadeMode: { value: 0 } };
  mat.userData.lod = U;
  mat.onBeforeCompile = function (sh, renderer) { base.call(this, sh, renderer); patch(sh, U, nearMask); };
  mat.customProgramCacheKey = nearMask ? () => 'lod16-shell-v2' : () => 'lod16-shell-v2-nm0';   // (v2, BD40: the AO term)
  // where a near tile draws a building that reaches past the tile's edge, its shell outside the edge (the near mask is per
  // tile) lies on the same walls: a depth offset lets the near geometry win there instead of z-fighting
  mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2;
  mat.name = 'lod16Shell';
  return mat;
}
