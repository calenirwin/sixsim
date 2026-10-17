"""The backdrop's OpenStreetMap records (docs/notes/r2-backdrop.md), from the Geofabrik extracts in
client/data/raw/backdrop/osm/ (ODbL, (c) OpenStreetMap contributors), one pass per file with pyosmium:

  python3 osm_extract.py [new-jersey new-york connecticut]      -> <work>/osm_<name>.pkl

Kept, inside the region's box (common.BOX_LONLAT):
  bld    buildings and building parts (areas): rings in lon/lat and the tags the massing reads
  area   land cover and land use (areas): landuse, natural, leisure, amenity, aeroway, water, waterway, man_made, golf
  line   highways, railways, waterways, runways and taxiways, coastline, tree rows, cliffs, piers (ways)
  node   single trees and tall structures (water towers, tanks, chimneys, masts)
  admin  administrative boundaries to level 6 (the city of New York's line, counties) as areas
Objects in two extracts (near a state line) are deduplicated by their OSM id when the layers are merged.
"""
import os
import pickle
import sys
import time

import numpy as np
import osmium
import osmium.filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

W, S, E, N = C.BOX_LONLAT
B_TAGS = ('building', 'building:part', 'height', 'min_height', 'building:levels', 'building:min_level', 'roof:levels',
          'roof:shape', 'roof:height', 'roof:colour', 'building:colour', 'building:material', 'roof:material', 'name',
          'amenity', 'shop', 'man_made', 'location', 'layer', 'building:use', 'tourism', 'leisure', 'religion',
          'disused', 'abandoned', 'construction', 'parking', 'aeroway', 'power', 'start_date', 'operator')
A_KEYS = ('landuse', 'natural', 'leisure', 'amenity', 'aeroway', 'water', 'waterway', 'man_made', 'golf', 'wetland',
          'surface', 'place', 'tidal', 'intermittent', 'name', 'sport', 'parking', 'boundary', 'admin_level', 'type',
          'layer', 'location', 'covered', 'tunnel', 'bridge', 'salt', 'basin', 'reservoir_type', 'leaf_type')
L_KEYS = ('highway', 'railway', 'waterway', 'aeroway', 'natural', 'man_made', 'lanes', 'width', 'bridge', 'tunnel',
          'layer', 'surface', 'oneway', 'service', 'usage', 'name', 'tidal', 'intermittent', 'covered', 'area',
          'location', 'level', 'construction', 'disused', 'abandoned', 'electrified', 'gauge')
N_KEYS = ('natural', 'man_made', 'height', 'name', 'tower:type', 'denotation', 'leaf_type', 'circumference', 'diameter_crown')
AREA_KEYS = ('building', 'building:part', 'landuse', 'natural', 'leisure', 'amenity', 'aeroway', 'water', 'waterway',
             'man_made', 'golf', 'boundary')
LINE_KEYS = ('highway', 'railway', 'waterway', 'aeroway', 'natural', 'man_made')
NODE_TAGS = (('natural', 'tree'), ('man_made', 'water_tower'), ('man_made', 'storage_tank'), ('man_made', 'chimney'),
             ('man_made', 'mast'), ('man_made', 'tower'), ('man_made', 'lighthouse'), ('man_made', 'silo'))
LINE_NATURAL = {'coastline', 'tree_row', 'cliff', 'ridge', 'arete'}
LINE_MANMADE = {'pier', 'breakwater', 'groyne', 'embankment', 'dyke', 'quay'}
AREA_LANDCOVER_NATURAL = {'wood', 'scrub', 'heath', 'grassland', 'wetland', 'sand', 'beach', 'bare_rock', 'scree',
                          'water', 'mud', 'shingle', 'cliff', 'shoal', 'reef', 'bay', 'strait', 'glacier', 'fell', 'valley'}


def _sub(tags, keys):
    d = {}
    for k in keys:
        v = tags.get(k)
        if v is not None:
            d[k] = v
    return d


def _ring(r):
    return np.array([(n.lon, n.lat) for n in r], dtype=np.float64)


def _inbox(a):
    return not (a[:, 0].max() < W or a[:, 0].min() > E or a[:, 1].max() < S or a[:, 1].min() > N)


