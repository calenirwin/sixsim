#!/usr/bin/env python3
# The far level's water, clipped to real water (R2B, 2026-10-11): for every L6 square of the persistent tier (8,192 m,
# i -4..3, j -3..4: x -32.8 to +32.8 km, z -24.6 to +41.0 km), the part that is water: the charts' depth and dredged areas
# (client/data/raw/enc_water.json, tools/lod/fetch_enc_water.mjs: NOAA ENC, public domain), and next to the city's land
# (client/data/raw/boundaries.geojson) the strip between a chart's coarse shore and the bulkheads (the city's land grown
# 60 m, where a chart's water lies within 150 m), so the water reaches under every bulkhead; the city's own land covers
# what lies under it. Land outside the city (New Jersey, Westchester, Nassau) gets no water: it stays empty until there
# is land there. Triangulated (constrained Delaunay) in each square's own frame, for tools/lod/export_packages.mjs.
# BD40 (backdrop lane, 2026-10-11; the backdrop lane owns the water beyond the city's line and the land, so one lane owns
# the coastline):
#   * a chart scale counts only where no finer one covers (the harbour charts' coverage areas, then the approach charts'):
#     the coastal charts' generalised depth areas had put sea over Edgewater, the Yonkers waterfront and Glen Cove; where a
#     coastal chart is the only one, its water stops at the OpenStreetMap coastline's land (the backdrop's osm_land);
#   * the extent is the backdrop's L6 squares, i -7..5, j -5..6 (the city's line buffered by 25 km);
#   * the shore strip stays inside the city's line (it reached across the land borders into Westchester and Nassau);
#   * the united, simplified water polygon itself is written beside the triangles (water_l6.wkb, world metres, shapely WKB):
#     the backdrop's land is its exact complement outside the city (client/tools/pipeline/backdrop/land.py).
#
#   python3 tools/lod/water_l6.py [--enc <enc_water.json>] [--out <dir>]
#       writes <dir>/water_l6.json and <dir>/water_l6.wkb (default client/data/raw)
import argparse, json, math, os, sys, time
import shapely
from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely.ops import unary_union, transform

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'client', 'data', 'raw')
LAT0, LON0, MLAT = 40.7831, -73.9712, 111132.0
MLON = 111320.0 * math.cos(math.radians(LAT0))
SIZE = 8192.0
I_RANGE, J_RANGE = range(-7, 6), range(-5, 7)   # BD40: the backdrop's L6 squares (was i -4..3, j -3..4)
# BD40: the backdrop's records (client/tools/pipeline/backdrop/land.py base): the city's line and the coastline's land
BD_REC = os.environ.get('BD_REC', '/data0/projectnyc_aux/tiles_backdrop/records')
SIMPLIFY = 4.0   # metres


def proj(lon, lat, z=None):
    return ((lon - LON0) * MLON, -(lat - LAT0) * MLAT)


def to_xz(g):
    return transform(lambda x, y, z=None: proj(x, y), g)


