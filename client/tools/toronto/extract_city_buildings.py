"""Stream the pinned massing archive into bounded per-tile spools (raw/spools never in Git)."""
import hashlib,json,math,sys,zipfile
from pathlib import Path
from collections import OrderedDict,Counter
import numpy as np,pyproj,shapefile,shapely
from shapely.geometry import shape,mapping,Polygon
from shapely.ops import transform
RAW=Path(sys.argv[1]);OUT=RAW/'city-building-spool';OUT.mkdir(exist_ok=True)
for p in OUT.glob('*.ndjson'):p.unlink()
ROOT=Path(__file__).resolve().parents[2];F=ROOT/'fixtures/toronto';m=json.loads((F/'city-terrain/manifest.json').read_text());heights=np.fromfile(F/'city-terrain/heights.f32',dtype='<f4').reshape(m['height'],m['width']);boundary=shape(json.loads((F/'city-terrain/boundary.geojson').read_text())['features'][0]['geometry']);shapely.prepare(boundary)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
archive=RAW/'massing-2025.zip';assert digest(archive)=='9617089710518f1a24f70ca11b4a7c20ae45ab8e52a6fbed1bc088192efe6285'
assert digest(F/'city-terrain/heights.f32')==m['heightSha256']
assert digest(F/'city-terrain/boundary.geojson')==m['boundarySha256']
with zipfile.ZipFile(archive) as zipped:
 for ext in ['shp','shx','dbf','prj']:
  name='3DMassingShapefile_2025_WGS84.'+ext;h=hashlib.sha256()
  with zipped.open(name) as src:
   for block in iter(lambda:src.read(1<<20),b''):h.update(block)
  assert digest(RAW/name)==h.hexdigest(),'Extracted source differs from pinned archive: '+name
 assert 'WGS_1984_Web_Mercator_Auxiliary_Sphere' in zipped.read('3DMassingShapefile_2025_WGS84.prj').decode()

to=pyproj.Transformer.from_crs(3857,4326,always_xy=True).transform;east=m['frame']['metresPerLongitude'];north=m['frame']['metresPerLatitude']
def local(lon,lat,z=None):return (np.asarray(lon)+79.397)*east,(43.65-np.asarray(lat))*north

def ground(x,z):
 u=(x-m['origin'][0])/64;v=(z-m['origin'][1])/64;i,j=math.floor(u),math.floor(v)
 if i<0 or j<0 or i+1>=m['width'] or j+1>=m['height']:return None
 q=heights[j:j+2,i:i+2]
 if not np.isfinite(q).all():return None
 u-=i;v-=j;return float((q[0,0]*(1-u)+q[0,1]*u)*(1-v)+(q[1,0]*(1-u)+q[1,1]*u)*v)
files=OrderedDict();counts=Counter();omissions=[];tiles=Counter();retained=set();crossing=[]
r=shapefile.Reader(str(RAW/'3DMassingShapefile_2025_WGS84.shp'));assert r.numRecords==428184
for row in r.iterShapeRecords():
 rid=row.record.oid;counts['sourceRecords']+=1;p=row.record.as_dict();height=p['AVG_HEIGHT'];g=shape(row.shape.__geo_interface__)
 if not g.is_valid:omissions.append([rid,None,'invalid-geometry']);counts['invalidRecords']+=1;continue
 if not isinstance(height,(float,int)) or not math.isfinite(height) or not 0<height<600:omissions.append([rid,None,'invalid-height']);counts['heightRecords']+=1;continue
 g=transform(to,g)
 for part,poly in enumerate([g] if g.geom_type=='Polygon' else g.geoms):
  counts['sourceValidParts']+=1;center=poly.representative_point()
  if not boundary.covers(center):omissions.append([rid,part,'outside-municipal-anchor']);counts['outsideParts']+=1;continue
  metric=transform(local,poly);x,z=local(center.x,center.y);base=ground(float(x),float(z));a,b,c,d=metric.bounds;tx,tz=math.floor((a+c)/1024),math.floor((b+d)/1024)
  reason=None
  if base is None:reason='missing-terrain-anchor'
  elif not metric.is_valid or any(Polygon(r).area<.011 for r in [metric.exterior,*metric.interiors]):reason='small-or-invalid-ring'
  elif max(abs(a-tx*512),abs(c-tx*512),abs(b-tz*512),abs(d-tz*512))>4096:reason='unsupported-span'
  elif any(len(r.coords)>65536 for r in [metric.exterior,*metric.interiors]):reason='unsupported-ring-size'
  if reason:omissions.append([rid,part,reason]);counts[reason]+=1;continue
  if not boundary.covers(poly):crossing.append([rid,part])
  key=f'{tx}_{tz}';feature={'type':'Feature','id':f'2025:record:{rid}:part:{part}','sourceId':f'2025:record:{rid}','sourcePart':part,'properties':{'AVG_HEIGHT':height,'source_record_index':rid,'terrain_base':base,'anchor':[float(x),float(z)]},'geometry':mapping(poly)}
  if key in files:handle=files.pop(key)
  else:
   if len(files)>=64:files.popitem(last=False)[1].close()
   handle=(OUT/(key+'.ndjson')).open('a')
  files[key]=handle;handle.write(json.dumps(feature,separators=(',',':'),allow_nan=False)+'\n');tiles[key]+=1;counts['retainedParts']+=1;retained.add(rid)
 if rid%25000==0:print(rid,counts['retainedParts'],flush=True)
for f in files.values():f.close()
report={'counts':dict(counts),'retainedRecords':len(retained),'tiles':dict(sorted(tiles.items())),'omissions':omissions,'boundaryCrossingParts':crossing,'sourceArchiveSha256':digest(archive),'terrainSha256':m['heightSha256'],'boundarySha256':m['boundarySha256'],'placement':'Illustrative level base sampled bilinearly at source footprint representative point on the 64 m CGVD2013 terrain grid. Source AVG_HEIGHT retained unchanged. SURF_ELEV and HEIGHT_MSL are not used or datum-converted. Flat foundations may intersect local slopes; no bridge/actor/collision changes.','selection':'Whole valid polygon parts with representative point inside the official municipality. Boundary-crossing footprints remain whole and are recorded. No geometry repair, synthetic height, lake fill or missing-anchor extrapolation.'}
(OUT/'report.json').write_text(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n');print({k:v for k,v in report.items() if k not in ['omissions','tiles','boundaryCrossingParts']})
