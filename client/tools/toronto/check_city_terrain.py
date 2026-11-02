"""Independent source-point checks plus descriptive massing alignment audit (not datum proof)."""
import json,math,sys
from pathlib import Path
import numpy as np,pyproj,pyogrio.raw,shapely
import shapely.geometry
root=Path(__file__).resolve().parents[2];out=root/'fixtures/toronto/city-terrain';m=json.loads((out/'manifest.json').read_text());a=np.fromfile(out/'heights.f32',dtype='<f4').reshape(m['height'],m['width']);east=m['frame']['metresPerLongitude'];north=m['frame']['metresPerLatitude']
def sample(lon,lat):
 x=((lon+79.397)*east-m['origin'][0])/64;z=((43.65-lat)*north-m['origin'][1])/64;i,j=math.floor(x),math.floor(z)
 if i<0 or j<0 or i+1>=m['width'] or j+1>=m['height']:return None
 q=a[j:j+2,i:i+2]
 if not np.isfinite(q).all():return None
 u,v=x-i,z-j;return float((q[0,0]*(1-u)+q[0,1]*u)*(1-v)+(q[1,0]*(1-u)+q[1,1]*u)*v)
to=pyproj.Transformer.from_crs(4326,2952,always_xy=True);samples=[]
for j in range(25,m['height'],70):
 for i in range(20,m['width'],90):
  if not np.isfinite(a[j,i]):continue
  lon=(m['origin'][0]+i*64)/east-79.397;lat=43.65-(m['origin'][1]+j*64)/north;x,y=to.transform(lon,lat);p=shapely.Point(x,y)
  _,_,wkb,_=pyogrio.raw.read(Path(sys.argv[1])/'tin-2023/2023_TIN.shp',bbox=(x-.01,y-.01,x+.01,y+.01),columns=[])
  hits=[]
  for blob in wkb:
   g=shapely.from_wkb(blob)
   if not g.covers(p):continue
   v=shapely.get_coordinates(g,include_z=True)[:3];weights=np.linalg.solve(np.array([[*v[:,0]],[*v[:,1]],[1,1,1]]),[x,y,1]);hits.append(float(weights@v[:,2]))
  assert hits and max(abs(z-float(a[j,i])) for z in hits)<.0001
  samples.append({'column':i,'row':j,'height_m':float(a[j,i])})
features=json.loads((root/'fixtures/toronto/district.geojson').read_text())['features'];diff=[];missing=0;zero_surface=0
for f in features:
 p=f['properties'];center=shapely.geometry.shape(f['geometry']).representative_point();h=sample(center.x,center.y);s=p.get('SURF_ELEV')
 if s==0:zero_surface+=1;continue
 if h is None or not isinstance(s,(int,float)) or not math.isfinite(s):missing+=1;continue
 diff.append(h-s)
report={'sourceGridSha256':m['heightSha256'],'independentSourceSamples':samples,'massingSamplePosition':'Source footprint representative point, not potentially stale latitude/longitude attributes','districtMassingRecords':len(features),'comparedSurfaceElevations':len(diff),'missing':missing,'zeroSurfaceRowsExcluded':zero_surface,'tinMinusMassingSurfaceMetres':{'median':float(np.median(diff)),'p95Absolute':float(np.quantile(np.abs(diff),.95)),'min':min(diff),'max':max(diff)},'conclusion':'Descriptive comparison only. Massing SURF_ELEV vertical datum is not established by its inspected catalogue notes. Do not equate it to CGVD2013 or silently replace actor/bridge elevations. 64 m sampling smooths local relief. Road and GTFS geometries do not establish elevated/underground structural clearance.'}
(out/'alignment.json').write_text(json.dumps(report,indent=2)+'\n');print({**report,'independentSourceSamples':len(samples)})
