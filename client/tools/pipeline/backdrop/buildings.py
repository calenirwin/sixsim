"""The backdrop's buildings (docs/notes/r2-backdrop.md):

  python3 buildings.py     -> <records>/buildings.ctl (+ buildings.json: counts, sources, the tallest)

OpenStreetMap footprints and building parts outside the city's line inside the region (ODbL, (c) OpenStreetMap
contributors), with a height from `height`, else `building:levels` (and `roof:levels`), else the matched Microsoft Global
ML Building Footprints estimate, else the type's typical height; gap-filled with Microsoft footprints that no OSM
footprint covers (ODbL). An outline whose parts cover most of it is drawn by its parts. Each building gets a facade
style, colours (classify.mjs's palettes, or its `building:colour`), a floor height, a lit share for the night windows,
a roof form, and its base on the backdrop's ground (heights.py), lowest under its outline.

Sections (CTL1): xz Float32 (ring vertices, world x, z), rs/rn Uint32 (each ring's first vertex and count), br/bn
Uint32 (each building's first ring and ring count: the outline then its holes), base Float32, h Float32 (top over base),
minh Float32 (a part's bottom over base), col Uint8 x4 (wall sRGB, lit share), rcol Uint8 x4 (roof sRGB, roof form),
sty Uint8 (STYLE id), fh Float32 (floor height), rh Float32 (pitched roof height), src Uint8 (0 OSM building, 1 OSM part,
2 Microsoft gap-fill), seed Float32 (0..1).
"""
import glob
import gzip
import json
import math
import os
import re
import sys
import time
from multiprocessing import Pool

import numpy as np
import shapely
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import land as LD  # noqa: E402
import terrain as T  # noqa: E402

# ---- client/src/shared/geo.js STYLE
STYLE = dict(TENEMENT=0, PREWAR_APT=1, POSTWAR_BRICK=2, MODERN_GLASS=3, DECO_MASONRY=4, ROWHOUSE=5, LOFT_CASTIRON=6,
             INDUSTRIAL=7, CIVIC_STONE=8, CHURCH=9, RETAIL_STRIP=10, GLASS_TOWER_BLUE=11, PROJECT_BRICK=12,
             RETAIL_MODERN=13, FRAME_HOUSE=14, CONDO_NEW=15)
ROOF = dict(flat=0, gabled=1, hipped=2, pyramidal=3, dome=4, skillion=5, gambrel=1, mansard=2, half_hipped=2, round=4, onion=4)


def hexes(*hs):
    return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in hs]


# ---- client/tools/pipeline/classify.mjs PAL (the city's palettes)
PAL = {
    'brownstone': hexes('#6b4a38', '#7a5644', '#5e4234', '#83614c', '#75503c', '#8a6a52'),
    'brickRed': hexes('#8f4e3c', '#9c5744', '#7c4234', '#a4614a', '#8a4a38', '#96604c'),
    'brickOrange': hexes('#b06a48', '#a86142', '#bd7a54', '#9d5c40'),
    'brickTan': hexes('#c2a37c', '#b89a74', '#cbb08a', '#ab8d68', '#d1b892'),
    'brickWhite': hexes('#d9d2c4', '#e0dacd', '#cfc7b8', '#e6e0d4'),
    'paintedGray': hexes('#9aa0a2', '#8a9092', '#a8aeb0', '#7e8486'),
    'limestone': hexes('#d8cfbc', '#cfc5b0', '#e0d8c6', '#c8bfae'),
    'glassBlue': hexes('#7c98ac', '#7290a8', '#86a2b4', '#6c8ca4'),
    'glassGreen': hexes('#7c9c90', '#88a89a', '#729488'),
    'glassDark': hexes('#5a6a74', '#4e5e68', '#66767e'),
    'concrete': hexes('#b0aca2', '#bcb8ae', '#a49f95', '#c4c0b6'),
    'churchStone': hexes('#b8ab96', '#a89b86', '#c4b8a4', '#918475'),
    'panelMetal': hexes('#8e9195', '#5f6367', '#a9a093', '#c0c1bf', '#8a7a68'),
    'siding': hexes('#eceae4', '#eceae4', '#eceae4', '#eceae4', '#eceae4', '#e3dcc7', '#e3dcc7', '#e3dcc7', '#e3dcc7',
                    '#cfd0cd', '#cfd0cd', '#d8caa8', '#d8caa8', '#c3cfd6', '#c3cfd6', '#c1c8b4', '#c1c8b4', '#7b93a5',
                    '#e6dcae', '#c0ab8b', '#9b9d9b', '#8b4a3d', '#e0cdb4', '#3f5645', '#5d4a3b'),
    'condoPanel': hexes('#7b7e82', '#5c6064', '#9a9c9a', '#b3b0a8', '#4e5154', '#6d7174'),
    'condoBrick': hexes('#8a5a46', '#a08066', '#6f5a4c', '#c0ab93', '#7d6a58'),
}
# pitched roofs: asphalt shingle, slate, terracotta (sRGB); flat roofs take the far roof colour in the builder
SHINGLE = hexes('#4a4a4c', '#56524e', '#3e3f42', '#5e5650', '#6a5446', '#4f5257', '#7a5a48', '#58504a')
NAMED = {'white': (230, 228, 220), 'grey': (150, 150, 150), 'gray': (150, 150, 150), 'black': (50, 50, 52),
         'red': (150, 70, 55), 'brown': (110, 80, 60), 'beige': (205, 190, 160), 'yellow': (220, 200, 120),
         'tan': (190, 165, 125), 'blue': (110, 140, 170), 'green': (110, 140, 110), 'silver': (180, 184, 188),
         'cream': (225, 215, 190), 'orange': (190, 120, 70), 'darkgray': (90, 90, 92), 'darkgrey': (90, 90, 92),
         'lightgray': (190, 190, 190), 'lightgrey': (190, 190, 190), 'maroon': (110, 40, 40)}

