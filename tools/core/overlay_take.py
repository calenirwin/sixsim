"""The core's actors of one take frame projected onto a rendered frame of the same take (the page's ?replay recording,
or any renderer's), through the take's own camera row: each vehicle's plan box at its ground (amber), each walker's feet
and head (green), so a render whose actors come from the take shows every body inside its outline.

    python3 tools/core/overlay_take.py --take <dir with tracks.atrk> --image <frame.jpg> --frame <i> [--out file.png]
           [--max-dist 250]
"""
import argparse
import math
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from read_tracks import read_tracks  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--take', required=True)
ap.add_argument('--image', required=True)
ap.add_argument('--frame', type=int, required=True)
ap.add_argument('--out', default=None)
ap.add_argument('--max-dist', type=float, default=250.0)
a = ap.parse_args()

T = read_tracks(os.path.join(a.take, 'tracks.atrk') if os.path.isdir(a.take) else a.take)
H, F = T['header'], T['frames'][a.frame]
im = Image.open(a.image).convert('RGB')
W, Hh = im.size
d = ImageDraw.Draw(im)
cx, cy, cz, qx, qy, qz, qw, fov = H['camera']['rows'][a.frame]


def rot(q, v):   # rotate v by quaternion q (x, y, z, w)
    x, y, z, w = q
    ix = w * v[0] + y * v[2] - z * v[1]
    iy = w * v[1] + z * v[0] - x * v[2]
    iz = w * v[2] + x * v[1] - y * v[0]
    iw = -x * v[0] - y * v[1] - z * v[2]
    return (ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x)


qi = (-qx, -qy, -qz, qw)
t = math.tan(math.radians(fov) / 2)
asp = W / Hh


def proj(p):
    v = rot(qi, (p[0] - cx, p[1] - cy, p[2] - cz))
    if v[2] > -0.5:
        return None
    return ((v[0] / -v[2]) / (t * asp) * 0.5 + 0.5) * W, (0.5 - (v[1] / -v[2]) / t * 0.5) * Hh


size_of = {i: k['size'] for i, k in enumerate(H['vehicleKinds'])}
nv = nw = 0
for r in F['veh']:
    if math.hypot(r['x'] - cx, r['z'] - cz) > a.max_dist:
        continue
    w_, h_, l_ = size_of.get(r['kind'], [2, 1.5, 4.6])
    x, y, z = r['x'], r['y'], r['z']
    q = r['q']
    pts = [proj(tuple(c + o for c, o in zip((x, y + 0.05, z), rot(q, (sx * w_ / 2, 0, sz * l_ / 2))))) for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    if any(p is None for p in pts):
        continue
    d.line(pts + [pts[0]], fill=(255, 176, 0), width=3)
    top = proj(tuple(c + o for c, o in zip((x, y, z), rot(q, (0, h_, 0)))))
    base = proj((x, y + 0.05, z))
    if top and base:
        d.line([base, top], fill=(255, 176, 0), width=2)
    nv += 1
for r in F['walk']:
    if math.hypot(r['x'] - cx, r['z'] - cz) > a.max_dist:
        continue
    foot, head = proj((r['x'], r['y'], r['z'])), proj((r['x'], r['y'] + 1.75 * (r['sy'] or 1), r['z']))
    if not foot or not head:
        continue
    d.line([foot, head], fill=(60, 255, 120), width=2)
    d.ellipse([foot[0] - 4, foot[1] - 4, foot[0] + 4, foot[1] + 4], outline=(60, 255, 120), width=2)
    nw += 1
d.text((16, Hh - 40), '%s frame %d: the core\'s %d vehicles (plan boxes) and %d walkers (feet to head) within %d m, through the take\'s camera'
       % (H['shot'], a.frame, nv, nw, a.max_dist), fill=(255, 255, 255))
out = a.out or os.path.splitext(a.image)[0] + '_overlay.png'
im.save(out)
print('%s: %d vehicles, %d walkers drawn -> %s' % (H['shot'], nv, nw, out))