def l6_holes(tiles, nyc):
    """BD40: the 64 m cells inside the city's line that the far level's ground leaves undrawn (all four corners of the
    macro terrain grid at -3 m or lower, or no macro at all), as polygons"""
    import struct
    import numpy as np
    man = json.load(open(os.path.join(tiles, 'manifest.json')))
    step, M = 64.0, 2048.0
    x0, z0, x1, z1 = nyc.bounds
    i0, j0 = int(math.floor(x0 / step)), int(math.floor(z0 / step))
    i1, j1 = int(math.ceil(x1 / step)), int(math.ceil(z1 / step))
    cov = np.zeros((j1 - j0, i1 - i0), bool)
    for key, e in man.get('macros', {}).items():
        mx, mz = (int(v) for v in key.split('_'))
        buf = open(os.path.join(tiles, e['f']), 'rb').read()
        hl = struct.unpack('<I', buf[4:8])[0]
        hdr = json.loads(buf[8:8 + hl])
        base = 8 + hl + (4 - (8 + hl) % 4) % 4
        sec = next((q for q in hdr['sections'] if q['name'] == 'terr'), None)
        if not sec:
            continue
        t = np.frombuffer(buf, np.float32, sec['length'], base + sec['offset']).reshape(33, 33)
        drawn = ~((t[:-1, :-1] <= -3) & (t[1:, :-1] <= -3) & (t[:-1, 1:] <= -3) & (t[1:, 1:] <= -3))
        ci0, cj0 = int(mx * M / step) - i0, int(mz * M / step) - j0
        a0, b0 = max(0, -ci0), max(0, -cj0)
        a1, b1 = min(32, cov.shape[1] - ci0), min(32, cov.shape[0] - cj0)
        if a1 > a0 and b1 > b0:
            cov[cj0 + b0:cj0 + b1, ci0 + a0:ci0 + a1] |= drawn[b0:b1, a0:a1]
    rects = []
    for r in range(cov.shape[0]):
        row = ~cov[r]
        c = 0
        while c < row.size:
            if row[c]:
                c2 = c
                while c2 < row.size and row[c2]:
                    c2 += 1
                rects.append(box((i0 + c) * step, (j0 + r) * step, (i0 + c2) * step, (j0 + r + 1) * step))
                c = c2
            else:
                c += 1
    return unary_union(rects).intersection(nyc) if rects else shapely.Polygon()


