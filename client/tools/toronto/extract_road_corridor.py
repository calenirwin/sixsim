"""Extract a bounded, source-connected Wellington corridor from the pinned TCL GeoPackage."""
import hashlib,json,sqlite3,struct,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]; fixtures=root/'fixtures/toronto'; source=Path(sys.argv[1]); out=Path(sys.argv[2]) if len(sys.argv)>2 else fixtures/'road-corridor.json'
p=json.loads((fixtures/'city-roads/provenance.json').read_text());assert hashlib.sha256(source.read_bytes()).hexdigest()==p['source_sha256']
g=json.loads((fixtures/'city-roads/graph.json').read_text()); graph={e[0]:e for e in g['edges']}; ids=[30130361,30058205,30058206,14025464,8491785]
c=sqlite3.connect(f'file:{source}?mode=ro',uri=True);c.row_factory=sqlite3.Row;assert c.execute('select srs_id from gpkg_geometry_columns').fetchone()[0]==4326
# Fail closed on any geometry encoding other than the pinned two-dimensional MultiLineString.
def points(b):
 assert b[:2]==b'GP'; n={0:0,1:32,2:48,3:48,4:64}[(b[3]>>1)&7]; offset=8+n
 def header():
  nonlocal offset
  endian='<' if b[offset]==1 else '>';assert b[offset] in (0,1);kind=struct.unpack_from(endian+'I',b,offset+1)[0];offset+=5;return endian,kind
 e,k=header();assert k==5;count=struct.unpack_from(e+'I',b,offset)[0];offset+=4;assert count==1
 e,k=header();assert k==2;count=struct.unpack_from(e+'I',b,offset)[0];offset+=4;assert 2<=count<=10000
 result=[list(struct.unpack_from(e+'dd',b,offset+i*16)) for i in range(count)];assert offset+count*16==len(b);return result
edges=[]
for ident in ids:
 r=c.execute('select * from "Centreline - Version 2 - 4326" where CENTRELINE_ID=?',(ident,)).fetchone();e=graph[ident];assert r['LINEAR_NAME_FULL']=='Wellington St W' and r['JURISDICTION']=='CITY OF TORONTO';assert e[1:4]==[r['FROM_INTERSECTION_ID'],r['TO_INTERSECTION_ID'],r['ONEWAY_DIR_CODE']];assert e[3]==1
 edges.append(dict(id=ident,fromNode=e[1],toNode=e[2],direction=1,sourceLengthM=e[4],points=points(r['geom'])))
for a,b in zip(edges,edges[1:]):assert a['toNode']==b['fromNode'] and a['points'][-1]==b['points'][0]
value={'version':1,'id':'wellington-west-source-corridor','name':'Wellington Street west of Spadina','geoOrigin':{'lat':43.65,'lon':-79.397},'edges':edges,'junctions':[{'id':e['toNode'],'incidentSourceEdges':sorted(r[0] for r in g['edges'] if e['toNode'] in r[1:3]),'crossingPermission':'unverified'} for e in edges], 'policy':{'speedMps':5,'startInsetM':10,'stopInsetM':10,'junctionCrossings':0,'access':'unverified','turns':'unverified','elevation':'district-flat-illustrative','basis':'prescribed-geometric-probe','trafficInteractions':False},'provenance':{'dataset_url':p['dataset_url'],'source_url':p['source_url'],'source_sha256':p['source_sha256'],'retrieved_utc':p['retrieved_utc'],'graph_sha256':p['graph_sha256'],'crs':'EPSG:4326','license':p['license'],'license_url':p['license_url'],'attribution':p['attribution'],'geometry':'Original source vertices, no snapping or connectors; five exact endpoint joins in source order except the final corridor boundary. Probe distance uses the existing local planar frame, not graph geodesic weights.'}}
value['provenance']['geometry']='Original source vertices, no snapping or connectors; four exact endpoint joins. Probe distance uses the existing local planar frame, not graph geodesic weights.'
out.write_text(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n');print(len(edges),'source edge records; 4 exact endpoint joins;',out.stat().st_size,'bytes')
