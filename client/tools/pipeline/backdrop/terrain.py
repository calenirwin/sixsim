"""The backdrop's elevation (docs/notes/r2-backdrop.md): the USGS 3DEP 1/3 arc-second DEM (public domain; NAD83
geographic, metres NAVD88) sampled bilinearly onto an 8 m grid in world coordinates over the region's L6 squares.

  python3 terrain.py            -> <records>/dem8.npy (float32 [rows z][cols x]) and dem8.json (origin, step, shape)

The grid's sample (i, j) sits at world x = X0 + i * STEP, z = Z0 + j * STEP; X0, Z0 lie on the L6 grid (8,192 m), so every
chunk of every level starts on a sample. No-data (outside the survey) is read as 0 (sea level): the DEM is hydro-
flattened, open water is ~0 m already.
"""
import json
import math
import os
import sys
import time

import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

STEP = 8.0
L6 = C.LEVEL_SIZE[6]
X0 = math.floor(C.BOX_XZ[0] / L6) * L6
Z0 = math.floor(C.BOX_XZ[1] / L6) * L6
X1 = math.ceil(C.BOX_XZ[2] / L6) * L6
Z1 = math.ceil(C.BOX_XZ[3] / L6) * L6
NX = int((X1 - X0) / STEP) + 1
NZ = int((Z1 - Z0) / STEP) + 1
TILES = ('n41w074', 'n41w075', 'n42w074', 'n42w075')


def grid_meta():
    return {'x0': X0, 'z0': Z0, 'x1': X1, 'z1': Z1, 'step': STEP, 'nx': NX, 'nz': NZ}


class Dem:
    def __init__(self):
        self.t = []
        for name in TILES:
            fn = os.path.join(C.RAW_BD, 'dem', f'USGS_13_{name}.tif')
            with tifffile.TiffFile(fn) as tf:
                p = tf.pages[0]
                a = p.asarray()
                sx, sy = p.tags['ModelPixelScaleTag'].value[:2]
                lon0, lat0 = p.tags['ModelTiepointTag'].value[3:5]
            a[a < -1000] = 0.0
            self.t.append((a, lon0, lat0, sx, sy))
            print(f'[dem] {name} {a.shape} lon {lon0:.4f} lat {lat0:.4f}', flush=True)

    def sample(self, lon, lat):
        """bilinear over pixel centres; a point in no tile gets 0"""
        out = np.zeros(lon.shape, np.float32)
        done = np.zeros(lon.shape, bool)
        for a, lon0, lat0, sx, sy in self.t:
            fx = (lon - lon0) / sx - 0.5
            fy = (lat0 - lat) / sy - 0.5
            h, w = a.shape
            m = (~done) & (fx >= 0) & (fy >= 0) & (fx <= w - 1.001) & (fy <= h - 1.001)
            if not m.any():
                continue
            x, y = fx[m], fy[m]
            i0, j0 = np.floor(y).astype(np.int64), np.floor(x).astype(np.int64)
            ty, tx = (y - i0).astype(np.float32), (x - j0).astype(np.float32)
            v = (a[i0, j0] * (1 - tx) * (1 - ty) + a[i0, j0 + 1] * tx * (1 - ty)
                 + a[i0 + 1, j0] * (1 - tx) * ty + a[i0 + 1, j0 + 1] * tx * ty)
            out[m] = v
            done |= m
        return out


def main():
    t0 = time.time()
    D = Dem()
    G = np.zeros((NZ, NX), np.float32)
    xs = X0 + np.arange(NX) * STEP
    for j0 in range(0, NZ, 512):
        zs = Z0 + np.arange(j0, min(NZ, j0 + 512)) * STEP
        XX, ZZ = np.meshgrid(xs, zs)
        lon, lat = C.unproject(XX, ZZ)
        G[j0:j0 + len(zs)] = D.sample(lon, lat)
    out = os.path.join(C.ensure(C.REC), 'dem8.npy')
    np.save(out + '.tmp.npy', G)
    os.replace(out + '.tmp.npy', out)
    meta = {**grid_meta(), 'source': [f'client/data/raw/backdrop/dem/USGS_13_{n}.tif' for n in TILES], 'units': 'm NAVD88',
            'made': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'min': float(G.min()), 'max': float(G.max())}
    json.dump(meta, open(os.path.join(C.REC, 'dem8.json'), 'w'), indent=1)
    print(f'[dem] grid {NX} x {NZ} at {STEP} m, {G.min():.1f}..{G.max():.1f} m, {time.time() - t0:.0f}s -> {out}', flush=True)


if __name__ == '__main__':
    main()
