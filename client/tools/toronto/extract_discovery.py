"""Derive names and points only from pinned StrollTO GeoJSON (no images or prose)."""
import hashlib,json,sys,pathlib
SOURCES=[('starts','002b9649-1541-4608-8c13-959ef4b229a1','strollto-starting-points-4326.geojson','3ca57df52eeb0e9e8e2be44c8b2cfd56cc47d0323a4c1f2c6d86fd179188b379',159,'2026-09-20T00:05:43.714614'),('pois','5a8a8213-b0a0-4eda-85a9-afebe6fe62ef','strollto-poi-details-4326.geojson','0dc7fe73138c30168fd59908b52499945c163b74c79e438cb4e834f19f85b6e4',1838,'2026-10-20T00:04:44.350675')]
def extract(paths):
 out={'version':1,'coordinateSystem':'EPSG:4326','sources':[]}
 for path,(kind,rid,name,sha,count,modified) in zip(paths,SOURCES,strict=True):
  raw=pathlib.Path(path).read_bytes();assert hashlib.sha256(raw).hexdigest()==sha,'Source checksum mismatch'
  data=json.loads(raw);assert data['crs']['properties']['name']=='urn:ogc:def:crs:OGC:1.3:CRS84'
  rows=[]
  for f in data['features']:
   p=f['properties'];g=f['geometry'];assert g['type']=='MultiPoint' and len(g['coordinates'])==1
   lon,lat=g['coordinates'][0];assert -79.65<lon<-79.10 and 43.57<lat<43.87
   rows.append({'id':f'{kind}:{p["_id"]}','group':str(int(p['Neighbourhood_Num'])),'name':' '.join(p['Title'].split()),'neighbourhood':' '.join(p['Neighbourhood'].split()),'coordinate':[lon,lat]})
  assert len(rows)==count and len({r['id'] for r in rows})==count and all(r['name'] for r in rows)
  out[kind]=sorted(rows,key=lambda r:int(r['id'].split(':')[1]))
  out['sources'].append({'dataset':'StrollTO','owner':'City of Toronto, Visitor Economy Office','datasetUrl':'https://open.toronto.ca/dataset/strollto/','url':f'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f87fbe88-f9d1-432d-a482-b7044b32d587/resource/{rid}/download/{name}','sha256':sha,'bytes':len(raw),'retrieved':'2026-11-03','modified':modified,'records':count,'licence':'Open Government Licence – Toronto','licenceUrl':'https://open.toronto.ca/open-data-licence/','attribution':'Contains information licensed under the Open Government Licence – Toronto.'})
 assert len({r['group'] for r in out['starts']})==159
 assert all(r['group'] in {n['group'] for n in out['starts']} for r in out['pois'])
 return out
if __name__=='__main__':
 pathlib.Path(sys.argv[3]).write_text(json.dumps(extract(sys.argv[1:3]),ensure_ascii=False,separators=(',',':'))+'\n')
