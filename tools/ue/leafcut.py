#!/usr/bin/env python3
# R1C (lane C, 2026-10-10): opaque leaves for one-sample rendering. Every leaf of the second tree set re-cut to its
# texture's alpha silhouette, so the leaves draw opaque (no alpha test) and TSR resolves them at one sample per frame:
#   - per species and atlas cell, the leaf's outline from its alpha at 0.5 (the petiole opened away, as leaves2.py), a
#     Douglas-Peucker polygon of at most --rim points (lod0; --rim1 for lod1), triangulated by ear clipping (concave lobes
#     kept); the compound leaves' cards (honeylocust H, sophora S) become one polygon per leaflet (--leaflet points for a
#     typical leaflet, more for merged clusters);
#   - each leaf of every mesh of the set rebuilt from its own star-polygon fan: the new outline's points placed on the old
#     leaf's surface by the barycentric weights of the old fan triangle that holds them (extrapolated past the old rim), so
#     the fold, droop, size and placement are the generator's; normals by the same weights; uv in the same atlas; the
#     per-leaf st1 (random value, crown depth) and shade carried over;
#   - a set directory beside the source (npz rebuilt, tex/ linked, set.json with every leaf_cut 'opaque', leafcut.json with
#     the polygons and their fit: cover = the share of the leaf's opaque texels inside, leak = the polygon's share outside).
#   uv run --no-project --with numpy --with pillow --with scipy --with scikit-image --with mapbox-earcut python tools/ue/leafcut.py \
#       [--src /data0/projectnyc_aux/assets/bxtrees2] [--dst /data0/projectnyc_aux/assets/r1c/bxtrees2] [--only P_m0_lod0,..]
#       [--rim 28] [--rim1 12] [--leaflet 7] [--sheet <jpg>]
import argparse, json, os, shutil, sys, time
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure
import mapbox_earcut as earcut

C = 1024   # atlas cell (px)


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def cell_alpha(A, cx, cy):
    r0 = (1 - cy) * C   # (v up: cell row 1 is the image's top half)
    return A[r0:r0 + C, cx * C:(cx + 1) * C]


def to_uv(rc):
    return np.stack([(rc[:, 1] + 0.5) / C, 1.0 - (rc[:, 0] + 0.5) / C], -1)


def area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


def simplify(rc, target):
    """Douglas-Peucker on a closed contour (pixels) with a growing tolerance until at most `target` points"""
    tol = 0.75
    while True:
        Q = measure.approximate_polygon(rc, tol)
        if np.allclose(Q[0], Q[-1]): Q = Q[:-1]
        if len(Q) <= target or tol > 64: return Q
        tol *= 1.2


def outlines(a, kind, target, leaflet, min_frac=4e-4):
    """the cell's leaf polygons in cell uv (CCW). kind 'mask': every leaflet of a compound card; else the one blade"""
    m = a >= 128
    mo = ndimage.binary_opening(m, structure=disk(3))   # (6 px: no petiole, no rachis)
    lab, n = ndimage.label(mo)
    if n == 0: return []
    sizes = ndimage.sum(mo, lab, range(1, n + 1))
    keep = [int(np.argmax(sizes)) + 1] if kind != 'mask' else [i + 1 for i, s in enumerate(sizes) if s >= min_frac * C * C]
    polys = []
    med = float(np.median([sizes[k - 1] for k in keep])) if keep else 1.0
    for k in keep:
        comp = ndimage.binary_fill_holes(lab == k)
        # (a compound card's leaflets: the points scale with the leaflet's size, merged clusters get more)
        tk = target if kind != 'mask' else int(np.clip(round(leaflet * (sizes[k - 1] / med) ** 0.5), 5, 48))
        reg = ndimage.binary_dilation(comp, iterations=2)
        f = np.pad(np.where(reg, a.astype(np.float32), 0.0), 1)
        cs = measure.find_contours(f, 127.5)
        if not cs: continue
        rc = max(cs, key=len) - 1.0
        Q = simplify(rc, tk)
        if len(Q) < 3: continue
        P = to_uv(Q)
        if area(P) < 0: P = P[::-1]
        polys.append(P)
    return polys