HOUSE = {'house', 'detached', 'semidetached_house', 'bungalow', 'farm', 'cabin', 'static_caravan', 'houseboat', 'villa'}
TERRACE = {'terrace', 'townhouse'}
APART = {'apartments', 'residential', 'dormitory', 'flats'}
OFFICE = {'commercial', 'office', 'hotel', 'bank', 'government'}
RETAIL = {'retail', 'supermarket', 'kiosk', 'mall', 'store', 'shop'}
INDUS = {'industrial', 'warehouse', 'manufacture', 'factory', 'hangar', 'storage_tank', 'silo', 'depot', 'works',
         'transportation', 'train_station', 'service', 'boathouse', 'greenhouse', 'barn', 'farm_auxiliary', 'stable'}
CIVIC = {'school', 'university', 'college', 'hospital', 'civic', 'public', 'kindergarten', 'museum', 'library',
         'fire_station', 'police', 'courthouse', 'townhall', 'stadium', 'sports_hall', 'sports_centre', 'grandstand'}
CHURCH = {'church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'religious', 'shrine', 'monastery'}
SMALL = {'garage', 'garages', 'carport', 'shed', 'hut', 'roof', 'kiosk', 'toilets', 'gazebo', 'container', 'bunker',
         'cabin', 'pavilion', 'shelter', 'guardhouse', 'ruins'}


def parse_len(v):
    """'12', '12 m', '40 ft', "40'", "12'6\"", '12;14' -> metres or None"""
    if not v:
        return None
    s = str(v).strip().lower().replace(',', '.')
    s = s.split(';')[0].strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:\"|''))?$", s)
    if m:
        return float(m.group(1)) * 0.3048 + (float(m.group(2)) * 0.0254 if m.group(2) else 0.0)
    m = re.match(r'^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?$', s)
    if not m:
        return None
    x = float(m.group(1))
    if m.group(2) in ('ft', 'feet', 'foot'):
        x *= 0.3048
    return x if math.isfinite(x) else None


def parse_num(v):
    try:
        x = float(str(v).split(';')[0].strip().replace(',', '.'))
        return x if math.isfinite(x) else None
    except Exception:
        return None


def parse_colour(v):
    if not v:
        return None
    s = str(v).strip().lower().replace(' ', '')
    if re.match(r'^#[0-9a-f]{6}$', s):
        return tuple(int(s[i:i + 2], 16) for i in (1, 3, 5))
    if re.match(r'^#[0-9a-f]{3}$', s):
        return tuple(int(s[i] * 2, 16) for i in (1, 2, 3))
    return NAMED.get(s)


