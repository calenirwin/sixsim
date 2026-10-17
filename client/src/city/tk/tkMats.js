// Tower kit (TW): materials. Walls, stone, metal and spandrel panels come from the PBR library (mat/pbrLib.js) through the
// facade kit's shared bases (fk/kitMats.js kitMat: one material per set, the record's colour per vertex as aFkTr), so a
// tower adds no program and the cell packages carry the set's name for Unreal and Blender. Instanced parts (frames,
// mullions, sills, piers) take a small palette of finishes, one material each (an instance has no tint of its own).
//
// The glass is the kit's own: an opaque pane over the room (the curtain-wall families of the facade shader, or a
// punched window's room), the facade shader's sky mirror (applySkyGlass), shades by day, and at night the facade shader's
// lit rooms: the same hash of (bay, floor, wall seed, building seed) as materials.js, so near and far light the same
// windows. Per pane the attribute aTkW = (bay on its wall, floor, wall seed, building seed + 4 if residential).
import * as THREE from 'three';
import { ENV, applySkyGlass, applyLightTrim, makeFacadeMaterial } from '../../world/materials.js';
import { kitMat, matsReady } from '../fk/kitMats.js';
import { GLASS_FAMS } from './tkParams.js';

let PBR = null;
export const tkMatsReady = Promise.all([matsReady, import('../mat/pbrLib.js').then((m) => { PBR = m; }).catch(() => {})]);

const HASH = /* glsl */ `
  float tkh12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`;
// the facade shader's room (materials.js inWin): span, roomK, the lit share by night, the lamp colour
const ROOM = /* glsl */ `
  float tkCellU = vTkW.x, tkCellV = vTkW.y, tkWs = vTkW.z;
  float tkResi = vTkW.w >= 4.0 ? 1.0 : 0.0;
  float tkCv = vTkW.w - tkResi * 4.0;
  float tkUS = tkCellU + tkWs * 37.0;
  float tkSpan = 2.0 + step(0.55, tkh12(vec2(floor(tkUS / 2.0), tkCellV + tkCv * 7.0)));
  float tkRoomK = floor(tkCellU / tkSpan) + tkWs * 53.0;
  float tkId2 = tkh12(vec2(tkCellV * 3.7 + tkCv * 131.0, tkRoomK * 1.3));
  float tkId3 = tkh12(vec2(tkRoomK * 7.9, tkCellV * 5.1 + tkCv * 57.0));
  float tkLitN = smoothstep(0.15, 0.60, tkNight);
  float tkLitF = tkResi > 0.5 ? mix(0.20, 0.44, tkLitN) : mix(0.42, 0.56, tkLitN);
  float tkLit = step(1.0 - tkLitF, tkId3);
  { float wPh = tkh12(vec2(tkCellU * 7.3 + tkWs * 3.0, tkCellV * 11.1 + tkCv * 5.0));
    if (wPh < 0.12) tkLit = step(0.0, sin(tkTime * (0.011 + wPh * 0.02) + wPh * 251.0)); }
  vec3 tkLamp = tkId2 < 0.88 ? mix(vec3(1.0, 0.72, 0.27), vec3(1.0, 0.89, 0.61), tkh12(vec2(tkCellU, tkCellV + 9.0)))
                             : mix(vec3(0.87, 0.91, 1.0), vec3(0.62, 0.71, 1.0), tkh12(vec2(tkCellV, tkCellU + 4.0)));
  // a room's shade: drawn to its own height (residential: a roller shade on 42 % of rooms; office: venetians on 60 %)
  float tkShR = tkh12(vec2(tkRoomK * 3.1 + tkCv * 17.0, tkCellV * 2.9));
  float tkShH = tkh12(vec2(tkRoomK * 5.7, tkCellV * 1.3 + tkCv * 23.0));
  float tkShade = step(tkShR, tkResi > 0.5 ? 0.42 : 0.6) * (0.15 + 0.75 * tkShH);
`;