def main():
    t0 = time.time()
    ap = argparse.ArgumentParser()
    ap.add_argument('--enc', default=os.path.join(RAW, 'enc_water.json'))
    ap.add_argument('--out', default=RAW)
    ap.add_argument('--tiles', default=os.path.join(ROOT, 'client', 'public', 'tiles'))
    a = ap.parse_args()
    enc = json.load(open(a.enc))
    # ==== BD40: water per chart scale, a scale counting only where no finer chart covers
    parts = {'harbour': [], 'approach': [], 'coastal': []}
    cover = {'harbour': [], 'approach': [], 'coastal': []}
    npoly = 0
    for f in enc['features']:
        pr = f.get('properties') or {}
        sc = pr.get('scale')
        if sc not in parts:
            continue
        try:
            g = shape(f['geometry'])
        except Exception:
            continue
        if g.is_empty: continue
        g = to_xz(g)
        if not g.is_valid: g = g.buffer(0)
        if str(pr.get('layer', '')).endswith('Coverage_area'):
            if pr.get('CATCOV') in (None, 'coverage available', 1, '1'): cover[sc].append(g)
            continue
        parts[sc].append(g)
        npoly += 1
    U = {k: unary_union(v) if v else shapely.Polygon() for k, v in parts.items()}
    CV = {k: unary_union(v) if v else shapely.Polygon() for k, v in cover.items()}
    finer = CV['harbour']
    water_a = U['approach'].difference(finer)
    finer = unary_union([finer, CV['approach']])
    water_c = U['coastal'].difference(finer)
    osm_land_f = os.path.join(BD_REC, 'land', 'osm_land.wkb')
    if os.path.exists(osm_land_f):
        osm_land = shapely.from_wkb(open(osm_land_f, 'rb').read())
        cut = water_c.intersection(osm_land).area
        water_c = water_c.difference(osm_land)
        print(f'coastal-only water: {cut / 1e6:.2f} km2 over the OSM coastline\'s land removed', flush=True)
    else:
        print(f'no {osm_land_f}: coastal-only water kept as charted', flush=True)
    water = unary_union([U['harbour'], water_a, water_c])
    print(f'charts: {npoly} areas united in {time.time() - t0:.1f} s (harbour {U["harbour"].area / 1e6:.0f} km2, approach beyond the harbour charts '
          f'{water_a.area / 1e6:.0f} km2, coastal beyond both {water_c.area / 1e6:.0f} km2)', flush=True)
    # ==== end BD40
    city = unary_union([to_xz(shape(f['geometry'])).buffer(0) for f in json.load(open(os.path.join(RAW, 'boundaries.geojson')))['features']])
    nyc_f = os.path.join(BD_REC, 'land', 'nyc.wkb')   # BD40: the strip stays inside the city's line
    extra = []
    nyc = None
    if os.path.exists(nyc_f):
        nyc = shapely.from_wkb(open(nyc_f, 'rb').read())
        # ==== BD40: no hole anywhere inside the city's line either: the city's own water (its line less its land and the New
        # Jersey landing patches it compiles), and every 64 m cell of the far level's ground (the macro terrain grids,
        # build_persistent.mjs ground()) that is not drawn, so a renderer drawing that ground sees water there
        land_f = os.path.join(BD_REC, 'land', 'landings.pkl')
        lands = []
        if os.path.exists(land_f):
            import pickle
            lands = [shapely.from_wkb(l['wkb']) for l in pickle.load(open(land_f, 'rb'))]
        city_water = nyc.difference(city).difference(unary_union(lands) if lands else shapely.Polygon())
        holes = l6_holes(a.tiles, nyc)
        extra += [city_water, holes]
        print(f'the city\'s own water {city_water.area / 1e6:.1f} km2; far ground not drawn inside the city\'s line {holes.area / 1e6:.2f} km2', flush=True)
    # the strip under the city's bulkheads: along every shore of the city, the charts' and its own (BD40: inside its line)
    near = unary_union([water] + extra[:1]).buffer(150.0, quad_segs=4)
    strip = city.buffer(60.0, quad_segs=4).intersection(near)
    if nyc is not None:
        strip = strip.intersection(nyc)
    allw = unary_union([water, strip] + extra).simplify(SIMPLIFY, preserve_topology=True)
    if not allw.is_valid: allw = allw.buffer(0)
    print(f'water with the shore strip in {time.time() - t0:.1f} s', flush=True)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, 'water_l6.wkb.tmp'), 'wb') as fw:   # BD40: the polygon the backdrop's land complements
        fw.write(shapely.to_wkb(allw))
    os.replace(os.path.join(a.out, 'water_l6.wkb.tmp'), os.path.join(a.out, 'water_l6.wkb'))
    out = {'version': 2, 'size': SIZE, 'source': 'NOAA ENC depth, dredged and unsurveyed areas (public domain), each chart scale where no finer one covers, with the city\'s shore strip; R2B, BD40',
           'squares': {}, 'polygon': 'water_l6.wkb'}
    ntri = 0
    for j in J_RANGE:
        for i in I_RANGE:
            ox, oz = i * SIZE, j * SIZE
            part = allw.intersection(box(ox, oz, ox + SIZE, oz + SIZE))
            if part.is_empty:
                out['squares'][f'{i}_{j}'] = {'tris': [], 'area': 0}
                continue
            geoms = list(part.geoms) if hasattr(part, 'geoms') else [part]
            tris = []
            for g in geoms:
                if g.geom_type != 'Polygon' or g.area < 4.0: continue
                for t in shapely.constrained_delaunay_triangles(g).geoms:
                    c = list(t.exterior.coords)[:3]
                    # facing up seen from +y with z south: (x, z) clockwise in the plane, as the exporter's quad
                    (ax, az), (bx, bz), (cx, cz) = c
                    if (bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0: c = [c[0], c[2], c[1]]
                    for (x, z) in c: tris += [round(x - ox, 2), round(z - oz, 2)]
            out['squares'][f'{i}_{j}'] = {'tris': tris, 'area': round(part.area / 1e6, 3)}
            ntri += len(tris) // 6
    json.dump(out, open(os.path.join(a.out, 'water_l6.json'), 'w'), separators=(',', ':'))
    full = sum(1 for v in out['squares'].values() if v['area'] > SIZE * SIZE / 1e6 * 0.999)
    empty = sum(1 for v in out['squares'].values() if not v['tris'])
    print(json.dumps({'squares': len(out['squares']), 'triangles': ntri, 'all_water': full, 'no_water': empty, 'secs': round(time.time() - t0, 1)}))


if __name__ == '__main__':
    main()