def hash01(*xs):
    h = 2166136261
    for x in xs:
        for b in struct_bytes(x):
            h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h / 4294967296.0


def struct_bytes(x):
    return str(x).encode()


def jitter(c, r, amt=9):
    return tuple(int(max(0, min(255, round(v + (r[k] - 0.5) * 2 * amt)))) for k, v in enumerate(c))


def classify(btype, tags, h, area, urban, r):
    """-> style, wall colour (sRGB), lit share, floor height"""
    r1, r2, r3 = r
    pick = lambda pal: PAL[pal][min(len(PAL[pal]) - 1, int(r2 * len(PAL[pal])))]  # noqa: E731
    glass = None
    if btype in CHURCH or tags.get('amenity') == 'place_of_worship':
        return STYLE['CHURCH'], pick('churchStone'), 0.08, 4.5
    if h >= 45:
        if btype in APART and r1 < 0.45:
            return STYLE['POSTWAR_BRICK'], pick('brickWhite' if r3 < 0.5 else 'brickTan'), 0.5, 3.0
        glass = 'glassBlue' if r1 < 0.45 else 'glassDark' if r1 < 0.75 else 'glassGreen'
        return (STYLE['GLASS_TOWER_BLUE'] if h > 120 and r3 < 0.6 else STYLE['MODERN_GLASS']), pick(glass), (0.5 if btype in APART else 0.4), (3.1 if btype in APART else 3.9)
    if btype in HOUSE or (btype in ('yes', 'residential') and area < 260 and h < 13):
        if urban and r1 < 0.55:
            return STYLE['ROWHOUSE'], pick('brickRed' if r3 < 0.5 else 'brownstone'), 0.42, 3.1
        return STYLE['FRAME_HOUSE'], pick('siding'), 0.4, 2.9
    if btype in TERRACE:
        return STYLE['ROWHOUSE'], pick('brownstone' if r1 < 0.45 else 'brickRed' if r1 < 0.8 else 'brickTan'), 0.42, 3.1
    if btype in APART or (btype == 'yes' and 12 <= h < 45 and area < 3000):
        if h < 18:
            return STYLE['TENEMENT'], pick('brickRed' if r1 < 0.45 else 'brickOrange' if r1 < 0.6 else 'brickTan' if r1 < 0.85 else 'paintedGray'), 0.45, 3.1
        if r1 < 0.4:
            return STYLE['PREWAR_APT'], pick('brickRed' if r3 < 0.5 else 'brickTan'), 0.45, 3.0
        if r1 < 0.75:
            return STYLE['POSTWAR_BRICK'], pick('brickWhite' if r3 < 0.6 else 'brickTan'), 0.45, 2.9
        return STYLE['CONDO_NEW'], pick('condoPanel' if r3 < 0.55 else 'condoBrick'), 0.45, 3.0
    if btype in OFFICE:
        if h >= 20:
            return STYLE['MODERN_GLASS'], pick('glassBlue' if r1 < 0.5 else 'glassDark' if r1 < 0.8 else 'concrete'), 0.35, 3.9
        return STYLE['RETAIL_STRIP'], pick('concrete' if r1 < 0.5 else 'paintedGray' if r1 < 0.75 else 'brickTan'), 0.25, 3.8
    if btype in RETAIL:
        if area > 1500:
            return STYLE['RETAIL_MODERN'], pick('panelMetal' if r1 < 0.6 else 'concrete'), 0.2, 5.0
        return STYLE['RETAIL_STRIP'], pick('paintedGray' if r1 < 0.4 else 'concrete' if r1 < 0.7 else 'brickTan'), 0.22, 4.0
    if btype in INDUS or (btype == 'yes' and area > 2500 and h < 18):
        return STYLE['INDUSTRIAL'], pick('concrete' if r1 < 0.4 else 'panelMetal' if r1 < 0.7 else 'brickRed' if r1 < 0.85 else 'brickTan'), 0.08, 5.0
    if btype in CIVIC or tags.get('amenity') in ('school', 'hospital', 'university', 'college'):
        return STYLE['CIVIC_STONE'], pick('limestone' if r1 < 0.35 else 'brickRed' if r1 < 0.7 else 'brickTan'), 0.25, 4.0
    if btype in SMALL:
        return STYLE['INDUSTRIAL'], pick('concrete' if r1 < 0.6 else 'paintedGray'), 0.02, 3.0
    if btype == 'parking' or tags.get('amenity') == 'parking':
        return STYLE['INDUSTRIAL'], pick('concrete'), 0.05, 3.2
    # unknown ('yes', 'roof', ...): by size
    if h < 10 and area < 300:
        if urban and r1 < 0.5:
            return STYLE['ROWHOUSE'], pick('brickRed' if r3 < 0.5 else 'brownstone'), 0.4, 3.1
        return STYLE['FRAME_HOUSE'], pick('siding'), 0.38, 2.9
    if h < 12:
        return STYLE['RETAIL_STRIP'], pick('paintedGray' if r1 < 0.35 else 'concrete' if r1 < 0.65 else 'brickTan' if r1 < 0.85 else 'brickRed'), 0.2, 3.8
    return STYLE['POSTWAR_BRICK'], pick('brickTan' if r1 < 0.4 else 'brickWhite' if r1 < 0.65 else 'brickRed'), 0.4, 3.0


