"""Pinned official green-space polygons; display crop only, not land cover or access."""
import hashlib,json,sqlite3,sys
from pathlib import Path
from shapely import from_wkb
from shapely.geometry import box,mapping
SHA='9e57e8341042903f44e50a1589b1a393eb2dd331261f3b60e1d64ba41ec2162c'
ROOT=Path(__file__).resolve().parents[2]
BBOX=[-79.410,43.642,-79.385,43.665]
def save(path,value):path.write_text(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
def extract(path,out=ROOT/'fixtures/toronto'):
    raw=path.read_bytes();assert len(raw)==8896512 and hashlib.sha256(raw).hexdigest()==SHA,'Unexpected source revision'
    db=sqlite3.connect(f'file:{path}?mode=ro',uri=True);db.row_factory=sqlite3.Row
    assert tuple(db.execute('select geometry_type_name,srs_id,z,m from gpkg_geometry_columns').fetchone())==('MULTIPOLYGON',4326,0,0)
    extent=box(*BBOX);features=[];invalid=[];clipped=[]
    for row in db.execute('SELECT * FROM "Green Spaces - 4326" ORDER BY fid'):
        b=row['geom'];assert b[:2]==b'GP';g=from_wkb(b[8+{0:0,1:32,2:48,3:48,4:64}[(b[3]>>1)&7]:])
        if not extent.intersects(g):continue
        if not g.is_valid:invalid.append(row['fid']);continue
        result=g.intersection(extent)
        if result.is_empty or result.area==0:continue
        assert result.is_valid and result.geom_type in ('Polygon','MultiPolygon')
        if not extent.covers(g):clipped.append(row['fid'])
        props={k:row[k] for k in ['fid','AREA_ID','AREA_ATTR_ID','AREA_CLASS','AREA_NAME']}
        features.append({'type':'Feature','id':f'20261027:fid:{row["fid"]}','properties':props,'geometry':mapping(result)})
    db.close();assert 0<len(features)<100
    data={'type':'FeatureCollection','bbox':BBOX,'source_sha256':SHA,'features':features}
    out.mkdir(parents=True,exist_ok=True);save(out/'green-spaces.geojson',data)
    provenance={'dataset':'City of Toronto Green Spaces','dataset_url':'https://open.toronto.ca/dataset/green-spaces/','owner':'Parks, Forestry & Recreation; jointly maintained with Geospatial Competency Centre','package_api':'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=green-spaces','source_url':'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/9a284a84-b9ff-484b-9e30-82f22c1780b9/resource/f701b7b6-7339-43e7-b8ff-86e9f6f6c91f/download/green-spaces-4326.gpkg','source_bytes':len(raw),'source_sha256':SHA,'retrieved_utc':'2026-10-30','resource_last_modified':'2026-10-27T21:59:59.537266','update_frequency':'Monthly','source_crs':'EPSG:4326, verified gpkg_geometry_columns; no Z/M','bbox':BBOX,'records':len(features),'clipped_source_fids':clipped,'invalid_source_fids':invalid,'selection':'Intersect valid source polygons with district bbox; preserve holes; no simplification, repair or inferred vegetation. Display clipping creates no routing boundaries.','id_semantics':'Snapshot-qualified GeoPackage fid; original AREA_ID and AREA_ATTR_ID retained, no stability guarantee.','license':'Open Government Licence – Toronto version 1.0','license_url':'https://open.toronto.ca/open-data-licence/','license_evidence':'Official dataset page links OGL–Toronto; CKAN license_id is open-government-licence-toronto.','attribution':'Contains information licensed under the Open Government Licence – Toronto.','limits':['Generalized point-in-time parks/open-space designations; not exhaustive land cover.','May include private institutions and paved areas; no public access or vegetation coverage inferred.','Rendered as a flat cartographic overlay; not terrain, parcel/title evidence, routing or a walkable surface.'],'subset_sha256':hashlib.sha256((out/'green-spaces.geojson').read_bytes()).hexdigest()}
    save(out/'green-spaces-provenance.json',provenance);print([(f['properties']['AREA_NAME'],f['properties']['AREA_CLASS']) for f in features]);print('records',len(features),'bytes',(out/'green-spaces.geojson').stat().st_size,'clipped',clipped,'invalid',invalid)
if __name__=='__main__':extract(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'fixtures/toronto')
