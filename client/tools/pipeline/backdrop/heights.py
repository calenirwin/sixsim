"""The backdrop's ground heights (docs/notes/r2-backdrop.md) on the 8 m grid of terrain.py:

  python3 heights.py     -> <records>/ground8.npy (float32, same grid as dem8.npy) and ground8.json

From the DEM (metres NAVD88, about mean sea level), with two joins to what the city draws:
  * a land border (the Bronx and Westchester, Queens and Nassau): the city is compiled flat at 3.2 m today, so the
    backdrop comes to 3.2 m at the city's line and rises to the real ground over BLEND_M (smooth, a few per cent); when
    the city takes its terrain (R5.6) the same blend joins the city's heights instead (city_y below);
  * the shore: land never under MIN_LAND over the water plane (y 0), so no land is drawn below the water.
The bridges' New Jersey ends stand on this ground through tools/lod/backdrop_heights.mjs, so no landing plateau is
drawn: the city's New Jersey landing patches are retired (docs/notes/r2-backdrop.md, the landing plan's step 4; the
plateau had held the Palisades at 61.7 m over the George Washington Bridge's 1.7 km2 patch, out to the river).
"""
import json
import os
import pickle
import sys
import time

import numpy as np
import shapely
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import land as LD  # noqa: E402
import terrain as T  # noqa: E402

BLEND_M = 800.0
MIN_LAND = 1.0
PIER_Y = 2.4


def smooth01(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def rasterize_lines(g, meta):
    """grid samples within half a step of a (multi)line"""
    M = np.zeros((meta['nz'], meta['nx']), bool)
    s, x0, z0 = meta['step'], meta['x0'], meta['z0']
    geoms = getattr(g, 'geoms', [g])
    for ln in geoms:
        if ln.is_empty or ln.geom_type not in ('LineString', 'LinearRing'):
            continue
        a = np.asarray(ln.coords)
        for (ax, az), (bx, bz) in zip(a[:-1], a[1:]):
            L = max(abs(bx - ax), abs(bz - az))
            n = max(2, int(L / (s * 0.5)) + 1)
            t = np.linspace(0, 1, n)
            i = np.round((ax + (bx - ax) * t - x0) / s).astype(int)
            j = np.round((az + (bz - az) * t - z0) / s).astype(int)
            ok = (i >= 0) & (j >= 0) & (i < meta['nx']) & (j < meta['nz'])
            M[j[ok], i[ok]] = True
    return M


def main():
    t0 = time.time()
    meta = T.grid_meta()
    dem = np.load(os.path.join(C.REC, 'dem8.npy'))
    H = dem.astype(np.float32).copy()
    s = meta['step']
    # ---- the land border's blend
    lb = LD.load('land_border')
    B = rasterize_lines(lb, meta)
    city_y = LD.BASE_Y
    if B.any():
        d = ndimage.distance_transform_edt(~B) * s
        w = smooth01(d / BLEND_M).astype(np.float32)
        near = d < BLEND_M
        H[near] = city_y + (H[near] - city_y) * w[near]
        print(f'[heights] land border: {B.sum()} samples on the line, {near.sum()} within {BLEND_M:.0f} m', flush=True)
    # ---- the shore: land over the water plane; pier decks at PIER_Y
    M = np.load(os.path.join(C.REC, 'land', 'mask_bd.npy'))
    H = np.where(M, np.maximum(H, MIN_LAND), H).astype(np.float32)
    piers = LD.load('piers')
    if not piers.is_empty:
        PM = LD.raster_mask(piers, meta)
        H = np.where(PM & M, np.maximum(H, PIER_Y), H).astype(np.float32)
        print(f'[heights] pier decks: {(PM & M).sum()} samples at {PIER_Y} m or more', flush=True)
    out = os.path.join(C.REC, 'ground8.npy')
    np.save(out + '.tmp.npy', H)
    os.replace(out + '.tmp.npy', out)
    json.dump({**meta, 'made': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'blend_m': BLEND_M, 'min_land': MIN_LAND,
               'city_y': city_y, 'plateaus': False}, open(os.path.join(C.REC, 'ground8.json'), 'w'), indent=1)
    print(f'[heights] done {time.time() - t0:.0f}s -> {out}', flush=True)


if __name__ == '__main__':
    main()
