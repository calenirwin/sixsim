"""Bounded waterfront geometry from pinned City sources; original triangles, no invented joins."""
import json,hashlib,math,sys
from placement_masks import excluded_by_water
from pathlib import Path
import numpy as np,pyogrio,pyogrio.raw,pyproj,shapely
from shapely.geometry import box,LineString,Point
from shapely.ops import transform,unary_union,substring
RAW=Path(sys.argv[1]);OUT=Path(sys.argv[2]);OUT.mkdir(parents=True,exist_ok=True)
BBOX=[-79.404,43.632,-79.378,43.647];extent=box(*BBOX);X=111320*math.cos(math.radians(43.65));R=111132
local=lambda lon,lat:((lon+79.397)*X,(43.65-lat)*R)
to=pyproj.Transformer.from_crs(4326,2952,always_xy=True);back=pyproj.Transformer.from_crs(2952,4326,always_xy=True);metric=transform(to.transform,extent)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(RAW/'pedestrian-20261104.geojson')=='49f082913cfb3d0a766dd4036d17e623e2303e65515866e7744084e4a749c8fd'
assert sha(RAW/'water-body-20261104.gpkg')=='bc513f1cb3d56925a0cf9158949af2fc2f98ef2b9b49fd1ecb2b17cdb23174d6'
assert sha(RAW/'tin-2023.zip')=='268bf5094437d942ecca5e521368affa58623427a22ff1e4c4bcebbf9f4a1cb6'
assert sha(RAW/'landcover2018_gdb.zip')=='bdfb033b8e0e59b35a4b24c16c553084ceec354ce9a247145e6c7d7743171c16'
assert sha(RAW/'centreline-20261023.gpkg')=='f6cafbd260232c4f14a844fa89c342d5b173931362b195f2784c24a995e1756a'
# Read only source TIN triangles intersecting this district; clipping preserves linear Z interpolation.
src=RAW/'tin-2023/2023_TIN.shp';assert pyogrio.read_info(src)['crs']=='EPSG:2952'
m,f,w,a=pyogrio.raw.read(src,bbox=metric.bounds,columns=[],return_fids=True);triangles=shapely.from_wkb(w);tree=shapely.STRtree(triangles)
def height(lon,lat):
 x,y=to.transform(lon,lat);hits=tree.query(Point(x,y),predicate='covered_by');vals=[]
 for i in hits:
  A,B,C=shapely.get_coordinates(triangles[i],include_z=True)[:3];den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);u=((B[1]-C[1])*(x-C[0])+(C[0]-B[0])*(y-C[1]))/den;v=((C[1]-A[1])*(x-C[0])+(A[0]-C[0])*(y-C[1]))/den;vals.append(float(u*A[2]+v*B[2]+(1-u-v)*C[2]))
 if not vals or max(vals)-min(vals)>.01:return None
 return vals[0]
# The TIN is bare-earth context, not bathymetry: remove mapped water before rendering ground.
m,f,w,a=pyogrio.raw.read(RAW/'water-body-20261104.gpkg',bbox=tuple(BBOX),return_fids=True);assert m['crs']=='EPSG:4326';water=[];waterGeometries=[];waterSourceMasks=[]
for fid,blob,name in zip(f,w,a[list(m['fields']).index('WATERBODY_NAME')]):
 g=shapely.from_wkb(blob).intersection(extent);assert g.is_valid;waterGeometries.append(g);waterSourceMasks.append((int(fid),transform(to.transform,g)))
 for p in shapely.get_parts(g):
  if p.geom_type=='Polygon' and p.area>1e-10:water.append({'id':int(fid),'name':name,'rings':[[list(local(*q[:2])) for q in ring.coords] for ring in [p.exterior,*p.interiors]]})
waterMask=transform(to.transform,unary_union(waterGeometries))
def groundMesh(region,lift=0):
 verts=[]
 regions=shapely.STRtree(region) if isinstance(region,list) else None
 for t in triangles:
  footprint=shapely.force_2d(t)
  mask=unary_union([region[i] for i in regions.query(footprint)]) if regions is not None else region
  clipped=footprint.intersection(mask)
  A,B,C=shapely.get_coordinates(t,include_z=True)[:3];den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1])
  for p in shapely.get_parts(clipped):
   if p.geom_type!='Polygon':continue
   for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(p)):
    rendered=[]
    for x,y in list(tri.exterior.coords)[:3]:
     u=((B[1]-C[1])*(x-C[0])+(C[0]-B[0])*(y-C[1]))/den;v=((C[1]-A[1])*(x-C[0])+(A[0]-C[0])*(y-C[1]))/den;z=u*A[2]+v*B[2]+(1-u-v)*C[2]
     lon,lat=back.transform(x,y);lx,lz=local(lon,lat);rendered.append([round(lx,4),round(z+lift,4),round(lz,4)])
    a,b,c=rendered
    if abs((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))>2e-6:verts.extend(v for p in rendered for v in p)
 return verts
