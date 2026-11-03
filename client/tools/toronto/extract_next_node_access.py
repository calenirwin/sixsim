"""Extract every pinned source record incident on the two downstream hold nodes."""
import hashlib,json,sqlite3,struct,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2];f=root/'fixtures/toronto';raw=Path(sys.argv[1]);out=Path(sys.argv[2]) if len(sys.argv)>2 else f/'next-node-access.json'
p=json.loads((f/'city-roads/provenance.json').read_text());assert hashlib.sha256(raw.read_bytes()).hexdigest()==p['source_sha256']
g=json.loads((f/'city-roads/graph.json').read_text());graph={e[0]:e for e in g['edges']};nodes={n[0]:n[1:] for n in g['nodes']}
c=sqlite3.connect(f'file:{raw}?mode=ro',uri=True);c.row_factory=sqlite3.Row;assert c.execute('select srs_id from gpkg_geometry_columns').fetchone()[0]==4326
def points(b):
 assert b[:2]==b'GP';offset=8+{0:0,1:32,2:48,3:48,4:64}[(b[3]>>1)&7]
 def header():
  nonlocal offset
  assert b[offset] in (0,1);e='<' if b[offset]==1 else '>';k=struct.unpack_from(e+'I',b,offset+1)[0];offset+=5;return e,k
 e,k=header();assert k==5;assert struct.unpack_from(e+'I',b,offset)[0]==1;offset+=4;e,k=header();assert k==2;n=struct.unpack_from(e+'I',b,offset)[0];offset+=4;assert 2<=n<=10000 and offset+n*16==len(b);return [list(struct.unpack_from(e+'dd',b,offset+i*16)) for i in range(n)]
result=[]
for node,incoming in [(13467820,1146640),(13467949,8491785)]:
 rows=[]
 for r in c.execute('select * from "Centreline - Version 2 - 4326" where FROM_INTERSECTION_ID=? or TO_INTERSECTION_ID=? order by CENTRELINE_ID',(node,node)):
  e=graph[r['CENTRELINE_ID']];coords=points(r['geom']);assert e[1:4]==[r['FROM_INTERSECTION_ID'],r['TO_INTERSECTION_ID'],r['ONEWAY_DIR_CODE'] or 0];assert coords[0]==nodes[e[1]] and coords[-1]==nodes[e[2]]
  assert r['ONEWAY_DIR_CODE_DESC']=={None:'Not One-Way',1:'Follow-Digitization',-1:'Against-Digitization'}[r['ONEWAY_DIR_CODE']]
  rows.append(dict(id=e[0],fromNode=e[1],toNode=e[2],rawDirection=r['ONEWAY_DIR_CODE'],directionDescription=r['ONEWAY_DIR_CODE_DESC'],name=r['LINEAR_NAME_FULL'],jurisdiction=r['JURISDICTION'],featureClass=r['FEATURE_CODE_DESC'],points=coords))
 assert any(r['id']==incoming for r in rows)
 result.append(dict(nodeId=node,incomingEdgeId=incoming,coordinate=nodes[node],records=rows))
value=dict(version=1,coordinateSystem='EPSG:4326',nodes=result,provenance={k:p[k] for k in ['dataset_url','source_url','source_sha256','retrieved_utc','graph_sha256','license','license_url','attribution']},missingEvidence=['turn-permissions','vehicle-access-restrictions','signal-control','lane-connections','surveyed-elevation'])
out.write_text(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n');print('Seven incident source records; no turn/access authority;',out.stat().st_size,'bytes')
