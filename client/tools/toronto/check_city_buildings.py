"""Independently compare representative CTL1 rings/heights/anchors to pinned raw source rows."""
import json,struct,math,sys,hashlib
from pathlib import Path
import numpy as np,shapefile,pyproj
from shapely.geometry import shape
from shapely.ops import transform
ROOT=Path(__file__).resolve().parents[2];raw=Path(sys.argv[1]);out=ROOT/'fixtures/toronto/city-buildings';m=json.loads((out/'manifest.json').read_text());r=shapefile.Reader(str(raw/'3DMassingShapefile_2025_WGS84.shp'));to=pyproj.Transformer.from_crs(3857,4326,always_xy=True).transform;east=111320*math.cos(math.radians(43.65));north=111132
hm=json.loads((ROOT/'fixtures/toronto/city-terrain/manifest.json').read_text());ground=np.fromfile(ROOT/'fixtures/toronto/city-terrain/heights.f32',dtype='<f4').reshape(hm['height'],hm['width'])
def local(lon,lat,z=None):return (np.asarray(lon)+79.397)*east,(43.65-np.asarray(lat))*north
checks=[];max_ring_error=0;max_base_error=0
for key in sorted(m['tiles'])[::113]:
 data=(out/m['tiles'][key]['f']).read_bytes();magic,size=struct.unpack_from('<II',data);assert magic==0x43544c31;h=json.loads(data[8:8+size]);start=(8+size+3)&~3;sections={s['name']:s for s in h['sections']};positions=np.frombuffer(data,dtype='<f4',count=sections['bldgXZ']['length'],offset=start+sections['bldgXZ']['offset']).reshape(-1,2);anchors=np.frombuffer(data,dtype='<f4',count=sections['bAnchorXZ']['length'],offset=start+sections['bAnchorXZ']['offset']).reshape(-1,2)
 for idx in sorted(set([0,len(h['records'])//2,len(h['records'])-1])):
  identity=h['records'][idx];row=r.shapeRecord(identity['sourceRecordIndex']);g=transform(to,shape(row.shape.__geo_interface__));poly=([g] if g.geom_type=='Polygon' else list(g.geoms))[identity['part']];metric=transform(local,poly);expected=np.array(metric.exterior.coords[:-1])-np.array(h['origin']);record=start+sections['bldg']['offset']+idx*44;offset,length=struct.unpack_from('<IH',data,record);actual=positions[offset:offset+length];assert actual.shape==expected.shape;error=min(float(np.max(abs(actual-expected))),float(np.max(abs(actual-expected[::-1]))));assert error<.001;max_ring_error=max(max_ring_error,error)
  hole_section=sections['bholes'];holes=[]
  for k in range(hole_section['bytes']//12):
   owner,offset,length=struct.unpack_from('<IIH',data,start+hole_section['offset']+k*12)
   if owner==idx:holes.append((offset,length))
  assert len(holes)==len(metric.interiors)
  for ring,(offset,length) in zip(metric.interiors,holes):
   expected=np.array(ring.coords[:-1])-np.array(h['origin']);actual=positions[offset:offset+length];assert actual.shape==expected.shape;error=min(float(np.max(abs(actual-expected))),float(np.max(abs(actual-expected[::-1]))));assert error<.001;max_ring_error=max(max_ring_error,error)
  center=poly.representative_point();x,z=local(center.x,center.y);assert np.max(abs(anchors[idx]-[x,z]))<.01;u=(x-hm['origin'][0])/64;v=(z-hm['origin'][1])/64;i,j=math.floor(u),math.floor(v);u-=i;v-=j;q=ground[j:j+2,i:i+2];base=(q[0,0]*(1-u)+q[0,1]*u)*(1-v)+(q[1,0]*(1-u)+q[1,1]*u)*v;actualbase,height=struct.unpack_from('<ff',data,record+8);assert abs(actualbase-base)<.001;assert abs(height-row.record.as_dict()['AVG_HEIGHT'])<.0001;max_base_error=max(max_base_error,abs(actualbase-base));checks.append({'tile':key,'sourceRecordIndex':identity['sourceRecordIndex'],'sourcePart':identity['part']})
report={'manifest_sha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest(),'source_archive_sha256':m['sourceArchiveSha256'],'checkedParts':checks,'maxRingQuantizationErrorMetres':max_ring_error,'maxBaseQuantizationErrorMetres':max_base_error,'meaning':'Processing consistency with source geometry and illustrative terrain anchor, not survey/foundation accuracy.'};(out/'checks.json').write_text(json.dumps(report,indent=2)+'\n');print(len(checks),max_ring_error,max_base_error)