// the room behind a pane (interior mapping): the pane's frame from its normal, the view ray into a box of the pane's width
// plus the piers, the floor below the sill, the ceiling under the next slab and a depth per room; the walls, floor and
// ceiling shaded by the daylight that reaches them (less with depth), or at night by the room's lamp. The shade hangs just
// behind the glass. The room is emissive (it is not lit by the sun on the facade), the pane's own surface nearly black,
// and applySkyGlass lays the sky's reflection over both by the Fresnel term.
function glassRooms(mat, o) {
  const cw = o.kind === 'cw';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tkNight = ENV.night;
    sh.uniforms.tkTime = ENV.time;
    sh.uniforms.tkSky = ENV.skyAmbient;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTkW; attribute vec4 aTkS; flat varying vec4 vTkW; flat varying vec4 vTkS; varying vec2 vTkUv;
        varying vec3 vTkWP; varying vec3 vTkN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTkW = aTkW; vTkS = aTkS; vTkUv = uv; vTkN = normalize(mat3(modelMatrix) * normal);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vTkWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float tkNight; uniform float tkTime; uniform vec3 tkSky;
        flat varying vec4 vTkW; flat varying vec4 vTkS; varying vec2 vTkUv; varying vec3 vTkWP; varying vec3 vTkN;${HASH}
        vec3 tkRoomRad = vec3(0.0);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        ${ROOM}
        vec3 Np = normalize(vTkN);
        vec3 Tp = normalize(cross(vec3(0.0, 1.0, 0.0), Np));
        vec3 Bp = cross(Np, Tp);
        vec3 Vw = normalize(vTkWP - cameraPosition);
        vec3 d = vec3(dot(Vw, Tp), dot(Vw, Bp), min(dot(Vw, Np), -0.02));
        float W = vTkS.x, Hh = vTkS.y, sill = vTkS.z, fh = vTkS.w;
        vec3 p = vec3(vTkUv.x * W, vTkUv.y * Hh, 0.0);
        float D = mix(3.2, 6.5, tkh12(vec2(tkRoomK * 1.9, tkCellV * 0.7 + tkCv * 9.0)));
        float xl = -0.55, xr = W + 0.55, yf = -sill, yc = max(Hh + 0.12, fh - sill - 0.3);
        float tx = d.x > 0.0 ? (xr - p.x) / max(d.x, 1e-4) : (xl - p.x) / min(d.x, -1e-4);
        float ty = d.y > 0.0 ? (yc - p.y) / max(d.y, 1e-4) : (yf - p.y) / min(d.y, -1e-4);
        float tz = -D / d.z;
        float t = min(tx, min(ty, tz));
        vec3 h = p + d * t;
        float dz = clamp(-h.z / D, 0.0, 1.0);
        vec3 wallC = mix(vec3(0.50, 0.47, 0.42), vec3(0.62, 0.60, 0.56), tkh12(vec2(tkRoomK * 4.1, tkCellV * 2.2 + tkCv)));
        if (tkh12(vec2(tkRoomK * 9.7, tkCellV * 3.1)) < 0.18) wallC *= vec3(0.78, 0.84, 0.92);
        vec3 c; float lk;
        if (t == tz) {
          c = wallC * 0.85; lk = 0.30;
          // furniture and fittings against the back wall: a dark band low down, a lighter one at desk height
          float fy = h.y - yf;
          c *= fy < 0.85 ? mix(0.45, 0.75, tkh12(vec2(floor((h.x + 3.0) * 1.3), tkRoomK))) : 1.0;
        } else if (t == ty) {
          bool ceil = d.y > 0.0;
          c = ceil ? vec3(0.66, 0.65, 0.62) : mix(vec3(0.20, 0.16, 0.12), vec3(0.32, 0.31, 0.30), tkh12(vec2(tkRoomK, 3.3)));
          lk = mix(ceil ? 0.75 : 1.0, 0.28, dz);
        } else { c = wallC * 0.72; lk = mix(0.95, 0.30, dz); }
        // daylight into the room (the sky's level), the lamps at night (ceiling lights over the lit rooms)
        float day = clamp(dot(tkSky, vec3(0.30, 0.59, 0.11)) * 1.6, 0.0, 1.0) * (1.0 - tkNight);
        vec3 lampC = tkLamp * tkLit * mix(0.55, 1.25, (t == ty && d.y > 0.0) ? 1.0 : 1.0 - dz * 0.6);
        vec3 room = c * lk * 0.30 * day + c * lampC * 0.85 * smoothstep(0.05, 0.6, tkNight);
        // the shade: just behind the glass, from the head down to its height; daylight through the cloth, the lamp behind it
        float py = vTkUv.y;
        float onS = step(1.0 - tkShade, py);
        float fold = 0.9 + 0.1 * sin(vTkUv.x * W * 31.0 + tkRoomK);
        vec3 shadeC = (tkResi > 0.5 ? vec3(0.78, 0.74, 0.66) : vec3(0.70, 0.71, 0.70)) * fold;
        vec3 shadeR = shadeC * (0.22 * day + 0.45 * tkLamp * tkLit * smoothstep(0.05, 0.6, tkNight));
        room = mix(room, shadeR, onS);
        tkRoomRad = room * ${cw ? 'vec3(0.38, 0.42, 0.43)' : 'vec3(0.86, 0.90, 0.89)'};
        diffuseColor.rgb = ${cw ? 'diffuseColor.rgb' : 'vec3(0.012)'};
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += tkRoomRad;`);
  };
  mat.customProgramCacheKey = () => 'tkRooms2|' + o.kind;
}

const _glass = new Map();
// curtain-wall glass of family f (GLASS_FAMS, the facade shader's four)
export function cwGlassMat(f) {
  // f: an index into GLASS_FAMS, or a family object of the same shape (a landmark's own glass: { key, alb, f0, rough, tint, pbr })
  const F = typeof f === 'object' && f ? f : GLASS_FAMS[f];
  let m = _glass.get('cw' + F.key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(F.alb[0] * 1.6, F.alb[1] * 1.6, F.alb[2] * 1.6), roughness: 0.12, metalness: 0 });
  glassRooms(m, { kind: 'cw' });
  applySkyGlass(m, { f0: F.f0, rough: F.rough, tint: F.tint, aureole: 1.6 });
  m.name = 'tk:glass_' + F.key;
  m.userData.pbr = { name: F.pbr || (F.key === 'blue' ? 'glass_tower_blue' : F.key === 'bronze' || F.key === 'gold' ? 'glass_tower_bronze' : 'glass_tower_grey'), opts: {} };
  m.userData.tkGlass = F.key;
  _glass.set('cw' + F.key, m);
  return m;
}
// a punched window's pane over its room
export function winGlassMat() {
  let m = _glass.get('win');
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.055, 0.052, 0.048), roughness: 0.1, metalness: 0 });
  glassRooms(m, { kind: 'win' });
  applySkyGlass(m, { f0: 0.06, rough: 0.04, tint: [0.96, 0.99, 1.0], aureole: 1.3 });
  m.name = 'tk:glass_window';
  m.userData.pbr = { name: 'glass_vision_grey', opts: {} };
  m.userData.tkGlass = 'win';
  _glass.set('win', m);
  return m;
}
// a shared surface (walls, spandrels, stone trim) for merged geometry: the fk handle (base material + the tint ratio)
export function surfMat(set, tint) {
  return kitMat(set, { tint, weather: true });
}
// the kit's parts keep the day's light trim at night: applyLightTrim lifts a trimmed diffuse from 0.30 by day to 0.88
// after dark (the lamp-lit street's look); up a tower no lamp lights a mullion, a sill or a fin, and the facade shader
// they stand on does not lift, so at 300-700 m their lift turned the towers pale beside the tile's (shots/night2 under
// the lane's aux folder: the shader's albedo matched, the parts did not). x0.34 at night is the day's 0.30 of 0.88.
function nightKeep(m) {
  if (m.userData.tkNight) return m;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.tkNightK = ENV.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float tkNightK;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n      diffuseColor.rgb *= mix(1.0, 0.34, tkNightK);');
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|tkNight';
  m.userData.tkNight = true;
  m.needsUpdate = true;
  return m;
}
// an instanced part's material: the set at a fixed finish (one per set and tint; the library's own material for the set
// is not touched: the kit asks for its own instance, `tkNight` in the options)
const _part = new Map();
export function partMat(set, tint) {
  const key = set + '|' + (tint || '');
  let m = _part.get(key);
  if (m) return m;
  if (PBR) {
    try { m = PBR.pbrMaterial(set, tint ? { tint, tkNight: 1 } : { tkNight: 1 }); } catch (e) { m = null; }
  }
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint || '#9a9a96'), roughness: 0.6, metalness: /^(alu|stainless)/.test(set) ? 0.6 : 0 });
    applyLightTrim(m);
    m.name = 'tk:' + set;
  }
  nightKeep(m);
  _part.set(key, m);
  return m;
}

// the lit windows of the cell packages after dark (Unreal and Blender have no facade shader to light the rooms): unlit
// quads over the panes whose rooms the shader lights at night, in the dresser's lit-window colour; built only while the
// cell baker holds a region (world/towerKit.js), so the page itself never draws them. `tkNightOnly`: the baker marks
// their nodes night-only (cells/bakeLib.js takeMesh), the package's renderer draws them after dark alone
const _lit = new Map();
// the landmarks' night windows (built with the landmark, hidden until a baker holds a region: world/towerKit.js setRegion)
export const TW_NIGHT = new Set();
let _twNightAdds = 0;
export function holdNight(m) {
  m.visible = false;
  TW_NIGHT.add(m);
  if (++_twNightAdds % 64 === 0) {   // (a landmark's group leaves the scene with its tile: its night meshes go from the set)
    for (const q of TW_NIGHT) { let r = q; while (r.parent) r = r.parent; if (!r.isScene) TW_NIGHT.delete(q); }
  }
}
export function litWinMat(kind) {
  let m = _lit.get(kind);
  if (m) return m;
  const c = { warm: [0.434, 0.254, 0.107], hi: [0.87, 0.51, 0.21], dim: [0.12, 0.071, 0.03], cool: [0.25, 0.29, 0.36] }[kind] || [0.434, 0.254, 0.107];
  m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
  m.name = 'tk:litWindow' + (kind === 'warm' ? '' : '_' + kind);
  m.userData.tkNightOnly = true;
  _lit.set(kind, m);
  return m;
}

// the tile facade shader as the kit's wall and pane material (city/tk/tkBuild.js FacSink): one instance per PBR name (the
// set Unreal and Blender bind for it), every instance the same program
const _fac = new Map();
// what a renderer without the facade shader reads (the shader takes neither: its roughness is its own, per fragment, and
// the PBR name is metadata): the sets Unreal's and Blender's HQ tables know for the kit's own variants, and for the glass
// sets an opaque, smooth, dark pane in place of the wall's vertex colour and the material's 0.92 (cells/bakeLib.js
// describeMat writes these into the exported record: linear colour, whether the vertex colour still multiplies, roughness);
// the curtain walls keep their building's tint (the vertex colour) at a fifth, near the landmarks' glass (0.03-0.13)
const EXP_SET = { stone_lime_ashlar: 'stone_lime', stone_lime_rusticated: 'stone_lime', brick_white_glazed: 'brick_painted' };
const EXP_GLASS = {
  glass_vision_grey: ['0.055,0.052,0.048', false, 0.1], glass_storefront: ['0.045,0.045,0.043', false, 0.08],
  glass_tower_blue: ['0.22,0.22,0.22', true, 0.12], glass_tower_grey: ['0.22,0.22,0.22', true, 0.12],
  glass_tower_bronze: ['0.22,0.22,0.22', true, 0.12], glass_tower: ['0.22,0.22,0.22', true, 0.12],
};
export function tkFacadeMat(pbrName) {
  let m = _fac.get(pbrName);
  if (m) return m;
  m = makeFacadeMaterial({ hideTex: null });
  m.name = 'tk:fac:' + pbrName;
  m.userData.pbr = { name: EXP_SET[pbrName] || pbrName, opts: {} };
  m.userData.tkFac = true;
  const g = EXP_GLASS[pbrName];
  if (g) { m.userData.tkExpLin = g[0]; m.userData.tkExpVC = g[1]; m.userData.tkExpRough = g[2]; }
  _fac.set(pbrName, m);
  return m;
}