verts=groundMesh(metric.difference(waterMask))
# Sample illustrative vegetation only within source 2018 canopy polygons, never present these as inventoried individual trees.
m,f,w,a=pyogrio.raw.read(RAW/'LandCover2018.gdb',layer='LandCover2018',bbox=metric.bounds,columns=['gridcode'],return_fids=True);canopy=[];grass=[];canopySources=[]
for fid,blob,code in zip(f,w,a[0]):
 if int(code) not in (1,2):continue
 for p in shapely.get_parts(shapely.from_wkb(blob)):
  if p.is_valid and p.intersects(metric):
   (canopy if int(code)==1 else grass).append(p.intersection(metric))
   if int(code)==1:canopySources.append((int(fid),p))
canopy=unary_union(canopy);grassVertices=groundMesh(unary_union(grass).difference(waterMask),.02)
# Clip source pedestrian alignments, retaining IDs and crossing evidence.
features=json.loads((RAW/'pedestrian-20261104.geojson').read_text())['features'];byid={p['properties']['OBJECTID']:p for p in features};paths=[]
for f in features:
 p=f['properties']
 if p['ROAD_TYPE']=='Pending':continue
 for line in f['geometry']['coordinates']:
  geom=LineString(line)
  if not geom.intersects(extent):continue
  for l in shapely.get_parts(geom.intersection(extent)):
   if l.geom_type!='LineString':continue
   pts=[]
   # Densify in local metres before querying original TIN.
   loc=LineString([local(*q) for q in l.coords]);n=math.ceil(loc.length/5)
   for i in range(n+1):
    q=loc.interpolate(i/n,normalized=True);lon=q.x/X-79.397;lat=43.65-q.y/R;h=height(lon,lat)
    if h is None:pts=[];break
    pts.append([round(q.x,4),round(h+.06,4),round(q.y,4)])
   if pts:paths.append({'id':p['OBJECTID'],'type':p['ROAD_TYPE'],'crosswalk':p['CROSSWALK']==1,'points':pts})
# Union buffered source paths before clipping to each original TIN triangle. Round joins
# close bend wedges without extending invented connectors across source gaps. Full-width
# barycentric heights prevent the ground cutting through centreline-height ribbons.
pavingRegions=[]
for path in paths:
 line=LineString([to.transform(p[0]/X-79.397,43.65-p[2]/R) for p in path['points']])
 pavingRegions.append(line.buffer(2 if path['type']=='Trail' else 1.3,quad_segs=4).intersection(metric).difference(waterMask))
# Source street centrelines provide plan alignment only; visual widths are authored.
roads=[]
m,f,w,a=pyogrio.raw.read(RAW/'centreline-20261023.gpkg',bbox=tuple(BBOX),columns=['CENTRELINE_ID','FEATURE_CODE_DESC'],return_fids=True)
for blob,ident,kind in zip(w,a[0],a[1]):
 if kind not in ['Major Arterial','Minor Arterial','Collector','Local','Laneway']:continue
 for l in shapely.get_parts(shapely.from_wkb(blob).intersection(extent)):
  if l.geom_type!='LineString':continue
  loc=LineString([local(*q[:2]) for q in l.coords]);n=max(1,math.ceil(loc.length/5));pts=[]
  for i in range(n+1):
   q=loc.interpolate(i/n,normalized=True);h=height(q.x/X-79.397,43.65-q.y/R)
   if h is None:pts=[];break
   pts.append([round(q.x,4),round(h+.035,4),round(q.y,4)])
  if pts:roads.append({'id':int(ident),'type':kind,'points':pts})
# Full-width road surfaces retain illustrative class widths but follow original terrain.
roadWidths={'Major Arterial':14,'Minor Arterial':11,'Collector':9,'Local':7,'Laneway':4}
roadRegions=[]
for road in roads:
 line=LineString([to.transform(p[0]/X-79.397,43.65-p[2]/R) for p in road['points']])
 roadRegions.append(line.buffer(roadWidths[road['type']]/2,quad_segs=4).intersection(metric).difference(waterMask))
