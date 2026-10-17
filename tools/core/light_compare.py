"""The headless light of a take (tools/core/light_bake.mjs) against the page's harvested light files of the same shot:
every value of lights.json and light_static.json, the per-frame exposure, bloom and headlamp beams, the street lamps (each
harvested lamp inside the cells' region matched to the nearest headless one) and the two sky domes pixel by pixel.

    python3 tools/core/light_compare.py --mine <dir> --page <harvest dir> --shot <shot> [--json out.json]
"""
import argparse
import json
import math
import os

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--mine', required=True)
ap.add_argument('--page', required=True)
ap.add_argument('--shot', required=True)
ap.add_argument('--json', default=None)
a = ap.parse_args()
J = lambda d, f: json.load(open(os.path.join(d, f)))
rows, diffs = [], []


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def cmp(path, m, p, tol=1e-4):
    """record every leaf that differs by more than tol (relative for numbers)"""
    if isinstance(m, dict) and isinstance(p, dict):
        for k in sorted(set(m) | set(p)):
            if k in ('when', 'stats', 'at', 'file', 'ok', 'lampsFirstFrame', 'lampsAt'): continue
            cmp(f'{path}.{k}', m.get(k), p.get(k), tol)
        return
    if isinstance(m, list) and isinstance(p, list) and len(m) == len(p) and all(num(v) for v in m + p):
        if any(abs(x - y) > tol * max(1.0, abs(y)) for x, y in zip(m, p)): diffs.append((path, m, p))
        return
    if num(m) and num(p):
        if abs(m - p) > tol * max(1.0, abs(p)): diffs.append((path, m, p))
        return
    if m != p: diffs.append((path, m, p))


LSm, LSp = J(a.mine, 'light_static.json'), J(a.page, 'light_static.json')
LJm, LJp = J(a.mine, 'lights.json'), J(a.page, 'lights.json')
for k in ('mode', 'night', 'preset', 'toneMapping', 'exposure', 'envIntensity', 'hdri', 'bloom', 'grade', 'haze', 'fog', 'skyUniforms', 'envSkyUniforms', 'lampRig', 'headlamps'):
    cmp(f'light_static.{k}', LSm.get(k), LSp.get(k))
# the sun: its direction (the page puts it relative to the lens), colour, intensity, visibility
def sdir(S):
    s = S.get('sun') or {}
    if not s.get('pos') or not s.get('target'): return None
    d = np.array(s['pos']) - np.array(s['target'])
    return d / (np.linalg.norm(d) or 1)
dm, dp = sdir(LSm), sdir(LSp)
sun_ang = float(np.degrees(np.arccos(np.clip(np.dot(dm, dp), -1, 1)))) if dm is not None and dp is not None else None
for k in ('color', 'intensity', 'visible'):
    cmp(f'light_static.sun.{k}', (LSm.get('sun') or {}).get(k), (LSp.get('sun') or {}).get(k))
# lights.json: the lights by type and name
def lights_by(LJ):
    out = {}
    for L in LJ.get('lights', []):
        out.setdefault((L['type'], L.get('name') or ''), []).append(L)
    return out
Bm, Bp = lights_by(LJm), lights_by(LJp)
for key in sorted(set(Bm) | set(Bp)):
    lm, lp = Bm.get(key, []), Bp.get(key, [])
    if len(lm) != len(lp):
        diffs.append((f'lights.json {key[0]} "{key[1]}" count', len(lm), len(lp)))
    for i, (x, y) in enumerate(zip(lm, lp)):
        for k in ('color', 'intensity', 'groundColor', 'castShadow', 'visible', 'distance'):
            cmp(f'lights.json {key[0]} "{key[1]}"[{i}].{k}', x.get(k), y.get(k))
for k in ('toneMapping', 'exposure', 'environmentIntensity', 'fog', 'background'):
    cmp(f'lights.json.{k}', LJm.get(k), LJp.get(k))
# the street lamps: every harvested lamp inside the area the headless ones cover, matched to the nearest headless lamp
Lm = np.array([s[:3] for s in LSm.get('lamps') or []], dtype=float).reshape(-1, 3)
Lp_all = LSp.get('lamps') or []
lamp = {'mine': len(Lm), 'page': len(Lp_all)}
if len(Lm) and Lp_all:
    x0, x1, z0, z1 = Lm[:, 0].min() - 10, Lm[:, 0].max() + 10, Lm[:, 2].min() - 10, Lm[:, 2].max() + 10
    Lp = [s for s in Lp_all if x0 <= s[0] <= x1 and z0 <= s[2] <= z1]
    d, same_fix, same_mount = [], 0, 0
    for s in Lp:
        dd = np.hypot(Lm[:, 0] - s[0], Lm[:, 2] - s[2]); j = int(dd.argmin()); d.append(float(dd[j]))
        mj = (LSm['lamps'])[j]
        same_fix += int(mj[3] == s[3]); same_mount += int(abs((mj[4] or 0) - (s[4] or 0)) < 1e-3)
    d = np.array(d)
    lamp.update({'page_in_area': len(Lp), 'matched_within_0.1m': int((d < 0.1).sum()), 'median_m': float(np.median(d)) if len(d) else None, 'max_m': float(d.max()) if len(d) else None,
                 'same_fixture': same_fix, 'same_mount': same_mount})