def triangulate(polys):
    """-> (V (M, 2) cell uv, T (K, 3)) wound clockwise in uv, as the generator's fans"""
    V, T, base = [], [], 0
    for P in polys:
        idx = earcut.triangulate_float64(np.ascontiguousarray(P, np.float64), np.array([len(P)], np.uint32)).reshape(-1, 3).astype(np.int64)
        V.append(P); T.append(idx + base); base += len(P)
    V = np.concatenate(V); T = np.concatenate(T)
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    s = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    T[s > 0] = T[s > 0][:, [0, 2, 1]]
    return V, T


def fan_weights(Uold, Q):
    """barycentric weights (M, R+1) of the new points Q in the old fan (centre Uold[0], rim Uold[1:]); a point outside
    every triangle takes the triangle it violates least (extrapolated)"""
    R = len(Uold) - 1
    i = np.arange(R)
    tri = np.stack([np.zeros(R, np.int64), 1 + (i + 1) % R, 1 + i], -1)
    A, B, Cc = Uold[tri[:, 0]], Uold[tri[:, 1]], Uold[tri[:, 2]]   # (R, 2)
    v0, v1 = B - A, Cc - A
    den = v0[:, 0] * v1[:, 1] - v0[:, 1] * v1[:, 0]                  # (R,)
    d = Q[:, None, :] - A[None]                                        # (M, R, 2)
    l1 = (d[..., 0] * v1[None, :, 1] - d[..., 1] * v1[None, :, 0]) / den[None]
    l2 = (v0[None, :, 0] * d[..., 1] - v0[None, :, 1] * d[..., 0]) / den[None]
    l0 = 1.0 - l1 - l2
    mn = np.minimum(np.minimum(l0, l1), l2)                            # (M, R)
    t = np.argmax(mn, 1)
    W = np.zeros((len(Q), R + 1))
    rows = np.arange(len(Q))
    for j, L in enumerate((l0, l1, l2)):
        np.add.at(W, (rows, tri[t, j]), L[rows, t])
    return W, float(-np.minimum(mn[rows, t], 0).max()) if len(Q) else 0.0


def fit(polys, a):
    """cover (the opened leaf's texels inside the polygons) and leak (the polygons' texels outside the leaf at 0.5)"""
    img = Image.new('L', (C, C), 0); dr = ImageDraw.Draw(img)
    for P in polys: dr.polygon([(u * C - 0.5, (1 - v) * C - 0.5) for u, v in P], fill=1)
    pm = np.array(img, bool)
    m = a >= 128
    mo = ndimage.binary_opening(m, structure=disk(3))
    return round(float((pm & mo).sum() / max(mo.sum(), 1)), 4), round(float((pm & ~m).sum() / max(pm.sum(), 1)), 4)