def _polys(o):
    """an osmium area as [[outer, hole, ...], ...] in lon/lat; None if it misses the box or is broken"""
    out = []
    try:
        for outer in o.outer_rings():
            ro = _ring(outer)
            if len(ro) < 4:
                continue
            holes = [_ring(i) for i in o.inner_rings(outer)]
            out.append([ro] + [h for h in holes if len(h) >= 4])
    except Exception:
        return None
    if not out or not any(_inbox(p[0]) for p in out):
        return None
    return out


def extract(name):
    fn = os.path.join(C.RAW_BD, 'osm', f'{name}-latest.osm.pbf')
    t0 = time.time()
    R = {'bld': [], 'area': [], 'line': [], 'node': [], 'admin': [], 'source': fn, 'box': C.BOX_LONLAT}
    n_seen = 0
    fp = (osmium.FileProcessor(fn).with_locations()
          .with_areas(osmium.filter.KeyFilter(*AREA_KEYS))
          .with_filter(osmium.filter.KeyFilter(*(set(AREA_KEYS) | set(LINE_KEYS) | {'natural', 'man_made'}))))
    for o in fp:
        n_seen += 1
        tags = o.tags
        if o.is_area():
            key = ('w' if o.from_way() else 'r') + str(o.orig_id())
            if 'building' in tags or 'building:part' in tags:
                b = tags.get('building')
                if b == 'no' and 'building:part' not in tags:
                    continue
                P = _polys(o)
                if P is None:
                    continue
                R['bld'].append((key, _sub(tags, B_TAGS), P))
                continue
            if tags.get('boundary') == 'administrative':
                lv = tags.get('admin_level')
                if lv in ('2', '4', '5', '6', '7', '8') and not o.from_way():
                    P = _polys(o)
                    if P is not None:
                        R['admin'].append((key, _sub(tags, ('name', 'admin_level', 'boundary', 'border_type', 'wikidata', 'ref', 'nist:fips_code', 'place')), P))
                continue
            nat = tags.get('natural')
            keep = ('landuse' in tags or 'leisure' in tags or 'aeroway' in tags or 'water' in tags or 'golf' in tags
                    or tags.get('waterway') in ('riverbank', 'dock', 'boatyard', 'dam', 'canal', 'river')
                    or (nat is not None and nat in AREA_LANDCOVER_NATURAL)
                    or tags.get('amenity') in ('parking', 'school', 'university', 'college', 'hospital', 'grave_yard', 'marketplace', 'bus_station', 'ferry_terminal', 'fuel', 'prison')
                    or tags.get('man_made') in ('pier', 'breakwater', 'wastewater_plant', 'works', 'bridge', 'quay', 'storage_tank', 'reservoir_covered', 'water_works'))
            if not keep:
                continue
            P = _polys(o)
            if P is None:
                continue
            R['area'].append((key, _sub(tags, A_KEYS), P))
        elif o.is_way():
            if not any(k in tags for k in LINE_KEYS):
                continue
            nat, mm = tags.get('natural'), tags.get('man_made')
            if not ('highway' in tags or 'railway' in tags or 'waterway' in tags or 'aeroway' in tags
                    or (nat in LINE_NATURAL) or (mm in LINE_MANMADE)):
                continue
            if tags.get('area') == 'yes' and 'highway' not in tags:
                continue
            try:
                a = np.array([(n.lon, n.lat) for n in o.nodes], dtype=np.float64)
            except Exception:
                continue
            if len(a) < 2 or not _inbox(a):
                continue
            R['line'].append(('w' + str(o.id), _sub(tags, L_KEYS), a))
        elif o.is_node():
            if not any(tags.get(k) == v for k, v in NODE_TAGS):
                continue
            lon, lat = o.location.lon, o.location.lat
            if not (W <= lon <= E and S <= lat <= N):
                continue
            R['node'].append(('n' + str(o.id), _sub(tags, N_KEYS), lon, lat))
    out = os.path.join(C.ensure(C.WORK), f'osm_{name}.pkl')
    with open(out + '.tmp', 'wb') as f:
        pickle.dump(R, f, protocol=5)
    os.replace(out + '.tmp', out)
    print(f'[osm {name}] {time.time() - t0:.0f}s seen {n_seen}: bld {len(R["bld"])} area {len(R["area"])} line {len(R["line"])} '
          f'node {len(R["node"])} admin {len(R["admin"])} -> {out}', flush=True)
    return out


if __name__ == '__main__':
    names = sys.argv[1:] or ['new-jersey', 'new-york', 'connecticut']
    from multiprocessing import Pool
    with Pool(len(names)) as p:
        p.map(extract, names)