TYPE_H = {'house': 7.5, 'detached': 7.5, 'semidetached_house': 8.0, 'bungalow': 5.5, 'terrace': 10.0, 'townhouse': 10.0,
          'residential': 9.0, 'apartments': 14.0, 'dormitory': 15.0, 'garage': 3.0, 'garages': 3.0, 'carport': 2.6,
          'shed': 2.8, 'hut': 3.0, 'roof': 4.0, 'commercial': 9.0, 'office': 14.0, 'retail': 6.0, 'supermarket': 7.0,
          'industrial': 9.0, 'warehouse': 9.0, 'manufacture': 10.0, 'school': 10.0, 'university': 14.0, 'college': 12.0,
          'hospital': 20.0, 'church': 14.0, 'cathedral': 25.0, 'chapel': 9.0, 'synagogue': 12.0, 'mosque': 12.0,
          'temple': 10.0, 'hotel': 18.0, 'civic': 10.0, 'public': 10.0, 'government': 12.0, 'parking': 11.0,
          'train_station': 9.0, 'transportation': 8.0, 'service': 4.0, 'greenhouse': 4.0, 'barn': 8.0, 'stadium': 25.0,
          'grandstand': 12.0, 'hangar': 14.0, 'storage_tank': 12.0, 'kiosk': 3.0, 'toilets': 3.0, 'container': 2.6}


def height_of(tags, area, ms_h):
    """-> top over ground, bottom over ground, how ('tag', 'levels', 'ms', 'type')"""
    h = parse_len(tags.get('height'))
    minh = parse_len(tags.get('min_height')) or 0.0
    lv = parse_num(tags.get('building:levels'))
    rlv = parse_num(tags.get('roof:levels')) or 0.0
    mlv = parse_num(tags.get('building:min_level'))
    if not minh and mlv:
        minh = mlv * 3.2
    if h and 1.5 <= h <= 600:
        return h, min(minh, h - 1.0), 'tag'
    if lv and 0 < lv <= 150:
        fh = 3.0 if lv < 20 else 3.4
        return lv * fh + rlv * 2.2 + (1.0 if lv < 20 else 2.0), minh, 'levels'
    if ms_h and ms_h > 2.0:
        return float(min(ms_h, 200.0)), minh, 'ms'
    b = tags.get('building') or tags.get('building:part') or 'yes'
    th = TYPE_H.get(b)
    if th is None:
        th = 4.0 if area < 40 else 7.0 if area < 250 else 9.0 if area < 2000 else 10.0
    return th, minh, 'type'


# ---- Microsoft footprints (one quadkey file per process)
def read_ms(fn):
    import json as J
    W, S, E, N = C.BOX_LONLAT
    out_xz, out_n, out_h = [], [], []
    with gzip.open(fn, 'rt') as f:
        for line in f:
            try:
                ft = J.loads(line)
            except Exception:
                continue
            g = ft.get('geometry') or {}
            if g.get('type') != 'Polygon':
                continue
            ring = np.asarray(g['coordinates'][0], np.float64)
            if len(ring) < 4:
                continue
            lo, la = ring[:, 0], ring[:, 1]
            if lo.max() < W or lo.min() > E or la.max() < S or la.min() > N:
                continue
            x, z = C.project(lo, la)
            out_xz.append(np.stack([x, z], 1).astype(np.float64))
            hh = (ft.get('properties') or {}).get('height')
            out_h.append(float(hh) if hh is not None and hh > 0 else -1.0)
    return out_xz, out_h


