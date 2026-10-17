#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): what a take's camera sees at a pixel, from the world's own packages: the ray through the pixel
# (the take's camera path, three's conventions: matrixWorld column-major, vertical fov) against every triangle of the
# world's cells and far city, nearest hit first, with its package, node, material and node extras. For naming what is
# drawn where a renderer disagrees with another (r1c_xgate.py) or where a defect shows.
#   python3 tools/ue/r1c_pick.py --world <world dir> --cam <cam json> --frame 25 --px 2100,900 [--px ...] [--size 2560x1440]
#       [--all] (every node, hidden ones too: shadowOnly, nightOnly, transparent)
import argparse, glob, json, math, os, struct, sys
import numpy as np

CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5125: ('u4', 4), 5122: ('i2', 2), 5120: ('i1', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(J, B, i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    dt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or sz * n
    raw = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + sz * n, off)
    return np.lib.stride_tricks.as_strided(raw, (a['count'], sz * n), (st, 1)).copy().view('<' + dt).reshape(a['count'], n)


def load(dirs):
    tris, srcs, table = [], [], []
    for fp in sorted(p for d in dirs for p in glob.glob(os.path.join(d, '*.glb'))):
        f = open(fp, 'rb').read()
        L = struct.unpack('<I', f[12:16])[0]
        J = json.loads(f[20:20 + L]); o = 20 + L
        B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
        root = J['nodes'][J['scenes'][0]['nodes'][0]]
        org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
        for ni, n in enumerate(J['nodes']):
            ex = n.get('extras') or {}
            if 'mesh' not in n or ex.get('kind') != 'mesh': continue
            for pi, p in enumerate(J['meshes'][n['mesh']]['primitives']):
                m = J['materials'][p['material']] if 'material' in p else {}
                t = (m.get('extras') or {}).get('three') or {}
                P = read(J, B, p['attributes']['POSITION']).astype(np.float64) + org
                I = read(J, B, p['indices']).reshape(-1, 3).astype(np.int64) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
                if not len(I): continue
                table.append({'file': os.path.basename(fp), 'node': n.get('name') or f'node{ni}', 'material': m.get('name'), 'three': t.get('name'),
                              'type': t.get('type'), 'transparent': bool(t.get('transparent')), 'opacity': t.get('opacity'),
                              'extras': {k: ex.get(k) for k in ('class', 'dress', 'nightOnly', 'shadowOnly', 'castShadow') if k in ex},
                              'attrs': sorted(p['attributes'])})
                tris.append(P[I].astype(np.float32)); srcs.append(np.full(len(I), len(table) - 1, np.int32))
    return np.concatenate(tris), np.concatenate(srcs), table


def ray(cam, frame, px, py, W, H):
    c = cam[frame]
    M = np.asarray(c['m'], np.float64).reshape(4, 4).T          # (three: column-major)
    th = math.tan(math.radians(c['fov']) / 2) / (c.get('zoom') or 1)
    x = ((px + 0.5) / W * 2 - 1) * th * (c.get('aspect') or W / H); y = (1 - (py + 0.5) / H * 2) * th
    d = M[:3, :3] @ np.array([x, y, -1.0]); return M[:3, 3], d / np.linalg.norm(d)


def hits(T, o, d, k=6):
    """the k nearest hits along the ray (Moller-Trumbore over every triangle)"""
    a = T[:, 0].astype(np.float64); e1 = T[:, 1] - T[:, 0]; e2 = T[:, 2] - T[:, 0]
    p = np.cross(d, e2); det = np.einsum('ij,ij->i', e1, p)
    ok = np.abs(det) > 1e-9
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = o - a; u = np.einsum('ij,ij->i', s, p) * inv
    q = np.cross(s, e1); v = (q @ d) * inv; t = np.einsum('ij,ij->i', e2, q) * inv
    m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.05)
    idx = np.flatnonzero(m)
    return idx[np.argsort(t[idx])][:k], t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--world', required=True); ap.add_argument('--cam', required=True); ap.add_argument('--frame', type=int, required=True)
    ap.add_argument('--px', action='append', required=True); ap.add_argument('--size', default='2560x1440'); ap.add_argument('--k', type=int, default=6)
    a = ap.parse_args()
    W, H = (int(x) for x in a.size.split('x'))
    cache = os.path.join(a.world, '_pick.npz')
    if os.path.exists(cache) and os.path.exists(cache + '.json'):
        z = np.load(cache); T, S = z['T'], z['S']; table = json.load(open(cache + '.json'))
    else:
        dirs = [d for d in (os.path.join(a.world, 'cells_uv'), os.path.join(a.world, 'far')) if os.path.isdir(d)]
        T, S, table = load(dirs)
        np.savez(cache, T=T, S=S); json.dump(table, open(cache + '.json', 'w'))
    cam = json.load(open(a.cam))
    out = []
    for pxs in a.px:
        px, py = (float(x) for x in pxs.split(','))
        o, d = ray(cam, a.frame, px, py, W, H)
        idx, t = hits(T, o, d, a.k)
        out.append({'px': [px, py], 'hits': [{'t': round(float(t[i]), 2), 'at': [round(float(x), 2) for x in (o + d * t[i])], **table[S[i]]} for i in idx]})
    for r in out:
        print(f"px {r['px']}")
        for h in r['hits']:
            print(f"   {h['t']:8.2f} m  {h['file']}:{h['node']}  {(h['material'] or '')[:46]:46s} {h['type'] or ''} tr={int(h['transparent'])} {json.dumps(h['extras'])} at {h['at']}")
    json.dump(out, sys.stderr) if False else None


if __name__ == '__main__':
    main()