roadVertices=groundMesh(roadRegions,.035)
assert len(roadVertices)<1500000
# Source-flagged crossings remain road-coloured; authored paint only overlaps roads.
roadMask=unary_union(roadRegions);crossingRegions=[];stripeRegions=[];crossingSourceIds=[]
for path in paths:
 if not path['crosswalk']:continue
 line=LineString([to.transform(p[0]/X-79.397,43.65-p[2]/R) for p in path['points']])
 area=line.buffer(1.3,cap_style=2,quad_segs=4).intersection(roadMask)
 if area.is_empty:continue
 crossingSourceIds.append(path['id']);crossingRegions.append(area)
 for start in np.arange(0,line.length,1.2):
  stripe=substring(line,float(start),min(float(start)+.6,line.length))
  if stripe.geom_type=='LineString':stripeRegions.append(stripe.buffer(1.3,cap_style=2).intersection(area.buffer(-.005)))
crossingMask=unary_union(crossingRegions)
pavingVertices=groundMesh([p.difference(crossingMask) for p in pavingRegions],.06)
crossingVertices=groundMesh(stripeRegions,.045)
assert len(crossingVertices)<500000 and len(pavingVertices)<1500000
ids=[5398,62298,20086,340,20841,68366,55432,40725,16478,77672,56059,54894,75229,55583,78258];route=[];sourceRoute=[];previous=(-79.3961584,43.6383186);maxJoin=0
for ident in ids:
 line=byid[ident]['geometry']['coordinates'][0];dist=lambda a,b:math.hypot((a[0]-b[0])*X,(a[1]-b[1])*R)
 if dist(previous,line[-1])<dist(previous,line[0]):line=list(reversed(line))
 gap=dist(previous,line[0]);maxJoin=max(maxJoin,gap);assert gap<.02
 sourceRoute.append({'id':ident,'points':line,'crosswalk':byid[ident]['properties']['CROSSWALK']==1});previous=line[-1]
 route.extend(line if not route else line[1:])
loc=LineString([local(*q) for q in route]);walk=[]
for i in range(math.ceil(loc.length/2)+1):
 d=min(i*2,loc.length);q=loc.interpolate(d);h=height(q.x/X-79.397,43.65-q.y/R);assert h is not None;walk.append([round(d,4),round(q.x,4),round(h+.10,4),round(q.y,4)])
# Seeded grid samples; heights/shapes of tree models are authored, not inventory measurements.
trees=[];treeStyleIds=[];excludedTrees=[];candidateIndex=0
for x in range(math.ceil(metric.bounds[0]/14)*14,int(metric.bounds[2]),14):
 for y in range(math.ceil(metric.bounds[1]/14)*14,int(metric.bounds[3]),14):
  if not canopy.covers(Point(x,y)):continue
  lon,lat=back.transform(x,y);lx,lz=local(lon,lat);h=height(lon,lat)
  if h is not None and loc.distance(Point(lx,lz))>4:
   position=[round(lx,3),round(h,3),round(lz,3)]
   # Boundary-inclusive exclusion, using the same official water mask as ground.
   # Hole interiors remain eligible; do not infer a planting surface from old canopy.
   if excluded_by_water(waterMask,Point(x,y)):
    excludedTrees.append({'candidateIndex':candidateIndex,'gridEPSG2952':[x,y],'position':position,'reason':'mapped-water-centre','canopyFeatureIds':sorted(set(fid for fid,g in canopySources if g.covers(Point(x,y)))),'waterFeatureIds':sorted(set(fid for fid,g in waterSourceMasks if g.covers(Point(x,y))))})
   else:trees.append(position);treeStyleIds.append(candidateIndex)
   candidateIndex+=1
