"""Pinned municipal street context and conservative directed source topology."""
import hashlib,json,math,sqlite3,sys
from pathlib import Path
from collections import Counter,defaultdict
import shapely,pyproj
from shapely.geometry import shape,box,mapping
from shapely.ops import transform
ROOT=Path(__file__).resolve().parents[2];F=ROOT/'fixtures/toronto';raw=Path(sys.argv[1]);out=Path(sys.argv[2]) if len(sys.argv)>2 else F/'city-roads';out.mkdir(parents=True,exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):p.write_text(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n')
source=raw/'centreline-20261023.gpkg';prior=json.loads((F/'network-provenance.json').read_text())['centreline'];assert sha(source)==prior['archive_sha256'];m=json.loads((F/'city-terrain/manifest.json').read_text());assert sha(F/'city-terrain/boundary.geojson')==m['boundarySha256']
boundary=shape(json.loads((F/'city-terrain/boundary.geojson').read_text())['features'][0]['geometry']);shapely.prepare(boundary)
def local(lon,lat,z=None):return (lon+79.397)*m['frame']['metresPerLongitude'],(43.65-lat)*m['frame']['metresPerLatitude']
geod=pyproj.Geod(ellps='WGS84');tiles=defaultdict(list);roads=[];excluded=[];counts=Counter();nodes=defaultdict(list);codes={201100,201101,201200,201201,201300,201301,201400,201401,201500}
conn=sqlite3.connect(f'file:{source}?mode=ro',uri=True);conn.row_factory=sqlite3.Row;assert conn.execute('select srs_id from gpkg_geometry_columns').fetchone()[0]==4326
for r in conn.execute('select * from "Centreline - Version 2 - 4326" order by CENTRELINE_ID'):
 counts['sourceRecords']+=1
 if r['FEATURE_CODE'] not in codes:counts['excludedFeatureClass']+=1;continue
 b=r['geom'];n={0:0,1:32,2:48,3:48,4:64}[(b[3]>>1)&7];assert b[:2]==b'GP';g=shapely.from_wkb(b[8+n:]);rid=r['CENTRELINE_ID'];assert isinstance(rid,int)
 if not g.is_valid or g.is_empty:excluded.append([rid,'invalid-geometry']);continue
 if not boundary.intersects(g):counts['outsideMunicipality']+=1;continue
 counts['municipalStreets']+=1
 # Visual clipping creates no graph nodes or implied intersections.
 clipped=g.intersection(boundary);local_g=transform(local,clipped);a,z,c,d=local_g.bounds
 for j in range(math.floor((z-m['origin'][1])/1024),math.floor((d-m['origin'][1])/1024)+1):
  for i in range(math.floor((a-m['origin'][0])/1024),math.floor((c-m['origin'][0])/1024)+1):
   ox=m['origin'][0]+i*1024;oz=m['origin'][1]+j*1024;piece=local_g.intersection(box(ox,oz,ox+1024,oz+1024));parts=list(shapely.get_parts(piece))
   for p in parts:
    if p.geom_type!='LineString' or p.length<.001:continue
    points=[[round(x-ox,6),round(y-oz,6)] for x,y in p.coords];tiles[f'{i}_{j}'].append({'id':rid,'points':points})
 reason=None;parts=list(shapely.get_parts(g));direction=r['ONEWAY_DIR_CODE'];desc=r['ONEWAY_DIR_CODE_DESC']
 if not boundary.covers(g):reason='boundary-crossing'
 elif r['JURISDICTION'] not in ('CITY OF TORONTO','PROVINCE'):reason='jurisdiction-not-selected'
 elif len(parts)!=1 or parts[0].geom_type!='LineString':reason='multipart-topology'
 elif not all(isinstance(r[k],int) and r[k]>0 for k in ('FROM_INTERSECTION_ID','TO_INTERSECTION_ID')):reason='missing-intersection-id'
 elif (direction,desc) not in ((None,'Not One-Way'),(1,'Follow-Digitization'),(-1,'Against-Digitization')):reason='unknown-direction'
 if reason:excluded.append([rid,reason]);continue
 points=list(parts[0].coords);length=geod.line_length(*zip(*points))
 if length<=0:excluded.append([rid,'zero-length']);continue
 f,t=r['FROM_INTERSECTION_ID'],r['TO_INTERSECTION_ID'];nodes[f].append(points[0]);nodes[t].append(points[-1]);roads.append([rid,f,t,direction or 0,round(length,3)])
# No snapping. A source intersection ID with separated endpoint coordinates excludes all incident graph edges.
bad=set();canonical={}
for nid,points in sorted(nodes.items()):
 p=min(points);canonical[nid]=p
 if any(geod.inv(p[0],p[1],q[0],q[1])[2]>.5 for q in points):bad.add(nid)
kept=[]
for r in roads:
 if r[1] in bad or r[2] in bad:excluded.append([r[0],'inconsistent-intersection-endpoints'])
 else:kept.append(r)
used={n for r in kept for n in r[1:3]};graph={'version':1,'basis':'directed-source-street-topology','nodes':[[n,*canonical[n]] for n in sorted(used)],'edges':kept,'weight':'WGS84 geodesic source-line length in metres, rounded to 0.001 m','routing_use':'research topology only; no turn restrictions, access guarantees, lane or structural-height model'};save(out/'graph.json',graph)
manifest={'version':1,'tile':1024,'origin':m['origin'],'terrainSha256':m['heightSha256'],'boundarySha256':m['boundarySha256'],'sourceSha256':prior['archive_sha256'],'tiles':{}}
for key,features in sorted(tiles.items()):
 data={'key':key,'roads':features};save(out/(key+'.json'),data);f=out/(key+'.json');assert f.stat().st_size<2000000;manifest['tiles'][key]={'f':f.name,'bytes':f.stat().st_size,'sha256':sha(f),'parts':len(features)}
counts.update({'tiles':len(tiles),'graphEdges':len(kept),'graphNodes':len(used),'inconsistentNodes':len(bad),'tileBytes':sum(t['bytes'] for t in manifest['tiles'].values())});assert counts['tileBytes']<15000000
manifest['counts']=dict(counts);save(out/'manifest.json',manifest);save(out/'exclusions.json',{'edges':sorted(excluded),'inconsistentIntersectionIds':sorted(bad)})
p={'dataset_url':prior['dataset_url'],'source_url':prior['archive_url'],'source_sha256':prior['archive_sha256'],'source_bytes':source.stat().st_size,'retrieved_utc':prior['retrieved_utc'],'resource_last_modified':prior['resource_last_modified'],'crs':'EPSG:4326 verified GeoPackage; shared local east/south frame for tiles','frame':m['frame'],'source_fields':['CENTRELINE_ID','FROM_INTERSECTION_ID','TO_INTERSECTION_ID','ONEWAY_DIR_CODE','ONEWAY_DIR_CODE_DESC','FEATURE_CODE','JURISDICTION'],'selected_feature_codes':sorted(codes),'selection':'Expressways, ramps, arterials, collectors and local streets intersecting official municipality. Visual lines clipped; graph requires whole single-part edges within boundary, selected City/Province jurisdiction and consistent source intersection endpoints within 0.5 m. No geometric crossing joins, snapping, transfer or inferred connector edges.','direction':'Source None/Not One-Way permits both directions; 1/Follow-Digitization forward; -1/Against-Digitization reverse. Other pairs excluded.','counts':dict(counts),'exclusion_counts':dict(Counter(reason for _,reason in excluded)),'manifest_sha256':sha(out/'manifest.json'),'graph_sha256':sha(out/'graph.json'),'exclusions_sha256':sha(out/'exclusions.json'),'boundary_sha256':m['boundarySha256'],'terrain_sha256':m['heightSha256'],'license':'Open Government Licence – Toronto','license_url':'https://open.toronto.ca/open-data-licence/','license_evidence':'Official catalogue and CKAN checked 2026-10-31 identify open-government-licence-toronto; older district provenance retains its historical missing metadata.','attribution':'Contains information licensed under the Open Government Licence – Toronto.','limits':['Cartographic street centrelines projected onto coarse terrain, not road surfaces or correct bridge/tunnel heights. Missing terrain remains missing.','Directed shortest source-length paths are topology experiments, not driving directions or legal/access/turn guidance. No traffic interactions or actor reassignment.','Pending roads, trails, railway, busway, laneways and other classes excluded from this street increment; jurisdiction is not an access guarantee.','Graph excludes inconsistent endpoint IDs and boundary-crossing edges instead of inventing connectivity.']};save(out/'provenance.json',p);print(p['counts']);print(p['exclusion_counts'])