def build_cells(src, rim, rim1, leaflet):
    meta = json.load(open(os.path.join(src, 'tex', 'leaves.json')))
    out = {}
    for F, sp in sorted(meta['species'].items()):
        A = np.array(Image.open(os.path.join(src, 'tex', f'{F}_leaf_col.png')).convert('RGBA'))[..., 3]
        kind = 'mask' if sp.get('cut') == 'mask' else 'single'
        cells = []
        for k, c in enumerate(sp['cells']):
            cx, cy = k % 2, k // 2
            a = cell_alpha(A, cx, cy)
            rec = {'old': [c['centre']] + c['poly']}
            for lod, (tg, tl) in (('lod0', (rim, leaflet)), ('lod1', (rim1, max(4, leaflet // 2 + 1)))):
                polys = outlines(a, kind, tg, tl)
                V, T = triangulate(polys)
                cov, leak = fit(polys, a)
                rec[lod] = {'V': V.tolist(), 'T': T.tolist(), 'n': [len(P) for P in polys], 'cover': cov, 'leak': leak}
            rec['old_fit'] = {'cover': c.get('poly_cover'), 'leak': c.get('poly_leak')}
            cells.append(rec)
        out[F] = {'kind': kind, 'cells': cells}
        print(F, kind, 'lod0 pts', [sum(c['lod0']['n']) for c in cells], 'cover', [c['lod0']['cover'] for c in cells],
              'leak', [c['lod0']['leak'] for c in cells], '| old', [c['old_fit']['cover'] for c in cells], flush=True)
    return out


def recut(Z, cells, lod):
    """the npz's leaf arrays rebuilt with the new outlines -> dict of new leaf_* arrays and stats"""
    P, N, UV, UV1, I, Cs = (Z[f'leaf_{k}'] for k in ('P', 'N', 'UV', 'UV1', 'I', 'C'))
    R = len(cells[0]['old']) - 1
    nv = R + 1
    nL = len(P) // nv
    if nL * nv != len(P) or len(I) != nL * R: raise ValueError(f'not a fan mesh: {len(P)} verts, {len(I)} tris, R {R}')
    cuv = UV[0::nv].astype(np.float64)
    cx = np.clip(np.floor(cuv[:, 0] * 2), 0, 1).astype(np.int64); cy = np.clip(np.floor(cuv[:, 1] * 2), 0, 1).astype(np.int64)
    ci = cx + 2 * cy
    P3, N3, U3 = P.reshape(nL, nv, 3).astype(np.float64), N.reshape(nL, nv, 3).astype(np.float64), UV.reshape(nL, nv, 2).astype(np.float64)
    oP, oN, oUV, oUV1, oI, oC = [], [], [], [], [], []
    base, worst, extrap = 0, 0.0, 0.0
    for k in range(4):
        L = np.where(ci == k)[0]
        if not len(L): continue
        Uold = np.array(cells[k]['old'], np.float64)
        # (check: the leaves' own uv are the cell's fan)
        exp = np.stack([(k % 2 + Uold[:, 0]) / 2.0, (k // 2 + Uold[:, 1]) / 2.0], -1)
        worst = max(worst, float(np.abs(U3[L] - exp[None]).max()))
        rec = cells[k][lod]
        Q, T = np.array(rec['V'], np.float64), np.array(rec['T'], np.int64)
        W, ex = fan_weights(Uold, Q)
        extrap = max(extrap, ex)
        M = len(Q)
        Vn = np.einsum('mk,lkd->lmd', W, P3[L])
        Nn = np.einsum('mk,lkd->lmd', W, N3[L])
        Nn /= np.maximum(np.linalg.norm(Nn, axis=-1, keepdims=True), 1e-9)
        uv = np.stack([(k % 2 + Q[:, 0]) / 2.0, (k // 2 + Q[:, 1]) / 2.0], -1)
        oP.append(Vn.reshape(-1, 3)); oN.append(Nn.reshape(-1, 3))
        oUV.append(np.tile(uv, (len(L), 1)))
        oUV1.append(np.repeat(UV1[L * nv], M, axis=0)); oC.append(np.repeat(Cs[L * nv], M, axis=0))
        oI.append((np.arange(len(L))[:, None, None] * M + T[None]).reshape(-1, 3) + base)
        base += len(L) * M
    if worst > 2e-3: raise ValueError(f'leaf uv off the cell fans by {worst:.4f}')
    new = {'leaf_P': np.concatenate(oP).astype(np.float32), 'leaf_N': np.concatenate(oN).astype(np.float32),
           'leaf_UV': np.concatenate(oUV).astype(np.float32), 'leaf_UV1': np.concatenate(oUV1).astype(np.float32),
           'leaf_I': np.concatenate(oI).astype(np.uint32), 'leaf_C': np.concatenate(oC).astype(np.float32)}
    return new, {'leaves': int(nL), 'tris_old': int(len(I)), 'tris_new': int(len(new['leaf_I'])), 'uv_err': round(worst, 5), 'extrap': round(extrap, 3)}


def sheet(cells, src, path):
    tiles = []
    for F in sorted(cells):
        im = Image.open(os.path.join(src, 'tex', f'{F}_leaf_col.png')).convert('RGBA').resize((512, 512))
        bg = Image.new('RGB', (512, 512), (40, 40, 40)); bg.paste(im, (0, 0), im)
        dr = ImageDraw.Draw(bg)
        for k, c in enumerate(cells[F]['cells']):
            cx, cy = k % 2, k // 2
            px = lambda u, v: ((cx + u) / 2 * 512, (1 - (cy + v) / 2) * 512)
            old = c['old'][1:]
            dr.line([px(*p) for p in old + old[:1]], fill=(80, 140, 255), width=1)
            V = c['lod0']['V']
            for t in c['lod0']['T']:
                dr.line([px(*V[t[0]]), px(*V[t[1]]), px(*V[t[2]]), px(*V[t[0]])], fill=(255, 60, 60), width=1)
        dr.text((6, 6), F, fill=(255, 255, 0))
        tiles.append(bg)
    cols = 4
    S = Image.new('RGB', (512 * cols, 512 * ((len(tiles) + cols - 1) // cols)), (0, 0, 0))
    for i, t in enumerate(tiles): S.paste(t, ((i % cols) * 512, (i // cols) * 512))
    S.save(path, quality=90)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='/data0/projectnyc_aux/assets/bxtrees2')
    ap.add_argument('--dst', default='/data0/projectnyc_aux/assets/r1c/bxtrees2')
    ap.add_argument('--only', default=None); ap.add_argument('--sheet', default=None)
    ap.add_argument('--rim', type=int, default=28); ap.add_argument('--rim1', type=int, default=12); ap.add_argument('--leaflet', type=int, default=7)
    ap.add_argument('--cells-only', action='store_true')
    a = ap.parse_args()
    t0 = time.time()
    os.makedirs(os.path.join(a.dst, 'npz'), exist_ok=True)
    cells = build_cells(a.src, a.rim, a.rim1, a.leaflet)
    json.dump({'rim': a.rim, 'rim1': a.rim1, 'leaflet': a.leaflet, 'species': cells}, open(os.path.join(a.dst, 'leafcut.json'), 'w'))
    if a.sheet: sheet(cells, a.src, a.sheet)
    print('cells', round(time.time() - t0, 1), 's', flush=True)
    if a.cells_only: return
    # the set's side files: tex linked, trees.json copied, set.json with every leaf opaque
    if not os.path.lexists(os.path.join(a.dst, 'tex')): os.symlink(os.path.join(a.src, 'tex'), os.path.join(a.dst, 'tex'))
    shutil.copyfile(os.path.join(a.src, 'trees.json'), os.path.join(a.dst, 'trees.json'))
    sj = json.load(open(os.path.join(a.src, 'set.json')))
    sj['leaf_cut'] = {F: 'opaque' for F in sj.get('leaf_cut', {})}
    sj['r1c'] = {'from': a.src, 'rim': a.rim, 'rim1': a.rim1, 'leaflet': a.leaflet, 'made': time.ctime(),
                 'note': 'every leaf cut to its alpha silhouette (tools/ue/leafcut.py), drawn opaque'}
    json.dump(sj, open(os.path.join(a.dst, 'set.json'), 'w'), indent=1)
    only = set(a.only.split(',')) if a.only else None
    stats = {}
    for fn in sorted(os.listdir(os.path.join(a.src, 'npz'))):
        if not fn.endswith('.npz'): continue
        tid_lod = fn[:-4]
        F, lod = tid_lod.split('_')[0], tid_lod.split('_')[-1]
        dst = os.path.join(a.dst, 'npz', fn)
        if only and tid_lod not in only: continue
        Z = np.load(os.path.join(a.src, 'npz', fn))
        if 'leaf_P' not in Z.files or F not in cells or lod not in ('lod0', 'lod1'):
            shutil.copyfile(os.path.join(a.src, 'npz', fn), dst); stats[tid_lod] = 'copied'; continue
        t = time.time()
        try:
            new, st = recut(Z, cells[F]['cells'], lod)
        except Exception as e:
            shutil.copyfile(os.path.join(a.src, 'npz', fn), dst); stats[tid_lod] = f'copied ({e})'; print(tid_lod, 'KEPT', e, flush=True); continue
        arr = {k: Z[k] for k in Z.files if not k.startswith('leaf_')}
        arr.update(new)
        np.savez(dst, **arr)
        st['secs'] = round(time.time() - t, 1)
        stats[tid_lod] = st
        print(tid_lod, st, flush=True)
    json.dump(stats, open(os.path.join(a.dst, 'leafcut_stats.json'), 'w'), indent=1)
    print('done', round(time.time() - t0, 1), 's', flush=True)


if __name__ == '__main__':
    main()