assert len(trees)<2000 and len(verts)<500000 and len(paths)<1000
out={'version':1,'bbox':BBOX,'frame':{'lon':-79.397,'lat':43.65},'groundVertices':verts,'grassVertices':grassVertices,'pavingVertices':pavingVertices,'roadVertices':roadVertices,'crossingVertices':crossingVertices,'crossingSourceIds':sorted(set(crossingSourceIds)),'water':water,'waterLevel':74.5,'trees':trees,'treeStyleIds':treeStyleIds,'paths':paths,'roads':roads,'walk':walk,'sourceRoute':sourceRoute,'lengthM':loc.length,'maxJoinM':maxJoin,'limits':['Guided virtual walk on source pedestrian alignments; not verified present access, crossing permission or collision simulation.','Original 2023 CGVD2013 bare-earth triangles; no bridge or structural road elevations inferred.','Water footprint follows City topographic mapping; constant 74.5 scene-metre water level is illustrative, not a measured level or datum conversion.','Pedestrian ribbon widths, paving, crossing stripes, facades and tree shapes are original illustration. Trees sample 2018 canopy, not individual inventory locations.','Municipal massing bases remain coarse terrain-relative illustrations; fine ground may intersect them.']}
(OUT/'scene.json').write_text(json.dumps(out,separators=(',',':'),allow_nan=False)+'\n');print({'triangles':len(verts)//9,'waterParts':len(water),'trees':len(trees),'paths':len(paths),'walkLength':loc.length,'maxJoinM':maxJoin,'bytes':(OUT/'scene.json').stat().st_size})
F=Path(__file__).resolve().parents[2]/'fixtures/toronto'
ped={'dataset_url':'https://open.toronto.ca/dataset/pedestrian-network/','source_url':'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/4b5c7a84-dea1-4137-875d-71d7f662c83f/resource/33835def-35f2-4705-a348-b7983e8e66a1/download/pedestrian-network-data-4326.geojson','source_sha256':sha(RAW/'pedestrian-20261104.geojson'),'source_bytes':36736103,'resource_last_modified':'2026-02-20T20:56:49.912115','retrieved_utc':'2026-11-04','crs':'EPSG:4326 / CRS84 longitude, latitude; source network derives from 2019 project, resource modification is not a survey date'}
waterprov={'dataset_url':'https://open.toronto.ca/dataset/topographic-mapping-waterbodies-and-rivers/','source_url':'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f352a9e9-4077-4c59-b0a9-f35a56fb24be/resource/8b2ae160-0175-40e6-b018-88f0e83f9a90/download/water-body-4326.gpkg','source_sha256':sha(RAW/'water-body-20261104.gpkg'),'source_bytes':9289728,'resource_last_modified':'2026-09-22T19:08:22.574760','retrieved_utc':'2026-11-04','crs':'EPSG:4326; selected ELEVATION attributes missing; geometry maintenance dates 2021-08-25 and 2024-10-16'}
for p in [ped,waterprov]:p.update({'license':'Open Government Licence – Toronto','license_url':'https://open.toronto.ca/open-data-licence/','attribution':'Contains information licensed under the Open Government Licence – Toronto.'})
prov={'version':1,'sha256':sha(OUT/'scene.json'),'bytes':(OUT/'scene.json').stat().st_size,'bbox':BBOX,'sources':[ped,waterprov,*[json.loads((F/p).read_text()) for p in ['city-terrain/provenance.json','city-roads/provenance.json','land-cover-provenance.json']]],'derivation':{'ground':'Original PolygonZ TIN clipped in EPSG:2952 and masked by official water polygons; constrained triangulation of clipped polygons retains original TIN barycentric heights, not new terrain interpolation. Triangles below 0.000001 square metres after 0.1 mm rounding are omitted. Ground converted to existing local frame, CGVD2013 metres.','paving':'Union of source-aligned round buffers (illustrative 2.6 m paths / 4 m trails), clipped to municipal water mask and original TIN triangles. Full-width barycentric heights lifted 0.06 m; no surveyed curbs or new access connections.', 'paths':'Original pedestrian alignments clipped and densified to <=5 m; route sampled every 2 m. Original IDs/directions retained; joins within 0.02 m, no new connectors.','roads':'Source arterial/collector/local/laneway centrelines, not elevated highway or rail. Joined buffers use authored class widths, clipped to original TIN and mapped water; full-width barycentric heights lifted 0.035 m. Not surveyed pavement or structural road elevations.','crossings':'Only CROSSWALK-flagged source paths overlapping illustrative road footprints: remove sidewalk-coloured paving in that overlap, then clip authored 0.6 m paint / 0.6 m gaps (5 mm numerical edge inset) to original TIN, lifted 0.045 m. No signal, access, curb-ramp or surveyed marking claims.', 'vegetation':'14 m EPSG:2952 grid samples within valid 2018 canopy polygons, >4 m from route. Reject centres covered by the official water mask, including boundary; hole interiors remain eligible. Stable pre-exclusion candidate IDs retain illustrative styling. Original low-poly shapes, not individual inventory.','vegetation_exclusions':excludedTrees,'water':'Original waterbody polygons clipped; no shoreline simplification. ELEVATION absent; illustrative constant scene level.'},'limits':out['limits']}
(OUT/'provenance.json').write_text(json.dumps(prov,separators=(',',':'),allow_nan=False)+'\n')