def main():
    t0 = time.time()
    R = LD.load_osm()
    nyc = LD.load('nyc')
    region = nyc.buffer(C.BUFFER_M).intersection(shapely.box(*C.BOX_XZ))
    shapely.prepare(region)
    shapely.prepare(nyc)
    # (`dry`: a footprint's centroid on the backdrop's land or a pier deck. The Microsoft set traces barges and ships at
    # anchor as buildings (the Bayonne anchorage off Port Jersey: 24 boxes afloat in the Liberty Island aerial), and a few
    # OSM outlines sit off the shore the charts drew; build_backdrop.mjs draws only the dry ones. A flag, not a drop, so
    # every building keeps its index (the chunks' `bd:<n>` keys) and only the chunks that held one change)
    dry_land, dry_piers = LD.load('bd_land'), LD.load('piers')
    shapely.prepare(dry_land); shapely.prepare(dry_piers)
    dry = lambda x, z: shapely.contains_xy(dry_land, x, z) | shapely.contains_xy(dry_piers, x, z)
    # ---- OSM footprints
    polys, tags_l, src_l = [], [], []
    for key, tags, P in R['bld']:
        if tags.get('location') in ('underground',) or tags.get('building') in ('no', 'construction_site'):
            continue
        part = 'building:part' in tags and tags.get('building:part') != 'no'
        if part and tags.get('building:part') in ('roof', 'balcony', 'canopy') and not tags.get('height'):
            pass
        for rings in P:
            try:
                p = LD.poly_from_rings(rings)
            except Exception:
                continue
            for q in LD.polys_only(p).geoms:
                if q.area < 8.0:
                    continue
                polys.append(q)
                tags_l.append(tags)
                src_l.append(1 if part and 'building' not in tags else 0)
    polys = np.array(polys, dtype=object)
    cen = shapely.centroid(polys)
    cx, cz = shapely.get_x(cen), shapely.get_y(cen)
    keep = shapely.contains_xy(region, cx, cz) & ~shapely.contains_xy(nyc, cx, cz)
    polys, cx, cz = polys[keep], cx[keep], cz[keep]
    tags_l = [t for t, k in zip(tags_l, keep) if k]
    src = np.array([s for s, k in zip(src_l, keep) if k], np.uint8)
    area = shapely.area(polys)
    print(f'[bld] OSM: {len(polys)} footprints in the region outside the city ({(src == 1).sum()} parts) ({time.time() - t0:.0f}s)', flush=True)
    # ---- outlines drawn by their parts
    tree = shapely.STRtree(polys)
    is_part = src == 1
    pi, po = tree.query(polys[is_part], predicate='intersects')
    part_idx = np.nonzero(is_part)[0]
    cover = np.zeros(len(polys))
    for a, b in zip(pi, po):
        pa = part_idx[a]
        if b == pa or is_part[b]:
            continue
        cover[b] += shapely.area(shapely.intersection(polys[pa], polys[b]))
    drop_outline = (~is_part) & (cover >= 0.6 * area)
    print(f'[bld] outlines drawn by their parts: {drop_outline.sum()}', flush=True)
    # ---- Microsoft footprints: heights for untagged OSM buildings, and the gap-fill
    files = sorted(glob.glob(os.path.join(C.RAW_BD, 'footprints', 'ms_global_*', '*.csv.gz')))
    with Pool(len(files)) as pool:
        res = pool.map(read_ms, files)
    ms_xz = [r for xs, hs in res for r in xs]
    ms_h = np.array([h for xs, hs in res for h in hs], np.float32)
    ms_p = np.array([Polygon(r) for r in ms_xz], dtype=object)
    okv = shapely.is_valid(ms_p)
    ms_p[~okv] = [shapely.make_valid(p) for p in ms_p[~okv]]
    mc = shapely.centroid(ms_p)
    mx, mz = shapely.get_x(mc), shapely.get_y(mc)
    mk = shapely.contains_xy(region, mx, mz) & ~shapely.contains_xy(nyc, mx, mz)
    ms_p, ms_h, mx, mz = ms_p[mk], ms_h[mk], mx[mk], mz[mk]
    ms_a = shapely.area(ms_p)
    print(f'[bld] Microsoft: {len(ms_p)} footprints in the region outside the city ({time.time() - t0:.0f}s)', flush=True)
    a_ms, b_osm = tree.query(ms_p, predicate='intersects')
    inter = shapely.area(shapely.intersection(ms_p[a_ms], polys[b_osm]))
    matched = np.zeros(len(ms_p), bool)
    best = {}
    for a, b, ia in zip(a_ms, b_osm, inter):
        if ia >= 0.2 * min(ms_a[a], area[b]):
            matched[a] = True
            if not is_part[b] and (b not in best or ia > best[b][1]):
                best[b] = (a, ia)
    osm_ms_h = np.full(len(polys), -1.0, np.float32)
    for b, (a, ia) in best.items():
        osm_ms_h[b] = ms_h[a]
    gap = (~matched) & (ms_a >= 15.0)
    print(f'[bld] Microsoft matched to OSM: {matched.sum()}, gap-fill: {gap.sum()} ({time.time() - t0:.0f}s)', flush=True)
    # ---- ground under each footprint
    G = np.load(os.path.join(C.REC, 'ground8.npy'), mmap_mode='r')
    meta = T.grid_meta()

    def ground_at(xs, zs):
        fx = (xs - meta['x0']) / meta['step']
        fz = (zs - meta['z0']) / meta['step']
        i0 = np.clip(np.floor(fx).astype(np.int64), 0, meta['nx'] - 2)
        j0 = np.clip(np.floor(fz).astype(np.int64), 0, meta['nz'] - 2)
        tx, tz = np.clip(fx - i0, 0, 1), np.clip(fz - j0, 0, 1)
        return (G[j0, i0] * (1 - tx) * (1 - tz) + G[j0, i0 + 1] * tx * (1 - tz) + G[j0 + 1, i0] * (1 - tx) * tz + G[j0 + 1, i0 + 1] * tx * tz)
    # dense urban: Hudson County's waterfront and Newark's centre (rowhouses read as brick, not siding)
    urban_pts = [(-74.03, 40.73, 4500), (-74.06, 40.72, 3000), (-74.17, 40.735, 3500), (-74.01, 40.78, 2500), (-73.99, 40.85, 1500),
                 (-73.89, 40.94, 2500), (-74.21, 40.66, 2500), (-74.13, 40.67, 2500)]
    upx = [(*[float(v) for v in C.project(lo, la)], r) for lo, la, r in urban_pts]

    def urban_at(x, z):
        return any((x - ux) ** 2 + (z - uz) ** 2 < r * r for ux, uz, r in upx)
    # ---- records
    xz, rs, rn, br, bn = [], [], [], [], []
    base_l, h_l, minh_l, col_l, rcol_l, sty_l, fh_l, rh_l, src_o, seed_l, dry_l = [], [], [], [], [], [], [], [], [], [], []
    how_n = {'tag': 0, 'levels': 0, 'ms': 0, 'type': 0, 'gap': 0}
    tall = []
    nv = 0

    def emit(p, tags, s, h, minh, how, ms_height):
        nonlocal nv
        p = shapely.geometry.polygon.orient(p, 1.0)
        ext = np.asarray(p.exterior.coords)[:-1]
        if len(ext) < 3:
            return
        rings = [ext] + [np.asarray(i.coords)[:-1] for i in p.interiors if len(i.coords) >= 4]
        br.append(len(rs))
        bn.append(len(rings))
        for r in rings:
            rs.append(nv)
            rn.append(len(r))
            xz.append(r.astype(np.float32))
            nv += len(r)
        g = ground_at(ext[:, 0], ext[:, 1])
        base_l.append(float(g.min()))
        a = p.area
        c = p.centroid
        dry_l.append(1 if dry(c.x, c.y) else 0)
        rr = (hash01('a', round(c.x, 1), round(c.y, 1)), hash01('b', round(c.x, 1), round(c.y, 1)), hash01('c', round(c.x, 1), round(c.y, 1)))
        btype = tags.get('building') or tags.get('building:part') or 'yes'
        if btype in ('yes', 'part') and tags.get('building:part'):
            btype = tags.get('building:use') or 'yes'
        sty, colw, lit, fh = classify(btype, tags, h, a, urban_at(c.x, c.y), rr)
        tc = parse_colour(tags.get('building:colour'))
        colw = tc if tc else jitter(colw, (rr[1], rr[2], rr[0]))
        rshape = tags.get('roof:shape')
        rf = ROOF.get(rshape, 0) if rshape else 0
        if not rshape and h < 13 and a < 320 and (btype in HOUSE or btype in TERRACE or (btype in ('yes', 'residential') and a < 260)):
            rf = 1 if rr[2] < 0.55 else 2
        rh = 0.0
        if rf in (1, 2, 3, 5):
            rh = parse_len(tags.get('roof:height')) or min(4.5, max(1.8, 0.35 * math.sqrt(a)))
            rh = min(rh, max(0.0, h - minh - 2.2))
        rc = parse_colour(tags.get('roof:colour')) or (SHINGLE[int(rr[0] * len(SHINGLE)) % len(SHINGLE)] if rf else (0, 0, 0))
        col_l.append((*colw, int(round(lit * 255))))
        rcol_l.append((*rc, rf))
        sty_l.append(sty)
        fh_l.append(fh)
        rh_l.append(rh)
        h_l.append(h)
        minh_l.append(minh)
        src_o.append(s)
        seed_l.append(rr[0])
        if h >= 60:
            tall.append({'name': tags.get('name'), 'h': round(h, 1), 'x': round(c.x, 1), 'z': round(c.y, 1), 'how': how})

    for i, p in enumerate(polys):
        if drop_outline[i]:
            continue
        tags = tags_l[i]
        h, minh, how = height_of(tags, area[i], osm_ms_h[i] if osm_ms_h[i] > 0 else None)
        how_n[how] += 1
        emit(p, tags, int(src[i]), h, minh, how, osm_ms_h[i])
    for k in np.nonzero(gap)[0]:
        p = ms_p[k]
        for q in LD.polys_only(p).geoms:
            h = float(ms_h[k]) if ms_h[k] > 2.0 else (3.5 if q.area < 60 else 7.0)
            how_n['gap'] += 1
            emit(q, {'building': 'yes'}, 2, max(2.5, min(h, 120.0)), 0.0, 'gap', ms_h[k])
    out = os.path.join(C.REC, 'buildings.ctl')
    hdr = {'v': 1, 'kind': 'backdrop.buildings', 'count': len(br), 'made': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
           'sources': ['OpenStreetMap (ODbL) via Geofabrik extracts', 'Microsoft Global ML Building Footprints 2026-02-03 (ODbL)'],
           'heights': how_n, 'wet': len(dry_l) - sum(dry_l)}
    C.write_ctl(out, hdr, [
        ('xz', np.concatenate(xz).reshape(-1)), ('rs', np.array(rs, np.uint32)), ('rn', np.array(rn, np.uint32)),
        ('br', np.array(br, np.uint32)), ('bn', np.array(bn, np.uint32)), ('base', np.array(base_l, np.float32)),
        ('h', np.array(h_l, np.float32)), ('minh', np.array(minh_l, np.float32)), ('col', np.array(col_l, np.uint8).reshape(-1)),
        ('rcol', np.array(rcol_l, np.uint8).reshape(-1)), ('sty', np.array(sty_l, np.uint8)), ('fh', np.array(fh_l, np.float32)),
        ('rh', np.array(rh_l, np.float32)), ('src', np.array(src_o, np.uint8)), ('seed', np.array(seed_l, np.float32)),
        ('dry', np.array(dry_l, np.uint8)),
    ])
    tall.sort(key=lambda t: -t['h'])
    json.dump({**hdr, 'tallest': tall[:200]}, open(os.path.join(C.REC, 'buildings.json'), 'w'), indent=1)
    print(f'[bld] {len(br)} buildings ({how_n}) -> {out} ({time.time() - t0:.0f}s)', flush=True)


if __name__ == '__main__':
    main()
