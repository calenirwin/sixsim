// The backdrop's ground at the far levels (?lod16=1; tools/lod/backdrop_ground.py, docs/notes/r2-backdrop.md): the
// chunk's own top-down texture (land use and cover, roads, railways, canopy, the water the charts leave dry) lit like the
// far city (world/materials.js makeFarMaterial: the live sun and sky, no direct sun under the horizon, the weather), with
// smooth normals from the terrain, the skirts' shade, the night map's street lights and lit lots after dark, and the
// persistent tier's dithered cross-fade (uFade, uFadeMode). It is never hidden by the near mask: the backdrop lies
// outside the city, where no near tile draws (under the New Jersey landing patches it lies 0.3 m below them).
import * as THREE from 'three';
import { ENV } from '../world/materials.js';

const IGN = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))';

export function makeGroundMaterial(map, nightMap) {
  const mat = new THREE.MeshBasicMaterial({ map, fog: true });
  const U = { uFade: { value: 1 }, uFadeMode: { value: 0 }, nightMap: { value: nightMap } };
  mat.userData.lod = U;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = U.uFade;
    sh.uniforms.uFadeMode = U.uFadeMode;
    sh.uniforms.nightMap = U.nightMap;
    sh.uniforms.night = ENV.night;
    sh.uniforms.wet = ENV.wet;
    sh.uniforms.snowA = ENV.snow;
    sh.uniforms.sunDirF = ENV.sunDir;
    sh.uniforms.sunColF = ENV.sunColor;
    sh.uniforms.skyAmbF = ENV.skyAmbient;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float shade; varying float vShade; varying vec3 vNw; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vShade = shade; vNw = normalize(mat3(modelMatrix) * normal);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFade; uniform float uFadeMode; uniform sampler2D nightMap;
        uniform float night; uniform float wet; uniform float snowA;
        uniform vec3 sunDirF; uniform vec3 sunColF; uniform vec3 skyAmbF;
        varying float vShade; varying vec3 vNw; varying vec3 vWPos;
        float bdHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float bdNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bdHash(i), bdHash(i + vec2(1, 0)), f.x), mix(bdHash(i + vec2(0, 1)), bdHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        { float lodH = ${IGN}; if (uFadeMode < 0.5 ? lodH >= uFade : lodH < 1.0 - uFade) discard; }
        #include <map_fragment>`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // (the map is sRGB: three decodes it to linear)
        vec3 N = normalize(vNw);
        // steep ground (the Palisades' faces, bluffs, cuts) is rock: the top-down texture would only smear down a slope; dark
        // diabase with vertical joints and ledges, from world space so it holds still across chunks and levels
        {
          float steep = 1.0 - smoothstep(0.42, 0.68, N.y);
          vec2 rq = vec2(dot(vWPos.xz, vec2(0.7071, 0.7071)) * 0.35, vWPos.y * 0.12);
          float joints = bdNoise(vec2(rq.x * 3.0, rq.y * 0.4)) * 0.6 + bdNoise(rq * 9.0) * 0.4;
          vec3 rock = vec3(0.105, 0.098, 0.090) * (0.65 + 0.7 * joints);
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep * 0.9);
        }
        float ndl = max(dot(N, sunDirF), 0.0) * smoothstep(-0.06, 0.04, sunDirF.y);
        vec3 light = skyAmbF * (0.8 + 0.3 * max(N.y, 0.0)) + sunColF * ndl * 1.05;
        diffuseColor.rgb *= light * vShade;
        diffuseColor.rgb *= (1.0 - night * 0.55);
        diffuseColor.rgb *= 1.0 - 0.3 * wet * (0.6 + 0.4 * bdNoise(vWPos.xz * 0.031));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), snowA * max(N.y, 0.0) * (0.4 + 0.4 * bdNoise(vWPos.xz * 0.06)));
        // street lights and lit lots after dark (the night map, grey); sodium and LED mixed by place
        float nl = texture2D(nightMap, vMapUv).r;
        float led = bdNoise(vWPos.xz * 0.0011);
        vec3 lampC = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.93, 0.82), smoothstep(0.35, 0.75, led));
        diffuseColor.rgb += lampC * nl * nl * night * 1.1;
        diffuseColor.a = 1.0;
      }`);
  };
  mat.customProgramCacheKey = () => 'lod16-bdground-v2';
  mat.name = 'lod16BdGround';
  return mat;
}

// a chunk's JPEG bytes as a texture (decoded off the main thread); flipY off: v = 0 is the image's first row (north)
export async function jpegTexture(bytes, srgb = true) {
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bmp = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
