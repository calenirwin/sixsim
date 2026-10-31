"""Extract a pinned, bounded subset; never download data or repair geometry silently.
Run from repo root: python client/tools/toronto/extract.py client/data/toronto/massing-2025.zip
Requires tools/toronto/requirements.txt. Source archive remains ignored.
"""
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile
import shapefile
from shapely.geometry import box, shape, mapping
from shapely.ops import transform

SHA256 = '9617089710518f1a24f70ca11b4a7c20ae45ab8e52a6fbed1bc088192efe6285'
STEM = '3DMassingShapefile_2025_WGS84'
BBOX = [-79.3965, 43.6484, -79.3948, 43.6498]
OUT = Path(__file__).resolve().parents[2] / 'fixtures/toronto/block.geojson'


def mercator(lon, lat):
    return 6378137 * math.radians(lon), 6378137 * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lonlat(x, y, z=None):
    return math.degrees(x / 6378137), math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2)


def extract(archive, bbox=BBOX, out=OUT, max_features=50, strict=True):
    assert archive.stat().st_size == 81415175, 'Unexpected source size'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == SHA256, 'Unexpected source revision'
    extent = box(*mercator(*bbox[:2]), *mercator(*bbox[2:]))
    features, excluded, invalid, heights = [], [], [], []
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory(dir=archive.parent) as temp:
        prj = z.read(STEM + '.prj').decode()
        assert 'WGS_1984_Web_Mercator_Auxiliary_Sphere' in prj and 'UNIT["Meter",1.0]' in prj
        for ext in ['shp', 'shx', 'dbf']:
            name = STEM + '.' + ext
            assert z.getinfo(name).file_size < 220_000_000
            z.extract(name, temp)
        reader = shapefile.Reader(str(Path(temp) / STEM))
        assert reader.shapeType == shapefile.POLYGONZ
        for row in reader.iterShapeRecords(bbox=extent.bounds):
            record_index = row.record.oid  # zero-based snapshot index, NOT an official OBJECTID
            geom = shape(row.shape.__geo_interface__)
            if not geom.is_valid:
                if strict: raise ValueError(f'Invalid source geometry at record {record_index}')
                invalid.append(record_index)
                continue
            if not extent.covers(geom):
                excluded.append(record_index)
                continue
            props = row.record.as_dict()
            if not (isinstance(props['AVG_HEIGHT'], (int,float)) and math.isfinite(props['AVG_HEIGHT']) and 0 < props['AVG_HEIGHT'] < 600):
                if strict: raise ValueError(f'Unsupported source height at record {record_index}')
                heights.append({'source_record_index': record_index, 'height': props['AVG_HEIGHT'] if isinstance(props['AVG_HEIGHT'], (int,float)) and math.isfinite(props['AVG_HEIGHT']) else None})
                continue
            geom = transform(lonlat, geom)
            assert geom.is_valid
            features.append({'type': 'Feature', 'id': f'2025:record:{record_index}',
                             'properties': {'source_record_index': record_index, **props},
                             'geometry': mapping(geom)})
    features.sort(key=lambda f: f['properties']['source_record_index'])
    assert 1 <= len(features) <= max_features
    data = {'type': 'FeatureCollection', 'bbox': bbox,
            'source_archive_sha256': SHA256,
            'selection': 'Whole polygons fully covered by bbox; boundary intersections excluded, no clipping.',
            'excluded_boundary_record_indices': sorted(excluded),
            'features': features}
    if not strict:
        data['excluded_invalid_record_indices'] = sorted(invalid)
        data['excluded_height_records'] = sorted(heights,key=lambda r:r['source_record_index'])
    out.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    print(f'{len(features)} records, {len(excluded)} boundary exclusions, {out.stat().st_size} bytes -> {out}')


if __name__ == '__main__':
    extract(Path(sys.argv[1]))
