"""Sample original PolygonZ TIN triangles on a shared 64 m local grid; no Delaunay reconstruction."""
import hashlib,json,math,sys
from pathlib import Path
import numpy as np,pyogrio.raw,pyproj,shapely
from shapely.geometry import shape,mapping
import shapefile
ROOT=Path(__file__).resolve().parents[2];RAW=Path(sys.argv[1]);OUT=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'fixtures/toronto/city-terrain';OUT.mkdir(parents=True,exist_ok=True)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
assert sha(RAW/'tin-2023.zip')=='268bf5094437d942ecca5e521368affa58623427a22ff1e4c4bcebbf9f4a1cb6'
assert sha(RAW/'municipal-boundary.zip')=='7c4b32f9d4532eedcb5f533973d6b55f27370dad7b2fa91b03cfb7942e8d0a4f'
boundary=shape(shapefile.Reader(str(next((RAW/'municipal-boundary').glob('*.shp')))).shape(0).__geo_interface__);assert boundary.is_valid
# Match existing localFrame exactly.
R=111132.;X=111320.*math.cos(math.radians(43.65))
print('frame constants',X,R,flush=True)
a,b,c,d=boundary.bounds;step=64;ox=math.floor((a+79.397)*X/step)*step;oz=math.floor((43.65-d)*R/step)*step
w=math.ceil(((c+79.397)*X-ox)/step)+1;h=math.ceil(((43.65-b)*R-oz)/step)+1
xx,zz=np.meshgrid(ox+np.arange(w)*step,oz+np.arange(h)*step);lon=xx.ravel()/X-79.397;lat=43.65-zz.ravel()/R
mask=shapely.covers(boundary,shapely.points(lon,lat));to=pyproj.Transformer.from_crs(4326,2952,always_xy=True);sx,sy=to.transform(lon[mask],lat[mask]);points=shapely.points(sx,sy)
values=np.full(len(sx),np.nan);conflicts=np.zeros(len(sx),dtype=bool);count=2628358;checked=0;max_shared_delta=0
source=RAW/'tin-2023/2023_TIN.shp'
assert pyogrio.read_info(source)['crs']=='EPSG:2952'
for start in range(0,count,100000):
 meta,fids,wkb,fields=pyogrio.raw.read(source,skip_features=start,max_features=100000,columns=[],return_fids=True)
 geoms=shapely.from_wkb(wkb);assert np.all(shapely.has_z(geoms));tree=shapely.STRtree(geoms)
 pointids,triids=tree.query(points,predicate='covered_by')
 for pi,ti in zip(pointids,triids):
  coords=shapely.get_coordinates(geoms[ti],include_z=True);assert len(coords)==4
  A,B,C=coords[:3];px,py=sx[pi],sy[pi];den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);assert abs(den)>1e-12
  u=((B[1]-C[1])*(px-C[0])+(C[0]-B[0])*(py-C[1]))/den;v=((C[1]-A[1])*(px-C[0])+(A[0]-C[0])*(py-C[1]))/den
  z=u*A[2]+v*B[2]+(1-u-v)*C[2];assert np.isfinite(z) and -10<z<400
  if np.isfinite(values[pi]):
   delta=abs(values[pi]-z);max_shared_delta=max(max_shared_delta,delta)
   if delta>.01:conflicts[pi]=True
  else:values[pi]=z
 checked+=len(pointids);print(start,len(pointids),flush=True)
values[conflicts]=np.nan
# NaN is explicit missing data. No lake flattening, extrapolation or hole filling.
full=np.full(w*h,np.nan,dtype='<f4');full[mask]=values;full.tofile(OUT/'heights.f32')
geo={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'AREA_NAME':'Toronto'},'geometry':mapping(boundary)}]};(OUT/'boundary.geojson').write_text(json.dumps(geo,separators=(',',':'))+'\n')
manifest={'version':1,'width':w,'height':h,'step':step,'origin':[ox,oz],'frame':{'lat':43.65,'lon':-79.397,'metresPerLatitude':R,'metresPerLongitude':X},'encoding':'little-endian float32; NaN means outside boundary or missing/conflicting TIN coverage','verticalDatum':'CGVD2013','units':'metres','sourceYear':2023,'bbox':list(boundary.bounds),'boundaryNodes':int(mask.sum()),'validNodes':int(np.isfinite(full).sum()),'missingInsideNodes':int(np.isnan(values).sum()),'conflictNodes':int(conflicts.sum()),'min':float(np.nanmin(full)),'max':float(np.nanmax(full)),'sourceTriangleCount':count,'sampleMatches':checked,'maxSharedEdgeDifferenceMetres':max_shared_delta,'heightSha256':sha(OUT/'heights.f32'),'boundarySha256':sha(OUT/'boundary.geojson')}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(manifest)
