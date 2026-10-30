"""Optional source-backed check: sample source polygons independently of rasterization.
Run with the pinned GIS environment and ignored raw directory as the argument.
"""
import json,sys
from pathlib import Path
import numpy as np
import pyogrio.raw,pyproj,shapely
root=Path(__file__).resolve().parents[2]
data=json.loads((root/'fixtures/toronto/land-cover-2018.json').read_text())
transform=pyproj.Transformer.from_crs(4326,2952,always_xy=True)
a,b,c,d=data['bbox'];corners=[transform.transform(x,y) for x,y in [(a,b),(a,d),(c,b),(c,d)]]
xs,ys=zip(*corners)
meta,_,wkb,fields=pyogrio.raw.read(Path(sys.argv[1])/'LandCover2018.gdb',layer='LandCover2018',bbox=(min(xs),min(ys),max(xs),max(ys)),columns=['gridcode'])
polygons=[shapely.from_wkb(v) for v in wkb];codes=dict(zip(meta['fields'],fields))['gridcode']
cells=np.repeat(data['runs'][::2],data['runs'][1::2]).reshape(data['height'],data['width'])
# Fixed interior cell centers cover the full district, avoiding hand-picked classes.
seen=set()
for row in range(19,data['height'],67):
 for col in range(17,data['width'],59):
  lon=a+(col+.5)*(c-a)/data['width'];lat=d-(row+.5)*(d-b)/data['height']
  point=shapely.Point(*transform.transform(lon,lat))
  hits={int(code) for g,code in zip(polygons,codes) if g.intersects(point)}
  expected=next(iter(hits)) if len(hits)==1 else 0
  assert cells[row,col]==expected,(row,col,cells[row,col],hits)
  seen.add(expected)
print('90 distributed source polygon/cell-center comparisons passed; classes',sorted(seen))
