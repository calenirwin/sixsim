#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): a shot's lens path straight from tools/ad/shots.json (no page, no harvest), as the prep's camera
# data r1c_path.py reads: the keys' lon / lat projected as client/src/shared/geo.js does (x east, z south, metres), a
# key's height over the ground (the shots without "abs") on the ground of lane A's cell under it (the ground mesh's median
# height within 12 m), a Catmull-Rom path through the keys with the shot's ease at both ends, the look point likewise,
# the vertical field of view as a 24 mm filmback's focal length; Unreal axes (x, z, y) x 100 in the world's absolute frame.
#   python3 tools/ue/r1c_shotpath.py --shot t8LenoxDive --cells /data0/projectnyc_aux/cellcache/plain/lenox125 --out <side.json>
import argparse, json, math, os, struct

LAT0, LON0 = 40.7831, -73.9712
M_LAT, M_LON = 111132.0, 111320.0 * math.cos(math.radians(LAT0))
HERE = os.path.dirname(os.path.abspath(__file__))


def project(lon, lat):
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def ground_y(cells, x, z, r=12.0):
    import numpy as np
    key = f'{math.floor(x / 128)}_{math.floor(z / 128)}'
    p = os.path.join(cells, f'{key}.glb')
    if not os.path.exists(p): return None, key
    f = open(p, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    org = root.get('translation') or [0, 0, 0]
    ys = []
    for n in J['nodes']:
        ex = n.get('extras') or {}
        if ex.get('kind') != 'mesh' or 'mesh' not in n: continue
        if ex.get('class') != -1 and 'ground' not in str(ex.get('matKey', '')).lower(): continue
        for pr in J['meshes'][n['mesh']]['primitives']:
            a = J['accessors'][pr['attributes']['POSITION']]; bv = J['bufferViews'][a['bufferView']]
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or 12
            raw = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + 12, off)
            P = np.lib.stride_tricks.as_strided(raw, (a['count'], 12), (st, 1)).copy().view('<f4').reshape(-1, 3)
            P = P + np.asarray(org, np.float32)
            d = np.hypot(P[:, 0] - x, P[:, 2] - z)
            ys += list(P[d < r, 1])
    return (float(np.median(ys)) if ys else None), key


def catmull(P, u):
    """a uniform Catmull-Rom through the points P at u in [0, 1] (end tangents mirrored)"""
    n = len(P) - 1
    s = min(max(u, 0.0), 1.0) * n
    i = min(int(s), n - 1); t = s - i
    p0 = P[i - 1] if i > 0 else [2 * P[0][k] - P[1][k] for k in range(3)]
    p1, p2 = P[i], P[i + 1]
    p3 = P[i + 2] if i + 2 <= n else [2 * P[n][k] - P[n - 1][k] for k in range(3)]
    return [0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in range(3)]


def ease(u, e):
    """constant speed in the middle, quadratic ramps of length e at both ends (normalised to reach 1)"""
    if e <= 0: return u
    v = 1.0 / (1.0 - e)   # (the middle speed)
    if u < e: return 0.5 * v * u * u / e
    if u > 1 - e: return 1.0 - 0.5 * v * (1 - u) ** 2 / e
    return 0.5 * v * e + v * (u - e)


def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / l for c in v]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shot', required=True); ap.add_argument('--cells', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--shots', default=os.path.join(HERE, '..', 'ad', 'shots.json')); ap.add_argument('--fps', type=float, default=30.0)
    a = ap.parse_args()
    S = json.load(open(a.shots)); S = S.get('shots', S)
    sh = S[a.shot]
    pts, looks, info = [], [], []
    for k in sh['keys']:
        x, z = project(k['p'][0], k['p'][1]); lx, lz = project(k['look'][0], k['look'][1])
        if sh.get('abs'):
            y, ly = k['p'][2], k['look'][2]
        else:
            g, key = ground_y(a.cells, x, z); gl, keyl = ground_y(a.cells, lx, lz)
            g = g if g is not None else (gl or 0.0); gl = gl if gl is not None else g
            y, ly = g + k['p'][2], gl + k['look'][2]
            info.append({'ground': round(g, 2), 'ground_look': round(gl, 2), 'cell': key})
        pts.append([x, y, z]); looks.append([lx, ly, lz])
    N = int(round(sh['duration'] * a.fps))
    fov = float(sh.get('fov', 50)); vap = 24.0; focal = vap / 2 / math.tan(math.radians(fov) / 2)
    ue = []
    for i in range(N):
        u = ease(i / max(N - 1, 1), float(sh.get('ease', 0.0)))
        p = catmull(pts, u); l = catmull(looks, u)
        f = norm([l[k] - p[k] for k in range(3)])
        up = [0.0, 1.0, 0.0]
        d = sum(up[k] * f[k] for k in range(3)); u_ = norm([up[k] - d * f[k] for k in range(3)])
        ue.append({'p': [p[0] * 100, p[2] * 100, p[1] * 100], 'f': [f[0], f[2], f[1]], 'u': [u_[0], u_[2], u_[1]]})
    side = {'shot': a.shot, 'fps': a.fps, 'frames': [0, N - 1], 'data': {'origin': [0.0, 0.0, 0.0], 'shot': a.shot, 'time': sh.get('time')},
            'camera': {'focal': focal, 'hap': vap * 16 / 9, 'vap': vap, 'focal_animated': False, 'ue': ue, 'from': 'shots.json'},
            'r1c': {'keys': pts, 'looks': looks, 'ground': info}}
    json.dump(side, open(a.out, 'w'), indent=1)
    print(json.dumps({'frames': N, 'focal': round(focal, 2), 'p0': [round(c, 1) for c in pts[0]], 'look0': [round(c, 1) for c in looks[0]], 'ground': info}))


if __name__ == '__main__':
    main()
