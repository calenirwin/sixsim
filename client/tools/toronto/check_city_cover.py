"""Independent point-in-source-polygon checks of derived municipal categories."""
import json,sys,hashlib
from pathlib import Path
import numpy as np,pyogrio.raw,pyproj,shapely
from shapely.geometry import Point
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'fixtures/toronto/city-cover';raw=Path(sys.argv[1]);m=json.loads((out/'manifest.json').read_text());to=pyproj.Transformer.from_crs(4326,2952,always_xy=True);east=111320*np.cos(np.deg2rad(43.65));checks=[];excluded=[]
candidates=[]
for key in sorted(m['tiles'],key=lambda k:tuple(map(int,k.split('_')))):
 data=np.frombuffer((out/m['tiles'][key]['f']).read_bytes(),dtype=np.uint8).reshape(64,64);center=data[1:-1,1:-1];safe=(center>0)&(center<9)
 for dy in range(3):
  for dx in range(3):safe &= data[dy:dy+62,dx:dx+62]==center
 valid=np.argwhere(safe)+1
 if len(valid):candidates.append((key,valid[len(valid)//2]))
selected=[candidates[int(i)] for i in np.linspace(0,len(candidates)-1,32,dtype=int)]
for key,(row,col) in selected:
 data=np.frombuffer((out/m['tiles'][key]['f']).read_bytes(),dtype=np.uint8).reshape(64,64)
 i,j=map(int,key.split('_'));x=m['origin'][0]+i*1024+(int(col)+.5)*16;z=m['origin'][1]+j*1024+(int(row)+.5)*16;lon=x/east-79.397;lat=43.65-z/111132;sx,sy=to.transform(lon,lat);p=Point(sx,sy)
 meta,fids,wkb,arrays=pyogrio.raw.read(raw/'LandCover2018.gdb',layer='LandCover2018',bbox=(sx-.1,sy-.1,sx+.1,sy+.1),columns=['gridcode'],return_fids=True);codes=set();edge=False
 for fid,blob,code in zip(fids,wkb,arrays[0]):
  parts=shapely.get_parts(shapely.from_wkb(blob));near=parts[shapely.distance(parts,p)<=1]
  clean=shapely.is_valid(near)&(shapely.distance(shapely.boundary(near),p)>=1)
  if not clean.all():edge=True
  if shapely.covers(near[clean],p).any():codes.add(int(code))
 if edge:excluded.append({'tile':key,'reason':'within 1 m of boundary or invalid original part; not used as an independent assertion'});print(key,'excluded',flush=True);continue
 code=int(data[row,col]);assert codes=={code},(key,row,col,code,codes)
 print(key,'verified',code,flush=True)
 checks.append({'tile':key,'row':int(row),'column':int(col),'longitude':lon,'latitude':lat,'class':code,'sourceClasses':sorted(codes)})
result={'manifest_sha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest(),'checked':checks,'excluded':excluded,'meaning':'Direct point-in-original-valid-source-polygon classification after independent coordinate conversion. Boundary/invalid-part probes excluded explicitly; not a claim of current ground truth.'}
(out/'checks.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n');print('Independent source checks',len(checks),'excluded',len(excluded));assert len(checks)>=12,len(checks)
