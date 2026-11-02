"""Stream pinned 2018 polygons to municipal 16 m categorical tiles; no invented cover."""
import hashlib,json,math,sys,zipfile
from pathlib import Path
import numpy as np,pyogrio,pyogrio.raw,pyproj,shapely
from shapely.ops import transform
from rasterio.features import rasterize
from affine import Affine
ROOT=Path(__file__).resolve().parents[2];F=ROOT/'fixtures/toronto';raw=Path(sys.argv[1]);out=Path(sys.argv[2]) if len(sys.argv)>2 else F/'city-cover';out.mkdir(parents=True,exist_ok=True)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def save(p,v):p.write_text(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
prov=json.loads((F/'land-cover-provenance.json').read_text());archive=raw/'landcover2018_gdb.zip';assert sha(archive)==prov['source_sha256']
with zipfile.ZipFile(archive) as z:
 for n in z.namelist():
  if n.endswith('/') or not n.startswith('LandCover2018.gdb/'):continue
  local=raw/n;assert local.is_file(),n
  h=hashlib.sha256()
  with z.open(n) as f:
   for b in iter(lambda:f.read(1<<20),b''):h.update(b)
  assert sha(local)==h.hexdigest(),n
m=json.loads((F/'city-terrain/manifest.json').read_text());assert sha(F/'city-terrain/boundary.geojson')==m['boundarySha256']
ox,oz=m['origin'];step=16;w=math.ceil((m['width']-1)*64/1024)*64;h=math.ceil((m['height']-1)*64/1024)*64
bits=np.zeros((h,w),dtype=np.uint16);affine=Affine(step,0,ox,0,step,oz)
to=pyproj.Transformer.from_crs(2952,4326,always_xy=True).transform
def local(lon,lat,z=None):return (np.asarray(lon)+79.397)*m['frame']['metresPerLongitude'],(43.65-np.asarray(lat))*m['frame']['metresPerLatitude']
def project(x,y,z=None):
 lon,lat=to(x,y);return local(lon,lat)
classes={0:'unknown',1:'tree',2:'grass',3:'bare',4:'water',5:'building',6:'road',7:'other',8:'shrub'}
db=raw/'LandCover2018.gdb';info=pyogrio.read_info(db,layer='LandCover2018');assert info['crs']=='EPSG:2952' and info['features']==1812
normalized=[];omitted=[];max_delta=0;source_parts=0
_,all_fids,_,_=pyogrio.raw.read(db,layer='LandCover2018',columns=['gridcode'],return_fids=True,read_geometry=False)
for offset in range(0,1812,8):
 meta,fids,wkb,arrays=pyogrio.raw.read(db,layer='LandCover2018',columns=['gridcode','Desc'],return_fids=True,fids=all_fids[offset:offset+8])
 fields=dict(zip(meta['fields'],arrays))
 for fid,blob,code,desc in zip(fids,wkb,fields['gridcode'],fields['Desc']):
  code=int(code);assert (classes[code] if code else '')==desc;geometries=[]
  for part,g in enumerate(shapely.get_parts(shapely.from_wkb(blob))):
   source_parts+=1
   if not g.is_valid:
    fixed=shapely.make_valid(g);delta=abs(fixed.area-g.area)
    if fixed.geom_type not in ('Polygon','MultiPolygon') or not fixed.is_valid or delta>.01:omitted.append([int(fid),part]);continue
    normalized.append([int(fid),part]);max_delta=max(max_delta,delta);g=fixed
   if not g.is_empty:geometries.append(g)
  if not geometries:continue
  geometries=shapely.transform(np.asarray(geometries,dtype=object),project,interleaved=False)
  bounds=shapely.bounds(geometries);x0=max(0,int(math.floor((bounds[:,0].min()-ox)/step)));y0=max(0,int(math.floor((bounds[:,1].min()-oz)/step)));x1=min(w,int(math.ceil((bounds[:,2].max()-ox)/step)));y1=min(h,int(math.ceil((bounds[:,3].max()-oz)/step)))
  if x0>=x1 or y0>=y1:continue
  mask=rasterize(((g,1) for g in geometries),out_shape=(y1-y0,x1-x0),transform=affine*Affine.translation(x0,y0),all_touched=False,dtype='uint8')
  bits[y0:y1,x0:x1]|=mask.astype(np.uint16)*(1<<code)
 if offset%80==0:print('Source rows',offset,flush=True)
boundary=transform(local,shapely.geometry.shape(json.loads((F/'city-terrain/boundary.geojson').read_text())['features'][0]['geometry']))
inside=rasterize([(boundary,1)],out_shape=(h,w),transform=affine,all_touched=False,dtype='uint8').astype(bool)
conflicts=inside & (bits!=0) & ((bits & (bits-1))!=0);cells=np.zeros((h,w),dtype=np.uint8)
for code in classes:cells[inside & (bits==(1<<code))]=code
# 9 = unresolved multi-class conflict; 0 = unknown/outside. Neither becomes bare ground.
cells[conflicts]=9;tiles={}
for j in range(h//64):
 for i in range(w//64):
  sl=np.s_[j*64:(j+1)*64,i*64:(i+1)*64]
  if not inside[sl].any():continue
  data=cells[sl].tobytes();name=f'{i}_{j}.u8';(out/name).write_bytes(data);tiles[f'{i}_{j}']={'f':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'counts':np.bincount(cells[sl].ravel(),minlength=10).tolist(),'insideCells':int(inside[sl].sum())}
counts=np.bincount(cells[inside],minlength=10).tolist()
manifest={'version':1,'year':2018,'tile':1024,'step':16,'side':64,'origin':m['origin'],'width':w,'height':h,'rowOrder':'north-to-south','classes':{**classes,0:'unknown',9:'conflict'},'counts':counts,'insideCells':int(inside.sum()),'terrainSha256':m['heightSha256'],'boundarySha256':m['boundarySha256'],'sourceSha256':prov['source_sha256'],'tiles':tiles}
save(out/'manifest.json',manifest)
save(out/'normalization.json',{'sourceFeatures':1812,'sourceParts':source_parts,'normalizedParts':normalized,'omittedParts':omitted,'maxAreaDifferenceM2':max_delta,'rule':prov['normalization']['method']})
p={k:prov[k] for k in ['dataset','dataset_url','package_api','source_url','source_sha256','source_bytes','retrieved_utc','resource_last_modified','study_year','source_layer','source_crs','license','license_url','license_evidence','attribution']}
p.update({'manifest_sha256':sha(out/'manifest.json'),'normalization_sha256':sha(out/'normalization.json'),'boundary_sha256':m['boundarySha256'],'terrain_sha256':m['heightSha256'],'grid':{'step_metres':16,'tile_metres':1024,'origin':m['origin'],'frame':m['frame'],'sampling':'Polygon pixel centres, all_touched=false; class bitset unions same-class overlap; conflicting classes are code 9, unknown/outside code 0. Municipal centre mask. No interpolation of class labels.','inside_cells':int(inside.sum()),'counts':counts,'tiles':len(tiles),'tile_bytes':len(tiles)*4096},'limits':['Historical 2018 top-down classification, not current vegetation or ground truth; canopy can obscure roads.','16 m display samples lose narrow features; transparent unknown/conflict cells are not bare ground.','Draped onto independently sourced coarse 2023 CGVD2013 terrain for context; source vintages differ. No physical ground, access, traffic or hydrological inference.','Available across municipality near camera only; overview retains elevation colours.'], 'normalization':{'source_parts':source_parts,'normalized_parts':len(normalized),'omitted_parts':len(omitted),'max_area_difference_m2':max_delta}})
save(out/'provenance.json',p);print(p['grid']);print(p['normalization'])
