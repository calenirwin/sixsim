#!/usr/bin/env python3
"""The backdrop's ground at the far levels (docs/notes/r2-backdrop.md; tile-system.md D12, R5.2): per chunk of L3 to L6,
a terrain mesh clipped to the backdrop's land (the exact complement of the far level's water outside the city) and a
top-down ground texture drawn from the records (land use and cover, water the charts leave dry, roads, railways,
canopy), with a night map (street lights along the roads, lit lots), for tools/lod/build_backdrop.mjs.

  python3 tools/lod/backdrop_ground.py [--out <dir>] [--levels 6,5,4,3] [--only L4_-2_1] [--jobs 96] [--plan]

Chunks: every L6 square of the grid with land; the children of a chunk whose box lies within BAND[level] of the city's
line (L5 12 km, L4 6 km, L3 3 km), all four at once (a parent gives way only to all its children). Mesh: the level's
grid (L3 8 m, L4 16 m, L5 64 m, L6 128 m; 129 or 65 samples a side) of the backdrop's heights (client/tools/pipeline/
backdrop/heights.py), simplified as a right-triangulated irregular network within MAXERR[level], clipped to the land
(constrained Delaunay inside each cut triangle, heights on the triangle's plane), with skirts on the chunk's border
(cracks between levels) and on the shore (the bank down to below the water plane). Out: <out>/ground/L<lv>_<i>_<j>.ctl
(CTL1: tpos Int16 x3 at 1/4 m about the chunk centre, tuv Float32 x2, tnrm Uint8 x3 (normal, (byte - 128) / 127), tidx
Uint32, tsh Uint8 (shade: 255 ground, lower on skirts), ttex JPEG bytes (sRGB albedo), tnit JPEG bytes (night light, grey)) and <out>/ground/plan.json.
"""
import argparse
import io
import json
import math
import os
import pickle
import sys
import time
from multiprocessing import get_context

import numpy as np
import shapely
import shapely.affinity
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import box

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'client', 'tools', 'pipeline', 'backdrop'))
import common as C  # noqa: E402
import land as LD  # noqa: E402
import terrain as T  # noqa: E402

SIZE = C.LEVEL_SIZE
GRIDN = {3: 129, 4: 129, 5: 65, 6: 65}          # samples a side
MAXERR = {3: 0.5, 4: 1.0, 5: 2.0, 6: 4.0}       # metres (the level's geometric error is 1.25, 2.5, 5, 10)
TEXN = {3: 1024, 4: 1024, 5: 1024, 6: 512}      # texture size
NITN = {3: 512, 4: 512, 5: 256, 6: 128}         # night map size
BAND = {5: 12000.0, 4: 6000.0, 3: 3000.0}       # a chunk's children exist when its box lies this close to the city's line
SKIRT = {3: 3.0, 4: 6.0, 5: 12.0, 6: 20.0}
SHORE_Y = -1.5
SCALE = 4.0
SS = 2                                          # texture supersampling

# ---------------------------------------------------------------------------------------------- the plan
def chunk_box(lv, i, j):
    s = SIZE[lv]
    return (i * s, j * s, (i + 1) * s, (j + 1) * s)


