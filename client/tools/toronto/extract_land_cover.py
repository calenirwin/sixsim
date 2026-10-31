"""Crop official 2018 classified polygons to a bounded categorical display grid."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
import pyogrio,pyogrio.raw,pyproj,shapely
from shapely.geometry import box
from shapely.ops import transform
from rasterio.features import rasterize
from rasterio.transform import from_bounds
ROOT=Path(__file__).resolve().parents[2]
BBOX=[-79.410,43.642,-79.385,43.665]
SHA='bdfb033b8e0e59b35a4b24c16c553084ceec354ce9a247145e6c7d7743171c16'
CLASSES={1:'tree',2:'grass',3:'bare',4:'water',5:'building',6:'road',7:'other',8:'shrub'}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def save(p,v):p.write_text(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
def extract(raw,out):
 archive=raw/'landcover2018_gdb.zip';assert archive.stat().st_size==436398730 and digest(archive)==SHA
 db=raw/'LandCover2018.gdb';info=pyogrio.read_info(db,layer='LandCover2018');assert info['crs']=='EPSG:2952' and info['features']==1812
 to_source=pyproj.Transformer.from_crs(4326,2952,always_xy=True);to_geo=pyproj.Transformer.from_crs(2952,4326,always_xy=True)
 extent=box(*BBOX);metric=transform(to_source.transform,extent)
 meta,fids,wkb,arrays=pyogrio.raw.read(db,layer='LandCover2018',bbox=metric.bounds,columns=['gridcode','Desc'],return_fids=True)
 assert len(fids)<200 and sum(len(g) for g in wkb)<100_000_000
 fields=dict(zip(meta['fields'],arrays));groups={k:[] for k in CLASSES};normalized=[];omitted=[];max_delta=0
 for fid,blob,code,description in sorted(zip(fids,wkb,fields['gridcode'],fields['Desc']),key=lambda r:r[0]):
  code=int(code);assert CLASSES[code]==description
  for part,g in enumerate(shapely.get_parts(shapely.from_wkb(blob))):
   if not g.intersects(metric):continue
   if not g.is_valid:
    fixed=shapely.make_valid(g);delta=abs(fixed.area-g.area)
    if fixed.geom_type not in ('Polygon','MultiPolygon') or not fixed.is_valid or delta>.01:
     omitted.append([int(fid),part]);continue
    normalized.append([int(fid),part]);max_delta=max(max_delta,delta);g=fixed
   clipped=transform(to_geo.transform,g).intersection(extent)
   if not clipped.is_empty and clipped.area>0:groups[code].append(clipped)
 width,height=512,640;affine=from_bounds(*BBOX,width,height)
 cells=np.zeros((height,width),dtype=np.uint8);hits=np.zeros_like(cells)
 for code,geometries in groups.items():
  if not geometries:continue
  mask=rasterize(((g,1) for g in geometries),out_shape=cells.shape,transform=affine,fill=0,all_touched=False,dtype='uint8')
  cells[mask==1]=code;hits+=mask
 conflicts=int((hits>1).sum());cells[hits>1]=0
 flat=cells.ravel();runs=[]
 for code in flat.tolist():
  if runs and runs[-2]==code:runs[-1]+=1
  else:runs.extend([code,1])
 counts=np.bincount(flat,minlength=9).tolist()
 data={'version':1,'bbox':BBOX,'width':width,'height':height,'rowOrder':'north-to-south','basis':'2018 top-down classified cover; approximately 4 m derived display grid','classes':CLASSES,'counts':counts,'runs':runs}
 out.mkdir(parents=True,exist_ok=True);save(out/'land-cover-2018.json',data)
 p={'dataset':'City of Toronto Forest and Land Cover — 2018 study','dataset_url':'https://open.toronto.ca/dataset/forest-and-land-cover/','package_api':'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=forest-and-land-cover','source_url':'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/61642048-56bb-4050-b7c3-f569fcf94527/resource/69419e11-2dfa-4bcc-bed0-43a9dd2d0973/download/landcover2018_gdb.zip','source_sha256':SHA,'source_bytes':436398730,'retrieved_utc':'2026-10-30','resource_last_modified':'2022-08-17T19:30:50','study_year':2018,'source_layer':'LandCover2018','source_crs':'EPSG:2952, verified OpenFileGDB layer metadata, not the older 2008 NAD27 source','bbox':BBOX,'selected_source_fids':[int(f) for f in fids],'normalization':{'method':'GEOS make_valid on invalid individual polygon parts before clipping; accept only valid polygonal results with area difference <=0.01 m²; no buffer/simplification or class reassignment','parts':normalized,'max_area_difference_m2':max_delta,'omitted_parts':omitted},'grid':{'width':width,'height':height,'crs':'EPSG:4326','row_order':'north-to-south','sampling':'Rasterio/GDAL default polygon pixel-center rasterization, all_touched=false; same-class overlap unioned; multi-class overlap becomes 0/unknown','cell_degrees':[(BBOX[2]-BBOX[0])/width,(BBOX[3]-BBOX[1])/height],'conflict_cells':conflicts,'counts':counts,'unknown_code':0},'license':'Open Government Licence – Toronto version 1.0','license_url':'https://open.toronto.ca/open-data-licence/','license_evidence':'Official catalogue page and current CKAN license_id identify OGL–Toronto.','attribution':'Contains information licensed under the Open Government Licence – Toronto.','limits':['Historical classification, not current vegetation or ground truth. Tree canopy can cover roads and other surfaces; classifications describe the top-down view.','Display raster is coarser than source polygons, may lose narrow features; unknown/conflicting cells are transparent, not assumed bare ground.','Flat cartographic overlay with illustrative class colours; no terrain, access, routing or hydrological parameters inferred.','2018 cover, 2025 massing archive and 2026 green-space designations differ in vintage; do not treat disagreements as errors automatically.'],'subset_sha256':digest(out/'land-cover-2018.json')}
 save(out/'land-cover-provenance.json',p);print({'source_features':len(fids),'normalized_parts':len(normalized),'max_area_delta':max_delta,'omitted_parts':len(omitted),'conflicts':conflicts,'counts':counts,'bytes':(out/'land-cover-2018.json').stat().st_size})
if __name__=='__main__':extract(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'fixtures/toronto')
