"""The backdrop's land and water (docs/notes/r2-backdrop.md), in world metres:

  python3 land.py              (base)  -> <records>/land/{osm_land,city_land,nyc,tidal,lakes,piers}.wkb, landings, lakes
  python3 tools/lod/water_l6.py         the far level's water (the charts, each scale where no finer one covers)
  python3 land.py final [<water_l6.wkb>] -> <records>/land/{bd_land,land_border,water}.wkb, mask_bd.npy, land.json

  osm_land     the OpenStreetMap coastline's land (osmdata.openstreetmap.de land polygons, ODbL) over the region
  city_land    the five boroughs as the city draws them (client/data/raw/boundaries.geojson, clipped to the shoreline)
  nyc          the city of New York's line, water areas included (OSM admin_level 5 relation; the five counties otherwise)
  landings     the New Jersey landing patches the city compiles as land (client/data/raw/osm_landings.json), with their
               plateau heights (compile.mjs LANDING_PAD: the George Washington Bridge's at 62 m, the others the 3.2 m base)
  tidal        inland water at sea level (OSM water and riverbank polygons whose hydro-flattened DEM surface is under
               1.2 m: the Hackensack, Passaic, Raritan and Rahway, the Meadowlands' channels): open to the water plane
  lakes        inland water above sea level (reservoirs, ponds, rivers above their dams): drawn by the ground at its level
  bd_land      the backdrop's land: the exact complement of the far level's water (tools/lod/water_l6.py, NOAA charts)
               outside the city's line, so land and water share one coastline; along a land border (the Bronx and
               Westchester, Queens and Nassau) it runs out to the city's own land polygon and stops at it exactly. Water
               the charts leave dry (the Meadowlands' channels, lakes, rivers above the head of navigation) is land, drawn
               as water or marsh by the ground at its own level
  land_border  the stretches of city_land's outline that meet bd_land (the terrain blends to the city's ground there)
"""
import json
import os
import pickle
import sys
import time

import numpy as np
import shapefile
import shapely
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import terrain as T  # noqa: E402

LAND_DIR = os.path.join(C.REC, 'land')
LANDING_PAD = {'gwb': 62.0}
BASE_Y = 3.2
TIDAL_MAX = 1.2


def proj_ring(a):
    x, z = C.project(a[:, 0], a[:, 1])
    return np.stack([x, z], 1)


def poly_from_rings(rings):
    outer = proj_ring(rings[0])
    holes = [proj_ring(h) for h in rings[1:]]
    p = Polygon(outer, holes)
    if not p.is_valid:
        p = shapely.make_valid(p)
    return p


