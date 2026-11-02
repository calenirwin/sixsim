"""Pinned source geometry for a two-probe Wellington/Bathurst experiment."""
import hashlib,json,sqlite3,struct,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2];f=root/'fixtures/toronto';raw=Path(sys.argv[1]);out=Path(sys.argv[2]) if len(sys.argv)>2 else f/'shared-junction.json';p=json.loads((f/'city-roads/provenance.json').read_text());assert hashlib.sha256(raw.read_bytes()).hexdigest()==p['source_sha256']
g=json.loads((f/'city-roads/graph.json').read_text());graph={e[0]:e for e in g['edges']};c=sqlite3.connect(f'file:{raw}?mode=ro',uri=True);c.row_factory=sqlite3.Row;assert c.execute('select srs_id from gpkg_geometry_columns').fetchone()[0]==4326
node=13467884;ids=[1146640,8457361,8491785,14025464]
def points(b):
 assert b[:2]==b'GP';offset=8+{0:0,1:32,2:48,3:48,4:64}[(b[3]>>1)&7]
 def header():
  nonlocal offset
  assert b[offset] in (0,1);e='<' if b[offset]==1 else '>';k=struct.unpack_from(e+'I',b,offset+1)[0];offset+=5;return e,k
 e,k=header();assert k==5;assert struct.unpack_from(e+'I',b,offset)[0]==1;offset+=4;e,k=header();assert k==2;n=struct.unpack_from(e+'I',b,offset)[0];offset+=4;assert 2<=n<=10000 and offset+n*16==len(b);return [list(struct.unpack_from(e+'dd',b,offset+i*16)) for i in range(n)]
edges=[]
for ident in ids:
 r=c.execute('select * from "Centreline - Version 2 - 4326" where CENTRELINE_ID=?',(ident,)).fetchone();e=graph[ident];assert r['JURISDICTION']=='CITY OF TORONTO';assert e[1:4]==[r['FROM_INTERSECTION_ID'],r['TO_INTERSECTION_ID'],r['ONEWAY_DIR_CODE'] or 0]
 edges.append(dict(id=ident,name=r['LINEAR_NAME_FULL'],fromNode=e[1],toNode=e[2],direction=e[3],sourceLengthM=e[4],points=points(r['geom'])))
by={e['id']:e for e in edges};paths=[{'id':'bathurst-probe','incoming':8457361,'outgoing':1146640},{'id':'wellington-probe','incoming':14025464,'outgoing':8491785}]
for path in paths:
 a,b=by[path['incoming']],by[path['outgoing']];assert a['toNode']==node==b['fromNode'] and a['direction'] in (0,1) and b['direction'] in (0,1);assert a['points'][-1]==b['points'][0]
assert by[paths[0]['incoming']]['points'][-1]==by[paths[1]['incoming']]['points'][-1]
value={'version':1,'nodeId':node,'geoOrigin':{'lat':43.65,'lon':-79.397},'edges':edges,'paths':paths,'provenance':{k:p[k] for k in ['dataset_url','source_url','source_sha256','retrieved_utc','graph_sha256','license','license_url','attribution']},'limits':['Original source vertices and direction codes; no snapped connector, lane geometry or turn/access permission inferred.','Four incident selected street records; not a surveyed physical conflict zone.','Authored probe spacing, speed, timing and exclusive-slot rule are separate simulation inputs.']}
out.write_text(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n');print('Four source records; two exact connected paths;',out.stat().st_size,'bytes')
