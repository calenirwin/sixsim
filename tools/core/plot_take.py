"""Top-down plot of a take's actors at one frame: the region's traffic and walk edges (map.json from tools/core/take.mjs),
the vehicles as their plan boxes (blue moving, amber standing), the walkers as dots (green walking, grey standing), the
signal heads by state and the lens with its field of view. With --page, the page's own actors at the same frame
(actors_f<i>.json from tools/core/page_take.mjs) are drawn on the same map beside the core's: one image, two panels,
1 px = the same metres in both.

    python3 tools/core/plot_take.py --take shots/core/tuApolloSweep_s1 --frame 0 [--page shots/core/tuApolloSweep_page]
           [--half 120] [--size 900] [--out file.png]
"""
import argparse
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from read_tracks import read_tracks  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--take', required=True)
ap.add_argument('--frame', type=int, default=0)
ap.add_argument('--page', default=None)
ap.add_argument('--half', type=float, default=120.0, help='half the window, metres')
ap.add_argument('--size', type=int, default=900)
ap.add_argument('--out', default=None)
a = ap.parse_args()

T = read_tracks(os.path.join(a.take, 'tracks.atrk'))
H = T['header']
M = json.load(open(os.path.join(a.take, 'map.json')))
F = T['frames'][a.frame]
cam = H['camera']['rows'][a.frame]
cx, cz = cam[0], cam[2]
S = a.size
k = S / (2 * a.half)


def px(x, z):
    return ((x - cx) * k + S / 2, (z - cz) * k + S / 2)


def yaw_of(q):
    qx, qy, qz, qw = q
    return math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy))


def box(d, x, z, yaw, w, l, fill):
    fx, fz = math.sin(yaw), math.cos(yaw)
    rx, rz = fz, -fx
    pts = []
    for sl, sw in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        pts.append(px(x + fx * sl * l / 2 + rx * sw * w / 2, z + fz * sl * l / 2 + rz * sw * w / 2))
    d.polygon(pts, fill=fill, outline=(15, 15, 18))
    hx, hz = px(x + fx * l / 2, z + fz * l / 2)
    d.ellipse([hx - 1.5, hz - 1.5, hx + 1.5, hz + 1.5], fill=(240, 240, 240))


def base(title):
    im = Image.new('RGB', (S, S), (24, 26, 30))
    d = ImageDraw.Draw(im)
    for r in M['roads']:
        w = max(2, int(r['lanes'] * 3.1 * k))
        d.line([px(x, z) for x, z in r['pts']], fill=(62, 64, 70), width=w)
    for e in M['walks']:
        col = (70, 92, 74) if e['kind'] in ('path', 'campus') else (88, 88, 96)
        d.line([px(x, z) for x, z in e['pts']], fill=col, width=1)
    # the lens and its horizontal field of view
    qx, qy, qz, qw = cam[3:7]
    fx = -(2 * (qx * qz + qw * qy))
    fz = -(1 - 2 * (qx * qx + qy * qy))
    n = math.hypot(fx, fz) or 1
    fx, fz = fx / n, fz / n
    hf = math.atan(math.tan(math.radians(cam[7]) / 2) * 16 / 9)
    for s in (-1, 1):
        c, sn = math.cos(s * hf), math.sin(s * hf)
        dx, dz = fx * c - fz * sn, fx * sn + fz * c
        d.line([px(cx, cz), px(cx + dx * a.half * 1.5, cz + dz * a.half * 1.5)], fill=(200, 200, 90), width=1)
    d.ellipse([S / 2 - 4, S / 2 - 4, S / 2 + 4, S / 2 + 4], outline=(230, 230, 120), width=2)
    try:
        font = ImageFont.load_default(size=16)
    except TypeError:
        font = ImageFont.load_default()
    d.text((10, 8), title, fill=(230, 230, 230), font=font)
    return im, d, font


def signals(d):
    code = F['sig'][0] if F['sig'] else None
    if code is None:
        return
    ns, ew = code & 3, (code >> 2) & 3
    col = {0: (220, 50, 40), 1: (240, 180, 30), 2: (60, 200, 80)}
    for s in H['signals']['list']:
        x, y = px(s['x'], s['z'])
        d.rectangle([x - 4, y - 4, x, y], fill=col[ns])
        d.rectangle([x, y, x + 4, y + 4], fill=col[ew])


