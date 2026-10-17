// BD40 (backdrop lane): the frame of the tiles' facade master's code (tools/ue/bd_tilefac_port.py fills it from the page's
// own program; tools/ue/bd_tilefac.py builds the master). Inputs: UV0 the facade's uv (wall metres, height above the
// building's base), UV1-UV2 aux, UV3-UV4 aux2, UV5 + UV6.x aux3, UV6.y + UV7 the vertex colour (tools/ue/r1c_glbuv.py),
// WPA the pixel's absolute world position and CAM the camera's (cm), NWS the vertex normal (world), the take's night and
// weather, the sun the records carry, the TQ32 region, the facade's textures. Outputs: the return value (base colour),
// Emis, Rough, Metal, Spec, NrmW (a world-space normal: the material's tangent-space normal is off).
struct BDH {
  // GB43: the page's derivative fades (a window, a mullion, a joint collapsed to its mean once it nears a pixel) were made
  // for one sample a pixel; Unreal's frames take 8 jittered samples, so they fade at a fraction of the width (AAK)
  float fwk(float x) { return fwidth(x) * 0.35; }
  float2 fwk(float2 x) { return fwidth(x) * 0.35; }
  float3 fwk(float3 x) { return fwidth(x) * 0.35; }
  float gmod(float x, float y) { return x - y * floor(x / y); }
  float hash12(float2 p) { float3 p3 = frac(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return frac((p3.x + p3.y) * p3.z); }
  float vnoise(float2 p) {
    float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(hash12(i), hash12(i + float2(1, 0)), f.x), lerp(hash12(i + float2(0, 1)), hash12(i + float2(1, 1)), f.x), f.y);
  }
  float fbm(float2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.25 + vnoise(p * 7.1) * 0.15; }
  float pcovI(float x, float lo, float hi) { return floor(x) * (hi - lo) + clamp(frac(x) - lo, 0.0, hi - lo); }
  float pcov(float x, float lo, float hi, float w) {
    w = max(w, 1e-5);
    return clamp((pcovI(x + 0.5 * w, lo, hi) - pcovI(x - 0.5 * w, lo, hi)) / w, 0.0, 1.0);
  }
  float wlh(float a, float b) {
    float s = gmod(a * 127.0 + b * 311.0 + 7.0, 4093.0);
    s = gmod(s * s + 1153.0, 4093.0);
    s = gmod(s * 137.0 + 59.0, 4093.0);
    s = gmod(s * s + 2411.0, 4093.0);
    return s * (1.0 / 4093.0);
  }
  float wlsg(float a, float b) { return wlh(a, b) * 2.0 - 1.0; }
  float fresnelR(float cosT, float f0) { return f0 + (1.0 - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0); }
  // (the page's painted reflections: Unreal reflects for itself)
  float3 skyLook(float3 R, float3 sunD, float3 sunC, float3 zenC, float3 horC, float gain, float aur) { return float3(0.0, 0.0, 0.0); }
  float sunDisc(float3 R, float3 sunD, float rough, float fp) { return 0.0; }
  // three.js's world (x east, y up, z south, metres) and Unreal's (x, y, z up, cm): the same axes with y and z swapped
  float3 tw2ue(float3 d) { return float3(d.x, d.z, d.y); }
  // three.js's view space (x right, y up, z towards the viewer) from a world direction, and back; Unreal's view z looks away
  float3 V3(float3 dTW) { float3 v = mul(float4(tw2ue(dTW), 0.0), View.TranslatedWorldToView).xyz; return float3(v.x, v.y, -v.z); }
  float3 W3(float3 v3) { float3 w = mul(float4(v3.x, v3.y, -v3.z, 0.0), View.ViewToTranslatedWorld).xyz; return tw2ue(w); }
};
BDH H;
float2 vFUv = UV0;
float4 vAux = float4(UV1, UV2);
float4 vAux2 = float4(UV3, UV4);
float3 vAux3 = float3(UV5, UV6.x);
float3 vWP = H.tw2ue(WPA * 0.01);
float3 cameraPosition = H.tw2ue(CAM * 0.01);
float3 vNormal = H.V3(normalize(H.tw2ue(NWS)));
float3 vViewPosition = -H.V3(vWP - cameraPosition);
float night = NightV, wet = WetV, snowA = SnowV, uTimeF = TimeF;
float3 sunDirW = normalize(SunD), sunColW = SunC;
float lbRoof = LbRoof, lb14Roof = Lb14Roof;
float uRefl = 0.0;
float3 uZenC = float3(0.28, 0.40, 0.57), uHorC = float3(0.62, 0.69, 0.76);
float4 tq32C = Tq32C; float tq32On = Tq32On;
const bool RS30 = true;
float3 FAC_emis = float3(0.0, 0.0, 0.0); float FAC_rough = 0.92; float3 FAC_nrmAdj = float3(0.0, 0.0, 0.0);
float FAC_dbg = 0.0; float3 FAC_dbgV = float3(0.0, 0.0, 0.0); float3 FAC_grainV = float3(1.0, 1.0, 1.0);
float3 FAC_glassF = float3(0.045, 0.55, 0.5); float3 FAC_reflTint = float3(1.0, 1.0, 1.0); float FAC_spand = 0.0;
float FAC_sunK = 1.0; float FAC_metal = 0.0;
float UE_glass = 0.0, UE_f0 = 0.04;
float4 diffuseColor = float4(UV6.y, UV7.x, UV7.y, 1.0) * float4(Tint, 1.0);
// ---- the page's colour block
/*@COLOUR@*/
// ---- roughness: the facade's, then rain-damp masonry
float roughnessFactor = FAC_rough;
{
  float dampF = wet * smoothstep(0.5, 0.85, FAC_rough);
  diffuseColor.rgb *= 1.0 - 0.26 * dampF;
  roughnessFactor = lerp(roughnessFactor, 0.4, dampF * 0.55);
}
float metalnessFactor = max(0.0, FAC_metal);
// ---- the normal: the page's, in its view space
float3 normal = normalize(vNormal);
/*@NORMAL@*/
// (three's geometric specular AA, applySpecAA: sigma2 0.25, kappa 0.14)
{
  float3 ndx = ddx(normal), ndy = ddy(normal);
  float variance = 0.25 * (dot(ndx, ndx) + dot(ndy, ndy));
  float kernel = min(2.0 * variance, 0.14);
  roughnessFactor = min(sqrt(roughnessFactor * roughnessFactor + kernel), 1.0);
}
// ---- glass: the family's F0 (tinted) and its own dark diffuse; above Unreal's 0.08 dielectric ceiling partly metallic
float3 base = diffuseColor.rgb;
float metal = metalnessFactor;
float spec = 0.5;
float g = saturate(UE_glass);
if (g > 0.0) {
  float3 f3 = UE_f0 * FAC_reflTint;
  float f = dot(f3, float3(0.2126, 0.7152, 0.0722));
  float d = max(dot(base, float3(0.2126, 0.7152, 0.0722)), 1e-4);
  if (f <= 0.08) {
    spec = lerp(0.5, f / 0.08, g);
  } else {
    // diffuse d and F0 f with Specular 0.5: base (1 - m) = d, 0.04 (1 - m) + m base = f
    float x = clamp(((d + f) - sqrt(max((d + f) * (d + f) - 0.16 * d, 0.0))) / 0.08, 0.05, 1.0);
    float m = 1.0 - x;
    float3 b = m > 1e-3 ? max((f3 - 0.04 * x) / m, 0.0) : base;
    base = lerp(base, b, g);
    metal = lerp(metal, m, g);
  }
}
Emis = FAC_emis * EmisK;
Rough = roughnessFactor;
Metal = saturate(metal);
Spec = spec;
NrmW = normalize(H.tw2ue(H.W3(normal)));
return base;
