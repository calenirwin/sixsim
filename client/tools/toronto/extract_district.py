"""Offline district extraction from pinned official archives; no repairs or downloads.
Usage: python client/tools/toronto/extract_district.py client/data/toronto
Requires the extraction requirements.txt. Raw archives remain ignored.
"""
import math, csv, hashlib, io, json, sqlite3, sys, zipfile
from pathlib import Path
from shapely import from_wkb
from shapely.geometry import box, mapping, LineString, Point, Polygon, shape
from shapely.ops import transform
from extract import extract, mercator
import importlib.util
spec=importlib.util.spec_from_file_location('gtfs_extract',Path(__file__).resolve().parents[1]/'transit/extract.py')
gtfs=importlib.util.module_from_spec(spec);spec.loader.exec_module(gtfs)
BBOX=[-79.410,43.642,-79.385,43.665]
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'fixtures/toronto'
TCL_SHA='f6cafbd260232c4f14a844fa89c342d5b173931362b195f2784c24a995e1756a'
GTFS_SHA='5e0191d59cb991b6c88ba9c1a5f2ca93a5a064a4d258dbc7ba93801d15f3dfca'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,data): p.write_text(json.dumps(data,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
def run(raw):
    extract(raw/'massing-2025.zip',bbox=BBOX,out=OUT/'district.geojson',max_features=10000,strict=False)
    masses=json.loads((OUT/'district.geojson').read_text())
    small=[]; kept=[]
    for f in masses['features']:
        g=transform(mercator,shape(f['geometry']));parts=[g] if g.geom_type=='Polygon' else g.geoms
        areas=[Polygon(r).area*math.cos(math.radians(43.65))**2 for p in parts for r in [p.exterior,*p.interiors]]
        if min(areas)<.011:small.append(f['properties']['source_record_index'])
        else:kept.append(f)
    masses['features']=kept;masses['excluded_small_ring_record_indices']=small
    save(OUT/'district.geojson',masses)
    provenance=json.loads((OUT/'provenance.json').read_text())
    provenance.update(bbox=BBOX,records=len(masses['features']),boundary_exclusions=len(masses['excluded_boundary_record_indices']),invalid_geometry_exclusions=masses['excluded_invalid_record_indices'],subset_sha256=digest(OUT/'district.geojson'))
    provenance['height_exclusions']=masses['excluded_height_records']
    provenance['height_rule']='Require finite source AVG_HEIGHT > 0 and < 600 metres; exclude unsupported records, never replace their height.'
    provenance['small_geometry_exclusions']=small
    provenance['small_geometry_rule']='Omit entire source record if any ring has area below 0.011 square metres in the local metric approximation; no sliver repair.'
    provenance['geometry']+=' Invalid source geometries are omitted and their snapshot IDs listed; no repair is applied.'
    save(OUT/'district-provenance.json',provenance)
    gpkg=raw/'centreline-20261023.gpkg';assert digest(gpkg)==TCL_SHA
    db=sqlite3.connect(f'file:{gpkg}?mode=ro',uri=True);db.row_factory=sqlite3.Row
    assert db.execute('select srs_id from gpkg_geometry_columns').fetchone()[0]==4326
    sql='''SELECT t.* FROM "Centreline - Version 2 - 4326" t JOIN "rtree_Centreline - Version 2 - 4326_geom" r ON t.fid=r.id WHERE r.maxx>=? AND r.minx<=? AND r.maxy>=? AND r.miny<=? ORDER BY t.CENTRELINE_ID'''
    extent=box(*BBOX);roads=[]
    fields=['CENTRELINE_ID','LINEAR_NAME_FULL','FROM_INTERSECTION_ID','TO_INTERSECTION_ID','ONEWAY_DIR_CODE','ONEWAY_DIR_CODE_DESC','FEATURE_CODE','FEATURE_CODE_DESC']
    for row in db.execute(sql,(BBOX[0],BBOX[2],BBOX[1],BBOX[3])):
        if not (201100<=row['FEATURE_CODE']<=202002 or row['FEATURE_CODE'] in [204001,204002]): continue
        b=row['geom'];assert b[:2]==b'GP';envelope=(b[3]>>1)&7
        g=from_wkb(b[8+{0:0,1:32,2:48,3:48,4:64}[envelope]:])
        assert g.is_valid and g.geom_type in ['LineString','MultiLineString']
        if not extent.intersects(g):continue
        roads.append({'type':'Feature','id':str(row['CENTRELINE_ID']),'properties':{k:row[k] for k in fields},'geometry':mapping(g)})
    db.close()
    archive=raw/'completegtfs.zip';assert digest(archive)==GTFS_SHA
    with zipfile.ZipFile(archive) as z:
        def rows(name):return csv.DictReader(io.TextIOWrapper(z.open(name),encoding='utf-8-sig',newline=''))
        active=gtfs.services(list(rows('calendar.txt')),list(rows('calendar_dates.txt')),'20261022')
        routes=[r for r in rows('routes.txt') if r['route_short_name'] in ['501','505','506','510'] and r['route_type']=='0']
        ids={r['route_id'] for r in routes};trips={r['trip_id']:r for r in rows('trips.txt') if r['route_id'] in ids and r['service_id'] in active}
        shape_routes={};stop_routes={}
        for t in trips.values():shape_routes.setdefault(t['shape_id'],set()).add(t['route_id'])
        for t in rows('stop_times.txt'):
            if t['trip_id'] in trips:stop_routes.setdefault(t['stop_id'],set()).add(trips[t['trip_id']]['route_id'])
        stops=[{**s,'route_ids':sorted(stop_routes[s['stop_id']])} for s in rows('stops.txt') if s['stop_id'] in stop_routes and extent.covers(Point(float(s['stop_lon']),float(s['stop_lat'])))]
        groups={}
        for p in rows('shapes.txt'):
            if p['shape_id'] in shape_routes:groups.setdefault(p['shape_id'],[]).append((int(p['shape_pt_sequence']),float(p['shape_pt_lon']),float(p['shape_pt_lat'])))
        shapes=[]
        for sid,points in sorted(groups.items()):
            points.sort();g=LineString([(p[1],p[2]) for p in points]).intersection(extent)
            lines=[g] if g.geom_type=='LineString' else [p for p in getattr(g,'geoms',[]) if p.geom_type=='LineString']
            lines=[list(p.coords) for p in lines if not p.is_empty]
            if lines:shapes.append({'id':sid,'route_ids':sorted(shape_routes[sid]),'lines':lines})
    context={'bbox':BBOX,'coordinates':'EPSG:4326','service_day':'20261022','timezone':'America/Toronto','roads':roads,'routes':routes,'shapes':shapes,'stops':sorted(stops,key=lambda s:s['stop_id'])}
    save(OUT/'district-network.json',context)
    prov={'bbox':BBOX,'subset_sha256':digest(OUT/'district-network.json'),'attribution':'Contains information licensed under the Open Government Licence – Toronto.','license_url':'https://open.toronto.ca/open-data-licence/','centreline':{'dataset_url':'https://open.toronto.ca/dataset/toronto-centreline-tcl/','archive_url':'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1d079757-377b-4564-82df-eb5638583bfb/resource/6bb36aba-9747-4255-abb6-b8754fc23c0f/download/centreline-version-2-4326.gpkg','archive_sha256':TCL_SHA,'archive_bytes':gpkg.stat().st_size,'retrieved_utc':'2026-10-23','resource_last_modified':'2026-10-22T18:15:12.599704','source_crs':'EPSG:4326, verified gpkg_geometry_columns','selection':'Whole source lines intersecting bbox, feature codes 201100–202002 and 204001/204002; no clipping or geometric snapping. Boundary edges retain outside endpoints.','license_evidence':'Official dataset page links Open Government Licence – Toronto; CKAN license fields are null and isopen false. No City clarification obtained.'},'transit':{'archive_sha256':GTFS_SHA,'source_provenance':'../transit/provenance.json','routes':['501','505','506','510'],'selection':'Shapes and stops of trips active 2026-10-22; shape lines clipped to bbox for context only. No new vehicle schedules or pedestrian transfer edges inferred.'},'limits':['Centreline topology is source intersection IDs, not a lane graph. No inferred direction rules, signal phases, speeds, widths or traffic interactions.','GTFS shapes describe service paths, not surveyed track geometry. Nearby stops do not imply a valid pedestrian transfer.']}
    save(OUT/'network-provenance.json',prov)
    print({'buildings':len(masses['features']),'invalid_masses':len(masses['excluded_invalid_record_indices']),'roads':len(roads),'shapes':len(shapes),'stops':len(stops)})
if __name__=='__main__':run(Path(sys.argv[1]))