kinds = H['vehicleKinds']
im1, d1, font = base('core  %s  frame %d  seed %s' % (H['shot'], a.frame, H['seed']))
signals(d1)
for e in M['walks'][:0]:
    pass
nv = nw = 0
for v in F['veh']:
    if abs(v['x'] - cx) > a.half * 1.1 or abs(v['z'] - cz) > a.half * 1.1:
        continue
    sz = kinds[v['kind']]['size'] if v['kind'] < len(kinds) else [2, 1.5, 4.6]
    box(d1, v['x'], v['z'], yaw_of(v['q']), sz[0], sz[2], (70, 130, 230) if v['v'] > 0.5 else (230, 160, 50))
    nv += 1
for p in H['parked']:
    if abs(p['x'] - cx) > a.half * 1.1 or abs(p['z'] - cz) > a.half * 1.1:
        continue
    kk = next((q for q in kinds if q['kind'] == p['kind']), None)
    sz = kk['size'] if kk else [2, 1.5, 4.6]
    box(d1, p['x'], p['z'], yaw_of(p['q']), sz[0], sz[2], (95, 95, 105))
for w in F['walk']:
    if abs(w['x'] - cx) > a.half * 1.1 or abs(w['z'] - cz) > a.half * 1.1:
        continue
    x, y = px(w['x'], w['z'])
    r = max(1.5, 0.3 * k)
    d1.ellipse([x - r, y - r, x + r, y + r], fill=(90, 210, 110) if w['amp'] > 0.5 else (170, 170, 170))
    nw += 1
for t in F.get('train', []):
    box(d1, t['x'], t['z'], t['yaw'] - math.pi / 2, 3.0, 15.5, (200, 90, 200))   # a car faces +x: as a +z box, yaw - 90 deg
d1.text((10, S - 26), 'vehicles %d  walkers %d in window' % (nv, nw), fill=(220, 220, 220), font=font)
panels = [im1]
if a.page:
    P = json.load(open(os.path.join(a.page, 'actors_f%d.json' % a.frame)))
    im2, d2, _ = base('page  %s  frame %d' % (H['shot'], a.frame))
    signals(d2)
    size_of = {q['kind']: q['size'] for q in kinds}
    nv = nw = 0
    for kind, x, z, yaw, v in P['veh']:
        if abs(x - cx) > a.half * 1.1 or abs(z - cz) > a.half * 1.1:
            continue
        sz = size_of.get(kind, [2, 1.5, 4.6])
        box(d2, x, z, yaw, sz[0], sz[2], (70, 130, 230) if v > 0.5 else (230, 160, 50))
        nv += 1
    for p in H['parked']:   # the parked set is a function of the tiles (the same records in both)
        if abs(p['x'] - cx) > a.half * 1.1 or abs(p['z'] - cz) > a.half * 1.1:
            continue
        sz = size_of.get(p['kind'], [2, 1.5, 4.6])
        box(d2, p['x'], p['z'], yaw_of(p['q']), sz[0], sz[2], (95, 95, 105))
    for x, z, yaw, v in P['walk']:
        if abs(x - cx) > a.half * 1.1 or abs(z - cz) > a.half * 1.1:
            continue
        X, Y = px(x, z)
        r = max(1.5, 0.3 * k)
        d2.ellipse([X - r, Y - r, X + r, Y + r], fill=(90, 210, 110) if v > 0.3 else (170, 170, 170))
        nw += 1
    d2.text((10, S - 26), 'vehicles %d  walkers %d in window' % (nv, nw), fill=(220, 220, 220), font=font)
    panels.append(im2)
out = Image.new('RGB', (S * len(panels) + 8 * (len(panels) - 1), S), (0, 0, 0))
for i, p in enumerate(panels):
    out.paste(p, (i * (S + 8), 0))
dst = a.out or os.path.join(a.take, 'plot_f%d%s.png' % (a.frame, '_vs_page' if a.page else ''))
out.save(dst)
print(dst)