def polys_only(g):
    if g is None or g.is_empty:
        return MultiPolygon()
    if g.geom_type == 'Polygon':
        return MultiPolygon([g])
    if g.geom_type == 'MultiPolygon':
        return g
    return MultiPolygon([p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon'] +
                        [q for p in getattr(g, 'geoms', []) if p.geom_type == 'MultiPolygon' for q in p.geoms])


def save(name, g):
    with open(os.path.join(LAND_DIR, name + '.wkb'), 'wb') as f:
        f.write(shapely.to_wkb(g))


def load(name):
    with open(os.path.join(C.REC, 'land', name + '.wkb'), 'rb') as f:
        return shapely.from_wkb(f.read())


def load_osm():
    R = {'bld': [], 'area': [], 'line': [], 'node': [], 'admin': []}
    seen = set()
    for n in ('new-york', 'new-jersey', 'connecticut'):
        fn = os.path.join(C.WORK, f'osm_{n}.pkl')
        if not os.path.exists(fn):
            print('[land] missing', fn)
            continue
        D = pickle.load(open(fn, 'rb'))
        for k in R:
            for rec in D[k]:
                key = (k, rec[0])
                if key in seen:
                    continue
                seen.add(key)
                R[k].append(rec)
    return R


def dem_median(polys, dem, meta):
    """the median DEM sample inside each polygon (its interior samples, or its representative point's)"""
    out = np.zeros(len(polys), np.float32)
    s, x0, z0 = meta['step'], meta['x0'], meta['z0']
    for k, p in enumerate(polys):
        bx0, bz0, bx1, bz1 = p.bounds
        i0, i1 = max(0, int((bx0 - x0) / s)), min(meta['nx'] - 1, int((bx1 - x0) / s) + 1)
        j0, j1 = max(0, int((bz0 - z0) / s)), min(meta['nz'] - 1, int((bz1 - z0) / s) + 1)
        vals = None
        if i1 > i0 and j1 > j0 and (i1 - i0) * (j1 - j0) < 4_000_000:
            xs = x0 + np.arange(i0, i1 + 1) * s
            zs = z0 + np.arange(j0, j1 + 1) * s
            XX, ZZ = np.meshgrid(xs, zs)
            m = shapely.contains_xy(p, XX.ravel(), ZZ.ravel())
            if m.sum() >= 3:
                vals = dem[j0:j1 + 1, i0:i1 + 1].ravel()[m]
        if vals is None:
            q = p.representative_point()
            i, j = int(round((q.x - x0) / s)), int(round((q.y - z0) / s))
            vals = dem[min(max(j, 0), meta['nz'] - 1), min(max(i, 0), meta['nx'] - 1)][None]
        out[k] = float(np.median(vals))
    return out


def raster_mask(g, meta, step_div=1):
    """samples of the 8 m grid inside g (bool [nz][nx])"""
    xs = meta['x0'] + np.arange(meta['nx']) * meta['step']
    M = np.zeros((meta['nz'], meta['nx']), bool)
    gp = shapely.prepared.prep(g) if False else None  # noqa: F841 (vectorised contains_xy below)
    for j0 in range(0, meta['nz'], 256):
        zs = meta['z0'] + np.arange(j0, min(meta['nz'], j0 + 256)) * meta['step']
        XX, ZZ = np.meshgrid(xs, zs)
        M[j0:j0 + len(zs)] = shapely.contains_xy(g, XX.ravel(), ZZ.ravel()).reshape(XX.shape)
    return M


def main():
    t0 = time.time()
    C.ensure(LAND_DIR)
    meta = T.grid_meta()
    GRID = box(meta['x0'], meta['z0'], meta['x1'], meta['z1'])
    W, S, E, N = C.BOX_LONLAT
    # ---- the coastline's land
    sf = shapefile.Reader(os.path.join(C.WORK, 'coast', 'land-polygons-split-4326', 'land_polygons'))
    parts = []
    for s in sf.iterShapes(bbox=(W - 0.15, S - 0.15, E + 0.15, N + 0.15)):
        g = shape(s.__geo_interface__)
        for p in polys_only(g).geoms:
            ext = proj_ring(np.asarray(p.exterior.coords))
            ints = [proj_ring(np.asarray(i.coords)) for i in p.interiors]
            parts.append(Polygon(ext, ints))
    osm_land = polys_only(unary_union(parts).intersection(GRID))
    print(f'[land] osm land: {len(parts)} parts -> {len(osm_land.geoms)} polygons, {osm_land.area / 1e6:.0f} km2 ({time.time() - t0:.0f}s)', flush=True)
    # ---- the city's land and line
    fc = json.load(open(os.path.join(C.RAW, 'boundaries.geojson')))
    cl = []
    for f in fc['features']:
        g = f['geometry']
        for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            cl.append(poly_from_rings([np.asarray(r) for r in poly]))
    city_land = polys_only(unary_union(cl))
    R = load_osm()
    nyc = None
    for key, tags, P in R['admin']:
        if tags.get('admin_level') == '5' and tags.get('name') in ('City of New York', 'New York', 'New York City'):
            nyc = polys_only(unary_union([poly_from_rings(r) for r in P]))
            print(f'[land] the city line: OSM {key} {tags.get("name")!r}, {nyc.area / 1e6:.0f} km2', flush=True)
            break
    if nyc is None:
        cty = [poly_from_rings(r) for key, tags, P in R['admin'] if tags.get('admin_level') == '6'
               and tags.get('name') in ('New York County', 'Kings County', 'Queens County', 'Bronx County', 'Richmond County') for r in P]
        nyc = polys_only(unary_union(cty))
        print(f'[land] the city line from the five counties: {nyc.area / 1e6:.0f} km2', flush=True)
    nyc = polys_only(unary_union([nyc, city_land]))
    # ---- the landing patches (compile.mjs New Jersey landings)
    lands = []
    try:
        LJ = json.load(open(os.path.join(C.RAW, 'osm_landings.json')))
        for key, L in LJ.items():
            for ring in L.get('land') or []:
                a = np.asarray(ring, np.float64)
                if len(a) < 4:
                    continue
                p = Polygon(proj_ring(a))
                if not p.is_valid:
                    p = shapely.make_valid(p)
                lands.append({'key': key, 'padY': LANDING_PAD.get(key, BASE_Y), 'poly': p})
    except FileNotFoundError:
        pass
    print(f'[land] landing patches: {len(lands)} ({", ".join(sorted({l["key"] for l in lands}))})', flush=True)
    # ---- inland water: tidal (sea level) or lakes (their own level)
    dem = np.load(os.path.join(C.REC, 'dem8.npy'), mmap_mode='r')
    wpolys, wtags = [], []
    for key, tags, P in R['area']:
        isw = (tags.get('natural') == 'water' or tags.get('waterway') in ('riverbank', 'dock', 'canal', 'river')
               or 'water' in tags or tags.get('landuse') in ('reservoir', 'basin'))
        if not isw or tags.get('covered') == 'yes' or tags.get('location') == 'underground' or tags.get('tunnel'):
            continue
        if tags.get('water') in ('wastewater', 'reflecting_pool', 'fountain') and False:
            continue
        for rings in P:
            p = poly_from_rings(rings)
            for q in polys_only(p).geoms:
                if q.area > 20 and q.intersects(GRID):
                    wpolys.append(q)
                    wtags.append(tags)
    lev = dem_median(wpolys, dem, meta)
    tidal_l = [p for p, h in zip(wpolys, lev) if h <= TIDAL_MAX]
    lake_l = [(p, float(h)) for p, h in zip(wpolys, lev) if h > TIDAL_MAX]
    tidal = polys_only(unary_union(tidal_l)) if tidal_l else MultiPolygon()
    lakes = polys_only(unary_union([p for p, h in lake_l])) if lake_l else MultiPolygon()
    print(f'[land] inland water: {len(tidal_l)} at sea level ({tidal.area / 1e6:.1f} km2), {len(lake_l)} above ({lakes.area / 1e6:.1f} km2) ({time.time() - t0:.0f}s)', flush=True)
    # ---- piers (man_made=pier areas): decks over the water, part of the land at a deck height (heights.py)
    pl = [poly_from_rings(r) for key, tags, P in R['area'] if tags.get('man_made') in ('pier', 'quay') for r in P]
    piers = polys_only(unary_union([q for p in pl for q in polys_only(p).geoms if q.area > 30])) if pl else MultiPolygon()
    print(f'[land] piers: {len(pl)} ({piers.area / 1e6:.2f} km2)', flush=True)
    for name, g in (('osm_land', osm_land), ('city_land', city_land), ('nyc', nyc), ('tidal', tidal), ('lakes', lakes), ('piers', piers)):
        save(name, g)
    pickle.dump([{'key': l['key'], 'padY': l['padY'], 'wkb': shapely.to_wkb(l['poly'])} for l in lands], open(os.path.join(LAND_DIR, 'landings.pkl'), 'wb'))
    pickle.dump([(shapely.to_wkb(p), h) for p, h in lake_l], open(os.path.join(LAND_DIR, 'lakes_levels.pkl'), 'wb'))
    np.save(os.path.join(LAND_DIR, 'mask_city.npy'), raster_mask(city_land, meta))
    json.dump({'made': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'grid': meta,
               'km2': {k: round(g.area / 1e6, 2) for k, g in (('osm_land', osm_land), ('city_land', city_land), ('nyc', nyc), ('tidal', tidal), ('lakes', lakes), ('piers', piers))},
               'landings': [{'key': l['key'], 'padY': l['padY'], 'm2': round(l['poly'].area)} for l in lands], 'tidal_max_m': TIDAL_MAX},
              open(os.path.join(LAND_DIR, 'land_base.json'), 'w'), indent=1)
    print(f'[land base] done {time.time() - t0:.0f}s', flush=True)


def final(water_wkb):
    """the backdrop's land as the exact complement of the far level's water (tools/lod/water_l6.py) outside the city"""
    t0 = time.time()
    meta = T.grid_meta()
    GRID = box(meta['x0'], meta['z0'], meta['x1'], meta['z1'])
    water = shapely.from_wkb(open(water_wkb, 'rb').read())
    nyc, city_land = load('nyc'), load('city_land')
    # everything dry that the city does not draw as land: outside the city's line the region beyond it, inside it only what
    # the city leaves between its land and the water (slivers along a land border where the two lines part, the gap the
    # water's 4 m simplification opens), so no place is neither land nor water
    bd_land = polys_only(GRID.difference(water).difference(city_land))
    bd_land = MultiPolygon([p for p in bd_land.geoms if p.area > 0.01])
    land_border = city_land.boundary.intersection(bd_land.buffer(1.0))
    # what lies between: inside the grid, outside the city's land, neither the backdrop's land nor water
    between = GRID.difference(water).difference(bd_land).difference(city_land)
    out_between = between.difference(nyc)
    print(f'[land final] backdrop land {bd_land.area / 1e6:.0f} km2 in {len(bd_land.geoms)} polygons; land border {land_border.length / 1000:.1f} km; '
          f'between land and water: {out_between.area:.1f} m2 outside the city line, {between.area / 1e6:.2f} km2 in all ({time.time() - t0:.0f}s)', flush=True)
    save('bd_land', bd_land)
    save('land_border', land_border)
    save('water', water)
    np.save(os.path.join(LAND_DIR, 'mask_bd.npy'), raster_mask(bd_land, meta))
    json.dump({'made': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'water': water_wkb, 'grid': meta,
               'km2': {'bd_land': round(bd_land.area / 1e6, 2), 'water': round(water.area / 1e6, 2), 'between_in_city_line': round(between.intersection(nyc).area / 1e6, 3)},
               'between_outside_city_m2': round(out_between.area, 1), 'land_border_km': round(land_border.length / 1000, 2)},
              open(os.path.join(LAND_DIR, 'land.json'), 'w'), indent=1)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'final':
        final(sys.argv[2] if len(sys.argv) > 2 else os.path.join(C.RAW, 'water_l6.wkb'))
    else:
        main()