def plan(levels):
    meta = T.grid_meta()
    bd = LD.load('bd_land')
    nyc = LD.load('nyc')
    line = nyc.boundary
    shapely.prepare(bd)
    out = {6: []}
    s6 = SIZE[6]
    for j in range(int(meta['z0'] // s6), int(meta['z1'] // s6)):
        for i in range(int(meta['x0'] // s6), int(meta['x1'] // s6)):
            if bd.intersects(box(*chunk_box(6, i, j))):
                out[6].append((i, j))
    for lv in (5, 4, 3):
        out[lv] = []
        if lv not in levels:
            continue
        for (i, j) in out[lv + 1]:
            pb = box(*chunk_box(lv + 1, i, j))
            if pb.distance(line) > BAND[lv]:
                continue
            for dj in (0, 1):
                for di in (0, 1):
                    ci, cj = i * 2 + di, j * 2 + dj
                    if bd.intersects(box(*chunk_box(lv, ci, cj))):
                        out[lv].append((ci, cj))
    return out


# ---------------------------------------------------------------------------------------------- heights per level
G8 = None
GM = None


def heights(lv, i, j):
    """the level's grid of heights over chunk (i, j): ground8 point samples at L3, box means of the 8 m samples beyond"""
    n = GRIDN[lv]
    step = SIZE[lv] / (n - 1)
    k = int(round(step / GM['step']))
    x0, z0 = i * SIZE[lv], j * SIZE[lv]
    ia = int(round((x0 - GM['x0']) / GM['step']))
    ja = int(round((z0 - GM['z0']) / GM['step']))
    if k == 1:
        return G8[ja:ja + n, ia:ia + n].astype(np.float64)
    r = k // 2
    pad = np.pad(G8[max(0, ja - r):ja + (n - 1) * k + r + 1, max(0, ia - r):ia + (n - 1) * k + r + 1].astype(np.float64),
                 ((max(0, r - ja), 0), (max(0, r - ia), 0)), mode='edge')
    H = np.zeros((n, n))
    w = 2 * r + 1
    cs = np.cumsum(np.cumsum(np.pad(pad, ((1, 0), (1, 0))), 0), 1)
    rows = np.arange(n) * k
    cols = np.arange(n) * k
    R0, C0 = np.meshgrid(rows, cols, indexing='ij')
    R1, C1 = np.minimum(R0 + w, pad.shape[0]), np.minimum(C0 + w, pad.shape[1])
    tot = cs[R1, C1] - cs[R0, C1] - cs[R1, C0] + cs[R0, C0]
    H[:] = tot / ((R1 - R0) * (C1 - C0))
    return H


# ---------------------------------------------------------------------------------------------- RTIN (right-triangulated irregular network)
_RT = {}


def rtin_coords(n):
    """per triangle of the full hierarchy: (ax, ay, bx, by), the hypotenuse; ids as Martini numbers them"""
    if n in _RT:
        return _RT[n]
    t = n - 1
    num = t * t * 2 - 2
    co = np.zeros((num, 4), np.int32)
    for i in range(num):
        tid = i + 2
        ax = ay = bx = by = cx = cy = 0
        if tid & 1:
            bx = by = cx = t
        else:
            ax = ay = cy = t
        tid >>= 1
        while tid > 1:
            mx, my = (ax + bx) >> 1, (ay + by) >> 1
            if tid & 1:
                bx, by, ax, ay = ax, ay, cx, cy
            else:
                ax, ay, bx, by = bx, by, cx, cy
            cx, cy = mx, my
            tid >>= 1
        co[i] = (ax, ay, bx, by)
    _RT[n] = (co, num, num - t * t)
    return _RT[n]


def rtin(H, maxerr):
    """triangles (indices into the flattened grid) of the RTIN of H within maxerr"""
    n = H.shape[0]
    co, num, npar = rtin_coords(n)
    h = H.ravel()
    err = np.zeros(n * n)
    ax, ay, bx, by = co[:, 0], co[:, 1], co[:, 2], co[:, 3]
    mx, my = (ax + bx) >> 1, (ay + by) >> 1
    cx, cy = mx + my - ay, my + ax - mx
    mid = my * n + mx
    me = np.abs((h[ay * n + ax] + h[by * n + bx]) / 2 - h[mid])
    lc = ((ay + cy) >> 1) * n + ((ax + cx) >> 1)
    rc = ((by + cy) >> 1) * n + ((bx + cx) >> 1)
    # finest first: a triangle's error takes its children's (ids grow toward the finest level)
    for i in range(num - 1, -1, -1):
        e = me[i]
        if i < npar:
            e = max(e, err[lc[i]], err[rc[i]])
        if e > err[mid[i]]:
            err[mid[i]] = e
    tris = []
    t = n - 1
    stack = [(0, 0, t, t, t, 0), (t, t, 0, 0, 0, t)]
    while stack:
        ax_, ay_, bx_, by_, cx_, cy_ = stack.pop()
        mx_, my_ = (ax_ + bx_) >> 1, (ay_ + by_) >> 1
        if abs(ax_ - cx_) + abs(ay_ - cy_) > 1 and err[my_ * n + mx_] > maxerr:
            stack.append((cx_, cy_, ax_, ay_, mx_, my_))
            stack.append((bx_, by_, cx_, cy_, mx_, my_))
        else:
            tris.append((ay_ * n + ax_, by_ * n + bx_, cy_ * n + cx_))
    return np.array(tris, np.int64)


# ---------------------------------------------------------------------------------------------- the mesh
def mesh(lv, i, j, land, H=None, maxerr=None, skirt_bottom=None, shades=(255, 120)):
    """the level's surface over `land` (chunk-local polygons of the land): H the heights on the level's grid (the ground by
    default; the canopy passes its own), skirts on boundary edges (down by SKIRT on the chunk border, to SHORE_Y elsewhere;
    or, with skirt_bottom(x, z) in chunk metres, down to that height everywhere: a forest's edge down to its ground)"""
    n = GRIDN[lv]
    S = SIZE[lv]
    step = S / (n - 1)
    x0, z0 = i * S, j * S
    if H is None:
        H = heights(lv, i, j)
    tri = rtin(H, MAXERR[lv] if maxerr is None else maxerr)
    gx = (np.arange(n * n) % n) * step
    gz = (np.arange(n * n) // n) * step
    P2 = np.stack([gx, gz], 1)
    Y = H.ravel()
    lb = shapely.affinity.translate(land, -x0, -z0) if land is not None else None
    full = box(0, 0, S, S)
    out_p, out_i = [], []
    nv = 0
    if lb is None or lb.is_empty:
        return None
    if lb.equals(full) or lb.area > S * S * 0.999999:
        inside = np.ones(len(tri), bool)
        cut = np.zeros(len(tri), bool)
    else:
        polys = shapely.polygons(P2[tri])
        shapely.prepare(lb)
        inside = shapely.contains_properly(lb, polys) if hasattr(shapely, 'contains_properly') else shapely.within(polys, lb)
        cut = ~inside & shapely.intersects(polys, lb)
    # whole triangles keep the grid's vertices
    used = np.unique(tri[inside].ravel())
    remap = -np.ones(n * n, np.int64)
    remap[used] = np.arange(len(used))
    V = [np.stack([P2[used, 0], Y[used], P2[used, 1]], 1)]
    I = [remap[tri[inside]]]
    nv = len(used)
    # cut triangles: the land's part, triangulated inside, heights on the triangle's plane
    if cut.any():
        polys = shapely.polygons(P2[tri[cut]])
        parts = shapely.intersection(polys, lb)
        for t_idx, part in zip(tri[cut], parts):
            if part.is_empty:
                continue
            a, b, c = P2[t_idx[0]], P2[t_idx[1]], P2[t_idx[2]]
            ya, yb, yc = Y[t_idx[0]], Y[t_idx[1]], Y[t_idx[2]]
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-9:
                continue
            geoms = [g for g in getattr(part, 'geoms', [part]) if g.geom_type == 'Polygon' and g.area > 1e-4]
            for g in geoms:
                try:
                    ts = shapely.constrained_delaunay_triangles(g)
                except Exception:
                    continue
                for tt in getattr(ts, 'geoms', []):
                    q = np.asarray(tt.exterior.coords)[:3]
                    w1 = ((b[1] - c[1]) * (q[:, 0] - c[0]) + (c[0] - b[0]) * (q[:, 1] - c[1])) / den
                    w2 = ((c[1] - a[1]) * (q[:, 0] - c[0]) + (a[0] - c[0]) * (q[:, 1] - c[1])) / den
                    yy = w1 * ya + w2 * yb + (1 - w1 - w2) * yc
                    V.append(np.stack([q[:, 0], yy, q[:, 1]], 1))
                    I.append(np.array([[nv, nv + 1, nv + 2]]))
                    nv += 3
    V = np.concatenate(V)
    I = np.concatenate(I).astype(np.int64)
    if not len(I):
        return None
    # wind up (faces +y): in (x, z) with z south, an up face is clockwise seen from above -> cross (b-a)x(c-a) in xz < 0
    a, b, c = V[I[:, 0]], V[I[:, 1]], V[I[:, 2]]
    cr = (b[:, 0] - a[:, 0]) * (c[:, 2] - a[:, 2]) - (b[:, 2] - a[:, 2]) * (c[:, 0] - a[:, 0])
    flip = cr > 0
    I[flip] = I[flip][:, [0, 2, 1]]
    keep = np.abs(cr) > 1e-6
    I = I[keep]
    shade = np.full(len(V), shades[0], np.uint8)
    # skirts: boundary edges (used once); on the chunk border down by SKIRT, elsewhere (the shore, the city's land) to SHORE_Y;
    # each faces away from its triangle (outward)
    E3 = np.concatenate([I[:, [0, 1, 2]], I[:, [1, 2, 0]], I[:, [2, 0, 1]]])
    key = np.round(V[:, [0, 2]] * 64).astype(np.int64)
    kk = key[:, 0] * 10_000_000 + key[:, 1]
    uq, inv = np.unique(kk, return_inverse=True)
    ek = np.sort(inv[E3[:, :2]], 1)
    ekey = ek[:, 0] * (len(uq) + 1) + ek[:, 1]
    vals, cnt = np.unique(ekey, return_counts=True)
    bnd = np.isin(ekey, vals[cnt == 1])
    SV, SI = [], []
    base = len(V)
    eps = 1e-3
    for va, vb, vc in E3[bnd]:
        pa, pb, pc = V[va], V[vb], V[vc]
        onb = ((abs(pa[0]) < eps and abs(pb[0]) < eps) or (abs(pa[0] - S) < eps and abs(pb[0] - S) < eps)
               or (abs(pa[2]) < eps and abs(pb[2]) < eps) or (abs(pa[2] - S) < eps and abs(pb[2] - S) < eps))
        if skirt_bottom is not None:
            ya2, yb2 = min(skirt_bottom(pa[0], pa[2]), pa[1] - 0.5), min(skirt_bottom(pb[0], pb[2]), pb[1] - 0.5)
        else:
            ya2 = pa[1] - SKIRT[lv] if onb else min(SHORE_Y, pa[1] - 0.5)
            yb2 = pb[1] - SKIRT[lv] if onb else min(SHORE_Y, pb[1] - 0.5)
        k0 = base + len(SV)
        SV.extend([[pa[0], ya2, pa[2]], [pb[0], yb2, pb[2]]])
        # outward: from the triangle's third vertex across the edge (in x, z)
        ox_, oz_ = (pa[0] + pb[0]) / 2 - pc[0], (pa[2] + pb[2]) / 2 - pc[2]
        # the face (a, b, b_low): normal = (b - a) x (b_low - a); its horizontal part must point outward
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        wx, wy, wz = pb[0] - pa[0], yb2 - pa[1], pb[2] - pa[2]
        nx_, nz_ = uy * wz - uz * wy, ux * wy - uy * wx
        if nx_ * ox_ + nz_ * oz_ >= 0:
            SI.append([va, vb, k0 + 1]); SI.append([va, k0 + 1, k0])
        else:
            SI.append([va, k0 + 1, vb]); SI.append([va, k0, k0 + 1])
    if SV:
        V = np.concatenate([V, np.array(SV)])
        I = np.concatenate([I, np.array(SI, np.int64)])
        shade = np.concatenate([shade, np.full(len(SV), shades[1], np.uint8)])
    uv = np.stack([V[:, 0] / S, V[:, 2] / S], 1).astype(np.float32)
    # skirt bottoms take their top's uv (already: same x, z)
    # normals: the level grid's gradient, bilinear at each vertex (the same function on both sides of a chunk border, so
    # the light does not break there); skirts take their face's horizontal normal
    gzz, gxx = np.gradient(H, step)
    fx = np.clip(V[:, 0] / step, 0, n - 1.0001)
    fz = np.clip(V[:, 2] / step, 0, n - 1.0001)
    i0, j0 = np.floor(fx).astype(np.int64), np.floor(fz).astype(np.int64)
    tx, tz = fx - i0, fz - j0

    def bil(A):
        return (A[j0, i0] * (1 - tx) * (1 - tz) + A[j0, i0 + 1] * tx * (1 - tz) + A[j0 + 1, i0] * (1 - tx) * tz + A[j0 + 1, i0 + 1] * tx * tz)
    Nn = np.stack([-bil(gxx), np.ones(len(V)), -bil(gzz)], 1)
    if SV:
        SIa = np.array(SI, np.int64)
        for t3 in SIa:
            a_, b_, c_ = V[t3[0]], V[t3[1]], V[t3[2]]
            nn = np.cross(b_ - a_, c_ - a_)
            nn[1] = 0.0
            for q_ in t3:
                if q_ >= base:
                    Nn[q_] = nn
        # the skirt's top vertices are the ground's own (shared with the surface): they keep the surface normal
    Nn /= np.maximum(np.linalg.norm(Nn, axis=1, keepdims=True), 1e-9)
    nrm = (np.clip(np.round(Nn * 127), -127, 127) + 128).astype(np.uint8)   # biased: n = (byte - 128) / 127
    pos = np.empty((len(V), 3), np.int16)
    cxm, czm = S / 2, S / 2
    pos[:, 0] = np.clip(np.round((V[:, 0] - cxm) * SCALE), -32768, 32767)
    pos[:, 1] = np.clip(np.round(V[:, 1] * SCALE), -32768, 32767)
    pos[:, 2] = np.clip(np.round((V[:, 2] - czm) * SCALE), -32768, 32767)
    return {'pos': pos, 'uv': uv, 'nrm': nrm, 'idx': I.astype(np.uint32), 'sh': shade, 'tris': len(I), 'skirt_tris': len(SI) if SV else 0,
            'y0': float(V[:, 1].min()), 'y1': float(V[:, 1].max())}


# ---------------------------------------------------------------------------------------------- the ground texture
FEAT = None      # the drawing records: lists per layer, in world metres, with their STRtrees


def hexc(h):
    return tuple(int(h[k:k + 2], 16) for k in (1, 3, 5))


# land cover: (draw order, colour, noise amplitude, canopy share, night glow)
COVER = {
    'default': (0, hexc('#8b8c78'), 14, 0.18, 0.0),
    'residential': (1, hexc('#959385'), 16, 0.26, 0.10),
    'commercial': (1, hexc('#a29f97'), 12, 0.05, 0.30),
    'retail': (1, hexc('#a5a199'), 12, 0.04, 0.35),
    'industrial': (1, hexc('#9a958b'), 14, 0.03, 0.22),
    'railway': (1, hexc('#8a8277'), 10, 0.02, 0.10),
    'construction': (1, hexc('#a59c88'), 16, 0.0, 0.05),
    'brownfield': (1, hexc('#a09681'), 16, 0.05, 0.0),
    'landfill': (1, hexc('#8f8e70'), 14, 0.0, 0.0),
    'farmland': (1, hexc('#a19a6c'), 18, 0.0, 0.0),
    'farmyard': (1, hexc('#9b9273'), 14, 0.05, 0.0),
    'orchard': (2, hexc('#6f8a4c'), 16, 0.4, 0.0),
    'vineyard': (2, hexc('#7d8a52'), 14, 0.1, 0.0),
    'military': (1, hexc('#8f8f7a'), 12, 0.1, 0.05),
    'religious': (2, hexc('#8d917c'), 12, 0.2, 0.05),
    'education': (2, hexc('#929683'), 14, 0.15, 0.10),
    'institutional': (2, hexc('#94948a'), 12, 0.1, 0.10),
    'cemetery': (2, hexc('#7c9262'), 14, 0.22, 0.0),
    'grass': (2, hexc('#80a05c'), 14, 0.04, 0.0),
    'meadow': (2, hexc('#8aa264'), 16, 0.03, 0.0),
    'park': (2, hexc('#789a56'), 14, 0.35, 0.02),
    'garden': (2, hexc('#7d9c5a'), 14, 0.3, 0.0),
    'golf': (2, hexc('#7ea85a'), 10, 0.18, 0.0),
    'pitch': (3, hexc('#6f9f50'), 8, 0.0, 0.10),
    'track': (3, hexc('#a2614c'), 8, 0.0, 0.05),
    'playground': (3, hexc('#9a8f74'), 10, 0.1, 0.02),
    'stadium': (3, hexc('#8c8c86'), 10, 0.0, 0.25),
    'nature_reserve': (1, hexc('#6f8650'), 16, 0.45, 0.0),
    'wood': (3, hexc('#3f5a32'), 22, 0.95, 0.0),
    'scrub': (3, hexc('#6c7a4c'), 18, 0.5, 0.0),
    'heath': (3, hexc('#7a8256'), 16, 0.2, 0.0),
    'grassland': (2, hexc('#8a9e62'), 16, 0.05, 0.0),
    'wetland': (3, hexc('#76885a'), 18, 0.1, 0.0),
    'marsh': (3, hexc('#7d8a58'), 18, 0.02, 0.0),
    'sand': (3, hexc('#d2c6a2'), 12, 0.0, 0.0),
    'beach': (3, hexc('#d8cba8'), 10, 0.0, 0.0),
    'bare_rock': (3, hexc('#8c887e'), 18, 0.0, 0.0),
    'scree': (3, hexc('#8e8a80'), 18, 0.0, 0.0),
    'mud': (3, hexc('#7a7462'), 14, 0.0, 0.0),
    'parking': (4, hexc('#626262'), 8, 0.02, 0.45),
    'apron': (4, hexc('#8d8d8a'), 6, 0.0, 0.40),
    'runway': (5, hexc('#575757'), 4, 0.0, 0.35),
    'taxiway': (5, hexc('#666664'), 4, 0.0, 0.25),
    'aerodrome': (1, hexc('#8a9d64'), 12, 0.0, 0.05),
    'pier': (4, hexc('#8a857c'), 8, 0.0, 0.15),
    'water': (6, hexc('#304752'), 6, 0.0, 0.0),
}
BANK = hexc('#6d685e')   # the shore's bank (bulkhead, riprap) beyond the land's edge in the texture
SIDEWALK = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link'}
SIDEWALK_COL = hexc('#9a968d')
NIGHT_ROADS = 0.5        # the road classes' night values scaled down: lamps, not lit bands
LAMP_M = {'motorway': 60.0, 'trunk': 45.0, 'primary': 35.0, 'secondary': 35.0, 'tertiary': 38.0, 'residential': 40.0, 'unclassified': 45.0}
ROADS = {   # class: (width m, colour, night)
    'motorway': (26.0, hexc('#4b4b4d'), 1.0), 'motorway_link': (9.0, hexc('#4f4f50'), 0.8),
    'trunk': (20.0, hexc('#505052'), 0.9), 'trunk_link': (8.0, hexc('#525253'), 0.7),
    'primary': (15.0, hexc('#555556'), 0.8), 'primary_link': (7.0, hexc('#58585a'), 0.6),
    'secondary': (12.0, hexc('#5a5a5b'), 0.65), 'secondary_link': (6.0, hexc('#5c5c5d'), 0.5),
    'tertiary': (10.0, hexc('#5f5f60'), 0.55), 'tertiary_link': (6.0, hexc('#606061'), 0.45),
    'residential': (8.0, hexc('#656565'), 0.40), 'unclassified': (7.0, hexc('#666666'), 0.35),
    'living_street': (6.0, hexc('#6a6a6a'), 0.35), 'service': (4.5, hexc('#6d6d6c'), 0.15),
    'road': (7.0, hexc('#666666'), 0.3), 'busway': (8.0, hexc('#5a5a5a'), 0.3),
    'pedestrian': (6.0, hexc('#9a958a'), 0.25), 'footway': (2.0, hexc('#a39d90'), 0.05), 'path': (1.6, hexc('#9c9480'), 0.0),
    'cycleway': (2.0, hexc('#8f8a80'), 0.05), 'track': (3.0, hexc('#8f8670'), 0.0),
}


def cover_of(tags):
    lu, nat, lei, am, ae, mm, w = (tags.get(k) for k in ('landuse', 'natural', 'leisure', 'amenity', 'aeroway', 'man_made', 'wetland'))
    if tags.get('water') or nat == 'water' or tags.get('waterway') in ('riverbank', 'dock', 'canal', 'river') or lu in ('reservoir', 'basin'):
        return 'water'
    if ae in ('runway',):
        return 'runway'
    if ae in ('taxiway',):
        return 'taxiway'
    if ae in ('apron',):
        return 'apron'
    if ae == 'aerodrome':
        return 'aerodrome'
    if am == 'parking' or lu == 'garages':
        return 'parking'
    if mm in ('pier', 'quay'):
        return 'pier'
    if nat in ('wood',) or lu == 'forest':
        return 'wood'
    if nat == 'wetland':
        return 'marsh' if w in ('marsh', 'saltmarsh', 'reedbed', 'tidalflat') else 'wetland'
    if nat in COVER:
        return nat
    if lei in ('golf_course',) or tags.get('golf') in ('fairway', 'green', 'tee', 'rough'):
        return 'golf'
    if lei in ('pitch',):
        return 'pitch'
    if lei in ('track',):
        return 'track'
    if lei in ('playground',):
        return 'playground'
    if lei in ('stadium',):
        return 'stadium'
    if lei in ('park', 'recreation_ground', 'common', 'dog_park'):
        return 'park'
    if lei in ('garden',):
        return 'garden'
    if lei in ('nature_reserve',):
        return 'nature_reserve'
    if am in ('school', 'university', 'college', 'kindergarten'):
        return 'education'
    if am in ('hospital', 'prison'):
        return 'institutional'
    if am == 'grave_yard':
        return 'cemetery'
    if lu in ('recreation_ground', 'village_green'):
        return 'park'
    if lu in COVER:
        return lu
    if lu in ('allotments',):
        return 'garden'
    if lu in ('greenhouse_horticulture', 'plant_nursery'):
        return 'farmland'
    if lu in ('quarry',):
        return 'bare_rock'
    if lu in ('port',):
        return 'industrial'
    if lu in ('flowerbed', 'greenfield', 'village_green'):
        return 'grass'
    return None


def load_feats():
    """the drawing records in world metres, with STRtrees (built once; workers share them by fork)"""
    t0 = time.time()
    R = LD.load_osm()
    meta = T.grid_meta()
    GRID = box(meta['x0'], meta['z0'], meta['x1'], meta['z1'])
    nyc = LD.load('nyc')
    areas, aord, acls = [], [], []
    for key, tags, P in R['area']:
        cl = cover_of(tags)
        if cl is None or tags.get('location') == 'underground' or tags.get('tunnel'):
            continue
        for rings in P:
            try:
                p = LD.poly_from_rings(rings)
            except Exception:
                continue
            for q in LD.polys_only(p).geoms:
                if q.area < 20:
                    continue
                areas.append(q)
                aord.append(COVER[cl][0])
                acls.append(cl)
    # water the charts leave dry: OSM water (tidal or above sea level) drawn as water
    for nm in ('tidal', 'lakes'):
        for q in LD.load(nm).geoms:
            areas.append(q)
            aord.append(COVER['water'][0])
            acls.append('water')
    lines, lcls, lw = [], [], []
    rails = []
    for key, tags, a in R['line']:
        hw = tags.get('highway')
        if tags.get('tunnel') in ('yes', 'building_passage', 'culvert') or tags.get('covered') == 'yes' or tags.get('location') == 'underground':
            continue
        x, z = C.project(a[:, 0], a[:, 1])
        ls = shapely.linestrings(np.stack([x, z], 1))
        if hw in ROADS:
            w = ROADS[hw][0]
            ln = tags.get('lanes')
            try:
                if ln and hw in ('residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'unclassified'):
                    w = max(w * 0.6, min(w * 1.6, float(str(ln).split(';')[0]) * 3.4 + (1.0 if hw.startswith('motorway') else 0)))
            except ValueError:
                pass
            lines.append(ls)
            lcls.append(hw)
            lw.append(w)
        elif tags.get('railway') in ('rail', 'light_rail', 'tram', 'subway', 'narrow_gauge', 'preserved') and tags.get('railway') != 'abandoned':
            rails.append(ls)
        elif tags.get('waterway') in ('river', 'stream', 'canal', 'drain', 'ditch'):
            ww = {'river': 18.0, 'canal': 10.0, 'stream': 3.0, 'drain': 2.0, 'ditch': 1.5}[tags['waterway']]
            lines.append(ls)
            lcls.append('_water')
            lw.append(ww)
        elif tags.get('aeroway') in ('runway', 'taxiway'):
            try:
                ww = float(str(tags.get('width', '')).split()[0])
            except (ValueError, IndexError):
                ww = 45.0 if tags.get('aeroway') == 'runway' else 23.0
            lines.append(ls)
            lcls.append('_' + tags['aeroway'])
            lw.append(ww)
        elif tags.get('natural') == 'tree_row':
            lines.append(ls)
            lcls.append('_treerow')
            lw.append(7.0)
    trees = []
    for key, tags, lon, lat in R['node']:
        if tags.get('natural') == 'tree':
            x, z = C.project(lon, lat)
            trees.append((float(x), float(z)))
    # the buildings' roofs (client/tools/pipeline/backdrop/buildings.py): drawn into the ground, so the levels that leave
    # small buildings out of their shells (L5, L6) keep them as roofs, and the finer ones have no bare lot under a wall
    hb, SB = C.read_ctl(os.path.join(C.REC, 'buildings.ctl'))
    nb = hb['count']
    br, rs, rn = SB['br'].astype(np.int64), SB['rs'].astype(np.int64), SB['rn'].astype(np.int64)
    st0, ln0 = rs[br], rn[br]
    xz = SB['xz'].reshape(-1, 2)
    bx0 = np.minimum.reduceat(xz[:, 0], st0) if nb else np.zeros(0)
    bx1 = np.maximum.reduceat(xz[:, 0], st0) if nb else np.zeros(0)
    bz0 = np.minimum.reduceat(xz[:, 1], st0) if nb else np.zeros(0)
    bz1 = np.maximum.reduceat(xz[:, 1], st0) if nb else np.zeros(0)
    col = SB['col'].reshape(-1, 4)[:, :3].astype(np.float32)
    rcol = SB['rcol'].reshape(-1, 4)
    flat_roof = np.clip(col * 0.35 + np.array([50, 50, 52]), 0, 255)
    roof = np.where((rcol[:, 3] > 0)[:, None], rcol[:, :3].astype(np.float32), flat_roof).astype(np.uint8)
    bb = {}
    for k in range(nb):
        for gj in range(int(bz0[k] // 1024), int(bz1[k] // 1024) + 1):
            for gi in range(int(bx0[k] // 1024), int(bx1[k] // 1024) + 1):
                bb.setdefault((gi, gj), []).append(k)
    F = {'areas': np.array(areas, dtype=object), 'aord': np.array(aord, np.int32), 'acls': acls,
         'bxz': xz, 'bst': st0, 'bln': ln0, 'broof': roof, 'bbucket': bb,
         'lines': np.array(lines, dtype=object), 'lcls': lcls, 'lw': np.array(lw, np.float64),
         'rails': np.array(rails, dtype=object), 'trees': np.array(trees, np.float64).reshape(-1, 2)}
    F['aarea'] = shapely.area(F['areas'])
    F['atree'] = shapely.STRtree(F['areas'])
    F['ltree'] = shapely.STRtree(F['lines'])
    F['rtree'] = shapely.STRtree(F['rails'])
    print(f'[ground] drawing records: {len(areas)} areas, {len(lines)} lines, {len(rails)} rail lines, {len(trees)} trees ({time.time() - t0:.0f}s)', flush=True)
    return F


def vnoise(x, z, scale, seed):
    """value noise on world metres (seamless across chunks and levels)"""
    fx, fz = x / scale, z / scale
    ix, iz = np.floor(fx), np.floor(fz)
    tx, tz = fx - ix, fz - iz
    tx, tz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)

    def h(a, b):
        v = np.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453
        return v - np.floor(v)
    return (h(ix, iz) * (1 - tx) * (1 - tz) + h(ix + 1, iz) * tx * (1 - tz) + h(ix, iz + 1) * (1 - tx) * tz + h(ix + 1, iz + 1) * tx * tz)


def texture(lv, i, j, land):
    """albedo (RGB, TEXN) and night (L, NITN) for chunk (i, j) of level lv"""
    F = FEAT
    S = SIZE[lv]
    N = TEXN[lv] * SS
    mpp = S / N
    x0, z0 = i * S, j * S
    q = box(x0 - 30, z0 - 30, x0 + S + 30, z0 + S + 30)
    # per-pixel world coordinates (pixel centres)
    px = x0 + (np.arange(N) + 0.5) * mpp
    pz = z0 + (np.arange(N) + 0.5) * mpp
    X, Z = np.meshgrid(px, pz)
    # ---- class raster: draw land cover ids in order into an index image
    ids = sorted(F['atree'].query(q), key=lambda k: (F['aord'][k], -F['aarea'][k]))
    CL = list(COVER.keys())
    cls_img = Image.new('L', (N, N), CL.index('default'))
    d = ImageDraw.Draw(cls_img)
    tf = lambda a: [((xx - x0) / mpp, (zz - z0) / mpp) for xx, zz in a]  # noqa: E731
    for k in ids:
        p = F['areas'][k]
        ci = CL.index(F['acls'][k])
        ext = np.asarray(p.exterior.coords)
        if len(ext) < 3:
            continue
        if not p.interiors:
            d.polygon(tf(ext), fill=ci)
        else:
            m = Image.new('L', (N, N), 0)
            dm = ImageDraw.Draw(m)
            dm.polygon(tf(ext), fill=255)
            for h in p.interiors:
                dm.polygon(tf(np.asarray(h.coords)), fill=0)
            cls_img.paste(ci, (0, 0), m)
    cls = np.asarray(cls_img)
    base = np.zeros((N, N, 3), np.float32)
    amp = np.zeros((N, N), np.float32)
    can = np.zeros((N, N), np.float32)
    glow = np.zeros((N, N), np.float32)
    for ci, name in enumerate(CL):
        m = cls == ci
        if not m.any():
            continue
        o, col, a, cs, gl = COVER[name]
        base[m] = col
        amp[m] = a
        can[m] = cs
        glow[m] = gl
    # ---- noise: large patches, fine grain; canopy crowns where the cover holds trees
    n1 = vnoise(X, Z, 90.0, 1.0) - 0.5
    n2 = vnoise(X, Z, 23.0, 2.0) - 0.5
    n3 = vnoise(X, Z, 5.0, 3.0) - 0.5
    lum = 1.0 + (n1 * 0.9 + n2 * 0.6 + n3 * 0.5) * amp / 100.0
    img = base * lum[..., None]
    # crowns: 7 m blobs over a 40 m density field, canopy share by cover
    cr = vnoise(X, Z, 6.5, 4.0) * 0.65 + vnoise(X, Z, 3.0, 5.0) * 0.35
    dens = np.clip(can + (vnoise(X, Z, 45.0, 6.0) - 0.5) * 0.5 * np.minimum(can * 2.0, 1.0), 0, 1)
    tree = cr > (1.0 - dens * 0.9)
    shade = 0.75 + 0.5 * vnoise(X, Z, 2.2, 7.0)
    canopy_col = np.array(hexc('#3c5530'), np.float32)
    img = np.where(tree[..., None], canopy_col * shade[..., None] * (0.9 + 0.25 * (vnoise(X, Z, 60.0, 8.0)[..., None])), img)
    # ---- lines: roads (by class), waterways, runways, tree rows; railways
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')
    dr = ImageDraw.Draw(im)
    # ---- roofs (every building's footprint in its roof colour)
    seen = set()
    for gj in range(int(z0 // 1024), int((z0 + S) // 1024) + 1):
        for gi in range(int(x0 // 1024), int((x0 + S) // 1024) + 1):
            for k in F['bbucket'].get((gi, gj), ()):
                if k in seen:
                    continue
                seen.add(k)
                a = F['bxz'][F['bst'][k]:F['bst'][k] + F['bln'][k]]
                if len(a) < 3:
                    continue
                dr.polygon([((xx - x0) / mpp, (zz - z0) / mpp) for xx, zz in a], fill=tuple(int(v) for v in F['broof'][k]))
    night = Image.new('L', (N, N), 0)
    dn = ImageDraw.Draw(night)
    lids = F['ltree'].query(q)
    order = {'_water': 0, '_treerow': 1, '_runway': 2, '_taxiway': 3}
    lids = sorted(lids, key=lambda k: (order.get(F['lcls'][k], 10), F['lw'][k]))
    for k in lids:
        c = F['lcls'][k]
        w = F['lw'][k]
        a = np.asarray(F['lines'][k].coords)
        pts = tf(a)
        wp = max(1, int(round(w / mpp)))
        if c == '_water':
            dr.line(pts, fill=COVER['water'][1], width=wp, joint='curve')
        elif c == '_treerow':
            dr.line(pts, fill=(60, 84, 48), width=wp, joint='curve')
        elif c in ('_runway', '_taxiway'):
            dr.line(pts, fill=COVER[c[1:]][1], width=wp)
            dn.line(pts, fill=int(255 * COVER[c[1:]][4] * 0.6), width=max(1, wp // 6))
        else:
            if w / mpp < 0.6 and c in ('footway', 'path', 'cycleway', 'track', 'service'):
                continue
            col = ROADS[c][1]
            # sidewalks: a pale band either side of the streets that have them (not motorways, ramps, service lanes or paths)
            if c in SIDEWALK and (w + 4.0) / mpp >= 1.5:
                dr.line(pts, fill=SIDEWALK_COL, width=max(1, int(round((w + 4.4) / mpp))), joint='curve')
            dr.line(pts, fill=col, width=wp, joint='curve')
            g = ROADS[c][2] * NIGHT_ROADS
            if g > 0:
                # night: a faint glow along the road and, where a lamp spacing is a few pixels or more, the lamps as points
                dn.line(pts, fill=int(255 * g * 0.35), width=max(1, int(wp * 0.7)), joint='curve')
                lamp = LAMP_M.get(c, 40.0)
                if lamp / mpp >= 4.0:
                    seg = np.asarray(pts)
                    d_ = np.hypot(*np.diff(seg, axis=0).T)
                    tot = float(d_.sum())
                    if tot > 0:
                        cum = np.concatenate([[0.0], np.cumsum(d_)])
                        rr = max(1.0, 1.6 / mpp + 0.5)
                        for t_ in np.arange((lamp / mpp) * 0.5, tot, lamp / mpp):
                            q_ = np.searchsorted(cum, t_) - 1
                            q_ = min(max(q_, 0), len(d_) - 1)
                            f_ = (t_ - cum[q_]) / max(d_[q_], 1e-6)
                            u_, v_ = seg[q_] + (seg[q_ + 1] - seg[q_]) * f_
                            dn.ellipse((u_ - rr, v_ - rr, u_ + rr, v_ + rr), fill=int(255 * min(1.0, g * 1.6)))
    rw = max(1, int(round(4.0 / mpp)))
    for k in F['rtree'].query(q):
        a = np.asarray(F['rails'][k].coords)
        dr.line(tf(a), fill=(92, 84, 76), width=rw)
    # single trees (OSM natural=tree) as crowns at the finest levels
    if mpp <= 2.0 and len(F['trees']):
        tr = F['trees']
        m = (tr[:, 0] > x0 - 10) & (tr[:, 0] < x0 + S + 10) & (tr[:, 1] > z0 - 10) & (tr[:, 1] < z0 + S + 10)
        rpx = max(1.0, 4.0 / mpp)
        for tx_, tz_ in tr[m]:
            u, v = (tx_ - x0) / mpp, (tz_ - z0) / mpp
            dr.ellipse((u - rpx, v - rpx, u + rpx, v + rpx), fill=(58, 80, 46))
    # ---- night: the roads' lamps as a soft line, lit lots and yards
    nl = np.asarray(night).astype(np.float32) / 255.0
    nl = np.maximum(nl, glow * (0.6 + 0.4 * (vnoise(X, Z, 30.0, 9.0) > 0.45)))
    # ---- off the land (the water beyond the shore): the bank's colour, so filtering at the shore draws a bank, not
    # whatever the records put in the river (bridges, the river polygons), and no light over the water
    lm = Image.new('L', (N, N), 0)
    dl = ImageDraw.Draw(lm)
    for p in sorted(getattr(land, 'geoms', [land]), key=lambda g: -g.area):
        if p.geom_type != 'Polygon' or p.is_empty:
            continue
        dl.polygon(tf(np.asarray(p.exterior.coords)), fill=255)
        for h in p.interiors:
            dl.polygon(tf(np.asarray(h.coords)), fill=0)
    lma = np.asarray(lm.filter(ImageFilter.MaxFilter(3))) > 127
    arr = np.asarray(im).copy()
    arr[~lma] = BANK
    im = Image.fromarray(arr, 'RGB')
    nl[~lma] = 0.0
    nimg = Image.fromarray(np.clip(nl * 255, 0, 255).astype(np.uint8), 'L')
    im = im.resize((TEXN[lv], TEXN[lv]), Image.BOX)
    nimg = nimg.resize((NITN[lv], NITN[lv]), Image.BOX).filter(ImageFilter.GaussianBlur(0.8))
    b1, b2 = io.BytesIO(), io.BytesIO()
    im.save(b1, 'JPEG', quality=86, optimize=True)
    nimg.save(b2, 'JPEG', quality=80, optimize=True)
    return b1.getvalue(), b2.getvalue()


# ---------------------------------------------------------------------------------------------- the canopy (L3, L4)
# Woods (natural=wood, landuse=forest) as a canopy surface over the ground: the ground's heights plus a tree height of
# 13-20 m that wanders with the place (world-space noise at 30 m, crowns at 9 m on L3), triangulated like the ground within
# the canopy's own error, and its edge down to the ground: the Palisades' and the reservations' wooded skyline from the
# river and the air. The chunk's texture already holds the canopy's colour there.
CANOPY = {3: 0.8, 4: 1.6}      # level: the canopy surface's error (m)


def canopy(lv, i, j, land):
    S = SIZE[lv]
    x0, z0 = i * S, j * S
    q = box(x0, z0, x0 + S, z0 + S)
    ids = [k for k in FEAT['atree'].query(q) if FEAT['acls'][k] == 'wood']
    if not ids:
        return None
    woods = shapely.union_all([FEAT['areas'][k] for k in ids]).intersection(land)
    woods = LD.polys_only(woods)
    woods = shapely.MultiPolygon([g for g in woods.geoms if g.area > 1500.0])
    if woods.is_empty:
        return None
    n = GRIDN[lv]
    step = S / (n - 1)
    Hg = heights(lv, i, j)
    gx = x0 + np.arange(n) * step
    gz = z0 + np.arange(n) * step
    X, Z = np.meshgrid(gx, gz)
    T = 13.0 + 7.0 * vnoise(X, Z, 30.0, 11.0)
    if lv == 3:
        T += 2.0 * (vnoise(X, Z, 9.0, 12.0) - 0.5)
    Hc = Hg + T

    def ground_at(x, z):
        fx, fz = min(max(x / step, 0), n - 1.0001), min(max(z / step, 0), n - 1.0001)
        a, b = int(fx), int(fz)
        tx, tz = fx - a, fz - b
        return (Hg[b, a] * (1 - tx) * (1 - tz) + Hg[b, a + 1] * tx * (1 - tz) + Hg[b + 1, a] * (1 - tx) * tz + Hg[b + 1, a + 1] * tx * tz) - 0.3
    return mesh(lv, i, j, woods, H=Hc, maxerr=CANOPY[lv], skirt_bottom=ground_at, shades=(235, 165))


# ---------------------------------------------------------------------------------------------- one chunk
BD = None
OUTD = None


def work(job):
    lv, i, j = job
    t0 = time.time()
    S = SIZE[lv]
    cb = box(*chunk_box(lv, i, j))
    land = BD.intersection(cb)
    if land.is_empty:
        return (lv, i, j, None)
    M = mesh(lv, i, j, land)
    if M is None:
        return (lv, i, j, None)
    if lv in CANOPY:
        Cm = canopy(lv, i, j, land)
        if Cm is not None:
            nv0 = len(M['pos'])
            for k in ('pos', 'uv', 'nrm', 'sh'):
                M[k] = np.concatenate([M[k], Cm[k]])
            M['idx'] = np.concatenate([M['idx'], (Cm['idx'] + nv0).astype(np.uint32)])
            M['tris'] += Cm['tris']; M['canopy_tris'] = Cm['tris']
            M['y1'] = max(M['y1'], Cm['y1'])
    tex, nit = texture(lv, i, j, land)
    hdr = {'v': 1, 'kind': 'backdrop.ground', 'level': lv, 'ci': i, 'cj': j, 'origin': [i * S + S / 2, j * S + S / 2], 'scale': 1 / SCALE,
           'size': S, 'grid': GRIDN[lv], 'maxErr': MAXERR[lv], 'tris': M['tris'], 'skirtTris': M['skirt_tris'], 'y0': M['y0'], 'y1': M['y1'],
           'tex': TEXN[lv], 'nit': NITN[lv], 'landM2': round(land.area, 1)}
    C.write_ctl(os.path.join(OUTD, f'L{lv}_{i}_{j}.ctl'), hdr, [
        ('tpos', M['pos'].reshape(-1)), ('tuv', M['uv'].reshape(-1)), ('tnrm', M['nrm'].reshape(-1)), ('tidx', M['idx']), ('tsh', M['sh']),
        ('ttex', np.frombuffer(tex, np.uint8)), ('tnit', np.frombuffer(nit, np.uint8))])
    return (lv, i, j, {'tris': M['tris'], 'y0': M['y0'], 'y1': M['y1'], 'bytes': len(tex) + len(nit), 's': round(time.time() - t0, 2)})


def main():
    global G8, GM, FEAT, BD, OUTD
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(C.AUX, 'ground'))
    ap.add_argument('--levels', default='6,5,4,3')
    ap.add_argument('--only', default=None)
    ap.add_argument('--jobs', type=int, default=96)
    ap.add_argument('--plan', action='store_true')
    a = ap.parse_args()
    t0 = time.time()
    levels = [int(v) for v in a.levels.split(',')]
    OUTD = C.ensure(os.path.join(a.out, 'ground'))
    P = plan(levels)
    print('[ground] plan: ' + ', '.join(f'L{lv} {len(P[lv])}' for lv in (6, 5, 4, 3)) + f' ({time.time() - t0:.0f}s)', flush=True)
    json.dump({str(lv): P[lv] for lv in P}, open(os.path.join(OUTD, 'plan.json'), 'w'))
    if a.plan:
        return
    GM = T.grid_meta()
    G8 = np.load(os.path.join(C.REC, 'ground8.npy'))
    BD = LD.load('bd_land')
    FEAT = load_feats()
    jobs = [(lv, i, j) for lv in levels for (i, j) in P[lv]]
    if a.only:
        jobs = [jb for jb in jobs if f'L{jb[0]}_{jb[1]}_{jb[2]}' in a.only.split(',')]
    jobs.sort(key=lambda jb: -SIZE[jb[0]])
    res = {}
    ctx = get_context('fork')
    with ctx.Pool(min(a.jobs, max(1, len(jobs)))) as pool:
        for k, (lv, i, j, r) in enumerate(pool.imap_unordered(work, jobs, chunksize=1)):
            if r:
                res[f'L{lv}_{i}_{j}'] = r
            if (k + 1) % 200 == 0:
                print(f'[ground] {k + 1}/{len(jobs)} ({time.time() - t0:.0f}s)', flush=True)
    idx_f = os.path.join(OUTD, 'index.json')
    prev = json.load(open(idx_f)) if (a.only and os.path.exists(idx_f)) else {}
    prev.update(res)
    json.dump(prev, open(idx_f, 'w'), indent=0)
    tot = {lv: sum(1 for k in res if k.startswith(f'L{lv}_')) for lv in levels}
    tris = {lv: sum(v['tris'] for k, v in res.items() if k.startswith(f'L{lv}_')) for lv in levels}
    print(f'[ground] done {len(res)} chunks {tot}, triangles {tris} ({time.time() - t0:.0f}s)', flush=True)


if __name__ == '__main__':
    main()