# per frame
Fm, Fp = J(a.mine, f'light_{a.shot}.json'), J(a.page, f'light_{a.shot}.json')
n = min(len(Fm), len(Fp))
em = np.array([f['exposure'] for f in Fm[:n]]); ep = np.array([f['exposure'] for f in Fp[:n]])
frame = {'frames': [len(Fm), len(Fp)], 'exposure_mine': [float(em.min()), float(em.max())], 'exposure_page': [float(ep.min()), float(ep.max())],
         'exposure_ratio_page_over_mine': float((ep / em).mean()),
         'bloom_mine': Fm[0].get('bloom'), 'bloom_page': Fp[0].get('bloom'),
         'beams_per_frame_mine': [min(len(f.get('spots') or []) for f in Fm), max(len(f.get('spots') or []) for f in Fm)],
         'beams_per_frame_page': [min(len(f.get('spots') or []) for f in Fp), max(len(f.get('spots') or []) for f in Fp)]}
sp_m = [s for f in Fm for s in f.get('spots') or []]; sp_p = [s for f in Fp for s in f.get('spots') or []]
if sp_m and sp_p:
    frame['beam_constants_mine'] = sorted({(s['i'], s['a'], s['pe'], s['d']) for s in sp_m})
    frame['beam_constants_page'] = sorted({(s['i'], s['a'], s['pe'], s['d']) for s in sp_p})
    frame['beam_colours_mine'] = sorted({tuple(round(c, 4) for c in s['c']) for s in sp_m})
    frame['beam_colours_page'] = sorted({tuple(round(c, 4) for c in s['c']) for s in sp_p})
# the domes
def dome(d, info):
    if not info or not info.get('w'): return None
    p = os.path.join(d, info.get('file') or '')
    if not os.path.exists(p): return None
    return np.fromfile(p, dtype=np.float16).astype(np.float32).reshape(info['h'], info['w'], 3)
domes = {}
for key in ('skyVis', 'skyEnv'):
    A_, B_ = dome(a.mine, LSm.get(key)), dome(a.page, LSp.get(key))
    if A_ is None or B_ is None or A_.shape != B_.shape: domes[key] = 'missing or a different size'; continue
    h = A_.shape[0]
    up = slice(h // 2, h)   # rows bottom-up: the upper half is the sky above the horizon
    rel = np.abs(A_[up] - B_[up]).mean(axis=2) / np.maximum(B_[up].mean(axis=2), 1e-4)
    domes[key] = {'size': [A_.shape[1], h], 'max_mine': float(A_.max()), 'max_page': float(B_.max()),
                  'mean_rgb_mine': [round(float(v), 5) for v in A_[up].reshape(-1, 3).mean(0)], 'mean_rgb_page': [round(float(v), 5) for v in B_[up].reshape(-1, 3).mean(0)],
                  'upper_half_relative_diff_median': float(np.median(rel)), 'p95': float(np.percentile(rel, 95)), 'pixels_within_1pct': float((rel < 0.01).mean())}
res = {'shot': a.shot, 'sun_direction_deg': sun_ang, 'lamps': lamp, 'frames': frame, 'domes': domes, 'differences': [[p, m, q] for p, m, q in diffs]}
if a.json: json.dump(res, open(a.json, 'w'), indent=1, default=str)
print(f'== {a.shot}: sun direction {sun_ang:.4f} deg apart' if sun_ang is not None else f'== {a.shot}: no sun direction')
print('lamps', json.dumps(lamp))
print('frames', json.dumps({k: v for k, v in frame.items() if not k.startswith('beam_c')}))
if 'beam_constants_mine' in frame: print('beams: constants', frame['beam_constants_mine'] == frame['beam_constants_page'], 'colours', frame['beam_colours_mine'] == frame['beam_colours_page'])
for k, v in domes.items(): print('dome', k, json.dumps(v))
print(f'{len(diffs)} values differ:')
for p_, m_, q_ in diffs[:80]:
    s_ = lambda v: json.dumps(v)[:110]
    print(f'  {p_}: mine {s_(m_)} | page {s_(q_)}')
